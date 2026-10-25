import path from "node:path";

import { defineConfig } from "@playwright/test";

const rawEvidenceRoot = process.env.EFCC_EVIDENCE_ROOT;
const testSource = process.env.EFCC_TEST_SOURCE;
if (rawEvidenceRoot === "" || testSource === "") {
  throw new Error(
    "Native test evidence root and source identity must be non-empty."
  );
}
const evidenceRoot = path.resolve(
  rawEvidenceRoot ?? path.join(import.meta.dirname, "test-results")
);
const evidence = path.join(evidenceRoot, "native-causal");

export default defineConfig({
  expect: { timeout: 15_000 },
  fullyParallel: false,
  metadata: testSource === undefined ? {} : { source: testSource },
  outputDir: path.join(evidence, "artifacts"),
  projects: [
    {
      grep: /(?=.*@native)(?=.*@http)/u,
      name: "causal-http",
    },
  ],
  reporter: [
    ["list"],
    ["json", { outputFile: path.join(evidence, "results.json") }],
    ...(process.env.EFCC_PROGRESS_FILE
      ? [["./scripts/playwright-progress-reporter.ts"] as [string]]
      : []),
  ],
  retries: 0,
  testDir: "./tests/e2e",
  testMatch: [
    "account-clock-matrix.spec.ts",
    "roles/department-manager-causal.spec.ts",
    "roles/program-leader-causal.spec.ts",
    "roles/staff-delegation-causal.spec.ts",
    "roles/admin-stepdown-causal.spec.ts",
  ],
  timeout: 120_000,
  use: { trace: "retain-on-failure" },
  workers: 1,
});
