import { buildActivityFixtures } from "../scenarios/activities";
import { buildNoticeFixtures } from "../scenarios/notices";
import { dedicatedTest, expect } from "../support/fixtures";
import type { NativeApp } from "../support/fixtures";
import { qualifyPresentation } from "./presentation-assertions";

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

const toUnixSeconds = (date: string | undefined): number | null =>
  date ? Math.floor(Date.parse(date) / 1000) : null;

/** Seed only valid rows needed to exercise each original D1 CHECK constraint. */
const seedConstraintRows = async (db: NativeApp["db"], userId: string) => {
  const activities = buildActivityFixtures();
  const notices = buildNoticeFixtures();
  const now = Math.floor(Date.now() / 1000);
  const department = fixtureById(activities.departments, "dept-worship");
  const program = fixtureById(activities.programs, "prog-sunday-service");
  const enrolment = fixtureById(activities.enrolments, "enr-sunday-wong");
  const invitation = fixtureById(activities.invitations, "inv-sunday-chan");
  const noticeRows = [
    fixtureById(notices.notices, "notice-church-welcome"),
    fixtureById(notices.notices, "notice-worship-department"),
    fixtureById(notices.notices, "notice-sunday-program"),
  ];

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
    db
      .prepare(
        "insert into invitation (created_at, expires_at, id, program_id, state, user_id) values (?, ?, ?, ?, ?, ?)"
      )
      .bind(
        now,
        toUnixSeconds(invitation.expiresAt),
        invitation.id,
        invitation.programId,
        invitation.state,
        userId
      ),
    ...noticeRows.map((notice) =>
      db
        .prepare(
          "insert into notice (body, created_at, expires_at, id, published_at, scope_id, scope_type, title) values (?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(
          notice.body,
          now,
          toUnixSeconds(notice.expiresAt),
          notice.id,
          toUnixSeconds(notice.publishedAt),
          notice.scopeId ?? null,
          notice.scopeType,
          notice.title
        )
    ),
  ]);
};

