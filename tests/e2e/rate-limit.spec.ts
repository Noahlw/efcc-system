import { isIP } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

import type { APIRequestContext } from "@playwright/test";

import { approvedAccounts, findAccount } from "../scenarios/accounts";
import { dedicatedTest, expect } from "../support/fixtures";
import type { NativeApp } from "../support/fixtures";
import type { ProvisionAccount } from "../worker/provision";

const httpTags = ["@native", "@rate-limit", "@http"] as const;
const SIGN_IN_WINDOW_MS = 10_000;
const wong = findAccount(approvedAccounts, "wong.tai.ming");
const chan = findAccount(approvedAccounts, "Chan.Siu.Fong");

interface RateLimitRow {
  key: string;
  count: number;
  last_request: number;
}
// The fixture emits a four-hextet IPv6 /64; Better Auth persists its expanded network.
const normalizedRateLimitIp = (ip: string): string => {
  const groups = ip.split("::", 1)[0]?.split(":");
  if (isIP(ip) !== 6 || !groups || groups.length !== 4) {
    throw new Error(
      `Expected the native fixture's IPv6 /64 address, got ${ip}`
    );
  }
  return `${groups.map((group) => group.padStart(4, "0")).join(":")}:0000:0000:0000:0000`;
};

const attemptUsername = (
  request: APIRequestContext,
  username: string,
  password: string
) =>
  request.post("/api/auth/sign-in/username", {
    data: { password, username },
  });

const attemptName = (
  request: APIRequestContext,
  fullName: string,
  password: string
) => request.post("/api/auth/sign-in/name", { data: { fullName, password } });

const readRateLimitBucket = async (
  app: NativeApp,
  signInPath: "/sign-in/name" | "/sign-in/username"
): Promise<RateLimitRow> => {
  const rows = await app.db
    .prepare("SELECT key, count, last_request FROM rate_limit WHERE key LIKE ?")
    .bind(`%|${signInPath}`)
    .all<RateLimitRow>();
  expect(rows.results).toHaveLength(1);
  const [row] = rows.results;
  if (!row) {
    throw new Error(`Missing D1 limiter bucket for ${signInPath}`);
  }
  return row;
};

const waitForObservedWindow = async (row: RateLimitRow): Promise<void> => {
  const waitMs = row.last_request + SIGN_IN_WINDOW_MS + 100 - Date.now();
  if (waitMs > 0) {
    await delay(waitMs);
  }
};

dedicatedTest(
  "Username attempts share one case-owned IP bucket and recover after the real window",
  {
    tag: [
      ...httpTags,
      "@risk-real-limiter",
      "@risk-shared-bucket",
      "@risk-recovery",
    ],
  },
  async ({ request, caseApp, account, extraHTTPHeaders }) => {
    const second: ProvisionAccount = {
      email: `other-${account.email}`,
      fullName: `${account.fullName}乙`,
      membershipStatus: "active",
      password: "Synthetic-second-native-password!",
      username: `${account.username}.other`,
    };
    await caseApp.provision.account(second);

    // Different Username values still consume this request context's same IP bucket.
    const firstWindow = await Promise.all([
      attemptUsername(request, account.username, "wrong-password-1"),
      attemptUsername(request, second.username, "wrong-password-2"),
      attemptUsername(request, account.username, "wrong-password-3"),
    ]);
    for (const response of firstWindow) {
      expect(response.status()).toBe(401);
    }

    const refused = await attemptUsername(
      request,
      second.username,
      "wrong-password-4"
    );
    expect(refused.status()).toBe(429);
    expect(refused.headers()["x-retry-after"]).toBeDefined();
    const bucket = await readRateLimitBucket(caseApp, "/sign-in/username");

    const clientIp = extraHTTPHeaders?.["cf-connecting-ip"];
    if (!clientIp) {
      throw new Error("Missing native test client IP header");
    }
    expect(bucket.key).toBe(
      `${normalizedRateLimitIp(clientIp)}|/sign-in/username`
    );
    expect(bucket.count).toBeGreaterThanOrEqual(3);

    // Wait only on this isolated bucket's observed D1 timestamp; no shared scan or fake clock.
    await waitForObservedWindow(bucket);
    const recovered = await attemptUsername(
      request,
      account.username,
      account.password
    );
    expect(recovered.status()).toBe(200);
    const identity = await request.get("/api/v2/me");
    expect(await identity.json()).toEqual({
      data: {
        displayName: account.fullName,
        membershipStatus: "active",
        username: account.username,
      },
    });
    const recoveredBucket = await readRateLimitBucket(
      caseApp,
      "/sign-in/username"
    );
    expect(recoveredBucket.count).toBe(1);
  }
);

