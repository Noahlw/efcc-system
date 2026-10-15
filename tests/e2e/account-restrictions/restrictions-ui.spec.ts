import type { Locator } from "@playwright/test";

import type { RestrictionAction } from "@/features/account/restrictions/restriction-contract";

import { dedicatedTest, expect, test } from "../../support/fixtures";
import { qualifyPresentation } from "../presentation-assertions";
import { expectResponseStatus, restrictionCommand } from "./test-helpers";

const beginRestrictionReview = async (region: Locator, action: string) => {
  await region.getByRole("button", { exact: true, name: action }).click();
  await expect(
    region.getByRole("region", { exact: true, name: `核對${action}` })
  ).toBeVisible();
  return region.getByRole("button", {
    exact: true,
    name: `確認並${action}`,
  });
};

dedicatedTest(
  "@native @browser @mobile-critical @risk-recovery definitive Staff conflict recovers after reload and permits a new restriction",
  async ({ caseApp, staff, account, staffPage: page }) => {
    await page.goto(
      `${caseApp.origin}/staff/accounts?view=people&person=${account.userId}&task=restrictions`
    );
    const region = page.getByRole("region", { name: "會籍與安全限制" });
    await expect(
      region.getByRole("button", { exact: true, name: "停用會籍" })
    ).toBeEnabled();
    const confirmDeactivation = await beginRestrictionReview(
      region,
      "停用會籍"
    );
    const competing = restrictionCommand(
      account.userId,
      "membership_deactivated"
    );
    await expectResponseStatus(
      staff.context.post("/api/v2/staff/accounts/restrictions", {
        data: competing,
      }),
      201
    );
    expect(
      await caseApp.db
        .prepare(
          "SELECT actor_user_id, action, operation_key, target_user_id FROM account_change_operation WHERE actor_user_id = ? AND operation_key = ?"
        )
        .bind(staff.userId, competing.operationKey)
        .first()
    ).toEqual({
      action: competing.action,
      actor_user_id: staff.userId,
      operation_key: competing.operationKey,
      target_user_id: account.userId,
    });
    const requestPromise = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        request.url().endsWith("/api/v2/staff/accounts/restrictions")
    );
    const responsePromise = page.waitForResponse((response) =>
      response.url().endsWith("/api/v2/staff/accounts/restrictions")
    );
    await confirmDeactivation.click();
    const [request, response] = await Promise.all([
      requestPromise,
      responsePromise,
    ]);
    expect(response.status()).toBe(409);
    expect(request.postDataJSON()).toMatchObject({
      action: "membership_deactivated",
      targetUserId: account.userId,
    });
    expect(request.postDataJSON().operationKey).not.toBe(
      competing.operationKey
    );
    expect(request.headers()["x-efcc-expected-actor-id"]).toBe(staff.userId);
    await expect(region.getByRole("status")).toContainText("未完成");
    const metadata = await page.evaluate(() =>
      JSON.parse(
        localStorage.getItem("efcc.restriction.operation.v1") ?? "null"
      )
    );
    expect(metadata).toMatchObject({
      action: "membership_deactivated",
      actorUserId: staff.userId,
      key: request.postDataJSON().operationKey,
      rejected: true,
      targetUserId: account.userId,
    });
    expect(
      await caseApp.db
        .prepare(
          "SELECT operation_key FROM account_change_operation WHERE actor_user_id = ? AND operation_key = ?"
        )
        .bind(staff.userId, request.postDataJSON().operationKey)
        .first()
    ).toBeNull();
    await page.reload();
    await expect(region.getByRole("status")).toContainText("未完成");
    await region
      .getByRole("button", {
        exact: true,
        name: "操作未完成，開始另一項操作",
      })
      .click();
    const confirmReactivation = await beginRestrictionReview(
      region,
      "重新啟用會籍"
    );
    const reactivationRequestPromise = page.waitForRequest(
      (next) =>
        next.method() === "POST" &&
        next.url().endsWith("/api/v2/staff/accounts/restrictions")
    );
    const reactivationResponsePromise = page.waitForResponse((next) =>
      next.url().endsWith("/api/v2/staff/accounts/restrictions")
    );
    await confirmReactivation.click();
    const [reactivationRequest, reactivationResponse] = await Promise.all([
      reactivationRequestPromise,
      reactivationResponsePromise,
    ]);
    expect(reactivationResponse.status()).toBe(201);
    expect(reactivationRequest.postDataJSON()).toMatchObject({
      action: "membership_reactivated",
      targetUserId: account.userId,
    });
    expect(reactivationRequest.headers()["x-efcc-expected-actor-id"]).toBe(
      staff.userId
    );
    await expect(region.getByRole("status")).toContainText("伺服器已確認");
    expect(
      await caseApp.db
        .prepare(
          "SELECT membership_status FROM person_profile WHERE user_id = ?"
        )
        .bind(account.userId)
        .first()
    ).toEqual({ membership_status: "active" });
    const events = await caseApp.db
      .prepare(
        "SELECT action FROM audit_event WHERE target_user_id = ? AND action IN (?, ?) ORDER BY action"
      )
      .bind(account.userId, "membership_deactivated", "membership_reactivated")
      .all<{ action: string }>();
    expect(events.results).toEqual([
      { action: "membership_deactivated" },
      { action: "membership_reactivated" },
    ]);
  }
);

