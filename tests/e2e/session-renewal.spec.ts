import { randomUUID } from "node:crypto";

import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";

import { expect, test } from "../support/fixtures";
import type { NativeApp } from "../support/fixtures";
import type { ProvisionAccount } from "../worker/provision";

type AccountWithId = ProvisionAccount & { userId: string };

const actorIsolationTest = test.extend<{ secondAccount: AccountWithId }>({
  secondAccount: async ({ caseApp }, use) => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
    const account: ProvisionAccount = {
      email: `${suffix}@example.com`,
      fullName: `陳隔離${suffix}`,
      membershipStatus: "active",
      password: "Synthetic-isolation-password!",
      username: `native.${suffix}`,
    };
    await use({
      ...account,
      userId: await caseApp.provision.account(account),
    });
  },
});

const SESSION_COOKIE = "better-auth.session_token";
const NINETY_DAYS_SECONDS = 90 * 24 * 60 * 60;

/** The session token is the first part of the signed cookie value. */
const sessionToken = async (page: Page): Promise<string | undefined> => {
  const cookies = await page.context().cookies();
  const value = cookies.find((cookie) => cookie.name === SESSION_COOKIE)?.value;
  return value ? decodeURIComponent(value).split(".")[0] : undefined;
};

/** Observe the session that the current browser context actually uses. */
const storedExpiry = async (
  app: NativeApp,
  page: Page
): Promise<number | undefined> => {
  const token = await sessionToken(page);
  if (!token) {
    return undefined;
  }
  const row = await app.db
    .prepare("SELECT expires_at FROM session WHERE token = ?")
    .bind(token)
    .first<{ expires_at: number }>();
  return row?.expires_at;
};

const browserCookieExpiry = async (page: Page): Promise<number | undefined> => {
  const cookies = await page.context().cookies();
  return cookies.find((cookie) => cookie.name === SESSION_COOKIE)?.expires;
};

/** Shorten a real session in the app's D1 so its next valid use must renew. */
const shortenSessionExpiry = async (app: NativeApp, page: Page) => {
  const token = await sessionToken(page);
  const cookies = await page.context().cookies();
  const cookie = cookies.find((entry) => entry.name === SESSION_COOKIE);
  if (!(token && cookie)) {
    throw new Error("Missing native session cookie");
  }
  const expires = Math.floor(Date.now() / 1000) + NINETY_DAYS_SECONDS - 3600;
  const updated = await app.db
    .prepare("UPDATE session SET expires_at = ? WHERE token = ?")
    .bind(expires, token)
    .run();
  expect(updated.meta.changes).toBe(1);
  await page.context().addCookies([{ ...cookie, expires }]);
};

const setMembershipStatus = async (
  app: NativeApp,
  userId: string,
  membershipStatus: ProvisionAccount["membershipStatus"]
) => {
  const updated = await app.db
    .prepare(
      "UPDATE person_profile SET membership_status = ?, updated_at = unixepoch() WHERE user_id = ?"
    )
    .bind(membershipStatus, userId)
    .run();
  expect(updated.meta.changes).toBe(1);
};

const signInThroughApi = async (
  request: APIRequestContext,
  account: Pick<ProvisionAccount, "password" | "username">
) => {
  const response = await request.post("/api/auth/sign-in/username", {
    data: { password: account.password, username: account.username },
  });
  expect(response.status()).toBe(200);
  return response;
};

const openHome = async (page: Page) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "我的主頁" })).toBeVisible();
};

/**
 * Injected persisted pageshow is a separate fault control, not native BFCache.
 */
const dispatchPersistedPageShow = (page: Page, staleMarker: string) =>
  page.evaluate((marker) => {
    window.dispatchEvent(
      new PageTransitionEvent("pageshow", { persisted: true })
    );
    const text = document.body.textContent ?? "";
    return {
      staleDocumentPresent: text.includes(marker),
      visibility: getComputedStyle(document.documentElement).visibility,
    };
  }, staleMarker);

/** Waits for the fresh top-level document request a restore must trigger. */
const nextFreshDocument = (page: Page, pathname: string) =>
  page.waitForRequest(
    (request) =>
      request.isNavigationRequest() &&
      request.resourceType() === "document" &&
      new URL(request.url()).pathname === pathname
  );

