import { defineConfig, devices } from "@playwright/test";

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
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    {
      name: "review-webkit",
      testMatch: [
        "**/r11-ui.spec.ts",
        "**/name-sign-in.spec.ts",
        "**/restricted-status.spec.ts",
      ],
      use: {
        ...devices["iPhone 15 Pro"],
        browserName: "webkit",
        contextOptions: { screen: { height: 852, width: 393 } },
        deviceScaleFactor: 3,
        viewport: { height: 852, width: 393 },
      },
    },
    {
      name: "review-chromium",
      testMatch: [
        "**/r11-ui.spec.ts",
        "**/name-sign-in.spec.ts",
        "**/restricted-status.spec.ts",
      ],
      use: {
        ...devices["Pixel 7"],
        browserName: "chromium",
        contextOptions: { screen: { height: 915, width: 412 } },
        deviceScaleFactor: 2.625,
        viewport: { height: 915, width: 412 },
      },
    },
  ],
  reporter: [["list"]],
  testDir: "./tests/e2e",
  // Temporary legacy families only; N03–N15 migrate them, N18 removes this lane.
  testIgnore: [
    "**/testing-foundation.spec.ts",
    "**/qualification.spec.ts",
    "**/account-clock-matrix.spec.ts",
    "**/home-notices.spec.ts",
    "**/home-participation.spec.ts",
    "**/r11-ui.spec.ts",
    "**/account-deletion.spec.ts",
    "**/account-restrictions.spec.ts",
    "**/account-security.spec.ts",
    "**/guard-failures.spec.ts",
    "**/zz-worker-faults.spec.ts",
  ],
  timeout: 60_000,
  use: {
    baseURL: E2E_BASE_URL,
    // Browser requests carry an Origin header. Better Auth's CSRF middleware
    // requires it on authenticated POSTs, so the API harness sends it too.
    extraHTTPHeaders: { origin: E2E_BASE_URL },
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
