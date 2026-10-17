import { dedicatedTest, expect } from "../../support/fixtures";

dedicatedTest(
  "Staff audit paging and independent detail restore page and task return context",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@risk-authorization",
      "@risk-recovery",
    ],
  },
  async ({ caseApp, staffPage: page, staff }) => {
    const createdAt = Math.floor(Date.now() / 1000) + 120;
    const events = Array.from({ length: 28 }, (_, index) => {
      const suffix = String(index).padStart(3, "0");
      return {
        action: "synthetic_retained_audit",
        actorUserId: staff.userId,
        createdAt,
        id: `synthetic-account-audit-${suffix}`,
        targetUserId: `deleted-account-${suffix}`,
      };
    });
    await caseApp.db.batch(
      events.map((event) =>
        caseApp.db
          .prepare(
            "INSERT INTO audit_event (action, actor_user_id, created_at, id, target_user_id) VALUES (?, ?, ?, ?, ?)"
          )
          .bind(
            event.action,
            event.actorUserId,
            event.createdAt,
            event.id,
            event.targetUserId
          )
      )
    );

    const selectedId = events[0]?.id;
    if (!selectedId) {
      throw new Error("Missing synthetic retained audit row");
    }

    await page.goto(
      `/staff/account-audit?taskReturn=accounts&record=${selectedId}`
    );
    await expect(
      page.getByRole("region", { name: "帳戶紀錄詳情" })
    ).toContainText("deleted-account-000");
    let currentUrl = new URL(page.url());
    expect(currentUrl.searchParams.get("taskReturn")).toBe("accounts");
    expect(currentUrl.searchParams.get("page")).toBeNull();

    await page.getByRole("link", { name: "返回帳戶紀錄" }).click();
    await expect(page.locator("main ol > li")).toHaveCount(25);
    currentUrl = new URL(page.url());
    expect(currentUrl.searchParams.get("taskReturn")).toBe("accounts");

    await page.getByRole("button", { name: "下一頁" }).click();
    await expect(page.locator("main ol > li")).toHaveCount(4);
    currentUrl = new URL(page.url());
    expect(currentUrl.searchParams.get("page")).toBe("2");
    expect(currentUrl.searchParams.get("taskReturn")).toBe("accounts");

    const selectedLink = page.locator(
      `a[href*="record=${selectedId}"][href*="page=2"]`
    );
    await expect(selectedLink).toBeVisible();
    await selectedLink.click();
    await expect(
      page.getByRole("region", { name: "帳戶紀錄詳情" })
    ).toContainText("deleted-account-000");
    currentUrl = new URL(page.url());
    expect(currentUrl.searchParams.get("page")).toBe("2");
    expect(currentUrl.searchParams.get("taskReturn")).toBe("accounts");

    await page.goBack();
    await expect(page.locator("main ol > li")).toHaveCount(4);
    currentUrl = new URL(page.url());
    expect(currentUrl.searchParams.get("page")).toBe("2");
    expect(currentUrl.searchParams.get("taskReturn")).toBe("accounts");

    await page.goto("/staff/account-audit?page=not-a-page&taskReturn=accounts");
    await expect(page.locator("main ol > li")).toHaveCount(25);
    currentUrl = new URL(page.url());
    expect(currentUrl.searchParams.get("page")).toBeNull();
    expect(currentUrl.searchParams.get("taskReturn")).toBe("accounts");

    await page.goto(
      "/staff/account-audit?taskReturn=accounts&page=2&record=missing-retained-record"
    );
    await expect(
      page.getByRole("heading", { name: "找不到帳戶紀錄" })
    ).toBeVisible();
    const missingRecordReturn = page.getByRole("link", {
      name: "返回帳戶紀錄",
    });
    const missingRecordHref = new URL(
      (await missingRecordReturn.getAttribute("href")) ?? "",
      page.url()
    );
    expect(missingRecordHref.searchParams.get("page")).toBe("2");
    expect(missingRecordHref.searchParams.get("taskReturn")).toBe("accounts");
    await missingRecordReturn.click();
    await expect(page.locator("main ol > li")).toHaveCount(4);
  }
);
