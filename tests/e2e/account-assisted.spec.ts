/* eslint-disable no-await-in-loop, unicorn/no-await-expression-member -- Ordered HTTP calls and direct native D1 observations preserve the original transaction, limiter and credential-race claims. */
import { randomBytes, randomUUID } from "node:crypto";

import type { APIRequestContext, APIResponse, Page } from "@playwright/test";
import type * as z from "zod";

import {
  staffAccountErrorSchema,
  staffAccountResponseSchema,
  storedStaffAccountOperationSchema,
} from "../../src/features/account/staff-account-contract";
import { test as credentialTest } from "../support/credential-fixtures";
import { expect, test } from "../support/fixtures";
import type { NativeApp } from "../support/fixtures";
import type { ProvisionAccount } from "../worker/provision";
import { qualifyPresentation } from "./r11-presentation";

interface CreationInput {
  email: string | null;
  fullName: string;
  identityCheck: "face_to_face";
  operationKey: string;
  phone: string;
  sharedPhone: boolean;
  username: string;
}

interface RecoveryInput {
  identityCheck: "face_to_face" | "verified_phone";
  operationKey: string;
  targetUserId: string;
}

type StaffResponseData = z.infer<typeof staffAccountResponseSchema>["data"];

interface CredentialRow {
  credential_revision: number;
  password: string;
  temporary_password_expires_at: number | null;
}

const status = async (pending: Promise<APIResponse>, expected: number) => {
  const response = await pending;
  expect(response.status()).toBe(expected);
  return response;
};

const staffData = async (response: {
  json: () => Promise<unknown>;
}): Promise<StaffResponseData> =>
  staffAccountResponseSchema.parse(await response.json()).data;

const issuedCredential = (data: StaffResponseData) => {
  if (!("temporaryPassword" in data)) {
    throw new Error(
      "The original Staff handover did not return its credential"
    );
  }
  return data;
};

const errorCode = async (response: APIResponse) =>
  staffAccountErrorSchema.parse(await response.json()).error.code;

const creation = (): CreationInput => {
  const suffix = randomBytes(6).toString("hex");
  return {
    email: null,
    fullName: `陳新會員${suffix}`,
    identityCheck: "face_to_face",
    operationKey: randomUUID(),
    phone: String(60_000_000 + (randomBytes(4).readUInt32BE() % 10_000_000)),
    sharedPhone: false,
    username: `created.${suffix}`,
  };
};

const syntheticAccount = (
  namespace: string,
  role?: ProvisionAccount["role"],
  membershipStatus: ProvisionAccount["membershipStatus"] = "active"
): ProvisionAccount => {
  const suffix = randomBytes(6).toString("hex");
  const usernamePrefix = namespace
    .toLowerCase()
    .replaceAll(/[^a-z0-9_]/gu, "")
    .slice(0, 17);
  return {
    email: `${namespace}.${suffix}@example.invalid`,
    fullName: `陳協助${suffix}`,
    membershipStatus,
    ...(role ? { role } : {}),
    password: "Synthetic-assisted-password!",
    username: `${usernamePrefix}.${suffix}`,
  };
};

const accountId = async (app: NativeApp, username: string) => {
  const account = await app.db
    .prepare("SELECT id FROM user WHERE username = ?")
    .bind(username)
    .first<{ id: string }>();
  if (!account) {
    throw new Error("The synthetic account was not provisioned");
  }
  return account.id;
};

const credentialRow = (app: NativeApp, userId: string) =>
  app.db
    .prepare(
      "SELECT password, credential_revision, temporary_password_expires_at FROM account WHERE user_id = ? AND account_id = user_id AND provider_id = 'credential'"
    )
    .bind(userId)
    .first<CredentialRow>();

const creationEffects = (
  app: NativeApp,
  username: string,
  plaintext: string | null
) =>
  app.db
    .prepare(`SELECT
      (SELECT COUNT(*) FROM user WHERE username = ?) AS users,
      (SELECT COUNT(*) FROM account a JOIN user u ON u.id = a.user_id WHERE u.username = ?) AS credentials,
      (SELECT COUNT(*) FROM person_profile p JOIN user u ON u.id = p.user_id WHERE u.username = ?) AS profiles,
      (SELECT COUNT(*) FROM username_reservation WHERE username_key = ?) AS reservations,
      (SELECT COUNT(*) FROM audit_event WHERE action = 'assisted_account_created' AND target_user_id = (SELECT id FROM user WHERE username = ?)) AS audits,
      (SELECT COUNT(*) FROM staff_account_operation WHERE action = 'assisted_account_created' AND target_user_id = (SELECT id FROM user WHERE username = ?)) AS receipts,
      (SELECT COUNT(*) FROM account a JOIN user u ON u.id = a.user_id WHERE u.username = ? AND a.password = ?) AS plaintext`)
    .bind(
      username,
      username,
      username,
      username,
      username,
      username,
      username,
      plaintext ?? ""
    )
    .first<{
      audits: number;
      credentials: number;
      plaintext: number;
      profiles: number;
      receipts: number;
      reservations: number;
      users: number;
    }>();

const tags = (
  layer: "http" | "browser",
  risks: string[],
  mobileCritical = false
) => [
  "@native",
  `@${layer}`,
  "@account-assisted",
  ...(mobileCritical ? ["@mobile-critical"] : []),
  ...risks,
];

const dedicatedTest = test.extend<{ caseApp: NativeApp }>({
  caseApp: async ({ dedicatedApp }, use) => {
    await use(dedicatedApp);
  },
});

const dedicatedCredentialTest = credentialTest.extend<{ caseApp: NativeApp }>({
  caseApp: async ({ dedicatedApp }, use) => {
    await use(dedicatedApp);
  },
});

const creationDrafts = (page: Page) =>
  page.locator(
    "#assisted-name, #assisted-username, #assisted-email, #assisted-phone, #assisted-shared-phone, #assisted-verified"
  );

const recoveryDrafts = (page: Page) =>
  page.locator(
    'input[name="recovery-action"], input[name="identityCheck"], input[type="checkbox"][required]'
  );

const addStaffCookies = async (
  page: Page,
  staff: { context: APIRequestContext }
) => {
  const state = await staff.context.storageState();
  await page.context().addCookies(state.cookies);
};

// The reissue request never reaches the Worker on the first attempt. After a
// browser reload, the original actor/target/key is retained, verification must
// be repeated, and the explicit final submit retries that same operation.
test(
  "restored missing reissue rechecks verification and retries the original operation",
  {
    tag: tags("browser", ["@risk-recovery", "@risk-privacy"], true),
  },
  async ({ caseApp, staff, page }, testInfo) => {
    const input = creation();
    const createdResponse = await status(
      staff.context.post("/api/v2/staff/accounts", { data: input }),
      201
    );
    const created = issuedCredential(await staffData(createdResponse));
    const targetUserId = created.receipt?.targetUserId;
    if (!targetUserId) {
      throw new Error("Staff creation did not identify its target account");
    }
    await addStaffCookies(page, staff);

    const bodies: Record<string, unknown>[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().endsWith("/api/v2/staff/accounts/password-reissue")
      ) {
        expect(request.headers()["x-efcc-expected-actor-id"]).toBe(
          staff.userId
        );
        bodies.push(request.postDataJSON() as Record<string, unknown>);
      }
    });
    await page.route("**/api/v2/staff/accounts/password-reissue", (route) =>
      route.abort("failed")
    );
    await page.route("**/api/v2/staff/accounts/reconcile", (route) =>
      route.abort("failed")
    );
    await page.goto(
      `/staff/accounts?view=people&person=${targetUserId}&task=recovery`
    );
    const reissue = page.getByRole("radio", {
      name: /重新發出臨時密碼/u,
    });
    const verification = page.getByLabel("已按以上方式核實身分", {
      exact: false,
    });
    const finalSubmit = page.getByRole("button", {
      name: "確認並重新發出臨時密碼",
    });
    await reissue.check();
    await verification.check();
    await page.getByRole("button", { name: "檢查資料" }).click();
    await expect(finalSubmit).toBeEnabled();
    await qualifyPresentation(page, testInfo, "reissue-review", {
      criticalAction: finalSubmit,
      drafts: recoveryDrafts(page),
      focus: finalSubmit,
    });
    await finalSubmit.click();
    await expect(page.getByRole("status").first()).toContainText(
      "結果仍未確認"
    );
    expect(bodies).toHaveLength(1);
    const originalRaw = await page.evaluate(() =>
      localStorage.getItem("efcc.staff-account.operation.v1")
    );
    if (!originalRaw) {
      throw new Error("UNKNOWN reissue did not preserve its operation key");
    }
    const original = storedStaffAccountOperationSchema.parse(
      JSON.parse(originalRaw)
    );
    expect(original).toMatchObject({
      action: "temporary_password_reissued",
      actorUserId: staff.userId,
      identityCheck: "face_to_face",
      targetUserId,
    });
    expect(originalRaw).not.toContain(created.temporaryPassword);
    expect(bodies[0]).toEqual({
      identityCheck: "face_to_face",
      operationKey: original.key,
      targetUserId,
    });
    expect(
      await caseApp.db
        .prepare(
          "SELECT COUNT(*) AS count FROM staff_account_operation WHERE actor_user_id = ? AND operation_key = ?"
        )
        .bind(staff.userId, original.key)
        .first<{ count: number }>()
    ).toEqual({ count: 0 });

    await page.unroute("**/api/v2/staff/accounts/password-reissue");
    await page.unroute("**/api/v2/staff/accounts/reconcile");
    await page.reload();
    await expect(page.getByRole("status").first()).toContainText(
      "尚未找到完成紀錄"
    );
    await expect(verification).toBeVisible();
    await expect(verification).not.toBeChecked();
    await expect(reissue).toBeChecked();
    expect(
      await page.evaluate(() =>
        localStorage.getItem("efcc.staff-account.operation.v1")
      )
    ).toBe(originalRaw);
    expect(bodies).toHaveLength(1);
    await verification.check();
    await page.getByRole("button", { name: "檢查資料" }).click();
    expect(bodies).toHaveLength(1);
    await expect(finalSubmit).toBeEnabled();
    await qualifyPresentation(page, testInfo, "reissue-retry-review", {
      criticalAction: finalSubmit,
      drafts: recoveryDrafts(page),
      focus: finalSubmit,
    });
    const completed = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/v2/staff/accounts/password-reissue")
    );
    await finalSubmit.click();
    const response = await completed;
    expect(response.status()).toBe(201);
    const reissued = issuedCredential(await staffData(response));
    expect(reissued.receipt).toMatchObject({
      action: "temporary_password_reissued",
      targetUserId,
    });
    expect(bodies).toEqual([
      {
        identityCheck: "face_to_face",
        operationKey: original.key,
        targetUserId,
      },
      {
        identityCheck: "face_to_face",
        operationKey: original.key,
        targetUserId,
      },
    ]);
    expect(
      await caseApp.db
        .prepare(
          "SELECT temporary_password_expires_at FROM account WHERE user_id = ? AND account_id = user_id AND provider_id = 'credential'"
        )
        .bind(targetUserId)
        .first<{ temporary_password_expires_at: number }>()
    ).toEqual({
      temporary_password_expires_at: reissued.temporaryPasswordExpiresAt,
    });
    expect(
      await caseApp.db
        .prepare(
          "SELECT action, actor_user_id, operation_key, target_user_id FROM staff_account_operation WHERE actor_user_id = ? AND operation_key = ?"
        )
        .bind(staff.userId, original.key)
        .first()
    ).toEqual({
      action: "temporary_password_reissued",
      actor_user_id: staff.userId,
      operation_key: original.key,
      target_user_id: targetUserId,
    });
    expect(
      await caseApp.db
        .prepare(
          "SELECT COUNT(*) AS count FROM audit_event WHERE action = 'temporary_password_reissued' AND target_user_id = ?"
        )
        .bind(targetUserId)
        .first<{ count: number }>()
    ).toEqual({ count: 1 });
    const copy = page.getByRole("button", { name: "複製臨時密碼" });
    await expect(page.getByLabel("新臨時密碼", { exact: true })).toHaveText(
      reissued.temporaryPassword
    );
    await qualifyPresentation(page, testInfo, "reissue-handover", {
      criticalAction: copy,
      drafts: page.getByRole("checkbox"),
      focus: copy,
    });
    await page.reload();
    await expect(page.getByRole("status").first()).toContainText(
      "原臨時密碼不能再次讀取"
    );
    await expect(page.getByLabel("新臨時密碼", { exact: true })).toHaveCount(0);
  }
);

