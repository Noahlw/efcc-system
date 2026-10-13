import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/support",
  testMatch: "lifecycle-child.spec.ts",
  workers: 1,
  timeout: 120_000,
  outputDir: "/tmp/efcc-testing-foundation-n01-evidence/lifecycle",
  reporter: "line",
});
