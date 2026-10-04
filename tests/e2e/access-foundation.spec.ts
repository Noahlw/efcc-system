import { expect, request as playwrightRequest, test } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";

import {
  approvedAccounts,
  findAccount,
  restrictedAccounts,
} from "../scenarios/accounts";
import { waitForSignInWindow } from "../scenarios/limiter";
import { E2E_BASE_URL } from "../scenarios/local-env";
import { seedSyntheticAccounts } from "./seed";

const wong = findAccount(approvedAccounts, "wong.tai.ming");
const chan = findAccount(approvedAccounts, "Chan.Siu.Fong");
const pendingPerson = findAccount(restrictedAccounts, "law.pending");

test.beforeAll(async () => {
  await seedSyntheticAccounts();
});

const signIn = async (
  api: APIRequestContext,
  username: string,
  password: string
) => {
  await waitForSignInWindow();
  return api.post("/api/auth/sign-in/username", {
    data: { password, username },
  });
};

test("unused native auth routes and methods stay refused", async ({
  request,
}) => {
  const refused = [
    { data: {}, method: "post" as const, path: "/api/auth/sign-up/email" },
    { data: {}, method: "post" as const, path: "/api/auth/sign-in/email" },
    {
      data: {},
      method: "post" as const,
      path: "/api/auth/reset-password/tok_123",
    },
    { data: {}, method: "post" as const, path: "/api/auth/delete-user" },
    { data: {}, method: "get" as const, path: "/api/auth/sign-in/username" },
    { data: {}, method: "get" as const, path: "/api/auth/sign-out" },
    {
      data: {},
      method: "post" as const,
      path: "/api/auth/is-username-available",
    },
  ];

  const results = await Promise.all(
    refused.map(async (target) => {
      const response =
        target.method === "post"
          ? await request.post(target.path, { data: target.data })
          : await request.get(target.path);
      return {
        method: target.method,
        path: target.path,
        status: response.status(),
      };
    })
  );

  for (const result of results) {
    expect(result.status, `${result.method} ${result.path}`).toBe(404);
  }

  // Implemented entries stay usable: get-session without a cookie is a 200 null session.
  const session = await request.get("/api/auth/get-session");
  expect(session.status()).toBe(200);
  expect(await session.json()).toBeNull();
});

test("anonymous visitors cannot reach home or the business read", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in\?reason=authentication-required$/u);

  const status = await request.get("/status", { maxRedirects: 0 });
  expect(status.status()).toBe(307);
  expect(status.headers()["cache-control"]).toContain("private");
  expect(status.headers()["cache-control"]).toContain("no-store");

  const home = await request.get("/", { maxRedirects: 0 });
  expect(home.status()).toBe(307);
  expect(home.headers()["cache-control"]).toContain("private");
  expect(home.headers()["cache-control"]).toContain("no-store");

  const business = await request.get("/api/v2/me");
  expect(business.status()).toBe(401);
  expect(await business.json()).toEqual({
    error: { code: "unauthorized", message: "請先登入。" },
  });
});

test("direct sign-in only explains the validated authentication reason", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("status")).toHaveCount(0);
  await page.goto(
    "/sign-in?reason=untrusted-message&reason=authentication-required"
  );
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(
    page.getByText("untrusted-message", { exact: true })
  ).toHaveCount(0);
  await page.goto("/sign-in?reason=authentication-required");
  await expect(page.getByRole("status")).toHaveText(
    "未能確認登入狀態，請重新登入後繼續。"
  );
});

test("an approved person signs in, reads their own identity and signs out", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });
  await waitForSignInWindow();
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in\?reason=authentication-required$/u);

  await page.getByLabel("使用者名稱").fill(wong.username);
  await page.getByLabel("密碼").fill(wong.password);
  await page.getByRole("button", { name: "登入" }).click();

  await expect(page).toHaveURL(/\/$/u);
  await expect(page.getByRole("heading", { name: "我的主頁" })).toBeVisible();
  await expect(page.getByText(wong.fullName, { exact: true })).toBeVisible();
  await expect(page.getByText(wong.username, { exact: true })).toBeVisible();
  await expect(page.getByText("已批准")).toBeVisible();

  const navigation = page.getByRole("navigation", { name: "主要導覽" });
  await expect(navigation).toBeVisible();
  await expect(navigation.getByRole("link")).toHaveCount(1);
  const homeLink = navigation.getByRole("link", { exact: true, name: "主頁" });
  await expect(homeLink).toHaveAttribute("href", "/");
  await expect(homeLink).toHaveAttribute("aria-current", "page");
  await homeLink.focus();
  await expect(homeLink).toBeFocused();
  const target = await homeLink.boundingBox();
  expect(target?.height).toBeGreaterThanOrEqual(44);
  expect(target?.width).toBeGreaterThanOrEqual(44);

  await page.goto("/status");
  const statusHomeLink = page
    .getByRole("navigation", { name: "主要導覽" })
    .getByRole("link", { exact: true, name: "主頁" });
  await expect(statusHomeLink).toBeVisible();
  await expect(statusHomeLink).not.toHaveAttribute("aria-current", "page");
  await statusHomeLink.click();
  await expect(page.getByRole("heading", { name: "我的主頁" })).toBeVisible();

  await page.getByRole("button", { name: "登出" }).click();
  await expect(page).toHaveURL(/\/sign-in$/u);

  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in\?reason=authentication-required$/u);
  expect(consoleErrors).toEqual([]);
});

