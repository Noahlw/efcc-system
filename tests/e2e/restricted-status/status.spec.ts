import type { APIRequestContext } from "@playwright/test";

import { expect, test } from "../../support/fixtures";
import type { NativeApp } from "../../support/fixtures";
import type { ProvisionAccount } from "../../worker/provision";
import { qualifyPresentation } from "../presentation-assertions";
import type { StatusAccount } from "./fixtures";
import { statusTitles } from "./fixtures";

const setAccessState = async (
  app: NativeApp,
  userId: string,
  membershipStatus: ProvisionAccount["membershipStatus"],
  banned = false
) => {
  const result = await app.db
    .prepare(
      `UPDATE person_profile
       SET membership_status = ?,
           banned_at = CASE WHEN ? = 1 THEN unixepoch() ELSE NULL END,
           updated_at = unixepoch()
       WHERE user_id = ?`
    )
    .bind(membershipStatus, banned ? 1 : 0, userId)
    .run();
  expect(result.meta.changes).toBe(1);
};

const signIn = (
  request: APIRequestContext,
  account: Pick<ProvisionAccount, "password" | "username">
) =>
  request.post("/api/auth/sign-in/username", {
    data: { password: account.password, username: account.username },
  });

const expectRestrictedJourney = async (
  request: APIRequestContext,
  account: StatusAccount,
  reasons: string[]
): Promise<void> => {
  const signInResponse = await signIn(request, account);
  expect(signInResponse.status()).toBe(200);

  const authSession = await request.get("/api/auth/get-session");
  expect(authSession.status()).toBe(200);
  expect(await authSession.json()).not.toBeNull();

  const status = await request.get("/api/v2/status");
  expect(status.status()).toBe(200);
  expect(await status.json()).toEqual({
    data: {
      accessAllowed: false,
      displayName: account.fullName,
      reasons,
    },
  });

  const business = await request.get("/api/v2/me");
  expect(business.status()).toBe(403);

  const home = await request.get("/", { maxRedirects: 0 });
  expect(home.status()).toBe(307);
  expect(home.headers().location).toBe("/status");
  expect(home.headers()["cache-control"]).toContain("private");
  expect(home.headers()["cache-control"]).toContain("no-store");

  const signOut = await request.post("/api/auth/sign-out", { data: {} });
  expect(signOut.status()).toBe(200);
  const signedOutStatus = await request.get("/api/v2/status");
  expect(signedOutStatus.status()).toBe(401);
};

test("@native @http @risk-auth @risk-access pending membership authenticates to status only", async ({
  account,
  caseApp,
  request,
}) => {
  await setAccessState(caseApp, account.userId, "pending");
  await expectRestrictedJourney(request, account, ["membership_pending"]);
});

test("@native @http @risk-auth @risk-access deactivated membership and Security ban are both reported", async ({
  account,
  caseApp,
  request,
}) => {
  await setAccessState(caseApp, account.userId, "deactivated", true);
  await expectRestrictedJourney(request, account, [
    "membership_deactivated",
    "security_ban",
  ]);
});

test("@native @http @risk-auth @risk-access a Security ban with active membership blocks business access", async ({
  account,
  caseApp,
  request,
}) => {
  await setAccessState(caseApp, account.userId, "active", true);
  await expectRestrictedJourney(request, account, ["security_ban"]);
});

test("@native @browser @mobile-critical @risk-auth @risk-access the status page shows every restriction with read-only actions", async ({
  account,
  caseApp,
  page,
}) => {
  await setAccessState(caseApp, account.userId, "deactivated", true);
  await page.goto("/sign-in");
  await page.getByLabel("Username").fill(account.username);
  await page.getByLabel("密碼", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "登入" }).click();

  await expect(page).toHaveURL(/\/status$/u);
  await expect(page.getByRole("heading", { name: "帳戶狀態" })).toBeVisible();
  await expect(page.getByRole("link", { name: "返回帳戶" })).toHaveAttribute(
    "href",
    "/account"
  );
  await expect(
    page.getByRole("heading", { name: statusTitles.membership_deactivated })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: statusTitles.security_ban })
  ).toBeVisible();

  const recheck = page.getByRole("button", { name: "重新檢查狀態" });
  await expect(recheck).toBeVisible();
  await expect(recheck).toBeEnabled();
  await expect(page.getByRole("button", { name: "登出" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "查看我的申請" })
  ).toHaveAttribute("href", "/application");
  await expect(page.getByRole("button", { name: "前往主頁" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /批核|恢復|解除/u })
  ).toHaveCount(0);

  await page.goto("/status");
  await qualifyPresentation(page, test.info(), "status", {
    criticalAction: recheck,
    drafts: page.locator(
      "input[id]:not([type=hidden]):not([type=search]), textarea[id]"
    ),
  });
});

