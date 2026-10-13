import { randomBytes, randomUUID } from "node:crypto";

import type { APIRequestContext, APIResponse } from "@playwright/test";
import * as z from "zod";

import {
  deletionReceiptResponseSchema,
  deletionRequestSchema,
  storedDeletionOperationSchema,
} from "../../src/features/account/deletion-contract";
import type {
  DeletionReceipt,
  DeletionRequest,
} from "../../src/features/account/deletion-contract";
import { expect, test as nativeTest } from "../support/fixtures";
import type { NativeApp } from "../support/fixtures";
import type { ProvisionAccount } from "../worker/provision";
import { qualifyPresentation } from "./r11-presentation";

interface ApplicantInput {
  email: string;
  fullName: string;
  operationKey: string;
  password: string;
  phone: string;
  username: string;
}

const applicationMineResponseSchema = z.object({
  data: z.object({ application: z.object({ id: z.string() }) }),
});
const deletionErrorResponseSchema = z.object({
  error: z.object({ code: z.string() }),
});
const passwordResetResponseSchema = z.object({
  data: z.object({ temporaryPassword: z.string() }),
});

const expectStatus = async (
  pending: Promise<APIResponse>,
  expected: number
) => {
  const response = await pending;
  expect(response.status()).toBe(expected);
  return response;
};

const deletionReceipt = async (
  response: APIResponse
): Promise<DeletionReceipt> => {
  const { receipt } = deletionReceiptResponseSchema.parse(
    await response.json()
  ).data;
  if (!receipt) {
    throw new Error("The completed deletion did not return its receipt");
  }
  return receipt;
};

const applicationInput = (namespace: string): ApplicantInput => {
  const suffix = randomBytes(5).toString("hex");
  return {
    email: `${namespace}.${suffix}@example.com`,
    fullName: `陳資料${suffix}`,
    operationKey: randomBytes(32).toString("hex"),
    password: "Synthetic-identity-password!",
    phone: String(60_000_000 + (randomBytes(4).readUInt32BE() % 10_000_000)),
    username: `${namespace}.${suffix}`,
  };
};

const nativeAccount = (
  namespace: string,
  role?: ProvisionAccount["role"]
): ProvisionAccount => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
  return {
    email: `${namespace}.${suffix}@example.com`,
    fullName: `陳測試${suffix}`,
    membershipStatus: "active",
    ...(role ? { role } : {}),
    password: "Synthetic-native-password!",
    username: `${namespace.replaceAll("-", ".")}.${suffix}`,
  };
};

const operation = (targetUserId: string) => ({
  operationKey: randomUUID(),
  targetUserId,
});

type ApprovedMember = ApplicantInput & {
  context: APIRequestContext;
  userId: string;
};

const deletionTest = nativeTest.extend<{ approvedMember: ApprovedMember }>({
  approvedMember: async (
    { caseApp, extraHTTPHeaders, playwright, staff },
    use
  ) => {
    const applicant = applicationInput("deletion");
    await expectStatus(
      staff.context.post("/api/v2/applications", { data: applicant }),
      201
    );
    const context = await playwright.request.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders,
    });
    try {
      await expectStatus(
        context.post("/api/auth/sign-in/username", {
          data: {
            password: applicant.password,
            username: applicant.username,
          },
        }),
        200
      );
      const ownApplication = await expectStatus(
        context.get("/api/v2/applications/mine"),
        200
      );
      const ownBody = applicationMineResponseSchema.parse(
        await ownApplication.json()
      );
      const account = await caseApp.db
        .prepare("SELECT id FROM user WHERE username = ?")
        .bind(applicant.username)
        .first<{ id: string }>();
      if (!account) {
        throw new Error("Synthetic deletion applicant was not provisioned");
      }
      await expectStatus(
        staff.context.post("/api/v2/staff/application-decisions", {
          data: {
            applicationId: ownBody.data.application.id,
            operationKey: randomUUID(),
            outcome: "approved",
          },
        }),
        201
      );
      const profile = await caseApp.db
        .prepare(
          "SELECT membership_status FROM person_profile WHERE user_id = ?"
        )
        .bind(account.id)
        .first<{ membership_status: string }>();
      expect(profile?.membership_status).toBe("active");
      await use({ ...applicant, context, userId: account.id });
    } finally {
      await context.dispose();
    }
  },
});

const dedicatedDeletionTest = deletionTest.extend<{ caseApp: NativeApp }>({
  caseApp: async ({ dedicatedApp }, use) => {
    await use(dedicatedApp);
  },
});