test("@native @browser @mobile-critical @risk-session valid use renews the persisted expiry and browser cookie", async ({
  account,
  caseApp,
  page,
}) => {
  const signIn = await signInThroughApi(page.request, account);
  const signInCookie = signIn.headers()["set-cookie"] ?? "";
  expect(signInCookie).toContain(SESSION_COOKIE);
  expect(signInCookie).toContain(`Max-Age=${NINETY_DAYS_SECONDS}`);
  expect(signInCookie).toContain("HttpOnly");
  expect(signInCookie).toContain("SameSite=Lax");

  await shortenSessionExpiry(caseApp, page);
  const beforeExpiry = await storedExpiry(caseApp, page);
  const beforeCookie = await browserCookieExpiry(page);
  expect(beforeExpiry).toBeDefined();
  expect(beforeCookie).toBeDefined();

  const home = await page.goto("/");
  expect(home?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "我的主頁" })).toBeVisible();
  expect(await storedExpiry(caseApp, page)).toBeGreaterThan(beforeExpiry ?? 0);
  expect(await browserCookieExpiry(page)).toBeGreaterThan(beforeCookie ?? 0);
  expect(await storedExpiry(caseApp, page)).toBeGreaterThan(
    Date.now() / 1000 + NINETY_DAYS_SECONDS - 120
  );
  expect(await storedExpiry(caseApp, page)).toBeLessThanOrEqual(
    Date.now() / 1000 + NINETY_DAYS_SECONDS + 1
  );

  await shortenSessionExpiry(caseApp, page);
  const beforeBusiness = await storedExpiry(caseApp, page);
  const business = await page.request.get("/api/v2/me");
  expect(business.status()).toBe(200);
  expect(business.headers()["set-cookie"] ?? "").toContain(SESSION_COOKIE);
  expect(await storedExpiry(caseApp, page)).toBeGreaterThan(
    beforeBusiness ?? 0
  );

  const immediateRead = await page.request.get("/api/v2/me");
  expect(immediateRead.status()).toBe(200);
  expect(immediateRead.headers()["set-cookie"] ?? "").toContain(
    `Max-Age=${NINETY_DAYS_SECONDS}`
  );
});

test("@native @browser @mobile-critical @risk-session an RSC request through the guard also renews the session", async ({
  account,
  caseApp,
  page,
}) => {
  await setMembershipStatus(caseApp, account.userId, "pending");
  await signInThroughApi(page.request, account);
  await page.goto("/status");
  await expect(page.getByRole("heading", { name: "帳戶狀態" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "重新檢查狀態" })
  ).toBeEnabled();

  await shortenSessionExpiry(caseApp, page);
  const beforeExpiry = await storedExpiry(caseApp, page);
  const beforeCookie = await browserCookieExpiry(page);

  const responses: { cacheControl: string; rsc: boolean }[] = [];
  page.on("response", (response) => {
    if (new URL(response.url()).pathname === "/status") {
      responses.push({
        cacheControl: response.headers()["cache-control"] ?? "",
        rsc: response.request().headers()["rsc"] !== undefined,
      });
    }
  });
  await page.getByRole("button", { name: "重新檢查狀態" }).click();
  await expect(
    page.getByRole("button", { name: "重新檢查狀態" })
  ).toBeEnabled();

  const rscResponses = responses.filter((entry) => entry.rsc);
  expect(
    rscResponses.length,
    `captured responses: ${JSON.stringify(responses)}`
  ).toBeGreaterThan(0);
  for (const entry of rscResponses) {
    expect(entry.cacheControl).toContain("no-store");
  }

  expect(await storedExpiry(caseApp, page)).toBeGreaterThan(beforeExpiry ?? 0);
  expect(await browserCookieExpiry(page)).toBeGreaterThan(beforeCookie ?? 0);
});