dedicatedTest(
  "the name entry has its own shared bucket and recovers after the real window",
  {
    tag: [
      ...httpTags,
      "@risk-real-limiter",
      "@risk-shared-bucket",
      "@risk-recovery",
    ],
  },
  async ({ request, playwright, caseApp, extraHTTPHeaders }) => {
    await caseApp.provision.account(wong);
    await caseApp.provision.account(chan);

    const firstWindow = await Promise.all([
      attemptName(request, wong.fullName, "wrong-password-1"),
      attemptName(request, chan.fullName, "wrong-password-2"),
      attemptName(request, wong.fullName, "wrong-password-3"),
    ]);
    for (const response of firstWindow) {
      expect(response.status()).toBe(401);
    }

    const refused = await attemptName(
      request,
      chan.fullName,
      "wrong-password-4"
    );
    expect(refused.status()).toBe(429);
    const bucket = await readRateLimitBucket(caseApp, "/sign-in/name");

    const clientIp = extraHTTPHeaders?.["cf-connecting-ip"];
    if (!clientIp) {
      throw new Error("Missing native test client IP header");
    }
    expect(bucket.key).toBe(`${normalizedRateLimitIp(clientIp)}|/sign-in/name`);
    expect(bucket.count).toBeGreaterThanOrEqual(3);

    // The name limiter does not consume the separate Username path's bucket.
    const usernameContext = await playwright.request.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders,
    });
    try {
      const usernameSignIn = await attemptUsername(
        usernameContext,
        chan.username,
        chan.password
      );
      expect(usernameSignIn.status()).toBe(200);
    } finally {
      await usernameContext.dispose();
    }

    // Valid name credentials recover only after the observed name window expires.
    await waitForObservedWindow(bucket);
    const recovered = await attemptName(request, chan.fullName, chan.password);
    expect(recovered.status()).toBe(200);
    const identity = await request.get("/api/v2/me");
    expect(await identity.json()).toEqual({
      data: {
        displayName: chan.fullName,
        membershipStatus: "active",
        username: chan.username,
      },
    });
    const recoveredBucket = await readRateLimitBucket(caseApp, "/sign-in/name");
    expect(recoveredBucket.count).toBe(1);
  }
);

dedicatedTest(
  "native Better Auth pruning preserves a live business request bucket",
  {
    tag: [
      ...httpTags,
      "@risk-real-limiter",
      "@risk-shared-bucket",
      "@risk-recovery",
    ],
  },
  async ({ request, caseApp, account, extraHTTPHeaders }) => {
    const clientIp = extraHTTPHeaders?.["cf-connecting-ip"];
    if (!clientIp) {
      throw new Error("Missing native test client IP header");
    }

    const businessKey = `application:create:${clientIp}`;
    const businessResponse = await request.post("/api/v2/applications", {
      data: Buffer.from("{"),
      headers: {
        ...extraHTTPHeaders,
        "content-type": "application/json",
      },
    });
    expect(businessResponse.status()).toBe(400);
    const businessBefore = await caseApp.db
      .prepare(
        "SELECT key, count, last_request FROM business_rate_limit WHERE key=?"
      )
      .bind(businessKey)
      .first<RateLimitRow>();
    expect(businessBefore?.count).toBe(1);
    expect(businessBefore?.last_request).toBeGreaterThan(0);

    const failedSignIn = await attemptUsername(
      request,
      account.username,
      "Synthetic-wrong-native-password!"
    );
    expect(failedSignIn.status()).toBe(401);
    const nativeBucket = await readRateLimitBucket(
      caseApp,
      "/sign-in/username"
    );
    await caseApp.db
      .prepare("UPDATE rate_limit SET count=1, last_request=0 WHERE key=?")
      .bind(nativeBucket.key)
      .run();

    const recoveredSignIn = await attemptUsername(
      request,
      account.username,
      account.password
    );
    expect(recoveredSignIn.status()).toBe(200);
    const recoveredNativeBucket = await readRateLimitBucket(
      caseApp,
      "/sign-in/username"
    );
    expect(recoveredNativeBucket.count).toBe(1);
    expect(recoveredNativeBucket.last_request).toBeGreaterThan(0);

    const businessAfter = await caseApp.db
      .prepare(
        "SELECT key, count, last_request FROM business_rate_limit WHERE key=?"
      )
      .bind(businessKey)
      .first<RateLimitRow>();
    expect(businessAfter).toEqual(businessBefore);
  }
);
