import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
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
const localWorkersFile = path.join(
  homedir(),
  ".config",
  "efcc",
  "feature-workers"
);
const workers = Number(
  process.env.PLAYWRIGHT_WORKERS ??
    (process.env.CI !== "true" && existsSync(localWorkersFile)
      ? readFileSync(localWorkersFile, "utf-8").trim()
      : 2)
);
if (!Number.isSafeInteger(workers) || workers < 1) {
  throw new Error("Feature worker count must be a positive integer.");
}

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
    ...(process.env.EFCC_PROGRESS_FILE
      ? [["./scripts/playwright-progress-reporter.ts"] as [string]]
      : []),
  ],
  retries: 0,
  testDir: "./tests/e2e",
  // Native feature families; foundation, causal and required dev claims have separate configs.
  testIgnore: [
    "**/testing-foundation.spec.ts",
    "**/account-clock-matrix.spec.ts",
    "**/roles/department-manager-causal.spec.ts",
    "**/roles/program-leader-causal.spec.ts",
    "**/roles/staff-delegation-causal.spec.ts",
    "**/roles/admin-stepdown-causal.spec.ts",
  ],
  testMatch: "**/*.spec.ts",
  timeout: 120_000,
  use: { screenshot: "off", trace: "retain-on-failure" },
  workers,
});