// This is the public native verifier control from N11, not another Worker
// process. A dedicated store owns each native password-verification race.
dedicatedCredentialTest(
  "paused old-password native username and name sign-ins cannot mint sessions across Staff recovery",
  {
    tag: tags("http", ["@risk-auth", "@risk-concurrency", "@risk-security"]),
  },
  async ({ caseApp, credential, extraHTTPHeaders, playwright, staff }) => {
    const context = await playwright.request.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders: {
        ...extraHTTPHeaders,
        "cf-connecting-ip": "198.19.77.31",
      },
    });
    try {
      for (const choice of ["username", "name"] as const) {
        const holder = syntheticAccount(`race-${choice}`);
        const targetUserId = await caseApp.provision.account(holder);
        const before = await credential.verified();
        await credential.arm();
        let pending: Promise<APIResponse> | undefined;
        try {
          pending = context.post(`/api/auth/sign-in/${choice}`, {
            data:
              choice === "username"
                ? { password: holder.password, username: holder.username }
                : { fullName: holder.fullName, password: holder.password },
          });
          await expect
            .poll(() => credential.verified())
            .toMatchObject({
              held: true,
              verified: before.verified + 1,
            });
          const resetInput: RecoveryInput = {
            identityCheck: "face_to_face",
            operationKey: randomUUID(),
            targetUserId,
          };
          const resetResponse = await status(
            staff.context.post("/api/v2/staff/accounts/password-reset", {
              data: resetInput,
            }),
            201
          );
          const reset = issuedCredential(await staffData(resetResponse));
          expect(reset.receipt).toMatchObject({
            action: "staff_password_reset",
            targetUserId,
          });
          const afterReset = await credentialRow(caseApp, targetUserId);
          expect(afterReset?.credential_revision).toBe(1);
          expect(afterReset?.temporary_password_expires_at).toBe(
            reset.temporaryPasswordExpiresAt
          );
          await credential.release();
          const staleSignIn = await pending;
          expect(staleSignIn.status()).toBe(401);
          expect(staleSignIn.headers()["set-cookie"]).toBeUndefined();
          expect(await staleSignIn.json()).toMatchObject({
            code: "INVALID_USERNAME_OR_PASSWORD",
          });
          expect(
            await caseApp.db
              .prepare(
                "SELECT COUNT(*) AS count FROM session WHERE user_id = ?"
              )
              .bind(targetUserId)
              .first<{ count: number }>()
          ).toEqual({ count: 0 });
          await status(
            context.post(`/api/auth/sign-in/${choice}`, {
              data:
                choice === "username"
                  ? { password: holder.password, username: holder.username }
                  : { fullName: holder.fullName, password: holder.password },
            }),
            401
          );
          await status(
            context.post(`/api/auth/sign-in/${choice}`, {
              data:
                choice === "username"
                  ? {
                      password: reset.temporaryPassword,
                      username: holder.username,
                    }
                  : {
                      fullName: holder.fullName,
                      password: reset.temporaryPassword,
                    },
            }),
            200
          );
          await status(context.get("/api/v2/me"), 403);
          const permanentPassword = `Synthetic-first-change-${choice}!`;
          await status(
            context.post("/api/v2/account/password", {
              data: {
                currentPassword: reset.temporaryPassword,
                newPassword: permanentPassword,
                operationKey: randomUUID(),
              },
            }),
            201
          );
          await status(context.get("/api/v2/me"), 200);
          await expect
            .poll(() => credential.verified())
            .toMatchObject({ completed: before.completed + 1 });
        } finally {
          await credential.release();
          if (pending) {
            await Promise.allSettled([pending]);
          }
        }
      }
      expect(
        await caseApp.db
          .prepare(
            "SELECT COUNT(*) AS count FROM session WHERE user_id IN (SELECT id FROM user WHERE username LIKE 'race-%')"
          )
          .first<{ count: number }>()
      ).toEqual({ count: 2 });
      expect(JSON.stringify(caseApp.server.getLogs())).not.toMatch(
        /Synthetic-assisted-password|Synthetic-first-change/iu
      );
    } finally {
      await credential.release();
      await context.dispose();
    }
  }
);

dedicatedTest(
  "concurrent matching recovery returns one issuance and never replays plaintext",
  {
    tag: tags("http", ["@risk-concurrency", "@risk-recovery", "@risk-privacy"]),
  },
  async ({ caseApp, extraHTTPHeaders, playwright, staff }) => {
    const holder = syntheticAccount("concurrent-recovery");
    const targetUserId = await caseApp.provision.account(holder);
    const input: RecoveryInput = {
      identityCheck: "face_to_face",
      operationKey: randomUUID(),
      targetUserId,
    };
    const responses = await Promise.all([
      staff.context.post("/api/v2/staff/accounts/password-reset", {
        data: input,
      }),
      staff.context.post("/api/v2/staff/accounts/password-reset", {
        data: input,
      }),
    ]);
    expect(responses.map((response) => response.status()).toSorted()).toEqual([
      200, 201,
    ]);
    const bodies = await Promise.all(
      responses.map((response) => staffData(response))
    );
    const originalIndex = responses.findIndex(
      (response) => response.status() === 201
    );
    const duplicateIndex = responses.findIndex(
      (response) => response.status() === 200
    );
    const original = issuedCredential(
      bodies[originalIndex] ?? { receipt: null }
    );
    const duplicate = bodies[duplicateIndex];
    if (!duplicate?.receipt) {
      throw new Error("Matching recovery did not return its original receipt");
    }
    expect(duplicate).toEqual({ receipt: original.receipt });
    expect(bodies[0]?.receipt).toEqual(bodies[1]?.receipt);
    expect(
      await caseApp.db
        .prepare(
          "SELECT temporary_password_expires_at FROM account WHERE user_id = ? AND account_id = user_id AND provider_id = 'credential'"
        )
        .bind(targetUserId)
        .first<{ temporary_password_expires_at: number }>()
    ).toEqual({
      temporary_password_expires_at: original.temporaryPasswordExpiresAt,
    });
    expect(
      await caseApp.db
        .prepare(
          "SELECT (SELECT COUNT(*) FROM audit_event WHERE action = 'staff_password_reset' AND target_user_id = ?) AS audits, (SELECT COUNT(*) FROM staff_account_operation WHERE actor_user_id = ? AND operation_key = ? AND target_user_id = ?) AS receipts"
        )
        .bind(targetUserId, staff.userId, input.operationKey, targetUserId)
        .first<{ audits: number; receipts: number }>()
    ).toEqual({ audits: 1, receipts: 1 });

    const otherTarget = syntheticAccount("wrong-recovery-target");
    const otherTargetId = await caseApp.provision.account(otherTarget);
    const wrongTarget = await status(
      staff.context.post("/api/v2/staff/accounts/password-reset", {
        data: { ...input, targetUserId: otherTargetId },
      }),
      409
    );
    expect(await errorCode(wrongTarget)).toBe("conflict");
    expect(await credentialRow(caseApp, otherTargetId)).toMatchObject({
      credential_revision: 0,
      temporary_password_expires_at: null,
    });
    const reconciled = await status(
      staff.context.post("/api/v2/staff/accounts/reconcile", {
        data: { operationKey: input.operationKey },
      }),
      200
    );
    expect((await staffData(reconciled)).receipt).toEqual(original.receipt);
    const outsider = syntheticAccount("recovery-outsider");
    await caseApp.provision.account(outsider);
    const outsiderContext = await playwright.request.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders: {
        ...extraHTTPHeaders,
        "cf-connecting-ip": "198.19.77.32",
      },
    });
    try {
      await status(
        outsiderContext.post("/api/auth/sign-in/username", {
          data: { password: outsider.password, username: outsider.username },
        }),
        200
      );
      const privateReceipt = await status(
        outsiderContext.post("/api/v2/staff/accounts/reconcile", {
          data: { operationKey: input.operationKey },
        }),
        403
      );
      expect(await errorCode(privateReceipt)).toBe("business_access_denied");
    } finally {
      await outsiderContext.dispose();
    }
  }
);

dedicatedTest(
  "actor and target bind creation, reset, reissue and private reconciliation keys",
  {
    tag: tags("http", [
      "@risk-authorization",
      "@risk-recovery",
      "@risk-privacy",
    ]),
  },
  async ({ caseApp, extraHTTPHeaders, playwright, staff }) => {
    const secondStaffAccount = syntheticAccount("second-staff-actor", "staff");
    const secondStaffId = await caseApp.provision.account(secondStaffAccount);
    const secondStaff = await playwright.request.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders: {
        ...extraHTTPHeaders,
        "cf-connecting-ip": "198.19.77.33",
      },
    });
    try {
      await status(
        secondStaff.post("/api/auth/sign-in/username", {
          data: {
            password: secondStaffAccount.password,
            username: secondStaffAccount.username,
          },
        }),
        200
      );
      await status(
        secondStaff.post("/api/v2/account/password-confirmation", {
          data: {
            operationKey: randomUUID(),
            password: secondStaffAccount.password,
          },
        }),
        201
      );

      const creationKey = randomUUID();
      const firstCreation = { ...creation(), operationKey: creationKey };
      const secondCreation = { ...creation(), operationKey: creationKey };
      const firstCreated = issuedCredential(
        await staffData(
          await status(
            staff.context.post("/api/v2/staff/accounts", {
              data: firstCreation,
            }),
            201
          )
        )
      );
      const secondCreated = issuedCredential(
        await staffData(
          await status(
            secondStaff.post("/api/v2/staff/accounts", {
              data: secondCreation,
            }),
            201
          )
        )
      );
      expect(firstCreated.receipt?.targetUserId).not.toBe(
        secondCreated.receipt?.targetUserId
      );
      const firstReplay = await status(
        staff.context.post("/api/v2/staff/accounts", { data: firstCreation }),
        200
      );
      expect(await staffData(firstReplay)).toEqual({
        receipt: firstCreated.receipt,
      });
      const changedCreation = await status(
        staff.context.post("/api/v2/staff/accounts", {
          data: {
            ...firstCreation,
            username: `changed.${randomBytes(5).toString("hex")}`,
          },
        }),
        409
      );
      expect(await errorCode(changedCreation)).toBe("conflict");
      expect(
        await caseApp.db
          .prepare(
            "SELECT COUNT(*) AS count FROM staff_account_operation WHERE operation_key = ?"
          )
          .bind(creationKey)
          .first<{ count: number }>()
      ).toEqual({ count: 2 });

      const firstTarget = firstCreated.receipt?.targetUserId;
      const secondTarget = secondCreated.receipt?.targetUserId;
      if (!(firstTarget && secondTarget)) {
        throw new Error("Creation receipts did not retain both targets");
      }
      const resetKey = randomUUID();
      const firstResetInput: RecoveryInput = {
        identityCheck: "face_to_face",
        operationKey: resetKey,
        targetUserId: firstTarget,
      };
      const secondResetInput = {
        ...firstResetInput,
        targetUserId: secondTarget,
      };
      const firstReset = issuedCredential(
        await staffData(
          await status(
            staff.context.post("/api/v2/staff/accounts/password-reset", {
              data: firstResetInput,
            }),
            201
          )
        )
      );
      const secondReset = issuedCredential(
        await staffData(
          await status(
            secondStaff.post("/api/v2/staff/accounts/password-reset", {
              data: secondResetInput,
            }),
            201
          )
        )
      );
      expect(firstReset.receipt?.targetUserId).toBe(firstTarget);
      expect(secondReset.receipt?.targetUserId).toBe(secondTarget);
      expect(
        await staffData(
          await status(
            staff.context.post("/api/v2/staff/accounts/password-reset", {
              data: firstResetInput,
            }),
            200
          )
        )
      ).toEqual({ receipt: firstReset.receipt });
      const wrongResetTarget = await status(
        staff.context.post("/api/v2/staff/accounts/password-reset", {
          data: secondResetInput,
        }),
        409
      );
      expect(await errorCode(wrongResetTarget)).toBe("conflict");
      expect(
        await caseApp.db
          .prepare(
            "SELECT COUNT(*) AS count FROM staff_account_operation WHERE operation_key = ? AND action = 'staff_password_reset'"
          )
          .bind(resetKey)
          .first<{ count: number }>()
      ).toEqual({ count: 2 });

      const reissueKey = randomUUID();
      const firstReissueInput: RecoveryInput = {
        identityCheck: "face_to_face",
        operationKey: reissueKey,
        targetUserId: firstTarget,
      };
      const secondReissueInput = {
        ...firstReissueInput,
        targetUserId: secondTarget,
      };
      const firstReissue = issuedCredential(
        await staffData(
          await status(
            staff.context.post("/api/v2/staff/accounts/password-reissue", {
              data: firstReissueInput,
            }),
            201
          )
        )
      );
      const secondReissue = issuedCredential(
        await staffData(
          await status(
            secondStaff.post("/api/v2/staff/accounts/password-reissue", {
              data: secondReissueInput,
            }),
            201
          )
        )
      );
      expect(secondReissue.receipt).toMatchObject({
        action: "temporary_password_reissued",
        targetUserId: secondTarget,
      });
      expect(
        await staffData(
          await status(
            staff.context.post("/api/v2/staff/accounts/password-reissue", {
              data: firstReissueInput,
            }),
            200
          )
        )
      ).toEqual({ receipt: firstReissue.receipt });
      const wrongReissueTarget = await status(
        staff.context.post("/api/v2/staff/accounts/password-reissue", {
          data: secondReissueInput,
        }),
        409
      );
      expect(await errorCode(wrongReissueTarget)).toBe("conflict");
      expect(
        await caseApp.db
          .prepare(
            "SELECT COUNT(*) AS count FROM staff_account_operation WHERE operation_key = ? AND action = 'temporary_password_reissued'"
          )
          .bind(reissueKey)
          .first<{ count: number }>()
      ).toEqual({ count: 2 });

      const firstReconciled = await status(
        staff.context.post("/api/v2/staff/accounts/reconcile", {
          data: { operationKey: resetKey },
        }),
        200
      );
      expect((await staffData(firstReconciled)).receipt).toEqual(
        firstReset.receipt
      );
      const secondReconciled = await status(
        secondStaff.post("/api/v2/staff/accounts/reconcile", {
          data: { operationKey: resetKey },
        }),
        200
      );
      expect((await staffData(secondReconciled)).receipt).toEqual(
        secondReset.receipt
      );
      const privateKey = randomUUID();
      const privateResetInput = {
        identityCheck: "face_to_face" as const,
        operationKey: privateKey,
        targetUserId: secondTarget,
      };
      const privateReset = issuedCredential(
        await staffData(
          await status(
            secondStaff.post("/api/v2/staff/accounts/password-reset", {
              data: privateResetInput,
            }),
            201
          )
        )
      );
      const deniedReconciliation = await status(
        staff.context.post("/api/v2/staff/accounts/reconcile", {
          data: { operationKey: privateKey },
        }),
        200
      );
      expect((await staffData(deniedReconciliation)).receipt).toBeNull();
      const ownerReconciliation = await status(
        secondStaff.post("/api/v2/staff/accounts/reconcile", {
          data: { operationKey: privateKey },
        }),
        200
      );
      expect((await staffData(ownerReconciliation)).receipt).toEqual(
        privateReset.receipt
      );

      for (const [actorUserId, key, targetUserId, action] of [
        [staff.userId, creationKey, firstTarget, "assisted_account_created"],
        [secondStaffId, creationKey, secondTarget, "assisted_account_created"],
        [staff.userId, resetKey, firstTarget, "staff_password_reset"],
        [secondStaffId, resetKey, secondTarget, "staff_password_reset"],
        [staff.userId, reissueKey, firstTarget, "temporary_password_reissued"],
        [
          secondStaffId,
          reissueKey,
          secondTarget,
          "temporary_password_reissued",
        ],
      ] as const) {
        expect(
          await caseApp.db
            .prepare(
              "SELECT action, actor_user_id, operation_key, target_user_id FROM staff_account_operation WHERE actor_user_id = ? AND operation_key = ?"
            )
            .bind(actorUserId, key)
            .first()
        ).toEqual({
          action,
          actor_user_id: actorUserId,
          operation_key: key,
          target_user_id: targetUserId,
        });
      }
    } finally {
      await secondStaff.dispose();
    }
  }
);

