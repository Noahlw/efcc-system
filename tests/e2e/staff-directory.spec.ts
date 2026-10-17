import { randomBytes } from "node:crypto";

import { dedicatedTest as test, expect } from "../support/fixtures";

test(
  "Staff directory pages every permitted account and restores the list page after detail",
  {
    tag: [
      "@native",
      "@browser",
      "@account-assisted",
      "@mobile-critical",
      "@risk-authorization",
      "@risk-privacy",
      "@risk-recovery",
    ],
  },
  async ({ caseApp, staffPage: page }) => {
    const namespace = randomBytes(5).toString("hex");
    await Promise.all(
      Array.from({ length: 31 }, (_, index) => {
        const number = String(index + 1).padStart(3, "0");
        const username = `directory.${namespace}.${number}`;
        return caseApp.provision.account({
          email: `${username}@example.test`,
          fullName: `陳目錄${number}`,
          membershipStatus: "active",
          password: "Synthetic-directory-password!",
          username,
        });
      })
    );
    await page.goto("/staff/accounts?view=people");
    const rows = page.locator("main a[href*='person=']");
    await expect(rows).toHaveCount(25);
    await expect(rows.first()).toContainText("陳目錄001");
    await expect(rows.last()).toContainText("陳目錄025");
    await page.getByRole("button", { name: "下一頁帳戶" }).click();
    await expect(rows).toHaveCount(6);
    await expect(rows.first()).toContainText("陳目錄026");
    await expect(rows.last()).toContainText("陳目錄031");
    expect(new URL(page.url()).searchParams.get("page")).toBe("2");
    await rows.last().click();
    await expect(page.getByRole("heading", { name: "帳戶詳情" })).toBeVisible();
    await expect(page.getByRole("main")).toContainText("陳目錄031");
    await page.getByRole("link", { exact: true, name: "返回帳戶列表" }).click();
    await expect(rows).toHaveCount(6);
    expect(new URL(page.url()).searchParams.get("page")).toBe("2");
    await expect(rows.last()).toContainText("陳目錄031");
    await page.getByRole("button", { name: "上一頁帳戶" }).click();
    await expect(rows).toHaveCount(25);
    await expect(rows.first()).toContainText("陳目錄001");
    await page.getByRole("button", { name: "下一頁帳戶" }).click();
    await expect(rows).toHaveCount(6);
    const expectInvalidPageOne = async (invalid: string) => {
      await page.goto(
        `/staff/accounts?view=people&page=${encodeURIComponent(invalid)}`
      );
      await expect(rows).toHaveCount(25);
      await expect(rows.first()).toContainText("陳目錄001");
      await expect
        .poll(() => new URL(page.url()).searchParams.has("page"))
        .toBe(false);
    };
    await expectInvalidPageOne("2e0");
    await expectInvalidPageOne("0x2");
    await expectInvalidPageOne(" 2 ");
    await expectInvalidPageOne("bad");
    await expectInvalidPageOne("999");
    await page.getByRole("button", { name: "下一頁帳戶" }).click();
    await expect(rows).toHaveCount(6);
    const search = page.getByRole("searchbox", { name: "搜尋帳戶" });
    await search.fill("031");
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText("陳目錄031");
    expect(new URL(page.url()).searchParams.has("page")).toBe(false);
    const selectedId = new URL(
      (await rows.getAttribute("href")) ?? "",
      page.url()
    ).searchParams.get("person");
    expect(selectedId).toBeTruthy();
    await page.goto(
      `/staff/accounts?view=people&person=${selectedId}&q=does-not-match&page=2`
    );
    await expect(page.getByRole("heading", { name: "帳戶詳情" })).toBeVisible();
    await expect(page.getByRole("main")).toContainText("陳目錄031");
    await page.getByRole("link", { name: "修正身份資料" }).click();
    await expect(
      page.getByRole("heading", { name: "修正身份資料" })
    ).toBeVisible();
    expect(new URL(page.url()).searchParams.get("q")).toBe("does-not-match");
    expect(new URL(page.url()).searchParams.get("page")).toBe("2");
    await page.getByRole("link", { name: "返回帳戶詳情" }).click();
    await expect(page.getByRole("heading", { name: "帳戶詳情" })).toBeVisible();
    expect(new URL(page.url()).searchParams.get("q")).toBe("does-not-match");
    expect(new URL(page.url()).searchParams.get("page")).toBe("2");
    await page.getByRole("link", { name: "會籍與限制" }).click();
    await expect(
      page.getByRole("heading", { name: "會籍與安全限制" })
    ).toBeVisible();
    expect(new URL(page.url()).searchParams.get("page")).toBe("2");
    await page.getByRole("link", { name: "返回帳戶詳情" }).click();
    await expect(page.getByRole("heading", { name: "帳戶詳情" })).toBeVisible();
    expect(new URL(page.url()).searchParams.get("page")).toBe("2");
  }
);

