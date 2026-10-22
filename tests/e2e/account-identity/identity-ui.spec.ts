import { randomUUID } from "node:crypto";

import { expect, test } from "../../support/fixtures";
import type { ProvisionAccount } from "../../worker/provision";
import { qualifyPresentation } from "../presentation-assertions";
import { expectResponseStatus, phone } from "./test-helpers";

for (const action of ["phone", "revoke-others"] as const) {
  test(
    `stale ${action} page cannot mutate the account signed in by another tab`,
    {
      tag: [
        "@native",
        "@browser",
        "@mobile-critical",
        "@account-identity",
        "@risk-auth",
        "@risk-recovery",
      ],
    },
    async ({
      account,
      caseApp,
      extraHTTPHeaders,
      playwright,
      signedInPage: page,
    }) => {
      const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
      const other: ProvisionAccount = {
        email: `identity.other.${suffix}@example.com`,
        fullName: `陳另一帳戶${suffix}`,
        membershipStatus: "active",
        password: "Synthetic-identity-password!",
        username: `identity.other.${suffix}`,
      };
      const otherId = await caseApp.provision.account(other);
      const context = page.context();
      await page.goto("/account");
      const isPhone = action === "phone";
      if (isPhone) {
        await page.getByRole("link", { name: "更新聯絡電話" }).click();
      } else {
        await page.getByRole("link", { name: /^帳戶安全/u }).click();
        await page.getByRole("link", { name: /^登出其他裝置/u }).click();
      }
      const region = isPhone
        ? page.getByRole("region", { name: "更改自己的電話" })
        : page.getByRole("main", { name: "帳戶安全操作" });
      const startButton = region.getByRole("button", {
        exact: true,
        name: isPhone ? "檢查電話" : "登出其他裝置",
      });
      await expect(startButton).toBeEnabled();
      const secondPage = await context.newPage();
      await secondPage.goto("/account");
      await secondPage
        .getByRole("button", { exact: true, name: "登出" })
        .click();
      await expect(secondPage).toHaveURL(/\/sign-in$/u);
      await secondPage.getByLabel("Username").fill(other.username);
      await secondPage.getByLabel("密碼", { exact: true }).fill(other.password);
      await secondPage
        .getByRole("button", { exact: true, name: "登入" })
        .click();
      await expect(secondPage).toHaveURL(/\/$/u);
      await expect(
        secondPage.getByText(`歡迎回來，${other.fullName}。`, { exact: true })
      ).toBeVisible();
      const current = await expectResponseStatus(
        context.request.get("/api/v2/account/identity"),
        200
      );
      const currentBody = await current.json();
      expect(currentBody.data.identity.actorUserId).toBe(otherId);
      if (!extraHTTPHeaders) {
        throw new Error("Native request headers are unavailable.");
      }
      const primaryIp = extraHTTPHeaders["cf-connecting-ip"];
      if (!primaryIp) {
        throw new Error("The native client address header is unavailable.");
      }
      // A distinct trusted /64 represents the other device and its own limiter bucket.
      const [firstGroup, secondGroup, thirdGroup, lastGroup] =
        primaryIp.split(":");
      if (
        !firstGroup ||
        !secondGroup ||
        !thirdGroup ||
        !lastGroup ||
        !/^[0-9a-f]{4}$/u.test(lastGroup)
      ) {
        throw new Error("Expected a native IPv6 /64 client address.");
      }
      const lastValue = Number.parseInt(lastGroup, 16);
      const nextGroup = ((lastValue + 1) % 65_536)
        .toString(16)
        .padStart(4, "0");
      const secondDeviceIp = `${firstGroup}:${secondGroup}:${thirdGroup}:${nextGroup}::1`;
      expect(secondDeviceIp).not.toBe(primaryIp);
      const secondDevice = await playwright.request.newContext({
        baseURL: caseApp.origin,
        extraHTTPHeaders: {
          ...extraHTTPHeaders,
          "cf-connecting-ip": secondDeviceIp,
        },
      });
      try {
        const secondDeviceLogin = await expectResponseStatus(
          secondDevice.post("/api/auth/sign-in/username", {
            data: { password: other.password, username: other.username },
          }),
          200
        );
        const secondDeviceLoginBody = await secondDeviceLogin.json();
        expect(secondDeviceLoginBody.user.id).toBe(otherId);
      } finally {
        await secondDevice.dispose();
      }

      const { results: before } = await caseApp.db
        .prepare(
          "SELECT id,ip_address FROM session WHERE user_id = ? ORDER BY id"
        )
        .bind(otherId)
        .all<{ id: string; ip_address: string | null }>();
      expect(before).toHaveLength(2);
      expect(new Set(before.map((session) => session.ip_address)).size).toBe(2);
      const draftPhone = isPhone ? phone() : null;
      if (draftPhone) {
        await region.getByLabel("新電話", { exact: true }).fill(draftPhone);
        await startButton.click();
      }
      const path = isPhone
        ? "/api/v2/account/phone"
        : "/api/v2/account/sessions/revoke-others";
      const submitButton = isPhone
        ? region.getByRole("button", {
            exact: true,
            name: "確認並儲存電話",
          })
        : startButton;
      const pending = page.waitForResponse((response) =>
        response.url().endsWith(path)
      );
      await submitButton.click();
      const response = await pending;
      expect(response.status()).toBe(409);
      const responseBody = await response.json();
      expect(responseBody.error.code).toBe("actor_changed");
      await expect(region.getByRole("status")).toContainText("未確認");
      const metadata = await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key) ?? "null"),
        action === "phone"
          ? "efcc.identity-change.operation.v1"
          : "efcc.account-security.operation.v1"
      );
      expect(metadata).not.toBeNull();
      expect(response.request().headers()["x-efcc-expected-actor-id"]).toBe(
        metadata.actorUserId
      );
      expect(response.request().postDataJSON().operationKey).toBe(metadata.key);
      expect(metadata.actorUserId).toBe(account.userId);
      const { results: after } = await caseApp.db
        .prepare(
          "SELECT id,ip_address FROM session WHERE user_id = ? ORDER BY id"
        )
        .bind(otherId)
        .all<{ id: string; ip_address: string | null }>();
      expect(after).toEqual(before);
      const { results: identityOperations } = await caseApp.db
        .prepare(
          "SELECT id FROM account_change_operation WHERE actor_user_id = ? AND operation_key = ?"
        )
        .bind(account.userId, metadata.key)
        .all<{ id: string }>();
      expect(identityOperations).toHaveLength(0);
      const { results: securityOperations } = await caseApp.db
        .prepare(
          "SELECT id FROM account_security_operation WHERE operation_key = ?"
        )
        .bind(metadata.key)
        .all<{ id: string }>();
      expect(securityOperations).toHaveLength(0);
      const unchanged = await expectResponseStatus(
        context.request.get("/api/v2/account/identity"),
        200
      );
      const unchangedBody = await unchanged.json();
      expect(unchangedBody.data.identity.phone).toBeNull();
      await page.goto("/account");
      await page.goBack();
      await expect(
        page.getByText(account.fullName, { exact: true })
      ).toHaveCount(0);
      await expect(
        page.getByText(account.username, { exact: true })
      ).toHaveCount(0);
      await expect(region.getByRole("status")).toContainText("另一帳戶");
      if (draftPhone) {
        await expect(page.getByText(draftPhone, { exact: true })).toHaveCount(
          0
        );
        expect(
          await region
            .locator("input:visible")
            .evaluateAll((inputs) =>
              inputs.map((input) => (input as HTMLInputElement).value)
            )
        ).not.toContain(draftPhone);
      }
      await page.goForward();
      await expect(
        page.getByRole("region", { name: "個人資料" })
      ).toContainText(other.username);
      await expect(
        page.getByText(account.fullName, { exact: true })
      ).toHaveCount(0);
      await secondPage.goto("/account");
      await secondPage
        .getByRole("button", { exact: true, name: "登出" })
        .click();
      await expect(secondPage).toHaveURL(/\/sign-in$/u);
      await secondPage.getByLabel("Username").fill(account.username);
      await secondPage
        .getByLabel("密碼", { exact: true })
        .fill(account.password);
      await secondPage
        .getByRole("button", { exact: true, name: "登入" })
        .click();
      await expect(secondPage).toHaveURL(/\/$/u);
      await page.goBack();
      await page.reload();
      await expect(
        region.getByText("尚未找到完成紀錄", { exact: false })
      ).toBeVisible();
      const retryButtonName = isPhone ? "檢查電話" : "登出其他裝置";
      await expect(
        region.getByRole("button", {
          exact: true,
          name: retryButtonName,
        })
      ).toBeEnabled();
    }
  );
}