dedicatedTest.describe(
  "guard-failures",
  { tag: ["@native", "@guard-failures"] },
  () => {
    dedicatedTest(
      "Home domain writes reject invalid states and notice targets",
      { tag: ["@http", "@risk-atomicity"] },
      async ({ account, caseApp }) => {
        await seedConstraintRows(caseApp.db, account.userId);

        const invalidWrites = [
          {
            check: "enrolment_status_check",
            expected: "approved",
            read: caseApp.db
              .prepare("select status as value from enrolment where id = ?")
              .bind("enr-sunday-wong"),
            write: caseApp.db
              .prepare("update enrolment set status = ? where id = ?")
              .bind("unknown", "enr-sunday-wong"),
          },
          {
            check: "invitation_state_check",
            expected: "valid",
            read: caseApp.db
              .prepare("select state as value from invitation where id = ?")
              .bind("inv-sunday-chan"),
            write: caseApp.db
              .prepare("update invitation set state = ? where id = ?")
              .bind("unknown", "inv-sunday-chan"),
          },
          {
            check: "notice_scope_type_check",
            expected: "church",
            read: caseApp.db
              .prepare("select scope_type as value from notice where id = ?")
              .bind("notice-church-welcome"),
            write: caseApp.db
              .prepare("update notice set scope_type = ? where id = ?")
              .bind("unknown", "notice-church-welcome"),
          },
          {
            check: "notice_scope_target_check",
            expected: null,
            read: caseApp.db
              .prepare("select scope_id as value from notice where id = ?")
              .bind("notice-church-welcome"),
            write: caseApp.db
              .prepare("update notice set scope_id = ? where id = ?")
              .bind("wrong-target", "notice-church-welcome"),
          },
          {
            check: "notice_scope_target_check",
            expected: "dept-worship",
            read: caseApp.db
              .prepare("select scope_id as value from notice where id = ?")
              .bind("notice-worship-department"),
            write: caseApp.db
              .prepare("update notice set scope_id = ? where id = ?")
              .bind(null, "notice-worship-department"),
          },
          {
            check: "notice_scope_target_check",
            expected: "prog-sunday-service",
            read: caseApp.db
              .prepare("select scope_id as value from notice where id = ?")
              .bind("notice-sunday-program"),
            write: caseApp.db
              .prepare("update notice set scope_id = ? where id = ?")
              .bind("", "notice-sunday-program"),
          },
        ];

        /* eslint-disable no-await-in-loop -- Verify each D1 rollback before the next independent fault. */
        for (const invalid of invalidWrites) {
          await expect(invalid.write.run()).rejects.toThrow(invalid.check);
          const row = await invalid.read.first<{ value: string | null }>();
          expect(row?.value).toBe(invalid.expected);
        }
        /* eslint-enable no-await-in-loop */
      }
    );

    dedicatedTest(
      "normal D1 writes reject unsupported membership values",
      { tag: ["@http", "@risk-atomicity"] },
      async ({ account, caseApp }) => {
        await expect(
          caseApp.db
            .prepare(
              "update person_profile set membership_status = ? where user_id = ?"
            )
            .bind("member", account.userId)
            .run()
        ).rejects.toThrow("person_profile_membership_status_check");

        const row = await caseApp.db
          .prepare(
            "select membership_status from person_profile where user_id = ?"
          )
          .bind(account.userId)
          .first<{ membership_status: string }>();
        expect(row?.membership_status).toBe("active");
      }
    );

    dedicatedTest(
      "unsupported membership fails closed until corrected",
      { tag: ["@http", "@risk-auth", "@risk-recovery"] },
      async ({ account, caseApp, signedInRequest }) => {
        try {
          // Only this fresh case-owned D1 bypasses CHECK for the unsupported stored value.
          await caseApp.db.exec(
            `PRAGMA ignore_check_constraints = ON;
             UPDATE person_profile SET membership_status = 'legacy_unknown';
             PRAGMA ignore_check_constraints = OFF;`
          );
          const stored = await caseApp.db
            .prepare(
              "select membership_status from person_profile where user_id = ?"
            )
            .bind(account.userId)
            .first<{ membership_status: string }>();
          expect(stored?.membership_status).toBe("legacy_unknown");

          const home = await signedInRequest.get("/", { maxRedirects: 0 });
          expect(home.status()).toBe(307);
          expect(home.headers().location).toBe("/status");

          const business = await signedInRequest.get("/api/v2/me");
          expect(business.status()).toBe(403);
          expect(await business.json()).toEqual({
            error: {
              code: "business_access_denied",
              message: "你的帳戶目前無法使用教會功能。",
            },
          });

          const status = await signedInRequest.get("/api/v2/status");
          expect(status.status()).toBe(200);
          expect(await status.json()).toEqual({
            data: {
              accessAllowed: false,
              displayName: account.fullName,
              reasons: ["profile_missing"],
            },
          });

          await caseApp.db.exec(
            `PRAGMA ignore_check_constraints = ON;
             UPDATE person_profile SET banned_at = unixepoch();
             PRAGMA ignore_check_constraints = OFF;`
          );
          const combinedStatus = await signedInRequest.get("/api/v2/status");
          expect(await combinedStatus.json()).toMatchObject({
            data: { reasons: ["security_ban", "profile_missing"] },
          });
        } finally {
          await caseApp.db.exec(
            `PRAGMA ignore_check_constraints = ON;
             UPDATE person_profile SET membership_status = 'active', banned_at = NULL;
             PRAGMA ignore_check_constraints = OFF;`
          );
        }

        const restored = await caseApp.db
          .prepare(
            "select banned_at, membership_status from person_profile where user_id = ?"
          )
          .bind(account.userId)
          .first<{ banned_at: number | null; membership_status: string }>();
        expect(restored).toEqual({
          banned_at: null,
          membership_status: "active",
        });

        const recovered = await signedInRequest.get("/api/v2/me");
        expect(recovered.status()).toBe(200);
        expect(await recovered.json()).toEqual({
          data: {
            displayName: account.fullName,
            membershipStatus: "active",
            username: account.username,
          },
        });
      }
    );

    dedicatedTest(
      "an access-guard D1 fault yields a typed API error and the retry page",
      { tag: ["@browser", "@mobile-critical", "@risk-auth", "@risk-recovery"] },
      async ({ account, caseApp, signedInPage: page, signedInRequest }) => {
        const reload = page.getByRole("button", {
          exact: true,
          name: "重新載入",
        });
        let schemaRenamed = false;
        try {
          await caseApp.db.exec(
            "alter table session rename to session_guard_fault"
          );
          schemaRenamed = true;

          const api = await signedInRequest.get("/api/v2/status");
          expect(api.status()).toBe(500);
          expect(api.headers()["cache-control"]).toBe("private, no-store");
          expect(api.headers().location).toBeUndefined();
          expect(await api.json()).toEqual({
            error: {
              code: "internal_error",
              message: "系統暫時無法完成請求，請稍後再試。",
            },
          });

          const home = await signedInRequest.get("/", { maxRedirects: 0 });
          expect(home.status()).toBe(307);
          expect(home.headers().location).toMatch(
            /\/unavailable\?returnTo=%2F$/u
          );
          expect(home.headers()["cache-control"]).toBe("private, no-store");

          const statusPage = await signedInRequest.get("/status", {
            maxRedirects: 0,
          });
          expect(statusPage.status()).toBe(307);
          expect(statusPage.headers().location).toMatch(
            /\/unavailable\?returnTo=%2Fstatus$/u
          );

          await page.goto("/");
          expect(new URL(page.url()).pathname).toBe("/unavailable");
          expect(new URL(page.url()).searchParams.get("returnTo")).toBe("/");
          await expect(reload).toBeVisible();
          await expect(
            page.getByRole("button", { name: "登出" })
          ).toBeVisible();
          await expect(
            page.getByRole("navigation", { name: "主要導覽" })
          ).toHaveCount(0);
          await expect(
            page.getByText(account.username, { exact: true })
          ).toHaveCount(0);
          const errorText = (await page.locator("body").textContent()) ?? "";
          expect(errorText).not.toContain("no such table");
          expect(errorText).not.toContain("session_guard_fault");
          expect(errorText).not.toContain("Failed query");

          await qualifyPresentation(
            page,
            dedicatedTest.info(),
            "guard-failure-unavailable",
            {
              criticalAction: reload,
              drafts: page.locator(
                "input[id]:not([type=hidden]), textarea[id]"
              ),
              focus: reload,
            }
          );
        } finally {
          if (schemaRenamed) {
            await caseApp.db.exec(
              "alter table session_guard_fault rename to session"
            );
          }
        }

        const recoveredApi = await signedInRequest.get("/api/v2/me");
        expect(recoveredApi.status()).toBe(200);
        expect(await recoveredApi.json()).toEqual({
          data: {
            displayName: account.fullName,
            membershipStatus: "active",
            username: account.username,
          },
        });

        await reload.click();
        await expect(page).toHaveURL(/\/$/u);
        await expect(
          page.getByRole("heading", { name: "我的主頁" })
        ).toBeVisible();
        await expect(
          page.getByText(`歡迎回來，${account.fullName}。`, { exact: true })
        ).toBeVisible();
        const navigation = page.getByRole("navigation", { name: "主要導覽" });
        await expect(
          navigation.getByRole("link", { name: "主頁" })
        ).toBeVisible();
        await expect(
          navigation.getByRole("link", { name: "帳戶" })
        ).toBeVisible();
        await expect(
          navigation.getByRole("link", { name: "管理" })
        ).toHaveCount(0);

        await page.setViewportSize({ height: 740, width: 320 });
        await page.evaluate(() => {
          document.documentElement.style.fontSize = "200%";
        });
        const mobileWidth = await page.evaluate(
          () => document.documentElement.scrollWidth
        );
        expect(mobileWidth).toBeLessThanOrEqual(320);

        await page.evaluate(() => {
          document.documentElement.style.fontSize = "16px";
        });
        await page.setViewportSize({ height: 900, width: 1440 });
        expect(
          await page.evaluate(
            () => getComputedStyle(document.documentElement).fontSize
          )
        ).toBe("16px");
        const desktopSidebar = await navigation.boundingBox();
        expect(desktopSidebar?.x).toBe(0);
        // Design Book app.css:28 specifies 15rem at the controlled 16px root.
        expect(desktopSidebar?.width).toBe(240);
        expect(desktopSidebar?.height).toBe(900);
      }
    );
  }
);
