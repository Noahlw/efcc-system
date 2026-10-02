import { defineConfig } from "@playwright/test";

import {
  E2E_BASE_URL,
  E2E_PORT,
  ensureLocalEnv,
} from "./tests/scenarios/local-env";

ensureLocalEnv();

export default defineConfig({
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  reporter: [["list"]],
  testDir: "./tests/e2e",
  timeout: 60_000,
  use: {
    baseURL: E2E_BASE_URL,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `node_modules/.bin/vite dev --port ${E2E_PORT}`,
    reuseExistingServer: false,
    timeout: 180_000,
    url: E2E_BASE_URL,
  },
  workers: 1,
});
