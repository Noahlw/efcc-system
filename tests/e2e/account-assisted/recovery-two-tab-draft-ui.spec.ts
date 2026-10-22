import type {
  APIRequestContext,
  Page,
  PlaywrightWorkerArgs,
} from "@playwright/test";

import { storedStaffAccountOperationSchema } from "../../../src/features/account/assisted-accounts/staff-account-contract";
import type { NativeApp } from "../../support/fixtures";
import {
  creation,
  creationEffects,
  credentialRow,
  dedicatedTest,
  expect,
  expectResponseStatus,
  issuedCredential,
  staffData,
} from "./fixtures";

const operationStorageKey = "efcc.staff-account.operation.v1";
const creationPath = "/api/v2/staff/accounts";
const reconcilePath = "/api/v2/staff/accounts/reconcile";
const recoveryActions = {
  staff_password_reset: {
    mode: "reset",
    radio: /重設密碼，並使原有登入失效/u,
    submit: "確認並重設密碼及登出全部裝置",
  },
  temporary_password_reissued: {
    mode: "reissue",
    radio: /重新發出臨時密碼/u,
    submit: "確認並重新發出臨時密碼",
  },
} as const;
type RecoveryAction = keyof typeof recoveryActions;

const createTarget = async (staffContext: APIRequestContext) => {
  const input = creation();
  const issued = issuedCredential(
    await staffData(
      await expectResponseStatus(
        staffContext.post(creationPath, { data: input }),
        201
      )
    )
  );
  const userId = issued.receipt?.targetUserId;
  if (!userId) {
    throw new Error("The synthetic recovery target has no receipt");
  }
  return { input, issued, userId };
};

