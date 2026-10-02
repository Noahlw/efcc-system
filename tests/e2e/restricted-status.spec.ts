import { expect, test } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";

import type { SyntheticAccount } from "../scenarios/accounts";
import {
  allAccounts,
  approvedAccounts,
  findAccount,
  restrictedAccounts,
} from "../scenarios/accounts";
import { waitForSignInWindow } from "../scenarios/limiter";
import { revokeSessionsFor, seedSyntheticAccounts } from "./seed";

const wong = findAccount(approvedAccounts, "wong.tai.ming");
const pendingOnly = findAccount(restrictedAccounts, "law.pending");
const deactivatedAndBanned = findAccount(restrictedAccounts, "lee.banned");
const bannedOnly = findAccount(restrictedAccounts, "cheng.banned");

const statusTitles: Record<string, string> = {
  membership_deactivated: "會籍已停用",
  membership_pending: "會籍待批核",
  security_ban: "帳戶已暫停使用",
};

const signIn = async (
  request: APIRequestContext,
  username: string,
  password: string
) => {
  await waitForSignInWindow();
  return request.post("/api/auth/sign-in/username", {
    data: { password, username },
  });
};

/** Authenticated status access, denied business reads, then sign-out. */
const expectRestrictedJourney = async (
  request: APIRequestContext,
  account: SyntheticAccount,
  reasons: string[]
): Promise<void> => {
  const signInResponse = await signIn(
    request,
    account.username,
    account.password
  );
  expect(signInResponse.status()).toBe(200);

  const status = await request.get("/api/v2/status");
  expect(status.status()).toBe(200);
  expect(await status.json()).toEqual({
    data: {
      accessAllowed: false,
      displayName: account.fullName,
      reasons,
    },
  });

  // Business reads stay denied before any participation/notice content.
  const business = await request.get("/api/v2/me");
  expect(business.status()).toBe(403);

  // Home routes to the status surface instead of business content.
  const home = await request.get("/", { maxRedirects: 0 });
  expect(home.status()).toBe(307);
  expect(home.headers().location).toBe("/status");

  const signOut = await request.post("/api/auth/sign-out", { data: {} });
  expect(signOut.status()).toBe(200);
};

test.beforeAll(async () => {
  await seedSyntheticAccounts();
});

test("pending membership authenticates to status only", async ({ request }) => {
  await expectRestrictedJourney(request, pendingOnly, ["membership_pending"]);
});

test("deactivated membership and ban are both reported", async ({
  request,
}) => {
  await expectRestrictedJourney(request, deactivatedAndBanned, [
    "membership_deactivated",
    "security_ban",
  ]);
});

test("a ban with active membership blocks business access", async ({
  request,
}) => {
  await expectRestrictedJourney(request, bannedOnly, ["security_ban"]);
});

test("the status page shows every applicable restriction with actions", async ({
  page,
}) => {
  await waitForSignInWindow();
  await page.goto("/sign-in");
  await page.getByLabel("使用者名稱").fill(deactivatedAndBanned.username);
  await page.getByLabel("密碼").fill(deactivatedAndBanned.password);
  await page.getByRole("button", { name: "登入" }).click();

  await expect(page).toHaveURL(/\/status$/u);
  await expect(page.getByRole("heading", { name: "帳戶狀態" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: statusTitles.membership_deactivated })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: statusTitles.security_ban })
  ).toBeVisible();

  // Only recheck and sign-out are offered; no lifecycle operation.
  await expect(
    page.getByRole("button", { name: "重新檢查狀態" })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "登出" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /批核|恢復|解除/u })
  ).toHaveCount(0);
});

test("unban leaves deactivated membership unchanged", async ({ request }) => {
  const signInResponse = await signIn(
    request,
    deactivatedAndBanned.username,
    deactivatedAndBanned.password
  );
  expect(signInResponse.status()).toBe(200);

  // Lift only the security ban in the disposable fixture.
  await seedSyntheticAccounts(
    allAccounts.map((account) =>
      account.username === deactivatedAndBanned.username
        ? { ...account, banned: false }
        : account
    )
  );

  const status = await request.get("/api/v2/status");
  expect(await status.json()).toEqual({
    data: {
      accessAllowed: false,
      displayName: deactivatedAndBanned.fullName,
      reasons: ["membership_deactivated"],
    },
  });

  const home = await request.get("/", { maxRedirects: 0 });
  expect(home.status()).toBe(307);

  // Restore the combined fixture for later runs.
  await seedSyntheticAccounts();
});

test("recheck reflects current D1 state on the next request", async ({
  request,
}) => {
  const signInResponse = await signIn(
    request,
    pendingOnly.username,
    pendingOnly.password
  );
  expect(signInResponse.status()).toBe(200);

  await seedSyntheticAccounts(
    allAccounts.map((account) =>
      account.username === pendingOnly.username
        ? { ...account, membershipStatus: "active" as const }
        : account
    )
  );

  const status = await request.get("/api/v2/status");
  expect(await status.json()).toEqual({
    data: {
      accessAllowed: true,
      displayName: pendingOnly.fullName,
      reasons: [],
    },
  });

  const home = await request.get("/");
  expect(home.status()).toBe(200);

  await seedSyntheticAccounts();
});

test("a revoked session cannot reach the authenticated status surface", async ({
  request,
}) => {
  const signInResponse = await signIn(request, wong.username, wong.password);
  expect(signInResponse.status()).toBe(200);

  const before = await request.get("/api/v2/status");
  expect(before.status()).toBe(200);

  revokeSessionsFor(wong.username);

  const status = await request.get("/api/v2/status");
  expect(status.status()).toBe(401);

  const page = await request.get("/status", { maxRedirects: 0 });
  expect(page.status()).toBe(307);
  expect(page.headers().location).toBe(
    "/sign-in?reason=authentication-required"
  );
});
