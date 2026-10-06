/* eslint-disable no-await-in-loop -- Journey steps share the same Page and durable state. */
import { randomBytes, randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { waitForSignInWindow } from "../scenarios/limiter";
import { qualifyPresentation } from "./r11-presentation";
import { queryLocalSql, runLocalSql, seedSyntheticAccounts } from "./seed";

test.use({ actionTimeout: 10_000 });

const holder = () => {
  const suffix = randomBytes(5).toString("hex");
  return {
    email: `r11.${suffix}@example.com`,
    fullName: `陳驗收${suffix}`,
    membershipStatus: "active" as const,
    password: "Synthetic-R11-password!",
    phone: String(60_000_000 + (Number.parseInt(suffix, 16) % 10_000_000)),
    username: `r11.${suffix}`,
  };
};

const signIn = async (page: Page, account: ReturnType<typeof holder>) => {
  await waitForSignInWindow();
  const response = await page.request.post("/api/auth/sign-in/username", {
    data: { password: account.password, username: account.username },
  });
  expect(response.status()).toBe(200);
};

const staffHolder = async () => {
  const account = holder();
  await seedSyntheticAccounts([account]);
  runLocalSql(
    `UPDATE person_profile SET account_role='staff' WHERE user_id=(SELECT id FROM user WHERE username='${account.username}')`
  );
  return account;
};

const createApplication = async (page: Page) => {
  const account = holder();
  const response = await page.request.post("/api/v2/applications", {
    data: {
      email: account.email,
      fullName: account.fullName,
      operationKey: randomBytes(32).toString("hex"),
      password: account.password,
      phone: account.phone,
      username: account.username,
    },
  });
  expect(response.status()).toBe(201);
  return account;
};

test("R11 public sign-in, application, dirty-exit and submitted result", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto("/sign-in");
  await qualifyPresentation(page, test.info(), "signin");
  await page.goto("/apply");
  await qualifyPresentation(page, test.info(), "apply");
  const account = holder();
  await page.getByLabel("電話號碼", { exact: true }).fill(account.phone);
  await page.getByRole("link", { name: /返回登入/u }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await qualifyPresentation(page, test.info(), "leave");
  await page.getByRole("button", { name: "繼續編輯" }).click();
  await expect(page.getByLabel("電話號碼", { exact: true })).toHaveValue(
    account.phone
  );
  await page.getByLabel("中文全名", { exact: true }).fill(account.fullName);
  await page.getByLabel("使用者名稱", { exact: true }).fill(account.username);
  await page.getByLabel("電郵地址", { exact: true }).fill(account.email);
  await page.getByLabel("設定密碼", { exact: true }).fill(account.password);
  await page.getByRole("button", { exact: true, name: "提交申請" }).click();
  await expect(page.getByRole("status")).toContainText("申請已提交");
  await qualifyPresentation(page, test.info(), "apply-result");
  await page.getByRole("button", { exact: true, name: "前往登入" }).click();
  await expect(page).toHaveURL(/\/sign-in/u);
  await signIn(page, account);
  const own = await page.request.get("/api/v2/applications/mine");
  expect(own.status()).toBe(200);
  const ownBody = await own.json();
  expect(ownBody.data.application.username).toBe(account.username);
});

test("R11 personal roots and focused security/contact tasks", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const account = holder();
  await seedSyntheticAccounts([account]);
  await signIn(page, account);
  for (const [screen, url] of [
    ["home", "/"],
    ["inbox", "/inbox"],
    ["account", "/account"],
    ["phone", "/account?task=phone"],
    ["security", "/account?task=security"],
    ["password", "/account?task=password"],
    ["sessions", "/account?task=sessions"],
    ["status", "/status"],
  ] as const) {
    await page.goto(url);
    await expect(page.locator("h1")).toBeVisible();
    await qualifyPresentation(page, test.info(), screen);
  }
  await page.goto("/account?task=phone");
  await page.getByLabel("新電話", { exact: true }).fill(account.phone);
  await page.getByRole("button", { exact: true, name: "檢查電話" }).click();
  await page.getByRole("button", { name: "確認並儲存電話" }).click();
  await expect(page.getByRole("status")).toContainText("伺服器已確認");
  const identityResponse = await page.request.get("/api/v2/account/identity");
  const identityBody = await identityResponse.json();
  expect(identityBody.data.identity.phone).toBe(`+852${account.phone}`);
});