test(
  "own-phone task reviews the contact change and recovers a committed lost response",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@account-identity",
      "@risk-recovery",
      "@risk-privacy",
    ],
  },
  async ({ account, caseApp, signedInPage: page }) => {
    await page.goto("/account");
    await page.getByRole("link", { name: "更新聯絡電話" }).click();
    const region = page.getByRole("region", { name: "更改自己的電話" });
    await page.route("**/api/v2/account/phone", async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      await route.abort("failed");
    });
    await page.route("**/api/v2/account/changes/reconcile", (route) =>
      route.abort("failed")
    );
    const replacement = phone();
    const phoneField = region.getByLabel("新電話", { exact: true });
    await phoneField.fill(replacement);
    await region.getByRole("link", { name: "返回帳戶" }).click();
    const leaveDialog = page.getByRole("dialog", {
      name: "放棄未提交的更改？",
    });
    await expect(leaveDialog).toBeVisible();
    await leaveDialog.getByRole("button", { name: "繼續編輯" }).click();
    await expect(phoneField).toHaveValue(replacement);
    await region.getByRole("link", { name: "返回帳戶" }).click();
    await leaveDialog.getByRole("button", { name: "放棄變更" }).click();
    await page.getByRole("link", { name: "更新聯絡電話" }).click();
    await phoneField.fill(replacement);
    await region
      .getByRole("button", {
        exact: true,
        name: "檢查電話",
      })
      .click();
    const draftFields = region.locator('input:not([type="hidden"]), textarea');
    await qualifyPresentation(page, test.info(), "own-phone-review", {
      criticalAction: region.getByRole("button", {
        exact: true,
        name: "確認並儲存電話",
      }),
      drafts: draftFields,
    });
    await region
      .getByRole("button", { exact: true, name: "確認並儲存電話" })
      .click();
    await expect(region.getByRole("status")).toContainText("結果仍未確認");
    const metadata = await page.evaluate(() =>
      JSON.parse(
        localStorage.getItem("efcc.identity-change.operation.v1") ?? "null"
      )
    );
    expect(Object.keys(metadata).toSorted()).toEqual([
      "action",
      "actorUserId",
      "key",
      "targetUserId",
    ]);
    expect(metadata.actorUserId).toBe(account.userId);
    expect(metadata.targetUserId).toBe(account.userId);
    expect(JSON.stringify(metadata)).not.toContain(replacement);
    await page.unrouteAll();
    await page.reload();
    await expect(region.getByRole("status")).toContainText("伺服器已確認");
    await page.getByRole("button", { name: "完成，返回帳戶" }).click();
    await expect(page).toHaveURL(`${caseApp.origin}/account`);
    await expect(
      page.getByText(`+852${replacement}`, { exact: true })
    ).toBeVisible();
    const receipt = await caseApp.db
      .prepare(
        "SELECT id,action,actor_user_id,target_user_id FROM account_change_operation WHERE actor_user_id = ? AND operation_key = ?"
      )
      .bind(account.userId, metadata.key)
      .first<{
        action: string;
        actor_user_id: string;
        id: string;
        target_user_id: string;
      }>();
    expect(receipt).toMatchObject({
      action: "own_phone_changed",
      actor_user_id: account.userId,
      target_user_id: account.userId,
    });
    const { results: audits } = await caseApp.db
      .prepare(
        "SELECT id FROM audit_event WHERE target_user_id = ? AND action = 'own_phone_changed'"
      )
      .bind(account.userId)
      .all<{ id: string }>();
    expect(audits).toHaveLength(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true);
  }
);

