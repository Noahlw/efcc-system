import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import {
  approvedAccounts,
  findAccount,
  restrictedAccounts,
} from "../scenarios/accounts";
import { waitForSignInWindow } from "../scenarios/limiter";
import { queryLocalSql, seedSyntheticAccounts } from "./seed";

const wong = findAccount(approvedAccounts, "wong.tai.ming");
const pendingPerson = findAccount(restrictedAccounts, "law.pending");

const SESSION_COOKIE = "better-auth.session_token";
const NINETY_DAYS_SECONDS = 90 * 24 * 60 * 60;

/** The session token is the first part of the signed cookie value. */
const sessionToken = async (page: Page): Promise<string | undefined> => {
  const cookies = await page.context().cookies();
  const value = cookies.find((cookie) => cookie.name === SESSION_COOKIE)?.value;
  return value ? decodeURIComponent(value).split(".")[0] : undefined;
};

/** Reads the persisted expiry of the session the browser is actually using. */
const storedExpiry = async (page: Page): Promise<number | undefined> => {
  const token = await sessionToken(page);
  if (!token) {
    return undefined;
  }
  return queryLocalSql<{ expires_at: number }>(
    `select expires_at from session where token = '${token}'`
  ).at(0)?.expires_at;
};

const browserCookieExpiry = async (page: Page): Promise<number | undefined> => {
  const cookies = await page.context().cookies();
  return cookies.find((cookie) => cookie.name === SESSION_COOKIE)?.expires;
};

const signInThroughApi = async (
  page: Page,
  username: string,
  password: string
) => {
  await waitForSignInWindow();
  const response = await page.request.post("/api/auth/sign-in/username", {
    data: { password, username },
  });
  expect(response.status()).toBe(200);
  return response;
};

