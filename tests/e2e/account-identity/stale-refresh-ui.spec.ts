import { randomUUID } from "node:crypto";

import { expect, test } from "../../support/fixtures";
import { qualifyPresentation } from "../presentation-assertions";
import { phone } from "./test-helpers";

test(
  "Own Phone retains a stale draft through cancelled and failed refresh, replacing it only after confirmed authorised success",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@account-identity",
      "@risk-freshness",
      "@risk-draft",
      "@risk-recovery",
    ],
  },
  async (
    { account, caseApp, staff, signedInRequest, signedInPage: page },
    testInfo
  ) => {
    const baseline = await signedInRequest.get("/api/v2/account/identity");
    expect(baseline.status()).toBe(200);
    const baselineBody = await baseline.json();
    const value = baselineBody.data.identity;
    const original = {
      canonicalUsername: value.canonicalUsername,
      email: value.email,
      fullName: value.fullName,
      phone: value.phone,
      phoneShared: value.phoneShared,
      username: value.username,
    };
    const draftPhone = phone();
    const newerPhone = phone();
    await page.goto("/account?task=phone");
    await page.getByLabel("新電話", { exact: true }).fill(draftPhone);
    const changed = await staff.context.post(
      "/api/v2/staff/accounts/identity",
      {
        data: {
          email: value.email,
          fullName: value.fullName,
          identityCheck: "face_to_face",
          operationKey: randomUUID(),
          original,
          phone: newerPhone,
          sharedPhone: false,
          targetUserId: account.userId,
          username: value.username,
        },
      }
    );
    expect(changed.status()).toBe(201);
    await page.getByRole("button", { exact: true, name: "檢查電話" }).click();
    const refused = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/v2/account/phone"
    );
    await page
      .getByRole("button", { exact: true, name: "確認並儲存電話" })
      .click();
    const response = await refused;
    expect(response.status()).toBe(409);
    expect(response.request().postDataJSON().original).toEqual({
      phone: original.phone,
      phoneShared: original.phoneShared,
    });
    await expect(
      page.getByText("資料已更新，請重新載入", { exact: true })
    ).toBeVisible();
    await expect(page.getByLabel("新電話", { exact: true })).toHaveValue(
      draftPhone
    );
    await expect(
      page.getByRole("button", { exact: true, name: "確認並儲存電話" })
    ).toBeDisabled();
    await qualifyPresentation(page, testInfo, "own-phone-stale-draft", {
      criticalAction: page.getByRole("button", {
        exact: true,
        name: "重新載入最新資料",
      }),
      drafts: page.getByLabel("新電話", { exact: true }),
    });
    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath("stale-draft-preserved.png"),
    });
    await page
      .getByRole("button", { exact: true, name: "重新載入最新資料" })
      .click();
    await page.getByRole("button", { exact: true, name: "繼續編輯" }).click();
    await expect(page.getByLabel("新電話", { exact: true })).toHaveValue(
      draftPhone
    );
    await page.route("**/api/v2/account/identity", (route) =>
      route.abort("failed")
    );
    await page
      .getByRole("button", { exact: true, name: "重新載入最新資料" })
      .click();
    await page.getByRole("button", { exact: true, name: "放棄變更" }).click();
    await expect(
      page.getByText("未能載入最新資料，原草稿已保留；請稍後再次重新載入。", {
        exact: true,
      })
    ).toBeVisible();
    await expect(page.getByLabel("新電話", { exact: true })).toHaveValue(
      draftPhone
    );
    await page.unroute("**/api/v2/account/identity");
    const arrived = Promise.withResolvers<boolean>();
    const release = Promise.withResolvers<boolean>();
    const settled = Promise.withResolvers<boolean>();
    await page.route("**/api/v2/account/identity", async (route) => {
      const current = await route.fetch();
      expect(current.status()).toBe(200);
      const body = await current.json();
      expect(body.data.identity.phone).toBe(`+852${newerPhone}`);
      arrived.resolve(true);
      try {
        await release.promise;
        await route.fulfill({ response: current });
      } finally {
        settled.resolve(true);
      }
    });
    try {
      await page
        .getByRole("button", { exact: true, name: "重新載入最新資料" })
        .click();
      await page.getByRole("button", { exact: true, name: "放棄變更" }).click();
      await arrived.promise;
      await expect(page.getByLabel("新電話", { exact: true })).toHaveValue(
        draftPhone
      );
      release.resolve(true);
      await settled.promise;
      await expect(page.getByLabel("新電話", { exact: true })).toHaveValue(
        `+852${newerPhone}`
      );
      await expect(
        page.getByRole("button", { exact: true, name: "檢查電話" })
      ).toBeEnabled();
      expect(
        await page.evaluate(() =>
          localStorage.getItem("efcc.identity-change.operation.v1")
        )
      ).toBeNull();
      expect(
        await page.evaluate(() => JSON.stringify(Object.entries(localStorage)))
      ).not.toContain(draftPhone);
      const ownWrites = await caseApp.db
        .prepare(
          "SELECT count(*) AS count FROM account_change_operation WHERE actor_user_id = ? AND action = 'own_phone_changed'"
        )
        .bind(account.userId)
        .first<{ count: number }>();
      expect(ownWrites?.count).toBe(0);
    } finally {
      release.resolve(true);
      await settled.promise;
      await page.unroute("**/api/v2/account/identity");
    }
  }
);
