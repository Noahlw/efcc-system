import { randomUUID } from "node:crypto";

import { buildActivityFixtures } from "../scenarios/activities";
import { dedicatedTest as test, expect } from "../support/fixtures";
import type { NativeApp } from "../support/fixtures";
import { qualifyPresentation } from "./r11-presentation";

const fixtureById = <T extends { id: string }>(
  fixtures: readonly T[],
  id: string
): T => {
  const fixture = fixtures.find((candidate) => candidate.id === id);
  if (!fixture) {
    throw new Error(`Missing native fixture ${id}`);
  }
  return fixture;
};

/** A real enrolled occurrence forces Home through its D1 event read. */
const seedHomeReadRows = async (db: NativeApp["db"], userId: string) => {
  const activities = buildActivityFixtures();
  const now = Math.floor(Date.now() / 1000);
  const department = fixtureById(activities.departments, "dept-worship");
  const program = fixtureById(activities.programs, "prog-sunday-service");
  const event = fixtureById(activities.events, "evt-sunday-soon");
  const enrolment = fixtureById(activities.enrolments, "enr-sunday-wong");

  await db.batch([
    db
      .prepare("insert into department (created_at, id, name) values (?, ?, ?)")
      .bind(now, department.id, department.name),
    db
      .prepare(
        "insert into program (created_at, department_id, id, name) values (?, ?, ?, ?)"
      )
      .bind(now, program.departmentId, program.id, program.name),
    db
      .prepare(
        "insert into program_event (created_at, ends_at, id, program_id, starts_at, title) values (?, ?, ?, ?, ?, ?)"
      )
      .bind(
        now,
        null,
        event.id,
        event.programId,
        Math.floor(Date.parse(event.startsAt) / 1000),
        event.title
      ),
    db
      .prepare(
        "insert into enrolment (created_at, id, program_id, status, updated_at, user_id) values (?, ?, ?, ?, ?, ?)"
      )
      .bind(
        now,
        enrolment.id,
        enrolment.programId,
        enrolment.status,
        now,
        userId
      ),
  ]);
};