deletionTest.describe(
  "eligible account deletion",
  { tag: ["@native", "@deletion"] },
  () => {
    deletionTest(
      "eligible deletion removes credentials and sessions while retaining decisions, security, audit and every Username claim",
      { tag: ["@http", "@risk-atomicity", "@risk-privacy", "@risk-recovery"] },
      async ({ caseApp, approvedMember, staff }) => {
        await expectStatus(
          approvedMember.context.post("/api/v2/account/password-confirmation", {
            data: {
              operationKey: randomUUID(),
              password: approvedMember.password,
            },
          }),
          201
        );
        const alias = `Alias.${randomBytes(5).toString("hex")}`;
        await expectStatus(
          staff.context.post("/api/v2/staff/accounts/identity", {
            data: {
              email: approvedMember.email,
              fullName: approvedMember.fullName,
              identityCheck: "face_to_face",
              operationKey: randomUUID(),
              phone: approvedMember.phone,
              sharedPhone: false,
              targetUserId: approvedMember.userId,
              username: alias,
            },
          }),
          201
        );
        const beforeAudit = await caseApp.db
          .prepare(
            "SELECT action FROM audit_event WHERE target_user_id = ? ORDER BY id"
          )
          .bind(approvedMember.userId)
          .all<{ action: string }>();
        const priorIdentityOperation = await caseApp.db
          .prepare(
            "SELECT id, action, actor_user_id, operation_key, target_user_id FROM account_change_operation WHERE target_user_id = ? AND action = 'staff_identity_corrected'"
          )
          .bind(approvedMember.userId)
          .first<{
            id: string;
            action: string;
            actor_user_id: string;
            operation_key: string;
            target_user_id: string;
          }>();
        if (!priorIdentityOperation) {
          throw new Error("Expected the original identity receipt");
        }

        const input = operation(approvedMember.userId);
        const deletedResponse = await expectStatus(
          staff.context.post("/api/v2/staff/accounts/delete", {
            data: input,
          }),
          201
        );
        const deletedReceipt = await deletionReceipt(deletedResponse);
        expect(deletedReceipt.action).toBe("account_deleted");
        expect(deletedReceipt.targetUserId).toBe(approvedMember.userId);
        const replay = await expectStatus(
          staff.context.post("/api/v2/staff/accounts/delete", {
            data: input,
          }),
          200
        );
        expect(await deletionReceipt(replay)).toEqual(deletedReceipt);

        const removed = await caseApp.db
          .prepare(
            "SELECT (SELECT COUNT(*) FROM user WHERE id = ?) AS users, (SELECT COUNT(*) FROM account WHERE user_id = ?) AS accounts, (SELECT COUNT(*) FROM session WHERE user_id = ?) AS sessions, (SELECT COUNT(*) FROM person_profile WHERE user_id = ?) AS profiles"
          )
          .bind(
            approvedMember.userId,
            approvedMember.userId,
            approvedMember.userId,
            approvedMember.userId
          )
          .first<{
            accounts: number;
            profiles: number;
            sessions: number;
            users: number;
          }>();
        expect(removed).toEqual({
          accounts: 0,
          profiles: 0,
          sessions: 0,
          users: 0,
        });
        const retainedDecisions = await caseApp.db
          .prepare(
            "SELECT outcome FROM application_decision WHERE target_user_id = ?"
          )
          .bind(approvedMember.userId)
          .all<{ outcome: string }>();
        expect(retainedDecisions.results).toEqual([{ outcome: "approved" }]);
        const retainedSecurityOperations = await caseApp.db
          .prepare(
            "SELECT action FROM account_security_operation WHERE user_id = ?"
          )
          .bind(approvedMember.userId)
          .all<{ action: string }>();
        expect(retainedSecurityOperations.results).toEqual([
          { action: "password_confirmed" },
        ]);
        const retainedAudit = await caseApp.db
          .prepare(
            "SELECT action FROM audit_event WHERE target_user_id = ? AND action <> 'account_deleted' ORDER BY id"
          )
          .bind(approvedMember.userId)
          .all<{ action: string }>();
        expect(retainedAudit.results).toEqual(beforeAudit.results);
        expect(
          await caseApp.db
            .prepare(
              "SELECT id, action, actor_user_id, operation_key, target_user_id FROM account_change_operation WHERE id = ?"
            )
            .bind(priorIdentityOperation.id)
            .first()
        ).toEqual(priorIdentityOperation);
        expect(
          await caseApp.db
            .prepare(
              "SELECT action, actor_user_id, target_user_id FROM account_change_operation WHERE actor_user_id = ? AND operation_key = ?"
            )
            .bind(staff.userId, input.operationKey)
            .first()
        ).toEqual({
          action: "account_deleted",
          actor_user_id: staff.userId,
          target_user_id: approvedMember.userId,
        });
        const retainedUsernames = await caseApp.db
          .prepare(
            "SELECT username_key FROM username_reservation WHERE user_id = ? ORDER BY username_key"
          )
          .bind(approvedMember.userId)
          .all<{ username_key: string }>();
        expect(retainedUsernames.results).toEqual([
          { username_key: alias.toLowerCase() },
          { username_key: approvedMember.username },
        ]);
        await expectStatus(approvedMember.context.get("/api/v2/me"), 401);
        await expectStatus(
          approvedMember.context.post("/api/auth/sign-in/username", {
            data: {
              password: approvedMember.password,
              username: alias,
            },
          }),
          401
        );

        const reapplication = applicationInput("reapply");
        await expectStatus(
          staff.context.post("/api/v2/applications", {
            data: { ...reapplication, username: approvedMember.username },
          }),
          409
        );
        await expectStatus(
          staff.context.post("/api/v2/applications", {
            data: { ...reapplication, username: alias },
          }),
          409
        );
        await expectStatus(
          staff.context.post("/api/v2/applications", {
            data: {
              ...reapplication,
              email: approvedMember.email,
              fullName: approvedMember.fullName,
              phone: approvedMember.phone,
            },
          }),
          201
        );
        const audit = await expectStatus(
          staff.context.get("/api/v2/staff/account-audit"),
          200
        );
        const auditBody = await audit.text();
        expect(auditBody).toContain(approvedMember.userId);
        expect(auditBody).toContain("account_deleted");
      }
    );

    for (const table of [
      "enrolment",
      "invitation",
      "department_membership",
      "department_manager_assignment",
    ] as const) {
      deletionTest(
        `stored ${table} history blocks deletion before cascades and retains deactivation`,
        { tag: ["@http", "@risk-atomicity", "@risk-privacy"] },
        async ({ caseApp, account, staff }) => {
          const departmentId = randomUUID();
          const programId = randomUUID();
          const historyId = randomUUID();
          const now = Math.floor(Date.now() / 1000);
          await caseApp.db
            .prepare(
              "INSERT INTO department(id, name, created_at) VALUES(?, ?, ?)"
            )
            .bind(departmentId, "Synthetic department", now)
            .run();
          if (table === "enrolment" || table === "invitation") {
            await caseApp.db
              .prepare(
                "INSERT INTO program(id, department_id, name, created_at) VALUES(?, ?, ?, ?)"
              )
              .bind(programId, departmentId, "Synthetic program", now)
              .run();
          }
          if (table === "enrolment") {
            await caseApp.db
              .prepare(
                "INSERT INTO enrolment(id, user_id, program_id, status, created_at, updated_at) VALUES(?, ?, ?, 'withdrawn', ?, ?)"
              )
              .bind(historyId, account.userId, programId, now, now)
              .run();
          } else if (table === "invitation") {
            await caseApp.db
              .prepare(
                "INSERT INTO invitation(id, user_id, program_id, state, expires_at, created_at) VALUES(?, ?, ?, 'revoked', ?, ?)"
              )
              .bind(historyId, account.userId, programId, now - 10, now)
              .run();
          } else if (table === "department_membership") {
            await caseApp.db
              .prepare(
                "INSERT INTO department_membership(id, user_id, department_id, created_at) VALUES(?, ?, ?, ?)"
              )
              .bind(historyId, account.userId, departmentId, now)
              .run();
          } else {
            await caseApp.db
              .prepare(
                "INSERT INTO department_manager_assignment(id, user_id, department_id, created_at) VALUES(?, ?, ?, ?)"
              )
              .bind(historyId, account.userId, departmentId, now)
              .run();
          }
          const response = await expectStatus(
            staff.context.post("/api/v2/staff/accounts/delete", {
              data: operation(account.userId),
            }),
            409
          );
          expect(
            deletionErrorResponseSchema.parse(await response.json()).error.code
          ).toBe("church_history_retained");
          await expect(
            caseApp.db
              .prepare("DELETE FROM user WHERE id = ?")
              .bind(account.userId)
              .run()
          ).rejects.toThrow();
          const retainedHistory = await caseApp.db
            .prepare(`SELECT id FROM ${table} WHERE user_id = ?`)
            .bind(account.userId)
            .all<{ id: string }>();
          expect(retainedHistory.results).toEqual([{ id: historyId }]);
          expect(
            await caseApp.db
              .prepare("SELECT id FROM user WHERE id = ?")
              .bind(account.userId)
              .first<{ id: string }>()
          ).toEqual({ id: account.userId });
          const deletionAudits = await caseApp.db
            .prepare(
              "SELECT id FROM audit_event WHERE target_user_id = ? AND action = 'account_deleted'"
            )
            .bind(account.userId)
            .all<{ id: string }>();
          expect(deletionAudits.results).toHaveLength(0);
          await expectStatus(
            staff.context.post("/api/v2/staff/accounts/restrictions", {
              data: {
                action: "membership_deactivated",
                operationKey: randomUUID(),
                targetUserId: account.userId,
              },
            }),
            201
          );
        }
      );
    }

    for (const table of [
      "user",
      "account",
      "session",
      "person_profile",
      "audit_event",
      "account_change_operation",
    ] as const) {
      for (const fault of ["ABORT", "IGNORE"] as const) {
        dedicatedDeletionTest(
          `deletion ${table} ${fault} rolls back without a half-delete and retries the original operation`,
          { tag: ["@http", "@risk-atomicity", "@risk-recovery"] },
          async ({ caseApp, account, signedInRequest, staff }) => {
            const input = operation(account.userId);
            const trigger = `fault_deletion_${table}_${fault}`;
            const event =
              table === "audit_event" || table === "account_change_operation"
                ? "INSERT"
                : "DELETE";
            let column = "user_id";
            if (table === "user") {
              column = "id";
            } else if (event === "INSERT") {
              column = "target_user_id";
            }
            const actionFilter =
              event === "INSERT" ? " AND NEW.action = 'account_deleted'" : "";
            const raiser =
              fault === "ABORT"
                ? "RAISE(ABORT, 'Synthetic deletion fault')"
                : "RAISE(IGNORE)";
            await caseApp.db.exec(
              `CREATE TRIGGER ${trigger} BEFORE ${event} ON ${table} WHEN ${event === "DELETE" ? "OLD" : "NEW"}.${column} = '${account.userId}'${actionFilter} BEGIN SELECT ${raiser}; END`
            );
            try {
              await expectStatus(
                staff.context.post("/api/v2/staff/accounts/delete", {
                  data: input,
                }),
                500
              );
            } finally {
              await caseApp.db.exec(`DROP TRIGGER ${trigger}`);
            }
            const triggerRow = await caseApp.db
              .prepare(
                "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = ?"
              )
              .bind(trigger)
              .first<{ name: string }>();
            expect(triggerRow).toBeNull();
            const preserved = await caseApp.db
              .prepare(
                "SELECT (SELECT COUNT(*) FROM user WHERE id = ?) AS users, (SELECT COUNT(*) FROM account WHERE user_id = ?) AS accounts, (SELECT COUNT(*) FROM session WHERE user_id = ?) AS sessions, (SELECT COUNT(*) FROM person_profile WHERE user_id = ?) AS profiles"
              )
              .bind(
                account.userId,
                account.userId,
                account.userId,
                account.userId
              )
              .first<{
                accounts: number;
                profiles: number;
                sessions: number;
                users: number;
              }>();
            expect(preserved).toEqual({
              accounts: 1,
              profiles: 1,
              sessions: 1,
              users: 1,
            });
            await expectStatus(signedInRequest.get("/api/v2/me"), 200);
            const failedWrites = await caseApp.db
              .prepare(
                "SELECT (SELECT COUNT(*) FROM audit_event WHERE target_user_id = ? AND action = 'account_deleted') AS audits, (SELECT COUNT(*) FROM account_change_operation WHERE actor_user_id = ? AND operation_key = ?) AS receipts"
              )
              .bind(account.userId, staff.userId, input.operationKey)
              .first<{ audits: number; receipts: number }>();
            expect(failedWrites).toEqual({ audits: 0, receipts: 0 });

            const retry = await expectStatus(
              staff.context.post("/api/v2/staff/accounts/delete", {
                data: input,
              }),
              201
            );
            expect(await deletionReceipt(retry)).toMatchObject({
              action: "account_deleted",
              targetUserId: account.userId,
            });
            expect(
              await caseApp.db
                .prepare("SELECT id FROM user WHERE id = ?")
                .bind(account.userId)
                .first<{ id: string }>()
            ).toBeNull();
            await expectStatus(signedInRequest.get("/api/v2/me"), 401);
            const completedWrites = await caseApp.db
              .prepare(
                "SELECT (SELECT COUNT(*) FROM audit_event WHERE target_user_id = ? AND action = 'account_deleted') AS audits, (SELECT COUNT(*) FROM account_change_operation WHERE actor_user_id = ? AND operation_key = ?) AS receipts"
              )
              .bind(account.userId, staff.userId, input.operationKey)
              .first<{ audits: number; receipts: number }>();
            expect(completedWrites).toEqual({ audits: 1, receipts: 1 });
          }
        );
      }
    }

    deletionTest(
      "self targets, protected Admin targets, stale proof and revoked Staff authority are denied at the live endpoint",
      { tag: ["@http", "@risk-security", "@risk-authorization"] },
      async ({ caseApp, account, staff }) => {
        const self = await expectStatus(
          staff.context.post("/api/v2/staff/accounts/delete", {
            data: operation(staff.userId),
          }),
          403
        );
        expect(
          deletionErrorResponseSchema.parse(await self.json()).error.code
        ).toBe("business_access_denied");
        const admin = nativeAccount("admin-target", "admin");
        const adminId = await caseApp.provision.account(admin);
        const protectedAdmin = await expectStatus(
          staff.context.post("/api/v2/staff/accounts/delete", {
            data: operation(adminId),
          }),
          403
        );
        expect(
          deletionErrorResponseSchema.parse(await protectedAdmin.json()).error
            .code
        ).toBe("business_access_denied");

        await caseApp.db
          .prepare(
            "UPDATE session SET password_confirmed_at = CAST(strftime('%s', 'now') AS INTEGER) - 601 WHERE user_id = ?"
          )
          .bind(staff.userId)
          .run();
        const stale = await expectStatus(
          staff.context.post("/api/v2/staff/accounts/delete", {
            data: operation(account.userId),
          }),
          403
        );
        expect(
          deletionErrorResponseSchema.parse(await stale.json()).error.code
        ).toBe("password_confirmation_required");
        await expectStatus(
          staff.context.post("/api/v2/account/password-confirmation", {
            data: {
              operationKey: randomUUID(),
              password: staff.account.password,
            },
          }),
          201
        );
        await caseApp.db
          .prepare(
            "UPDATE person_profile SET account_role = 'member' WHERE user_id = ?"
          )
          .bind(staff.userId)
          .run();
        const revokedAuthority = await expectStatus(
          staff.context.post("/api/v2/staff/accounts/delete", {
            data: operation(account.userId),
          }),
          403
        );
        expect(
          deletionErrorResponseSchema.parse(await revokedAuthority.json()).error
            .code
        ).toBe("business_access_denied");
        expect(
          await caseApp.db
            .prepare("SELECT id FROM user WHERE id = ?")
            .bind(account.userId)
            .first<{ id: string }>()
        ).toEqual({ id: account.userId });
      }
    );

    dedicatedDeletionTest(
      "matching concurrent deletion retries keep one original receipt bound to its actor, target and key",
      {
        tag: ["@http", "@risk-concurrency", "@risk-recovery", "@risk-privacy"],
      },
      async ({ caseApp, account, playwright, staff, extraHTTPHeaders }) => {
        const input = operation(account.userId);
        const responses = await Promise.all([
          staff.context.post("/api/v2/staff/accounts/delete", { data: input }),
          staff.context.post("/api/v2/staff/accounts/delete", { data: input }),
        ]);
        expect(
          responses.map((response) => response.status()).toSorted()
        ).toEqual([200, 201]);
        const [firstReceipt, secondReceipt] = await Promise.all(
          responses.map((response) => deletionReceipt(response))
        );
        expect(firstReceipt).toEqual(secondReceipt);
        const writes = await caseApp.db
          .prepare(
            "SELECT (SELECT COUNT(*) FROM audit_event WHERE target_user_id = ? AND action = 'account_deleted') AS audits, (SELECT COUNT(*) FROM account_change_operation WHERE actor_user_id = ? AND operation_key = ?) AS receipts"
          )
          .bind(account.userId, staff.userId, input.operationKey)
          .first<{ audits: number; receipts: number }>();
        expect(writes).toEqual({ audits: 1, receipts: 1 });

        const originalReceipt = await expectStatus(
          staff.context.post("/api/v2/account/changes/reconcile", {
            data: { operationKey: input.operationKey },
          }),
          200
        );
        expect(
          deletionReceiptResponseSchema.parse(await originalReceipt.json()).data
            .receipt
        ).toEqual(firstReceipt);
        const other = nativeAccount("other-target");
        const otherId = await caseApp.provision.account(other);
        const wrongTarget = await expectStatus(
          staff.context.post("/api/v2/staff/accounts/delete", {
            data: { ...input, targetUserId: otherId },
          }),
          409
        );
        expect(
          deletionErrorResponseSchema.parse(await wrongTarget.json()).error.code
        ).toBe("conflict");

        const outsider = nativeAccount("outsider");
        await caseApp.provision.account(outsider);
        const context = await playwright.request.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          await expectStatus(
            context.post("/api/auth/sign-in/username", {
              data: {
                password: outsider.password,
                username: outsider.username,
              },
            }),
            200
          );
          const privateLookup = await expectStatus(
            context.post("/api/v2/account/changes/reconcile", {
              data: { operationKey: input.operationKey },
            }),
            200
          );
          expect(
            deletionReceiptResponseSchema.parse(await privateLookup.json()).data
              .receipt
          ).toBeNull();
        } finally {
          await context.dispose();
        }
      }
    );

    dedicatedDeletionTest(
      "browser deletion keeps drafts and focus through UNKNOWN, retries the same key, then reconciles the disappeared target",
      {
        tag: [
          "@browser",
          "@mobile-critical",
          "@risk-recovery",
          "@risk-privacy",
        ],
      },
      async ({ caseApp, page, approvedMember, staff }, testInfo) => {
        const staffState = await staff.context.storageState();
        await page.context().addCookies(staffState.cookies);
        await page.goto(
          `/staff/accounts?view=people&person=${approvedMember.userId}&task=deletion`
        );
        const region = page.getByRole("region", { name: "永久刪除帳戶" });
        const acknowledgement = region.getByRole("checkbox");
        const review = region.getByRole("region", {
          exact: true,
          name: "核對永久刪除",
        });
        const finalSubmit = region.getByRole("button", {
          name: "確認並永久刪除",
        });
        await expect(
          region.getByRole("button", { exact: true, name: "檢查刪除資料" })
        ).toBeEnabled();
        await region.getByRole("button", { name: "檢查刪除資料" }).click();
        await acknowledgement.check();
        await page
          .getByRole("link", { exact: true, name: "返回帳戶詳情" })
          .click();
        const leaveDialog = page.getByRole("dialog");
        await expect(leaveDialog).toBeVisible();
        await leaveDialog.getByRole("button", { name: "繼續編輯" }).click();
        await expect(acknowledgement).toBeChecked();
        await page
          .getByRole("link", { exact: true, name: "返回帳戶詳情" })
          .click();
        await leaveDialog.getByRole("button", { name: "放棄變更" }).click();
        await expect(
          page.getByRole("link", { name: /永久刪除帳戶/u })
        ).toBeHidden();
        await page.getByText("其他操作", { exact: true }).click();
        await page.getByRole("link", { name: /永久刪除帳戶/u }).click();
        await region.getByRole("button", { name: "檢查刪除資料" }).click();
        await expect(acknowledgement).not.toBeChecked();
        await acknowledgement.check();
        await expect(review).toBeVisible();
        await expect(finalSubmit).toBeEnabled();
        expect(
          await page.evaluate(
            () =>
              document.documentElement.scrollWidth <=
              document.documentElement.clientWidth
          )
        ).toBe(true);
        expect(
          await page.evaluate(() =>
            localStorage.getItem("efcc.deletion.operation.v1")
          )
        ).toBeNull();
        await qualifyPresentation(page, testInfo, "deletion-review", {
          criticalAction: finalSubmit,
          drafts: acknowledgement,
          focus: acknowledgement,
        });

        let reconciliationChecks = 0;
        let requests = 0;
        let serverDeletions = 0;
        const committedReceipts: DeletionReceipt[] = [];
        const submittedInputs: DeletionRequest[] = [];
        await page.route("**/api/v2/staff/accounts/delete", async (route) => {
          requests += 1;
          const input = deletionRequestSchema.parse(
            route.request().postDataJSON()
          );
          submittedInputs.push(input);
          if (requests === 1) {
            await route.abort("failed");
            return;
          }
          serverDeletions += 1;
          const response = await route.fetch();
          expect(response.status()).toBe(201);
          committedReceipts.push(await deletionReceipt(response));
          await route.abort("failed");
        });
        await page.route(
          "**/api/v2/account/changes/reconcile",
          async (route) => {
            reconciliationChecks += 1;
            if (reconciliationChecks === 1) {
              await route.abort("failed");
              return;
            }
            await route.continue();
          }
        );
        await finalSubmit.click();
        await expect(region.getByRole("status")).toContainText("結果仍未確認");
        expect(reconciliationChecks).toBe(1);
        expect(requests).toBe(1);
        expect(serverDeletions).toBe(0);
        await expectStatus(approvedMember.context.get("/api/v2/me"), 200);
        const accountBeforeRetry = await caseApp.db
          .prepare("SELECT id FROM user WHERE id = ?")
          .bind(approvedMember.userId)
          .all<{ id: string }>();
        expect(accountBeforeRetry.results).toHaveLength(1);
        const rawSaved = await page.evaluate(() =>
          localStorage.getItem("efcc.deletion.operation.v1")
        );
        if (!rawSaved) {
          throw new Error("UNKNOWN deletion did not preserve its original key");
        }
        const savedOperation = storedDeletionOperationSchema.safeParse(
          JSON.parse(rawSaved)
        );
        if (!savedOperation.success) {
          throw new Error("UNKNOWN deletion stored invalid operation metadata");
        }
        const saved = savedOperation.data;
        expect(Object.keys(saved).toSorted()).toEqual([
          "action",
          "actorUserId",
          "key",
          "targetUserId",
        ]);
        expect(saved).toEqual({
          action: "account_deleted",
          actorUserId: staff.userId,
          key: saved.key,
          targetUserId: approvedMember.userId,
        });
        await region.getByRole("button", { name: "查核之前的操作" }).click();
        await expect(region.getByRole("status")).toContainText(
          "尚未找到完成紀錄"
        );
        expect(reconciliationChecks).toBe(2);
        await expect(
          region.getByRole("button", { name: "重試同一刪除操作" })
        ).toBeEnabled();
        await region.getByRole("button", { name: "重試同一刪除操作" }).click();
        await expect(region.getByRole("status")).toContainText("伺服器已確認");
        await expect(region.getByRole("status")).toContainText(
          approvedMember.userId
        );
        expect(reconciliationChecks).toBe(3);
        expect(requests).toBe(2);
        expect(serverDeletions).toBe(1);
        expect(submittedInputs).toEqual([
          { operationKey: saved.key, targetUserId: approvedMember.userId },
          { operationKey: saved.key, targetUserId: approvedMember.userId },
        ]);
        expect(committedReceipts).toHaveLength(1);
        const [committedReceipt] = committedReceipts;
        if (!committedReceipt) {
          throw new Error(
            "The actual deletion response did not contain its receipt"
          );
        }
        expect(committedReceipt).toMatchObject({
          action: "account_deleted",
          targetUserId: approvedMember.userId,
        });
        await expectStatus(approvedMember.context.get("/api/v2/me"), 401);
        const durableReceipt = await caseApp.db
          .prepare(
            "SELECT id, action, target_user_id, created_at FROM account_change_operation WHERE actor_user_id = ? AND operation_key = ?"
          )
          .bind(staff.userId, saved.key)
          .first<{
            action: string;
            created_at: number;
            id: string;
            target_user_id: string;
          }>();
        expect(durableReceipt).toEqual({
          action: committedReceipt.action,
          created_at: committedReceipt.createdAt,
          id: committedReceipt.id,
          target_user_id: approvedMember.userId,
        });
        const reconciled = await expectStatus(
          staff.context.post("/api/v2/account/changes/reconcile", {
            data: { operationKey: saved.key },
          }),
          200
        );
        expect(
          deletionReceiptResponseSchema.parse(await reconciled.json()).data
            .receipt
        ).toEqual(committedReceipt);
        await page.reload();
        await expect(region.getByRole("status")).toContainText("伺服器已確認");
        await expect(region.getByRole("status")).toContainText(
          approvedMember.userId
        );
        await page.unrouteAll();
        await page.goto("/staff/account-audit");
        const auditRow = page
          .getByRole("listitem")
          .filter({
            has: page.locator(`span[title="${approvedMember.userId}"]`),
          })
          .filter({ hasText: "永久刪除帳戶" });
        await expect(
          auditRow.getByRole("link", { name: /^永久刪除帳戶/u })
        ).toBeVisible();
        await auditRow.getByRole("link").click();
        const auditDetail = page.getByRole("region", { name: "帳戶紀錄詳情" });
        await expect(
          auditDetail.getByText(approvedMember.userId, { exact: true })
        ).toBeVisible();
        await expect(page.getByRole("main").locator("time")).toContainText(
          "香港"
        );
        await expect(
          page.getByRole("link", { name: "返回帳戶紀錄" })
        ).toBeVisible();
        const deletionAudit = await caseApp.db
          .prepare(
            "SELECT id FROM audit_event WHERE target_user_id = ? AND action = 'account_deleted'"
          )
          .bind(approvedMember.userId)
          .all<{ id: string }>();
        expect(deletionAudit.results).toHaveLength(1);
      }
    );

    deletionTest(
      "browser deletion requires in-task password confirmation and a separate explicit final submit",
      {
        tag: [
          "@browser",
          "@mobile-critical",
          "@risk-security",
          "@risk-privacy",
        ],
      },
      async ({ caseApp, account, page, signedInRequest, staff }, testInfo) => {
        await caseApp.db
          .prepare(
            "UPDATE session SET password_confirmed_at = 0 WHERE user_id = ?"
          )
          .bind(staff.userId)
          .run();
        const staffState = await staff.context.storageState();
        await page.context().addCookies(staffState.cookies);
        await page.goto(
          `/staff/accounts?view=people&person=${account.userId}&task=deletion`
        );
        const region = page.getByRole("region", { name: "永久刪除帳戶" });
        const acknowledgement = region.getByRole("checkbox");
        const finalSubmit = region.getByRole("button", {
          name: "確認並永久刪除",
        });
        let deletionPosts = 0;
        const submittedInputs: DeletionRequest[] = [];
        page.on("request", (request) => {
          if (
            request.method() === "POST" &&
            request.url().endsWith("/api/v2/staff/accounts/delete")
          ) {
            deletionPosts += 1;
            submittedInputs.push(
              deletionRequestSchema.parse(request.postDataJSON())
            );
          }
        });
        await region.getByRole("button", { name: "檢查刪除資料" }).click();
        await acknowledgement.check();
        await expect(
          region.getByRole("region", { exact: true, name: "核對永久刪除" })
        ).toBeVisible();
        expect(deletionPosts).toBe(0);
        await finalSubmit.click();
        const dialog = page.getByRole("dialog");
        await expect(
          dialog.getByRole("heading", { exact: true, name: "確認目前密碼" })
        ).toBeVisible();
        expect(deletionPosts).toBe(0);
        expect(
          await page.evaluate(() =>
            localStorage.getItem("efcc.deletion.operation.v1")
          )
        ).toBeNull();
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
          region.getByRole("region", { exact: true, name: "核對永久刪除" })
        ).toBeVisible();
        expect(deletionPosts).toBe(0);
        expect(
          await page.evaluate(() =>
            localStorage.getItem("efcc.deletion.operation.v1")
          )
        ).toBeNull();
        await expect(acknowledgement).toBeChecked();
        await qualifyPresentation(page, testInfo, "deletion-confirmation", {
          criticalAction: finalSubmit,
          drafts: acknowledgement,
          focus: acknowledgement,
        });
        await finalSubmit.click();
        await expect(region.getByRole("status")).toContainText("伺服器已確認");
        await expect(region.getByRole("status")).toContainText(account.userId);
        expect(deletionPosts).toBe(1);
        expect(submittedInputs).toHaveLength(1);
        expect(submittedInputs[0]?.targetUserId).toBe(account.userId);
        expect(
          await caseApp.db
            .prepare("SELECT id FROM user WHERE id = ?")
            .bind(account.userId)
            .first<{ id: string }>()
        ).toBeNull();
        expect(
          await caseApp.db
            .prepare(
              "SELECT COUNT(*) AS count FROM audit_event WHERE target_user_id = ? AND action = 'account_deleted'"
            )
            .bind(account.userId)
            .first<{ count: number }>()
        ).toEqual({ count: 1 });
        await expectStatus(signedInRequest.get("/api/v2/me"), 401);
      }
    );

    deletionTest(
      "deletion keeps deferred native auth routes closed for removed and replacement accounts",
      { tag: ["@http", "@risk-security", "@risk-privacy"] },
      async ({
        caseApp,
        account,
        extraHTTPHeaders,
        playwright,
        signedInRequest,
        staff,
      }) => {
        await expectStatus(
          staff.context.post("/api/v2/staff/accounts/delete", {
            data: operation(account.userId),
          }),
          201
        );
        const replacement = nativeAccount("replacement");
        await caseApp.provision.account(replacement);
        const replacementContext = await playwright.request.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          await expectStatus(
            replacementContext.post("/api/auth/sign-in/username", {
              data: {
                password: replacement.password,
                username: replacement.username,
              },
            }),
            200
          );
          await Promise.all(
            [signedInRequest, replacementContext].flatMap((actor) =>
              [
                "delete-user",
                "sign-in/email",
                "request-password-reset",
                "reset-password",
                "send-verification-email",
                "verify-email",
              ].map((path) =>
                expectStatus(
                  actor.post(`/api/auth/${path}`, {
                    data: {
                      email: replacement.email,
                      password: replacement.password,
                      token: "synthetic",
                    },
                  }),
                  404
                )
              )
            )
          );
        } finally {
          await replacementContext.dispose();
        }
      }
    );

    dedicatedDeletionTest(
      "last-effective-Admin protections count durable authority without a session and survive competing deletions",
      {
        tag: [
          "@http",
          "@risk-concurrency",
          "@risk-atomicity",
          "@risk-security",
        ],
      },
      async ({ caseApp, extraHTTPHeaders, playwright }) => {
        const first = nativeAccount("admin-first", "admin");
        const second = nativeAccount("admin-second", "admin");
        const firstId = await caseApp.provision.account(first);
        const secondId = await caseApp.provision.account(second);
        expect(
          await caseApp.db
            .prepare("SELECT COUNT(*) AS count FROM session WHERE user_id = ?")
            .bind(secondId)
            .first<{ count: number }>()
        ).toEqual({ count: 0 });
        await caseApp.db
          .prepare(
            "UPDATE person_profile SET membership_status = 'deactivated' WHERE user_id = ?"
          )
          .bind(firstId)
          .run();
        await expect(
          caseApp.db
            .prepare(
              "UPDATE person_profile SET banned_at = CAST(strftime('%s', 'now') AS INTEGER) WHERE user_id = ?"
            )
            .bind(secondId)
            .run()
        ).rejects.toThrow();
        await expect(
          caseApp.db
            .prepare(
              "UPDATE person_profile SET account_role = 'member' WHERE user_id = ?"
            )
            .bind(secondId)
            .run()
        ).rejects.toThrow();
        await expect(
          caseApp.db
            .prepare("DELETE FROM user WHERE id = ?")
            .bind(secondId)
            .run()
        ).rejects.toThrow();
        await caseApp.db
          .prepare(
            "UPDATE person_profile SET membership_status = 'active' WHERE user_id = ?"
          )
          .bind(firstId)
          .run();

        const contexts: APIRequestContext[] = [];
        try {
          const firstContext = await playwright.request.newContext({
            baseURL: caseApp.origin,
            extraHTTPHeaders: {
              ...extraHTTPHeaders,
              "cf-connecting-ip": "198.28.1.1",
            },
          });
          contexts.push(firstContext);
          const secondContext = await playwright.request.newContext({
            baseURL: caseApp.origin,
            extraHTTPHeaders: {
              ...extraHTTPHeaders,
              "cf-connecting-ip": "198.29.1.1",
            },
          });
          contexts.push(secondContext);
          await expectStatus(
            firstContext.post("/api/auth/sign-in/username", {
              data: { password: first.password, username: first.username },
            }),
            200
          );
          await expectStatus(
            secondContext.post("/api/auth/sign-in/username", {
              data: { password: second.password, username: second.username },
            }),
            200
          );
          await expectStatus(
            firstContext.post("/api/v2/account/password-confirmation", {
              data: { operationKey: randomUUID(), password: first.password },
            }),
            201
          );
          await expectStatus(
            secondContext.post("/api/v2/account/password-confirmation", {
              data: { operationKey: randomUUID(), password: second.password },
            }),
            201
          );
          const results = await Promise.all([
            firstContext.post("/api/v2/staff/accounts/delete", {
              data: operation(secondId),
            }),
            secondContext.post("/api/v2/staff/accounts/delete", {
              data: operation(firstId),
            }),
          ]);
          const outcomes = results.map((response) => response.status());
          expect(outcomes.filter((status) => status === 201)).toHaveLength(1);
          expect(
            outcomes.every((status) => [201, 401, 403, 409].includes(status))
          ).toBe(true);
          const remaining = await caseApp.db
            .prepare(
              "SELECT COUNT(*) AS count FROM person_profile WHERE account_role = 'admin' AND membership_status = 'active' AND banned_at IS NULL"
            )
            .first<{ count: number }>();
          expect(remaining).toEqual({ count: 1 });
          expect(
            await caseApp.db
              .prepare(
                "SELECT COUNT(*) AS count FROM account_change_operation WHERE action = 'account_deleted' AND target_user_id IN (?, ?)"
              )
              .bind(firstId, secondId)
              .first<{ count: number }>()
          ).toEqual({ count: 1 });
        } finally {
          await Promise.all(contexts.map((context) => context.dispose()));
        }
      }
    );

    dedicatedDeletionTest(
      "deletion origin and database limits preserve private current-state reads",
      { tag: ["@http", "@risk-security", "@risk-resilience"] },
      async ({ staff }) => {
        await expectStatus(
          staff.context.post("/api/v2/staff/accounts/delete", {
            data: operation("synthetic-target"),
            headers: { origin: "https://foreign.example" },
          }),
          403
        );
        for (let index = 0; index < 10; index += 1) {
          // Request order establishes the exact database limiter boundary.
          // eslint-disable-next-line no-await-in-loop -- Keep the real request order.
          await expectStatus(
            staff.context.post("/api/v2/staff/accounts/delete", {
              data: { operationKey: randomUUID() },
            }),
            400
          );
        }
        await expectStatus(
          staff.context.post("/api/v2/staff/accounts/delete", {
            data: { operationKey: randomUUID() },
          }),
          429
        );
        const accounts = await expectStatus(
          staff.context.get("/api/v2/staff/accounts"),
          200
        );
        expect(accounts.headers()["cache-control"]).toContain("no-store");
      }
    );

    deletionTest(
      "deletion removes issued temporary credentials and reissue state without deleting recovery audit",
      { tag: ["@http", "@risk-security", "@risk-privacy"] },
      async ({ caseApp, account, signedInRequest, staff }) => {
        const reset = await expectStatus(
          staff.context.post("/api/v2/staff/accounts/password-reset", {
            data: {
              identityCheck: "face_to_face",
              operationKey: randomUUID(),
              targetUserId: account.userId,
            },
          }),
          201
        );
        const resetBody = passwordResetResponseSchema.parse(await reset.json());
        await expectStatus(
          staff.context.post("/api/v2/staff/accounts/delete", {
            data: operation(account.userId),
          }),
          201
        );
        await expectStatus(
          signedInRequest.post("/api/auth/sign-in/username", {
            data: {
              password: resetBody.data.temporaryPassword,
              username: account.username,
            },
          }),
          401
        );
        await expectStatus(
          staff.context.post("/api/v2/staff/accounts/password-reissue", {
            data: {
              identityCheck: "face_to_face",
              operationKey: randomUUID(),
              targetUserId: account.userId,
            },
          }),
          403
        );
        const credentialAudit = await caseApp.db
          .prepare(
            "SELECT action FROM staff_account_operation WHERE target_user_id = ?"
          )
          .bind(account.userId)
          .all<{ action: string }>();
        expect(credentialAudit.results).toEqual([
          { action: "staff_password_reset" },
        ]);
        expect(
          await caseApp.db
            .prepare("SELECT id FROM account WHERE user_id = ?")
            .bind(account.userId)
            .first<{ id: string }>()
        ).toBeNull();
      }
    );

    dedicatedDeletionTest(
      "history denial keeps the member active and links the same target to deactivation",
      {
        tag: [
          "@browser",
          "@mobile-critical",
          "@risk-atomicity",
          "@risk-privacy",
        ],
      },
      async ({ caseApp, account, page, signedInRequest, staff }, testInfo) => {
        const departmentId = randomUUID();
        await caseApp.db
          .prepare(
            "INSERT INTO department(id, name, created_at) VALUES(?, ?, CAST(strftime('%s', 'now') AS INTEGER))"
          )
          .bind(departmentId, "Synthetic history")
          .run();
        await caseApp.db
          .prepare(
            "INSERT INTO department_membership(id, department_id, user_id, created_at) VALUES(?, ?, ?, CAST(strftime('%s', 'now') AS INTEGER))"
          )
          .bind(randomUUID(), departmentId, account.userId)
          .run();
        const staffState = await staff.context.storageState();
        await page.context().addCookies(staffState.cookies);
        await page.goto(
          `/staff/accounts?view=people&person=${account.userId}&task=deletion`
        );
        const region = page.getByRole("region", { name: "永久刪除帳戶" });
        const acknowledgement = region.getByRole("checkbox");
        const deactivation = page.getByRole("link", {
          name: "改為停用會籍",
        });
        await region.getByRole("button", { name: "檢查刪除資料" }).click();
        await acknowledgement.check();
        await expect(
          region.getByRole("region", { exact: true, name: "核對永久刪除" })
        ).toBeVisible();
        await region.getByRole("button", { name: "確認並永久刪除" }).click();
        await expect(region.getByRole("status")).toContainText(
          "有教會業務紀錄，不能永久刪除"
        );
        await expect(
          region.getByRole("button", { name: "確認並永久刪除" })
        ).toBeDisabled();
        expect(
          await page.evaluate(() =>
            localStorage.getItem("efcc.deletion.operation.v1")
          )
        ).toBeNull();
        await expectStatus(signedInRequest.get("/api/v2/me"), 200);
        await qualifyPresentation(page, testInfo, "deletion-history", {
          criticalAction: deactivation,
          drafts: acknowledgement,
          focus: deactivation,
        });
        await deactivation.click();
        const leaveDialog = page.getByRole("dialog");
        await expect(leaveDialog).toBeVisible();
        await leaveDialog.getByRole("button", { name: "放棄變更" }).click();
        await expect(page).toHaveURL(/task=restrictions/u);
        await expect(
          page.getByRole("region", { name: "會籍與安全限制" })
        ).toBeVisible();
        expect(
          await caseApp.db
            .prepare(
              "SELECT membership_status FROM person_profile WHERE user_id = ?"
            )
            .bind(account.userId)
            .first<{ membership_status: string }>()
        ).toEqual({ membership_status: "active" });
      }
    );
  }
);
