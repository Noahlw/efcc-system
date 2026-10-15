import { defineConfig } from "@playwright/test";

// Collection only: execution projects apply their own runtime and engine filters.
export default defineConfig({
  projects: [{ name: "collection" }],
  reporter: "json",
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
});
