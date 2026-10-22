import { randomUUID } from "node:crypto";
import path from "node:path";

import { test as playwrightTest } from "@playwright/test";
import { unstable_defaultWranglerConfig, unstable_startWorker } from "wrangler";

import { expect } from "../../support/fixtures";
import type { ProvisionAccount, Provisioning } from "../../worker/provision";
import type { StatusAccount } from "./fixtures";
import { statusTitles } from "./fixtures";

const getDevOrigin = () => {
  const origin = process.env.EFCC_NATIVE_DEV_AUTH_ORIGIN;
  if (!origin) {
    throw new Error("The native Vite status lane requires its owned origin.");
  }
  return origin;
};

const getDevRegistryPath = () => {
  const devRootPath = process.env.EFCC_NATIVE_DEV_ROOT;
  const miniflareRegistryPath = process.env.MINIFLARE_REGISTRY_PATH;
  const wranglerRegistryPath = process.env.WRANGLER_REGISTRY_PATH;
  const scratchRoot = `${path.resolve(import.meta.dirname, "../../../.scratch")}${path.sep}`;
  if (
    !devRootPath ||
    !miniflareRegistryPath ||
    !wranglerRegistryPath ||
    path.resolve(miniflareRegistryPath) !==
      path.resolve(wranglerRegistryPath) ||
    path.resolve(miniflareRegistryPath) !==
      path.join(path.resolve(devRootPath), "registry") ||
    !path.resolve(devRootPath).startsWith(scratchRoot)
  ) {
    throw new Error("The native Vite status lane requires a private registry.");
  }
  return path.resolve(miniflareRegistryPath);
};

const DEV_DRIVER_ENTRYPOINT = path.resolve(
  import.meta.dirname,
  "../../worker/dev-driver.ts"
);

const devStatusTest = playwrightTest.extend<{
  devAccount: StatusAccount;
  devProvision: Provisioning;
}>({
  // eslint-disable-next-line no-empty-pattern -- Playwright parses fixture dependencies.
  baseURL: async ({}, use) => {
    await use(getDevOrigin());
  },
  devAccount: async ({ devProvision }, use) => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
    const account: ProvisionAccount = {
      email: `${suffix}@example.com`,
      fullName: `陳測試${suffix}`,
      membershipStatus: "pending",
      password: "Synthetic-native-dev-password!",
      username: `native.${suffix}`,
    };
    await use({
      ...account,
      userId: await devProvision.account(account),
    });
  },
  // eslint-disable-next-line no-empty-pattern -- Playwright parses fixture dependencies.
  devProvision: async ({}, use) => {
    const driver = await unstable_startWorker({
      config: {
        ...unstable_defaultWranglerConfig,
        compatibility_date: "2026-09-30",
        compatibility_flags: ["nodejs_compat"],
        d1_databases: [],
        main: DEV_DRIVER_ENTRYPOINT,
        name: `efcc-n04-dev-driver-${randomUUID()}`,
        services: [{ binding: "PROVISION", service: "efcc-test-provision" }],
      },
      dev: {
        inspector: false,
        logLevel: "none",
        persist: false,
        registry: getDevRegistryPath(),
        remote: false,
        server: { hostname: "127.0.0.1", port: 0 },
        watch: false,
      },
      sendMetrics: false,
    });
    try {
      await driver.ready;
      const miniflare = driver.raw.runtimes[0]?.mf;
      if (!miniflare) {
        throw new Error("The native dev driver has no local Worker runtime");
      }
      const env = await miniflare.getBindings<{ PROVISION: Provisioning }>(
        driver.config.name
      );
      await use(env.PROVISION);
    } finally {
      await driver.dispose();
    }
  },
});

devStatusTest(
  "@native @browser @dev @risk-access the Vite status recheck stays gated until hydration then reads fresh Membership",
  async ({ devAccount, devProvision, page }) => {
    const origin = getDevOrigin();
    const signInResponse = await page.request.post(
      "/api/auth/sign-in/username",
      {
        data: {
          password: devAccount.password,
          username: devAccount.username,
        },
        headers: { origin },
      }
    );
    expect(signInResponse.status()).toBe(200);
    const sessionResponse = await page.request.get("/api/auth/get-session");
    expect(await sessionResponse.json()).not.toBeNull();

    const { promise: moduleGate, resolve: releaseModule } =
      Promise.withResolvers<boolean>();
    const moduleRoute = "**/src/features/identity/recheck-status-button.tsx*";
    const moduleRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return (
        url.origin === origin &&
        url.pathname === "/src/features/identity/recheck-status-button.tsx"
      );
    });
    await page.route(moduleRoute, async (route) => {
      await moduleGate;
      await route.continue();
    });

    try {
      await page.goto("/status", { waitUntil: "commit" });
      await moduleRequest;

      const recheck = page.getByRole("button", { name: "重新檢查狀態" });
      await expect(
        page.getByRole("heading", { name: statusTitles.membership_pending })
      ).toBeVisible();
      await expect(recheck).toBeVisible();
      await expect(recheck).toBeDisabled();
      const restrictedBusiness = await page.request.get("/api/v2/me");
      expect(restrictedBusiness.status()).toBe(403);

      await devProvision.setMembershipStatus(devAccount.userId, "active");
      releaseModule(true);
      await expect(recheck).toBeEnabled();
      const freshStatus = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          url.origin === origin &&
          url.pathname === "/status" &&
          response.request().headers().rsc !== undefined
        );
      });
      await recheck.click();
      const rscStatus = await freshStatus;
      expect(rscStatus.status()).toBe(200);
      expect(rscStatus.headers()["cache-control"]).toContain("no-store");

      await expect(
        page.getByRole("heading", { name: "帳戶可正常使用" })
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: statusTitles.membership_pending })
      ).toHaveCount(0);
      const homeControl = page.getByRole("button", { name: "前往主頁" });
      await expect(homeControl).toHaveAttribute("href", "/");
      const activeStatus = await page.request.get("/api/v2/status");
      expect(await activeStatus.json()).toEqual({
        data: {
          accessAllowed: true,
          displayName: devAccount.fullName,
          reasons: [],
        },
      });
      const activeBusiness = await page.request.get("/api/v2/me");
      expect(activeBusiness.status()).toBe(200);
      await homeControl.click();
      await expect(page).toHaveURL(/\/$/u);
      await expect(
        page.getByRole("heading", { name: "我的主頁" })
      ).toBeVisible();
      const home = await page.request.get("/");
      expect(home.status()).toBe(200);
    } finally {
      releaseModule(true);
      await page.unroute(moduleRoute);
    }
  }
);
