import { randomUUID } from "node:crypto";

import type { APIResponse } from "@playwright/test";

import { storedStaffAccountOperationSchema } from "../../../src/features/account/assisted-accounts/staff-account-contract";
import {
  creation,
  credentialRow,
  dedicatedTest,
  expect,
  expectResponseStatus,
  issuedCredential,
  staffData,
  syntheticAccount,
} from "./fixtures";
import { openVisibilityStaffPage } from "./visibility-browser";

for (const { action, mode, radio, submit } of [
  {
    action: "staff_password_reset",
    mode: "reset",
    radio: /重設密碼，並使原有登入失效/u,
    submit: "確認並重設密碼及登出全部裝置",
  },
  {
    action: "temporary_password_reissued",
    mode: "reissue",
    radio: /重新發出臨時密碼/u,
    submit: "確認並重新發出臨時密碼",
  },
] as const) {
  dedicatedTest(
    `recovery ${mode} copy failure preserves the handover until real navigation disposes it without reissue`,
    {
      tag: [
        "@native",
        "@account-assisted",
        "@browser",
        "@risk-recovery",
        "@risk-privacy",
        "@risk-non-replay",
        "@mobile-critical",
      ],
    },
    async ({ caseApp, staff, staffPage: fixturePage }, testInfo) => {
      const created = issuedCredential(
        await staffData(
          await expectResponseStatus(
            staff.context.post("/api/v2/staff/accounts", { data: creation() }),
            201
          )
        )
      );
      const targetUserId = created.receipt?.targetUserId;
      if (!targetUserId) {
        throw new Error("The created recovery target has no receipt");
      }
      const before = await credentialRow(caseApp, targetUserId);
      if (!before) {
        throw new Error("The recovery target has no native credential");
      }
      const visibility = await openVisibilityStaffPage({
        fixturePage,
        origin: caseApp.origin,
        projectName: testInfo.project.name,
        projectOptions: {
          deviceScaleFactor: testInfo.project.use.deviceScaleFactor,
          hasTouch: testInfo.project.use.hasTouch,
          isMobile: testInfo.project.use.isMobile,
          screen: Reflect.get(testInfo.project.use, "screen") as
            | { height: number; width: number }
            | undefined,
          userAgent: testInfo.project.use.userAgent,
          viewport: testInfo.project.use.viewport,
        },
      });
      const { page } = visibility;
      const originalFetch = caseApp.harness.fetch;
      const nonce = randomUUID();
      let observation: {
        copyCount: string | null;
        hidden: string | null;
        outputCount: string | null;
      } | null = null;
      try {
        if (visibility.profileReadback) {
          expect(visibility.profileReadback).toEqual({
            clientHintMobileMatches: true,
            coarsePointerMatches: true,
            devicePixelRatioMatches: true,
            maxTouchPointsMatches: true,
            screenMatches: true,
            touchEventSupportMatches: true,
            userAgentMatches: testInfo.project.use.userAgent ? true : null,
            viewportMatches: true,
          });
        }
        await page.goto(
          new URL(
            `/staff/accounts?view=people&person=${targetUserId}&task=recovery`,
            caseApp.origin
          ).toString()
        );
        await page.getByRole("radio", { name: radio }).check();
        await page.getByLabel("已按以上方式核實身分", { exact: false }).check();
        await page
          .getByRole("button", { exact: true, name: "檢查資料" })
          .click();
        const responsePromise = page.waitForResponse(
          (response) =>
            response.request().method() === "POST" &&
            new URL(response.url()).pathname ===
              `/api/v2/staff/accounts/password-${mode}`
        );
        await page
          .getByRole("button", {
            exact: true,
            name: submit,
          })
          .click();
        const response = await responsePromise;
        expect(response.status()).toBe(201);
        const issued = issuedCredential(await staffData(response));
        const output = page.getByLabel("新臨時密碼", { exact: true });
        const copy = page.getByRole("button", {
          exact: true,
          name: "複製臨時密碼",
        });
        expect((await output.textContent()) === issued.temporaryPassword).toBe(
          true
        );
        await expect(copy).toBeVisible();
        const savedRaw = await page.evaluate(() =>
          localStorage.getItem("efcc.staff-account.operation.v1")
        );
        if (!savedRaw) {
          throw new Error("The reset lost its original operation reference");
        }
        const saved = storedStaffAccountOperationSchema.parse(
          JSON.parse(savedRaw)
        );
        expect(saved).toMatchObject({
          action,
          actorUserId: staff.userId,
          targetUserId,
        });
        expect(savedRaw.includes(issued.temporaryPassword)).toBe(false);
        const committed = await credentialRow(caseApp, targetUserId);
        expect(committed?.credential_revision).toBe(
          before.credential_revision + 1
        );
        expect(committed?.temporary_password_expires_at).toBe(
          issued.temporaryPasswordExpiresAt
        );

        await page.evaluate(() => {
          Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: {
              writeText: () =>
                Promise.reject(
                  new DOMException("Clipboard unavailable", "NotAllowedError")
                ),
            },
          });
        });
        await copy.click();
        await expect(
          page
            .getByRole("status")
            .filter({ hasText: "未能複製，請手動選取臨時密碼" })
        ).toBeVisible();
        expect((await output.textContent()) === issued.temporaryPassword).toBe(
          true
        );
        await output.selectText();
        expect(
          (await page.evaluate(() => window.getSelection()?.toString())) ===
            issued.temporaryPassword
        ).toBe(true);

        caseApp.harness.fetch = (requestInput, init) => {
          if (typeof requestInput === "string" && init instanceof Request) {
            const url = new URL(requestInput, caseApp.origin);
            if (
              init.method === "GET" &&
              url.pathname === "/api/v2/me" &&
              url.searchParams.get("__w12RecoveryHide") === nonce
            ) {
              observation = {
                copyCount: url.searchParams.get("copyCount"),
                hidden: url.searchParams.get("hidden"),
                outputCount: url.searchParams.get("outputCount"),
              };
            }
          }
          return originalFetch(requestInput, init);
        };
        await page.evaluate((token) => {
          document.addEventListener("visibilitychange", () => {
            if (!document.hidden) {
              return;
            }
            const query = new URLSearchParams({
              __w12RecoveryHide: token,
              copyCount: String(
                [...document.querySelectorAll("button")].filter(
                  (button) => button.textContent?.trim() === "複製臨時密碼"
                ).length
              ),
              hidden: String(document.hidden),
              outputCount: String(
                document.querySelectorAll('[aria-label="新臨時密碼"]').length
              ),
            });
            void fetch(`/api/v2/me?${query}`, {
              cache: "no-store",
              credentials: "same-origin",
              keepalive: true,
            }).catch(() => null);
          });
        }, nonce);
        expect(await page.evaluate(() => document.visibilityState)).toBe(
          "visible"
        );
        expect(observation).toBeNull();
        const navigation = await page.goto(
          new URL("/staff/accounts?view=people", caseApp.origin).toString()
        );
        expect(navigation?.status()).toBe(200);
        await expect(page).toHaveURL(
          (url) =>
            url.pathname === "/staff/accounts" &&
            url.searchParams.get("view") === "people"
        );
        await expect.poll(() => observation !== null).toBe(true);
        expect(observation).toEqual({
          copyCount: "0",
          hidden: "true",
          outputCount: "0",
        });
        expect(await credentialRow(caseApp, targetUserId)).toEqual(committed);
        const reconciled = await expectResponseStatus(
          staff.context.post("/api/v2/staff/accounts/reconcile", {
            data: { operationKey: saved.key },
          }),
          200
        );
        const receiptOnly = await staffData(reconciled);
        expect("temporaryPassword" in receiptOnly).toBe(false);
        expect(receiptOnly.receipt).toMatchObject({
          action,
          targetUserId,
        });
        expect(
          await caseApp.db
            .prepare(
              "SELECT count(*) AS count FROM staff_account_operation WHERE actor_user_id = ? AND target_user_id = ? AND action = ?"
            )
            .bind(staff.userId, targetUserId, action)
            .first<{ count: number }>()
        ).toEqual({ count: 1 });
      } finally {
        caseApp.harness.fetch = originalFetch;
        try {
          await testInfo.attach("recovery-real-hide-observation.json", {
            body: JSON.stringify(observation),
            contentType: "application/json",
          });
        } finally {
          await visibility.close?.();
        }
      }
    }
  );

  dedicatedTest(
    `a late recovery ${mode} response retains its original receipt but discards the credential after an actor switch`,
    {
      tag: [
        "@native",
        "@account-assisted",
        "@browser",
        "@risk-recovery",
        "@risk-privacy",
        "@risk-non-replay",
        "@mobile-critical",
      ],
    },
    async ({ caseApp, staff, staffPage: page }) => {
      const target = issuedCredential(
        await staffData(
          await expectResponseStatus(
            staff.context.post("/api/v2/staff/accounts", { data: creation() }),
            201
          )
        )
      );
      const targetUserId = target.receipt?.targetUserId;
      if (!targetUserId) {
        throw new Error("The recovery fixture has no target receipt");
      }
      const secondAccount = syntheticAccount("recovery-actor-switch", "staff");
      const secondActorUserId = await caseApp.provision.account(secondAccount);
      await page.goto(
        `/staff/accounts?view=people&person=${targetUserId}&task=recovery`
      );
      await page.getByRole("radio", { name: radio }).check();
      await page.getByLabel("已按以上方式核實身分", { exact: false }).check();
      await page.getByRole("button", { exact: true, name: "檢查資料" }).click();
      const committed = Promise.withResolvers<APIResponse>();
      const release = Promise.withResolvers<null>();
      const settled = Promise.withResolvers<null>();
      const endpoint = `**/api/v2/staff/accounts/password-${mode}`;
      let started = false;
      await page.route(endpoint, async (route) => {
        started = true;
        try {
          const response = await route.fetch();
          committed.resolve(response);
          await release.promise;
          await route.fulfill({ response });
        } catch (error) {
          committed.reject(error);
          await route.abort("failed");
        } finally {
          settled.resolve(null);
        }
      });
      try {
        const [, response] = await Promise.all([
          page.getByRole("button", { exact: true, name: submit }).click(),
          committed.promise,
        ]);
        expect(response.status()).toBe(201);
        const issued = issuedCredential(await staffData(response));
        const saved = storedStaffAccountOperationSchema.parse(
          JSON.parse(
            (await page.evaluate(() =>
              localStorage.getItem("efcc.staff-account.operation.v1")
            )) ?? "null"
          )
        );
        expect(saved).toMatchObject({
          action,
          actorUserId: staff.userId,
          targetUserId,
        });
        const committedCredential = await credentialRow(caseApp, targetUserId);
        expect(committedCredential?.temporary_password_expires_at).toBe(
          issued.temporaryPasswordExpiresAt
        );
        await expectResponseStatus(
          page.request.post("/api/auth/sign-in/username", {
            data: {
              password: secondAccount.password,
              username: secondAccount.username,
            },
          }),
          200
        );
        expect(
          await page.evaluate(async () => {
            const session = await fetch("/api/auth/get-session", {
              cache: "no-store",
              credentials: "same-origin",
            });
            return session.json();
          })
        ).toMatchObject({ user: { id: secondActorUserId } });
        expect(await page.evaluate(() => document.hidden)).toBe(false);
        release.resolve(null);
        await settled.promise;
        await expect(
          page.getByRole("heading", {
            exact: true,
            name: "臨時密碼不能再次顯示",
          })
        ).toBeVisible();
        await expect(
          page.getByLabel("新臨時密碼", { exact: true })
        ).toHaveCount(0);
        await expect(
          page.getByRole("button", { exact: true, name: "複製臨時密碼" })
        ).toHaveCount(0);
        await expect(
          page.getByText(issued.temporaryPassword, { exact: true })
        ).toHaveCount(0);
        const retained = await page.evaluate(() =>
          localStorage.getItem("efcc.staff-account.operation.v1")
        );
        expect(
          storedStaffAccountOperationSchema.parse(
            JSON.parse(retained ?? "null")
          )
        ).toEqual(saved);
        expect(retained?.includes(issued.temporaryPassword)).toBe(false);
        expect(await credentialRow(caseApp, targetUserId)).toEqual(
          committedCredential
        );
        const reconciled = await staffData(
          await expectResponseStatus(
            staff.context.post("/api/v2/staff/accounts/reconcile", {
              data: { operationKey: saved.key },
            }),
            200
          )
        );
        expect("temporaryPassword" in reconciled).toBe(false);
        expect(reconciled.receipt).toEqual(issued.receipt);
        expect(
          await caseApp.db
            .prepare(
              "SELECT count(*) AS count FROM staff_account_operation WHERE actor_user_id = ? AND target_user_id = ? AND action = ?"
            )
            .bind(staff.userId, targetUserId, action)
            .first<{ count: number }>()
        ).toEqual({ count: 1 });
      } finally {
        release.resolve(null);
        if (started) {
          await settled.promise;
        }
        await page.unroute(endpoint);
      }
    }
  );

  dedicatedTest(
    `a late recovery ${mode} response cannot cross a real task return and target transition`,
    {
      tag: [
        "@native",
        "@account-assisted",
        "@browser",
        "@risk-recovery",
        "@risk-privacy",
        "@risk-non-replay",
        "@mobile-critical",
      ],
    },
    async ({ caseApp, staff, staffPage: page }) => {
      const first = issuedCredential(
        await staffData(
          await expectResponseStatus(
            staff.context.post("/api/v2/staff/accounts", { data: creation() }),
            201
          )
        )
      );
      const otherInput = creation();
      const second = issuedCredential(
        await staffData(
          await expectResponseStatus(
            staff.context.post("/api/v2/staff/accounts", { data: otherInput }),
            201
          )
        )
      );
      const firstId = first.receipt?.targetUserId;
      const secondId = second.receipt?.targetUserId;
      if (!firstId || !secondId) {
        throw new Error("The target-transition fixtures have no receipts");
      }
      const untouched = await credentialRow(caseApp, secondId);
      await page.goto(
        `/staff/accounts?view=people&person=${firstId}&task=recovery`
      );
      const timeOrigin = await page.evaluate(() => performance.timeOrigin);
      await page.getByRole("radio", { name: radio }).check();
      await page.getByLabel("已按以上方式核實身分", { exact: false }).check();
      await page.getByRole("button", { exact: true, name: "檢查資料" }).click();
      const committed = Promise.withResolvers<APIResponse>();
      const release = Promise.withResolvers<null>();
      const settled = Promise.withResolvers<null>();
      const endpoint = `**/api/v2/staff/accounts/password-${mode}`;
      let started = false;
      await page.route(endpoint, async (route) => {
        started = true;
        try {
          const response = await route.fetch();
          committed.resolve(response);
          await release.promise;
          await route.fulfill({ response });
        } catch (error) {
          committed.reject(error);
          await route.abort("failed");
        } finally {
          settled.resolve(null);
        }
      });
      try {
        const [, response] = await Promise.all([
          page.getByRole("button", { exact: true, name: submit }).click(),
          committed.promise,
        ]);
        expect(response.status()).toBe(201);
        const issued = issuedCredential(await staffData(response));
        const savedRaw = await page.evaluate(() =>
          localStorage.getItem("efcc.staff-account.operation.v1")
        );
        const saved = storedStaffAccountOperationSchema.parse(
          JSON.parse(savedRaw ?? "null")
        );
        expect(saved).toMatchObject({
          action,
          actorUserId: staff.userId,
          targetUserId: firstId,
        });
        await page
          .getByRole("link", { exact: true, name: "返回帳戶詳情" })
          .click();
        const discard = page.getByRole("dialog");
        await expect(discard).toBeVisible();
        await discard.getByRole("button", { name: "放棄變更" }).click();
        await expect(page).toHaveURL(
          (url) =>
            url.searchParams.get("person") === firstId &&
            !url.searchParams.has("task")
        );
        await page.getByRole("link", { name: /返回帳戶列表/u }).click();
        await page
          .getByRole("link", { name: new RegExp(otherInput.username, "u") })
          .click();
        await expect(
          page.getByRole("region", { name: "操作對象" })
        ).toContainText(otherInput.fullName);
        await page.getByRole("link", { name: /帳戶復原/u }).click();
        await expect(page).toHaveURL(
          (url) =>
            url.searchParams.get("person") === secondId &&
            url.searchParams.get("task") === "recovery"
        );
        await expect(
          page.getByRole("heading", {
            exact: true,
            name: "臨時密碼不能再次顯示",
          })
        ).toBeVisible();
        expect(await page.evaluate(() => performance.timeOrigin)).toBe(
          timeOrigin
        );
        const delivered = page.waitForResponse(
          (candidate) =>
            candidate.request().method() === "POST" &&
            new URL(candidate.url()).pathname ===
              `/api/v2/staff/accounts/password-${mode}`
        );
        release.resolve(null);
        await settled.promise;
        const deliveredResponse = await delivered;
        expect(deliveredResponse.status()).toBe(201);
        await expect(
          page.getByRole("heading", {
            exact: true,
            name: "臨時密碼不能再次顯示",
          })
        ).toBeVisible();
        await expect(
          page.getByLabel("新臨時密碼", { exact: true })
        ).toHaveCount(0);
        await expect(
          page.getByText(issued.temporaryPassword, { exact: true })
        ).toHaveCount(0);
        expect(
          await page.evaluate(() =>
            localStorage.getItem("efcc.staff-account.operation.v1")
          )
        ).toBe(savedRaw);
        expect(await credentialRow(caseApp, secondId)).toEqual(untouched);
        const reconciled = await staffData(
          await expectResponseStatus(
            staff.context.post("/api/v2/staff/accounts/reconcile", {
              data: { operationKey: saved.key },
            }),
            200
          )
        );
        expect(reconciled.receipt).toEqual(issued.receipt);
        expect("temporaryPassword" in reconciled).toBe(false);
        expect(
          await caseApp.db
            .prepare(
              "SELECT count(*) AS count FROM staff_account_operation WHERE target_user_id = ? AND action = ?"
            )
            .bind(secondId, action)
            .first<{ count: number }>()
        ).toEqual({ count: 0 });
      } finally {
        release.resolve(null);
        if (started) {
          await settled.promise;
        }
        await page.unroute(endpoint);
      }
    }
  );
}
