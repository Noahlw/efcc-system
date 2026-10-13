import { randomBytes } from "node:crypto";
import path from "node:path";

import { createTestHarness } from "wrangler";

import type CredentialApp from "../worker/credential-race";
import type { CredentialControl } from "../worker/credential-race";
import type Provision from "../worker/provision";
import { test as base } from "./fixtures";
import type { NativeApp } from "./fixtures";
import { assertNativeSource } from "./native-source";

const root = path.resolve(import.meta.dirname, "../..");

export const test = base.extend<{ credential: CredentialControl }>({
  // Every credential scenario owns a fresh store, including schema faults and lookup races.
  // eslint-disable-next-line no-empty-pattern -- Playwright parses the selected case fixture dependencies.
  caseApp: async ({}, use) => {
    assertNativeSource(root);
    const secret = randomBytes(32).toString("hex");
    const workers = [
      {
        configPath: path.join(
          root,
          "dist/credential-app/server/credential-race.json"
        ),
        secrets: { BETTER_AUTH_SECRET: secret, SEED_TOKEN: "" },
      },
      {
        configPath: path.join(root, "tests/worker/provision.jsonc"),
        prebuiltWorkerDir: path.join(root, "dist/test-provision"),
        secrets: { BETTER_AUTH_SECRET: secret, SEED_TOKEN: "" },
      },
    ];
    const server = createTestHarness({ root, workers });
    let control: CredentialControl | undefined;
    try {
      const { url } = await server.listen();
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
      control = await server
        .getWorker<Cloudflare.Env, { default: typeof CredentialApp }>(
          "efcc-system"
        )
        .getExport();
      await use({
        db,
        origin: url.origin,
        provision,
        server,
      } satisfies NativeApp);
    } finally {
      try {
        await control?.release();
      } finally {
        await server.close();
      }
    }
  },
  credential: async ({ caseApp }, use) => {
    const control = await caseApp.server
      .getWorker<Cloudflare.Env, { default: typeof CredentialApp }>(
        "efcc-system"
      )
      .getExport();
    try {
      await use(control);
    } finally {
      await control.release();
    }
  },
});

export { expect } from "./fixtures";
