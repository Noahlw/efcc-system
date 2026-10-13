import { randomBytes } from "node:crypto";
import path from "node:path";

import { test as base } from "@playwright/test";
import { createTestHarness } from "wrangler";

import type ClockApp from "../worker/clock-matrix";
import type { BatchControl } from "../worker/clock-matrix";
import type Provision from "../worker/provision";
import type { NativeApp } from "./fixtures";
import { assertNativeSource } from "./native-source";

export const test = base.extend<{
  causal: NativeApp & { control: BatchControl };
}>({
  // eslint-disable-next-line no-empty-pattern -- Playwright parses fixture dependencies.
  causal: async ({}, use) => {
    const root = path.resolve(import.meta.dirname, "../..");
    assertNativeSource(root);
    const secret = randomBytes(32).toString("hex");
    const workers = [
      {
        configPath: path.join(root, "dist/server/causal.json"),
        secrets: { BETTER_AUTH_SECRET: secret, SEED_TOKEN: "" },
      },
      {
        configPath: path.join(root, "tests/worker/provision.jsonc"),
        prebuiltWorkerDir: path.join(root, "dist/test-provision"),
        secrets: { BETTER_AUTH_SECRET: secret, SEED_TOKEN: "" },
      },
    ];
    const server = createTestHarness({ root, workers });
    let control: BatchControl | undefined;
    try {
      const { url } = await server.listen();
      await server.update({
        root,
        workers: workers.map((worker) => ({
          ...worker,
          vars: { BETTER_AUTH_TRUSTED_ORIGINS: url.origin },
        })),
      });
      const app = server.getWorker<
        Cloudflare.Env,
        { default: typeof ClockApp }
      >("efcc-system");
      await app.applyD1Migrations("DB");
      const { DB: db } = await app.getEnv();
      control = await app.getExport();
      const provision = await server
        .getWorker<Cloudflare.Env, { default: typeof Provision }>(
          "efcc-test-provision"
        )
        .getExport();
      await use({ control, db, origin: url.origin, provision, server });
    } finally {
      // Release even when an assertion, expiry observation or request fails.
      try {
        await control?.release();
      } finally {
        await server.close();
      }
    }
  },
});
export { expect } from "@playwright/test";