test("invalid credentials do not authorise home or the business read", async ({
  page,
  request,
}) => {
  const response = await signIn(request, wong.username, "definitely-wrong");
  expect(response.status()).toBe(401);

  const business = await request.get("/api/v2/me");
  expect(business.status()).toBe(401);

  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in\?reason=authentication-required$/u);
  await page.getByLabel("使用者名稱").fill(wong.username);
  await page.getByLabel("密碼").fill("definitely-wrong");
  await page.getByRole("button", { name: "登入" }).click();
  await expect(page.getByRole("alert")).toContainText("使用者名稱或密碼不正確");
  await expect(page).toHaveURL(/\/sign-in\?reason=authentication-required$/u);
});

test("two approved accounts see only their own identity", async ({
  request,
}) => {
  const first = await signIn(request, wong.username, wong.password);
  expect(first.status()).toBe(200);
  const firstRead = await request.get("/api/v2/me");
  expect(await firstRead.json()).toEqual({
    data: {
      displayName: wong.fullName,
      membershipStatus: "active",
      username: wong.username,
    },
  });

  const secondContext = await playwrightRequest.newContext({
    baseURL: E2E_BASE_URL,
  });
  const second = await signIn(secondContext, chan.username, chan.password);
  expect(second.status()).toBe(200);
  const secondRead = await secondContext.get("/api/v2/me");
  expect(await secondRead.json()).toEqual({
    data: {
      displayName: chan.fullName,
      membershipStatus: "active",
      username: chan.username,
    },
  });

  // The first session is unaffected by the second person's read.
  const firstAgain = await request.get("/api/v2/me");
  expect(await firstAgain.json()).toEqual({
    data: {
      displayName: wong.fullName,
      membershipStatus: "active",
      username: wong.username,
    },
  });
  await secondContext.dispose();
});

test("restricted accounts authenticate but keep business access denied", async ({
  page,
}) => {
  await waitForSignInWindow();
  await page.goto("/sign-in");
  await page.getByLabel("使用者名稱").fill(pendingPerson.username);
  await page.getByLabel("密碼").fill(pendingPerson.password);
  await page.getByRole("button", { name: "登入" }).click();

  await expect(page).toHaveURL(/\/status$/u);
  await expect(page.getByRole("heading", { name: "帳戶狀態" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "主要導覽" })).toHaveCount(
    0
  );
  await expect(page.getByRole("link")).toHaveCount(0);

  // The page's own request context proves the authenticated session is denied
  // business data without any partial success.
  const business = await page.request.get("/api/v2/me");
  expect(business.status()).toBe(403);
  expect(await business.json()).toEqual({
    error: {
      code: "business_access_denied",
      message: "你的帳戶目前無法使用教會功能。",
    },
  });

  await page.goto("/");
  await expect(page).toHaveURL(/\/status$/u);
});

test("untrusted cross-origin sign-in and sign-out are refused", async ({
  request,
}) => {
  await waitForSignInWindow();
  const response = await request.post("/api/auth/sign-in/username", {
    data: { password: wong.password, username: wong.username },
    headers: { origin: "https://evil.example" },
  });
  expect(response.status()).toBe(403);

  const business = await request.get("/api/v2/me");
  expect(business.status()).toBe(401);

  const signedIn = await signIn(request, wong.username, wong.password);
  expect(signedIn.status()).toBe(200);
  const signOut = await request.post("/api/auth/sign-out", {
    data: {},
    headers: { origin: "https://evil.example" },
  });
  expect(signOut.status()).toBe(403);
  const stillSignedIn = await request.get("/api/v2/me");
  expect(stillSignedIn.status()).toBe(200);
});