test("R11 applicant correction, withdrawal, lost response and resubmission", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const account = await createApplication(page);
  await signIn(page, account);
  await page.goto("/application");
  await qualifyPresentation(page, test.info(), "application");
  await page.getByRole("button", { name: "修正申請資料" }).click();
  await page
    .getByLabel("中文全名", { exact: true })
    .fill(`${account.fullName}修正`);
  await qualifyPresentation(page, test.info(), "app-edit");
  await page.getByRole("button", { name: "檢查更改" }).click();
  await page.getByRole("button", { name: "確認並提交更改" }).click();
  await expect(page.getByRole("status")).toContainText("伺服器已確認");
  await page.getByRole("button", { name: "完成，開始另一項操作" }).click();
  await page.getByRole("button", { exact: true, name: "撤回申請" }).click();
  await qualifyPresentation(page, test.info(), "app-withdraw");
  await page.route("**/api/v2/applications/actions", async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    await route.abort("failed");
  });
  await page.route("**/api/v2/applications/actions/reconcile", (route) =>
    route.abort("failed")
  );
  await page.getByRole("button", { exact: true, name: "確認撤回" }).click();
  await expect(page.getByRole("status")).toContainText("結果仍未確認");
  await qualifyPresentation(page, test.info(), "operation");
  await page.unroute("**/api/v2/applications/actions/reconcile");
  await page.unroute("**/api/v2/applications/actions");
  await page.getByRole("button", { name: "查核之前的操作" }).click();
  await expect(page.getByRole("status")).toContainText("伺服器已確認");
  await page.getByRole("button", { name: "完成，開始另一項操作" }).click();
  await page.getByRole("button", { exact: true, name: "重新提交申請" }).click();
  await qualifyPresentation(page, test.info(), "app-resubmit");
  await page.getByRole("button", { exact: true, name: "確認重新提交" }).click();
  await expect(page.getByRole("status")).toContainText("伺服器已確認");
  const applicationResponse = await page.request.get(
    "/api/v2/applications/mine"
  );
  const applicationBody = await applicationResponse.json();
  expect(applicationBody.data.application.status).toBe("pending");
});

test("R11 Staff person-first workspace, identity, confirmation and recovery", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const staff = await staffHolder();
  const account = holder();
  await seedSyntheticAccounts([account]);
  const [target] = queryLocalSql<{ id: string }>(
    `SELECT id FROM user WHERE username='${account.username}'`
  );
  if (!target) {
    throw new Error("Synthetic R11 target missing");
  }
  await signIn(page, staff);
  await page.goto("/staff/accounts");
  await qualifyPresentation(page, test.info(), "management");
  await page.getByRole("link", { name: /帳戶管理/u }).click();
  await expect(page.getByRole("searchbox")).toBeVisible();
  await qualifyPresentation(page, test.info(), "accounts");
  await page.getByRole("searchbox").fill(account.username);
  await page.getByRole("button", { exact: true, name: "搜尋" }).click();
  await page
    .getByRole("link", { name: new RegExp(account.fullName, "u") })
    .click();
  await expect(
    page.getByRole("heading", { exact: true, name: account.fullName })
  ).toBeVisible();
  await qualifyPresentation(page, test.info(), "person");
  await page.getByRole("link", { name: /修正身份資料/u }).click();
  await expect(page.getByLabel("中文全名", { exact: true })).toBeEnabled();
  await qualifyPresentation(page, test.info(), "identity");
  await page
    .getByLabel("中文全名", { exact: true })
    .fill(`${account.fullName}核實`);
  await page.getByLabel("修正電話", { exact: true }).fill(account.phone);
  await page
    .getByLabel("身分核實方式", { exact: true })
    .selectOption("face_to_face");
  await page.getByLabel("已按以上方式核實本人", { exact: false }).check();
  await page.getByRole("button", { exact: true, name: "檢查修正" }).click();
  await page.getByRole("button", { exact: true, name: "確認目前密碼" }).click();
  await qualifyPresentation(page, test.info(), "confirm");
  await page
    .getByRole("dialog")
    .getByLabel("目前密碼", { exact: true })
    .fill(staff.password);
  await page
    .getByRole("button", { exact: true, name: "確認並返回檢查" })
    .click();
  await expect(page.getByRole("dialog").getByRole("status")).toContainText(
    "伺服器已確認"
  );
  await page
    .getByRole("button", { exact: true, name: "確認並返回檢查" })
    .click();
  await page.getByRole("button", { name: "確認並提交修正" }).click();
  await expect(page.getByRole("status")).toContainText("伺服器已確認");
  await page.goto(
    `/staff/accounts?view=people&person=${target.id}&task=recovery`
  );
  await expect(page.getByLabel("身分核實方式", { exact: true })).toBeEnabled();
  const verificationBox = await page
    .getByLabel("身分核實方式", { exact: true })
    .boundingBox();
  expect(verificationBox?.height).toBeGreaterThanOrEqual(52);
  await qualifyPresentation(page, test.info(), "recovery");
  await page
    .getByLabel("身分核實方式", { exact: true })
    .selectOption("face_to_face");
  await page.getByLabel("已按以上方式核實身分", { exact: false }).check();
  await page.getByRole("button", { name: "檢查重設資料" }).click();
  await page
    .getByRole("button", { name: "確認並重設密碼及登出全部裝置" })
    .click();
  await expect(page.getByLabel("新臨時密碼", { exact: true })).toBeVisible();
  await qualifyPresentation(page, test.info(), "handover");
  const temporaryPassword = await page
    .getByLabel("新臨時密碼", { exact: true })
    .textContent();
  expect(temporaryPassword).toHaveLength(32);
  await page.reload();
  await expect(page.getByLabel("新臨時密碼", { exact: true })).toHaveCount(0);
  await page.request.post("/api/auth/sign-out", { data: {} });
  await signIn(page, { ...account, password: temporaryPassword ?? "" });
  await page.goto("/account");
  await qualifyPresentation(page, test.info(), "temp-password");
});

