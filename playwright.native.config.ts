import path from "node:path";

import { defineConfig } from "@playwright/test";

import { nativeGrep } from "./scripts/test-selection";

const rawEvidenceRoot = process.env.EFCC_EVIDENCE_ROOT;
const testSource = process.env.EFCC_TEST_SOURCE;
if (rawEvidenceRoot === "" || testSource === "") {
  throw new Error("Native test evidence root and source identity must be non-empty.");
}
const evidenceRoot = path.resolve(
  rawEvidenceRoot ?? path.join(import.meta.dirname, "test-results")
);
const evidence = path.join(evidenceRoot, "native-foundation");

export default defineConfig({
  expect: { timeout: 15_000 },
  fullyParallel: true,
  metadata: testSource === undefined ? {} : { source: testSource },
  outputDir: path.join(evidence, "artifacts"),
  projects: [
    {
      grep: nativeGrep(/(?=.*@native)(?=.*@foundation)/u),
      grepInvert: /V4 native worker/u,
      name: "native",
    },
    {
      dependencies: ["native"],
      grep: nativeGrep(/(?=.*@native)(?=.*@foundation)(?=.*V4 native worker)/u),
      name: "lifecycle",
      workers: 1,
    },
  ],
  reporter: [
    ["list"],
    ["json", { outputFile: path.join(evidence, "results.json") }],
  ],
  testDir: "./tests/e2e",
  testMatch: "testing-foundation.spec.ts",
  timeout: 120_000,
  use: { browserName: "chromium", trace: "retain-on-failure" },
  workers: Number(process.env.PLAYWRIGHT_WORKERS ?? 2),
});