dedicatedTest(
  "@native @browser @mobile-critical @risk-recovery @risk-actor-target-key UNKNOWN restriction retries its original actor-target key until an authoritative conflict",
  async ({ caseApp, staff, account, staffPage: page }) => {
    await page.goto(
      `${caseApp.origin}/staff/accounts?view=people&person=${account.userId}&task=restrictions`
    );
    const region = page.getByRole("region", { name: "會籍與安全限制" });
    await expect(
      region.getByRole("button", { exact: true, name: "停用會籍" })
    ).toBeEnabled();
    await page.route("**/api/v2/staff/accounts/restrictions", (route) =>
      route.abort("failed")
    );
    const initialDeactivation = await beginRestrictionReview(
      region,
      "停用會籍"
    );
    await initialDeactivation.click();
    await expect(region.getByRole("status")).toContainText("尚未找到完成紀錄");
    const metadata = await page.evaluate(() =>
      JSON.parse(
        localStorage.getItem("efcc.restriction.operation.v1") ?? "null"
      )
    );
    expect(metadata).toMatchObject({
      action: "membership_deactivated",
      actorUserId: staff.userId,
      targetUserId: account.userId,
    });
    expect(metadata.rejected).toBeUndefined();
    await expect(
      region.getByRole("button", {
        exact: true,
        name: "操作未完成，開始另一項操作",
      })
    ).toHaveCount(0);
    const competing = restrictionCommand(
      account.userId,
      "membership_deactivated"
    );
    expect(competing.operationKey).not.toBe(metadata.key);
    await expectResponseStatus(
      staff.context.post("/api/v2/staff/accounts/restrictions", {
        data: competing,
      }),
      201
    );
    expect(
      await caseApp.db
        .prepare(
          "SELECT operation_key FROM account_change_operation WHERE actor_user_id = ? AND operation_key = ?"
        )
        .bind(staff.userId, competing.operationKey)
        .first()
    ).toEqual({ operation_key: competing.operationKey });
    await page.unrouteAll();
    await page.reload();
    await expect(region.getByRole("status")).toContainText("尚未找到完成紀錄");
    expect(
      await page.evaluate(() =>
        JSON.parse(
          localStorage.getItem("efcc.restriction.operation.v1") ?? "null"
        )
      )
    ).toEqual(metadata);
    await expect(
      region.getByRole("button", { exact: true, name: "停用會籍" })
    ).toBeEnabled();
    const retryDeactivation = await beginRestrictionReview(region, "停用會籍");
    const retryRequestPromise = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        request.url().endsWith("/api/v2/staff/accounts/restrictions")
    );
    const retryResponsePromise = page.waitForResponse((response) =>
      response.url().endsWith("/api/v2/staff/accounts/restrictions")
    );
    await retryDeactivation.click();
    const [retryRequest, retryResponse] = await Promise.all([
      retryRequestPromise,
      retryResponsePromise,
    ]);
    expect(retryResponse.status()).toBe(409);
    expect(retryRequest.postDataJSON()).toEqual({
      action: metadata.action,
      operationKey: metadata.key,
      targetUserId: metadata.targetUserId,
    });
    expect(retryRequest.headers()["x-efcc-expected-actor-id"]).toBe(
      staff.userId
    );
    await expect(region.getByRole("status")).toContainText("操作未完成");
    expect(
      await page.evaluate(() =>
        JSON.parse(
          localStorage.getItem("efcc.restriction.operation.v1") ?? "null"
        )
      )
    ).toEqual({ ...metadata, rejected: true });
    expect(
      await caseApp.db
        .prepare(
          "SELECT operation_key FROM account_change_operation WHERE actor_user_id = ? AND operation_key = ?"
        )
        .bind(staff.userId, metadata.key)
        .first()
    ).toBeNull();
    expect(
      await caseApp.db
        .prepare(
          "SELECT membership_status FROM person_profile WHERE user_id = ?"
        )
        .bind(account.userId)
        .first()
    ).toEqual({ membership_status: "deactivated" });
    const events = await caseApp.db
      .prepare(
        "SELECT action FROM audit_event WHERE target_user_id = ? AND action = 'membership_deactivated'"
      )
      .bind(account.userId)
      .all<{ action: string }>();
    expect(events.results).toHaveLength(1);
    await region
      .getByRole("button", {
        exact: true,
        name: "操作未完成，開始另一項操作",
      })
      .click();
    await expect(
      region.getByRole("button", { exact: true, name: "重新啟用會籍" })
    ).toBeEnabled();
  }
);

