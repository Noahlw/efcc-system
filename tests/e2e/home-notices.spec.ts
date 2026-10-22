/* eslint-disable no-await-in-loop -- Revocation transitions must be committed and observed in order on each first response. */
import type { Page } from "@playwright/test";
import { drizzle } from "drizzle-orm/d1";

import {
  getChurchDateKey,
  getChurchWeekDates,
} from "@/shared/time/church-time";

import {
  buildAuthorizedNoticeCursorQuery,
  buildVisibleNoticeQuery,
  getVisibleNoticePage,
} from "../../src/features/home/notices";
import type { Database } from "../../src/server/db/client";
import * as activitySchema from "../../src/server/db/schema/activities";
import * as noticeSchema from "../../src/server/db/schema/notices";
import { dedicatedTest, expect } from "../support/home";

const region = (page: Page) => page.getByRole("region", { name: "教會消息" });

/** Observe the first document: locator polling must not hide an earlier leak. */
const reloadHomeHtml = async (page: Page): Promise<string> => {
  const response = await page.reload();
  if (!response) {
    throw new Error("Home reload produced no document response");
  }
  return response.text();
};

dedicatedTest.describe(
  "Home notices",
  { tag: ["@native", "@browser", "@risk-authority", "@risk-privacy", "@home"] },
  () => {
    dedicatedTest(
      "church notices reach everyone while unpublished and expired ones stay out",
      async ({ homePages }) => {
        const page = homePages["ng.wing.yan"];
        await page.goto("/");
        await expect(region(page).getByText("教會週報")).toBeVisible();
        for (const title of [
          "未發佈通告",
          "已過期通告",
          "敬拜部消息",
          "關顧部消息",
          "主日崇拜消息",
        ]) {
          await expect(region(page).getByText(title)).toHaveCount(0);
        }
      }
    );
    dedicatedTest(
      "an assigned Department Manager sees the notice without membership",
      async ({ homePages }) => {
        const page = homePages["wong.tai.ming"];
        await page.goto("/");
        for (const title of ["教會週報", "敬拜部消息", "主日崇拜消息"]) {
          await expect(region(page).getByText(title)).toBeVisible();
        }
        await expect(region(page).getByText("關顧部消息")).toHaveCount(0);
      }
    );
    dedicatedTest(
      "a Department member and a Program enrolee each see their own scope",
      async ({ homePages }) => {
        let page = homePages["Chan.Siu.Fong"];
        await page.goto("/");
        await expect(region(page).getByText("敬拜部消息")).toBeVisible();
        await expect(region(page).getByText("主日崇拜消息")).toHaveCount(0);
        expect(await reloadHomeHtml(page)).not.toContain("主日崇拜消息");
        await expect(region(page).getByText("關顧部消息")).toHaveCount(0);
        page = homePages["chen.simplified"];
        await page.goto("/");
        await expect(region(page).getByText("主日崇拜消息")).toBeVisible();
        for (const title of ["敬拜部消息", "關顧部消息"]) {
          await expect(region(page).getByText(title)).toHaveCount(0);
        }
      }
    );
    dedicatedTest(
      "withdrawing the assignment removes only that notice scope",
      async ({ homePages, caseApp }) => {
        const page = homePages["wong.tai.ming"];
        await page.goto("/");
        await expect(region(page).getByText("敬拜部消息")).toBeVisible();
        await expect(
          page.getByRole("region", { name: "即將參與" })
        ).toContainText("主日崇拜");
        await caseApp.db
          .prepare("delete from department_manager_assignment where id = ?")
          .bind("mgr-worship-wong")
          .run();
        await page.reload();
        await expect(region(page).getByText("敬拜部消息")).toHaveCount(0);
        for (const title of ["教會週報", "主日崇拜消息"]) {
          await expect(region(page).getByText(title)).toBeVisible();
        }
        await expect(
          page.getByRole("region", { name: "即將參與" })
        ).toContainText("主日崇拜");
      }
    );
    dedicatedTest(
      "an inactive enrolment removes Program-notice scope on the next response",
      async ({ homePages, caseApp }) => {
        const page = homePages["chen.simplified"];
        await page.goto("/");
        await expect(region(page).getByText("主日崇拜消息")).toBeVisible();
        await expect(region(page).getByText("教會週報")).toBeVisible();
        for (const status of ["withdrawn", "rejected", "cancelled"]) {
          await caseApp.db
            .prepare("update enrolment set status = ? where id = ?")
            .bind(status, "enr-sunday-chen")
            .run();
          const html = await reloadHomeHtml(page);
          expect(html).not.toContain("主日崇拜消息");
          expect(html).toContain("教會週報");
        }
      }
    );
    dedicatedTest(
      "a Department manager keeps Program-notice scope despite an inactive enrolment",
      async ({ homePages, caseApp }) => {
        const page = homePages["wong.tai.ming"];
        await page.goto("/");
        await expect(region(page).getByText("主日崇拜消息")).toBeVisible();
        await caseApp.db
          .prepare("update enrolment set status = 'withdrawn' where id = ?")
          .bind("enr-sunday-wong")
          .run();
        const html = await reloadHomeHtml(page);
        for (const title of ["主日崇拜消息", "教會週報", "青年小組"]) {
          expect(html).toContain(title);
        }
      }
    );
    dedicatedTest(
      "Home notices page all authorized content across more than 100 overlapping scopes",
      {
        tag: [
          "@native",
          "@browser",
          "@mobile-critical",
          "@risk-authority",
          "@risk-privacy",
          "@home",
        ],
      },
      async ({ caseApp, home, homePages }) => {
        const account = home.accounts["ng.wing.yan"];
        const actor = await caseApp.db
          .prepare("select id from user where username = ?")
          .bind(account.username)
          .first<{ id: string }>();
        if (!actor) {
          throw new Error("Missing synthetic Home notice actor");
        }

        const now = new Date();
        const queryDb = drizzle(caseApp.db, {
          schema: { ...activitySchema, ...noticeSchema },
        }) as unknown as Database;
        const emptyScopeSql = buildVisibleNoticeQuery(
          queryDb,
          actor.id,
          now,
          null
        ).toSQL();
        const emptyCursorSql = buildAuthorizedNoticeCursorQuery(
          queryDb,
          actor.id,
          now,
          "notice-church-welcome"
        ).toSQL();
        const emptyScopePage = await getVisibleNoticePage(
          queryDb,
          actor.id,
          now,
          null
        );
        expect(
          emptyScopePage.items.every((entry) => entry.scope === "church")
        ).toBe(true);

        const scopeIds = Array.from(
          { length: 120 },
          (_, index) => `notice-d22-scope-${String(index).padStart(3, "0")}`
        );
        const publishedAt = Math.floor(Date.now() / 1000) - 30;
        const scopeWrites = scopeIds.map((id, index) =>
          caseApp.db
            .prepare(
              "insert into department (id,name,created_at) values (?,?,?)"
            )
            .bind(
              id,
              `D22 scope ${String(index).padStart(3, "0")}`,
              publishedAt
            )
        );
        const membershipWrites = scopeIds.map((departmentId, index) =>
          caseApp.db
            .prepare(
              "insert into department_membership (id,department_id,user_id,created_at) values (?,?,?,?)"
            )
            .bind(
              `notice-d22-membership-${String(index).padStart(3, "0")}`,
              departmentId,
              actor.id,
              publishedAt
            )
        );
        const overlappingAssignments = scopeIds
          .slice(0, 30)
          .map((departmentId, index) =>
            caseApp.db
              .prepare(
                "insert into department_manager_assignment (id,department_id,user_id,created_at) values (?,?,?,?)"
              )
              .bind(
                `notice-d22-assignment-${String(index).padStart(3, "0")}`,
                departmentId,
                actor.id,
                publishedAt
              )
          );
        const noticeTitles = Array.from(
          { length: 27 },
          (_, index) => `D22 notice ${String(index).padStart(3, "0")}`
        );
        const noticeWrites = noticeTitles.map((title, index) =>
          caseApp.db
            .prepare(
              "insert into notice (id,title,body,scope_type,scope_id,created_at,published_at) values (?,?,?,'department',?,?,?)"
            )
            .bind(
              `notice-d22-${String(index).padStart(3, "0")}`,
              title,
              `D22 synthetic body ${String(index).padStart(3, "0")}`,
              scopeIds[index],
              publishedAt,
              publishedAt
            )
        );
        await caseApp.db.batch([
          ...scopeWrites,
          ...membershipWrites,
          ...overlappingAssignments,
          ...noticeWrites,
        ]);
        const largeScopeSql = buildVisibleNoticeQuery(
          queryDb,
          actor.id,
          now,
          null
        ).toSQL();
        const largeCursorSql = buildAuthorizedNoticeCursorQuery(
          queryDb,
          actor.id,
          now,
          "notice-church-welcome"
        ).toSQL();
        expect(largeScopeSql.sql).toBe(emptyScopeSql.sql);
        expect(largeScopeSql.params).toEqual(emptyScopeSql.params);
        expect(largeScopeSql.params).toHaveLength(15);
        expect(
          largeScopeSql.params.filter((value) =>
            ["church", "department", "program"].includes(String(value))
          )
        ).toHaveLength(5);
        expect(
          largeScopeSql.params.filter((value) => value === actor.id)
        ).toHaveLength(4);
        expect(
          largeScopeSql.params.filter((value) =>
            ["approved", "pending", "waitlisted"].includes(String(value))
          )
        ).toHaveLength(3);
        expect(
          largeScopeSql.params.filter((value) => value === 26)
        ).toHaveLength(1);
        expect(
          largeScopeSql.params.filter((value) => typeof value === "number")
        ).toHaveLength(3);
        expect(scopeIds.some((id) => largeScopeSql.params.includes(id))).toBe(
          false
        );
        expect(largeCursorSql.sql).toBe(emptyCursorSql.sql);
        expect(largeCursorSql.params).toEqual(emptyCursorSql.params);
        expect(largeCursorSql.params).toHaveLength(14);
        expect(
          largeCursorSql.params.filter((value) =>
            ["church", "department", "program"].includes(String(value))
          )
        ).toHaveLength(3);
        expect(
          largeCursorSql.params.filter((value) => value === actor.id)
        ).toHaveLength(4);
        expect(
          largeCursorSql.params.filter((value) =>
            ["approved", "pending", "waitlisted"].includes(String(value))
          )
        ).toHaveLength(3);
        expect(
          largeCursorSql.params.filter(
            (value) => value === "notice-church-welcome"
          )
        ).toHaveLength(1);
        expect(
          largeCursorSql.params.filter((value) => value === 1)
        ).toHaveLength(1);
        expect(
          largeCursorSql.params.filter((value) => typeof value === "number")
        ).toHaveLength(3);
        expect(scopeIds.some((id) => largeCursorSql.params.includes(id))).toBe(
          false
        );

        const [nextWeek] = getChurchWeekDates(getChurchDateKey(new Date()), 2);
        if (!nextWeek) {
          throw new Error("Missing synthetic Home notice date");
        }
        const page = homePages["ng.wing.yan"];
        await page.goto(`/?date=${nextWeek}`);
        const entries = region(page).locator("details");
        await expect(entries).toHaveCount(25);
        const firstPageTitles = await region(page)
          .locator("summary")
          .allTextContents();
        expect(firstPageTitles).toEqual(noticeTitles.slice(2).toReversed());

        const firstNotice = entries.filter({ hasText: "D22 notice 026" });
        await firstNotice.locator("summary").click();
        await expect(firstNotice).toContainText("D22 synthetic body 026");
        await expect(firstNotice).toContainText("D22 scope 026");
        await expect(firstNotice.locator("time")).toBeVisible();
        const dateUrl = new URL(page.url());
        expect(dateUrl.searchParams.get("date")).toBe(nextWeek);

        const nextBatch = region(page).getByRole("button", {
          name: "載入更多教會消息",
        });
        await expect(nextBatch).toBeVisible();
        const nextHref = await nextBatch.getAttribute("href");
        expect(nextHref).not.toBeNull();
        const nextUrl = new URL(nextHref ?? "", page.url());
        expect(nextUrl.searchParams.get("date")).toBe(nextWeek);
        expect(nextUrl.searchParams.get("noticeAfter")).toBe("notice-d22-002");
        expect(nextUrl.hash).toBe("#notices");
        await nextBatch.click();
        await expect(entries).toHaveCount(3);
        const secondPageTitles = await region(page)
          .locator("summary")
          .allTextContents();
        expect(secondPageTitles).toEqual([
          "D22 notice 001",
          "D22 notice 000",
          "教會週報",
        ]);
        expect(new Set([...firstPageTitles, ...secondPageTitles]).size).toBe(
          28
        );

        await page.goto(`/?date=${nextWeek}&noticeAfter=notice-d22-missing`);
        await expect(entries).toHaveCount(25);
        const normalizedUrl = new URL(page.url());
        expect(normalizedUrl.searchParams.get("noticeAfter")).toBeNull();
        expect(normalizedUrl.searchParams.get("date")).toBe(nextWeek);

        await page.goto(
          `/?date=${nextWeek}&noticeAfter=notice-d22-002&noticeAfter=notice-d22-001`
        );
        await expect(entries).toHaveCount(25);
        const repeatedCursorUrl = new URL(page.url());
        expect(repeatedCursorUrl.searchParams.getAll("noticeAfter")).toEqual(
          []
        );
        expect(repeatedCursorUrl.searchParams.get("date")).toBe(nextWeek);

        const unauthorizedPage = homePages["Chan.Siu.Fong"];
        await unauthorizedPage.goto(
          `/?date=${nextWeek}&noticeAfter=notice-d22-026`
        );
        await expect(
          region(unauthorizedPage).getByText("D22 notice 026")
        ).toHaveCount(0);
        const unauthorizedUrl = new URL(unauthorizedPage.url());
        expect(unauthorizedUrl.searchParams.get("noticeAfter")).toBeNull();
      }
    );
    dedicatedTest(
      "reading notices never mutates business rows",
      async ({ homePages, caseApp }) => {
        const page = homePages["wong.tai.ming"];
        await page.goto("/");
        const sql =
          "select (select count(*) from enrolment) as enrolments, (select count(*) from invitation) as invitations, (select count(*) from notice) as notices";
        const before = await caseApp.db.prepare(sql).first();
        await page.reload();
        await expect(region(page).getByText("教會週報")).toBeVisible();
        expect(await caseApp.db.prepare(sql).first()).toEqual(before);
      }
    );
    dedicatedTest(
      "a Program notice keeps its own label when a Department shares its ID",
      async ({ homePages, caseApp }) => {
        await caseApp.db
          .prepare(
            "insert into program (id,department_id,name,created_at) values ('dept-worship','dept-care','跨資料表節目',unixepoch())"
          )
          .run();
        await caseApp.db
          .prepare(
            "insert into enrolment (id,program_id,user_id,status,created_at,updated_at) select 'enr-colliding-scope-chen','dept-worship',id,'approved',unixepoch(),unixepoch() from user where username = 'chen.simplified'"
          )
          .run();
        await caseApp.db
          .prepare(
            "insert into notice (id,title,body,scope_type,scope_id,created_at,published_at) values ('notice-colliding-program-scope','同 ID 範圍通告','僅此節目參與者可讀。','program','dept-worship',unixepoch(),unixepoch()-1)"
          )
          .run();
        const page = homePages["chen.simplified"];
        await page.goto("/");
        const entry = region(page).locator("details", {
          hasText: "同 ID 範圍通告",
        });
        await expect(entry).toContainText("跨資料表節目");
        await expect(entry).not.toContainText("敬拜部");
      }
    );
    dedicatedTest(
      "a malformed church target stays hidden even when SQL checks are bypassed",
      async ({ homePages, caseApp }) => {
        await caseApp.db.exec("PRAGMA ignore_check_constraints = ON;");
        await caseApp.db
          .prepare(
            "insert into notice (id,title,body,scope_type,scope_id,created_at,published_at) values ('notice-invalid-church-target','不完整範圍通告','不應顯示的內容','church','dept-care',unixepoch(),unixepoch()-60)"
          )
          .run();
        await caseApp.db.exec("PRAGMA ignore_check_constraints = OFF;");
        const page = homePages["ng.wing.yan"];
        await page.goto("/");
        await expect(region(page).getByText("不完整範圍通告")).toHaveCount(0);
        expect(await reloadHomeHtml(page)).not.toContain("不應顯示的內容");
      }
    );
  }
);
