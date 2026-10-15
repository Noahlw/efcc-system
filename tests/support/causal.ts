import path from "node:path";

import { test as base } from "@playwright/test";

import type ClockApp from "../worker/clock-matrix";
import type { BatchControl } from "../worker/clock-matrix";
import { openApp } from "./fixtures";
import type { NativeApp } from "./fixtures";

export const test = base.extend<{
  causal: NativeApp & { control: BatchControl };
}>({
  // eslint-disable-next-line no-empty-pattern -- Playwright parses fixture dependencies.
  causal: async ({}, use) => {
    const app = await openApp(
      path.resolve(import.meta.dirname, "../../dist/server/causal.json")
    );
    let control: BatchControl | undefined;
    try {
      control = await app.server
        .getWorker<Cloudflare.Env, { default: typeof ClockApp }>("efcc-system")
        .getExport();
      await use({ ...app, control });
    } finally {
      // Release even when an assertion, expiry observation or request fails.
      try {
        await control?.release();
      } finally {
        await app.close();
      }
    }
  },
});
export { expect } from "@playwright/test";
