/* eslint-disable no-await-in-loop -- Revocation transitions must be committed and observed in order on each first response. */
import type { Page } from "@playwright/test";

import { test, expect } from "../support/home";

const region = (page: Page) => page.getByRole("region", { name: "教會消息" });

/** Observe the first document: locator polling must not hide an earlier leak. */
const reloadHomeHtml = async (page: Page): Promise<string> => {
  const response = await page.reload();
  if (!response) {
    throw new Error("Home reload produced no document response");
  }
  return response.text();
};

test.describe(
  "Home notices",
  { tag: ["@native", "@browser", "@risk-authority", "@risk-privacy", "@home"] },
  () => {
    test("church notices reach everyone while unpublished and expired ones stay out", async ({
      homePages,
    }) => {
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
    });
    test("an assigned Department Manager sees the notice without membership", async ({
      homePages,
    }) => {
      const page = homePages["wong.tai.ming"];
      await page.goto("/");
      for (const title of ["教會週報", "敬拜部消息", "主日崇拜消息"]) {
        await expect(region(page).getByText(title)).toBeVisible();
      }
      await expect(region(page).getByText("關顧部消息")).toHaveCount(0);
    });
    test("a Department member and a Program enrolee each see their own scope", async ({
      homePages,
    }) => {
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
    });
    test("withdrawing the assignment removes only that notice scope", async ({
      homePages,
      caseApp,
    }) => {
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
    });
    test("an inactive enrolment removes Program-notice scope on the next response", async ({
      homePages,
      caseApp,
    }) => {
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
    });
    test("a Department manager keeps Program-notice scope despite an inactive enrolment", async ({
      homePages,
      caseApp,
    }) => {
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
    });
    test("reading notices never mutates business rows", async ({
      homePages,
      caseApp,
    }) => {
      const page = homePages["wong.tai.ming"];
      await page.goto("/");
      const sql =
        "select (select count(*) from enrolment) as enrolments, (select count(*) from invitation) as invitations, (select count(*) from notice) as notices";
      const before = await caseApp.db.prepare(sql).first();
      await page.reload();
      await expect(region(page).getByText("教會週報")).toBeVisible();
      expect(await caseApp.db.prepare(sql).first()).toEqual(before);
    });
    test("a Program notice keeps its own label when a Department shares its ID", async ({
      homePages,
      caseApp,
    }) => {
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
    });
    test("a malformed church target stays hidden even when SQL checks are bypassed", async ({
      homePages,
      caseApp,
    }) => {
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
    });
  }
);
