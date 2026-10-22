import { randomUUID } from "node:crypto";

import type { Page } from "@playwright/test";

import { expect, test } from "../../support/fixtures";
import type { NativeApp } from "../../support/fixtures";
import {
  applicationInput,
  submitApplication,
} from "../account-decisions/test-helpers";
import { phone } from "../account-identity/test-helpers";
import { qualifyPresentation } from "../presentation-assertions";

const matchesApplicationRefresh = (url: URL) =>
  url.pathname === "/application" && url.searchParams.has("_rsc");

const assertFailedApplicantRefresh = async (
  page: Page,
  draftName: string,
  fault: "network" | "malformed"
) => {
  await page.route("**/api/v2/applications/mine", (route) =>
    fault === "network"
      ? route.abort("failed")
      : route.fulfill({
          body: '{"data":{"application":"malformed"}}',
          contentType: "application/json",
          status: 200,
        })
  );
  const attempted = page.waitForRequest(
    (request) => new URL(request.url()).pathname === "/api/v2/applications/mine"
  );
  await page
    .getByRole("button", { exact: true, name: "重新載入最新資料" })
    .click();
  await page.getByRole("button", { exact: true, name: "放棄變更" }).click();
  await attempted;
  await expect(
    page.getByRole("button", { exact: true, name: "重新載入最新資料" })
  ).toBeEnabled();
  await expect(
    page.getByText("未能載入最新資料，原草稿已保留；請稍後再次重新載入。", {
      exact: true,
    })
  ).toBeVisible();
  await expect(page.getByLabel("中文全名", { exact: true })).toHaveValue(
    draftName
  );
  await page.unroute("**/api/v2/applications/mine");
};

const assertDeniedApplicantRefresh = async (
  page: Page,
  app: NativeApp,
  username: string,
  draftName: string
) => {
  const held = Promise.withResolvers<null>();
  const release = Promise.withResolvers<null>();
  await page.route(matchesApplicationRefresh, async (route) => {
    held.resolve(null);
    await release.promise;
    await route.continue();
  });
  try {
    await app.db
      .prepare(
        "UPDATE person_profile SET banned_at=unixepoch() WHERE user_id=(SELECT id FROM user WHERE username=?)"
      )
      .bind(username)
      .run();
    const denied = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/v2/applications/mine"
    );
    await page
      .getByRole("button", { exact: true, name: "重新載入最新資料" })
      .click();
    await page.getByRole("button", { exact: true, name: "放棄變更" }).click();
    const response = await denied;
    expect(response.status()).toBe(403);
    const body = await response.json();
    expect(body.error.code).toBe("business_access_denied");
    await held.promise;
    await expect(page.getByLabel("中文全名", { exact: true })).toHaveCount(0);
    // Restore only this synthetic fixture before the held page recheck reaches the Server.
    await app.db
      .prepare(
        "UPDATE person_profile SET banned_at=NULL WHERE user_id=(SELECT id FROM user WHERE username=?)"
      )
      .bind(username)
      .run();
    const resumed = page.waitForResponse((result) =>
      matchesApplicationRefresh(new URL(result.url()))
    );
    release.resolve(null);
    const resumedResponse = await resumed;
    expect(resumedResponse.status()).toBe(200);
    await page.unrouteAll({ behavior: "wait" });
    await page
      .getByRole("button", { exact: true, name: "查核之前的操作" })
      .click();
    await expect(page.getByLabel("中文全名", { exact: true })).toHaveValue(
      draftName
    );
  } finally {
    release.resolve(null);
    await app.db
      .prepare(
        "UPDATE person_profile SET banned_at=NULL WHERE user_id=(SELECT id FROM user WHERE username=?)"
      )
      .bind(username)
      .run();
    await page.unrouteAll({ behavior: "wait" });
  }
};

