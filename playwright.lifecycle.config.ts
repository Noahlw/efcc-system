import { defineConfig } from "@playwright/test";

export default defineConfig({
  outputDir: "/tmp/efcc-testing-foundation-n01-evidence/lifecycle",
  reporter: "line",
  testDir: "./tests/support",
  testMatch: "lifecycle-child.spec.ts",
  timeout: 120_000,
  workers: 1,
});
