import { defineConfig } from "@playwright/test";

export default defineConfig({
  reporter: "line",
  testDir: "./tests/support",
  testMatch: "lifecycle-child.spec.ts",
  timeout: 120_000,
  workers: 1,
});