const readCreationDraft = (page: Page) =>
  page.evaluate(() => ({
    fields: {
      email:
        document.querySelector<HTMLInputElement>("#assisted-email")?.value ??
        null,
      fullName:
        document.querySelector<HTMLInputElement>("#assisted-name")?.value ??
        null,
      phone:
        document.querySelector<HTMLInputElement>("#assisted-phone")?.value ??
        null,
      sharedPhone:
        document.querySelector<HTMLInputElement>("#assisted-shared-phone")
          ?.checked ?? null,
      username:
        document.querySelector<HTMLInputElement>("#assisted-username")?.value ??
        null,
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
    task: new URL(location.href).searchParams.get("task"),
  }));

const readRecoveryDraft = (page: Page) =>
  page.evaluate(() => ({
    action:
      document.querySelector<HTMLInputElement>(
        'input[name="recovery-action"]:checked'
      )?.value ?? null,
    formVisible: Boolean(
      [...document.querySelectorAll<HTMLButtonElement>("button")].some(
        (button) =>
          button.textContent?.trim() === "檢查資料" &&
          button.getClientRects().length > 0
      )
    ),
    href: location.href,
    identityCheck:
      document.querySelector<HTMLInputElement>(
        'input[name="identityCheck"]:checked'
      )?.value ?? null,
    targetUserId:
      document.querySelector<HTMLInputElement>('input[name="targetUserId"]')
        ?.value ?? null,
    task: new URL(location.href).searchParams.get("task"),
    verified:
      document.querySelector<HTMLInputElement>(
        'input[type="checkbox"][required]'
      )?.checked ?? null,
  }));

const scenarios = [
  {
    aAction: "temporary_password_reissued",
    bAction: "staff_password_reset",
    bTask: "recovery",
    name: "reissue receipt preserves a reviewed reset draft",
  },
  {
    aAction: "staff_password_reset",
    bAction: "temporary_password_reissued",
    bTask: "recovery",
    name: "reset receipt preserves a reviewed reissue draft",
  },
  {
    aAction: "staff_password_reset",
    bAction: "assisted_account_created",
    bTask: "create",
    name: "reset receipt preserves an unsent creation draft",
  },
] as const;

type Scenario = (typeof scenarios)[number];
type Target = Awaited<ReturnType<typeof createTarget>>;

const prepareRecoveryTarget = async (
  caseApp: NativeApp,
  playwright: PlaywrightWorkerArgs["playwright"],
  target: Target | null
) => {
  if (!target) {
    return null;
  }
  const verifiedPhone = `+852${target.input.phone}`;
  await caseApp.db
    .prepare(
      "UPDATE person_profile SET phone = ?, verified_recovery_phone = ? WHERE user_id = ?"
    )
    .bind(verifiedPhone, verifiedPhone, target.userId)
    .run();

  const memberSession = await playwright.request.newContext({
    baseURL: caseApp.origin,
  });
  try {
    await expectResponseStatus(
      memberSession.post("/api/auth/sign-in/username", {
        data: {
          password: target.issued.temporaryPassword,
          username: target.input.username,
        },
      }),
      200
    );
  } finally {
    await memberSession.dispose();
  }

  const credential = await credentialRow(caseApp, target.userId);
  const sessions = await caseApp.db
    .prepare(
      "SELECT id, credential_revision, expires_at, password_confirmed_at FROM session WHERE user_id = ? ORDER BY id"
    )
    .bind(target.userId)
    .all<{
      credential_revision: number;
      expires_at: number;
      id: string;
      password_confirmed_at: number | null;
    }>();
  expect(sessions.results.length).toBeGreaterThan(0);
  return { credential, sessions };
};

const prepareRecoveryDraft = async (
  page: Page,
  targetUserId: string,
  action: RecoveryAction
) => {
  await expect(
    page.getByRole("button", { exact: true, name: "檢查資料" })
  ).toBeEnabled();
  await page
    .getByRole("radio", { name: recoveryActions[action].radio })
    .check();
  const method = page.getByRole("radiogroup", {
    exact: true,
    name: "身分核實方式",
  });
  const inPerson = method.getByRole("radio", { exact: true, name: "親身核實" });
  const byPhone = method.getByRole("radio", {
    name: /職員主動聯絡教會原有已核實電話/u,
  });
  const verified = page.getByLabel("已按以上方式核實身分", { exact: false });
  await expect(inPerson).toBeEnabled();
  await expect(byPhone).toBeEnabled();
  await byPhone.check();
  await verified.check();
  await inPerson.check();
  await expect(verified).not.toBeChecked();
  await byPhone.check();
  await expect(verified).not.toBeChecked();
  await verified.check();
  await page.getByRole("button", { exact: true, name: "檢查資料" }).click();
  const reviewName =
    action === "staff_password_reset" ? "檢查重設密碼" : "檢查重新發出";
  await expect(
    page.getByRole("heading", { exact: true, name: reviewName })
  ).toBeVisible();
  const expected = {
    action,
    identityCheck: "verified_phone",
    targetUserId,
    verified: true,
  };
  expect(await readRecoveryDraft(page)).toMatchObject(expected);
  return expected;
};

const prepareCreationDraft = async (page: Page) => {
  const input = creation();
  await expect(
    page.getByRole("button", { exact: true, name: "檢查帳戶資料" })
  ).toBeEnabled();
  await page.getByLabel("中文全名", { exact: true }).fill(input.fullName);
  await page.getByLabel("使用者名稱", { exact: true }).fill(input.username);
  await page.getByLabel("電郵（沒有電郵可留空）", { exact: true }).fill("");
  await page.getByLabel("電話", { exact: true }).fill(input.phone);
  await page.getByLabel("已親身核實共用電話例外", { exact: true }).uncheck();
  await page.getByLabel("已親身核實此人的身分", { exact: true }).check();
  await page.getByRole("button", { exact: true, name: "檢查帳戶資料" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "檢查新帳戶" })
  ).toBeVisible();
  const expected = {
    email: "",
    fullName: input.fullName,
    phone: input.phone,
    sharedPhone: false,
    username: input.username,
    verified: true,
  };
  const draft = await readCreationDraft(page);
  expect(draft.fields).toEqual(expected);
  return { expected, input };
};