dedicatedTest(
  "new Staff commands retain exact-origin checks and independent action limits",
  {
    tag: tags("http", ["@risk-auth", "@risk-resilience", "@risk-security"]),
  },
  async ({ staff }) => {
    for (const endpoint of [
      "/api/v2/staff/accounts",
      "/api/v2/staff/accounts/password-reset",
      "/api/v2/staff/accounts/password-reissue",
      "/api/v2/staff/accounts/reconcile",
    ]) {
      await status(
        staff.context.post(endpoint, {
          data: {},
          headers: { origin: "https://foreign.example" },
        }),
        403
      );
      for (let index = 0; index < 10; index += 1) {
        await status(staff.context.post(endpoint, { data: {} }), 400);
      }
      await status(staff.context.post(endpoint, { data: {} }), 429);
    }
    const listing = await status(
      staff.context.get("/api/v2/staff/accounts"),
      200
    );
    expect(listing.headers()["cache-control"]).toContain("no-store");
  }
);

for (const table of ["account", "person_profile", "audit_event"] as const) {
  for (const fault of ["ABORT", "IGNORE"] as const) {
    dedicatedTest(
      `assisted creation ${table} ${fault} leaves no partial canonical account and retries the original operation`,
      {
        tag: tags("http", ["@risk-atomicity", "@risk-recovery"]),
      },
      async ({ caseApp, staff }) => {
        const input = creation();
        const trigger = `synthetic_assisted_${table}_${fault}_${randomBytes(5).toString("hex")}`;
        const field = table === "audit_event" ? "target_user_id" : "user_id";
        const raiser =
          fault === "ABORT"
            ? "RAISE(ABORT, 'Synthetic assisted write failure')"
            : "RAISE(IGNORE)";
        await caseApp.db
          .prepare(
            `CREATE TRIGGER ${trigger} BEFORE INSERT ON ${table} WHEN NEW.${field} = (SELECT id FROM user WHERE username = '${input.username}') BEGIN SELECT ${raiser}; END`
          )
          .run();
        try {
          const failed = await status(
            staff.context.post("/api/v2/staff/accounts", { data: input }),
            500
          );
          expect(await errorCode(failed)).toBe("internal_error");
          expect(await creationEffects(caseApp, input.username, null)).toEqual({
            audits: 0,
            credentials: 0,
            plaintext: 0,
            profiles: 0,
            receipts: 0,
            reservations: 0,
            users: 0,
          });
          const unknown = await status(
            staff.context.post("/api/v2/staff/accounts/reconcile", {
              data: { operationKey: input.operationKey },
            }),
            200
          );
          expect((await staffData(unknown)).receipt).toBeNull();
        } finally {
          await caseApp.db.prepare(`DROP TRIGGER ${trigger}`).run();
        }

        const retry = issuedCredential(
          await staffData(
            await status(
              staff.context.post("/api/v2/staff/accounts", { data: input }),
              201
            )
          )
        );
        expect(retry.receipt?.action).toBe("assisted_account_created");
        const targetUserId = retry.receipt?.targetUserId;
        if (!targetUserId) {
          throw new Error("Retried creation did not retain its target");
        }
        expect(
          await creationEffects(
            caseApp,
            input.username,
            retry.temporaryPassword
          )
        ).toEqual({
          audits: 1,
          credentials: 1,
          plaintext: 0,
          profiles: 1,
          receipts: 1,
          reservations: 1,
          users: 1,
        });
        expect(
          await caseApp.db
            .prepare(
              "SELECT action, actor_user_id, operation_key, target_user_id FROM staff_account_operation WHERE actor_user_id = ? AND operation_key = ?"
            )
            .bind(staff.userId, input.operationKey)
            .first()
        ).toEqual({
          action: "assisted_account_created",
          actor_user_id: staff.userId,
          operation_key: input.operationKey,
          target_user_id: targetUserId,
        });
      }
    );
  }
}

for (const table of [
  "account",
  "audit_event",
  "session",
  "staff_account_operation",
] as const) {
  for (const fault of ["ABORT", "IGNORE"] as const) {
    dedicatedTest(
      `recovery ${table} ${fault} rolls back credentials, temporary state, sessions and audit before same-key retry`,
      {
        tag: tags("http", [
          "@risk-atomicity",
          "@risk-recovery",
          "@risk-security",
        ]),
      },
      async ({ caseApp, extraHTTPHeaders, playwright, staff }) => {
        const holder = syntheticAccount(`recovery-${table}-${fault}`);
        const targetUserId = await caseApp.provision.account(holder);
        const person = await playwright.request.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders: {
            ...extraHTTPHeaders,
            "cf-connecting-ip": "198.19.77.41",
          },
        });
        try {
          await status(
            person.post("/api/auth/sign-in/username", {
              data: { password: holder.password, username: holder.username },
            }),
            200
          );
          const before = await credentialRow(caseApp, targetUserId);
          if (!before) {
            throw new Error("Recovery target credential was not provisioned");
          }
          const trigger = `synthetic_recovery_${table}_${fault}_${randomBytes(5).toString("hex")}`;
          const event = {
            account: "UPDATE",
            audit_event: "INSERT",
            session: "DELETE",
            staff_account_operation: "INSERT",
          }[table];
          const field =
            table === "audit_event" || table === "staff_account_operation"
              ? "target_user_id"
              : "user_id";
          const row = event === "DELETE" ? "OLD" : "NEW";
          const raiser =
            fault === "ABORT"
              ? "RAISE(ABORT, 'Synthetic recovery failure')"
              : "RAISE(IGNORE)";
          await caseApp.db
            .prepare(
              `CREATE TRIGGER ${trigger} BEFORE ${event} ON ${table} WHEN ${row}.${field} = '${targetUserId}' BEGIN SELECT ${raiser}; END`
            )
            .run();
          const input: RecoveryInput = {
            identityCheck: "face_to_face",
            operationKey: randomUUID(),
            targetUserId,
          };
          try {
            const failed = await status(
              staff.context.post("/api/v2/staff/accounts/password-reset", {
                data: input,
              }),
              500
            );
            expect(await errorCode(failed)).toBe("internal_error");
            expect(await credentialRow(caseApp, targetUserId)).toEqual(before);
            const survivingSessions = await caseApp.db
              .prepare("SELECT id FROM session WHERE user_id = ?")
              .bind(targetUserId)
              .all<{ id: string }>();
            expect(survivingSessions.results).toHaveLength(1);
            await status(person.get("/api/v2/me"), 200);
            expect(
              await caseApp.db
                .prepare(
                  "SELECT COUNT(*) AS count FROM audit_event WHERE target_user_id = ? AND action = 'staff_password_reset'"
                )
                .bind(targetUserId)
                .first<{ count: number }>()
            ).toEqual({ count: 0 });
            expect(
              await caseApp.db
                .prepare(
                  "SELECT COUNT(*) AS count FROM staff_account_operation WHERE actor_user_id = ? AND operation_key = ?"
                )
                .bind(staff.userId, input.operationKey)
                .first<{ count: number }>()
            ).toEqual({ count: 0 });
            const unknown = await status(
              staff.context.post("/api/v2/staff/accounts/reconcile", {
                data: { operationKey: input.operationKey },
              }),
              200
            );
            expect((await staffData(unknown)).receipt).toBeNull();
          } finally {
            await caseApp.db.prepare(`DROP TRIGGER ${trigger}`).run();
          }

          const retry = issuedCredential(
            await staffData(
              await status(
                staff.context.post("/api/v2/staff/accounts/password-reset", {
                  data: input,
                }),
                201
              )
            )
          );
          expect(retry.receipt).toMatchObject({
            action: "staff_password_reset",
            targetUserId,
          });
          expect(await credentialRow(caseApp, targetUserId)).toMatchObject({
            credential_revision: before.credential_revision + 1,
            temporary_password_expires_at: retry.temporaryPasswordExpiresAt,
          });
          expect(
            await caseApp.db
              .prepare(
                "SELECT COUNT(*) AS count FROM session WHERE user_id = ?"
              )
              .bind(targetUserId)
              .first<{ count: number }>()
          ).toEqual({ count: 0 });
          const oldPassword = await playwright.request.newContext({
            baseURL: caseApp.origin,
            extraHTTPHeaders: {
              ...extraHTTPHeaders,
              "cf-connecting-ip": "198.19.77.42",
            },
          });
          try {
            await status(
              oldPassword.post("/api/auth/sign-in/username", {
                data: { password: holder.password, username: holder.username },
              }),
              401
            );
            await status(
              oldPassword.post("/api/auth/sign-in/username", {
                data: {
                  password: retry.temporaryPassword,
                  username: holder.username,
                },
              }),
              200
            );
            const firstUse = await status(oldPassword.get("/api/v2/me"), 403);
            expect(await firstUse.json()).toMatchObject({
              error: { code: "password_change_required" },
            });
          } finally {
            await oldPassword.dispose();
          }
          expect(
            await caseApp.db
              .prepare(
                "SELECT (SELECT COUNT(*) FROM audit_event WHERE target_user_id = ? AND action = 'staff_password_reset') AS audits, (SELECT COUNT(*) FROM staff_account_operation WHERE actor_user_id = ? AND operation_key = ? AND target_user_id = ?) AS receipts"
              )
              .bind(
                targetUserId,
                staff.userId,
                input.operationKey,
                targetUserId
              )
              .first<{ audits: number; receipts: number }>()
          ).toEqual({ audits: 1, receipts: 1 });
        } finally {
          await person.dispose();
        }
      }
    );
  }
}

dedicatedTest(
  "fresh confirmation, protected Staff targets and current authority cannot be bypassed",
  {
    tag: tags("http", ["@risk-authorization", "@risk-auth", "@risk-security"]),
  },
  async ({ caseApp, staff }) => {
    const staffTarget = syntheticAccount("staff-target", "staff");
    const adminTarget = syntheticAccount("admin-target", "admin");
    const memberTarget = syntheticAccount("member-target");
    const staffTargetId = await caseApp.provision.account(staffTarget);
    const adminTargetId = await caseApp.provision.account(adminTarget);
    const memberTargetId = await caseApp.provision.account(memberTarget);

    for (const targetUserId of [staff.userId, staffTargetId, adminTargetId]) {
      const denied = await status(
        staff.context.post("/api/v2/staff/accounts/password-reset", {
          data: {
            identityCheck: "face_to_face",
            operationKey: randomUUID(),
            targetUserId,
          },
        }),
        403
      );
      expect(await errorCode(denied)).toBe("business_access_denied");
    }

    await caseApp.db
      .prepare(
        "UPDATE session SET password_confirmed_at = CAST(strftime('%s', 'now') AS INTEGER) - 601 WHERE user_id = ?"
      )
      .bind(staff.userId)
      .run();
    await status(
      staff.context.post("/api/v2/staff/accounts", { data: creation() }),
      403
    );
    await status(
      staff.context.post("/api/v2/staff/accounts/password-reset", {
        data: {
          identityCheck: "face_to_face",
          operationKey: randomUUID(),
          targetUserId: memberTargetId,
        },
      }),
      403
    );
    await status(
      staff.context.post("/api/v2/account/password-confirmation", {
        data: {
          operationKey: randomUUID(),
          password: "Wrong-assisted-staff-password!",
        },
      }),
      400
    );
    await status(
      staff.context.post("/api/v2/staff/accounts/password-reset", {
        data: {
          identityCheck: "face_to_face",
          operationKey: randomUUID(),
          targetUserId: memberTargetId,
        },
      }),
      403
    );
    await status(
      staff.context.post("/api/v2/account/password-confirmation", {
        data: {
          operationKey: randomUUID(),
          password: staff.account.password,
        },
      }),
      201
    );

    const verifiedPhone = `+852${creation().phone}`;
    await caseApp.db
      .prepare(
        "UPDATE person_profile SET phone = ?, verified_recovery_phone = ? WHERE user_id = ?"
      )
      .bind(verifiedPhone, verifiedPhone, memberTargetId)
      .run();
    const verified = issuedCredential(
      await staffData(
        await status(
          staff.context.post("/api/v2/staff/accounts/password-reset", {
            data: {
              identityCheck: "verified_phone",
              operationKey: randomUUID(),
              targetUserId: memberTargetId,
            },
          }),
          201
        )
      )
    );
    expect(verified.receipt?.targetUserId).toBe(memberTargetId);

    await caseApp.db
      .prepare(
        "UPDATE person_profile SET account_role = 'member' WHERE user_id = ?"
      )
      .bind(staff.userId)
      .run();
    const revoked = await status(
      staff.context.post("/api/v2/staff/accounts/password-reset", {
        data: {
          identityCheck: "face_to_face",
          operationKey: randomUUID(),
          targetUserId: memberTargetId,
        },
      }),
      403
    );
    expect(await errorCode(revoked)).toBe("business_access_denied");
    expect(await credentialRow(caseApp, memberTargetId)).toMatchObject({
      credential_revision: 1,
    });
    expect(
      await caseApp.db
        .prepare(
          "SELECT COUNT(*) AS count FROM staff_account_operation WHERE actor_user_id = ? AND action = 'staff_password_reset' AND target_user_id = ?"
        )
        .bind(staff.userId, memberTargetId)
        .first<{ count: number }>()
    ).toEqual({ count: 1 });
  }
);