test.describe(
  "zz-worker-faults",
  { tag: ["@native", "@zz-worker-faults"] },
  () => {
    test(
      "native auth origins reject evil origins and unmatched paths",
      { tag: ["@http", "@risk-auth"] },
      async ({ account, caseApp, extraHTTPHeaders, playwright }) => {
        const originProbe = await playwright.request.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const freshOrigins = await Promise.all(
            [
              {
                body: {
                  password: account.password,
                  username: account.username,
                },
                path: "/sign-in/username",
              },
              {
                body: {
                  fullName: account.fullName,
                  password: account.password,
                },
                path: "/sign-in/name",
              },
              {
                body: {
                  password: account.password,
                  username: account.username,
                },
                path: "/sign-in/username/",
              },
              {
                body: {
                  fullName: account.fullName,
                  password: account.password,
                },
                path: "/sign-in/name/",
              },
            ].map(async (entry) => {
              const response = await originProbe.post(
                `/api/auth${entry.path}`,
                {
                  data: entry.body,
                  headers: { origin: "https://evil.example" },
                }
              );
              return {
                hasSessionCookie: Boolean(response.headers()["set-cookie"]),
                status: response.status(),
              };
            })
          );
          expect(freshOrigins).toEqual([
            { hasSessionCookie: false, status: 403 },
            { hasSessionCookie: false, status: 403 },
            { hasSessionCookie: false, status: 403 },
            { hasSessionCookie: false, status: 403 },
          ]);
          const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
          const trailingPathAccount = {
            email: `${suffix}@example.com`,
            fullName: `陳測試${suffix}`,
            membershipStatus: "active" as const,
            password: "Synthetic-native-password!",
            username: `origin.${suffix}`,
          };
          await caseApp.provision.account(trailingPathAccount);

          const trailingPath = await originProbe.post(
            "/api/auth/sign-in/name/",
            {
              data: {
                fullName: trailingPathAccount.fullName,
                password: trailingPathAccount.password,
              },
              headers: { "cf-connecting-ip": "198.51.100.44" },
            }
          );
          expect(trailingPath.status()).toBe(200);
          const trailingCookie = trailingPath.headers()["set-cookie"];
          expect(trailingCookie?.includes("better-auth.session_token")).toBe(
            true
          );

          const sameOrigin = await originProbe.post("/api/auth/sign-in/name", {
            data: { fullName: account.fullName, password: account.password },
            headers: {
              "cf-connecting-ip": "192.0.2.44",
              origin: caseApp.origin,
            },
          });
          expect(sameOrigin.status()).toBe(200);
          const sameOriginCookie = sameOrigin.headers()["set-cookie"];
          expect(sameOriginCookie?.includes("better-auth.session_token")).toBe(
            true
          );
          const crossOriginSignOut = await originProbe.post(
            "/api/auth/sign-out",
            {
              data: {},
              headers: { origin: "https://evil.example" },
            }
          );
          expect(crossOriginSignOut.status()).toBe(403);
          const stillSignedIn = await originProbe.get("/api/v2/me", {
            headers: {
              "x-efcc-access": "anonymous",
              "x-efcc-session-id": "spoofed-session",
              "x-efcc-user-id": "spoofed-user",
            },
          });
          expect(stillSignedIn.status()).toBe(200);
          expect(await stillSignedIn.json()).toEqual({
            data: {
              displayName: account.fullName,
              membershipStatus: "active",
              username: account.username,
            },
          });
        } finally {
          await originProbe.dispose();
        }
      }
    );

    test(
      "real production ingress contains the post-guard identity read fault",
      {
        tag: ["@http", "@risk-auth", "@risk-privacy", "@risk-recovery"],
      },
      async ({ account, app, caseApp, playwright, signedInRequest }) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
        const controlAccount = {
          email: `${suffix}@example.com`,
          fullName: `陳對照${suffix}`,
          membershipStatus: "active" as const,
          password: "Synthetic-native-password!",
          username: `control.${suffix}`,
        };
        await app.provision.account(controlAccount);
        const controlRequest = await playwright.request.newContext({
          baseURL: app.origin,
          extraHTTPHeaders: {
            "cf-connecting-ip": "198.51.100.77",
            origin: app.origin,
          },
        });

        try {
          const controlLogin = await controlRequest.post(
            "/api/auth/sign-in/username",
            {
              data: {
                password: controlAccount.password,
                username: controlAccount.username,
              },
            }
          );
          expect(controlLogin.status()).toBe(200);
          const expectedControl = {
            data: {
              displayName: controlAccount.fullName,
              membershipStatus: "active",
              username: controlAccount.username,
            },
          };
          const baselineControl = await controlRequest.get("/api/v2/me");
          expect(baselineControl.status()).toBe(200);
          expect(await baselineControl.json()).toEqual(expectedControl);
          const storedSession = await caseApp.db
            .prepare("select token from session where user_id = ?")
            .bind(account.userId)
            .first<{ token: string }>();
          expect(Boolean(storedSession?.token)).toBe(true);

          let schemaRenamed = false;
          try {
            // resolveAccess reads membership and ban, not account_role.
            // The production identity query reads it after the real guard.
            await caseApp.db.exec(
              "alter table person_profile rename column account_role to fault_account_role"
            );
            schemaRenamed = true;

            const failure = await signedInRequest.get("/api/v2/me");
            expect(failure.status()).toBe(500);
            expect(failure.headers()["cache-control"]).toBe(
              "private, no-store"
            );
            expect(failure.headers().location).toBeUndefined();
            expect(await failure.json()).toEqual({
              error: {
                code: "internal_error",
                message: "系統暫時無法完成請求，請稍後再試。",
              },
            });

            const unaffectedControl = await controlRequest.get("/api/v2/me");
            expect(unaffectedControl.status()).toBe(200);
            expect(await unaffectedControl.json()).toEqual(expectedControl);
            const messages = caseApp.server
              .getLogs()
              .map(({ message }) => message);
            const sessionToken = storedSession?.token ?? "";
            expect(messages.includes("Authentication library event")).toBe(
              true
            );
            expect(messages.includes("Unexpected business API failure")).toBe(
              true
            );
            const exposesSchemaDiagnostic = messages.some(
              (message) =>
                message.includes("Failed query") ||
                message.includes("fault_account_role") ||
                message.includes("no such column")
            );
            expect(exposesSchemaDiagnostic).toBe(false);
            expect(
              messages.some(
                (message) =>
                  sessionToken.length > 0 && message.includes(sessionToken)
              )
            ).toBe(false);
          } finally {
            if (schemaRenamed) {
              await caseApp.db.exec(
                "alter table person_profile rename column fault_account_role to account_role"
              );
            }
          }

          const recovered = await signedInRequest.get("/api/v2/me");
          expect(recovered.status()).toBe(200);
          expect(await recovered.json()).toEqual({
            data: {
              displayName: account.fullName,
              membershipStatus: "active",
              username: account.username,
            },
          });
        } finally {
          await controlRequest.dispose();
        }
      }
    );

    test(
      "auth session read failure stays generic and recovers after schema restore",
      { tag: ["@http", "@risk-auth", "@risk-recovery", "@risk-privacy"] },
      async ({ account, caseApp, signedInRequest }) => {
        const storedSession = await caseApp.db
          .prepare("select token from session where user_id = ?")
          .bind(account.userId)
          .first<{ token: string }>();
        expect(Boolean(storedSession?.token)).toBe(true);
        const sessionToken = storedSession?.token ?? "";
        let schemaRenamed = false;
        try {
          await caseApp.db.exec(
            "alter table session rename to session_auth_fault"
          );
          schemaRenamed = true;

          const failure = await signedInRequest.get("/api/auth/get-session");
          expect(failure.status()).toBe(500);
          expect(failure.headers()["cache-control"]).toContain("no-store");
          expect(failure.headers().location).toBeUndefined();
          expect(await failure.json()).toEqual({
            code: "INTERNAL_SERVER_ERROR",
            message: "系統暫時無法完成驗證，請稍後再試。",
          });
          const messages = caseApp.server
            .getLogs()
            .map(({ message }) => message);
          expect(messages.includes("Authentication library event")).toBe(true);
          expect(messages.includes("Authentication request failed")).toBe(true);
          const exposesSchemaDiagnostic = messages.some(
            (message) =>
              message.includes("Failed query") ||
              message.includes("session_auth_fault") ||
              message.includes("no such table")
          );
          expect(exposesSchemaDiagnostic).toBe(false);
          expect(
            messages.some(
              (message) =>
                sessionToken.length > 0 && message.includes(sessionToken)
            )
          ).toBe(false);
        } finally {
          if (schemaRenamed) {
            await caseApp.db.exec(
              "alter table session_auth_fault rename to session"
            );
          }
        }

        const recovered = await signedInRequest.get("/api/auth/get-session");
        expect(recovered.status()).toBe(200);
        expect(Boolean(await recovered.json())).toBe(true);
      }
    );

    test(
      "injected local D1 read failure shows generic unavailable recovery",
      {
        tag: [
          "@browser",
          "@mobile-critical",
          "@risk-privacy",
          "@risk-recovery",
        ],
      },
      async ({ account, caseApp, signedInPage: page }) => {
        await seedHomeReadRows(caseApp.db, account.userId);
        let schemaRenamed = false;
        const reload = page.getByRole("button", {
          exact: true,
          name: "重新載入",
        });
        try {
          await caseApp.db.exec(
            "alter table program_event rename to program_event_fault"
          );
          schemaRenamed = true;

          await page.goto("/");
          await expect(
            page.getByRole("heading", { name: "暫時未能載入主頁" })
          ).toBeVisible();
          await expect(page.getByRole("alert")).toContainText(
            "系統暫時無法載入資料"
          );
          const navigation = page.getByRole("navigation", { name: "主要導覽" });
          await expect(navigation).toBeVisible();
          await Promise.all(
            ["主頁", "收件匣", "帳戶"].map((label) =>
              expect(
                navigation.getByRole("link", { exact: true, name: label })
              ).toBeVisible()
            )
          );
          await expect(
            navigation.getByRole("link", { exact: true, name: "管理" })
          ).toHaveCount(0);
          const body = (await page.locator("body").textContent()) ?? "";
          expect(body.toLowerCase()).not.toContain("no such table");
          expect(body).not.toContain("program_event");

          await qualifyPresentation(page, test.info(), "home-read-failure", {
            criticalAction: reload,
            drafts: page.locator("input[id]:not([type=hidden]), textarea[id]"),
            focus: reload,
          });
        } finally {
          if (schemaRenamed) {
            await caseApp.db.exec(
              "alter table program_event_fault rename to program_event"
            );
          }
        }

        await reload.click();
        await expect(
          page.getByRole("heading", { name: "我的主頁" })
        ).toBeVisible();
      }
    );

    test(
      "a status read failure exposes no SQL and retry reloads current status",
      {
        tag: [
          "@browser",
          "@mobile-critical",
          "@risk-privacy",
          "@risk-recovery",
        ],
      },
      async ({ caseApp, signedInPage: page, signedInRequest }) => {
        let schemaRenamed = false;
        const reload = page.getByRole("button", {
          exact: true,
          name: "重新載入",
        });
        try {
          await caseApp.db.exec(
            "alter table person_profile rename column account_role to fault_account_role"
          );
          schemaRenamed = true;

          const response = await signedInRequest.get("/status");
          expect(response.status()).toBe(200);
          const html = await response.text();
          expect(html).not.toContain("Failed query");
          expect(html).not.toContain("account_role");
          expect(html).not.toContain("no such column");

          await page.goto("/status");
          await expect(
            page.getByRole("heading", { name: "暫時未能載入帳戶狀態" })
          ).toBeVisible();
          await expect(reload).toBeVisible();
          const body = (await page.locator("body").textContent()) ?? "";
          expect(body).not.toContain("Failed query");
          expect(body).not.toContain("account_role");
          expect(body).not.toContain("no such column");

          await qualifyPresentation(page, test.info(), "status-read-failure", {
            criticalAction: reload,
            drafts: page.locator("input[id]:not([type=hidden]), textarea[id]"),
            focus: reload,
          });
        } finally {
          if (schemaRenamed) {
            await caseApp.db.exec(
              "alter table person_profile rename column fault_account_role to account_role"
            );
          }
        }

        await reload.click();
        await expect(
          page.getByRole("heading", { name: "帳戶狀態" })
        ).toBeVisible();
        await expect(
          page.getByRole("link", { name: /返回帳戶/u })
        ).toBeVisible();
      }
    );
  }
);