test(
  "Staff identity review preserves empty and false edits through verification and password confirmation",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@account-identity",
      "@risk-auth",
      "@risk-recovery",
      "@risk-privacy",
    ],
  },
  async ({ account, caseApp, staffPage: page, staff }) => {
    const existingVerifiedPhone = `+852${phone()}`;
    await caseApp.db
      .prepare(
        "UPDATE session SET password_confirmed_at = CAST(strftime('%s','now') AS INTEGER) - 601 WHERE user_id = ?"
      )
      .bind(staff.userId)
      .run();
    await caseApp.db
      .prepare("UPDATE user SET email_verified = 1 WHERE id = ?")
      .bind(account.userId)
      .run();
    await caseApp.db
      .prepare(
        "UPDATE person_profile SET phone_shared = 1, verified_recovery_phone = ? WHERE user_id = ?"
      )
      .bind(existingVerifiedPhone, account.userId)
      .run();

    await page.goto(
      `/staff/accounts?view=people&person=${account.userId}&task=identity`
    );
    const region = page.getByRole("region", { name: "職員核實修正身分資料" });
    const correctedName = `陳實際修正${randomUUID().slice(0, 8)}`;
    const correctedUsername = `UI.${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    const correctedPhone = phone();
    await region.getByLabel("中文全名", { exact: true }).fill(correctedName);
    await region
      .getByLabel("使用者名稱", { exact: true })
      .fill(correctedUsername);
    await region.getByLabel("電郵（沒有電郵可留空）", { exact: true }).fill("");
    await region.getByLabel("修正電話", { exact: true }).fill(correctedPhone);
    await region.getByLabel("已核實共用電話例外").uncheck();
    await region.locator('input[type="radio"][value="verified_phone"]').check();
    await region
      .getByLabel("已按以上方式核實本人，新聯絡資料沒有用作復原憑證", {
        exact: true,
      })
      .check();
    let identityPosts = 0;
    let submittedOperationKey: string | null = null;
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().endsWith("/api/v2/staff/accounts/identity")
      ) {
        identityPosts += 1;
        submittedOperationKey = request.postDataJSON().operationKey;
      }
    });
    await region
      .getByRole("button", {
        exact: true,
        name: "檢查修正",
      })
      .click();

    await expect(region.getByText("清除電郵", { exact: true })).toBeVisible();
    await expect(region.getByText("否", { exact: true })).toBeVisible();
    await expect(
      region.getByText(correctedName, { exact: true })
    ).toBeVisible();
    await expect(
      region.getByText(correctedUsername, { exact: true })
    ).toBeVisible();
    await expect(
      region.getByText("透過原有已核實電話主動聯絡", { exact: true })
    ).toBeVisible();
    await expect(region.getByText("已核實", { exact: true })).toBeVisible();
    await expect(
      region.getByText(
        "請核對此帳戶資料；按「確認並提交修正」才會送交伺服器。",
        { exact: true }
      )
    ).toBeVisible();
    const draftFields = region.locator('input:not([type="hidden"]), textarea');
    await qualifyPresentation(page, test.info(), "identity-review", {
      criticalAction: region.getByRole("button", {
        exact: true,
        name: "確認目前密碼",
      }),
      drafts: draftFields,
      focus: region.getByRole("button", { name: "確認目前密碼" }),
    });
    await region.getByRole("button", { exact: true, name: "返回修改" }).click();
    const correctedNameField = region.getByLabel("中文全名", { exact: true });
    const correctedUsernameField = region.getByLabel("使用者名稱", {
      exact: true,
    });
    const correctedEmailField = region.getByLabel("電郵（沒有電郵可留空）", {
      exact: true,
    });
    const correctedPhoneField = region.getByLabel("修正電話", { exact: true });
    const sharedPhoneException = region.getByLabel("已核實共用電話例外");
    const verifiedPhoneMethod = region.locator(
      'input[type="radio"][value="verified_phone"]'
    );
    const identityVerification = region.getByLabel(
      "已按以上方式核實本人，新聯絡資料沒有用作復原憑證",
      { exact: true }
    );
    await expect(correctedNameField).toHaveValue(correctedName);
    await expect(correctedUsernameField).toHaveValue(correctedUsername);
    await expect(correctedEmailField).toHaveValue("");
    await expect(correctedPhoneField).toHaveValue(correctedPhone);
    await expect(sharedPhoneException).not.toBeChecked();
    await expect(verifiedPhoneMethod).toBeChecked();
    await expect(identityVerification).toBeChecked();

    await region.getByRole("link", { name: "返回帳戶詳情" }).click();
    const discardDialog = page.getByRole("dialog", {
      name: "放棄未提交的更改？",
    });
    await expect(discardDialog).toBeVisible();
    await discardDialog.getByRole("button", { name: "繼續編輯" }).click();
    await expect(discardDialog).toBeHidden();
    await expect(correctedNameField).toHaveValue(correctedName);
    await expect(correctedUsernameField).toHaveValue(correctedUsername);
    await expect(correctedEmailField).toHaveValue("");
    await expect(correctedPhoneField).toHaveValue(correctedPhone);
    await expect(sharedPhoneException).not.toBeChecked();
    await expect(verifiedPhoneMethod).toBeChecked();
    await expect(identityVerification).toBeChecked();
    await region.getByRole("button", { exact: true, name: "檢查修正" }).click();
    await expect(region.getByText("清除電郵", { exact: true })).toBeVisible();
    await expect(region.getByText("否", { exact: true })).toBeVisible();
    await expect(
      region.getByText(correctedName, { exact: true })
    ).toBeVisible();
    await expect(
      region.getByText(correctedUsername, { exact: true })
    ).toBeVisible();
    expect(identityPosts).toBe(0);
    const { results: confirmationsBefore } = await caseApp.db
      .prepare(
        "SELECT id FROM account_security_operation WHERE user_id = ? AND action = 'password_confirmed' ORDER BY id"
      )
      .bind(staff.userId)
      .all<{ id: string }>();
    const { results: sessionsBefore } = await caseApp.db
      .prepare(
        "SELECT id,password_confirmed_at FROM session WHERE user_id = ? ORDER BY id"
      )
      .bind(staff.userId)
      .all<{ id: string; password_confirmed_at: number | null }>();
    await region.getByRole("button", { name: "確認目前密碼" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const currentPassword = dialog.getByLabel("目前密碼", { exact: true });
    await currentPassword.fill("Wrong-password!");
    const wrongConfirmation = page.waitForResponse((response) =>
      response.url().endsWith("/api/v2/account/password-confirmation")
    );
    await dialog
      .getByRole("button", { exact: true, name: "確認並返回檢查" })
      .click();
    const wrongResponse = await wrongConfirmation;
    expect(wrongResponse.status()).toBe(400);
    expect(await wrongResponse.json()).toMatchObject({
      error: { code: "invalid_password" },
    });
    await expect(dialog.getByRole("alert")).toContainText(
      "目前密碼未獲接受，確認未完成"
    );
    await expect(dialog.getByRole("alert")).toContainText(
      "請檢查目前登入帳戶的密碼"
    );
    await qualifyPresentation(page, test.info(), "confirm-error", {
      criticalAction: dialog.getByRole("button", {
        exact: true,
        name: "確認並返回檢查",
      }),
      drafts: draftFields,
      focus: currentPassword,
    });
    expect(identityPosts).toBe(0);
    const { results: confirmationsAfterInvalidPassword } = await caseApp.db
      .prepare(
        "SELECT id FROM account_security_operation WHERE user_id = ? AND action = 'password_confirmed' ORDER BY id"
      )
      .bind(staff.userId)
      .all<{ id: string }>();
    const { results: sessionsAfterInvalidPassword } = await caseApp.db
      .prepare(
        "SELECT id,password_confirmed_at FROM session WHERE user_id = ? ORDER BY id"
      )
      .bind(staff.userId)
      .all<{ id: string; password_confirmed_at: number | null }>();
    expect(confirmationsAfterInvalidPassword).toEqual(confirmationsBefore);
    expect(sessionsAfterInvalidPassword).toEqual(sessionsBefore);
    const { results: auditsAfterInvalidPassword } = await caseApp.db
      .prepare(
        "SELECT id FROM audit_event WHERE target_user_id = ? AND action = 'staff_identity_corrected'"
      )
      .bind(account.userId)
      .all<{ id: string }>();
    expect(auditsAfterInvalidPassword).toHaveLength(0);
    const security = await expectResponseStatus(
      page.context().request.get("/api/v2/account/security"),
      200
    );
    const securityBody = await security.json();
    expect(securityBody.data.state.passwordConfirmationExpiresAt).toBeNull();
    await currentPassword.focus();
    await page.keyboard.press("Shift+Tab");
    await expect(
      dialog.getByRole("button", { name: "返回原工作" })
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(currentPassword).toBeFocused();
    await dialog.getByRole("button", { name: "返回原工作" }).click();
    await expect(dialog).toBeHidden();
    await expect(
      region.getByRole("button", { name: "確認目前密碼" })
    ).toBeFocused();

    await expect(region.getByText("清除電郵", { exact: true })).toBeVisible();
    await expect(region.getByText("否", { exact: true })).toBeVisible();
    await expect(
      region.getByText(correctedName, { exact: true })
    ).toBeVisible();
    await expect(
      region.getByText(correctedUsername, { exact: true })
    ).toBeVisible();
    await expect(
      region.getByText("透過原有已核實電話主動聯絡", { exact: true })
    ).toBeVisible();
    await expect(region.getByText("已核實", { exact: true })).toBeVisible();
    await region.getByRole("button", { name: "確認目前密碼" }).click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(
      region.getByRole("button", { name: "確認目前密碼" })
    ).toBeFocused();

    await region.getByRole("button", { name: "確認目前密碼" }).click();
    await expect(dialog).toBeVisible();
    await dialog
      .getByLabel("目前密碼", { exact: true })
      .fill(staff.account.password);
    await dialog
      .getByRole("button", { exact: true, name: "確認並返回檢查" })
      .click();
    await expect(dialog.getByRole("status")).toContainText("伺服器已確認");
    await dialog
      .getByRole("button", { exact: true, name: "確認並返回檢查" })
      .click();
    await expect(dialog).toBeHidden();
    const submitButton = region.getByRole("button", {
      exact: true,
      name: "確認並提交修正",
    });
    await qualifyPresentation(page, test.info(), "identity-confirmed-review", {
      criticalAction: submitButton,
      drafts: draftFields,
      focus: submitButton,
    });
    expect(identityPosts).toBe(0);
    const { results: auditsBeforeSubmit } = await caseApp.db
      .prepare(
        "SELECT id FROM audit_event WHERE target_user_id = ? AND action = 'staff_identity_corrected'"
      )
      .bind(account.userId)
      .all<{ id: string }>();
    expect(auditsBeforeSubmit).toHaveLength(0);
    await submitButton.click();
    await expect(region.getByRole("status")).toContainText("伺服器已確認");
    expect(identityPosts).toBe(1);
    if (!submittedOperationKey) {
      throw new Error("Staff identity submit did not carry an operation key.");
    }
    const changed = await caseApp.db
      .prepare(
        "SELECT u.email,u.email_verified,p.phone,p.phone_shared,p.verified_recovery_phone FROM user u INNER JOIN person_profile p ON p.user_id = u.id WHERE u.id = ?"
      )
      .bind(account.userId)
      .first<{
        email: string;
        email_verified: number;
        phone: string | null;
        phone_shared: number;
        verified_recovery_phone: string | null;
      }>();
    expect(changed).toMatchObject({
      email_verified: 0,
      phone: `+852${correctedPhone}`,
      phone_shared: 0,
      verified_recovery_phone: existingVerifiedPhone,
    });
    expect(changed?.email).toMatch(/@accounts\.efcc\.invalid$/u);
    const receipt = await caseApp.db
      .prepare(
        "SELECT id,action,actor_user_id,target_user_id FROM account_change_operation WHERE actor_user_id = ? AND operation_key = ?"
      )
      .bind(staff.userId, submittedOperationKey)
      .first<{
        action: string;
        actor_user_id: string;
        id: string;
        target_user_id: string;
      }>();
    expect(receipt).toMatchObject({
      action: "staff_identity_corrected",
      actor_user_id: staff.userId,
      target_user_id: account.userId,
    });
    const detailsNavigation = page.waitForURL(
      (url) =>
        url.pathname === "/staff/accounts" &&
        url.searchParams.get("view") === "people" &&
        url.searchParams.get("person") === account.userId
    );
    await region.getByRole("button", { name: "返回帳戶詳情" }).click();
    await detailsNavigation;
    await expect(page.getByRole("region", { name: "帳戶詳情" })).toBeVisible();
    const listNavigation = page.waitForURL(
      (url) =>
        url.pathname === "/staff/accounts" &&
        url.searchParams.get("view") === "people" &&
        !url.searchParams.has("person")
    );
    await page.getByRole("link", { name: "返回帳戶列表" }).click();
    await listNavigation;
    const auditNavigation = page.waitForURL(
      (url) => url.pathname === "/staff/account-audit"
    );
    await page
      .getByRole("navigation", { name: "管理工作" })
      .getByRole("link", { exact: true, name: "紀錄" })
      .click();
    await auditNavigation;
    const identityAudit = await caseApp.db
      .prepare(
        "SELECT id FROM audit_event WHERE target_user_id = ? AND action = 'staff_identity_corrected'"
      )
      .bind(account.userId)
      .first<{ id: string }>();
    await expect(
      page.locator(`a[href="/staff/account-audit?record=${identityAudit?.id}"]`)
    ).toBeVisible();
  }
);

test(
  "Staff identity refresh clears an unavailable method without losing its draft or unresolved reference",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@account-identity",
      "@risk-auth",
      "@risk-recovery",
      "@risk-privacy",
    ],
  },
  async ({ account, caseApp, staffPage: page, staff }) => {
    const orphanReference = {
      action: "staff_identity_corrected" as const,
      actorUserId: staff.userId,
      key: randomUUID(),
      targetUserId: account.userId,
    };
    const existingVerifiedPhone = `+852${phone()}`;
    await caseApp.db
      .prepare(
        "UPDATE session SET password_confirmed_at = CAST(strftime('%s','now') AS INTEGER) - 601 WHERE user_id = ?"
      )
      .bind(staff.userId)
      .run();
    await caseApp.db
      .prepare(
        "UPDATE person_profile SET phone_shared = 1, verified_recovery_phone = ? WHERE user_id = ?"
      )
      .bind(existingVerifiedPhone, account.userId)
      .run();

    await page.addInitScript((operation) => {
      localStorage.setItem(
        "efcc.identity-change.operation.v1",
        JSON.stringify(operation)
      );
    }, orphanReference);

    let identityPosts = 0;
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().endsWith("/api/v2/staff/accounts/identity")
      ) {
        identityPosts += 1;
      }
    });
    await page.goto(
      `/staff/accounts?view=people&person=${account.userId}&task=identity`
    );
    const region = page.getByRole("region", {
      name: "職員核實修正身分資料",
    });
    await expect(region.getByRole("status")).toContainText("尚未找到完成紀錄");

    const correctedName = `陳保留草稿${randomUUID().slice(0, 8)}`;
    const correctedUsername = `UI.${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    const correctedPhone = phone();
    const fullName = region.getByLabel("中文全名", { exact: true });
    const username = region.getByLabel("使用者名稱", { exact: true });
    const email = region.getByLabel("電郵（沒有電郵可留空）", {
      exact: true,
    });
    const phoneField = region.getByLabel("修正電話", { exact: true });
    const sharedPhone = region.getByLabel("已核實共用電話例外");
    const verificationMethod = region.getByRole("radiogroup", {
      exact: true,
      name: "身分核實方式",
    });
    const acknowledgement = region.getByLabel(
      "已按以上方式核實本人，新聯絡資料沒有用作復原憑證",
      { exact: true }
    );
    const draftFields = region.locator('input:not([type="hidden"]), textarea');

    await fullName.fill(correctedName);
    await username.fill(correctedUsername);
    await email.fill("");
    await phoneField.fill(correctedPhone);
    await sharedPhone.uncheck();
    await verificationMethod.locator('input[value="verified_phone"]').check();
    await acknowledgement.check();
    await qualifyPresentation(page, test.info(), "identity-edit-draft", {
      criticalAction: region.getByRole("button", {
        exact: true,
        name: "檢查修正",
      }),
      drafts: draftFields,
      focus: fullName,
    });
    await region.getByRole("button", { exact: true, name: "檢查修正" }).click();
    await expect(
      region.getByText("透過原有已核實電話主動聯絡", { exact: true })
    ).toBeVisible();

    await caseApp.db
      .prepare(
        "UPDATE person_profile SET verified_recovery_phone = NULL WHERE user_id = ?"
      )
      .bind(account.userId)
      .run();
    await region
      .getByRole("button", { exact: true, name: "確認目前密碼" })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog
      .getByLabel("目前密碼", { exact: true })
      .fill(staff.account.password);
    await dialog
      .getByRole("button", { exact: true, name: "確認並返回檢查" })
      .click();
    await expect(dialog.getByRole("status")).toContainText("伺服器已確認");
    await dialog
      .getByRole("button", { exact: true, name: "確認並返回檢查" })
      .click();

    await expect(
      verificationMethod.locator('input[value="verified_phone"]')
    ).toBeDisabled();
    await expect(verificationMethod.locator("input:checked")).toHaveCount(0);
    await expect(acknowledgement).not.toBeChecked();
    await expect(fullName).toHaveValue(correctedName);
    await expect(username).toHaveValue(correctedUsername);
    await expect(email).toHaveValue("");
    await expect(phoneField).toHaveValue(correctedPhone);
    await expect(sharedPhone).not.toBeChecked();
    const originalTarget = region.getByRole("region", { name: "操作對象" });
    await expect(originalTarget).toContainText(account.fullName);
    await expect(originalTarget).toContainText(account.username);
    expect(
      await page.evaluate(() =>
        JSON.parse(
          localStorage.getItem("efcc.identity-change.operation.v1") ?? "null"
        )
      )
    ).toEqual(orphanReference);
    expect(identityPosts).toBe(0);
    await qualifyPresentation(page, test.info(), "identity-refresh-draft", {
      criticalAction: region.getByRole("button", {
        exact: true,
        name: "檢查修正",
      }),
      drafts: draftFields,
      focus: fullName,
    });

    await region.getByRole("button", { exact: true, name: "檢查修正" }).click();
    await verificationMethod.locator('input[value="face_to_face"]').check();
    await acknowledgement.check();
    await region.getByRole("button", { exact: true, name: "檢查修正" }).click();

    await expect(
      region.getByRole("definition").filter({ hasText: "親身核實" })
    ).toBeVisible();
    await expect(
      region.getByText(correctedName, { exact: true })
    ).toBeVisible();
    await expect(
      region.getByText(correctedUsername, { exact: true })
    ).toBeVisible();
    await qualifyPresentation(page, test.info(), "identity-reverified-review", {
      criticalAction: region.getByRole("button", {
        exact: true,
        name: "確認並提交修正",
      }),
      drafts: draftFields,
    });
    await expect(
      region.getByRole("button", { exact: true, name: "確認並提交修正" })
    ).toBeDisabled();
    expect(identityPosts).toBe(0);
  }
);