test(
  "Staff live search commits a bounded HTTP query after composition and preserves visible invalid input",
  {
    tag: [
      "@native",
      "@browser",
      "@account-assisted",
      "@mobile-critical",
      "@risk-authorization",
      "@risk-privacy",
      "@risk-recovery",
    ],
  },
  async ({ caseApp, staffPage: page }) => {
    const namespace = randomBytes(5).toString("hex");
    await caseApp.provision.account({
      email: `live.${namespace}@example.test`,
      fullName: "陳搜尋目標",
      membershipStatus: "active",
      password: "Synthetic-directory-password!",
      username: `live.${namespace}`,
    });
    await page.goto("/staff/accounts?view=people");
    const input = page.getByRole("searchbox", { name: "搜尋帳戶" });
    await expect(input).toBeEnabled();
    const requests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (
        url.pathname.endsWith("/staff/accounts") &&
        url.pathname.startsWith("/api/")
      ) {
        requests.push(url.searchParams.get("q") ?? "");
      }
    });
    await input.dispatchEvent("compositionstart");
    await input.fill("陳搜尋");
    await input.dispatchEvent("compositionupdate", { data: "陳搜尋" });
    await page.waitForTimeout(500);
    expect(requests).toEqual([]);
    expect(new URL(page.url()).searchParams.has("q")).toBe(false);
    const response = page.waitForResponse(
      (received) =>
        new URL(received.url()).pathname.endsWith("/staff/accounts") &&
        new URL(received.url()).pathname.startsWith("/api/") &&
        new URL(received.url()).searchParams.get("q") === "陳搜尋"
    );
    await input.dispatchEvent("compositionend", { data: "陳搜尋" });
    const committedResponse = await response;
    expect(committedResponse.status()).toBe(200);
    await expect(page.locator("main a[href*='person=']")).toHaveCount(1);
    expect(new URL(page.url()).searchParams.get("q")).toBe("陳搜尋");
    const legalQuery = "𠮷".repeat(100);
    const legal = page.waitForResponse(
      (received) =>
        new URL(received.url()).pathname === "/api/v2/staff/accounts" &&
        new URL(received.url()).searchParams.get("q") === legalQuery
    );
    await input.fill(legalQuery);
    const legalResponse = await legal;
    expect(legalResponse.status()).toBe(200);
    await expect(input).toHaveValue(legalQuery);
    await input.fill("甲".repeat(101));
    await expect(page.getByRole("alert")).toContainText("100");
    await expect(input).toHaveValue("甲".repeat(101));
    expect(new URL(page.url()).searchParams.get("q")).toBe(legalQuery);
    const cleared = page.waitForResponse(
      (received) =>
        new URL(received.url()).pathname.startsWith("/api/") &&
        new URL(received.url()).pathname.endsWith("/staff/accounts") &&
        !new URL(received.url()).searchParams.get("q")
    );
    await input.fill("");
    const clearedResponse = await cleared;
    expect(clearedResponse.status()).toBe(200);
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(new URL(page.url()).searchParams.has("q")).toBe(false);
  }
);