const prepareTabsAndDraft = async (
  pageA: Page,
  pageB: Page,
  scenario: Scenario,
  targetA: Target,
  targetB: Target | null
) => {
  const taskPathB =
    scenario.bTask === "create"
      ? "/staff/accounts?task=create"
      : `/staff/accounts?view=people&person=${targetB?.userId}&task=recovery`;
  const taskPathA = `/staff/accounts?view=people&person=${targetA.userId}&task=recovery`;
  await Promise.all([pageA.goto(taskPathA), pageB.goto(taskPathB)]);
  const taskHrefB = pageB.url();
  const operationBeforeDraft = await pageB.evaluate(
    (key) => localStorage.getItem(key),
    operationStorageKey
  );
  expect(operationBeforeDraft).toBeNull();

  if (scenario.bTask === "recovery") {
    if (!targetB) {
      throw new Error("The recovery draft has no synthetic target");
    }
    const expectedRecoveryDraft = await prepareRecoveryDraft(
      pageB,
      targetB.userId,
      scenario.bAction
    );
    return {
      draftBeforeACommit: await readRecoveryDraft(pageB),
      expectedCreationDraft: null,
      expectedRecoveryDraft,
      input: null,
      taskHrefB,
    };
  }

  const { expected, input } = await prepareCreationDraft(pageB);
  return {
    draftBeforeACommit: await readCreationDraft(pageB),
    expectedCreationDraft: expected,
    expectedRecoveryDraft: null,
    input,
    taskHrefB,
  };
};