for (const finishInDraftTab of [false, true]) {
  test(
    finishInDraftTab
      ? "acknowledging a foreign correction preserves the local draft after UNKNOWN original-key recovery"
      : "a foreign completed correction preserves the other tab's unsaved Applicant draft through receipt refresh",
    {
      tag: [
        "@native",
        "@browser",
        "@mobile-critical",
        "@account-applicant",
        "@risk-freshness",
        "@risk-draft",
        "@risk-recovery",
        "@risk-presentation",
      ],
    },
    async ({ caseApp, signedInPage: page }, testInfo) => {
      const profile = applicationInput();
      await submitApplication(page.request, profile);
      const login = await page.request.post("/api/auth/sign-in/username", {
        data: { password: profile.password, username: profile.username },
        headers: { origin: caseApp.origin },
      });
      expect(login.status()).toBe(200);
      const other = await page.context().newPage();
      const dialogs: string[] = [];
      page.on("dialog", async (dialog) => {
        dialogs.push(dialog.type());
        await dialog.dismiss();
      });
      const draftName = "陳甲頁未提交草稿";
      const committedName = "陳乙頁_B_COMMITTED";
      try {
        await page.goto("/application");
        await other.goto("/application");
        await page.getByRole("button", { name: /^修正申請資料/u }).click();
        await other.getByRole("button", { name: /^修正申請資料/u }).click();
        await page.getByLabel("中文全名", { exact: true }).fill(draftName);
        await other.getByLabel("中文全名", { exact: true }).fill(committedName);
        await other
          .getByRole("button", { exact: true, name: "檢查更改" })
          .click();
        if (finishInDraftTab) {
          await page.route(
            "**/api/v2/applications/actions/reconcile",
            (route) => route.abort("failed")
          );
        }
        const reconciliation = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname ===
            "/api/v2/applications/actions/reconcile"
        );
        const refreshed = page.waitForResponse(
          (response) =>
            matchesApplicationRefresh(new URL(response.url())) &&
            response.status() === 200
        );
        const committed = other.waitForResponse(
          (response) =>
            response.request().method() === "POST" &&
            new URL(response.url()).pathname === "/api/v2/applications/actions"
        );
        await other
          .getByRole("button", { exact: true, name: "確認並提交更改" })
          .click();
        const committedResponse = await committed;
        expect(committedResponse.status()).toBe(201);
        const saved = await other.evaluate(() =>
          localStorage.getItem("efcc.applicant.operation.v1")
        );
        if (!saved) {
          throw new Error(
            "Real form did not retain its completed operation key"
          );
        }
        if (finishInDraftTab) {
          await expect(
            page.getByRole("status").filter({ hasText: "暫時未能查核" })
          ).toBeVisible();
          expect(
            await page.evaluate(() =>
              localStorage.getItem("efcc.applicant.operation.v1")
            )
          ).toBe(saved);
          await page.unroute("**/api/v2/applications/actions/reconcile");
          await page
            .getByRole("button", { exact: true, name: "查核之前的操作" })
            .click();
        }
        const reconciled = await reconciliation;
        expect(reconciled.status()).toBe(200);
        expect(reconciled.request().postDataJSON().operationKey).toBe(
          JSON.parse(saved).key
        );
        const fresh = await refreshed;
        expect(fresh.headers()["content-type"]).toContain("text/x-component");
        await expect(
          page.getByRole("status").filter({ hasText: "伺服器已確認" })
        ).toBeVisible();
        await expect(
          other.getByRole("status").filter({ hasText: "伺服器已確認" })
        ).toBeVisible();
        const completionPage = finishInDraftTab ? page : other;
        if (finishInDraftTab) {
          await qualifyPresentation(
            page,
            testInfo,
            "applicant-foreign-confirmed-draft",
            {
              criticalAction: page.getByRole("button", {
                exact: true,
                name: "保留草稿，繼續核對",
              }),
              drafts: page.getByLabel("中文全名", { exact: true }),
            }
          );
        }
        await completionPage
          .getByRole("button", {
            exact: true,
            name: finishInDraftTab
              ? "保留草稿，繼續核對"
              : "完成，開始另一項操作",
          })
          .click();
        await expect(page.getByLabel("中文全名", { exact: true })).toHaveValue(
          draftName
        );
        await expect(
          page.getByText("資料已更新，請重新載入", { exact: true })
        ).toBeVisible();
        await page
          .getByRole("button", { exact: true, name: "檢查更改" })
          .click();
        await expect(
          page.getByRole("button", { exact: true, name: "確認並提交更改" })
        ).toBeDisabled();
        await page
          .getByRole("button", { exact: true, name: "返回修改" })
          .click();
        await qualifyPresentation(
          page,
          testInfo,
          "applicant-foreign-receipt-draft",
          {
            criticalAction: page.getByRole("button", {
              exact: true,
              name: "重新載入最新資料",
            }),
            drafts: page.getByLabel("中文全名", { exact: true }),
          }
        );
        await page
          .getByRole("button", { exact: true, name: "重新載入最新資料" })
          .click();
        await page
          .getByRole("button", { exact: true, name: "繼續編輯" })
          .click();
        await expect(page.getByLabel("中文全名", { exact: true })).toHaveValue(
          draftName
        );
        await assertFailedApplicantRefresh(page, draftName, "network");
        await assertFailedApplicantRefresh(page, draftName, "malformed");
        await assertDeniedApplicantRefresh(
          page,
          caseApp,
          profile.username,
          draftName
        );
        await page
          .getByRole("button", { exact: true, name: "重新載入最新資料" })
          .click();
        await page
          .getByRole("button", { exact: true, name: "放棄變更" })
          .click();
        await expect(page.getByLabel("中文全名", { exact: true })).toHaveValue(
          committedName
        );
        expect(
          await page.evaluate(() =>
            localStorage.getItem("efcc.applicant.operation.v1")
          )
        ).toBeNull();
        const operations = await caseApp.db
          .prepare(
            "SELECT count(*) AS count FROM applicant_operation WHERE user_id=(SELECT id FROM user WHERE username=?)"
          )
          .bind(profile.username)
          .first<{ count: number }>();
        expect(operations?.count).toBe(1);
        expect(dialogs).toEqual([]);
      } finally {
        await other.close();
      }
    }
  );
}

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
      page.getByRole("heading", { exact: true, name: "申請資料需要檢查" })
    ).toHaveCount(0);
    await expect(
      page.getByText("資料已更新，請重新載入", { exact: true })
    ).toHaveCount(1);
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