for (const staleStatus of [200, 500]) {
  test(
    `Staff latest search ignores an older ${staleStatus} response and Back cancels pending work`,
    {
      tag: [
        "@native",
        "@browser",
        "@account-assisted",
        "@mobile-critical",
        "@risk-authorization",
        "@risk-privacy",
        "@risk-recovery",
      ],
    },
    async ({ caseApp, staffPage: page }) => {
      const namespace = randomBytes(5).toString("hex");
      const targets = await Promise.all(
        ["Alpha", "Beta"].map((name) =>
          caseApp.provision.account({
            email: `${name}.${namespace}@example.test`,
            fullName: `${name}目標`,
            membershipStatus: "active",
            password: "Synthetic-directory-password!",
            username: `${name.toLowerCase()}.${namespace}`,
          })
        )
      );
      const [alphaId] = targets;
      if (!alphaId) {
        throw new Error("Synthetic Alpha account was not provisioned");
      }
      await page.goto("/staff/accounts?view=people");
      const input = page.getByRole("searchbox", { name: "搜尋帳戶" });
      await expect(input).toBeEnabled();
      const { promise: held, resolve: arrived } =
        Promise.withResolvers<boolean>();
      const { promise: released, resolve: release } =
        Promise.withResolvers<boolean>();
      const { promise: deliveredResponse, resolve: delivered } =
        Promise.withResolvers<boolean>();
      await page.route("**/api/v2/staff/accounts?*", async (route) => {
        if (new URL(route.request().url()).searchParams.get("q") !== "Alpha") {
          await route.continue();
          return;
        }
        if (staleStatus === 500) {
          await caseApp.db
            .prepare(
              "UPDATE person_profile SET staff_search_key = NULL WHERE user_id = ?"
            )
            .bind(alphaId)
            .run();
        }
        const response = await route.fetch();
        expect(response.status()).toBe(staleStatus);
        if (staleStatus === 500) {
          await caseApp.db
            .prepare(
              "UPDATE person_profile SET staff_search_key = ? WHERE user_id = ?"
            )
            .bind(`alpha目標 alpha.${namespace}`, alphaId)
            .run();
        }
        arrived(true);
        await released;
        await route.fulfill({ response });
        delivered(true);
      });
      await input.fill("Alpha");
      await held;
      await expect(
        page.getByText("正在搜尋帳戶…", { exact: true })
      ).toBeVisible();
      const latest = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/v2/staff/accounts" &&
          new URL(response.url()).searchParams.get("q") === "Beta"
      );
      await input.fill("Beta");
      const latestResponse = await latest;
      expect(latestResponse.status()).toBe(200);
      const rows = page.locator("main a[href*='person=']");
      await expect(rows).toHaveCount(1);
      await expect(rows).toContainText("Beta目標");
      release(true);
      await deliveredResponse;
      await expect(rows).toHaveCount(1);
      await expect(rows).toContainText("Beta目標");
      await expect(input).toHaveValue("Beta");
      expect(new URL(page.url()).searchParams.get("q")).toBe("Beta");
      await expect(page.getByRole("alert")).toHaveCount(0);
      await expect(
        page.getByText("正在搜尋帳戶…", { exact: true })
      ).toHaveCount(0);
      await input.fill("not-yet-committed");
      await page.goBack();
      await expect(input).toHaveValue("Alpha");
      await page.waitForTimeout(500);
      expect(new URL(page.url()).searchParams.get("q")).toBe("Alpha");
      await page.goForward();
      await expect(input).toHaveValue("Beta");
      await expect(rows).toContainText("Beta目標");
    }
  );
}

test(
  "Staff composition resumes a canceled current query and clear wins over pending results",
  {
    tag: [
      "@native",
      "@browser",
      "@account-assisted",
      "@mobile-critical",
      "@risk-authorization",
      "@risk-privacy",
      "@risk-recovery",
    ],
  },
  async ({ caseApp, staffPage: page }) => {
    const namespace = randomBytes(5).toString("hex");
    await Promise.all(
      ["Alpha", "Beta"].map((name) =>
        caseApp.provision.account({
          email: `resume.${name}.${namespace}@example.test`,
          fullName: `${name}目標`,
          membershipStatus: "active",
          password: "Synthetic-directory-password!",
          username: `resume.${name.toLowerCase()}.${namespace}`,
        })
      )
    );
    await page.goto("/staff/accounts?view=people");
    const input = page.getByRole("searchbox", { name: "搜尋帳戶" });
    await expect(input).toBeEnabled();
    const first = Promise.withResolvers<boolean>();
    const releaseFirst = Promise.withResolvers<boolean>();
    const firstDelivered = Promise.withResolvers<boolean>();
    let alphaRequests = 0;
    await page.route("**/api/v2/staff/accounts?*", async (route) => {
      if (new URL(route.request().url()).searchParams.get("q") !== "Alpha") {
        await route.continue();
        return;
      }
      alphaRequests += 1;
      if (alphaRequests > 1) {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      first.resolve(true);
      await releaseFirst.promise;
      await route.fulfill({ response });
      firstDelivered.resolve(true);
    });
    await input.fill("Alpha");
    await first.promise;
    await input.dispatchEvent("compositionstart");
    await input.dispatchEvent("compositionupdate", { data: "Alpha" });
    await page.waitForTimeout(500);
    expect(alphaRequests).toBe(1);
    const resumed = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/v2/staff/accounts" &&
        new URL(response.url()).searchParams.get("q") === "Alpha",
      { timeout: 10_000 }
    );
    await input.dispatchEvent("compositionend", { data: "Alpha" });
    const resumedResponse = await resumed;
    expect(resumedResponse.status()).toBe(200);
    expect(alphaRequests).toBe(2);
    const rows = page.locator("main a[href*='person=']");
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText("Alpha目標");
    const clearResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/v2/staff/accounts" &&
        !new URL(response.url()).searchParams.get("q")
    );
    await input.fill("");
    const cleared = await clearResponse;
    expect(cleared.status()).toBe(200);
    await expect(rows).toHaveCount(2);
    releaseFirst.resolve(true);
    await firstDelivered.promise;
    await expect(rows).toHaveCount(2);
    await expect(input).toHaveValue("");
    expect(new URL(page.url()).searchParams.has("q")).toBe(false);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByText("正在搜尋帳戶…", { exact: true })).toHaveCount(
      0
    );
  }
);