test(
  "face-to-face shared phone exception does not weaken public phone uniqueness",
  { tag: tags("http", ["@risk-authorization", "@risk-privacy"]) },
  async ({ caseApp, extraHTTPHeaders, playwright, staff }) => {
    const first = creation();
    const second = { ...creation(), phone: first.phone, sharedPhone: true };
    await status(
      staff.context.post("/api/v2/staff/accounts", { data: first }),
      201
    );
    const unverifiedException = await status(
      staff.context.post("/api/v2/staff/accounts", {
        data: { ...second, sharedPhone: false },
      }),
      409
    );
    expect(await errorCode(unverifiedException)).toBe("conflict");
    await status(
      staff.context.post("/api/v2/staff/accounts", { data: second }),
      201
    );

    const publicRequest = await playwright.request.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders: {
        ...extraHTTPHeaders,
        "cf-connecting-ip": "198.19.77.51",
      },
    });
    try {
      const publicApplicant = creation();
      const rejected = await status(
        publicRequest.post("/api/v2/applications", {
          data: {
            email: `phone.${randomBytes(6).toString("hex")}@example.test`,
            fullName: publicApplicant.fullName,
            operationKey: randomBytes(32).toString("hex"),
            password: "Synthetic-public-applicant-password!",
            phone: first.phone,
            username: publicApplicant.username,
          },
        }),
        409
      );
      expect(await rejected.json()).toMatchObject({
        error: { code: "conflict" },
      });
    } finally {
      await publicRequest.dispose();
    }
  }
);

dedicatedTest(
  "sibling self-application and decision receipts roll back ignored final writes",
  {
    tag: tags("http", ["@risk-atomicity", "@risk-recovery"]),
  },
  async ({ caseApp, extraHTTPHeaders, playwright, staff }) => {
    const input = creation();
    const applicant = {
      email: `guard.${randomBytes(6).toString("hex")}@example.test`,
      fullName: input.fullName,
      operationKey: randomBytes(32).toString("hex"),
      password: "Synthetic-receipt-guard!",
      phone: input.phone,
      username: input.username,
    };
    const publicRequest = await playwright.request.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders: {
        ...extraHTTPHeaders,
        "cf-connecting-ip": "198.19.77.52",
      },
    });
    try {
      const snapshot = await caseApp.db
        .prepare(`SELECT
        (SELECT COUNT(*) FROM user) AS users,
        (SELECT COUNT(*) FROM account) AS accounts,
        (SELECT COUNT(*) FROM person_profile) AS profiles,
        (SELECT COUNT(*) FROM username_reservation) AS reservations,
        (SELECT COUNT(*) FROM audit_event) AS audits,
        (SELECT COUNT(*) FROM membership_application) AS applications`)
        .first<Record<string, number>>();
      const applicationTrigger = `synthetic_application_receipt_${randomBytes(5).toString("hex")}`;
      await caseApp.db
        .prepare(
          `CREATE TRIGGER ${applicationTrigger} BEFORE INSERT ON membership_application WHEN NEW.user_id = (SELECT id FROM user WHERE username = '${applicant.username}') BEGIN SELECT RAISE(IGNORE); END`
        )
        .run();
      try {
        await status(
          publicRequest.post("/api/v2/applications", { data: applicant }),
          500
        );
        expect(
          await caseApp.db
            .prepare(`SELECT
            (SELECT COUNT(*) FROM user) AS users,
            (SELECT COUNT(*) FROM account) AS accounts,
            (SELECT COUNT(*) FROM person_profile) AS profiles,
            (SELECT COUNT(*) FROM username_reservation) AS reservations,
            (SELECT COUNT(*) FROM audit_event) AS audits,
            (SELECT COUNT(*) FROM membership_application) AS applications`)
            .first<Record<string, number>>()
        ).toEqual(snapshot);
      } finally {
        await caseApp.db.prepare(`DROP TRIGGER ${applicationTrigger}`).run();
      }
      await status(
        publicRequest.post("/api/v2/applications", { data: applicant }),
        201
      );
      const applicantId = await accountId(caseApp, applicant.username);
      const application = await caseApp.db
        .prepare("SELECT id FROM membership_application WHERE user_id = ?")
        .bind(applicantId)
        .first<{ id: string }>();
      if (!application) {
        throw new Error("The public application did not persist after retry");
      }
      const decisionKey = randomUUID();
      const decisionTrigger = `synthetic_decision_receipt_${randomBytes(5).toString("hex")}`;
      await caseApp.db
        .prepare(
          `CREATE TRIGGER ${decisionTrigger} BEFORE INSERT ON application_decision WHEN NEW.operation_key = '${decisionKey}' BEGIN SELECT RAISE(IGNORE); END`
        )
        .run();
      const decision = {
        applicationId: application.id,
        operationKey: decisionKey,
        outcome: "approved",
      } as const;
      try {
        await status(
          staff.context.post("/api/v2/staff/application-decisions", {
            data: decision,
          }),
          500
        );
        expect(
          await caseApp.db
            .prepare(`SELECT application.status, person_profile.membership_status,
            (SELECT COUNT(*) FROM audit_event WHERE target_user_id = ? AND action = 'application_approved') AS audits
          FROM membership_application AS application
          JOIN person_profile ON person_profile.user_id = application.user_id
          WHERE application.id = ?`)
            .bind(applicantId, application.id)
            .first()
        ).toEqual({
          audits: 0,
          membership_status: "pending",
          status: "pending",
        });
      } finally {
        await caseApp.db.prepare(`DROP TRIGGER ${decisionTrigger}`).run();
      }
      await status(
        staff.context.post("/api/v2/staff/application-decisions", {
          data: decision,
        }),
        201
      );
    } finally {
      await publicRequest.dispose();
    }
  }
);

dedicatedTest(
  "ignored own-security receipt leaves the current password and session intact",
  {
    tag: tags("http", ["@risk-atomicity", "@risk-security"]),
  },
  async ({ caseApp, staff }) => {
    const key = randomUUID();
    const trigger = `synthetic_own_receipt_${randomBytes(5).toString("hex")}`;
    await caseApp.db
      .prepare(
        `CREATE TRIGGER ${trigger} BEFORE INSERT ON account_security_operation WHEN NEW.operation_key = '${key}' BEGIN SELECT RAISE(IGNORE); END`
      )
      .run();
    const input = {
      currentPassword: staff.account.password,
      newPassword: "Synthetic-new-own-password!",
      operationKey: key,
    };
    try {
      const before = await caseApp.db
        .prepare(
          "SELECT password, credential_revision FROM account WHERE user_id = ? AND account_id = user_id AND provider_id = 'credential'"
        )
        .bind(staff.userId)
        .first<{ credential_revision: number; password: string }>();
      await status(
        staff.context.post("/api/v2/account/password", { data: input }),
        500
      );
      expect(
        await caseApp.db
          .prepare(
            "SELECT password, credential_revision FROM account WHERE user_id = ? AND account_id = user_id AND provider_id = 'credential'"
          )
          .bind(staff.userId)
          .first()
      ).toEqual(before);
      await status(staff.context.get("/api/v2/me"), 200);
      expect(
        await caseApp.db
          .prepare(
            "SELECT COUNT(*) AS count FROM account_security_operation WHERE user_id = ? AND operation_key = ?"
          )
          .bind(staff.userId, key)
          .first<{ count: number }>()
      ).toEqual({ count: 0 });
    } finally {
      await caseApp.db.prepare(`DROP TRIGGER ${trigger}`).run();
    }
    await status(
      staff.context.post("/api/v2/account/password", { data: input }),
      201
    );
    await status(staff.context.get("/api/v2/me"), 200);
  }
);

dedicatedTest(
  "an ignored final Staff receipt cannot leave an orphan account, audit or credential",
  {
    tag: tags("http", ["@risk-atomicity", "@risk-recovery", "@risk-privacy"]),
  },
  async ({ caseApp, staff }) => {
    const input = creation();
    const trigger = `synthetic_staff_receipt_${randomBytes(5).toString("hex")}`;
    await caseApp.db
      .prepare(
        `CREATE TRIGGER ${trigger} BEFORE INSERT ON staff_account_operation WHEN NEW.operation_key = '${input.operationKey}' BEGIN SELECT RAISE(IGNORE); END`
      )
      .run();
    try {
      const failed = await status(
        staff.context.post("/api/v2/staff/accounts", { data: input }),
        500
      );
      expect(await errorCode(failed)).toBe("internal_error");
      expect(await creationEffects(caseApp, input.username, null)).toEqual({
        audits: 0,
        credentials: 0,
        plaintext: 0,
        profiles: 0,
        receipts: 0,
        reservations: 0,
        users: 0,
      });
    } finally {
      await caseApp.db.prepare(`DROP TRIGGER ${trigger}`).run();
    }
    const retry = issuedCredential(
      await staffData(
        await status(
          staff.context.post("/api/v2/staff/accounts", { data: input }),
          201
        )
      )
    );
    expect(
      await creationEffects(caseApp, input.username, retry.temporaryPassword)
    ).toEqual({
      audits: 1,
      credentials: 1,
      plaintext: 0,
      profiles: 1,
      receipts: 1,
      reservations: 1,
      users: 1,
    });
  }
);

test(
  "Staff recovery requires established identity evidence and revokes existing native credentials and sessions",
  {
    tag: tags("http", ["@risk-auth", "@risk-security", "@risk-privacy"]),
  },
  async ({ caseApp, extraHTTPHeaders, playwright, staff }) => {
    const holder = syntheticAccount("verified-recovery");
    const targetUserId = await caseApp.provision.account(holder);
    const person = await playwright.request.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders: {
        ...extraHTTPHeaders,
        "cf-connecting-ip": "198.19.77.61",
      },
    });
    try {
      await status(
        person.post("/api/auth/sign-in/username", {
          data: { password: holder.password, username: holder.username },
        }),
        200
      );
      const input: RecoveryInput = {
        identityCheck: "face_to_face",
        operationKey: randomUUID(),
        targetUserId,
      };
      const reset = issuedCredential(
        await staffData(
          await status(
            staff.context.post("/api/v2/staff/accounts/password-reset", {
              data: input,
            }),
            201
          )
        )
      );
      expect(reset.temporaryPassword).toHaveLength(32);
      expect(reset.receipt?.action).toBe("staff_password_reset");
      expect(await credentialRow(caseApp, targetUserId)).toMatchObject({
        credential_revision: 1,
        temporary_password_expires_at: reset.temporaryPasswordExpiresAt,
      });
      await status(person.get("/api/v2/me"), 401);
      await status(
        person.post("/api/auth/sign-in/username", {
          data: { password: holder.password, username: holder.username },
        }),
        401
      );
      await status(
        person.post("/api/auth/sign-in/username", {
          data: {
            password: reset.temporaryPassword,
            username: holder.username,
          },
        }),
        200
      );
      const firstUse = await status(person.get("/api/v2/me"), 403);
      expect(await firstUse.json()).toMatchObject({
        error: { code: "password_change_required" },
      });
      const unverifiedPhone = await status(
        staff.context.post("/api/v2/staff/accounts/password-reset", {
          data: {
            identityCheck: "verified_phone",
            operationKey: randomUUID(),
            targetUserId,
          },
        }),
        403
      );
      expect(await errorCode(unverifiedPhone)).toBe(
        "identity_verification_required"
      );
      await status(
        staff.context.post("/api/v2/staff/accounts/password-reset", {
          data: {
            identityCheck: "verified_phone",
            operationKey: randomUUID(),
            phone: "+85269999999",
            targetUserId,
          },
        }),
        400
      );
      const replay = await status(
        staff.context.post("/api/v2/staff/accounts/password-reset", {
          data: input,
        }),
        200
      );
      expect(await staffData(replay)).toEqual({ receipt: reset.receipt });
      expect(
        await caseApp.db
          .prepare(
            "SELECT COUNT(*) AS count FROM audit_event WHERE action = 'staff_password_reset' AND target_user_id = ?"
          )
          .bind(targetUserId)
          .first<{ count: number }>()
      ).toEqual({ count: 1 });
    } finally {
      await person.dispose();
    }
  }
);

