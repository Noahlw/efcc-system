import type { Page } from "@playwright/test";

import { expect, test } from "../../support/fixtures";
import { qualifyPresentation } from "../presentation-assertions";
import { creation, issuedCredential, staffData } from "./fixtures";

const createMember = async (page: Page) => {
  const input = creation();
  await page.getByLabel("中文全名", { exact: true }).fill(input.fullName);
  await page.getByLabel("使用者名稱", { exact: true }).fill(input.username);
  await page.getByLabel("電話", { exact: true }).fill(input.phone);
  await page.getByLabel("已親身核實此人的身分", { exact: true }).check();
  await page.getByRole("button", { exact: true, name: "檢查帳戶資料" }).click();
  await expect(page.getByText(/確認提交會同時批准會籍/u)).toBeVisible();
  const response = page.waitForResponse(
    (http) =>
      http.request().method() === "POST" &&
      http.url().endsWith("/api/v2/staff/accounts")
  );
  await page
    .getByRole("button", { exact: true, name: "確認並建立帳戶及發出臨時密碼" })
    .click();
  const http = await response;
  expect(http.status()).toBe(201);
  const issuance = issuedCredential(await staffData(http));
  await expect(page.getByLabel("新臨時密碼", { exact: true })).toHaveText(
    issuance.temporaryPassword
  );
  return { input, issuance };
};

test(
  "Staff-assisted Active creation can finish privately, create the next member and return to account management",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@account-assisted",
      "@risk-recovery",
      "@risk-privacy",
      "@risk-authorization",
    ],
  },
  async ({ caseApp, staffPage: page }, testInfo) => {
    await page.goto("/staff/accounts?task=create");
    const first = await createMember(page);
    const next = page.getByRole("button", {
      exact: true,
      name: "建立下一位會友",
    });
    const finish = page.getByRole("button", {
      exact: true,
      name: "完成，返回帳戶管理",
    });
    await expect(next).toBeDisabled();
    await expect(finish).toBeDisabled();
    await page
      .getByRole("checkbox", {
        name: "已私下交接臨時密碼，並提醒首次登入必須更改",
      })
      .check();
    await expect(next).toBeEnabled();
    await expect(finish).toBeEnabled();
    await qualifyPresentation(page, testInfo, "assisted-active-completion", {
      criticalAction: next,
      drafts: page.getByRole("checkbox"),
      focus: finish,
    });
    await page.screenshot({
      fullPage: true,
      mask: [page.getByLabel("新臨時密碼", { exact: true })],
      path: testInfo.outputPath("active-handover-completion.png"),
    });
    await next.click();
    await expect(page.getByLabel("中文全名", { exact: true })).toHaveValue("");
    await expect(page.getByLabel("新臨時密碼", { exact: true })).toHaveCount(0);
    const second = await createMember(page);
    await page
      .getByRole("checkbox", {
        name: "已私下交接臨時密碼，並提醒首次登入必須更改",
      })
      .check();
    await finish.click();
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === "/staff/accounts" && !url.searchParams.has("task")
    );
    await expect(page.getByLabel("新臨時密碼", { exact: true })).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        localStorage.getItem("efcc.staff-account.operation.v1")
      )
    ).toBeNull();
    const members = await caseApp.db
      .prepare(
        "SELECT u.username, p.membership_status, p.account_role, a.temporary_password_expires_at, (SELECT count(*) FROM membership_application m WHERE m.user_id = u.id) AS applications FROM user u JOIN person_profile p ON p.user_id = u.id JOIN account a ON a.user_id = u.id WHERE u.username IN (?, ?) ORDER BY u.username"
      )
      .bind(first.input.username, second.input.username)
      .all();
    expect(members.results).toEqual(
      [
        {
          account_role: "member",
          applications: 0,
          membership_status: "active",
          temporary_password_expires_at:
            first.issuance.temporaryPasswordExpiresAt,
          username: first.input.username,
        },
        {
          account_role: "member",
          applications: 0,
          membership_status: "active",
          temporary_password_expires_at:
            second.issuance.temporaryPasswordExpiresAt,
          username: second.input.username,
        },
      ].toSorted((a, b) => a.username.localeCompare(b.username))
    );
    const storage = await page.evaluate(() =>
      JSON.stringify({ ...localStorage })
    );
    expect(storage).not.toContain(first.issuance.temporaryPassword);
    expect(storage).not.toContain(second.issuance.temporaryPassword);
  }
);