test("@native @browser @mobile-critical @risk-recovery @risk-privacy management and current-status pages recover a committed ban after reload", async ({
  caseApp,
  staff,
  account,
  signedInPage,
  staffPage: page,
}) => {
  await page.goto(
    `${caseApp.origin}/staff/accounts?view=people&person=${account.userId}&task=restrictions`
  );
  const region = page.getByRole("region", { name: "會籍與安全限制" });
  await page.route("**/api/v2/staff/accounts/restrictions", async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    await route.abort("failed");
  });
  await page.route("**/api/v2/account/changes/reconcile", (route) =>
    route.abort("failed")
  );
  const confirmBan = await beginRestrictionReview(region, "封鎖帳戶");
  await confirmBan.click();
  await expect(region.getByRole("status")).toContainText("結果仍未確認");
  await expect(
    region.getByRole("link", { exact: true, name: "更換對象" })
  ).toHaveCount(0);
  await expect(
    region.locator('[aria-disabled="true"]').filter({ hasText: "更換對象" })
  ).toBeVisible();
  const metadata = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("efcc.restriction.operation.v1") ?? "null")
  );
  expect(Object.keys(metadata).toSorted()).toEqual([
    "action",
    "actorUserId",
    "key",
    "targetUserId",
  ]);
  expect(metadata).toMatchObject({
    action: "account_banned",
    actorUserId: staff.userId,
    targetUserId: account.userId,
  });
  await page.unrouteAll();
  await page.reload();
  await expect(region.getByRole("status")).toContainText("伺服器已確認");
  expect(
    await caseApp.db
      .prepare(
        "SELECT actor_user_id, action, operation_key, target_user_id FROM account_change_operation WHERE actor_user_id = ? AND operation_key = ?"
      )
      .bind(staff.userId, metadata.key)
      .first()
  ).toEqual({
    action: "account_banned",
    actor_user_id: staff.userId,
    operation_key: metadata.key,
    target_user_id: account.userId,
  });
  expect(
    await caseApp.db
      .prepare(
        "SELECT id FROM audit_event WHERE target_user_id = ? AND action = 'account_banned'"
      )
      .bind(account.userId)
      .all<{ id: string }>()
  ).toMatchObject({ results: [{ id: expect.any(String) }] });
  await signedInPage.goto("/status");
  await expect(
    signedInPage.getByRole("heading", {
      exact: true,
      name: "帳戶已暫停使用",
    })
  ).toBeVisible();
  expect(
    await signedInPage.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth
    )
  ).toBe(true);
});

