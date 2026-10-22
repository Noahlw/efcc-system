import { randomUUID } from "node:crypto";

import { dedicatedTest, expect } from "../../support/fixtures";
import type { ProvisionAccount } from "../../worker/provision";
import { phone } from "./test-helpers";

const operationStorageKey = "efcc.identity-change.operation.v1";

dedicatedTest(
  "a confirmed Identity receipt from another tab preserves this tab's unsent draft",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@account-identity",
      "@risk-auth",
      "@risk-draft",
      "@risk-privacy",
    ],
  },
  async ({ caseApp, staffPage: pageA, staff }, testInfo) => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
    const targetA: ProvisionAccount = {
      email: `cross.tab.a.${suffix}@example.com`,
      fullName: `陳跨頁甲${suffix}`,
      membershipStatus: "active",
      password: "Synthetic-identity-password!",
      username: `cross.tab.a.${suffix}`,
    };
    const targetB: ProvisionAccount = {
      email: `cross.tab.b.${suffix}@example.com`,
      fullName: `陳跨頁乙${suffix}`,
      membershipStatus: "active",
      password: "Synthetic-identity-password!",
      username: `cross.tab.b.${suffix}`,
    };
    const targetAId = await caseApp.provision.account(targetA);
    const targetBId = await caseApp.provision.account(targetB);
    const correctedName = `陳已提交甲${suffix}`;
    const correctedUsername = `cross.done.a.${suffix}`;
    const correctedEmail = `cross.done.a.${suffix}@example.com`;
    const correctedPhone = phone();
    const draft = {
      email: "",
      fullName: `陳未提交乙${suffix}`,
      identityCheck: "face_to_face",
      identityVerified: true,
      phone: phone(),
      sharedPhone: false,
      username: `cross.draft.b.${suffix}`,
    };

    await caseApp.db
      .prepare(
        "UPDATE session SET password_confirmed_at = CAST(strftime('%s','now') AS INTEGER) - 601 WHERE user_id = ?"
      )
      .bind(staff.userId)
      .run();

    let identityPostsA = 0;
    let identityPostsB = 0;
    const receiptLookupsB: { actorUserId: string | null; key: string }[] = [];
    let submittedOperationKey: string | null = null;
    const identityEndpoint = "/api/v2/staff/accounts/identity";
    pageA.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname === identityEndpoint
      ) {
        identityPostsA += 1;
        submittedOperationKey = request.postDataJSON().operationKey;
      }
    });

    const pageB = await pageA.context().newPage();
    expect(pageB.context()).toBe(pageA.context());
    pageB.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/v2/account/changes/reconcile"
      ) {
        receiptLookupsB.push({
          actorUserId: request.headers()["x-efcc-expected-actor-id"] ?? null,
          key: request.postDataJSON().operationKey,
        });
      }
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname === identityEndpoint
      ) {
        identityPostsB += 1;
      }
    });

    const taskUrlA = `/staff/accounts?view=people&person=${targetAId}&task=identity`;
    const taskUrlB = `/staff/accounts?view=people&person=${targetBId}&task=identity`;
    await Promise.all([pageA.goto(taskUrlA), pageB.goto(taskUrlB)]);
    const regionA = pageA.getByRole("region", {
      name: "職員核實修正身分資料",
    });
    const regionB = pageB.getByRole("region", {
      name: "職員核實修正身分資料",
    });
    await expect(
      regionA.getByRole("button", { exact: true, name: "檢查修正" })
    ).toBeEnabled();
    await expect(
      regionB.getByRole("button", { exact: true, name: "檢查修正" })
    ).toBeEnabled();

    const bFullName = regionB.getByLabel("中文全名", { exact: true });
    const bUsername = regionB.getByLabel("使用者名稱", { exact: true });
    const bEmail = regionB.getByLabel("電郵（沒有電郵可留空）", {
      exact: true,
    });
    const bPhone = regionB.getByLabel("修正電話", { exact: true });
    const bSharedPhone = regionB.getByLabel("已核實共用電話例外");
    const bVerification = regionB.getByRole("radiogroup", {
      exact: true,
      name: "身分核實方式",
    });
    const bFaceToFace = bVerification.locator('input[value="face_to_face"]');
    const bIdentityVerified = regionB.getByLabel(
      "已按以上方式核實本人，新聯絡資料沒有用作復原憑證",
      { exact: true }
    );
    await bFullName.fill(draft.fullName);
    await bUsername.fill(draft.username);
    await bEmail.fill(draft.email);
    await bPhone.fill(draft.phone);
    await bSharedPhone.uncheck();
    await bFaceToFace.check();
    await bIdentityVerified.check();
    await expect(bFullName).toHaveValue(draft.fullName);
    await expect(bUsername).toHaveValue(draft.username);
    await expect(bEmail).toHaveValue("");
    await expect(bPhone).toHaveValue(draft.phone);
    await expect(bSharedPhone).not.toBeChecked();
    await expect(bFaceToFace).toBeChecked();
    await expect(bIdentityVerified).toBeChecked();
    const targetBBefore = await caseApp.db
      .prepare(
        "SELECT u.email,u.email_verified,u.name,u.username,p.phone,p.phone_shared FROM user u INNER JOIN person_profile p ON p.user_id = u.id WHERE u.id = ?"
      )
      .bind(targetBId)
      .first<{
        email: string;
        email_verified: number;
        name: string;
        phone: string | null;
        phone_shared: number;
        username: string;
      }>();
    expect(targetBBefore).not.toBeNull();

    const captureUi = (page: typeof pageA) =>
      page.evaluate(() => {
        const region = document.querySelector<HTMLElement>(
          '[aria-label="職員核實修正身分資料"]'
        );
        const controls = [
          ...(region?.querySelectorAll<HTMLInputElement>("input") ?? []),
        ];
        const findInput = (labelText: string) =>
          controls.find((input) =>
            [...(input.labels ?? [])].some(
              (label) => label.textContent?.trim() === labelText
            )
          );
        const fieldValue = (labelText: string) =>
          findInput(labelText)?.value ?? null;
        const fieldChecked = (labelText: string) =>
          findInput(labelText)?.checked ?? null;
        const selectedDetail = document.querySelector<HTMLElement>(
          '[aria-label="帳戶詳情"]'
        );
        return {
          detailText: selectedDetail?.textContent ?? null,
          detailVisible: Boolean(selectedDetail?.getClientRects().length),
          editFormVisible: Boolean(
            region?.querySelector("form")?.getClientRects().length
          ),
          fields: {
            email: fieldValue("電郵（沒有電郵可留空）"),
            fullName: fieldValue("中文全名"),
            identityCheck:
              region?.querySelector<HTMLInputElement>(
                'input[type="radio"]:checked'
              )?.value ?? null,
            identityVerified: fieldChecked(
              "已按以上方式核實本人，新聯絡資料沒有用作復原憑證"
            ),
            phone: fieldValue("修正電話"),
            sharedPhone: fieldChecked("已核實共用電話例外"),
            username: fieldValue("使用者名稱"),
          },
          href: location.href,
          identityRegionVisible: Boolean(region?.getClientRects().length),
          statusText:
            region?.querySelector('[role="status"]')?.textContent ?? null,
        };
      });
    const draftBeforeReceipt = await captureUi(pageB);
    const bTaskHref = pageB.url();
    expect(draftBeforeReceipt.editFormVisible).toBe(true);
    expect(draftBeforeReceipt.fields).toEqual(draft);

    const aFullName = regionA.getByLabel("中文全名", { exact: true });
    const aUsername = regionA.getByLabel("使用者名稱", { exact: true });
    const aEmail = regionA.getByLabel("電郵（沒有電郵可留空）", {
      exact: true,
    });
    const aPhone = regionA.getByLabel("修正電話", { exact: true });
    const aSharedPhone = regionA.getByLabel("已核實共用電話例外");
    const aVerification = regionA.getByRole("radiogroup", {
      exact: true,
      name: "身分核實方式",
    });
    const aIdentityVerified = regionA.getByLabel(
      "已按以上方式核實本人，新聯絡資料沒有用作復原憑證",
      { exact: true }
    );
    await aFullName.fill(correctedName);
    await aUsername.fill(correctedUsername);
    await aEmail.fill(correctedEmail);
    await aPhone.fill(correctedPhone);
    await aSharedPhone.uncheck();
    await aVerification.locator('input[value="face_to_face"]').check();
    await aIdentityVerified.check();
    await regionA
      .getByRole("button", { exact: true, name: "檢查修正" })
      .click();
    await expect(
      regionA.getByRole("heading", { name: "提交前檢查" })
    ).toBeVisible();
    await regionA
      .getByRole("button", { exact: true, name: "確認目前密碼" })
      .click();
    const passwordDialog = pageA.getByRole("dialog");
    await expect(passwordDialog).toBeVisible();
    await passwordDialog
      .getByLabel("目前密碼", { exact: true })
      .fill(staff.account.password);
    await passwordDialog
      .getByRole("button", { exact: true, name: "確認並返回檢查" })
      .click();
    await expect(passwordDialog.getByRole("status")).toContainText(
      "伺服器已確認"
    );
    await passwordDialog
      .getByRole("button", { exact: true, name: "確認並返回檢查" })
      .click();
    await expect(passwordDialog).toBeHidden();

    const submitA = regionA.getByRole("button", {
      exact: true,
      name: "確認並提交修正",
    });
    await expect(submitA).toBeEnabled();
    await submitA.click();
    await expect(regionA.getByRole("status")).toContainText("伺服器已確認");

    expect(identityPostsA).toBe(1);
    if (!submittedOperationKey) {
      throw new Error("Tab A Identity submit did not carry an operation key.");
    }
    const targetAAfter = await caseApp.db
      .prepare(
        "SELECT u.email,u.email_verified,u.name,u.username,p.phone,p.phone_shared FROM user u INNER JOIN person_profile p ON p.user_id = u.id WHERE u.id = ?"
      )
      .bind(targetAId)
      .first<{
        email: string;
        email_verified: number;
        name: string;
        phone: string | null;
        phone_shared: number;
        username: string;
      }>();
    expect(targetAAfter).toMatchObject({
      email: correctedEmail,
      email_verified: 0,
      name: correctedName,
      phone: `+852${correctedPhone}`,
      phone_shared: 0,
    });
    const receiptA = await caseApp.db
      .prepare(
        "SELECT action,actor_user_id,operation_key,target_user_id FROM account_change_operation WHERE actor_user_id = ? AND target_user_id = ? AND action = 'staff_identity_corrected'"
      )
      .bind(staff.userId, targetAId)
      .all<{
        action: string;
        actor_user_id: string;
        operation_key: string;
        target_user_id: string;
      }>();
    expect(receiptA.results).toEqual([
      {
        action: "staff_identity_corrected",
        actor_user_id: staff.userId,
        operation_key: submittedOperationKey,
        target_user_id: targetAId,
      },
    ]);
    const auditsA = await caseApp.db
      .prepare(
        "SELECT action,actor_user_id,target_user_id FROM audit_event WHERE actor_user_id = ? AND target_user_id = ? AND action = 'staff_identity_corrected'"
      )
      .bind(staff.userId, targetAId)
      .all<{
        action: string;
        actor_user_id: string;
        target_user_id: string;
      }>();
    expect(auditsA.results).toHaveLength(1);

    const checkPrevious = regionB.getByRole("button", {
      exact: true,
      name: "查核之前的操作",
    });
    await expect
      .poll(async () => {
        const status = await regionB.getByRole("status").textContent();
        const canCheck = await checkPrevious.isVisible().catch(() => false);
        return status?.includes("伺服器已確認") || canCheck;
      })
      .toBe(true);
    if (await checkPrevious.isVisible().catch(() => false)) {
      await checkPrevious.click();
    }
    await expect(regionB.getByRole("status")).toContainText("伺服器已確認");
    const operationOnB = await pageB.evaluate((key) => {
      const saved = localStorage.getItem(key);
      return saved ? JSON.parse(saved) : null;
    }, operationStorageKey);
    expect(operationOnB).toEqual({
      action: "staff_identity_corrected",
      actorUserId: staff.userId,
      key: submittedOperationKey,
      targetUserId: targetAId,
    });
    expect(receiptLookupsB).toContainEqual({
      actorUserId: staff.userId,
      key: submittedOperationKey,
    });
    expect(identityPostsB).toBe(0);
    const draftWhileReceiptVisible = await captureUi(pageB);
    let documentLoadsAfterDraft = 0;
    pageB.on("load", () => {
      documentLoadsAfterDraft += 1;
    });
    const targetBBeforeFinish = await caseApp.db
      .prepare(
        "SELECT u.email,u.email_verified,u.name,u.username,p.phone,p.phone_shared FROM user u INNER JOIN person_profile p ON p.user_id = u.id WHERE u.id = ?"
      )
      .bind(targetBId)
      .first<{
        email: string;
        email_verified: number;
        name: string;
        phone: string | null;
        phone_shared: number;
        username: string;
      }>();
    expect(targetBBeforeFinish).toEqual(targetBBefore);

    const discardDialog = pageB.getByRole("dialog", {
      name: "放棄未提交的更改？",
    });
    await regionB
      .getByRole("link", { exact: true, name: "返回帳戶詳情" })
      .click();
    await expect(discardDialog).toBeVisible();
    await discardDialog
      .getByRole("button", { exact: true, name: "繼續編輯" })
      .click();
    await expect(discardDialog).toBeHidden();
    expect(pageB.url()).toBe(bTaskHref);
    expect(
      await pageB.evaluate((key) => {
        const saved = localStorage.getItem(key);
        return saved ? JSON.parse(saved) : null;
      }, operationStorageKey)
    ).toEqual(operationOnB);
    await regionB
      .getByRole("button", { exact: true, name: "保留草稿，繼續核對" })
      .click();
    await expect(discardDialog).toBeHidden();
    await expect
      .poll(() =>
        pageB.evaluate((key) => localStorage.getItem(key), operationStorageKey)
      )
      .toBeNull();
    const operationAfterFinish = await pageB.evaluate((key) => {
      const saved = localStorage.getItem(key);
      return saved ? JSON.parse(saved) : null;
    }, operationStorageKey);
    expect(operationAfterFinish).toBeNull();

    const bEditButton = pageB.getByRole("button", {
      exact: true,
      name: "檢查修正",
    });
    const bDetails = pageB.getByRole("region", { name: "帳戶詳情" });
    await expect
      .poll(
        async () =>
          (await bEditButton.isVisible().catch(() => false)) ||
          (await bDetails.isVisible().catch(() => false))
      )
      .toBe(true);
    const afterFinish = await captureUi(pageB);
    await testInfo.attach("w11-cross-tab-identity-draft-observations.json", {
      body: JSON.stringify(
        {
          afterFinish,
          afterReceipt: draftWhileReceiptVisible,
          beforeReceipt: draftBeforeReceipt,
          documentLoadsAfterDraft,
          expectedDraft: draft,
          expectedTabBTaskHref: bTaskHref,
          headerDiscardCancelled: true,
          identityPostsA,
          identityPostsB,
          operationAfterFinish,
          receiptKey: submittedOperationKey,
          receiptLookupsB,
        },
        null,
        2
      ),
      contentType: "application/json",
    });

    expect.soft(afterFinish.href).toBe(bTaskHref);
    expect.soft(documentLoadsAfterDraft).toBe(0);
    expect.soft(afterFinish.identityRegionVisible).toBe(true);
    expect.soft(afterFinish.editFormVisible).toBe(true);
    expect.soft(afterFinish.fields).toEqual({
      email: draft.email,
      fullName: draft.fullName,
      identityCheck: draft.identityCheck,
      identityVerified: draft.identityVerified,
      phone: draft.phone,
      sharedPhone: draft.sharedPhone,
      username: draft.username,
    });

    expect(identityPostsA).toBe(1);
    expect(identityPostsB).toBe(0);
    const targetBAfterFinish = await caseApp.db
      .prepare(
        "SELECT u.email,u.email_verified,u.name,u.username,p.phone,p.phone_shared FROM user u INNER JOIN person_profile p ON p.user_id = u.id WHERE u.id = ?"
      )
      .bind(targetBId)
      .first<{
        email: string;
        email_verified: number;
        name: string;
        phone: string | null;
        phone_shared: number;
        username: string;
      }>();
    expect(targetBAfterFinish).toEqual(targetBBefore);
    const receiptsB = await caseApp.db
      .prepare(
        "SELECT id FROM account_change_operation WHERE actor_user_id = ? AND target_user_id = ? AND action IN ('staff_identity_corrected','staff_shared_phone_corrected')"
      )
      .bind(staff.userId, targetBId)
      .all<{ id: string }>();
    expect(receiptsB.results).toHaveLength(0);
    const auditsB = await caseApp.db
      .prepare(
        "SELECT id FROM audit_event WHERE actor_user_id = ? AND target_user_id = ? AND action IN ('staff_identity_corrected','staff_shared_phone_corrected')"
      )
      .bind(staff.userId, targetBId)
      .all<{ id: string }>();
    expect(auditsB.results).toHaveLength(0);
  }
);