actorIsolationTest(
  "@native @browser @mobile-critical @risk-cache @risk-session personalized output stays private between two actor pages",
  async ({
    account,
    browser,
    caseApp,
    extraHTTPHeaders,
    page,
    playwright,
    secondAccount,
  }) => {
    await signInThroughApi(page.request, account);
    const secondRequest = await playwright.request.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders,
    });
    let secondContext: BrowserContext | undefined;
    try {
      const secondSignIn = await secondRequest.post(
        "/api/auth/sign-in/username",
        {
          data: {
            password: secondAccount.password,
            username: secondAccount.username,
          },
        }
      );
      expect(secondSignIn.status()).toBe(200);
      secondContext = await browser.newContext({
        baseURL: caseApp.origin,
        extraHTTPHeaders,
        storageState: await secondRequest.storageState(),
      });
      const secondPage = await secondContext.newPage();

      const firstHome = await page.goto("/");
      const secondHome = await secondPage.goto("/");
      for (const response of [firstHome, secondHome]) {
        expect(response?.headers()["cache-control"] ?? "").toContain("private");
        expect(response?.headers()["cache-control"] ?? "").toContain(
          "no-store"
        );
      }
      await expect(
        page.getByText(`歡迎回來，${account.fullName}。`)
      ).toBeVisible();
      await expect(
        page.getByText(`歡迎回來，${secondAccount.fullName}。`)
      ).toHaveCount(0);
      await expect(
        secondPage.getByText(`歡迎回來，${secondAccount.fullName}。`)
      ).toBeVisible();
      await expect(
        secondPage.getByText(`歡迎回來，${account.fullName}。`)
      ).toHaveCount(0);

      const firstBusiness = await page.request.get("/api/v2/me");
      const secondBusiness = await secondPage.request.get("/api/v2/me");
      expect(firstBusiness.status()).toBe(200);
      expect(secondBusiness.status()).toBe(200);
      expect(firstBusiness.headers()["cache-control"] ?? "").toContain(
        "no-store"
      );
      expect(secondBusiness.headers()["cache-control"] ?? "").toContain(
        "no-store"
      );
      const firstSession = await page.request.get("/api/auth/get-session");
      const secondSession = await secondPage.request.get(
        "/api/auth/get-session"
      );
      expect(firstSession.headers()["set-cookie"] ?? "").toContain(
        SESSION_COOKIE
      );
      expect(secondSession.headers()["set-cookie"] ?? "").toContain(
        SESSION_COOKIE
      );
    } finally {
      await secondContext?.close();
      await secondRequest.dispose();
    }
  }
);

test("@native @browser @mobile-critical @risk-session expired and tampered sessions fail the next protected request", async ({
  account,
  caseApp,
  page,
}) => {
  await signInThroughApi(page.request, account);
  const initialRead = await page.request.get("/api/v2/me");
  expect(initialRead.status()).toBe(200);

  const token = await sessionToken(page);
  if (!token) {
    throw new Error("Missing native session token");
  }
  const expired = await caseApp.db
    .prepare(
      "UPDATE session SET expires_at = unixepoch() - 600 WHERE token = ?"
    )
    .bind(token)
    .run();
  expect(expired.meta.changes).toBe(1);

  const expiredRead = await page.request.get("/api/v2/me");
  expect(expiredRead.status()).toBe(401);
  await page.goto("/");
  await expect(page.getByRole("status")).toBeVisible();
  await expect(page).toHaveURL(/\/sign-in\?reason=authentication-required$/u);

  await signInThroughApi(page.request, account);
  await page.context().addCookies([
    {
      httpOnly: true,
      name: SESSION_COOKIE,
      sameSite: "Lax",
      url: caseApp.origin,
      value: "tampered.signature",
    },
  ]);
  const tamperedStatus = await page.evaluate(async () => {
    const response = await fetch("/api/v2/me", {
      headers: { accept: "application/json" },
    });
    return response.status;
  });
  expect(tamperedStatus).toBe(401);
});