test(
  "expired temporary credentials require private reissue and first change preserves ban and deactivation",
  {
    tag: tags("http", ["@risk-auth", "@risk-security", "@risk-recovery"]),
  },
  async ({ caseApp, extraHTTPHeaders, playwright, staff }) => {
    const input = creation();
    const original = issuedCredential(
      await staffData(
        await status(
          staff.context.post("/api/v2/staff/accounts", { data: input }),
          201
        )
      )
    );
    const targetUserId = original.receipt?.targetUserId;
    if (!targetUserId) {
      throw new Error("Assisted creation did not identify its target");
    }
    expect(await credentialRow(caseApp, targetUserId)).toMatchObject({
      temporary_password_expires_at: original.temporaryPasswordExpiresAt,
    });
    const person = await playwright.request.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders: {
        ...extraHTTPHeaders,
        "cf-connecting-ip": "198.19.77.62",
      },
    });
    try {
      await status(
        person.post("/api/auth/sign-in/name", {
          data: {
            fullName: input.fullName,
            password: original.temporaryPassword,
          },
        }),
        200
      );
      await caseApp.db
        .prepare(
          "UPDATE person_profile SET membership_status = 'deactivated', banned_at = unixepoch() WHERE user_id = ?"
        )
        .bind(targetUserId)
        .run();
      await caseApp.db
        .prepare(
          "UPDATE account SET temporary_password_expires_at = unixepoch() - 1 WHERE user_id = ? AND account_id = user_id AND provider_id = 'credential'"
        )
        .bind(targetUserId)
        .run();
      await status(
        person.post("/api/v2/account/password", {
          data: {
            currentPassword: original.temporaryPassword,
            newPassword: "Synthetic-after-expiry!",
            operationKey: randomUUID(),
          },
        }),
        403
      );
      const expired = await status(
        person.post("/api/auth/sign-in/name", {
          data: {
            fullName: input.fullName,
            password: original.temporaryPassword,
          },
        }),
        401
      );
      expect(await expired.json()).toMatchObject({
        code: "TEMPORARY_PASSWORD_EXPIRED",
      });

      const reissueInput: RecoveryInput = {
        identityCheck: "face_to_face",
        operationKey: randomUUID(),
        targetUserId,
      };
      const reissued = issuedCredential(
        await staffData(
          await status(
            staff.context.post("/api/v2/staff/accounts/password-reissue", {
              data: reissueInput,
            }),
            201
          )
        )
      );
      expect(reissued.receipt?.action).toBe("temporary_password_reissued");
      expect(await credentialRow(caseApp, targetUserId)).toMatchObject({
        credential_revision: 1,
        temporary_password_expires_at: reissued.temporaryPasswordExpiresAt,
      });
      const creationReplay = await status(
        staff.context.post("/api/v2/staff/accounts", { data: input }),
        200
      );
      expect(await staffData(creationReplay)).toEqual({
        receipt: original.receipt,
      });
      const reissueReplay = await status(
        staff.context.post("/api/v2/staff/accounts/password-reissue", {
          data: reissueInput,
        }),
        200
      );
      expect(await staffData(reissueReplay)).toEqual({
        receipt: reissued.receipt,
      });
      expect(reissued.temporaryPassword).not.toBe(original.temporaryPassword);
      await status(person.get("/api/v2/account/security"), 401);
      await status(
        person.post("/api/auth/sign-in/name", {
          data: {
            fullName: input.fullName,
            password: original.temporaryPassword,
          },
        }),
        401
      );
      const reissuedPerson = await playwright.request.newContext({
        baseURL: caseApp.origin,
        extraHTTPHeaders: {
          ...extraHTTPHeaders,
          "cf-connecting-ip": "198.19.77.64",
        },
      });
      try {
        await status(
          reissuedPerson.post("/api/auth/sign-in/name", {
            data: {
              fullName: input.fullName,
              password: reissued.temporaryPassword,
            },
          }),
          200
        );
        await status(reissuedPerson.get("/api/v2/me"), 403);
        await status(
          reissuedPerson.post("/api/v2/account/password", {
            data: {
              currentPassword: reissued.temporaryPassword,
              newPassword: "Synthetic-final-holder-password!",
              operationKey: randomUUID(),
            },
          }),
          201
        );
        const restricted = await status(reissuedPerson.get("/api/v2/me"), 403);
        expect(await restricted.json()).toMatchObject({
          error: { code: "business_access_denied" },
        });
      } finally {
        await reissuedPerson.dispose();
      }
      expect(
        await caseApp.db
          .prepare(
            "SELECT membership_status, banned_at IS NOT NULL AS banned FROM person_profile WHERE user_id = ?"
          )
          .bind(targetUserId)
          .first()
      ).toEqual({ banned: 1, membership_status: "deactivated" });
      expect(
        await caseApp.db
          .prepare(
            "SELECT COUNT(*) AS count FROM staff_account_operation WHERE target_user_id = ? AND action IN ('assisted_account_created', 'temporary_password_reissued')"
          )
          .bind(targetUserId)
          .first<{ count: number }>()
      ).toEqual({ count: 2 });
    } finally {
      await person.dispose();
    }
  }
);

test(
  "assisted creation is private, forces native first change and returns its durable expiry",
  {
    tag: tags("http", ["@risk-auth", "@risk-security", "@risk-privacy"]),
  },
  async ({ caseApp, extraHTTPHeaders, playwright, staff }) => {
    const input = creation();
    const response = await status(
      staff.context.post("/api/v2/staff/accounts", { data: input }),
      201
    );
    expect(response.headers()["cache-control"]).toContain("no-store");
    const original = issuedCredential(await staffData(response));
    expect(original.temporaryPassword).toHaveLength(32);
    expect(original.receipt?.action).toBe("assisted_account_created");
    const targetUserId = original.receipt?.targetUserId;
    if (!targetUserId) {
      throw new Error("Assisted creation did not identify its target");
    }
    expect(await credentialRow(caseApp, targetUserId)).toMatchObject({
      credential_revision: 0,
      temporary_password_expires_at: original.temporaryPasswordExpiresAt,
    });
    const replay = await status(
      staff.context.post("/api/v2/staff/accounts", { data: input }),
      200
    );
    expect(await staffData(replay)).toEqual({ receipt: original.receipt });
    expect(
      await creationEffects(caseApp, input.username, original.temporaryPassword)
    ).toEqual({
      audits: 1,
      credentials: 1,
      plaintext: 0,
      profiles: 1,
      receipts: 1,
      reservations: 1,
      users: 1,
    });

    const person = await playwright.request.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders: {
        ...extraHTTPHeaders,
        "cf-connecting-ip": "198.19.77.63",
      },
    });
    try {
      await status(
        person.post("/api/auth/sign-in/username", {
          data: {
            password: original.temporaryPassword,
            username: input.username,
          },
        }),
        200
      );
      const gated = await status(person.get("/api/v2/me"), 403);
      expect(await gated.json()).toMatchObject({
        error: { code: "password_change_required" },
      });
      await status(
        person.post("/api/v2/account/sessions/revoke-others", {
          data: { operationKey: randomUUID() },
        }),
        403
      );
      const home = await person.get("/", { maxRedirects: 0 });
      expect(home.headers().location).toContain("/account");
      const security = await status(
        person.get("/api/v2/account/security"),
        200
      );
      const securityBody = await security.json();
      expect(securityBody.data.state.temporaryPasswordExpiresAt).toBe(
        (await credentialRow(caseApp, targetUserId))
          ?.temporary_password_expires_at
      );
      await status(
        person.post("/api/v2/account/password", {
          data: {
            currentPassword: original.temporaryPassword,
            newPassword: "Synthetic-holder-password!",
            operationKey: randomUUID(),
          },
        }),
        201
      );
      await status(person.get("/api/v2/me"), 200);
    } finally {
      await person.dispose();
    }
  }
);

dedicatedTest(
  "lost recovery response remains UNKNOWN and reconciles its original receipt after native Worker update",
  {
    tag: tags(
      "browser",
      ["@risk-recovery", "@risk-privacy", "@risk-resilience"],
      true
    ),
  },
  async ({ caseApp, page, staff }, testInfo) => {
    const holder = syntheticAccount("lost-reset");
    const targetUserId = await caseApp.provision.account(holder);
    await addStaffCookies(page, staff);
    await page.goto(
      `/staff/accounts?view=people&person=${targetUserId}&task=recovery`
    );
    await expect(
      page.getByRole("heading", { exact: true, name: "帳戶復原" })
    ).toBeVisible();
    let requests = 0;
    let reconciliations = 0;
    const bodies: Record<string, unknown>[] = [];
    let unknownTemporaryPassword = "";
    page.on("request", (request) => {
      if (request.method() !== "POST") {
        return;
      }
      if (request.url().endsWith("/api/v2/staff/accounts/password-reset")) {
        requests += 1;
        bodies.push(request.postDataJSON() as Record<string, unknown>);
      }
      if (request.url().endsWith("/api/v2/staff/accounts/reconcile")) {
        reconciliations += 1;
      }
    });
    await page.route(
      "**/api/v2/staff/accounts/password-reset",
      async (route) => {
        const response = await route.fetch();
        expect(response.status()).toBe(201);
        unknownTemporaryPassword = issuedCredential(
          await staffData(response)
        ).temporaryPassword;
        await route.abort("failed");
      }
    );
    await page.route("**/api/v2/staff/accounts/reconcile", (route) =>
      route.abort("failed")
    );
    const verification = page.getByLabel("已按以上方式核實身分", {
      exact: false,
    });
    await verification.check();
    await page.getByRole("button", { name: "檢查資料" }).click();
    const finalSubmit = page.getByRole("button", {
      exact: true,
      name: "確認並重設密碼及登出全部裝置",
    });
    await expect(finalSubmit).toBeEnabled();
    await qualifyPresentation(page, testInfo, "reset-review", {
      criticalAction: finalSubmit,
      drafts: recoveryDrafts(page),
      focus: finalSubmit,
    });
    await finalSubmit.click();
    await expect(page.getByRole("status").first()).toContainText(
      "結果仍未確認"
    );
    expect(requests).toBe(1);
    expect(reconciliations).toBe(1);
    expect(bodies).toHaveLength(1);
    const raw = await page.evaluate(() =>
      localStorage.getItem("efcc.staff-account.operation.v1")
    );
    if (!raw) {
      throw new Error("UNKNOWN recovery did not preserve the original key");
    }
    const operation = storedStaffAccountOperationSchema.parse(JSON.parse(raw));
    expect(operation).toMatchObject({
      action: "staff_password_reset",
      actorUserId: staff.userId,
      identityCheck: "face_to_face",
      targetUserId,
    });
    expect(raw).not.toContain(holder.password);
    expect(raw).not.toContain(unknownTemporaryPassword);
    await page.unroute("**/api/v2/staff/accounts/password-reset");
    await page.unroute("**/api/v2/staff/accounts/reconcile");

    const marker = randomUUID();
    await caseApp.server.update((current) => {
      const [primary, ...remaining] = current.workers;
      if (!primary || !("configPath" in primary)) {
        throw new Error("Native app primary worker config is unavailable");
      }
      return {
        ...current,
        workers: [
          {
            ...primary,
            vars: { ...primary.vars, N13_NATIVE_UPDATE_MARKER: marker },
          },
          ...remaining,
        ],
      };
    });
    const updatedWorker = caseApp.server.getWorker<{
      DB: NativeApp["db"];
      N13_NATIVE_UPDATE_MARKER: string;
    }>("efcc-system");
    const updatedEnvironment = await updatedWorker.getEnv();
    expect(updatedEnvironment.N13_NATIVE_UPDATE_MARKER).toBe(marker);
    await status(staff.context.get("/api/v2/me"), 200);
    expect(
      await updatedEnvironment.DB.prepare(
        "SELECT action, actor_user_id, operation_key, target_user_id FROM staff_account_operation WHERE actor_user_id = ? AND operation_key = ?"
      )
        .bind(staff.userId, operation.key)
        .first()
    ).toEqual({
      action: "staff_password_reset",
      actor_user_id: staff.userId,
      operation_key: operation.key,
      target_user_id: targetUserId,
    });
    expect(
      await updatedEnvironment.DB.prepare(
        "SELECT COUNT(*) AS count FROM audit_event WHERE action = 'staff_password_reset' AND target_user_id = ?"
      )
        .bind(targetUserId)
        .first<{ count: number }>()
    ).toEqual({ count: 1 });
    expect(
      await updatedEnvironment.DB.prepare(
        "SELECT COUNT(*) AS count FROM account WHERE user_id = ? AND password = ?"
      )
        .bind(targetUserId, unknownTemporaryPassword)
        .first<{ count: number }>()
    ).toEqual({ count: 0 });

    const reconciliationRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        request.url().endsWith("/api/v2/staff/accounts/reconcile")
    );
    await page.reload();
    const reconcile = await reconciliationRequest;
    expect(reconcile.postDataJSON()).toEqual({ operationKey: operation.key });
    await expect(
      page.getByRole("heading", {
        exact: true,
        name: "臨時密碼不能再次顯示",
      })
    ).toBeVisible();
    await page.getByText("操作詳情", { exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "伺服器已確認操作完成" })
    ).toContainText("伺服器已確認操作完成");
    await expect(page.getByLabel("新臨時密碼", { exact: true })).toHaveCount(0);
    const replay = await status(
      staff.context.post("/api/v2/staff/accounts/password-reset", {
        data: {
          identityCheck: "face_to_face",
          operationKey: operation.key,
          targetUserId,
        },
      }),
      200
    );
    const replayData = await staffData(replay);
    expect(replayData.receipt).toMatchObject({
      action: "staff_password_reset",
      targetUserId,
    });
    expect("temporaryPassword" in replayData).toBe(false);
    expect(bodies).toEqual([
      {
        identityCheck: "face_to_face",
        operationKey: operation.key,
        targetUserId,
      },
    ]);
    expect(requests).toBe(1);
    expect(reconciliations).toBe(2);
  }
);