const openHome = async (page: Page) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "我的主頁" })).toBeVisible();
  // Client components must be interactive before clicking them.
  await page.waitForLoadState("networkidle");
};
/**
 * Dispatches a persisted pageshow and measures the stale document in the same
 * synchronous task, so the assertion cannot race the fresh document request.
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

test.beforeAll(async () => {
  await seedSyntheticAccounts();
});

test("valid use renews the persisted expiry and the browser cookie", async ({
  page,
}) => {
  const signIn = await signInThroughApi(page, wong.username, wong.password);
  const signInCookie = signIn.headers()["set-cookie"] ?? "";
  expect(signInCookie).toContain(SESSION_COOKIE);
  expect(signInCookie).toContain(`Max-Age=${NINETY_DAYS_SECONDS}`);
  expect(signInCookie).toContain("HttpOnly");
  expect(signInCookie).toContain("SameSite=Lax");

  const beforeExpiry = await storedExpiry(page);
  const beforeCookie = await browserCookieExpiry(page);
  expect(beforeExpiry).toBeDefined();
  expect(beforeCookie).toBeDefined();

  // A full-page request renews the exact 90-day idle window in D1 and in the
  // browser cookie. (Playwright does not expose Set-Cookie for navigations, so
  // renewal is asserted on the persisted row and the cookie jar.)
  await page.goto("/");
  expect(await storedExpiry(page)).toBeGreaterThan(beforeExpiry ?? 0);
  expect(await browserCookieExpiry(page)).toBeGreaterThan(beforeCookie ?? 0);
  expect(await storedExpiry(page)).toBeGreaterThan(
    Date.now() / 1000 + NINETY_DAYS_SECONDS - 120
  );

  // Business reads renew too, and their Set-Cookie header is observable.
  const beforeBusiness = await storedExpiry(page);
  const business = await page.request.get("/api/v2/me");
  expect(business.status()).toBe(200);
  expect(business.headers()["set-cookie"] ?? "").toContain(SESSION_COOKIE);
  expect(await storedExpiry(page)).toBeGreaterThan(beforeBusiness ?? 0);
});

test("an RSC request through the guard also renews the session", async ({
  page,
}) => {
  await signInThroughApi(page, pendingPerson.username, pendingPerson.password);
  await page.goto("/status");
  await expect(page.getByRole("heading", { name: "帳戶狀態" })).toBeVisible();
  await page.waitForLoadState("networkidle");

  const beforeExpiry = await storedExpiry(page);
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

  // The RSC render alone is not the renewal evidence: the guard that precedes
  // it renewed both the persisted expiry and the browser cookie.
  expect(await storedExpiry(page)).toBeGreaterThan(beforeExpiry ?? 0);
  expect(await browserCookieExpiry(page)).toBeGreaterThan(beforeCookie ?? 0);
});

test("personalised output is private and not shared", async ({ page }) => {
  await signInThroughApi(page, wong.username, wong.password);

  const home = await page.goto("/");
  expect(home?.headers()["cache-control"] ?? "").toContain("no-store");

  const business = await page.request.get("/api/v2/me");
  expect(business.headers()["cache-control"] ?? "").toContain("no-store");

  const session = await page.request.get("/api/auth/get-session");
  expect(session.headers()["set-cookie"] ?? "").toContain(SESSION_COOKIE);
});

test("expired and tampered sessions fail the next protected request", async ({
  page,
}) => {
  await signInThroughApi(page, wong.username, wong.password);
  const initialRead = await page.request.get("/api/v2/me");
  expect(initialRead.status()).toBe(200);

  // Expire the session the browser is using, directly in D1.
  const before = await storedExpiry(page);
  expect(before).toBeDefined();
  const token = await sessionToken(page);
  queryLocalSql<{ id: string }>(
    `update session set expires_at = unixepoch() - 600 where token = '${token}'`
  );

  const expiredRead = await page.request.get("/api/v2/me");
  expect(expiredRead.status()).toBe(401);

  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in$/u);

  // A tampered cookie value never authorises a protected request. The jar is
  // replaced with a structurally valid but unsigned value.
  await signInThroughApi(page, wong.username, wong.password);
  await page.context().addCookies([
    {
      httpOnly: true,
      name: SESSION_COOKIE,
      sameSite: "Lax",
      url: "http://localhost:5199/",
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

test("a confirmed sign-out denies later requests and survives history", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page.waitForLoadState("networkidle");
  await waitForSignInWindow();
  await page.getByLabel("使用者名稱").fill(wong.username);
  await page.getByLabel("密碼").fill(wong.password);
  await page.getByRole("button", { name: "登入" }).click();
  await expect(page.getByRole("heading", { name: "我的主頁" })).toBeVisible();

  // Leave a protected history entry behind, then sign out from /status.
  await openHome(page);
  const historyProbe = "session-renewal-history-probe";
  await page.evaluate((key) => {
    sessionStorage.removeItem(`${key}:pagehide-hidden`);
    sessionStorage.removeItem(`${key}:pageshow-persisted`);
    window.addEventListener("pagehide", (event) => {
      if (event.persisted) {
        sessionStorage.setItem(
          `${key}:pagehide-hidden`,
          String(
            window.getComputedStyle(document.documentElement).visibility ===
              "hidden"
          )
        );
      }
    });
    window.addEventListener("pageshow", (event) => {
      if (event.persisted) {
        sessionStorage.setItem(`${key}:pageshow-persisted`, "true");
      }
    });
  }, historyProbe);

  await page.goto("/status");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("button", { name: "登出" })).toBeVisible();
  await page.getByRole("button", { name: "登出" }).click();
  await expect(page).toHaveURL(/\/sign-in$/u);

  const afterSignOut = await page.request.get("/api/v2/me");
  expect(afterSignOut.status()).toBe(401);
  const home = await page.request.get("/", { maxRedirects: 0 });
  expect(home.status()).toBe(307);
  expect(home.headers().location).toBe("/sign-in");

  // Going back must not leave authorised content on screen.
  await page.goBack();
  await expect(page.getByRole("heading", { name: "我的主頁" })).toHaveCount(0);
  const nativeHistory = await page.evaluate(
    (key) => ({
      pagehideSnapshotHidden:
        sessionStorage.getItem(`${key}:pagehide-hidden`) === "true",
      pageshowPersisted:
        sessionStorage.getItem(`${key}:pageshow-persisted`) === "true",
    }),
    historyProbe
  );
  test.info().annotations.push({
    description: `Native BFCache pagehide-hidden=${nativeHistory.pagehideSnapshotHidden}; pageshow.persisted=${nativeHistory.pageshowPersisted}; landed on ${page.url()}`,
    type: "history-restore-native-bfcache",
  });

  if (new URL(page.url()).pathname === "/") {
    // A restored snapshot is revalidated through the server boundary.
    await expect(page).toHaveURL(/\/sign-in$/u);
  }
  const rechecked = await page.request.get("/api/v2/me");
  expect(rechecked.status()).toBe(401);
});
test("injected persisted pageshow conceals Home before a fresh document", async ({
  page,
}) => {
  await signInThroughApi(page, wong.username, wong.password);
  await openHome(page);

  const identity = page.getByText(`歡迎回來，${wong.fullName}。`);
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

  const denied = await page.request.get("/api/v2/me");
  expect(denied.status()).toBe(401);

  const freshDocument = nextFreshDocument(page, "/");
  // Concealment happens in the same task as the restored event, before the
  // fresh document request the reload starts.
  const restored = await dispatchPersistedPageShow(page, wong.fullName);
  expect(restored).toEqual({
    staleDocumentPresent: true,
    visibility: "hidden",
  });

  // The fresh authoritative document replaces it and denies the revoked session.
  await freshDocument;
  await expect(page).toHaveURL(/\/sign-in$/u);
  await expect(page.getByRole("heading", { name: "登入" })).toBeVisible();
  test.info().annotations.push({
    description:
      "Injected persisted pageshow with a real revoked session; concealment measured in the event task, then a fresh document denied it. Not native BFCache evidence.",
    type: "history-restore-injected",
  });
});
test("injected persisted pageshow conceals restricted status before a fresh document", async ({
  page,
}) => {
  await signInThroughApi(page, pendingPerson.username, pendingPerson.password);
  await page.goto("/status");
  await expect(page.getByRole("heading", { name: "帳戶狀態" })).toBeVisible();
  await expect(
    page.getByText("你的帳戶目前無法使用教會功能，原因如下。")
  ).toBeVisible();
  await page.waitForLoadState("networkidle");

  const signedOut = await page.evaluate(async () => {
    const response = await fetch("/api/auth/sign-out", {
      body: JSON.stringify({}),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    return response.ok;
  });
  expect(signedOut).toBe(true);

  const freshDocument = nextFreshDocument(page, "/status");
  const restored = await dispatchPersistedPageShow(
    page,
    "你的帳戶目前無法使用教會功能"
  );
  expect(restored).toEqual({
    staleDocumentPresent: true,
    visibility: "hidden",
  });

  await freshDocument;
  await expect(page).toHaveURL(/\/sign-in$/u);
  await expect(page.getByRole("heading", { name: "登入" })).toBeVisible();
  test.info().annotations.push({
    description:
      "Injected persisted pageshow on /status with a real revoked session; concealment measured in the event task, then a fresh document denied it. Not native BFCache evidence.",
    type: "history-restore-injected",
  });
});

test("injected persisted pageshow reloads a valid session as a fresh document", async ({
  page,
}) => {
  await signInThroughApi(page, wong.username, wong.password);
  await openHome(page);

  const identity = page.getByText(`歡迎回來，${wong.fullName}。`);
  await expect(identity).toBeVisible();
  await page.evaluate(() => {
    window.location.hash = "history-test";
  });

  const freshDocument = nextFreshDocument(page, "/");
  const restored = await dispatchPersistedPageShow(page, wong.fullName);
  expect(restored).toEqual({
    staleDocumentPresent: true,
    visibility: "hidden",
  });

  // A valid session gets a fresh full document, not a trusted snapshot.
  await freshDocument;
  await expect(page).toHaveURL(/\/#history-test$/u);
  await expect(page.getByRole("heading", { name: "我的主頁" })).toBeVisible();
  await expect(identity).toBeVisible();
  test.info().annotations.push({
    description:
      "Injected persisted pageshow with a valid session; the hash-preserving fresh document restored Home. Not native BFCache evidence.",
    type: "history-restore-injected",
  });
});

test("failed injected history revalidation never exposes private content", async ({
  page,
}) => {
  await signInThroughApi(page, wong.username, wong.password);
  await openHome(page);

  const identity = page.getByText(`歡迎回來，${wong.fullName}。`);
  await expect(identity).toBeVisible();
  await page.evaluate(async () => {
    await fetch("/api/auth/sign-out", {
      body: JSON.stringify({}),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
  });

  // The fresh document never arrives: the reload is aborted at the network.
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

  const restored = await dispatchPersistedPageShow(page, wong.fullName);
  expect(restored).toEqual({
    staleDocumentPresent: true,
    visibility: "hidden",
  });
  await failedNavigation;

  // Whatever the browser leaves on screen, private content must stay unseen.
  const leaked = await page.evaluate(() => {
    const heading = [...document.querySelectorAll("h1")].find(
      (element) => element.textContent === "我的主頁"
    );
    return heading ? getComputedStyle(heading).visibility !== "hidden" : false;
  });
  expect(leaked).toBe(false);
  test.info().annotations.push({
    description:
      "Injected persisted pageshow; the fresh document response was aborted, and the stale private document stayed concealed.",
    type: "history-restore-injected-failure",
  });
});

test("a lost sign-out response stays unconfirmed and retry settles it", async ({
  page,
}) => {
  await signInThroughApi(page, wong.username, wong.password);
  await openHome(page);

  // The request never reaches the server.
  await page.route("**/api/auth/sign-out", (route) => route.abort("failed"));
  await page.getByRole("button", { name: "登出" }).click();

  await expect(page.getByRole("alert")).toContainText("未能確認登出結果");
  await expect(page).toHaveURL(/\/$/u);
  // No claim of revocation: the session is still active authoritatively.
  const stillActive = await page.request.get("/api/v2/me");
  expect(stillActive.status()).toBe(200);

  // The retry performs a real sign-out and then denies later requests.
  await page.unroute("**/api/auth/sign-out");
  await page.getByRole("button", { name: "重新確認登出" }).click();
  await expect(page).toHaveURL(/\/sign-in$/u);
  const settled = await page.request.get("/api/v2/me");
  expect(settled.status()).toBe(401);
});

test("a response lost after completion is never reported as an active session", async ({
  page,
}) => {
  await signInThroughApi(page, wong.username, wong.password);
  await openHome(page);

  // The server processes the sign-out, but the browser never sees the response.
  await page.route("**/api/auth/sign-out", async (route) => {
    await route.fetch();
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "登出" }).click();

  // Either the app asks the server and settles, or it reports the unknown
  // result; both are truthful, and neither claims an active session.
  await expect(
    page.getByRole("alert").or(page.getByRole("heading", { name: "登入" }))
  ).toBeVisible();
  await page.unroute("**/api/auth/sign-out");

  if (await page.getByRole("alert").isVisible()) {
    await page.getByRole("button", { name: "重新確認登出" }).click();
  }
  await expect(page).toHaveURL(/\/sign-in$/u);
  const settled = await page.request.get("/api/v2/me");
  expect(settled.status()).toBe(401);
});