test(
  "desktop selected Staff detail survives a live query transition and retains its task return",
  {
    tag: [
      "@native",
      "@browser",
      "@account-assisted",
      "@risk-authorization",
      "@risk-privacy",
      "@risk-recovery",
    ],
  },
  async ({ caseApp, staffPage: page }) => {
    const namespace = randomBytes(5).toString("hex");
    const selectedId = await caseApp.provision.account({
      email: `selected.${namespace}@example.test`,
      fullName: "Alpha已選對象",
      membershipStatus: "active",
      password: "Synthetic-directory-password!",
      username: `selected.${namespace}`,
    });
    await Promise.all(
      Array.from({ length: 25 }, (_, index) => {
        const number = String(index + 1).padStart(3, "0");
        const username = `peer.${namespace}.${number}`;
        return caseApp.provision.account({
          email: `${username}@example.test`,
          fullName: `Alpha同行${number}`,
          membershipStatus: "active",
          password: "Synthetic-directory-password!",
          username,
        });
      })
    );
    await caseApp.provision.account({
      email: `result.${namespace}@example.test`,
      fullName: "Beta搜尋結果",
      membershipStatus: "active",
      password: "Synthetic-directory-password!",
      username: `result.${namespace}`,
    });
    await page.setViewportSize({ height: 1024, width: 1440 });
    await page.goto(
      `/staff/accounts?view=people&person=${selectedId}&q=Alpha&page=2`
    );
    const detail = page.getByRole("region", { name: "帳戶詳情" });
    await expect(detail).toContainText("Alpha已選對象");
    const input = page.getByRole("searchbox", { name: "搜尋帳戶" });
    await expect(input).toBeVisible();
    await expect(input).toBeEnabled();
    await expect(page.getByText("第 2 頁", { exact: true })).toBeVisible();
    expect(new URL(page.url()).searchParams.get("page")).toBe("2");
    const initialPage = await page.request.get(
      "/api/v2/staff/accounts?q=Alpha&page=2"
    );
    expect(initialPage.status()).toBe(200);
    expect(await initialPage.json()).toMatchObject({
      data: {
        accounts: [{ userId: selectedId }],
        hasNextPage: false,
        page: 2,
      },
    });
    const arrived = Promise.withResolvers<boolean>();
    const released = Promise.withResolvers<boolean>();
    await page.route("**/api/v2/staff/accounts?*", async (route) => {
      if (new URL(route.request().url()).searchParams.get("q") !== "Beta") {
        await route.continue();
        return;
      }
      try {
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        arrived.resolve(true);
        await released.promise;
        await route.fulfill({ response });
      } catch (error) {
        arrived.reject(error);
        released.resolve(true);
        throw error;
      }
    });
    try {
      await input.fill("Beta");
      await arrived.promise;
      await expect(
        page.getByText("正在搜尋帳戶…", { exact: true })
      ).toBeVisible();
      await expect(detail).toContainText("Alpha已選對象");
      expect(new URL(page.url()).searchParams.get("person")).toBe(selectedId);
      expect(new URL(page.url()).searchParams.get("q")).toBe("Beta");
      expect(new URL(page.url()).searchParams.has("page")).toBe(false);
    } finally {
      released.resolve(true);
    }
    const rows = page.locator("main aside a[href*='person=']");
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText("Beta搜尋結果");
    await expect(detail).toContainText("Alpha已選對象");
    await page.getByRole("link", { name: "修正身份資料" }).click();
    await expect(
      page.getByRole("heading", { name: "修正身份資料" })
    ).toBeVisible();
    expect(new URL(page.url()).searchParams.get("person")).toBe(selectedId);
    expect(new URL(page.url()).searchParams.get("q")).toBe("Beta");
    expect(new URL(page.url()).searchParams.has("page")).toBe(false);
    await page.getByRole("link", { name: "返回帳戶詳情" }).click();
    await expect(detail).toContainText("Alpha已選對象");
    expect(new URL(page.url()).searchParams.get("q")).toBe("Beta");
  }
);
