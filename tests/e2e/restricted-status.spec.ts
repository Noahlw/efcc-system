import { randomUUID } from "node:crypto";
import path from "node:path";

import type { APIRequestContext } from "@playwright/test";
import { test as playwrightTest } from "@playwright/test";
import { unstable_defaultWranglerConfig, unstable_startWorker } from "wrangler";

import { expect, test } from "../support/fixtures";
import type { NativeApp } from "../support/fixtures";
import type { ProvisionAccount, Provisioning } from "../worker/provision";
import { qualifyPresentation } from "./r11-presentation";

type StatusAccount = ProvisionAccount & { userId: string };

const DEV_ORIGIN = "http://127.0.0.1:5199";
const getDevRegistryPath = () => {
  const devRootPath = process.env.EFCC_NATIVE_DEV_ROOT;
  const miniflareRegistryPath = process.env.MINIFLARE_REGISTRY_PATH;
  const wranglerRegistryPath = process.env.WRANGLER_REGISTRY_PATH;
  const scratchRoot = `${path.resolve(import.meta.dirname, "../../.scratch")}${path.sep}`;
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
  "../worker/dev-driver.ts"
);

const devStatusTest = playwrightTest.extend<{
  devAccount: StatusAccount;
  devProvision: Provisioning;
}>({
  // eslint-disable-next-line no-empty-pattern -- Playwright parses fixture dependencies.
  baseURL: async ({}, use) => {
    await use(DEV_ORIGIN);
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

const statusTitles = {
  membership_deactivated: "會籍已停用",
  membership_pending: "會籍待批核",
  security_ban: "帳戶已暫停使用",
} as const;

const setAccessState = async (
  app: NativeApp,
  userId: string,
  membershipStatus: ProvisionAccount["membershipStatus"],
  banned = false
) => {
  const result = await app.db
    .prepare(
      `UPDATE person_profile
       SET membership_status = ?,
           banned_at = CASE WHEN ? = 1 THEN unixepoch() ELSE NULL END,
           updated_at = unixepoch()
       WHERE user_id = ?`
    )
    .bind(membershipStatus, banned ? 1 : 0, userId)
    .run();
  expect(result.meta.changes).toBe(1);
};

const signIn = (
  request: APIRequestContext,
  account: Pick<ProvisionAccount, "password" | "username">
) =>
  request.post("/api/auth/sign-in/username", {
    data: { password: account.password, username: account.username },
  });

/** Real authenticated access remains distinct from business permission. */
const expectRestrictedJourney = async (
  request: APIRequestContext,
  account: StatusAccount,
  reasons: string[]
): Promise<void> => {
  const signInResponse = await signIn(request, account);
  expect(signInResponse.status()).toBe(200);

  const authSession = await request.get("/api/auth/get-session");
  expect(authSession.status()).toBe(200);
  expect(await authSession.json()).not.toBeNull();

  const status = await request.get("/api/v2/status");
  expect(status.status()).toBe(200);
  expect(await status.json()).toEqual({
    data: {
      accessAllowed: false,
      displayName: account.fullName,
      reasons,
    },
  });

  const business = await request.get("/api/v2/me");
  expect(business.status()).toBe(403);

  const home = await request.get("/", { maxRedirects: 0 });
  expect(home.status()).toBe(307);
  expect(home.headers().location).toBe("/status");
  expect(home.headers()["cache-control"]).toContain("private");
  expect(home.headers()["cache-control"]).toContain("no-store");

  const signOut = await request.post("/api/auth/sign-out", { data: {} });
  expect(signOut.status()).toBe(200);
  const signedOutStatus = await request.get("/api/v2/status");
  expect(signedOutStatus.status()).toBe(401);
};

test("@native @http @risk-auth @risk-access pending membership authenticates to status only", async ({
  account,
  caseApp,
  request,
}) => {
  await setAccessState(caseApp, account.userId, "pending");
  await expectRestrictedJourney(request, account, ["membership_pending"]);
});

test("@native @http @risk-auth @risk-access deactivated membership and Security ban are both reported", async ({
  account,
  caseApp,
  request,
}) => {
  await setAccessState(caseApp, account.userId, "deactivated", true);
  await expectRestrictedJourney(request, account, [
    "membership_deactivated",
    "security_ban",
  ]);
});

test("@native @http @risk-auth @risk-access a Security ban with active membership blocks business access", async ({
  account,
  caseApp,
  request,
}) => {
  await setAccessState(caseApp, account.userId, "active", true);
  await expectRestrictedJourney(request, account, ["security_ban"]);
});

test("@native @browser @mobile-critical @risk-auth @risk-access the status page shows every restriction with read-only actions", async ({
  account,
  caseApp,
  page,
}) => {
  await setAccessState(caseApp, account.userId, "deactivated", true);
  await page.goto("/sign-in");
  await page.getByLabel("Username").fill(account.username);
  await page.getByLabel("密碼", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "登入" }).click();

  await expect(page).toHaveURL(/\/status$/u);
  await expect(page.getByRole("heading", { name: "帳戶狀態" })).toBeVisible();
  await expect(page.getByRole("link", { name: "返回帳戶" })).toHaveAttribute(
    "href",
    "/account"
  );
  await expect(
    page.getByRole("heading", { name: statusTitles.membership_deactivated })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: statusTitles.security_ban })
  ).toBeVisible();

  const recheck = page.getByRole("button", { name: "重新檢查狀態" });
  await expect(recheck).toBeVisible();
  await expect(recheck).toBeEnabled();
  await expect(page.getByRole("button", { name: "登出" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "查看我的申請" })
  ).toHaveAttribute("href", "/application");
  await expect(page.getByRole("button", { name: "前往主頁" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /批核|恢復|解除/u })
  ).toHaveCount(0);

  await page.goto("/status");
  await qualifyPresentation(page, test.info(), "status", {
    criticalAction: recheck,
    drafts: page.locator(
      "input[id]:not([type=hidden]):not([type=search]), textarea[id]"
    ),
  });
});