test(
  "Staff identity review rejects a target that changed before explicit submit",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@account-identity",
      "@risk-auth",
      "@risk-privacy",
    ],
  },
  async ({ account, caseApp, staffPage: page, staff }) => {
    await page.goto(
      `/staff/accounts?view=people&person=${account.userId}&task=identity`
    );
    const region = page.getByRole("region", { name: "職員核實修正身分資料" });
    const correctedName = `陳過時修正${randomUUID().slice(0, 8)}`;
    const correctedUsername = `UI.${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    const currentEmail = `current.${randomUUID().slice(0, 8)}@example.com`;
    const reviewedEmail = `review.${randomUUID().slice(0, 8)}@example.com`;
    await region.getByLabel("中文全名", { exact: true }).fill(correctedName);
    await region
      .getByLabel("使用者名稱", { exact: true })
      .fill(correctedUsername);
    await region
      .getByLabel("電郵（沒有電郵可留空）", { exact: true })
      .fill(reviewedEmail);
    await region.getByLabel("修正電話", { exact: true }).fill(phone());
    await region
      .getByLabel("已按以上方式核實本人，新聯絡資料沒有用作復原憑證", {
        exact: true,
      })
      .check();
    await region.getByRole("button", { exact: true, name: "檢查修正" }).click();
    const submitButton = region.getByRole("button", {
      exact: true,
      name: "確認並提交修正",
    });
    await qualifyPresentation(page, test.info(), "identity-stale-review", {
      criticalAction: submitButton,
      drafts: region.locator('input:not([type="hidden"]), textarea'),
    });

    await caseApp.db
      .prepare("UPDATE user SET email = ?, email_verified = 1 WHERE id = ?")
      .bind(currentEmail, account.userId)
      .run();
    await submitButton.click();

    await expect(
      region.getByRole("heading", { name: "修正未提交" })
    ).toBeVisible();
    await expect(region.getByText(currentEmail, { exact: true })).toHaveCount(
      0
    );
    await expect(submitButton).toBeDisabled();
    await expect(
      region.getByText(reviewedEmail, { exact: true })
    ).toBeVisible();
    await expect(
      region.getByText(correctedName, { exact: true })
    ).toBeVisible();
    const user = await caseApp.db
      .prepare(
        "SELECT name,username,email,email_verified FROM user WHERE id = ?"
      )
      .bind(account.userId)
      .first<{
        email: string;
        email_verified: number;
        name: string;
        username: string;
      }>();
    expect(user).toMatchObject({
      email: currentEmail,
      email_verified: 1,
      name: account.fullName,
      username: account.username,
    });
    expect(user?.name).not.toBe(correctedName);
    expect(user?.username).not.toBe(correctedUsername.toLowerCase());
    const { results: audits } = await caseApp.db
      .prepare(
        "SELECT id FROM audit_event WHERE target_user_id = ? AND action IN ('staff_identity_corrected','staff_shared_phone_corrected')"
      )
      .bind(account.userId)
      .all<{ id: string }>();
    expect(audits).toHaveLength(0);
    const { results: operations } = await caseApp.db
      .prepare(
        "SELECT id FROM account_change_operation WHERE target_user_id = ? AND actor_user_id = ? AND action IN ('staff_identity_corrected','staff_shared_phone_corrected')"
      )
      .bind(account.userId, staff.userId)
      .all<{ id: string }>();
    expect(operations).toHaveLength(0);
    await region
      .getByRole("button", { exact: true, name: "重新載入最新資料" })
      .click();
    await page.getByRole("button", { exact: true, name: "繼續編輯" }).click();
    await expect(
      region.getByText(reviewedEmail, { exact: true })
    ).toBeVisible();
    await region
      .getByRole("button", { exact: true, name: "重新載入最新資料" })
      .click();
    await page.getByRole("button", { exact: true, name: "放棄變更" }).click();
    await expect(
      region.getByLabel("電郵（沒有電郵可留空）", { exact: true })
    ).toHaveValue(currentEmail);
    await expect(region.getByLabel("中文全名", { exact: true })).toHaveValue(
      account.fullName
    );
    await expect(
      region.getByRole("button", { exact: true, name: "檢查修正" })
    ).toBeEnabled();
  }
);

test(
  "Staff identity work is suppressed when the actor loses management access before submit",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@account-identity",
      "@risk-auth",
      "@risk-privacy",
    ],
  },
  async ({ account, caseApp, staffPage: page, staff }) => {
    await page.goto(
      `/staff/accounts?view=people&person=${account.userId}&task=identity`
    );
    const region = page.getByRole("region", { name: "職員核實修正身分資料" });
    await region
      .getByLabel("中文全名", { exact: true })
      .fill(`陳權限變更${randomUUID().slice(0, 8)}`);
    await region.getByLabel("修正電話", { exact: true }).fill(phone());
    await region
      .getByLabel("已按以上方式核實本人，新聯絡資料沒有用作復原憑證", {
        exact: true,
      })
      .check();
    await region.getByRole("button", { exact: true, name: "檢查修正" }).click();
    const submitButton = region.getByRole("button", {
      exact: true,
      name: "確認並提交修正",
    });
    await qualifyPresentation(page, test.info(), "identity-access-review", {
      criticalAction: submitButton,
      drafts: region.locator('input:not([type="hidden"]), textarea'),
    });

    await caseApp.db
      .prepare(
        "UPDATE person_profile SET account_role = 'member' WHERE user_id = ?"
      )
      .bind(staff.userId)
      .run();
    let identityCommands = 0;
    page.on("request", (requestEvent) => {
      if (
        requestEvent.method() === "POST" &&
        requestEvent.url().endsWith("/api/v2/staff/accounts/identity")
      ) {
        identityCommands += 1;
      }
    });
    await submitButton.click();

    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByText(account.userId, { exact: false })).toHaveCount(
      0
    );
    expect(identityCommands).toBe(0);
    const { results: audits } = await caseApp.db
      .prepare(
        "SELECT id FROM audit_event WHERE target_user_id = ? AND action IN ('staff_identity_corrected','staff_shared_phone_corrected')"
      )
      .bind(account.userId)
      .all<{ id: string }>();
    expect(audits).toHaveLength(0);
    const { results: operations } = await caseApp.db
      .prepare(
        "SELECT id FROM account_change_operation WHERE target_user_id = ? AND actor_user_id = ? AND action IN ('staff_identity_corrected','staff_shared_phone_corrected')"
      )
      .bind(account.userId, staff.userId)
      .all<{ id: string }>();
    expect(operations).toHaveLength(0);
  }
);

test(
  "an incomplete profile does not block existing own-password controls",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@account-identity",
      "@risk-auth",
    ],
  },
  async ({ account, caseApp, signedInPage: page, signedInRequest }) => {
    await caseApp.db
      .prepare("DELETE FROM person_profile WHERE user_id = ?")
      .bind(account.userId)
      .run();
    await page.goto("/account");
    await page.getByRole("link", { name: /^帳戶安全/u }).click();
    await page.getByRole("link", { name: /更改密碼/u }).click();
    await expect(page.getByLabel("目前密碼", { exact: true })).toBeVisible();
    await expectResponseStatus(
      signedInRequest.post("/api/v2/account/password", {
        data: {
          currentPassword: account.password,
          newPassword: "Synthetic-incomplete-profile-change!",
          operationKey: randomUUID(),
        },
      }),
      201
    );
  }
);

test(
  "leaving Identity cancels the original actor-bound read without replacing its operation",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@account-identity",
      "@risk-auth",
      "@risk-recovery",
    ],
  },
  async ({ account, signedInPage: page }) => {
    const operation = {
      action: "own_phone_changed",
      actorUserId: account.userId,
      key: randomUUID(),
      targetUserId: account.userId,
    };
    const arrived = Promise.withResolvers<null>();
    const release = Promise.withResolvers<null>();
    await page.goto("/account");
    await page.evaluate((saved) => {
      localStorage.setItem(
        "efcc.identity-change.operation.v1",
        JSON.stringify(saved)
      );
      document.documentElement.dataset.identityLifetime = "same-document";
    }, operation);
    await page.route("**/api/v2/account/changes/reconcile", async (route) => {
      try {
        expect(route.request().headers()["x-efcc-expected-actor-id"]).toBe(
          account.userId
        );
        expect(route.request().postDataJSON()).toEqual({
          operationKey: operation.key,
        });
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        expect(await response.json()).toEqual({ data: { receipt: null } });
        arrived.resolve(null);
        await release.promise;
        await route.fulfill({ response });
      } catch (error) {
        arrived.reject(error);
        if (!route.request().failure()) {
          throw error;
        }
      }
    });
    try {
      const requested = page.waitForRequest(
        "**/api/v2/account/changes/reconcile"
      );
      await page.getByRole("link", { name: "更新聯絡電話" }).click();
      const request = await requested;
      await arrived.promise;
      const region = page.getByRole("region", { name: "更改自己的電話" });
      await expect(region.getByRole("status")).toContainText(
        "正在向伺服器查核結果"
      );
      const cancelled = page.waitForEvent("requestfailed", {
        predicate: (candidate) => candidate === request,
        timeout: 15_000,
      });
      await region.getByRole("link", { exact: true, name: "返回帳戶" }).click();
      await expect(page).toHaveURL(/\/account$/u);
      const failed = await cancelled;
      expect(failed.failure()?.errorText).toMatch(/ABORTED|cancelled/u);
      expect(
        await page.locator("html").getAttribute("data-identity-lifetime")
      ).toBe("same-document");
      expect(
        await page.evaluate(() =>
          JSON.parse(
            localStorage.getItem("efcc.identity-change.operation.v1") ?? "null"
          )
        )
      ).toEqual(operation);
    } finally {
      release.resolve(null);
      await page.unrouteAll({ behavior: "wait" });
    }
  }
);
