/* eslint-disable no-await-in-loop, unicorn/no-await-expression-member -- Ordered HTTP calls and direct native D1 observations preserve the original transaction, limiter and credential-race claims. */
import { randomBytes, randomUUID } from "node:crypto";

import { expect, test } from "../../support/fixtures";
import {
  expectResponseStatus,
  staffData,
  issuedCredential,
  errorCode,
  creation,
  syntheticAccount,
  accountId,
  credentialRow,
  creationEffects,
  dedicatedTest,
} from "./fixtures";
import type { RecoveryInput } from "./fixtures";

test.describe(
  "transaction-rollback",
  { tag: ["@native", "@account-assisted"] },
  () => {
    test.describe("HTTP contracts", { tag: ["@http"] }, () => {
      for (const table of [
        "account",
        "person_profile",
        "audit_event",
      ] as const) {
        const faults =
          table === "person_profile"
            ? ["ABORT", "IGNORE", "SEARCH_PROJECTION_CORRUPTION"]
            : ["ABORT", "IGNORE"];
        for (const fault of faults) {
          dedicatedTest(
            `assisted creation ${table} ${fault} leaves no partial canonical account and retries the original operation`,
            {
              tag: ["@risk-atomicity", "@risk-recovery"],
            },
            async ({ caseApp, staff }) => {
              const input = creation();
              const trigger = `synthetic_assisted_${table}_${fault.toLowerCase()}_${randomBytes(5).toString("hex")}`;
              const field =
                table === "audit_event" ? "target_user_id" : "user_id";
              if (fault === "SEARCH_PROJECTION_CORRUPTION") {
                await caseApp.db
                  .prepare(`CREATE TRIGGER ${trigger} AFTER INSERT ON person_profile
                    WHEN NEW.user_id = (SELECT id FROM user WHERE username = '${input.username}')
                    BEGIN
                      UPDATE person_profile SET staff_search_key = 'corrupt projection' WHERE user_id = NEW.user_id;
                    END`)
                  .run();
              } else {
                const raiser =
                  fault === "ABORT"
                    ? "RAISE(ABORT, 'Synthetic assisted write failure')"
                    : "RAISE(IGNORE)";
                await caseApp.db
                  .prepare(
                    `CREATE TRIGGER ${trigger} BEFORE INSERT ON ${table} WHEN NEW.${field} = (SELECT id FROM user WHERE username = '${input.username}') BEGIN SELECT ${raiser}; END`
                  )
                  .run();
              }
              try {
                const failed = await expectResponseStatus(
                  staff.context.post("/api/v2/staff/accounts", { data: input }),
                  500
                );
                expect(await errorCode(failed)).toBe("internal_error");
                expect(
                  await creationEffects(caseApp, input.username, null)
                ).toEqual({
                  audits: 0,
                  credentials: 0,
                  plaintext: 0,
                  profiles: 0,
                  receipts: 0,
                  reservations: 0,
                  users: 0,
                });
                const unknown = await expectResponseStatus(
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
                  await expectResponseStatus(
                    staff.context.post("/api/v2/staff/accounts", {
                      data: input,
                    }),
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
                await caseApp.db
                  .prepare(
                    "SELECT staff_search_key FROM person_profile WHERE user_id = ?"
                  )
                  .bind(targetUserId)
                  .first<{ staff_search_key: string | null }>()
              ).toEqual({
                staff_search_key:
                  `${input.fullName} ${input.username}`.toLowerCase(),
              });
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
              tag: ["@risk-atomicity", "@risk-recovery", "@risk-security"],
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
                await expectResponseStatus(
                  person.post("/api/auth/sign-in/username", {
                    data: {
                      password: holder.password,
                      username: holder.username,
                    },
                  }),
                  200
                );
                const before = await credentialRow(caseApp, targetUserId);
                if (!before) {
                  throw new Error(
                    "Recovery target credential was not provisioned"
                  );
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
                  const failed = await expectResponseStatus(
                    staff.context.post(
                      "/api/v2/staff/accounts/password-reset",
                      {
                        data: input,
                      }
                    ),
                    500
                  );
                  expect(await errorCode(failed)).toBe("internal_error");
                  expect(await credentialRow(caseApp, targetUserId)).toEqual(
                    before
                  );
                  const survivingSessions = await caseApp.db
                    .prepare("SELECT id FROM session WHERE user_id = ?")
                    .bind(targetUserId)
                    .all<{ id: string }>();
                  expect(survivingSessions.results).toHaveLength(1);
                  await expectResponseStatus(person.get("/api/v2/me"), 200);
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
                  const unknown = await expectResponseStatus(
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
                    await expectResponseStatus(
                      staff.context.post(
                        "/api/v2/staff/accounts/password-reset",
                        {
                          data: input,
                        }
                      ),
                      201
                    )
                  )
                );
                expect(retry.receipt).toMatchObject({
                  action: "staff_password_reset",
                  targetUserId,
                });
                expect(
                  await credentialRow(caseApp, targetUserId)
                ).toMatchObject({
                  credential_revision: before.credential_revision + 1,
                  temporary_password_expires_at:
                    retry.temporaryPasswordExpiresAt,
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
                  await expectResponseStatus(
                    oldPassword.post("/api/auth/sign-in/username", {
                      data: {
                        password: holder.password,
                        username: holder.username,
                      },
                    }),
                    401
                  );
                  await expectResponseStatus(
                    oldPassword.post("/api/auth/sign-in/username", {
                      data: {
                        password: retry.temporaryPassword,
                        username: holder.username,
                      },
                    }),
                    200
                  );
                  const firstUse = await expectResponseStatus(
                    oldPassword.get("/api/v2/me"),
                    403
                  );
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
        "sibling self-application and decision receipts roll back ignored final writes",
        {
          tag: ["@risk-atomicity", "@risk-recovery"],
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
              await expectResponseStatus(
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
              await caseApp.db
                .prepare(`DROP TRIGGER ${applicationTrigger}`)
                .run();
            }
            await expectResponseStatus(
              publicRequest.post("/api/v2/applications", { data: applicant }),
              201
            );
            const applicantId = await accountId(caseApp, applicant.username);
            const application = await caseApp.db
              .prepare(
                "SELECT id FROM membership_application WHERE user_id = ?"
              )
              .bind(applicantId)
              .first<{ id: string }>();
            if (!application) {
              throw new Error(
                "The public application did not persist after retry"
              );
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
              await expectResponseStatus(
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
            await expectResponseStatus(
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
          tag: ["@risk-atomicity", "@risk-security"],
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
            await expectResponseStatus(
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
            await expectResponseStatus(staff.context.get("/api/v2/me"), 200);
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
          await expectResponseStatus(
            staff.context.post("/api/v2/account/password", { data: input }),
            201
          );
          await expectResponseStatus(staff.context.get("/api/v2/me"), 200);
        }
      );

      dedicatedTest(
        "an ignored final Staff receipt cannot leave an orphan account, audit or credential",
        {
          tag: ["@risk-atomicity", "@risk-recovery", "@risk-privacy"],
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
            const failed = await expectResponseStatus(
              staff.context.post("/api/v2/staff/accounts", { data: input }),
              500
            );
            expect(await errorCode(failed)).toBe("internal_error");
            expect(
              await creationEffects(caseApp, input.username, null)
            ).toEqual({
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
              await expectResponseStatus(
                staff.context.post("/api/v2/staff/accounts", { data: input }),
                201
              )
            )
          );
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
        }
      );
    });
  }
);
