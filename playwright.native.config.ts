import { defineConfig } from "@playwright/test";

export default defineConfig({
  expect: { timeout: 15_000 },
  fullyParallel: true,
  outputDir: "/tmp/efcc-testing-foundation-n01-evidence/browser",
  projects: [
    { grepInvert: /V4 native worker/u, name: "native" },
    // Fault-child runners own process-global resources; qualify after ordinary stores close.
    {
      dependencies: ["native"],
      grep: /V4 native worker/u,
      name: "lifecycle",
      workers: 1,
    },
  ],
  reporter: [["list"]],
  testDir: "./tests/e2e",
  testMatch: "testing-foundation.spec.ts",
  timeout: 120_000,
  use: { browserName: "chromium", trace: "retain-on-failure" },
  // Enabled after the single-worker V4 failure/interrupt proof; adjustable natively.
  workers: Number(process.env.PLAYWRIGHT_WORKERS ?? 2),
});
