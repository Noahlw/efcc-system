import { expect, test } from "../../support/fixtures";
import {
  applicationIdentity,
  applicationInput,
  submitApplication,
} from "./test-helpers";

const matchesRefresh = (url: URL) =>
  url.pathname === "/staff/applications" && url.searchParams.has("_rsc");

test(
  "leaving a completed decision through native Account navigation isolates its held refresh response",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@risk-privacy",
      "@risk-recovery",
      "@risk-history",
    ],
  },
  async ({ caseApp, request, staff, staffPage: page }) => {
    const input = applicationInput();
    await submitApplication(request, input);
    const identity = await applicationIdentity(caseApp, input.username);
    await page.goto(`/staff/applications?record=${identity.applicationId}`);
    const note = "Synthetic completed-decision navigation private note";
    await page.getByLabel("內部備註（選填，申請人不可見）").fill(note);
    await page
      .getByRole("button", { exact: true, name: "檢查並預覽決定" })
      .click();
    const release = Promise.withResolvers<null>();
    await page.route(matchesRefresh, async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await release.promise;
      await route.fulfill({ response });
    });
    try {
      const committed = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname ===
            "/api/v2/staff/application-decisions"
      );
      await page
        .getByRole("button", { exact: true, name: "確認並提交批准" })
        .click();
      const decisionResponse = await committed;
      expect(decisionResponse.status()).toBe(201);
      await expect(
        page.getByRole("status").filter({ hasText: "伺服器已確認" })
      ).toBeVisible();
      const queueRead = page.waitForResponse(
        (response) =>
          response.request().isNavigationRequest() &&
          new URL(response.url()).pathname === "/staff/applications"
      );
      // Mobile tasks intentionally hide global navigation. Complete the owned
      // task first on every project, then use its actual account-management exit.
      await page
        .getByRole("button", { exact: true, name: "返回待批清單" })
        .and(page.locator("button:enabled"))
        .click();
      const queueResponse = await queueRead;
      expect(queueResponse.status()).toBe(200);
      await expect(page).toHaveURL(
        (url) =>
          url.pathname === "/staff/applications" &&
          !url.searchParams.has("record")
      );
      expect(
        await page.evaluate(() =>
          localStorage.getItem("efcc.application-decision.operation.v1")
        )
      ).toBeNull();
      await page
        .getByRole("navigation", { name: "主要導覽" })
        .getByRole("link", { exact: true, name: "帳戶" })
        .click();
      await expect(page).toHaveURL(/\/account$/u);
      await expect(
        page.getByRole("region", { name: "個人資料" })
      ).toContainText(staff.account.fullName);
      release.resolve(null);
      await page.unrouteAll({ behavior: "wait" });
      await expect(page).toHaveURL(/\/account$/u);
      await expect(page.getByText(note, { exact: true })).toHaveCount(0);
      const stored = await caseApp.db
        .prepare(
          "SELECT outcome, internal_note FROM application_decision WHERE application_id = ?"
        )
        .bind(identity.applicationId)
        .all();
      expect(stored.results).toEqual([
        { internal_note: note, outcome: "approved" },
      ]);
    } finally {
      release.resolve(null);
      if (!page.isClosed()) {
        await page.unrouteAll({ behavior: "wait" });
      }
    }
  }
);