test("R11 Staff creation, four restriction actions, deletion and retained audit", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const staff = await staffHolder();
  await signIn(page, staff);
  const confirmation = await page.request.post(
    "/api/v2/account/password-confirmation",
    {
      data: { operationKey: randomUUID(), password: staff.password },
    }
  );
  expect(confirmation.status()).toBe(201);
  await page.goto("/staff/accounts?task=create");
  await expect(page.getByLabel("中文全名", { exact: true })).toBeEnabled();
  await qualifyPresentation(page, test.info(), "create");
  const account = holder();
  await page.getByLabel("中文全名", { exact: true }).fill(account.fullName);
  await page.getByLabel("使用者名稱", { exact: true }).fill(account.username);
  await page.getByLabel("電話", { exact: true }).fill(account.phone);
  await page.getByLabel("已親身核實此人的身分", { exact: true }).check();
  await page.getByRole("button", { name: "檢查帳戶資料" }).click();
  await page
    .getByRole("button", { name: "確認並建立帳戶及發出臨時密碼" })
    .click();
  await expect(page.getByLabel("新臨時密碼", { exact: true })).toBeVisible();
  const [target] = queryLocalSql<{ id: string }>(
    `SELECT id FROM user WHERE username='${account.username}'`
  );
  if (!target) {
    throw new Error("Synthetic R11 target missing");
  }
  await page.goto(
    `/staff/accounts?view=people&person=${target.id}&task=restrictions`
  );
  await qualifyPresentation(page, test.info(), "restrictions");
  const region = page.getByRole("region", { name: "會籍與安全限制" });
  for (const [screen, label] of [
    ["ban", "封鎖帳戶"],
    ["unban", "解除封鎖"],
    ["deactivate", "停用會籍"],
    ["reactivate", "重新啟用會籍"],
  ] as const) {
    await region.getByRole("button", { exact: true, name: label }).click();
    await qualifyPresentation(page, test.info(), screen);
    await region
      .getByRole("button", { exact: true, name: `確認並${label}` })
      .click();
    await expect(region.getByRole("status")).toContainText("伺服器已確認");
    await region.getByRole("button", { name: "完成，開始另一項操作" }).click();
  }
  runLocalSql(`UPDATE user SET display_username=NULL WHERE id='${target.id}'`);
  await page.goto(
    `/staff/accounts?view=people&person=${target.id}&task=deletion`
  );
  await expect(page.getByRole("checkbox")).toBeEnabled();
  await expect(page.getByText(new RegExp(target.id, "u"))).toBeVisible();
  await qualifyPresentation(page, test.info(), "deletion");
  await page.goto("/staff/account-audit");
  await expect(
    page.getByRole("link", { exact: true, name: "管理" })
  ).toHaveAttribute("aria-current", "page");
  await qualifyPresentation(page, test.info(), "audit");
  await page
    .getByRole("link", { name: /查看詳情/u })
    .first()
    .click();
  await expect(
    page.getByRole("region", { name: "帳戶紀錄詳情" })
  ).toBeVisible();
  await qualifyPresentation(page, test.info(), "audit-detail");
});

test("R11 Staff application decisions preserve applicant privacy", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const account = await createApplication(page);
  const staff = await staffHolder();
  await signIn(page, staff);
  await page.goto("/staff/applications");
  await qualifyPresentation(page, test.info(), "applications");
  await page
    .getByRole("button", { name: new RegExp(`審批 ${account.fullName}`, "u") })
    .click();
  await qualifyPresentation(page, test.info(), "application-review");
  await page.getByRole("button", { name: "返回待批清單" }).click();
  await expect(
    page.getByRole("button", {
      name: new RegExp(`審批 ${account.fullName}`, "u"),
    })
  ).toBeVisible();
});

