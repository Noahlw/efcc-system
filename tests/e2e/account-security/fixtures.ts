/* eslint-disable no-await-in-loop, unicorn/no-await-expression-member -- Ordered causal requests and direct native D1/RPC observations preserve independent effects without a SQL facade. */

import { randomBytes } from "node:crypto";

import type { APIRequestContext, APIResponse } from "@playwright/test";

import { expect, test } from "../../support/credential-fixtures";

const securityAccount = () => {
  const suffix = randomBytes(6).toString("hex");
  return {
    email: `security.${suffix}@example.invalid`,
    fullName: `陳密碼${suffix}`,
    membershipStatus: "active" as const,
    password: "Synthetic-current-password!",
    username: `security.${suffix}`,
  };
};

const expectStatus = async (pending: Promise<APIResponse>, status: number) => {
  const response = await pending;
  expect(response.status()).toBe(status);
  return response;
};

const securityTest = test.extend<{
  holder: ReturnType<typeof securityAccount>;
  actor: APIRequestContext;
}>({
  actor: async ({ playwright, holder, caseApp, extraHTTPHeaders }, use) => {
    const actor = await playwright.request.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders: {
        ...extraHTTPHeaders,
        origin: caseApp.origin,
      },
    });
    try {
      await expectStatus(
        actor.post("/api/auth/sign-in/username", {
          data: { password: holder.password, username: holder.username },
        }),
        200
      );
      await use(actor);
    } finally {
      await actor.dispose();
    }
  },
  holder: async ({ caseApp }, use) => {
    const holder = securityAccount();
    await caseApp.provision.account(holder);
    await use(holder);
  },
  signedInRequest: async ({ actor }, use) => {
    await use(actor);
  },
});

export { securityAccount, expectStatus, securityTest };
