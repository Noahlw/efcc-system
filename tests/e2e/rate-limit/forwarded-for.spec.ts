import { setTimeout as delay } from "node:timers/promises";

import type { APIRequestContext, APIResponse } from "@playwright/test";

import { dedicatedTest, expect } from "../../support/fixtures";

const spoofedAddresses = [
  "203.0.113.10",
  "203.0.113.20",
  "203.0.113.30",
  "203.0.113.40",
];
const expectRotatingForwardedForCannotEvade = async (
  request: APIRequestContext,
  signInPath: "/sign-in/name" | "/sign-in/username",
  account: { fullName: string; password: string; username: string },
  attempt: (
    api: APIRequestContext,
    forwardedFor: string,
    attemptPassword: string
  ) => Promise<APIResponse>
): Promise<void> => {
  const attempts = await Promise.all(
    spoofedAddresses
      .slice(0, 3)
      .map((address) => attempt(request, address, "wrong-password"))
  );
  for (const response of attempts) {
    expect(response.status()).toBe(401);
  }
  const refused = await attempt(
    request,
    spoofedAddresses[3] ?? "",
    "wrong-password"
  );
  expect(refused.status(), `${signInPath} sign-in remains rate limited`).toBe(
    429
  );
  expect(refused.headers()["x-retry-after"]).toBeDefined();

  // The native case owns an empty bucket; recovery waits on the real 10s rule.
  await delay(10_100);
  const recovered = await attempt(
    request,
    spoofedAddresses[3] ?? "",
    account.password
  );
  expect(recovered.status()).toBe(200);
};
dedicatedTest.describe(
  "forwarded-for limiter bypass resistance",
  { tag: ["@native", "@rate-limit"] },
  () => {
    dedicatedTest(
      "rotating x-forwarded-for cannot evade the username limiter",
      { tag: ["@http", "@risk-real-limiter", "@risk-recovery"] },
      async ({ account, request }) => {
        await expectRotatingForwardedForCannotEvade(
          request,
          "/sign-in/username",
          account,
          (api, forwardedFor, attemptPassword) =>
            api.post("/api/auth/sign-in/username", {
              data: { password: attemptPassword, username: account.username },
              headers: { "x-forwarded-for": forwardedFor },
            })
        );
      }
    );
    dedicatedTest(
      "rotating x-forwarded-for cannot evade the name limiter",
      { tag: ["@http", "@risk-real-limiter", "@risk-recovery"] },
      async ({ account, request }) => {
        await expectRotatingForwardedForCannotEvade(
          request,
          "/sign-in/name",
          account,
          (api, forwardedFor, attemptPassword) =>
            api.post("/api/auth/sign-in/name", {
              data: { fullName: account.fullName, password: attemptPassword },
              headers: { "x-forwarded-for": forwardedFor },
            })
        );
      }
    );
  }
);