test("R11 denied and authentication-unavailable views have working exits", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const account = holder();
  await seedSyntheticAccounts([account]);
  await signIn(page, account);
  await page.goto("/staff/accounts");
  await expect(page.getByText("你目前沒有帳戶管理權限。")).toBeVisible();
  await qualifyPresentation(page, test.info(), "denied");
  await page.goto("/unavailable");
  await qualifyPresentation(page, test.info(), "unavailable");
});

test("R11 real client error boundary hides internal failure and retries", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    const originalFocus = HTMLInputElement.prototype.focus;
    let failOnce = true;
    HTMLInputElement.prototype.focus = function focus(options) {
      if (failOnce) {
        failOnce = false;
        throw new Error("Synthetic private focus failure");
      }
      originalFocus.call(this, options);
    };
  });
  await page.goto("/apply");
  await expect(
    page.getByRole("heading", { exact: true, name: "暫時未能載入資料" })
  ).toBeVisible();
  // vinext's development-only overlay exposes diagnostic errors to developers.
  // Dismiss it; the production application boundary must keep its own copy safe.
  const developmentOverlay = page.getByRole("dialog", {
    name: "Runtime Error",
  });
  if (await developmentOverlay.isVisible()) {
    await developmentOverlay.getByRole("button", { name: "Dismiss" }).click();
  }
  await expect(
    page
      .locator("main")
      .getByText("Synthetic private focus failure", { exact: true })
  ).toHaveCount(0);
  await qualifyPresentation(page, test.info(), "error");
  await page.getByRole("button", { exact: true, name: "重試" }).click();
  await expect(
    page.getByRole("heading", { exact: true, name: "申請帳戶" })
  ).toBeVisible();
});

test("R11 native Staff fields and Management destination meet shared rules", async ({
  page,
}) => {
  const staff = await staffHolder();
  const account = holder();
  await seedSyntheticAccounts([account]);
  const [target] = queryLocalSql<{ id: string }>(
    `SELECT id FROM user WHERE username='${account.username}'`
  );
  if (!target) {
    throw new Error("Synthetic R11 target missing");
  }
  await signIn(page, staff);
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto(
    `/staff/accounts?view=people&person=${target.id}&task=recovery`
  );
  const field = page.getByLabel("身分核實方式", { exact: true });
  await expect(field).toBeEnabled();
  const fieldBox = await field.boundingBox();
  expect(fieldBox?.height).toBeGreaterThanOrEqual(52);
  await page.goto("/staff/account-audit");
  await expect(
    page.getByRole("link", { exact: true, name: "管理" })
  ).toHaveAttribute("aria-current", "page");
});

test("R11 sign-out pending and retry use compact Auth presentation and real retry", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const account = holder();
  await seedSyntheticAccounts([account]);
  await signIn(page, account);
  await page.goto("/account");
  const { promise: responseGate, resolve: releaseResponse } =
    Promise.withResolvers<boolean>();
  await page.route("**/api/auth/sign-out", async (route) => {
    await responseGate;
    await route.abort("failed");
  });
  await page.getByRole("button", { exact: true, name: "登出" }).click();
  const pending = page.getByRole("dialog", { name: "正在登出" });
  await expect(pending).toBeVisible();
  await expect(pending.getByRole("button", { name: "登出中…" })).toBeDisabled();
  await expect(pending.getByRole("status")).toHaveText(
    "正在向伺服器確認登出，請稍候。"
  );
  await page.keyboard.press("Escape");
  await expect(pending).toBeVisible();
  releaseResponse(true);
  const dialog = page.getByRole("dialog", { name: "未能確認登出" });
  await expect(dialog).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "主要導覽" })
  ).not.toBeVisible();
  await qualifyPresentation(page, test.info(), "signout");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("heading", { exact: true, name: "帳戶" })
  ).toBeVisible();
  await page.getByRole("button", { exact: true, name: "登出" }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "返回並重新檢查登入狀態" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("heading", { exact: true, name: "帳戶" })
  ).toBeVisible();
  await page.getByRole("button", { exact: true, name: "登出" }).click();
  await expect(dialog).toBeVisible();
  await page.unroute("**/api/auth/sign-out");
  await dialog.getByRole("button", { name: "重新確認登出" }).click();
  await expect(page).toHaveURL(/\/sign-in$/u);
  const sessionResponse = await page.request.get("/api/auth/get-session");
  const sessionBody = await sessionResponse.json();
  expect(sessionBody).toBeNull();
});
