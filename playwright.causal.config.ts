import { defineConfig } from "@playwright/test";

export default defineConfig({
  expect: { timeout: 15_000 },
  fullyParallel: false,
  outputDir: "./test-results/n12-causal",
  projects: [{ grep: /@http/u, name: "causal-http" }],
  reporter: [
    ["list"],
    ["json", { outputFile: "./test-results/n12-causal-report.json" }],
  ],
  retries: 0,
  testDir: "./tests/e2e",
  testMatch: "account-clock-matrix.spec.ts",
  timeout: 120_000,
  use: { trace: "retain-on-failure" },
  workers: 1,
});