test("@native @http @risk-access lifting a Security ban leaves deactivated Membership unchanged", async ({
  account,
  caseApp,
  request,
}) => {
  await setAccessState(caseApp, account.userId, "deactivated", true);
  const signInResponse = await signIn(request, account);
  expect(signInResponse.status()).toBe(200);
  const bannedStatus = await request.get("/api/v2/status");
  expect(await bannedStatus.json()).toEqual({
    data: {
      accessAllowed: false,
      displayName: account.fullName,
      reasons: ["membership_deactivated", "security_ban"],
    },
  });

  await setAccessState(caseApp, account.userId, "deactivated");
  const currentStatus = await request.get("/api/v2/status");
  expect(await currentStatus.json()).toEqual({
    data: {
      accessAllowed: false,
      displayName: account.fullName,
      reasons: ["membership_deactivated"],
    },
  });
  const business = await request.get("/api/v2/me");
  expect(business.status()).toBe(403);
  const home = await request.get("/", { maxRedirects: 0 });
  expect(home.status()).toBe(307);
  expect(home.headers().location).toBe("/status");
});

test("@native @browser @mobile-critical @risk-access recheck reflects current D1 Membership state on the next request", async ({
  account,
  caseApp,
  page,
}) => {
  const signInResponse = await signIn(page.request, account);
  expect(signInResponse.status()).toBe(200);
  await setAccessState(caseApp, account.userId, "pending");

  await page.goto("/status");
  await expect(
    page.getByRole("heading", { name: statusTitles.membership_pending })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "前往主頁" })).toHaveCount(0);
  const restrictedBusiness = await page.request.get("/api/v2/me");
  expect(restrictedBusiness.status()).toBe(403);

  await setAccessState(caseApp, account.userId, "active");
  const recheck = page.getByRole("button", { name: "重新檢查狀態" });
  await recheck.click();
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
    data: { accessAllowed: true, displayName: account.fullName, reasons: [] },
  });
  const activeBusiness = await page.request.get("/api/v2/me");
  expect(activeBusiness.status()).toBe(200);
  await homeControl.click();
  await expect(page).toHaveURL(/\/$/u);
  await expect(page.getByRole("heading", { name: "我的主頁" })).toBeVisible();
  const home = await page.request.get("/");
  expect(home.status()).toBe(200);
});

devStatusTest(
  "@native @browser @dev @risk-access the Vite status recheck stays gated until hydration then reads fresh Membership",
  async ({ devAccount, devProvision, page }) => {
    const signInResponse = await page.request.post(
      "/api/auth/sign-in/username",
      {
        data: {
          password: devAccount.password,
          username: devAccount.username,
        },
        headers: { origin: DEV_ORIGIN },
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
        url.origin === DEV_ORIGIN &&
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
          url.origin === DEV_ORIGIN &&
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

test("@native @browser @mobile-critical @risk-session a revoked session cannot reach the authenticated status surface", async ({
  account,
  caseApp,
  page,
}) => {
  const signInResponse = await signIn(page.request, account);
  expect(signInResponse.status()).toBe(200);
  const initialStatus = await page.request.get("/api/v2/status");
  expect(initialStatus.status()).toBe(200);

  const revoked = await caseApp.db
    .prepare("DELETE FROM session WHERE user_id = ?")
    .bind(account.userId)
    .run();
  expect(revoked.meta.changes).toBe(1);

  const revokedStatus = await page.request.get("/api/v2/status");
  expect(revokedStatus.status()).toBe(401);
  const status = await page.request.get("/status", { maxRedirects: 0 });
  expect(status.status()).toBe(307);
  expect(status.headers().location).toBe(
    "/sign-in?reason=authentication-required"
  );
  await page.goto("/status");
  await expect(page).toHaveURL(/\/sign-in\?reason=authentication-required$/u);
});
