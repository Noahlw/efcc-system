import path from "node:path";

import type CredentialApp from "../worker/credential-race";
import type { CredentialControl } from "../worker/credential-race";
import { openApp, test as base } from "./fixtures";

const configPath = path.resolve(
  import.meta.dirname,
  "../../dist/credential-app/server/credential-race.json"
);

export const test = base.extend<{ credential: CredentialControl }>({
  app: [
    // eslint-disable-next-line no-empty-pattern -- Playwright parses native worker fixture dependencies.
    async ({}, use) => {
      const app = await openApp(configPath);
      try {
        await use(app);
      } finally {
        await app.close();
      }
    },
    { scope: "worker" },
  ],
  credential: async ({ caseApp }, use) => {
    const control = await caseApp.harness
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
  // Only tests selecting dedicatedApp replace the inherited worker-owned caseApp.
  // eslint-disable-next-line no-empty-pattern -- Playwright parses native case fixture dependencies.
  dedicatedApp: async ({}, use) => {
    const app = await openApp(configPath);
    try {
      await use(app);
    } finally {
      await app.close();
    }
  },
});

export { expect } from "./fixtures";
