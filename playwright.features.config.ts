import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

const evidence = path.resolve(
  import.meta.dirname,
  "test-results/native-features",
  process.env.EFCC_CAPTURE_SUCCESS === "1" ? "capture-on" : "capture-off"
);

// Migrated families use @native plus exactly one of @browser/@http.
// @mobile-critical selects engine-sensitive browser claims, not entire files.
export default defineConfig({
  expect: { timeout: 15_000 },
  fullyParallel: true,
  metadata: process.env.EFCC_TEST_SOURCE
    ? { source: process.env.EFCC_TEST_SOURCE }
    : {},
  outputDir: path.join(evidence, "artifacts"),
  projects: [
    { grep: /(?=.*@native)(?=.*@http)/u, name: "features-http" },
    {
      grep: /(?=.*@native)(?=.*@browser)/u,
      name: "features-chromium",
      use: { browserName: "chromium", viewport: { height: 1024, width: 1440 } },
    },
    {
      grep: /(?=.*@native)(?=.*@browser)(?=.*@mobile-critical)/u,
      name: "features-iphone-webkit",
      use: {
        ...devices["iPhone 15 Pro"],
        browserName: "webkit",
        deviceScaleFactor: 3,
        viewport: { height: 852, width: 393 },
      },
    },
    {
      grep: /(?=.*@native)(?=.*@browser)(?=.*@mobile-critical)/u,
      name: "features-pixel-chromium",
      use: {
        ...devices["Pixel 7"],
        browserName: "chromium",
        deviceScaleFactor: 2.625,
        viewport: { height: 915, width: 412 },
      },
    },
  ],
  reporter: [
    ["list"],
    ["json", { outputFile: path.join(evidence, "results.json") }],
    ["html", { open: "never", outputFolder: path.join(evidence, "report") }],
  ],
  retries: 0,
  testDir: "./tests/e2e",
  // Expand only when a family migrates; loading legacy modules executes their import-time owners.
  testMatch: [
    "qualification.spec.ts",
    "home-notices.spec.ts",
    "home-participation.spec.ts",
  ],
  timeout: 120_000,
  use: { screenshot: "off", trace: "retain-on-failure" },
  workers: Number(process.env.PLAYWRIGHT_WORKERS ?? 2),
});