test(
  "Staff creation reviews immutable fields and hands over a credential once",
  {
    tag: tags(
      "browser",
      ["@risk-privacy", "@risk-recovery", "@risk-security"],
      true
    ),
  },
  async ({ caseApp, page, staff }, testInfo) => {
    await addStaffCookies(page, staff);
    await page.goto("/staff/accounts");
    await page.getByRole("link", { name: /建立帳戶/u }).click();
    await expect(
      page.getByRole("button", { name: "檢查帳戶資料" })
    ).toBeEnabled();
    const input = creation();
    await page.getByLabel("中文全名", { exact: true }).fill(input.fullName);
    await page.getByLabel("使用者名稱", { exact: true }).fill(input.username);
    await page.getByLabel("電話", { exact: true }).fill(input.phone);
    await page.getByLabel("已親身核實此人的身分", { exact: true }).check();
    let requests = 0;
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().endsWith("/api/v2/staff/accounts")
      ) {
        requests += 1;
      }
    });
    await page.getByRole("button", { name: "檢查帳戶資料" }).click();
    await expect(
      page.getByRole("heading", { exact: true, level: 1, name: "檢查新帳戶" })
    ).toBeVisible();
    expect(requests).toBe(0);
    for (const value of [
      input.fullName,
      input.username,
      input.phone,
      "已親身核實",
      "未提供",
      "否",
    ]) {
      await expect(page.getByText(value, { exact: true })).toBeVisible();
    }
    await page.getByRole("button", { name: "返回修改" }).click();
    await expect(page.getByLabel("中文全名", { exact: true })).toHaveValue(
      input.fullName
    );
    await expect(page.getByLabel("使用者名稱", { exact: true })).toHaveValue(
      input.username
    );
    await expect(page.getByLabel("電話", { exact: true })).toHaveValue(
      input.phone
    );
    await expect(
      page.getByLabel("已親身核實此人的身分", { exact: true })
    ).toBeChecked();
    await page.getByRole("button", { name: "檢查帳戶資料" }).click();
    await expect(
      page.getByRole("heading", { exact: true, level: 1, name: "檢查新帳戶" })
    ).toBeVisible();
    const submit = page.getByRole("button", {
      name: "確認並建立帳戶及發出臨時密碼",
    });
    await expect(submit).toBeEnabled();
    await qualifyPresentation(page, testInfo, "create-review", {
      criticalAction: submit,
      drafts: creationDrafts(page),
      focus: submit,
    });

    const committed = Promise.withResolvers<APIResponse>();
    const release = Promise.withResolvers<null>();
    const settled = Promise.withResolvers<null>();
    let submittedKey = "";
    let submittedBody: Record<string, unknown> | null = null;
    let submittedActor: string | undefined;
    let routeStarted = false;
    let response: APIResponse | undefined;
    await page.route("**/api/v2/staff/accounts", async (route) => {
      routeStarted = true;
      try {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        submittedKey = String(body.operationKey);
        submittedBody = body;
        submittedActor = route.request().headers()["x-efcc-expected-actor-id"];
        let fetched: APIResponse;
        try {
          fetched = await route.fetch();
        } catch (error) {
          committed.reject(error);
          await route.abort("failed");
          return;
        }
        committed.resolve(fetched);
        await release.promise;
        await route.fulfill({
          body: await fetched.body(),
          headers: fetched.headers(),
          status: fetched.status(),
        });
      } finally {
        settled.resolve(null);
      }
    });
    try {
      const [, committedResponse] = await Promise.all([
        submit.click(),
        committed.promise,
      ]);
      response = committedResponse;
      expect(committedResponse.status()).toBe(201);
      expect(submittedKey).toEqual(expect.any(String));
      expect(submittedKey).not.toBe(input.operationKey);
      expect(submittedBody).toEqual({ ...input, operationKey: submittedKey });
      expect(submittedActor).toBe(staff.userId);
      await expect(page.getByRole("status").first()).toContainText("正在提交");
      await expect(submit).toHaveCount(0);
      await page.keyboard.press("Enter");
      await expect(submit).toHaveCount(0);
      expect(requests).toBe(1);
    } finally {
      release.resolve(null);
      if (routeStarted) {
        await settled.promise;
      }
      await page.unroute("**/api/v2/staff/accounts");
    }
    if (!response) {
      throw new Error("Committed account creation response was not observed");
    }
    const issuance = issuedCredential(await staffData(response));
    expect(requests).toBe(1);
    const output = page.getByLabel("新臨時密碼", { exact: true });
    await expect(output).toBeVisible();
    await expect(page.getByLabel("中文全名", { exact: true })).toHaveCount(0);
    const acknowledgement = page.getByRole("checkbox");
    const finish = page.getByRole("button", {
      name: "完成，開始另一項操作",
    });
    const copy = page.getByRole("button", { name: "複製臨時密碼" });
    await expect(finish).toBeDisabled();
    await acknowledgement.check();
    await expect(finish).toBeEnabled();
    await acknowledgement.uncheck();
    await expect(finish).toBeDisabled();
    const secret = await output.textContent();
    expect(secret).toBe(issuance.temporaryPassword);
    expect(secret).toHaveLength(32);
    const targetUserId = issuance.receipt?.targetUserId;
    if (!targetUserId) {
      throw new Error("Staff creation receipt did not identify its target");
    }
    expect(await credentialRow(caseApp, targetUserId)).toMatchObject({
      credential_revision: 0,
      temporary_password_expires_at: issuance.temporaryPasswordExpiresAt,
    });
    expect(await creationEffects(caseApp, input.username, secret)).toEqual({
      audits: 1,
      credentials: 1,
      plaintext: 0,
      profiles: 1,
      receipts: 1,
      reservations: 1,
      users: 1,
    });
    const raw = await page.evaluate(() =>
      localStorage.getItem("efcc.staff-account.operation.v1")
    );
    if (!raw) {
      throw new Error("Staff handover did not retain its operation reference");
    }
    const operation = storedStaffAccountOperationSchema.parse(JSON.parse(raw));
    expect(operation).toEqual({
      action: "assisted_account_created",
      actorUserId: staff.userId,
      key: submittedKey,
      targetUserId: null,
    });
    expect(raw).not.toContain(secret ?? "");
    expect(
      await caseApp.db
        .prepare(
          "SELECT action, actor_user_id, identity_check, operation_key, target_credential_revision, target_user_id FROM staff_account_operation WHERE actor_user_id = ? AND operation_key = ?"
        )
        .bind(staff.userId, submittedKey)
        .first()
    ).toEqual({
      action: "assisted_account_created",
      actor_user_id: staff.userId,
      identity_check: "face_to_face",
      operation_key: submittedKey,
      target_credential_revision: 0,
      target_user_id: targetUserId,
    });
    expect(
      await caseApp.db
        .prepare(
          "SELECT COUNT(*) AS count FROM staff_account_operation WHERE operation_key = ? AND actor_user_id = ? AND target_user_id = ?"
        )
        .bind(submittedKey, staff.userId, targetUserId)
        .first<{ count: number }>()
    ).toEqual({ count: 1 });
    await expect(page.getByRole("region", { name: "操作對象" })).toContainText(
      input.fullName
    );
    await expect(page.getByRole("region", { name: "操作對象" })).toContainText(
      input.username
    );
    await qualifyPresentation(page, testInfo, "create-handover", {
      criticalAction: copy,
      drafts: acknowledgement,
      focus: copy,
    });

    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: () =>
            Promise.reject(
              new DOMException("Clipboard unavailable", "NotAllowedError")
            ),
        },
      });
    });
    await copy.click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "未能複製，請手動選取臨時密碼" })
    ).toContainText("未能複製，請手動選取臨時密碼");
    await expect(output).toHaveText(secret ?? "");
    await output.selectText();
    expect(
      await page.evaluate(() => window.getSelection()?.toString() ?? "")
    ).toBe(secret);
    await qualifyPresentation(page, testInfo, "handover-copy-failure", {
      criticalAction: copy,
      drafts: acknowledgement,
      focus: copy,
      masks: [output],
    });
    const saved = await page.evaluate(() =>
      localStorage.getItem("efcc.staff-account.operation.v1")
    );
    expect(saved).not.toContain(secret ?? "");
    expect(Object.keys(JSON.parse(saved ?? "{}")).toSorted()).toEqual([
      "action",
      "actorUserId",
      "key",
      "targetUserId",
    ]);
    expect(
      await caseApp.db
        .prepare(
          "SELECT COUNT(*) AS count FROM staff_account_operation WHERE instr(id || operation_key || request_hash || actor_session_id || confirmation_operation_id, ?) > 0"
        )
        .bind(secret)
        .first<{ count: number }>()
    ).toEqual({ count: 0 });

    await page.evaluate(() => {
      const remove = Storage.prototype.removeItem;
      Storage.prototype.removeItem = function removeItem(key: string) {
        if (key === "efcc.staff-account.operation.v1") {
          throw new DOMException("Local storage denied", "SecurityError");
        }
        return remove.call(this, key);
      };
      document.addEventListener(
        "vf-restore-storage",
        () => {
          Storage.prototype.removeItem = remove;
        },
        { once: true }
      );
    });
    try {
      await acknowledgement.check();
      await finish.click();
      await expect(page.getByRole("alert")).toContainText("未能清除操作代碼");
      await expect(output).toHaveText(secret ?? "");
      expect(
        await page.evaluate(() =>
          localStorage.getItem("efcc.staff-account.operation.v1")
        )
      ).toBe(saved);
      expect(requests).toBe(1);
      await acknowledgement.uncheck();
    } finally {
      await page.evaluate(() =>
        document.dispatchEvent(new Event("vf-restore-storage"))
      );
    }
    await page.reload();
    await expect(page.getByRole("status").first()).toContainText(
      "原臨時密碼不能再次讀取"
    );
    await expect(page.getByLabel("新臨時密碼", { exact: true })).toHaveCount(0);
    await page
      .getByRole("button", { name: "重新核實並發出新臨時密碼" })
      .click();
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === "/staff/accounts" &&
        url.searchParams.get("person") === targetUserId &&
        url.searchParams.get("task") === "recovery" &&
        url.searchParams.get("view") === "people"
    );
    await expect(
      page.getByRole("heading", { exact: true, name: "帳戶復原" })
    ).toBeVisible();
    expect(
      await page.evaluate(() =>
        localStorage.getItem("efcc.staff-account.operation.v1")
      )
    ).toBeNull();
  }
);

test(
  "Staff creation copies the one-time credential to the real desktop clipboard",
  {
    tag: tags("browser", ["@risk-privacy", "@risk-security"]),
  },
  async ({ page, staff }, testInfo) => {
    await addStaffCookies(page, staff);
    await page.goto("/staff/accounts?task=create");
    const input = creation();
    await page.getByLabel("中文全名", { exact: true }).fill(input.fullName);
    await page.getByLabel("使用者名稱", { exact: true }).fill(input.username);
    await page.getByLabel("電話", { exact: true }).fill(input.phone);
    await page.getByLabel("已親身核實此人的身分", { exact: true }).check();
    await page.getByRole("button", { name: "檢查帳戶資料" }).click();
    const finalSubmit = page.getByRole("button", {
      name: "確認並建立帳戶及發出臨時密碼",
    });
    await expect(finalSubmit).toBeEnabled();
    await qualifyPresentation(page, testInfo, "clipboard-create-review", {
      criticalAction: finalSubmit,
      drafts: creationDrafts(page),
      focus: finalSubmit,
    });
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);
    const committed = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/v2/staff/accounts")
    );
    await finalSubmit.click();
    const response = await committed;
    expect(response.status()).toBe(201);
    const issuance = issuedCredential(await staffData(response));
    const password = page.getByLabel("新臨時密碼", { exact: true });
    await expect(password).toHaveText(issuance.temporaryPassword);
    await page.getByRole("button", { name: "複製臨時密碼" }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      issuance.temporaryPassword
    );
  }
);

