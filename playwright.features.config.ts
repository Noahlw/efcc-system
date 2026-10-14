import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

const rawEvidenceRoot = process.env.EFCC_EVIDENCE_ROOT;
const testSource = process.env.EFCC_TEST_SOURCE;
if (rawEvidenceRoot === "" || testSource === "") {
  throw new Error(
    "Native test evidence and source identity must be non-empty."
  );
}
const evidenceRoot = path.resolve(
  rawEvidenceRoot ?? path.join(import.meta.dirname, "test-results")
);
const evidence = path.join(
  evidenceRoot,
  "native-features",
  process.env.EFCC_CAPTURE_SUCCESS === "1" ? "capture-on" : "capture-off"
);

// Migrated families use @native plus exactly one of @browser/@http.
// @mobile-critical selects engine-sensitive browser claims, not entire files.
export default defineConfig({
  expect: { timeout: 15_000 },
  fullyParallel: true,
  grepInvert: /@dev/u,
  metadata: testSource === undefined ? {} : { source: testSource },
  outputDir: path.join(evidence, "artifacts"),
  projects: [
    {
      grep: /(?=.*@native)(?=.*@http)/u,
      name: "features-http",
    },
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
        browserName: "webkit" as const,
        deviceScaleFactor: 3,
        viewport: { height: 852, width: 393 },
      },
    },
    {
      grep: /(?=.*@native)(?=.*@browser)(?=.*@mobile-critical)/u,
      name: "features-pixel-chromium",
      use: {
        ...devices["Pixel 7"],
        browserName: "chromium" as const,
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
  // Native feature families; foundation, causal and required dev claims have separate configs.
  testMatch: [
    "qualification.spec.ts",
    "home-notices.spec.ts",
    "home-participation.spec.ts",
    "r11-ui.spec.ts",
    "account-deletion.spec.ts",
    "account-restrictions.spec.ts",
    "account-security.spec.ts",
    "guard-failures.spec.ts",
    "zz-worker-faults.spec.ts",
    "access-foundation.spec.ts",
    "name-sign-in.spec.ts",
    "rate-limit.spec.ts",
    "restricted-status.spec.ts",
    "session-renewal.spec.ts",
    "account-decisions.spec.ts",
    "account-assisted/**/*.spec.ts",
    "account-identity.spec.ts",
    "account-application.spec.ts",
    "account-applicant.spec.ts",
  ],
  timeout: 120_000,
  use: { screenshot: "off", trace: "retain-on-failure" },
  workers: Number(process.env.PLAYWRIGHT_WORKERS ?? 2),
});