test("@native @browser @mobile-critical @risk-history @risk-session confirmed sign-out protects private content on native history back", async ({
  account,
  page,
}) => {
  await page.goto("/sign-in");
  await page.getByLabel("Username").fill(account.username);
  await page.getByLabel("密碼", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "登入" }).click();
  await expect(page.getByRole("heading", { name: "我的主頁" })).toBeVisible();

  await openHome(page);
  const historyProbe = "session-renewal-history-probe";
  await page.evaluate((key) => {
    sessionStorage.removeItem(`${key}:pagehide-hidden`);
    sessionStorage.removeItem(`${key}:pageshow-persisted`);
    sessionStorage.removeItem(`${key}:restored-hidden`);
    window.addEventListener("pagehide", (event) => {
      if (event.persisted) {
        queueMicrotask(() => {
          sessionStorage.setItem(
            `${key}:pagehide-hidden`,
            String(
              window.getComputedStyle(document.documentElement).visibility ===
                "hidden"
            )
          );
        });
      }
    });
    window.addEventListener("pageshow", (event) => {
      if (event.persisted) {
        sessionStorage.setItem(`${key}:pageshow-persisted`, "true");
        queueMicrotask(() => {
          sessionStorage.setItem(
            `${key}:restored-hidden`,
            String(
              window.getComputedStyle(document.documentElement).visibility ===
                "hidden"
            )
          );
        });
      }
    });
  }, historyProbe);
  await page.goto("/status");
  await expect(page.getByRole("heading", { name: "帳戶狀態" })).toBeVisible();
  await expect(page.getByRole("button", { name: "登出" })).toBeVisible();

  const signOut = page.getByRole("button", { name: "登出" });
  await expect(signOut).toBeVisible();
  await expect(signOut).toBeEnabled();
  await signOut.click();
  await expect(page).toHaveURL(/\/sign-in$/u);

  const signedOutBusiness = await page.request.get("/api/v2/me");
  expect(signedOutBusiness.status()).toBe(401);
  const home = await page.request.get("/", { maxRedirects: 0 });
  expect(home.status()).toBe(307);
  expect(home.headers().location).toBe(
    "/sign-in?reason=authentication-required"
  );

  const freshDocument = nextFreshDocument(page, "/");
  await page.goBack();
  await freshDocument;
  await expect(page).toHaveURL(/\/sign-in\?reason=authentication-required$/u);
  await expect(page.getByRole("heading", { name: "登入" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "我的主頁" })).toHaveCount(0);

  const nativeHistory = await page.evaluate(
    (key) => ({
      pagehideSnapshotHidden:
        sessionStorage.getItem(`${key}:pagehide-hidden`) === "true",
      pageshowPersisted:
        sessionStorage.getItem(`${key}:pageshow-persisted`) === "true",
      restoredSnapshotHidden:
        sessionStorage.getItem(`${key}:restored-hidden`) === "true",
    }),
    historyProbe
  );
  if (nativeHistory.pageshowPersisted) {
    expect(nativeHistory.pagehideSnapshotHidden).toBe(true);
    expect(nativeHistory.restoredSnapshotHidden).toBe(true);
  }
  const restoredBusiness = await page.request.get("/api/v2/me");
  expect(restoredBusiness.status()).toBe(401);
  test.info().annotations.push({
    description: nativeHistory.pageshowPersisted
      ? "The browser restored a native BFCache snapshot, concealed it on pagehide/pageshow, then revalidated the revoked session through a fresh protected document."
      : "Native browser back did not restore a BFCache snapshot (pageshow.persisted=false); a fresh protected document denied the revoked session.",
    type: nativeHistory.pageshowPersisted
      ? "history-restore-native-bfcache"
      : "history-restore-native-document",
  });
});