test(
  "lost Staff creation recovers through fresh-confirmed reset and private reissue before native first password change",
  {
    tag: tags(
      "browser",
      ["@risk-auth", "@risk-recovery", "@risk-privacy"],
      true
    ),
  },
  async ({ caseApp, page, staff }, testInfo) => {
    await addStaffCookies(page, staff);
    await page.goto("/staff/accounts");
    await page.getByRole("link", { name: /建立帳戶/u }).click();
    const lost = creation();
    let createRequests = 0;
    let unknownTemporaryPassword = "";
    await page.route("**/api/v2/staff/accounts", async (route) => {
      createRequests += 1;
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      unknownTemporaryPassword = issuedCredential(
        await staffData(response)
      ).temporaryPassword;
      await route.abort("failed");
    });
    await page.route("**/api/v2/staff/accounts/reconcile", (route) =>
      route.abort("failed")
    );
    await page.getByLabel("中文全名", { exact: true }).fill(lost.fullName);
    await page.getByLabel("使用者名稱", { exact: true }).fill(lost.username);
    await page.getByLabel("電話", { exact: true }).fill(lost.phone);
    await page.getByLabel("已親身核實此人的身分", { exact: true }).check();
    await page.getByRole("button", { name: "檢查帳戶資料" }).click();
    const createSubmit = page.getByRole("button", {
      name: "確認並建立帳戶及發出臨時密碼",
    });
    await expect(createSubmit).toBeEnabled();
    await qualifyPresentation(page, testInfo, "lost-create-review", {
      criticalAction: createSubmit,
      drafts: creationDrafts(page),
      focus: createSubmit,
    });
    await createSubmit.click();
    await expect(page.getByRole("status").first()).toContainText(
      "結果仍未確認"
    );
    expect(createRequests).toBe(1);
    await page.unroute("**/api/v2/staff/accounts");
    await page.unroute("**/api/v2/staff/accounts/reconcile");
    await page.reload();
    await expect(
      page.getByRole("heading", {
        exact: true,
        name: "臨時密碼不能再次顯示",
      })
    ).toBeVisible();
    await page.getByText("操作詳情", { exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "伺服器已確認操作完成" })
    ).toContainText("伺服器已確認操作完成");
    await expect(page.getByLabel("新臨時密碼", { exact: true })).toHaveCount(0);
    expect(await creationEffects(caseApp, lost.username, null)).toEqual({
      audits: 1,
      credentials: 1,
      plaintext: 0,
      profiles: 1,
      receipts: 1,
      reservations: 1,
      users: 1,
    });
    const targetUserId = await accountId(caseApp, lost.username);
    expect(
      await caseApp.db
        .prepare(
          "SELECT COUNT(*) AS count FROM account WHERE user_id = ? AND password = ?"
        )
        .bind(targetUserId, unknownTemporaryPassword)
        .first<{ count: number }>()
    ).toEqual({ count: 0 });
    const operationRaw = await page.evaluate(() =>
      localStorage.getItem("efcc.staff-account.operation.v1")
    );
    if (!operationRaw) {
      throw new Error("Lost creation response did not retain its original key");
    }
    expect(operationRaw).not.toContain(unknownTemporaryPassword);
    const creationOperation = storedStaffAccountOperationSchema.parse(
      JSON.parse(operationRaw)
    );
    expect(creationOperation).toMatchObject({
      action: "assisted_account_created",
      actorUserId: staff.userId,
      targetUserId: null,
    });
    const reissueLost = page.getByRole("button", {
      name: "重新核實並發出新臨時密碼",
    });
    await qualifyPresentation(page, testInfo, "lost-create-handover", {
      criticalAction: reissueLost,
      drafts: page.locator("input[id]:not([type=hidden])"),
      focus: reissueLost,
    });
    await reissueLost.click();
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === "/staff/accounts" &&
        url.searchParams.get("person") === targetUserId &&
        url.searchParams.get("task") === "recovery" &&
        url.searchParams.get("view") === "people"
    );
    const verification = page.getByLabel("已按以上方式核實身分", {
      exact: false,
    });
    await verification.check();
    await page.getByRole("link", { exact: true, name: "返回帳戶詳情" }).click();
    const leaveDialog = page.getByRole("dialog");
    await expect(leaveDialog).toBeVisible();
    await leaveDialog.getByRole("button", { name: "繼續編輯" }).click();
    await expect(verification).toBeChecked();
    await page.getByRole("link", { exact: true, name: "返回帳戶詳情" }).click();
    await leaveDialog.getByRole("button", { name: "放棄變更" }).click();
    await caseApp.db
      .prepare("UPDATE session SET password_confirmed_at = 0 WHERE user_id = ?")
      .bind(staff.userId)
      .run();
    await page.getByRole("link", { name: /帳戶復原/u }).click();
    await expect(verification).not.toBeChecked();
    await verification.check();
    let resetRequests = 0;
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().endsWith("/api/v2/staff/accounts/password-reset")
      ) {
        resetRequests += 1;
      }
    });
    await page.getByRole("button", { name: "檢查資料" }).click();
    await expect(
      page.getByRole("heading", { exact: true, level: 1, name: "檢查重設密碼" })
    ).toBeVisible();
    expect(resetRequests).toBe(0);
    const resetSubmit = page.getByRole("button", {
      exact: true,
      name: "確認並重設密碼及登出全部裝置",
    });
    await expect(resetSubmit).toBeVisible();
    await expect(
      page.getByText(
        "發出七日有效的臨時密碼並登出對象的其他裝置；首次登入必須更改密碼",
        { exact: true }
      )
    ).toBeVisible();
    await qualifyPresentation(page, testInfo, "reset-review", {
      criticalAction: resetSubmit,
      drafts: recoveryDrafts(page),
      focus: resetSubmit,
    });
    await page.getByRole("button", { name: "返回修改" }).click();
    await expect(verification).toBeChecked();
    await page.getByRole("button", { name: "檢查資料" }).click();
    await resetSubmit.click();
    const confirmationDialog = page.getByRole("dialog");
    await expect(
      confirmationDialog.getByRole("heading", {
        exact: true,
        name: "確認目前密碼",
      })
    ).toBeVisible();
    await confirmationDialog
      .getByLabel("目前密碼", { exact: true })
      .fill(staff.account.password);
    const confirmButton = confirmationDialog.getByRole("button", {
      exact: true,
      name: "確認並返回檢查",
    });
    await confirmButton.click();
    await expect(confirmationDialog.getByRole("status")).toContainText(
      "伺服器已確認"
    );
    await confirmButton.click();
    await expect(
      page.getByRole("heading", { exact: true, level: 1, name: "檢查重設密碼" })
    ).toBeVisible();
    expect(resetRequests).toBe(0);
    expect(
      await page.evaluate(() =>
        localStorage.getItem("efcc.account-security.operation.v1")
      )
    ).toBeNull();
    const resetResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/v2/staff/accounts/password-reset")
    );
    await resetSubmit.click();
    const resetHttp = await resetResponse;
    expect(resetHttp.status()).toBe(201);
    const reset = issuedCredential(await staffData(resetHttp));
    expect(resetRequests).toBe(1);
    expect(reset.receipt?.targetUserId).toBe(targetUserId);
    expect(await credentialRow(caseApp, targetUserId)).toMatchObject({
      credential_revision: 1,
      temporary_password_expires_at: reset.temporaryPasswordExpiresAt,
    });
    const resetPassword = reset.temporaryPassword;
    await page.reload();
    await expect(page.getByRole("status").first()).toContainText(
      "原臨時密碼不能再次讀取"
    );
    await expect(page.getByLabel("新臨時密碼", { exact: true })).toHaveCount(0);
    const continueRecovery = page.getByRole("button", {
      name: "重新核實並發出新臨時密碼",
    });
    await continueRecovery.click();
    await verification.check();
    let reissueRequests = 0;
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().endsWith("/api/v2/staff/accounts/password-reissue")
      ) {
        reissueRequests += 1;
      }
    });
    await page.getByRole("radio", { name: /重新發出臨時密碼/u }).check();
    await page.getByRole("button", { name: "檢查資料" }).click();
    await expect(
      page.getByRole("heading", { exact: true, level: 1, name: "檢查重新發出" })
    ).toBeVisible();
    expect(reissueRequests).toBe(0);
    const reissueSubmit = page.getByRole("button", {
      exact: true,
      name: "確認並重新發出臨時密碼",
    });
    await expect(reissueSubmit).toBeVisible();
    await qualifyPresentation(page, testInfo, "reissue-review", {
      criticalAction: reissueSubmit,
      drafts: recoveryDrafts(page),
      focus: reissueSubmit,
    });
    const reissueResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/v2/staff/accounts/password-reissue")
    );
    await reissueSubmit.click();
    const reissueHttp = await reissueResponse;
    expect(reissueHttp.status()).toBe(201);
    const reissued = issuedCredential(await staffData(reissueHttp));
    expect(reissueRequests).toBe(1);
    expect(reissued.temporaryPassword).not.toBe(resetPassword);
    expect(await credentialRow(caseApp, targetUserId)).toMatchObject({
      credential_revision: 2,
      temporary_password_expires_at: reissued.temporaryPasswordExpiresAt,
    });
    const reissuedPassword = reissued.temporaryPassword;
    await page.reload();
    await expect(page.getByRole("status").first()).toContainText(
      "原臨時密碼不能再次讀取"
    );
    await expect(page.getByLabel("新臨時密碼", { exact: true })).toHaveCount(0);

    await page.context().clearCookies();
    const oldCredential = await page
      .context()
      .request.post(`${caseApp.origin}/api/auth/sign-in/name`, {
        data: { fullName: lost.fullName, password: resetPassword },
        headers: { origin: caseApp.origin },
      });
    expect(oldCredential.status()).toBe(401);
    const memberSignIn = await page
      .context()
      .request.post(`${caseApp.origin}/api/auth/sign-in/name`, {
        data: { fullName: lost.fullName, password: reissuedPassword },
        headers: { origin: caseApp.origin },
      });
    expect(memberSignIn.status()).toBe(200);
    await page.goto("/");
    await expect(page).toHaveURL(/\/account$/u);
    await expect(
      page.getByRole("link", { exact: true, name: "我的申請" })
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { exact: true, name: "登出其他裝置" })
    ).toHaveCount(0);
    await page.getByLabel("臨時密碼", { exact: true }).fill(reissuedPassword);
    await page
      .getByLabel("新密碼", { exact: true })
      .fill("Synthetic-Android-holder-password!");
    await page
      .getByLabel("再次輸入新密碼", { exact: true })
      .fill("Synthetic-Android-holder-password!");
    const firstChangeResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/v2/account/password")
    );
    await page.getByRole("button", { exact: true, name: "更改密碼" }).click();
    const firstChange = await firstChangeResponse;
    expect(firstChange.status()).toBe(201);
    await status(
      page.context().request.get(`${caseApp.origin}/api/v2/me`),
      200
    );
    await page
      .getByRole("button", { exact: true, name: "查看帳戶狀態" })
      .click();
    await expect(page).toHaveURL(/\/status$/u);
    await page.getByRole("button", { exact: true, name: "前往主頁" }).click();
    await expect(page).toHaveURL(`${caseApp.origin}/`);
    expect(createRequests).toBe(1);
  }
);

test(
  "Staff Management distinguishes same-name permitted accounts and retains person context across viewports",
  {
    tag: tags("browser", ["@risk-authorization", "@risk-privacy"], true),
  },
  async ({ caseApp, page, playwright, staff }) => {
    const peerStaff = syntheticAccount("peer-staff", "staff");
    const admin = syntheticAccount("managed-admin", "admin");
    const pending = syntheticAccount("managed-pending", undefined, "pending");
    const banned = syntheticAccount("managed-banned");
    const peerStaffId = await caseApp.provision.account(peerStaff);
    const adminId = await caseApp.provision.account(admin);
    const pendingId = await caseApp.provision.account(pending);
    const bannedId = await caseApp.provision.account(banned);
    await caseApp.db
      .prepare(
        "UPDATE person_profile SET banned_at = unixepoch() WHERE user_id = ?"
      )
      .bind(bannedId)
      .run();

    const firstInput = creation();
    const firstCreated = issuedCredential(
      await staffData(
        await status(
          staff.context.post("/api/v2/staff/accounts", { data: firstInput }),
          201
        )
      )
    );
    const secondInput = { ...creation(), fullName: firstInput.fullName };
    const secondCreated = issuedCredential(
      await staffData(
        await status(
          staff.context.post("/api/v2/staff/accounts", { data: secondInput }),
          201
        )
      )
    );
    const firstId = firstCreated.receipt?.targetUserId;
    const secondId = secondCreated.receipt?.targetUserId;
    if (!(firstId && secondId)) {
      throw new Error("Staff-created roster targets were not returned");
    }
    const roster = await status(
      staff.context.get("/api/v2/staff/accounts"),
      200
    );
    const rosterBody = (await roster.json()) as {
      data: { accounts: { userId: string }[] };
    };
    const rosterIds = rosterBody.data.accounts.map((account) => account.userId);
    for (const userId of [firstId, secondId, pendingId, bannedId]) {
      expect(rosterIds).toContain(userId);
    }
    for (const userId of [staff.userId, peerStaffId, adminId]) {
      expect(rosterIds).not.toContain(userId);
    }

    const adminActor = await playwright.request.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders: {
        "cf-connecting-ip": "198.19.77.71",
        origin: caseApp.origin,
      },
    });
    try {
      await status(
        adminActor.post("/api/auth/sign-in/username", {
          data: { password: admin.password, username: admin.username },
        }),
        200
      );
      const adminRoster = await status(
        adminActor.get("/api/v2/staff/accounts"),
        200
      );
      const adminBody = (await adminRoster.json()) as {
        data: { accounts: { userId: string }[] };
      };
      const adminIds = adminBody.data.accounts.map((account) => account.userId);
      expect(adminIds).toContain(staff.userId);
      expect(adminIds).toContain(peerStaffId);
      expect(adminIds).not.toContain(adminId);
    } finally {
      await adminActor.dispose();
    }
    await caseApp.db
      .prepare("UPDATE user SET display_username = NULL WHERE id IN (?, ?)")
      .bind(firstId, secondId)
      .run();

    await addStaffCookies(page, staff);
    await page.goto("/staff/accounts");
    await expect(page.getByRole("link", { name: /角色管理/u })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /內容管理/u })).toHaveCount(0);
    await page.getByRole("link", { name: /帳戶管理/u }).click();
    await expect(
      page.getByRole("link", { name: new RegExp(peerStaff.fullName, "u") })
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: new RegExp(admin.fullName, "u") })
    ).toHaveCount(0);
    const search = page.getByRole("searchbox", { name: "搜尋帳戶" });
    await expect(page).toHaveURL(/[?&]view=people(?:&|$)/u);
    const searchUrl = page.url();
    await search.fill("synthetic-no-matching-person");
    await expect(
      page.getByRole("link", { name: new RegExp(firstId, "u") })
    ).toHaveCount(0);
    await search.fill(firstInput.fullName);
    await expect(search).toBeFocused();
    expect(page.url()).toBe(searchUrl);
    await expect(page.getByRole("region", { name: "操作對象" })).toHaveCount(0);
    const firstAccount = page.getByRole("link", {
      name: new RegExp(`帳戶編號：${firstId}`, "u"),
    });
    const secondAccount = page.getByRole("link", {
      name: new RegExp(`帳戶編號：${secondId}`, "u"),
    });
    await expect(firstAccount).toBeVisible();
    await expect(secondAccount).toBeVisible();
    await secondAccount.click();
    await expect(page).toHaveURL(new RegExp(`person=${secondId}`, "u"));
    const selected = page.getByRole("region", { name: "操作對象" });
    await expect(selected).toContainText(secondInput.fullName);
    await expect(selected).toContainText(secondId);
    await expect(page.getByRole("link", { name: /帳戶復原/u })).toHaveAttribute(
      "href",
      new RegExp(`person=${secondId}.*task=recovery`, "u")
    );
    await expect(
      page.getByRole("navigation", { name: "主要導覽" })
    ).toBeVisible();
    await page.setViewportSize({ height: 844, width: 390 });
    await expect(
      page.getByRole("navigation", { name: "主要導覽" })
    ).toBeHidden();
    await expect(
      page.getByRole("searchbox", { name: "搜尋帳戶" })
    ).toBeHidden();
    await expect(selected).toContainText(secondId);
    await page.setViewportSize({ height: 900, width: 1280 });
    await expect(
      page.getByRole("navigation", { name: "主要導覽" })
    ).toBeVisible();
    await expect(selected).toContainText(secondId);
    await page.getByRole("link", { name: /返回帳戶列表/u }).click();
    await expect(search).toHaveValue(firstInput.fullName);
    await expect(firstAccount).toBeVisible();
    await expect(secondAccount).toBeVisible();
    await secondAccount.click();
    expect(firstId).not.toBe(secondId);
    await page.getByRole("link", { name: /帳戶復原/u }).click();
    await expect(page.getByRole("heading", { name: "帳戶復原" })).toBeVisible();
    await expect(page.getByText(new RegExp(secondId, "u"))).toBeVisible();

    await page.setViewportSize({ height: 844, width: 390 });
    await page.goto(
      `${caseApp.origin}/staff/accounts?view=people&person=not-a-permitted-target`
    );
    await expect(
      page.getByRole("navigation", { name: "主要導覽" })
    ).toBeVisible();
    await expect(
      page.getByRole("searchbox", { name: "搜尋帳戶" })
    ).toBeVisible();
    await expect(
      page.getByText("not-a-permitted-target", { exact: true })
    ).toHaveCount(0);
    await page.goto(
      `${caseApp.origin}/staff/accounts?view=people&person=not-a-permitted-target&task=recovery`
    );
    const recoveryForm = page.locator("form").filter({
      has: page.getByRole("button", { name: "檢查資料" }),
    });
    await expect(recoveryForm).toContainText("尚未選擇");
    await expect(page.locator("#recovery-target")).toHaveCount(0);
    await expect(
      recoveryForm.locator('input[name="targetUserId"]')
    ).toHaveValue("not-a-permitted-target");
    await expect(
      recoveryForm.getByRole("button", { name: "檢查資料" })
    ).toBeDisabled();
  }
);

