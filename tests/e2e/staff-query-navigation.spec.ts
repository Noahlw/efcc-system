import { dedicatedTest as test, expect } from "../support/fixtures";

test(
  "Staff direct and reloaded invalid queries remain correctable with independent detail and task context",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@account-assisted",
      "@risk-authorization",
      "@risk-recovery",
    ],
  },
  async ({ caseApp, staffPage: page, staff }) => {
    const targetId = await caseApp.provision.account({
      email: "query-target@example.test",
      fullName: "陳查詢目標",
      membershipStatus: "active",
      password: "Synthetic-query-password!",
      username: "query.target",
    });
    const invalid = "𠮷".repeat(101);
    const legal = "𠮷".repeat(100);
    const url = (extra: Record<string, string> = {}) =>
      `/staff/accounts?${new URLSearchParams({ page: "bad", q: invalid, view: "people", ...extra })}`;
    await page.goto(url());
    const search = page.getByRole("searchbox", { name: "搜尋帳戶" });
    await expect(search).toHaveValue(invalid);
    await expect(page.getByRole("alert")).toContainText("100");
    await expect(
      page.getByText("暫時未能載入帳戶管理", { exact: true })
    ).toHaveCount(0);
    await expect(
      page.getByText("找不到符合的帳戶，請修改姓名或 Username 後重試。", {
        exact: true,
      })
    ).toHaveCount(0);
    await page.reload();
    await expect(search).toHaveValue(invalid);
    await expect(page.getByRole("alert")).toContainText("100");
    await expect(search).toBeEnabled();
    await expect
      .poll(() => new URL(page.url()).searchParams.has("page"))
      .toBe(false);
    await search.fill(legal);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect
      .poll(() => new URL(page.url()).searchParams.get("q"))
      .toBe(legal);
    await page.reload();
    await expect(search).toHaveValue(legal);
    await expect(search).toBeEnabled();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await search.fill("");
    await expect(page.getByRole("link", { name: /陳查詢目標/u })).toBeVisible();
    await page.goto(url({ page: "2", person: targetId }));
    await expect(page.getByRole("heading", { name: "帳戶詳情" })).toBeVisible();
    await expect(page.getByRole("alert")).toContainText("100");
    await expect(search).toBeVisible();
    await page.reload();
    await expect(page.getByRole("alert")).toContainText("100");
    await expect(search).toBeEnabled();
    await search.fill("查詢目標");
    await expect
      .poll(() => new URL(page.url()).searchParams.get("q"))
      .toBe("查詢目標");
    expect(new URL(page.url()).searchParams.get("person")).toBe(targetId);
    await expect(page.getByRole("heading", { name: "帳戶詳情" })).toBeVisible();
    await page.goto(url({ page: "2", person: targetId, task: "identity" }));
    await expect(
      page.getByRole("heading", { name: "修正身份資料" })
    ).toBeVisible();
    await expect(page.getByRole("alert")).toContainText("100");
    await expect(search).toBeEnabled();
    await search.fill("查詢目標");
    await page.getByRole("button", { name: "修正搜尋" }).click();
    await expect(
      page.getByRole("heading", { name: "修正身份資料" })
    ).toBeVisible();
    expect(new URL(page.url()).searchParams.get("person")).toBe(targetId);
    expect(new URL(page.url()).searchParams.get("task")).toBe("identity");
    expect(new URL(page.url()).searchParams.get("q")).toBe("查詢目標");
    const response = await staff.context.get(
      `/api/v2/staff/accounts?q=${encodeURIComponent(invalid)}&page=bad`
    );
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("validation_error");
  }
);

test(
  "Staff invalid-query pages retain missing-session and non-Staff precedence",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@account-assisted",
      "@risk-authorization",
    ],
  },
  async ({ page, signedInPage }) => {
    const href = `/staff/accounts?view=people&q=${encodeURIComponent("甲".repeat(101))}&page=bad`;
    await page.goto(href);
    await expect(page).toHaveURL(/\/sign-in/u);
    await page.goto(`${href}&person=unknown&task=identity`);
    await expect(page).toHaveURL(/\/sign-in/u);
    await signedInPage.goto(href);
    await expect(signedInPage.getByRole("searchbox")).toHaveCount(0);
    await expect(
      signedInPage.getByText("搜尋內容最多可輸入 100 個字。", { exact: true })
    ).toHaveCount(0);
    await expect(
      signedInPage.getByRole("heading", { name: "你沒有帳戶管理權限" })
    ).toBeVisible();
    await signedInPage.goto(`${href}&person=unknown&task=identity`);
    await expect(
      signedInPage.getByRole("heading", { name: "你沒有帳戶管理權限" })
    ).toBeVisible();
    await expect(signedInPage.getByRole("searchbox")).toHaveCount(0);
  }
);