test("@native @http @risk-access lifting a Security ban leaves deactivated Membership unchanged", async ({
  account,
  caseApp,
  request,
}) => {
  await setAccessState(caseApp, account.userId, "deactivated", true);
  const signInResponse = await signIn(request, account);
  expect(signInResponse.status()).toBe(200);
  const bannedStatus = await request.get("/api/v2/status");
  expect(await bannedStatus.json()).toEqual({
    data: {
      accessAllowed: false,
      displayName: account.fullName,
      reasons: ["membership_deactivated", "security_ban"],
    },
  });

  await setAccessState(caseApp, account.userId, "deactivated");
  const currentStatus = await request.get("/api/v2/status");
  expect(await currentStatus.json()).toEqual({
    data: {
      accessAllowed: false,
      displayName: account.fullName,
      reasons: ["membership_deactivated"],
    },
  });
  const business = await request.get("/api/v2/me");
  expect(business.status()).toBe(403);
  const home = await request.get("/", { maxRedirects: 0 });
  expect(home.status()).toBe(307);
  expect(home.headers().location).toBe("/status");
});

test("@native @browser @mobile-critical @risk-access recheck reflects current D1 Membership state on the next request", async ({
  account,
  caseApp,
  page,
}) => {
  const signInResponse = await signIn(page.request, account);
  expect(signInResponse.status()).toBe(200);
  await setAccessState(caseApp, account.userId, "pending");

  await page.goto("/status");
  await expect(
    page.getByRole("heading", { name: statusTitles.membership_pending })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "前往主頁" })).toHaveCount(0);
  const restrictedBusiness = await page.request.get("/api/v2/me");
  expect(restrictedBusiness.status()).toBe(403);

  await setAccessState(caseApp, account.userId, "active");
  const recheck = page.getByRole("button", { name: "重新檢查狀態" });
  await recheck.click();
  await expect(
    page.getByRole("heading", { name: "帳戶可正常使用" })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: statusTitles.membership_pending })
  ).toHaveCount(0);

  const homeControl = page.getByRole("button", { name: "前往主頁" });
  await expect(homeControl).toHaveAttribute("href", "/");
  const activeStatus = await page.request.get("/api/v2/status");
  expect(await activeStatus.json()).toEqual({
    data: { accessAllowed: true, displayName: account.fullName, reasons: [] },
  });
  const activeBusiness = await page.request.get("/api/v2/me");
  expect(activeBusiness.status()).toBe(200);
  await homeControl.click();
  await expect(page).toHaveURL(/\/$/u);
  await expect(page.getByRole("heading", { name: "我的主頁" })).toBeVisible();
  const home = await page.request.get("/");
  expect(home.status()).toBe(200);
});

test("@native @browser @mobile-critical @risk-session a revoked session cannot reach the authenticated status surface", async ({
  account,
  caseApp,
  page,
}) => {
  const signInResponse = await signIn(page.request, account);
  expect(signInResponse.status()).toBe(200);
  const initialStatus = await page.request.get("/api/v2/status");
  expect(initialStatus.status()).toBe(200);

  const revoked = await caseApp.db
    .prepare("DELETE FROM session WHERE user_id = ?")
    .bind(account.userId)
    .run();
  expect(revoked.meta.changes).toBe(1);

  const revokedStatus = await page.request.get("/api/v2/status");
  expect(revokedStatus.status()).toBe(401);
  const status = await page.request.get("/status", { maxRedirects: 0 });
  expect(status.status()).toBe(307);
  expect(status.headers().location).toBe(
    "/sign-in?reason=authentication-required"
  );
  await page.goto("/status");
  await expect(page).toHaveURL(/\/sign-in\?reason=authentication-required$/u);
});
