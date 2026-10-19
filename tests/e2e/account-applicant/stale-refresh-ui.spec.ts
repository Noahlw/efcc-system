import { randomUUID } from "node:crypto";

import { expect, test } from "../../support/fixtures";
import {
  applicationInput,
  submitApplication,
} from "../account-decisions/test-helpers";
import { phone } from "../account-identity/test-helpers";
import { qualifyPresentation } from "../presentation-assertions";

const matchesApplicationRefresh = (url: URL) =>
  url.pathname === "/application" && url.searchParams.has("_rsc");

test(
  "acknowledging a completed correction starts the next action from a fresh application without a dirty-draft prompt",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@account-applicant",
      "@risk-freshness",
      "@risk-recovery",
      "@risk-history",
    ],
  },
  async ({ caseApp, signedInPage: page }) => {
    const profile = applicationInput();
    await submitApplication(page.request, profile);
    const login = await page.request.post("/api/auth/sign-in/username", {
      data: { password: profile.password, username: profile.username },
      headers: { origin: caseApp.origin },
    });
    expect(login.status()).toBe(200);
    await page.goto("/application");
    await page.getByRole("button", { name: /^修正申請資料/u }).click();
    const correctedName = "陳完成修正資料";
    await page.getByLabel("中文全名", { exact: true }).fill(correctedName);
    await page.getByRole("button", { exact: true, name: "檢查更改" }).click();
    const release = Promise.withResolvers<null>();
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) {
        release.resolve(null);
      }
    });
    const dialogs: string[] = [];
    page.on("dialog", async (dialog) => {
      dialogs.push(dialog.type());
      await dialog.dismiss();
    });
    await page.route(matchesApplicationRefresh, async (route) => {
      await release.promise;
      await route.continue();
    });
    try {
      await page
        .getByRole("button", { exact: true, name: "確認並提交更改" })
        .click();
      await expect(page.getByRole("status")).toContainText("伺服器已確認");
      const freshDocument = page.waitForResponse(
        (response) =>
          response.request().isNavigationRequest() &&
          new URL(response.url()).pathname === "/application",
        { timeout: 15_000 }
      );
      await page
        .getByRole("button", { exact: true, name: "完成，開始另一項操作" })
        .click();
      const freshResponse = await freshDocument;
      expect(freshResponse.status()).toBe(200);
      expect(dialogs).toEqual([]);
      release.resolve(null);
      await page.unrouteAll({ behavior: "wait" });
      await expect(page.getByText("資料已更新，請重新載入")).toHaveCount(0);
      await page.getByRole("button", { exact: true, name: "撤回申請" }).click();
      await expect(
        page.getByRole("definition").filter({ hasText: correctedName })
      ).toBeVisible();
      const withdrawal = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === "/api/v2/applications/actions"
      );
      await page.getByRole("button", { exact: true, name: "確認撤回" }).click();
      const withdrawalResponse = await withdrawal;
      expect(withdrawalResponse.status()).toBe(201);
      const rows = await caseApp.db
        .prepare(
          "SELECT action FROM applicant_operation WHERE user_id=(SELECT id FROM user WHERE username=?) ORDER BY created_at, rowid"
        )
        .bind(profile.username)
        .all<{ action: string }>();
      expect(rows.results.map((row) => row.action)).toEqual([
        "application_corrected",
        "application_withdrawn",
      ]);
    } finally {
      release.resolve(null);
      if (!page.isClosed()) {
        await page.unrouteAll({ behavior: "wait" });
      }
    }
  }
);

test(
  "Applicant Correction preserves its stale draft until explicit refresh replaces it with current authorised values",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@account-applicant",
      "@risk-freshness",
      "@risk-draft",
      "@risk-recovery",
    ],
  },
  async ({ caseApp, staff, signedInPage: page }, testInfo) => {
    const profile = applicationInput();
    await submitApplication(page.request, profile);
    const login = await page.request.post("/api/auth/sign-in/username", {
      data: { password: profile.password, username: profile.username },
      headers: { origin: caseApp.origin },
    });
    expect(login.status()).toBe(200);
    const native = await page.request.get("/api/auth/get-session");
    const session = await native.json();
    const before = await page.request.get("/api/v2/applications/mine");
    expect(before.status()).toBe(200);
    const beforeBody = await before.json();
    const value = beforeBody.data.application;
    const original = {
      canonicalUsername: value.canonicalUsername,
      email: value.email,
      fullName: value.fullName,
      phone: value.phone,
      phoneShared: value.phoneShared,
      username: value.username,
    };
    await page.goto("/application");
    await page.getByRole("button", { name: /^修正申請資料/u }).click();
    const draftName = "陳未儲存草稿";
    const latestName = "陳職員已核對";
    await page.getByLabel("中文全名", { exact: true }).fill(draftName);
    const changed = await staff.context.post(
      "/api/v2/staff/accounts/identity",
      {
        data: {
          email: value.email,
          fullName: latestName,
          identityCheck: "face_to_face",
          operationKey: randomUUID(),
          original,
          phone: phone(),
          sharedPhone: false,
          targetUserId: session.user.id,
          username: value.username,
        },
      }
    );
    expect(changed.status()).toBe(201);
    await page.getByRole("button", { exact: true, name: "檢查更改" }).click();
    const refused = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/v2/applications/actions"
    );
    await page
      .getByRole("button", { exact: true, name: "確認並提交更改" })
      .click();
    const response = await refused;
    expect(response.status()).toBe(409);
    expect(response.request().postDataJSON().original).toEqual(original);
    await expect(
      page.getByText("資料已更新，請重新載入", { exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("definition").filter({ hasText: draftName })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { exact: true, name: "確認並提交更改" })
    ).toBeDisabled();
    await page.getByRole("button", { exact: true, name: "返回修改" }).click();
    await expect(page.getByLabel("中文全名", { exact: true })).toHaveValue(
      draftName
    );
    await qualifyPresentation(page, testInfo, "applicant-stale-draft", {
      criticalAction: page.getByRole("button", {
        exact: true,
        name: "重新載入最新資料",
      }),
      drafts: page.getByLabel("中文全名", { exact: true }),
    });
    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath("applicant-stale-draft.png"),
    });
    await page
      .getByRole("button", { exact: true, name: "重新載入最新資料" })
      .click();
    await page.getByRole("button", { exact: true, name: "繼續編輯" }).click();
    await expect(page.getByLabel("中文全名", { exact: true })).toHaveValue(
      draftName
    );
    await page
      .getByRole("button", { exact: true, name: "重新載入最新資料" })
      .click();
    await page.getByRole("button", { exact: true, name: "放棄變更" }).click();
    await expect(page.getByLabel("中文全名", { exact: true })).toHaveValue(
      latestName
    );
    expect(
      await page.evaluate(() =>
        localStorage.getItem("efcc.applicant.operation.v1")
      )
    ).toBeNull();
    expect(
      await page.evaluate(() => JSON.stringify(Object.entries(localStorage)))
    ).not.toContain(draftName);
    const writes = await caseApp.db
      .prepare(
        "SELECT count(*) AS count FROM applicant_operation WHERE user_id = ? AND action = 'application_corrected'"
      )
      .bind(session.user.id)
      .first<{ count: number }>();
    expect(writes?.count).toBe(0);
  }
);