test("@native @browser @mobile-critical @risk-authority restriction impact review keeps its draft through cancel and password modal before immutable Submit", async ({
  caseApp,
  staff,
  account,
  staffPage: page,
}, testInfo) => {
  await caseApp.db
    .prepare("UPDATE session SET password_confirmed_at = 0 WHERE user_id = ?")
    .bind(staff.userId)
    .run();

  await page.goto(
    `${caseApp.origin}/staff/accounts?view=people&person=${account.userId}&task=restrictions`
  );
  const region = page.getByRole("region", { name: "會籍與安全限制" });
  let restrictionRequests = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().endsWith("/api/v2/staff/accounts/restrictions")
    ) {
      restrictionRequests += 1;
    }
  });
  await beginRestrictionReview(region, "封鎖帳戶");
  const firstReview = region.getByRole("region", {
    exact: true,
    name: "核對封鎖帳戶",
  });
  await expect(firstReview).toContainText(account.fullName);
  await expect(firstReview).toContainText("已批准");
  await expect(firstReview).toContainText("未封鎖");
  await expect(firstReview).toContainText("已封鎖");
  await expect(firstReview).toContainText(
    "此人不能使用教會功能；會籍狀態不變。"
  );
  await region.getByRole("button", { exact: true, name: "返回修改" }).click();
  await expect(firstReview).toHaveCount(0);
  expect(restrictionRequests).toBe(0);
  expect(
    await page.evaluate(() =>
      localStorage.getItem("efcc.restriction.operation.v1")
    )
  ).toBeNull();
  const submit = await beginRestrictionReview(region, "封鎖帳戶");
  const review = region.getByRole("region", {
    exact: true,
    name: "核對封鎖帳戶",
  });
  const confirmationPrompt =
    "提交前需要確認目前密碼。完成後會返回這裏，再由你確認提交。";
  const reviewSnapshot = async () => ({
    action: (await submit.textContent()) ?? "",
    impact:
      (await review
        .getByText("此人不能使用教會功能；會籍狀態不變。", {
          exact: true,
        })
        .textContent()) ?? "",
    result:
      (await review.locator("p").filter({ hasText: "操作後" }).textContent()) ??
      "",
    rows: (await review.locator("dl").first().textContent()) ?? "",
  });
  const reviewBeforeModal = await reviewSnapshot();
  await expect(review).toContainText(confirmationPrompt);
  await region.getByRole("link", { exact: true, name: "更換對象" }).click();
  const targetDialog = page.getByRole("dialog");
  await expect(
    targetDialog.getByRole("heading", {
      exact: true,
      name: "放棄未提交的更改？",
    })
  ).toBeVisible();
  await targetDialog
    .getByRole("button", { exact: true, name: "繼續編輯" })
    .click();
  await expect(review).toBeVisible();
  expect(await reviewSnapshot()).toEqual(reviewBeforeModal);
  await page.getByRole("link", { name: /返回帳戶詳情/u }).click();
  const leaveDialog = page.getByRole("dialog");
  await expect(leaveDialog).toBeVisible();
  await leaveDialog.getByRole("button", { name: "繼續編輯" }).click();
  await expect(review).toBeVisible();
  expect(await reviewSnapshot()).toEqual(reviewBeforeModal);
  expect(restrictionRequests).toBe(0);
  expect(
    await page.evaluate(() =>
      localStorage.getItem("efcc.restriction.operation.v1")
    )
  ).toBeNull();
  await qualifyPresentation(page, testInfo, "desktop", {
    criticalAction: submit,
    drafts: review.locator(
      'input:not([type="hidden"]):not([type="search"]), textarea'
    ),
    focus: submit,
  });
  expect(await reviewSnapshot()).toEqual(reviewBeforeModal);
  await submit.click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { exact: true, name: "確認目前密碼" })
  ).toBeVisible();
  const password = dialog.getByLabel("目前密碼", { exact: true });
  await password.fill(staff.account.password);
  const confirmPassword = dialog.getByRole("button", {
    exact: true,
    name: "確認並返回檢查",
  });
  await qualifyPresentation(page, testInfo, "desktop", {
    criticalAction: confirmPassword,
    drafts: password,
    focus: password,
    masks: [password],
  });
  await confirmPassword.click();
  await expect(dialog.getByRole("status")).toContainText("伺服器已確認");
  await confirmPassword.click();
  await expect(dialog).not.toBeVisible();
  await expect(review).toBeVisible();
  await expect(review).not.toContainText(confirmationPrompt);
  expect(await reviewSnapshot()).toEqual(reviewBeforeModal);
  expect(restrictionRequests).toBe(0);
  expect(
    await page.evaluate(() =>
      localStorage.getItem("efcc.account-security.operation.v1")
    )
  ).toBeNull();
  const requestPromise = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      request.url().endsWith("/api/v2/staff/accounts/restrictions")
  );
  const responsePromise = page.waitForResponse((response) =>
    response.url().endsWith("/api/v2/staff/accounts/restrictions")
  );
  await submit.click();
  const [request, response] = await Promise.all([
    requestPromise,
    responsePromise,
  ]);
  expect(response.status()).toBe(201);
  expect(request.postDataJSON()).toEqual({
    action: "account_banned",
    operationKey: expect.stringMatching(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
    ),
    targetUserId: account.userId,
  });
  expect(request.headers()["x-efcc-expected-actor-id"]).toBe(staff.userId);
  expect(restrictionRequests).toBe(1);
  await expect(region.getByRole("status")).toContainText("伺服器已確認");
  const payload = request.postDataJSON() as {
    action: RestrictionAction;
    operationKey: string;
    targetUserId: string;
  };
  expect(
    await caseApp.db
      .prepare(
        "SELECT actor_user_id, action, operation_key, target_user_id FROM account_change_operation WHERE actor_user_id = ? AND operation_key = ?"
      )
      .bind(staff.userId, payload.operationKey)
      .first()
  ).toEqual({
    action: payload.action,
    actor_user_id: staff.userId,
    operation_key: payload.operationKey,
    target_user_id: account.userId,
  });
  expect(
    await caseApp.db
      .prepare(
        "SELECT membership_status, banned_at FROM person_profile WHERE user_id = ?"
      )
      .bind(account.userId)
      .first()
  ).toMatchObject({
    banned_at: expect.any(Number),
    membership_status: "active",
  });
  expect(
    await caseApp.db
      .prepare(
        "SELECT id FROM audit_event WHERE target_user_id = ? AND action = 'account_banned'"
      )
      .bind(account.userId)
      .all<{ id: string }>()
  ).toMatchObject({ results: [{ id: expect.any(String) }] });
});
