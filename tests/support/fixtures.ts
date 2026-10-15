import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";

import { test as base, expect } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";
import type { Server } from "srvx";
import { serve } from "srvx/node";
import { createTestHarness } from "wrangler";
import type { TestHarness } from "wrangler";

import type Provision from "../worker/provision";
import type { ProvisionAccount, Provisioning } from "../worker/provision";
import { assertNativeSource } from "./native-source";

const root = path.resolve(import.meta.dirname, "../..");

export interface NativeApp {
  server: TestHarness;
  close: () => Promise<void>;
  db: D1Database;
  provision: Provisioning;
  origin: string;
}

/** One native runtime/store owner; close is mandatory, including failed setup. */
export const openApp = async (
  configPath = path.join(root, "dist/server/wrangler.json")
): Promise<NativeApp> => {
  assertNativeSource(root);
  const secret = randomBytes(32).toString("hex");
  const workers = [
    {
      configPath,
      secrets: { BETTER_AUTH_SECRET: secret },
    },
    {
      configPath: path.join(root, "tests/worker/provision.jsonc"),
      prebuiltWorkerDir: path.join(root, "dist/test-provision"),
      secrets: { BETTER_AUTH_SECRET: secret },
    },
  ];
  const server = createTestHarness({ root, workers });
  let ingress: Server | undefined;
  const close = async () => {
    try {
      await ingress?.close(true);
    } finally {
      await server.close();
    }
  };
  try {
    await server.listen();
    // workerd closes idle HTTP sockets at 5s without advertising a lifetime.
    // Node's native listener advertises its timeout and retains the safety buffer.
    // Harness.fetch keeps native route dispatch, built ingress and the same D1.
    ingress = serve({
      fetch: (request) =>
        // Worker globals and Node/undici use different declaration brands.
        // Pass native web objects unchanged; wire/auth checks cover this seam.
        server.fetch(
          request.url,
          new Request(request._request ?? request, {
            redirect: "manual",
          }) as unknown as Parameters<TestHarness["fetch"]>[1]
        ) as unknown as Promise<Response>,
      gracefulShutdown: false,
      hostname: "127.0.0.1",
      port: 0,
      silent: true,
    });
    await ingress.ready();
    if (!ingress.url) {
      throw new Error("Native test ingress did not acquire an origin");
    }
    const url = new URL(ingress.url);
    // Set exact origin before either isolate constructs its cached auth instance.
    await server.update({
      root,
      workers: workers.map((worker) => ({
        ...worker,
        vars: { BETTER_AUTH_TRUSTED_ORIGINS: url.origin },
      })),
    });
    const app = server.getWorker<Cloudflare.Env>("efcc-system");
    await app.applyD1Migrations("DB");
    const { DB: db } = await app.getEnv();
    const provision = await server
      .getWorker<Cloudflare.Env, { default: typeof Provision }>(
        "efcc-test-provision"
      )
      .getExport();
    return { close, db, origin: url.origin, provision, server };
  } catch (error) {
    try {
      await close();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Native app setup and cleanup failed",
        { cause: cleanupError }
      );
    }
    throw error;
  }
};

export const test = base.extend<
  {
    dedicatedApp: NativeApp;
    caseApp: NativeApp;
    account: ProvisionAccount & { userId: string };
    signedInRequest: APIRequestContext;
    signedInPage: Page;
    staffPage: Page;
    staff: {
      userId: string;
      account: ProvisionAccount;
      context: APIRequestContext;
    };
  },
  { app: NativeApp }
>({
  account: async ({ caseApp: app }, use) => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
    const account: ProvisionAccount = {
      email: `${suffix}@example.com`,
      fullName: `陳測試${suffix}`,
      membershipStatus: "active",
      password: "Synthetic-native-password!",
      username: `native.${suffix}`,
    };
    await use({ ...account, userId: await app.provision.account(account) });
  },
  app: [
    // eslint-disable-next-line no-empty-pattern -- Playwright parses f ixture dependencies.
    async ({}, use) => {
      const app = await openApp();
      try {
        await use(app);
      } finally {
        await app.close();
      }
    },
    { scope: "worker" },
  ],
  baseURL: async ({ caseApp: app }, use) => {
    await use(app.origin);
  },
  caseApp: async ({ app }, use) => {
    await use(app);
  },
  // eslint-disable-next-line no-empty-pattern -- Playwright parses fixture dependencies.
  dedicatedApp: async ({}, use) => {
    const app = await openApp();
    try {
      await use(app);
    } finally {
      await app.close();
    }
  },
  extraHTTPHeaders: async ({ caseApp: app }, use) => {
    await use({
      "cf-connecting-ip": `2001:db8:${randomBytes(2).toString("hex")}:${randomBytes(2).toString("hex")}::1`,
      origin: app.origin,
    });
  },
  signedInPage: async (
    { browser, caseApp: app, signedInRequest, extraHTTPHeaders },
    use
  ) => {
    const context = await browser.newContext({
      baseURL: app.origin,
      extraHTTPHeaders,
      storageState: await signedInRequest.storageState(),
    });
    try {
      await use(await context.newPage());
    } finally {
      await context.close();
    }
  },
  signedInRequest: async ({ request, account }, use) => {
    const response = await request.post("/api/auth/sign-in/username", {
      data: { password: account.password, username: account.username },
    });
    expect(response.status()).toBe(200);
    await use(request);
  },
  staff: async ({ caseApp: app, playwright, extraHTTPHeaders }, use) => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
    const account: ProvisionAccount = {
      email: `${suffix}@example.com`,
      fullName: `陳職員${suffix}`,
      membershipStatus: "active",
      password: "Synthetic-native-password!",
      role: "staff",
      username: `staff.${suffix}`,
    };
    const userId = await app.provision.account(account);
    const context = await playwright.request.newContext({
      baseURL: app.origin,
      extraHTTPHeaders,
    });
    try {
      const login = await context.post("/api/auth/sign-in/username", {
        data: { password: account.password, username: account.username },
      });
      expect(login.status()).toBe(200);
      const confirmation = await context.post(
        "/api/v2/account/password-confirmation",
        {
          data: { operationKey: randomUUID(), password: account.password },
        }
      );
      expect(confirmation.status()).toBe(201);
      await use({ account, context, userId });
    } finally {
      await context.dispose();
    }
  },
  staffPage: async ({ browser, caseApp, extraHTTPHeaders, staff }, use) => {
    const context = await browser.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders,
      storageState: await staff.context.storageState(),
    });
    try {
      await use(await context.newPage());
    } finally {
      await context.close();
    }
  },
});

/** Native fixture preset; dependent provisioning and contexts follow the selected store. */
export const dedicatedTest = test.extend<{ caseApp: NativeApp }>({
  caseApp: ({ dedicatedApp }, use) => use(dedicatedApp),
});

export { expect } from "@playwright/test";