dedicatedTest(
  "Staff task recovery retains the selected person and task while security context is unavailable",
  {
    tag: tags("browser", ["@risk-resilience", "@risk-privacy"], true),
  },
  async ({ caseApp, page, staff }) => {
    const input = creation();
    const created = issuedCredential(
      await staffData(
        await status(
          staff.context.post("/api/v2/staff/accounts", { data: input }),
          201
        )
      )
    );
    const targetUserId = created.receipt?.targetUserId;
    if (!targetUserId) {
      throw new Error("Staff creation did not identify its target");
    }
    await addStaffCookies(page, staff);
    for (const task of ["identity", "restrictions"] as const) {
      await caseApp.db
        .prepare(
          "ALTER TABLE session RENAME COLUMN password_confirmed_at TO fault_password_confirmed_at"
        )
        .run();
      try {
        await page.goto(
          `/staff/accounts?view=people&person=${targetUserId}&task=${task}`
        );
        await expect(
          page.getByRole("heading", {
            name: "暫時未能載入目前登入資料",
          })
        ).toBeVisible();
        await expect(
          page.getByRole("main").getByRole("link", {
            name: /返回帳戶詳情/u,
          })
        ).toHaveAttribute(
          "href",
          new RegExp(`person=${targetUserId}.*view=people`, "u")
        );
        const retryParams = await page
          .getByRole("button", { exact: true, name: "重新載入" })
          .evaluate((button) => {
            const { form } = button as HTMLButtonElement;
            return form ? Object.fromEntries(new FormData(form).entries()) : {};
          });
        expect(retryParams).toMatchObject({
          person: targetUserId,
          task,
          view: "people",
        });
      } finally {
        await caseApp.db
          .prepare(
            "ALTER TABLE session RENAME COLUMN fault_password_confirmed_at TO password_confirmed_at"
          )
          .run();
      }
      await page.getByRole("button", { exact: true, name: "重新載入" }).click();
      await expect(page).toHaveURL(
        new RegExp(`person=${targetUserId}.*task=${task}`, "u")
      );
      await expect(
        task === "identity"
          ? page.getByRole("heading", { name: "修正身份資料" })
          : page.getByRole("region", { name: "會籍與安全限制" })
      ).toBeVisible();
    }
  }
);

test(
  "checkbox rows preserve 44px touch targets and visible keyboard focus at phone and desktop widths",
  {
    tag: tags("browser", ["@risk-accessibility"], true),
  },
  async ({ page, staff }) => {
    await addStaffCookies(page, staff);
    await page.goto("/staff/accounts?task=create");
    const sharedPhone = page.getByLabel("已親身核實共用電話例外", {
      exact: true,
    });
    await expect(sharedPhone).toBeEnabled();
    await expect(
      page.getByRole("checkbox", {
        exact: true,
        name: "已親身核實共用電話例外",
      })
    ).toHaveCount(1);
    for (const viewport of [
      { height: 915, width: 412 },
      { height: 1024, width: 1440 },
    ]) {
      await page.setViewportSize(viewport);
      const row = page.locator("label", { has: sharedPhone });
      const box = await row.boundingBox();
      expect(box, JSON.stringify(viewport)).not.toBeNull();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect(box?.width).toBeGreaterThanOrEqual(44);
      const edge = { x: (box?.width ?? 0) - 8, y: (box?.height ?? 0) / 2 };
      await row.click({ position: edge });
      await expect(sharedPhone).toBeChecked();
      await row.click({ position: edge });
      await expect(sharedPhone).not.toBeChecked();
      await page.getByLabel("電話", { exact: true }).focus();
      await page.keyboard.press("Tab");
      await expect(sharedPhone).toBeFocused();
      const focus = await sharedPhone.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          outlineStyle: style.outlineStyle,
          outlineWidth: Number(style.outlineWidth.slice(0, -2)),
        };
      });
      expect(focus.outlineStyle).not.toBe("none");
      expect(focus.outlineWidth).toBeGreaterThanOrEqual(2);
      await page.keyboard.press("Space");
      await expect(sharedPhone).toBeChecked();
      await page.keyboard.press("Space");
      await expect(sharedPhone).not.toBeChecked();
    }
  }
);

for (const { mode, check, confirm } of [
  {
    check: "檢查帳戶資料",
    confirm: "確認並建立帳戶及發出臨時密碼",
    mode: "create",
  },
  {
    check: "檢查資料",
    confirm: "確認並重設密碼及登出全部裝置",
    mode: "reset",
  },
  {
    check: "檢查資料",
    confirm: "確認並重新發出臨時密碼",
    mode: "reissue",
  },
] as const) {
  for (const returnBeforeResponse of [false, true]) {
    test(
      `late ${mode} handover stays discarded after hiding${returnBeforeResponse ? " and returning before settlement" : " until settlement"}`,
      {
        tag: tags("browser", ["@risk-privacy", "@risk-recovery"], true),
      },
      async ({ caseApp, page, staff }, testInfo) => {
        const input = creation();
        let targetUserId = "";
        if (mode !== "create") {
          const created = issuedCredential(
            await staffData(
              await status(
                staff.context.post("/api/v2/staff/accounts", { data: input }),
                201
              )
            )
          );
          targetUserId = created.receipt?.targetUserId ?? "";
          if (!targetUserId) {
            throw new Error("Staff creation did not identify its target");
          }
        }
        await addStaffCookies(page, staff);
        await page.goto(
          mode === "create"
            ? "/staff/accounts?task=create"
            : `/staff/accounts?person=${targetUserId}&task=recovery&view=people`
        );
        if (mode === "create") {
          await page
            .getByLabel("中文全名", { exact: true })
            .fill(input.fullName);
          await page
            .getByLabel("使用者名稱", { exact: true })
            .fill(input.username);
          await page.getByLabel("電話", { exact: true }).fill(input.phone);
          await page
            .getByLabel("已親身核實此人的身分", { exact: true })
            .check();
        } else {
          await page
            .getByLabel("已按以上方式核實身分", { exact: false })
            .check();
        }
        if (mode === "reissue") {
          await page.getByRole("radio", { name: /重新發出臨時密碼/u }).check();
        }
        const path =
          mode === "create"
            ? "/api/v2/staff/accounts"
            : `/api/v2/staff/accounts/password-${mode}`;
        const committed = Promise.withResolvers<APIResponse>();
        const release = Promise.withResolvers<null>();
        const settled = Promise.withResolvers<null>();
        let requests = 0;
        let submittedKey = "";
        let routeStarted = false;
        page.on("request", (request) => {
          if (
            request.method() === "POST" &&
            new URL(request.url()).pathname === path
          ) {
            requests += 1;
          }
        });
        await page.route(`**${path}`, async (route) => {
          routeStarted = true;
          try {
            submittedKey = String(
              (route.request().postDataJSON() as Record<string, unknown>)
                .operationKey
            );
            let response: APIResponse;
            try {
              response = await route.fetch();
            } catch (error) {
              committed.reject(error);
              await route.abort("failed");
              return;
            }
            committed.resolve(response);
            await release.promise;
            await route.fulfill({
              body: await response.body(),
              headers: response.headers(),
              status: response.status(),
            });
          } finally {
            settled.resolve(null);
          }
        });
        try {
          await page.getByRole("button", { exact: true, name: check }).click();
          const finalSubmit = page.getByRole("button", {
            exact: true,
            name: confirm,
          });
          await expect(finalSubmit).toBeEnabled();
          await qualifyPresentation(page, testInfo, `${mode}-late-review`, {
            criticalAction: finalSubmit,
            drafts:
              mode === "create" ? creationDrafts(page) : recoveryDrafts(page),
            focus: finalSubmit,
          });
          const [, response] = await Promise.all([
            finalSubmit.click(),
            committed.promise,
          ]);
          const issued = issuedCredential(await staffData(response));
          await expect(page.getByRole("status")).toContainText("正在提交");
          await page.evaluate(() => {
            Object.defineProperty(document, "hidden", {
              configurable: true,
              value: true,
            });
            document.dispatchEvent(new Event("visibilitychange"));
          });
          if (returnBeforeResponse) {
            await page.evaluate(() => {
              Object.defineProperty(document, "hidden", {
                configurable: true,
                value: false,
              });
              document.dispatchEvent(new Event("visibilitychange"));
            });
          }
          release.resolve(null);
          await settled.promise;
          await expect(
            page.getByRole("heading", {
              exact: true,
              name: "臨時密碼不能再次顯示",
            })
          ).toBeVisible();
          await page.getByText("操作詳情", { exact: true }).click();
          await expect(
            page.getByRole("status").filter({ hasText: "伺服器已確認操作完成" })
          ).toContainText("伺服器已確認操作完成");
          await page.evaluate(() => {
            Object.defineProperty(document, "hidden", {
              configurable: true,
              value: false,
            });
            document.dispatchEvent(new Event("visibilitychange"));
          });
          await expect(
            page.getByLabel("新臨時密碼", { exact: true })
          ).toHaveCount(0);
          const raw = await page.evaluate(() =>
            localStorage.getItem("efcc.staff-account.operation.v1")
          );
          if (!raw) {
            throw new Error(
              "Late handover did not retain its operation reference"
            );
          }
          const saved = storedStaffAccountOperationSchema.parse(
            JSON.parse(raw)
          );
          expect(saved).toMatchObject({
            action: {
              create: "assisted_account_created",
              reissue: "temporary_password_reissued",
              reset: "staff_password_reset",
            }[mode],
            actorUserId: staff.userId,
            key: submittedKey,
          });
          expect(raw).not.toContain(issued.temporaryPassword);
          const target = issued.receipt?.targetUserId;
          if (!target) {
            throw new Error("The committed late response lacked its target");
          }
          expect(
            await caseApp.db
              .prepare(
                "SELECT (SELECT COUNT(*) FROM audit_event WHERE target_user_id = ? AND action = ?) AS audits, (SELECT COUNT(*) FROM staff_account_operation WHERE actor_user_id = ? AND operation_key = ? AND target_user_id = ?) AS receipts"
              )
              .bind(
                target,
                issued.receipt.action,
                staff.userId,
                submittedKey,
                target
              )
              .first<{ audits: number; receipts: number }>()
          ).toEqual({ audits: 1, receipts: 1 });
          await page.reload();
          await expect(page.getByRole("status").first()).toContainText(
            "原臨時密碼不能再次讀取"
          );
          await expect(
            page.getByLabel("新臨時密碼", { exact: true })
          ).toHaveCount(0);
          expect(requests).toBe(1);
        } finally {
          release.resolve(null);
          if (routeStarted) {
            await settled.promise;
          }
          await page.unroute(`**${path}`);
        }
      }
    );
  }
}
