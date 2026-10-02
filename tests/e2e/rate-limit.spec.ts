import { expect, test } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";

import { approvedAccounts, findAccount } from "../scenarios/accounts";
import { readRateLimitRows, waitForSignInWindow } from "../scenarios/limiter";
import { seedSyntheticAccounts } from "./seed";

const wong = findAccount(approvedAccounts, "wong.tai.ming");
const nameAccount = findAccount(approvedAccounts, "Chan.Siu.Fong");

const attemptSignIn = (request: APIRequestContext, password: string) =>
  request.post("/api/auth/sign-in/username", {
    data: { password, username: wong.username },
  });

test.beforeAll(async () => {
  await seedSyntheticAccounts();
});

test("repeated sign-in attempts hit the database limiter and recover", async ({
  request,
}) => {
  await waitForSignInWindow();

  // The default sign-in rule allows three attempts per ten-second window.
  const firstWindow = await Promise.all([
    attemptSignIn(request, "wrong-password-1"),
    attemptSignIn(request, "wrong-password-2"),
    attemptSignIn(request, "wrong-password-3"),
  ]);
  for (const response of firstWindow) {
    expect(response.status()).toBe(401);
  }

  const refused = await attemptSignIn(request, "wrong-password-4");
  expect(refused.status()).toBe(429);
  expect(refused.headers()["x-retry-after"]).toBeDefined();

  // The limiter state lives in D1, not in per-instance memory.
  const rows = readRateLimitRows().filter((row) =>
    row.key.endsWith("|/sign-in/username")
  );
  expect(rows.length).toBeGreaterThan(0);
  expect(Math.max(...rows.map((row) => row.count))).toBeGreaterThanOrEqual(3);

  // Valid credentials recover after the window: no account lockout.
  await waitForSignInWindow();
  const recovered = await attemptSignIn(request, wong.password);
  expect(recovered.status()).toBe(200);
});

test("the name entry is limited and recovers on its own bucket", async ({
  request,
}) => {
  await waitForSignInWindow("/sign-in/name");

  const attemptName = (password: string) =>
    request.post("/api/auth/sign-in/name", {
      data: { fullName: nameAccount.fullName, password },
    });

  const firstWindow = await Promise.all([
    attemptName("wrong-password-1"),
    attemptName("wrong-password-2"),
    attemptName("wrong-password-3"),
  ]);
  for (const response of firstWindow) {
    expect(response.status()).toBe(401);
  }

  const refused = await attemptName("wrong-password-4");
  expect(refused.status()).toBe(429);

  const rows = readRateLimitRows().filter((row) =>
    row.key.endsWith("|/sign-in/name")
  );
  expect(rows.length).toBeGreaterThan(0);

  await waitForSignInWindow("/sign-in/name");
  const recovered = await attemptName(nameAccount.password);
  expect(recovered.status()).toBe(200);
});
