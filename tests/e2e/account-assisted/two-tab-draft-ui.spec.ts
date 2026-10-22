import { randomUUID } from "node:crypto";

import { storedStaffAccountOperationSchema } from "../../../src/features/account/assisted-accounts/staff-account-contract";
import { expect } from "../../support/fixtures";
import {
  creation,
  creationEffects,
  dedicatedTest,
  issuedCredential,
  staffData,
} from "./fixtures";

const operationStorageKey = "efcc.staff-account.operation.v1";
const createPath = "/api/v2/staff/accounts";
const reconcilePath = "/api/v2/staff/accounts/reconcile";

dedicatedTest(
  "a second Staff tab reconciles the saved creation and retains its unsent draft",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@account-assisted",
      "@risk-non-replay",
      "@risk-draft",
      "@risk-privacy",
      "@risk-recovery",
      "@risk-security",
    ],
  },
  async ({ caseApp, staffPage: pageA, staff }, testInfo) => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
    const inputA = creation();
    const inputB = {
      ...creation(),
      email: null,
      fullName: `陳未提交草稿${suffix}`,
      sharedPhone: false,
      username: `draft.w12.${suffix}`,
    };
    const expectedDraftB = {
      email: "",
      fullName: inputB.fullName,
      phone: inputB.phone,
      sharedPhone: false,
      username: inputB.username,
      verified: true,
    };

    let creationPostsA = 0;
    let creationPostsB = 0;
    pageA.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname === createPath
      ) {
        creationPostsA += 1;
      }
    });

    const pageB = await pageA.context().newPage();
    expect(pageB.context()).toBe(pageA.context());
    pageB.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname === createPath
      ) {
        creationPostsB += 1;
      }
    });

    const readDraft = (page: typeof pageA) =>
      page.evaluate(() => ({
        fields: {
          email:
            document.querySelector<HTMLInputElement>("#assisted-email")
              ?.value ?? null,
          fullName:
            document.querySelector<HTMLInputElement>("#assisted-name")?.value ??
            null,
          phone:
            document.querySelector<HTMLInputElement>("#assisted-phone")
              ?.value ?? null,
          sharedPhone:
            document.querySelector<HTMLInputElement>("#assisted-shared-phone")
              ?.checked ?? null,
          username:
            document.querySelector<HTMLInputElement>("#assisted-username")
              ?.value ?? null,
          verified:
            document.querySelector<HTMLInputElement>("#assisted-verified")
              ?.checked ?? null,
        },
        formVisible: Boolean(
          document
            .querySelector<HTMLInputElement>("#assisted-name")
            ?.getClientRects().length
        ),
        href: location.href,
      }));

    await Promise.all([
      pageA.goto("/staff/accounts?task=create"),
      pageB.goto("/staff/accounts?task=create"),
    ]);
    await pageB.bringToFront();
    await expect(
      pageB.getByRole("button", { exact: true, name: "檢查帳戶資料" })
    ).toBeEnabled();
    await pageB.getByLabel("中文全名", { exact: true }).fill(inputB.fullName);
    await pageB.getByLabel("使用者名稱", { exact: true }).fill(inputB.username);
    await pageB.getByLabel("電郵（沒有電郵可留空）", { exact: true }).fill("");
    await pageB.getByLabel("電話", { exact: true }).fill(inputB.phone);
    await pageB.getByLabel("已親身核實共用電話例外", { exact: true }).uncheck();
    await pageB.getByLabel("已親身核實此人的身分", { exact: true }).check();
    const draftBeforeACommit = await readDraft(pageB);
    expect(draftBeforeACommit.formVisible).toBe(true);
    expect(draftBeforeACommit.fields).toEqual(expectedDraftB);
    const taskHrefB = pageB.url();
    let documentLoadsAfterDraft = 0;
    pageB.on("load", () => {
      documentLoadsAfterDraft += 1;
    });

    await pageA.bringToFront();
    await expect(
      pageA.getByRole("button", { exact: true, name: "檢查帳戶資料" })
    ).toBeEnabled();
    await pageA.getByLabel("中文全名", { exact: true }).fill(inputA.fullName);
    await pageA.getByLabel("使用者名稱", { exact: true }).fill(inputA.username);
    await pageA.getByLabel("電話", { exact: true }).fill(inputA.phone);
    await pageA.getByLabel("已親身核實此人的身分", { exact: true }).check();
    await pageA
      .getByRole("button", { exact: true, name: "檢查帳戶資料" })
      .click();
    await expect(
      pageA.getByRole("heading", { level: 1, name: "檢查新帳戶" })
    ).toBeVisible();
    expect(creationPostsA).toBe(0);
    expect(creationPostsB).toBe(0);

    const creationResponsePromise = pageA.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === createPath
    );
    await pageA
      .getByRole("button", {
        exact: true,
        name: "確認並建立帳戶及發出臨時密碼",
      })
      .click();
    const creationResponse = await creationResponsePromise;
    expect(creationResponse.status()).toBe(201);
    const issuance = issuedCredential(await staffData(creationResponse));
    const submittedBodyA = creationResponse.request().postDataJSON() as Record<
      string,
      unknown
    >;
    const submittedOperationKey = submittedBodyA.operationKey;
    const targetAId = issuance.receipt?.targetUserId;
    if (
      !targetAId ||
      typeof submittedOperationKey !== "string" ||
      !submittedOperationKey
    ) {
      throw new Error(
        "The real Staff creation did not return its receipt/key."
      );
    }
    expect(creationPostsA).toBe(1);
    expect(creationPostsB).toBe(0);
    expect(submittedOperationKey).not.toBe(inputA.operationKey);
    expect(submittedBodyA).toEqual({
      email: inputA.email,
      fullName: inputA.fullName,
      identityCheck: "face_to_face",
      operationKey: submittedOperationKey,
      phone: inputA.phone,
      sharedPhone: inputA.sharedPhone,
      username: inputA.username,
    });
    await expect(pageA.getByLabel("新臨時密碼", { exact: true })).toHaveText(
      issuance.temporaryPassword
    );

    const rawOperationA = await pageA.evaluate(
      (key) => localStorage.getItem(key),
      operationStorageKey
    );
    if (!rawOperationA) {
      throw new Error("Tab A did not retain its operation metadata.");
    }
    const operationA = storedStaffAccountOperationSchema.parse(
      JSON.parse(rawOperationA)
    );
    expect(operationA).toEqual({
      action: "assisted_account_created",
      actorUserId: staff.userId,
      key: submittedOperationKey,
      targetUserId: null,
    });
    expect(rawOperationA.includes(issuance.temporaryPassword)).toBe(false);

    const effectsA = await creationEffects(
      caseApp,
      inputA.username,
      issuance.temporaryPassword
    );
    expect(effectsA).toEqual({
      audits: 1,
      credentials: 1,
      plaintext: 0,
      profiles: 1,
      receipts: 1,
      reservations: 1,
      users: 1,
    });
    const targetA = await caseApp.db
      .prepare(
        "SELECT p.account_role,p.membership_status FROM person_profile p WHERE p.user_id = ?"
      )
      .bind(targetAId)
      .first<{ account_role: string; membership_status: string }>();
    expect(targetA).toEqual({
      account_role: "member",
      membership_status: "active",
    });
    const receiptA = await caseApp.db
      .prepare(
        "SELECT action,actor_user_id,identity_check,operation_key,target_credential_revision,target_user_id FROM staff_account_operation WHERE actor_user_id = ? AND operation_key = ?"
      )
      .bind(staff.userId, submittedOperationKey)
      .first();
    expect(receiptA).toEqual({
      action: "assisted_account_created",
      actor_user_id: staff.userId,
      identity_check: "face_to_face",
      operation_key: submittedOperationKey,
      target_credential_revision: 0,
      target_user_id: targetAId,
    });
    const auditA = await caseApp.db
      .prepare(
        "SELECT COUNT(*) AS count FROM audit_event WHERE actor_user_id = ? AND target_user_id = ? AND action = 'assisted_account_created'"
      )
      .bind(staff.userId, targetAId)
      .first<{ count: number }>();
    expect(auditA).toEqual({ count: 1 });

    await pageB.bringToFront();
    const draftBeforeBSubmit = await readDraft(pageB);
    expect(draftBeforeBSubmit.formVisible).toBe(true);
    expect(draftBeforeBSubmit.fields).toEqual(expectedDraftB);
    const rawOperationB = await pageB.evaluate(
      (key) => localStorage.getItem(key),
      operationStorageKey
    );
    expect(rawOperationB).toBe(rawOperationA);
    const operationB = storedStaffAccountOperationSchema.parse(
      JSON.parse(rawOperationB ?? "null")
    );
    expect(operationB).toEqual(operationA);

    await pageB
      .getByRole("button", { exact: true, name: "檢查帳戶資料" })
      .click();
    await expect(
      pageB.getByRole("heading", { level: 1, name: "檢查新帳戶" })
    ).toBeVisible();
    await Promise.all(
      [
        inputB.fullName,
        inputB.username,
        inputB.phone,
        "未提供",
        "否",
        "已親身核實",
      ].map((value) =>
        expect(pageB.getByText(value, { exact: true })).toBeVisible()
      )
    );
    const draftBeforeReceipt = await readDraft(pageB);
    expect(draftBeforeReceipt.fields).toEqual(expectedDraftB);
    expect(creationPostsB).toBe(0);

    const reconcileResponsePromise = pageB.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === reconcilePath
    );
    await pageB
      .getByRole("button", {
        exact: true,
        name: "確認並建立帳戶及發出臨時密碼",
      })
      .click();
    const reconcileResponse = await reconcileResponsePromise;
    expect(reconcileResponse.status()).toBe(200);
    expect(reconcileResponse.request().postDataJSON()).toEqual({
      operationKey: submittedOperationKey,
    });
    expect(
      reconcileResponse.request().headers()["x-efcc-expected-actor-id"]
    ).toBe(staff.userId);
    const rawReconciliation: unknown = await reconcileResponse.json();
    expect(rawReconciliation).toMatchObject({
      data: {
        receipt: {
          action: "assisted_account_created",
          targetUserId: targetAId,
        },
      },
    });
    const reconciliationData = (
      rawReconciliation as { data: Record<string, unknown> }
    ).data;
    expect(Object.keys(reconciliationData)).toEqual(["receipt"]);
    expect(reconciliationData).not.toHaveProperty("temporaryPassword");
    expect(reconciliationData).not.toHaveProperty("temporaryPasswordExpiresAt");
    const receiptFromReconciliation = reconciliationData.receipt as {
      action: string;
      id: string;
      targetUserId: string;
    };
    expect(receiptFromReconciliation.action).toBe("assisted_account_created");
    expect(receiptFromReconciliation.targetUserId).toBe(targetAId);
    await expect(
      pageB.getByRole("heading", { name: "臨時密碼不能再次顯示" })
    ).toBeVisible();
    await expect(pageB.getByLabel("新臨時密碼", { exact: true })).toHaveCount(
      0
    );
    await expect(
      pageB.getByRole("button", { exact: true, name: "複製臨時密碼" })
    ).toHaveCount(0);
    await expect(pageB.getByText(inputB.fullName, { exact: true })).toHaveCount(
      0
    );
    const operationDetails = pageB.locator('details[aria-label="操作詳情"]');
    await operationDetails.locator("summary").click();
    await expect(operationDetails).toContainText(targetAId);
    await expect(operationDetails).toContainText(receiptFromReconciliation.id);
    const bText = await pageB.locator("body").textContent();
    expect(bText).not.toBeNull();
    const bContainsCredential =
      bText?.includes(issuance.temporaryPassword) ?? false;
    expect(bContainsCredential).toBe(false);
    const rawOperationAfterBSubmit = await pageB.evaluate(
      (key) => localStorage.getItem(key),
      operationStorageKey
    );
    expect(rawOperationAfterBSubmit).toBe(rawOperationA);
    expect(rawOperationAfterBSubmit?.includes(issuance.temporaryPassword)).toBe(
      false
    );
    expect(creationPostsB).toBe(0);

    const receiptOnlyB = await readDraft(pageB);
    await expect(
      pageB.getByRole("button", { exact: true, name: "建立下一位會友" })
    ).toHaveCount(0);
    await expect(
      pageB.getByRole("button", {
        exact: true,
        name: "重新核實並發出新臨時密碼",
      })
    ).toHaveCount(0);
    const finishB = pageB.getByRole("button", {
      exact: true,
      name: "保留草稿，繼續核對",
    });
    await expect(finishB).toBeEnabled();
    await finishB.click();

    const discardDialog = pageB.getByRole("dialog", {
      name: "放棄未提交的更改？",
    });
    const bEditorButton = pageB.getByRole("button", {
      exact: true,
      name: "檢查帳戶資料",
    });
    const receiptOnlyHeading = pageB.getByRole("heading", {
      name: "臨時密碼不能再次顯示",
    });
    await expect(discardDialog).toBeHidden();
    await expect(receiptOnlyHeading).toBeHidden();
    await expect(bEditorButton).toBeVisible();
    await expect
      .poll(() =>
        pageB.evaluate((key) => localStorage.getItem(key), operationStorageKey)
      )
      .toBeNull();
    const finalOperationRaw = await pageB.evaluate(
      (key) => localStorage.getItem(key),
      operationStorageKey
    );
    expect(finalOperationRaw).toBeNull();
    const afterFinishB = await readDraft(pageB);
    const afterFinishText = await pageB.locator("body").textContent();
    expect(afterFinishText).not.toBeNull();
    const afterFinishCredentialLeak =
      afterFinishText?.includes(issuance.temporaryPassword) ?? false;
    const effectsBAfterFinish = await creationEffects(
      caseApp,
      inputB.username,
      null
    );
    await testInfo.attach("w12-two-tab-creation-draft-observations.json", {
      body: JSON.stringify(
        {
          actorUserId: staff.userId,
          afterFinish: afterFinishB,
          afterFinishCredentialLeak,
          beforeACommit: draftBeforeACommit,
          beforeBSubmit: draftBeforeBSubmit,
          beforeReceipt: draftBeforeReceipt,
          creationEffectsA: effectsA,
          creationEffectsB: effectsBAfterFinish,
          documentLoadsAfterDraft,
          expectedDraftB,
          finalOperationCleared: finalOperationRaw === null,
          finalOperationMatchesA: finalOperationRaw === rawOperationA,
          operation: operationA,
          preserveDraftAcknowledged: true,
          receiptOnly: receiptOnlyB,
          reconciliation: {
            dataKeys: Object.keys(reconciliationData),
            receipt: receiptFromReconciliation,
            requestActorUserId: staff.userId,
            requestOperationKey: submittedOperationKey,
            status: reconcileResponse.status(),
          },
          taskHrefB,
        },
        null,
        2
      ),
      contentType: "application/json",
    });

    expect.soft(afterFinishB.href).toBe(taskHrefB);
    expect.soft(afterFinishB.formVisible).toBe(true);
    expect.soft(afterFinishB.fields).toEqual(expectedDraftB);
    expect.soft(documentLoadsAfterDraft).toBe(0);
    expect.soft(afterFinishCredentialLeak).toBe(false);

    expect(creationPostsA).toBe(1);
    expect(creationPostsB).toBe(0);
    expect(effectsBAfterFinish).toEqual({
      audits: 0,
      credentials: 0,
      plaintext: 0,
      profiles: 0,
      receipts: 0,
      reservations: 0,
      users: 0,
    });
  }
);