const commitOriginalRecovery = async (
  page: Page,
  caseApp: NativeApp,
  target: Target,
  actorUserId: string,
  action: RecoveryAction
) => {
  const beforeCredential = await credentialRow(caseApp, target.userId);
  if (!beforeCredential) {
    throw new Error("The original operation target has no credential");
  }
  await page.bringToFront();
  await page
    .getByRole("radio", { name: recoveryActions[action].radio })
    .check();
  await page.getByLabel("已按以上方式核實身分", { exact: false }).check();
  await page.getByRole("button", { exact: true, name: "檢查資料" }).click();
  const path = `/api/v2/staff/accounts/password-${recoveryActions[action].mode}`;
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === path
  );
  await page
    .getByRole("button", {
      exact: true,
      name: recoveryActions[action].submit,
    })
    .click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  const issuance = issuedCredential(await staffData(response));
  const postBody = response.request().postDataJSON() as {
    operationKey?: unknown;
  };
  if (typeof postBody.operationKey !== "string") {
    throw new TypeError("The original recovery request has no operation key");
  }
  const key = postBody.operationKey;
  const rawOperation = await page.evaluate(
    (storageKey) => localStorage.getItem(storageKey),
    operationStorageKey
  );
  const operation = storedStaffAccountOperationSchema.parse(
    JSON.parse(rawOperation ?? "null")
  );
  expect(operation).toMatchObject({
    action,
    actorUserId,
    key,
    targetUserId: target.userId,
  });
  expect(rawOperation?.includes(issuance.temporaryPassword)).toBe(false);
  await expect(page.getByLabel("新臨時密碼", { exact: true })).toBeVisible();

  const credentialAfter = await credentialRow(caseApp, target.userId);
  const effects = await caseApp.db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM staff_account_operation WHERE actor_user_id = ? AND target_user_id = ? AND action = ?) AS receipts,
        (SELECT COUNT(*) FROM audit_event WHERE target_user_id = ? AND action = ?) AS audits`
    )
    .bind(actorUserId, target.userId, action, target.userId, action)
    .first<{ audits: number; receipts: number }>();
  return {
    beforeCredential,
    credentialAfter,
    effects,
    issuance,
    key,
    rawOperation,
  };
};

const reconcileSecondTab = async (
  page: Page,
  scenario: Scenario,
  targetA: Target,
  targetB: Target | null,
  actorUserId: string,
  original: Awaited<ReturnType<typeof commitOriginalRecovery>>
) => {
  await page.bringToFront();
  const rawOperation = await page.evaluate(
    (key) => localStorage.getItem(key),
    operationStorageKey
  );
  expect(rawOperation).toBe(original.rawOperation);
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === reconcilePath
  );
  const submitButton =
    scenario.bTask === "recovery" && targetB
      ? page.getByRole("button", {
          exact: true,
          name: recoveryActions[scenario.bAction].submit,
        })
      : page.getByRole("button", {
          exact: true,
          name: "確認並建立帳戶及發出臨時密碼",
        });
  await submitButton.click();
  const response = await responsePromise;
  const body: unknown = await response.json();
  expect(response.status()).toBe(200);
  expect(response.request().postDataJSON()).toEqual({
    operationKey: original.key,
  });
  expect(response.request().headers()["x-efcc-expected-actor-id"]).toBe(
    actorUserId
  );
  expect(body).toMatchObject({
    data: {
      receipt: {
        action: scenario.aAction,
        targetUserId: targetA.userId,
      },
    },
  });
  const { data } = body as { data: Record<string, unknown> };
  expect(Object.keys(data)).toEqual(["receipt"]);
  expect(data).not.toHaveProperty("temporaryPassword");
  expect(data).not.toHaveProperty("temporaryPasswordExpiresAt");
  const receipt = data.receipt as {
    action: string;
    id: string;
    targetUserId: string;
  };
  expect(receipt).toMatchObject({
    action: scenario.aAction,
    targetUserId: targetA.userId,
  });
  await expect(
    page.getByRole("heading", { name: "臨時密碼不能再次顯示" })
  ).toBeVisible();
  await expect(page.getByLabel("新臨時密碼", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { exact: true, name: "複製臨時密碼" })
  ).toHaveCount(0);
  const bodyText = await page.locator("body").textContent();
  expect(bodyText?.includes(original.issuance.temporaryPassword)).toBe(false);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), operationStorageKey)
  ).toBe(original.rawOperation);
  return receipt;
};

const finishAndObserveDraft = async (
  page: Page,
  scenario: Scenario,
  taskHrefB: string,
  temporaryPassword: string,
  expectedRecoveryDraft: Awaited<
    ReturnType<typeof prepareRecoveryDraft>
  > | null,
  expectedCreationDraft:
    | Awaited<ReturnType<typeof prepareCreationDraft>>["expected"]
    | null
) => {
  const keepDraftButton = page.getByRole("button", {
    exact: true,
    name: "保留草稿，繼續核對",
  });
  const genericFinishButton = page.getByRole("button", {
    exact: true,
    name: "完成，開始另一項操作",
  });
  const keepDraftLabelShown = await keepDraftButton.isVisible();
  expect.soft(keepDraftLabelShown).toBe(true);
  const genericFinishShown = keepDraftLabelShown
    ? false
    : await genericFinishButton.isVisible();
  const finishButton = keepDraftLabelShown
    ? keepDraftButton
    : genericFinishButton;
  expect.soft(keepDraftLabelShown || genericFinishShown).toBe(true);
  if (keepDraftLabelShown || genericFinishShown) {
    await finishButton.click();
  }

  const discardDialog = page.getByRole("dialog", {
    name: "放棄未提交的更改？",
  });
  const discardPromptShown = await discardDialog.isVisible();
  expect.soft(discardPromptShown).toBe(false);
  if (discardPromptShown) {
    await discardDialog
      .getByRole("button", { exact: true, name: "繼續編輯" })
      .click();
  }

  await expect
    .soft(page.getByRole("heading", { name: "臨時密碼不能再次顯示" }))
    .toBeHidden({ timeout: 3000 });
  const editorButton = page.getByRole("button", {
    exact: true,
    name: scenario.bTask === "create" ? "檢查帳戶資料" : "檢查資料",
  });
  await expect.soft(editorButton).toBeVisible({ timeout: 3000 });

  const draft =
    scenario.bTask === "create"
      ? await readCreationDraft(page)
      : await readRecoveryDraft(page);
  const text = await page.locator("body").textContent();
  const plaintextRestored = text?.includes(temporaryPassword) ?? false;
  const operationAfterFinish = await page.evaluate(
    (key) => localStorage.getItem(key),
    operationStorageKey
  );
  expect.soft(operationAfterFinish).toBeNull();
  expect.soft(plaintextRestored).toBe(false);
  if (expectedRecoveryDraft) {
    expect.soft(draft).toMatchObject({
      ...expectedRecoveryDraft,
      formVisible: true,
      task: "recovery",
    });
  }
  if (expectedCreationDraft) {
    expect.soft(draft).toMatchObject({
      fields: expectedCreationDraft,
      formVisible: true,
      task: "create",
    });
  }
  expect.soft(draft.href).toBe(taskHrefB);

  let finishLabel = "missing";
  if (keepDraftLabelShown) {
    finishLabel = "保留草稿，繼續核對";
  }
  if (genericFinishShown) {
    finishLabel = "完成，開始另一項操作";
  }
  return {
    discardPromptShown,
    draft,
    finishLabel,
    operationCleared: operationAfterFinish === null,
    plaintextRestored,
  };
};

const readSecondTaskEffects = async (
  caseApp: NativeApp,
  actorUserId: string,
  targetB: Target | null,
  creationInput:
    | Awaited<ReturnType<typeof prepareCreationDraft>>["input"]
    | null
) => {
  const recoveryEffects = targetB
    ? await caseApp.db
        .prepare(
          `SELECT
            (SELECT COUNT(*) FROM staff_account_operation WHERE actor_user_id = ? AND target_user_id = ? AND action IN ('staff_password_reset', 'temporary_password_reissued')) AS receipts,
            (SELECT COUNT(*) FROM audit_event WHERE target_user_id = ? AND action IN ('staff_password_reset', 'temporary_password_reissued')) AS audits`
        )
        .bind(actorUserId, targetB.userId, targetB.userId)
        .first<{ audits: number; receipts: number }>()
    : null;
  const credential = targetB
    ? await credentialRow(caseApp, targetB.userId)
    : null;
  const sessions = targetB
    ? await caseApp.db
        .prepare(
          "SELECT id, credential_revision, expires_at, password_confirmed_at FROM session WHERE user_id = ? ORDER BY id"
        )
        .bind(targetB.userId)
        .all<{
          credential_revision: number;
          expires_at: number;
          id: string;
          password_confirmed_at: number | null;
        }>()
    : null;
  const creationEffectsAfter = creationInput
    ? await creationEffects(caseApp, creationInput.username, null)
    : null;
  return { creationEffectsAfter, credential, recoveryEffects, sessions };
};

for (const scenario of scenarios) {
  dedicatedTest(
    `a two-tab ${scenario.name} without replaying the second operation`,
    {
      tag: [
        "@native",
        "@browser",
        "@mobile-critical",
        "@account-assisted",
        "@risk-draft",
        "@risk-recovery",
        "@risk-non-replay",
        "@risk-privacy",
        "@risk-security",
      ],
    },
    async ({ caseApp, playwright, staff, staffPage: pageA }, testInfo) => {
      const targetA = await createTarget(staff.context);
      const targetB =
        scenario.bTask === "recovery"
          ? await createTarget(staff.context)
          : null;
      const targetBBaseline = await prepareRecoveryTarget(
        caseApp,
        playwright,
        targetB
      );
      const pageB = await pageA.context().newPage();
      expect(pageB.context()).toBe(pageA.context());
      const bSetup = await prepareTabsAndDraft(
        pageA,
        pageB,
        scenario,
        targetA,
        targetB
      );

      const requests = {
        aRecoveryPosts: 0,
        bCreationPosts: 0,
        bReconcilePosts: 0,
        bRecoveryPosts: 0,
      };
      const aPath = `/api/v2/staff/accounts/password-${recoveryActions[scenario.aAction].mode}`;
      pageA.on("request", (request) => {
        if (
          request.method() === "POST" &&
          new URL(request.url()).pathname === aPath
        ) {
          requests.aRecoveryPosts += 1;
        }
      });
      pageB.on("request", (request) => {
        if (request.method() !== "POST") {
          return;
        }
        const path = new URL(request.url()).pathname;
        if (path === creationPath) {
          requests.bCreationPosts += 1;
        } else if (path.startsWith("/api/v2/staff/accounts/password-")) {
          requests.bRecoveryPosts += 1;
        } else if (path === reconcilePath) {
          requests.bReconcilePosts += 1;
        }
      });

      const original = await commitOriginalRecovery(
        pageA,
        caseApp,
        targetA,
        staff.userId,
        scenario.aAction
      );
      const bReceipt = await reconcileSecondTab(
        pageB,
        scenario,
        targetA,
        targetB,
        staff.userId,
        original
      );
      const finish = await finishAndObserveDraft(
        pageB,
        scenario,
        bSetup.taskHrefB,
        original.issuance.temporaryPassword,
        bSetup.expectedRecoveryDraft,
        bSetup.expectedCreationDraft
      );
      const bEffects = await readSecondTaskEffects(
        caseApp,
        staff.userId,
        targetB,
        bSetup.input
      );
      const credentialObservation = (
        credential: typeof original.credentialAfter
      ) =>
        credential
          ? {
              credentialRevision: credential.credential_revision,
              expiresAt: credential.temporary_password_expires_at,
            }
          : null;

      await testInfo.attach("w12-recovery-two-tab-draft-observation.json", {
        body: JSON.stringify(
          {
            aAction: scenario.aAction,
            aCredentialAfter: credentialObservation(original.credentialAfter),
            aEffects: original.effects,
            aKey: original.key,
            aRecoveryPosts: requests.aRecoveryPosts,
            bAction: scenario.bAction,
            bCreationEffects: bEffects.creationEffectsAfter,
            bCreationPosts: requests.bCreationPosts,
            bDraftAfterFinish: finish.draft,
            bDraftBeforeACommit: bSetup.draftBeforeACommit,
            bReceipt,
            bReconcilePosts: requests.bReconcilePosts,
            bRecoveryEffects: bEffects.recoveryEffects,
            bRecoveryPosts: requests.bRecoveryPosts,
            bSessionsAfter: bEffects.sessions?.results ?? null,
            bSessionsBefore: targetBBaseline?.sessions.results ?? null,
            bTargetCredentialAfter: credentialObservation(bEffects.credential),
            bTargetCredentialBefore: credentialObservation(
              targetBBaseline?.credential ?? null
            ),
            finishLabel: finish.finishLabel,
            operationCleared: finish.operationCleared,
            plaintextRestored: finish.plaintextRestored,
            taskHrefB: bSetup.taskHrefB,
          },
          null,
          2
        ),
        contentType: "application/json",
      });

      expect(requests.aRecoveryPosts).toBe(1);
      expect(requests.bCreationPosts).toBe(0);
      expect(requests.bRecoveryPosts).toBe(0);
      expect(requests.bReconcilePosts).toBe(1);
      expect(original.effects).toEqual({ audits: 1, receipts: 1 });
      expect(original.credentialAfter?.credential_revision).toBe(
        original.beforeCredential.credential_revision + 1
      );
      expect(original.credentialAfter?.temporary_password_expires_at).toBe(
        original.issuance.temporaryPasswordExpiresAt
      );
      if (targetB && targetBBaseline) {
        expect(bEffects.recoveryEffects).toEqual({ audits: 0, receipts: 0 });
        expect(bEffects.credential).toEqual(targetBBaseline.credential);
        expect(bEffects.sessions?.results).toEqual(
          targetBBaseline.sessions.results
        );
      }
      if (bSetup.input) {
        expect(bEffects.creationEffectsAfter).toEqual({
          audits: 0,
          credentials: 0,
          plaintext: 0,
          profiles: 0,
          receipts: 0,
          reservations: 0,
          users: 0,
        });
      }
    }
  );
}
