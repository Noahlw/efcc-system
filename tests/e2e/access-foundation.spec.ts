import type { APIRequestContext } from "@playwright/test";

import { findAccount, restrictedAccounts } from "../scenarios/accounts";
import { expect, test as base } from "../support/fixtures";
import type { NativeApp } from "../support/fixtures";
import type { ProvisionAccount } from "../worker/provision";

const dedicatedTest = base.extend<{ caseApp: NativeApp }>({
  caseApp: async ({ dedicatedApp }, use) => {
    await use(dedicatedApp);
  },
});

const httpTags = ["@native", "@access-foundation", "@http"] as const;
const browserTags = ["@native", "@access-foundation", "@browser"] as const;

const signIn = (api: APIRequestContext, username: string, password: string) =>
  api.post("/api/auth/sign-in/username", {
    data: { password, username },
  });

test(
  "unused native auth routes and methods stay refused",
  { tag: [...httpTags, "@risk-auth-boundary"] },
  async ({ request }) => {
    const refused = [
      { data: {}, method: "post" as const, path: "/api/auth/sign-up/email" },
      { data: {}, method: "post" as const, path: "/api/auth/sign-in/email" },
      {
        data: {},
        method: "post" as const,
        path: "/api/auth/reset-password/tok_123",
      },
      { data: {}, method: "post" as const, path: "/api/auth/delete-user" },
      {
        data: {},
        method: "get" as const,
        path: "/api/auth/sign-in/username",
      },
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
  }
);

test(
  "anonymous visitors cannot reach home or the business read",
  {
    tag: [
      ...browserTags,
      "@risk-anonymous-access",
      "@risk-private-cache",
      "@mobile-critical",
    ],
  },
  async ({ page, request }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/sign-in\?reason=authentication-required$/u);

    const status = await request.get("/status", { maxRedirects: 0 });
    expect(status.status()).toBe(307);
    expect(status.headers()["cache-control"]).toContain("private");
    expect(status.headers()["cache-control"]).toContain("no-store");
    expect(status.headers()["set-cookie"]).toBeUndefined();

    const home = await request.get("/", { maxRedirects: 0 });
    expect(home.status()).toBe(307);
    expect(home.headers()["cache-control"]).toContain("private");
    expect(home.headers()["cache-control"]).toContain("no-store");
    expect(home.headers()["set-cookie"]).toBeUndefined();

    const business = await request.get("/api/v2/me");
    expect(business.status()).toBe(401);
    expect(await business.json()).toEqual({
      error: { code: "unauthorized", message: "請先登入。" },
    });
    expect(business.headers()["set-cookie"]).toBeUndefined();
  }
);

test(
  "direct sign-in only explains the validated authentication reason",
  { tag: [...browserTags, "@risk-auth-ui"] },
  async ({ page }) => {
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
    await expect(page.getByRole("status")).toBeVisible();
  }
);

test(
  "an approved person signs in, reads their own identity and signs out",
  {
    tag: [
      ...browserTags,
      "@risk-authentication",
      "@risk-session-cookie",
      "@mobile-critical",
    ],
  },
  async ({ page, account }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => {
      consoleErrors.push(error.message);
    });

    await page.goto("/");
    await expect(page).toHaveURL(/\/sign-in\?reason=authentication-required$/u);

    const loginResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/auth/sign-in/username"
    );
    await page.getByLabel("Username").fill(account.username);
    await page.getByLabel("密碼", { exact: true }).fill(account.password);
    await page.getByRole("button", { name: "登入" }).click();
    const login = await loginResponse;
    expect(login.status()).toBe(200);
    expect(login.headers()["set-cookie"]).toContain(
      "better-auth.session_token"
    );

    await expect(page).toHaveURL(/\/$/u);
    await expect(page.getByRole("heading", { name: "我的主頁" })).toBeVisible();
    await expect(
      page.getByText(`歡迎回來，${account.fullName}。`, { exact: true })
    ).toBeVisible();

    const navigation = page.getByRole("navigation", { name: "主要導覽" });
    await expect(navigation).toBeVisible();
    await expect(
      navigation.getByRole("link", { exact: true, name: "管理" })
    ).toHaveCount(0);
    await expect(
      navigation.getByRole("link", { exact: true, name: "收件匣" })
    ).toHaveAttribute("href", "/inbox");
    await expect(
      navigation.getByRole("link", { exact: true, name: "帳戶" })
    ).toHaveAttribute("href", "/account");
    const homeLink = navigation.getByRole("link", {
      exact: true,
      name: "主頁",
    });
    await expect(homeLink).toHaveAttribute("href", "/");
    await expect(homeLink).toHaveAttribute("aria-current", "page");
    await homeLink.focus();
    await expect(homeLink).toBeFocused();
    const target = await homeLink.boundingBox();
    expect(target?.height).toBeGreaterThanOrEqual(44);
    expect(target?.width).toBeGreaterThanOrEqual(44);

    await navigation.getByRole("link", { exact: true, name: "帳戶" }).click();
    await expect(
      page.getByRole("heading", { exact: true, name: "帳戶" })
    ).toBeVisible();
    const personalDetails = page.getByRole("region", { name: "個人資料" });
    await expect(
      personalDetails.getByText(account.username, { exact: true })
    ).toBeVisible();
    await page.goto("/status");
    await expect(
      page.getByRole("heading", { exact: true, name: "帳戶狀態" })
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "返回帳戶" })).toBeVisible();
    await page.getByRole("link", { name: "返回帳戶" }).click();
    await expect(
      page.getByRole("heading", { exact: true, name: "帳戶" })
    ).toBeVisible();
    await expect(homeLink).not.toHaveAttribute("aria-current", "page");
    await homeLink.click();
    await expect(page.getByRole("heading", { name: "我的主頁" })).toBeVisible();
    await page.goto("/account");

    await page.getByRole("button", { name: "登出" }).click();
    await expect(page).toHaveURL(/\/sign-in$/u);
    const signedOutSession = await page.request.get("/api/auth/get-session");
    expect(await signedOutSession.json()).toBeNull();

    await page.goto("/");
    await expect(page).toHaveURL(/\/sign-in\?reason=authentication-required$/u);
    expect(consoleErrors).toEqual([]);
  }
);