test("@native @browser @mobile-critical @risk-history @risk-session injected persisted pageshow conceals Home before a fresh document", async ({
  account,
  page,
}) => {
  await signInThroughApi(page.request, account);
  await openHome(page);

  const identity = page.getByText(`歡迎回來，${account.fullName}。`);
  await expect(identity).toBeVisible();

  const confirmed = await page.evaluate(async () => {
    const response = await fetch("/api/auth/sign-out", {
      body: JSON.stringify({}),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    return response.ok;
  });
  expect(confirmed).toBe(true);
  const signedOutBusiness = await page.request.get("/api/v2/me");
  expect(signedOutBusiness.status()).toBe(401);

  const freshDocument = nextFreshDocument(page, "/");
  const restored = await dispatchPersistedPageShow(page, account.fullName);
  expect(restored).toEqual({
    staleDocumentPresent: true,
    visibility: "hidden",
  });

  await freshDocument;
  await expect(page).toHaveURL(/\/sign-in\?reason=authentication-required$/u);
  await expect(page.getByRole("heading", { name: "登入" })).toBeVisible();
  test.info().annotations.push({
    description:
      "Injected persisted pageshow with a real revoked session concealed the stale document before a fresh document denied it; not native BFCache evidence.",
    type: "history-restore-injected",
  });
});

test("@native @browser @mobile-critical @risk-history @risk-session injected persisted pageshow conceals restricted status before a fresh document", async ({
  account,
  caseApp,
  page,
}) => {
  await setMembershipStatus(caseApp, account.userId, "pending");
  await signInThroughApi(page.request, account);
  await page.goto("/status");
  await expect(page.getByRole("heading", { name: "帳戶狀態" })).toBeVisible();
  await expect(
    page.getByRole("main").getByText(account.fullName)
  ).toBeVisible();

  const signedOut = await page.evaluate(async () => {
    const response = await fetch("/api/auth/sign-out", {
      body: JSON.stringify({}),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    return response.ok;
  });
  expect(signedOut).toBe(true);
  const signedOutBusiness = await page.request.get("/api/v2/me");
  expect(signedOutBusiness.status()).toBe(401);

  const freshDocument = nextFreshDocument(page, "/status");
  const restored = await dispatchPersistedPageShow(page, account.fullName);
  expect(restored).toEqual({
    staleDocumentPresent: true,
    visibility: "hidden",
  });

  await freshDocument;
  await expect(page).toHaveURL(/\/sign-in\?reason=authentication-required$/u);
  await expect(page.getByRole("heading", { name: "登入" })).toBeVisible();
  test.info().annotations.push({
    description:
      "Injected persisted pageshow on /status with a real revoked session concealed the stale document before a fresh document denied it; not native BFCache evidence.",
    type: "history-restore-injected",
  });
});

test("@native @browser @mobile-critical @risk-history @risk-session injected persisted pageshow reloads a valid session as a fresh document", async ({
  account,
  page,
}) => {
  await signInThroughApi(page.request, account);
  await openHome(page);

  const identity = page.getByText(`歡迎回來，${account.fullName}。`);
  await expect(identity).toBeVisible();
  await page.evaluate(() => {
    window.location.hash = "history-test";
  });

  const freshDocument = nextFreshDocument(page, "/");
  const restored = await dispatchPersistedPageShow(page, account.fullName);
  expect(restored).toEqual({
    staleDocumentPresent: true,
    visibility: "hidden",
  });

  await freshDocument;
  await expect(page).toHaveURL(/\/#history-test$/u);
  await expect(page.getByRole("heading", { name: "我的主頁" })).toBeVisible();
  await expect(identity).toBeVisible();
  test.info().annotations.push({
    description:
      "Injected persisted pageshow with a valid session concealed the stale document and restored Home from a fresh hash-preserving document; not native BFCache evidence.",
    type: "history-restore-injected",
  });
});

test("@native @browser @mobile-critical @risk-history @risk-session failed injected history revalidation never exposes private content", async ({
  account,
  page,
}) => {
  await signInThroughApi(page.request, account);
  await openHome(page);

  const identity = page.getByText(`歡迎回來，${account.fullName}。`);
  await expect(identity).toBeVisible();
  await page.evaluate(async () => {
    await fetch("/api/auth/sign-out", {
      body: JSON.stringify({}),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
  });

  await page.route("**/*", (route) => {
    const request = route.request();
    if (
      request.isNavigationRequest() &&
      new URL(request.url()).pathname === "/"
    ) {
      return route.abort("failed");
    }
    return route.continue();
  });
  const failedNavigation = page.waitForEvent(
    "requestfailed",
    (request) =>
      request.isNavigationRequest() && new URL(request.url()).pathname === "/"
  );

  const restored = await dispatchPersistedPageShow(page, account.fullName);
  expect(restored).toEqual({
    staleDocumentPresent: true,
    visibility: "hidden",
  });
  await failedNavigation;

  const leaked = await page.evaluate(() => {
    const heading = [...document.querySelectorAll("h1")].find(
      (element) => element.textContent === "我的主頁"
    );
    return heading ? getComputedStyle(heading).visibility !== "hidden" : false;
  });
  expect(leaked).toBe(false);
  test.info().annotations.push({
    description:
      "Injected persisted pageshow; the fresh document request was aborted and the stale private document remained concealed; not native BFCache evidence.",
    type: "history-restore-injected-failure",
  });
});

test("@native @browser @mobile-critical @risk-session a lost sign-out response stays unconfirmed and retry settles it", async ({
  account,
  page,
}) => {
  await signInThroughApi(page.request, account);
  await openHome(page);
  await page.goto("/account");
  const signOutPage = page.url();

  await page.route("**/api/auth/sign-out", (route) => route.abort("failed"));
  await page.getByRole("button", { name: "登出" }).click();

  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(signOutPage);
  const retainedBusiness = await page.request.get("/api/v2/me");
  expect(retainedBusiness.status()).toBe(200);

  await page.unroute("**/api/auth/sign-out");
  await page.getByRole("button", { name: "重試登出" }).click();
  await expect(page).toHaveURL(/\/sign-in$/u);
  const signedOutBusiness = await page.request.get("/api/v2/me");
  expect(signedOutBusiness.status()).toBe(401);
});

test("@native @browser @mobile-critical @risk-session a response lost after sign-out completion is never reported as an active session", async ({
  account,
  page,
}) => {
  await signInThroughApi(page.request, account);
  await openHome(page);
  await page.goto("/account");

  await page.route("**/api/auth/sign-out", async (route) => {
    await route.fetch();
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "登出" }).click();

  await expect(
    page.getByRole("alert").or(page.getByRole("heading", { name: "登入" }))
  ).toBeVisible();
  await page.unroute("**/api/auth/sign-out");

  if (await page.getByRole("alert").isVisible()) {
    await page.getByRole("button", { name: "重試登出" }).click();
  }
  await expect(page).toHaveURL(/\/sign-in$/u);
  const signedOutBusiness = await page.request.get("/api/v2/me");
  expect(signedOutBusiness.status()).toBe(401);
});