test(
  "invalid credentials do not authorise home or the business read",
  {
    tag: [
      ...browserTags,
      "@risk-authentication",
      "@risk-denial",
      "@mobile-critical",
    ],
  },
  async ({ page, request, account }) => {
    const response = await signIn(
      request,
      account.username,
      "definitely-wrong"
    );
    expect(response.status()).toBe(401);

    const business = await request.get("/api/v2/me");
    expect(business.status()).toBe(401);

    await page.goto("/");
    await expect(page).toHaveURL(/\/sign-in\?reason=authentication-required$/u);
    await page.getByLabel("Username").fill(account.username);
    await page.getByLabel("密碼", { exact: true }).fill("definitely-wrong");
    await page.getByRole("button", { name: "登入" }).click();
    await expect(page.getByRole("alert")).toContainText("未能登入");
    await expect(page.getByRole("alert")).toContainText("請檢查登入資料及密碼");
    await expect(page.getByLabel("Username")).toHaveValue(account.username);
    await expect(
      page.getByRole("button", { exact: true, name: "登入" })
    ).toBeEnabled();
    const failedSession = await page.request.get("/api/auth/get-session");
    expect(await failedSession.json()).toBeNull();
    const deniedRead = await page.request.get("/api/v2/me");
    expect(deniedRead.status()).toBe(401);
    await expect(page).toHaveURL(/\/sign-in\?reason=authentication-required$/u);
  }
);

test(
  "two case-owned accounts see only their own identity",
  { tag: [...httpTags, "@risk-actor-isolation"] },
  async ({ request, playwright, caseApp, extraHTTPHeaders, account }) => {
    const second: ProvisionAccount = {
      email: `other-${account.email}`,
      fullName: `${account.fullName}乙`,
      membershipStatus: "active",
      password: "Synthetic-second-native-password!",
      username: `${account.username}.other`,
    };
    await caseApp.provision.account(second);

    const first = await signIn(request, account.username, account.password);
    expect(first.status()).toBe(200);
    const firstRead = await request.get("/api/v2/me");
    expect(await firstRead.json()).toEqual({
      data: {
        displayName: account.fullName,
        membershipStatus: "active",
        username: account.username,
      },
    });

    const secondContext = await playwright.request.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders,
    });
    try {
      const secondSignIn = await signIn(
        secondContext,
        second.username,
        second.password
      );
      expect(secondSignIn.status()).toBe(200);
      const secondRead = await secondContext.get("/api/v2/me");
      expect(await secondRead.json()).toEqual({
        data: {
          displayName: second.fullName,
          membershipStatus: "active",
          username: second.username,
        },
      });

      // The first session is unaffected by the second person's read.
      const firstAgain = await request.get("/api/v2/me");
      expect(await firstAgain.json()).toEqual({
        data: {
          displayName: account.fullName,
          membershipStatus: "active",
          username: account.username,
        },
      });
    } finally {
      await secondContext.dispose();
    }
  }
);

dedicatedTest(
  "restricted accounts authenticate but keep business access denied",
  {
    tag: [
      ...browserTags,
      "@risk-business-denial",
      "@risk-account-status",
      "@mobile-critical",
    ],
  },
  async ({ page, caseApp }) => {
    const pendingPerson = findAccount(restrictedAccounts, "law.pending");
    await caseApp.provision.account(pendingPerson);

    await page.goto("/sign-in");
    await page.getByLabel("Username").fill(pendingPerson.username);
    await page.getByLabel("密碼", { exact: true }).fill(pendingPerson.password);
    await page.getByRole("button", { name: "登入" }).click();

    await expect(page).toHaveURL(/\/status$/u);
    await expect(page.getByRole("heading", { name: "帳戶狀態" })).toBeVisible();

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
  }
);

test(
  "untrusted cross-origin sign-in and sign-out are refused",
  {
    tag: [...httpTags, "@risk-origin", "@risk-csrf", "@risk-session-cookie"],
  },
  async ({ request, account, caseApp, extraHTTPHeaders }) => {
    expect(extraHTTPHeaders.origin).toBe(caseApp.origin);

    const response = await request.post("/api/auth/sign-in/username", {
      data: { password: account.password, username: account.username },
      headers: { origin: "https://evil.example" },
    });
    expect(response.status()).toBe(403);
    expect(response.headers()["set-cookie"]).toBeUndefined();

    const anonymousSession = await request.get("/api/auth/get-session");
    expect(await anonymousSession.json()).toBeNull();
    const business = await request.get("/api/v2/me");
    expect(business.status()).toBe(401);

    const signedIn = await signIn(request, account.username, account.password);
    expect(signedIn.status()).toBe(200);
    const signOut = await request.post("/api/auth/sign-out", {
      data: {},
      headers: { origin: "https://evil.example" },
    });
    expect(signOut.status()).toBe(403);
    const stillSignedIn = await request.get("/api/v2/me");
    expect(stillSignedIn.status()).toBe(200);
  }
);
