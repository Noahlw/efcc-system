/* eslint-disable no-await-in-loop, unicorn/no-await-expression-member -- Ordered HTTP calls and direct native D1 observations preserve the original transaction, limiter and credential-race claims. */
import { randomUUID } from "node:crypto";

import type { APIResponse } from "@playwright/test";

import { storedStaffAccountOperationSchema } from "../../../src/features/account/assisted-accounts/staff-account-contract";
import { expect, test } from "../../support/fixtures";
import type { NativeApp } from "../../support/fixtures";
import { qualifyPresentation } from "../presentation-assertions";
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
  dedicatedCredentialTest,
  creationDrafts,
  recoveryDrafts,
} from "./fixtures";
import type { RecoveryInput } from "./fixtures";

test.describe(
  "credential-lifecycle",
  { tag: ["@native", "@account-assisted"] },
  () => {
    test.describe("HTTP contracts", { tag: ["@http"] }, () => {
      // This is the public native verifier control from N11, not another Worker
      // process. A dedicated store owns each native password-verification race.
      dedicatedCredentialTest(
        "paused old-password native username and name sign-ins cannot mint sessions across Staff recovery",
        {
          tag: [
            "@risk-auth",
            "@risk-concurrency",
            "@risk-security",
            "@risk-verifier-race",
          ],
        },
        async ({
          caseApp,
          credential,
          extraHTTPHeaders,
          playwright,
          staff,
        }) => {
          const context = await playwright.request.newContext({
            baseURL: caseApp.origin,
            extraHTTPHeaders: {
              ...extraHTTPHeaders,
              "cf-connecting-ip": "198.19.77.31",
            },
          });
          try {
            const racedTargetIds: string[] = [];
            for (const choice of ["username", "name"] as const) {
              const holder = syntheticAccount(`race-${choice}`);
              const targetUserId = await caseApp.provision.account(holder);
              racedTargetIds.push(targetUserId);
              const before = await credential.verified();
              await credential.arm();
              let pending: Promise<APIResponse> | undefined;
              try {
                pending = context.post(`/api/auth/sign-in/${choice}`, {
                  data:
                    choice === "username"
                      ? { password: holder.password, username: holder.username }
                      : {
                          fullName: holder.fullName,
                          password: holder.password,
                        },
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
                const resetResponse = await expectResponseStatus(
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
                await expectResponseStatus(
                  context.post(`/api/auth/sign-in/${choice}`, {
                    data:
                      choice === "username"
                        ? {
                            password: holder.password,
                            username: holder.username,
                          }
                        : {
                            fullName: holder.fullName,
                            password: holder.password,
                          },
                  }),
                  401
                );
                await expectResponseStatus(
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
                await expectResponseStatus(context.get("/api/v2/me"), 403);
                const permanentPassword = `Synthetic-first-change-${choice}!`;
                await expectResponseStatus(
                  context.post("/api/v2/account/password", {
                    data: {
                      currentPassword: reset.temporaryPassword,
                      newPassword: permanentPassword,
                      operationKey: randomUUID(),
                    },
                  }),
                  201
                );
                await expectResponseStatus(context.get("/api/v2/me"), 200);
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
            const [usernameTargetId, nameTargetId] = racedTargetIds;
            if (!(usernameTargetId && nameTargetId)) {
              throw new Error("Expected both native sign-in targets");
            }
            expect(
              await caseApp.db
                .prepare(
                  "SELECT COUNT(*) AS count FROM session WHERE user_id IN (?, ?)"
                )
                .bind(usernameTargetId, nameTargetId)
                .first<{ count: number }>()
            ).toEqual({ count: 2 });
            expect(JSON.stringify(caseApp.harness.getLogs())).not.toMatch(
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
          tag: [
            "@risk-concurrency",
            "@risk-recovery",
            "@risk-privacy",
            "@risk-actor-target-key",
            "@risk-non-replay",
          ],
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
          expect(
            responses.map((response) => response.status()).toSorted()
          ).toEqual([200, 201]);
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
            throw new Error(
              "Matching recovery did not return its original receipt"
            );
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
              .bind(
                targetUserId,
                staff.userId,
                input.operationKey,
                targetUserId
              )
              .first<{ audits: number; receipts: number }>()
          ).toEqual({ audits: 1, receipts: 1 });

          const otherTarget = syntheticAccount("wrong-recovery-target");
          const otherTargetId = await caseApp.provision.account(otherTarget);
          const wrongTarget = await expectResponseStatus(
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
          const reconciled = await expectResponseStatus(
            staff.context.post("/api/v2/staff/accounts/reconcile", {
              data: { operationKey: input.operationKey },
            }),
            200
          );
          expect((await staffData(reconciled)).receipt).toEqual(
            original.receipt
          );
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
            await expectResponseStatus(
              outsiderContext.post("/api/auth/sign-in/username", {
                data: {
                  password: outsider.password,
                  username: outsider.username,
                },
              }),
              200
            );
            const privateReceipt = await expectResponseStatus(
              outsiderContext.post("/api/v2/staff/accounts/reconcile", {
                data: { operationKey: input.operationKey },
              }),
              403
            );
            expect(await errorCode(privateReceipt)).toBe(
              "business_access_denied"
            );
          } finally {
            await outsiderContext.dispose();
          }
        }
      );

      test(
        "Staff recovery requires established identity evidence and revokes existing native credentials and sessions",
        {
          tag: ["@risk-auth", "@risk-security", "@risk-privacy"],
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
            await expectResponseStatus(
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
                await expectResponseStatus(
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
            await expectResponseStatus(person.get("/api/v2/me"), 401);
            await expectResponseStatus(
              person.post("/api/auth/sign-in/username", {
                data: { password: holder.password, username: holder.username },
              }),
              401
            );
            await expectResponseStatus(
              person.post("/api/auth/sign-in/username", {
                data: {
                  password: reset.temporaryPassword,
                  username: holder.username,
                },
              }),
              200
            );
            const firstUse = await expectResponseStatus(
              person.get("/api/v2/me"),
              403
            );
            expect(await firstUse.json()).toMatchObject({
              error: { code: "password_change_required" },
            });
            const unverifiedPhone = await expectResponseStatus(
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
            await expectResponseStatus(
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
            const replay = await expectResponseStatus(
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
        "expired temporary credentials require private reissue; Ban denies first change until explicit Unban",
        {
          tag: ["@risk-auth", "@risk-security", "@risk-recovery"],
        },
        async ({ caseApp, extraHTTPHeaders, playwright, staff }) => {
          const input = creation();
          const original = issuedCredential(
            await staffData(
              await expectResponseStatus(
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
            await expectResponseStatus(
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
            await expectResponseStatus(
              person.post("/api/v2/account/password", {
                data: {
                  currentPassword: original.temporaryPassword,
                  newPassword: "Synthetic-after-expiry!",
                  operationKey: randomUUID(),
                },
              }),
              403
            );
            const expired = await expectResponseStatus(
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
                await expectResponseStatus(
                  staff.context.post(
                    "/api/v2/staff/accounts/password-reissue",
                    {
                      data: reissueInput,
                    }
                  ),
                  201
                )
              )
            );
            expect(reissued.receipt?.action).toBe(
              "temporary_password_reissued"
            );
            expect(await credentialRow(caseApp, targetUserId)).toMatchObject({
              credential_revision: 1,
              temporary_password_expires_at:
                reissued.temporaryPasswordExpiresAt,
            });
            const creationReplay = await expectResponseStatus(
              staff.context.post("/api/v2/staff/accounts", { data: input }),
              200
            );
            expect(await staffData(creationReplay)).toEqual({
              receipt: original.receipt,
            });
            const reissueReplay = await expectResponseStatus(
              staff.context.post("/api/v2/staff/accounts/password-reissue", {
                data: reissueInput,
              }),
              200
            );
            expect(await staffData(reissueReplay)).toEqual({
              receipt: reissued.receipt,
            });
            expect(reissued.temporaryPassword).not.toBe(
              original.temporaryPassword
            );
            await expectResponseStatus(
              person.get("/api/v2/account/security"),
              401
            );
            await expectResponseStatus(
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
              await expectResponseStatus(
                reissuedPerson.post("/api/auth/sign-in/name", {
                  data: {
                    fullName: input.fullName,
                    password: reissued.temporaryPassword,
                  },
                }),
                200
              );
              await expectResponseStatus(reissuedPerson.get("/api/v2/me"), 403);
              // CR-02.P3 supersedes the former Banned first-change success policy.
              await expectResponseStatus(
                reissuedPerson.post("/api/v2/account/password", {
                  data: {
                    currentPassword: reissued.temporaryPassword,
                    newPassword: "Synthetic-final-holder-password!",
                    operationKey: randomUUID(),
                  },
                }),
                403
              );
              expect(await credentialRow(caseApp, targetUserId)).toMatchObject({
                credential_revision: 1,
                temporary_password_expires_at:
                  reissued.temporaryPasswordExpiresAt,
              });
              await expectResponseStatus(
                staff.context.post("/api/v2/staff/accounts/restrictions", {
                  data: {
                    action: "account_unbanned",
                    operationKey: randomUUID(),
                    targetUserId,
                  },
                }),
                201
              );
              await expectResponseStatus(
                reissuedPerson.post("/api/v2/account/password", {
                  data: {
                    currentPassword: reissued.temporaryPassword,
                    newPassword: "Synthetic-final-holder-password!",
                    operationKey: randomUUID(),
                  },
                }),
                201
              );
              const restricted = await expectResponseStatus(
                reissuedPerson.get("/api/v2/me"),
                403
              );
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
            ).toEqual({ banned: 0, membership_status: "deactivated" });
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
          tag: ["@risk-auth", "@risk-security", "@risk-privacy"],
        },
        async ({ caseApp, extraHTTPHeaders, playwright, staff }) => {
          const input = creation();
          const response = await expectResponseStatus(
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
          const replay = await expectResponseStatus(
            staff.context.post("/api/v2/staff/accounts", { data: input }),
            200
          );
          expect(await staffData(replay)).toEqual({
            receipt: original.receipt,
          });
          expect(
            await creationEffects(
              caseApp,
              input.username,
              original.temporaryPassword
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

          const person = await playwright.request.newContext({
            baseURL: caseApp.origin,
            extraHTTPHeaders: {
              ...extraHTTPHeaders,
              "cf-connecting-ip": "198.19.77.63",
            },
          });
          try {
            await expectResponseStatus(
              person.post("/api/auth/sign-in/username", {
                data: {
                  password: original.temporaryPassword,
                  username: input.username,
                },
              }),
              200
            );
            const gated = await expectResponseStatus(
              person.get("/api/v2/me"),
              403
            );
            expect(await gated.json()).toMatchObject({
              error: { code: "password_change_required" },
            });
            await expectResponseStatus(
              person.post("/api/v2/account/sessions/revoke-others", {
                data: { operationKey: randomUUID() },
              }),
              403
            );
            const home = await person.get("/", { maxRedirects: 0 });
            expect(home.headers().location).toContain("/account");
            const security = await expectResponseStatus(
              person.get("/api/v2/account/security"),
              200
            );
            const securityBody = await security.json();
            expect(securityBody.data.state.temporaryPasswordExpiresAt).toBe(
              (await credentialRow(caseApp, targetUserId))
                ?.temporary_password_expires_at
            );
            await expectResponseStatus(
              person.post("/api/v2/account/password", {
                data: {
                  currentPassword: original.temporaryPassword,
                  newPassword: "Synthetic-holder-password!",
                  operationKey: randomUUID(),
                },
              }),
              201
            );
            await expectResponseStatus(person.get("/api/v2/me"), 200);
          } finally {
            await person.dispose();
          }
        }
      );
    });
    test.describe("Browser journeys", { tag: ["@browser"] }, () => {
      test(
        "another staff member cannot query or replace a retained operation",
        {
          tag: ["@risk-privacy", "@risk-actor-target-key", "@mobile-critical"],
        },
        async ({ caseApp, staff, staffPage: page }, testInfo) => {
          const holder = syntheticAccount("foreign-recovery-target");
          const targetUserId = await caseApp.provision.account(holder);
          const secondAccount = syntheticAccount(
            "foreign-recovery-actor",
            "staff"
          );
          await caseApp.provision.account(secondAccount);
          const saved = {
            action: "temporary_password_reissued",
            actorUserId: staff.userId,
            identityCheck: "face_to_face",
            key: randomUUID(),
            targetUserId,
          };
          await page.goto("/staff/accounts?task=create");
          await expect(
            page.getByLabel("中文全名", { exact: true })
          ).toBeVisible();
          await page.evaluate((operation) => {
            localStorage.setItem(
              "efcc.staff-account.operation.v1",
              JSON.stringify(operation)
            );
          }, saved);
          const originalRaw = JSON.stringify(saved);
          // Leave the old actor's live task before signing in: its authority-loss
          // refresh must not race the new actor's explicit task navigation.
          await page.goto("about:blank");
          await expectResponseStatus(
            page.request.post("/api/auth/sign-in/username", {
              data: {
                password: secondAccount.password,
                username: secondAccount.username,
              },
            }),
            200
          );
          let operationRequests = 0;
          page.on("request", (request) => {
            if (
              request.method() === "POST" &&
              new URL(request.url()).pathname.startsWith(
                "/api/v2/staff/accounts"
              )
            ) {
              operationRequests += 1;
            }
          });
          await page.goto(
            `/staff/accounts?view=people&person=${targetUserId}&task=recovery`
          );
          await expect(
            page.getByRole("heading", {
              exact: true,
              name: "請用原職員帳戶繼續",
            })
          ).toBeVisible();
          await expect(
            page.getByRole("button", { exact: true, name: "重新查詢" })
          ).toHaveCount(0);
          await expect(
            page.getByRole("button", { exact: true, name: "檢查資料" })
          ).toHaveCount(0);
          await expect(
            page.getByText(holder.fullName, { exact: false }).first()
          ).toBeHidden();
          await expect(page.getByText(saved.key, { exact: true })).toHaveCount(
            0
          );
          const returnToAccount = page.getByRole("link", {
            exact: true,
            name: "返回帳戶詳情",
          });
          await qualifyPresentation(page, testInfo, "foreign-operation", {
            criticalAction: returnToAccount,
            drafts: recoveryDrafts(page),
            focus: returnToAccount,
          });
          await page.evaluate(() => {
            window.dispatchEvent(new Event("online"));
          });
          await page.reload();
          await expect(
            page.getByRole("heading", {
              exact: true,
              name: "請用原職員帳戶繼續",
            })
          ).toBeVisible();
          expect(operationRequests).toBe(0);
          expect(
            await page.evaluate(() =>
              localStorage.getItem("efcc.staff-account.operation.v1")
            )
          ).toBe(originalRaw);
          expect(
            await caseApp.db
              .prepare(
                "SELECT count(*) AS count FROM staff_account_operation WHERE operation_key = ?"
              )
              .bind(saved.key)
              .first()
          ).toEqual({ count: 0 });
        }
      );
      // The reissue request never reaches the Worker on the first attempt. After a
      // browser reload, the original actor/target/key is retained, verification must
      // be repeated, and the explicit final submit retries that same operation.
      test(
        "restored missing reissue rechecks verification and retries the original operation",
        {
          tag: [
            "@risk-recovery",
            "@risk-privacy",
            "@risk-actor-target-key",
            "@risk-non-replay",
            "@mobile-critical",
          ],
        },
        async ({ caseApp, staff, staffPage: page }, testInfo) => {
          const input = creation();
          const createdResponse = await expectResponseStatus(
            staff.context.post("/api/v2/staff/accounts", { data: input }),
            201
          );
          const created = issuedCredential(await staffData(createdResponse));
          const targetUserId = created.receipt?.targetUserId;
          if (!targetUserId) {
            throw new Error(
              "Staff creation did not identify its target account"
            );
          }

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
          await page.route(
            "**/api/v2/staff/accounts/password-reissue",
            (route) => route.abort("failed")
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
          await expect(
            page.getByRole("heading", { exact: true, name: "檢查重新發出" })
          ).toBeVisible();
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
            throw new Error(
              "UNKNOWN reissue did not preserve its operation key"
            );
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
          const checkResult = page.getByRole("button", {
            exact: true,
            name: "重新查詢",
          });
          await expect(checkResult).toHaveCount(0);
          await expect(
            page.getByRole("heading", { exact: true, name: "確認重發結果" })
          ).toBeFocused();
          await expect(
            page.getByRole("button", { exact: true, name: "檢查資料" })
          ).toHaveCount(0);
          await expect(verification).toBeHidden();
          await expect(reissue).toBeHidden();
          const returnToAccount = page.getByRole("link", {
            exact: true,
            name: "返回帳戶詳情",
          });
          await qualifyPresentation(page, testInfo, "reissue-unconfirmed", {
            criticalAction: returnToAccount,
            drafts: recoveryDrafts(page),
            focus: returnToAccount,
          });
          await page.context().setOffline(true);
          const failedAutomaticReconciliation = page.waitForRequest(
            (request) =>
              request.method() === "POST" &&
              request.url().endsWith("/api/v2/staff/accounts/reconcile")
          );
          await page.context().setOffline(false);
          expect((await failedAutomaticReconciliation).postDataJSON()).toEqual({
            operationKey: original.key,
          });
          await expect(checkResult).toBeVisible();
          expect(bodies).toHaveLength(1);
          await qualifyPresentation(page, testInfo, "reissue-manual-fallback", {
            criticalAction: checkResult,
            drafts: recoveryDrafts(page),
            focus: checkResult,
          });
          await checkResult.click();
          await expect(page.getByRole("status").first()).toContainText(
            "結果仍未確認"
          );
          expect(bodies).toHaveLength(1);
          expect(
            await page.evaluate(() =>
              localStorage.getItem("efcc.staff-account.operation.v1")
            )
          ).toBe(originalRaw);
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

          await page.context().setOffline(true);
          await expect
            .poll(() => page.evaluate(() => navigator.onLine))
            .toBe(false);
          await page.unroute("**/api/v2/staff/accounts/password-reissue");
          await page.unroute("**/api/v2/staff/accounts/reconcile");
          const reconciliationGate = Promise.withResolvers<null>();
          let reconnectReads = 0;
          await page.route(
            "**/api/v2/staff/accounts/reconcile",
            async (route) => {
              reconnectReads += 1;
              await reconciliationGate.promise;
              await route.continue();
            }
          );
          const automaticReconciliation = page.waitForRequest(
            (request) =>
              request.method() === "POST" &&
              request.url().endsWith("/api/v2/staff/accounts/reconcile")
          );
          try {
            await page.context().setOffline(false);
            const request = await automaticReconciliation;
            expect(request.postDataJSON()).toEqual({
              operationKey: original.key,
            });
            expect(request.headers()["x-efcc-expected-actor-id"]).toBe(
              staff.userId
            );
            await expect(checkResult).toHaveCount(0);
            await expect(
              page.getByRole("heading", { exact: true, name: "確認重發結果" })
            ).toBeVisible();
            await expect(verification).toBeHidden();
            expect(bodies).toHaveLength(1);
            await page.evaluate(() => {
              window.dispatchEvent(new Event("online"));
              window.dispatchEvent(new Event("online"));
            });
          } finally {
            reconciliationGate.resolve(null);
          }
          await expect(page.getByRole("status").first()).toContainText(
            "你上次要求重發臨時密碼。系統已自動查詢，暫未找到完成紀錄；核對資料後可重試。"
          );
          await expect(checkResult).toHaveCount(0);
          await expect(verification).toBeVisible();
          expect(reconnectReads).toBe(1);
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
          await expect(
            page.getByRole("heading", {
              exact: true,
              name: "重試重發臨時密碼",
            })
          ).toBeVisible();
          await expect(
            page.getByText(
              "你上次要求重發臨時密碼。系統已自動查詢，暫未找到完成紀錄；核對資料後可重試。",
              { exact: true }
            )
          ).toBeVisible();
          await expect(
            page.getByRole("heading", {
              exact: true,
              name: "上次重發結果未確認",
            })
          ).toBeVisible();
          await expect(checkResult).toHaveCount(0);
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
          await expect(
            page.getByLabel("新臨時密碼", { exact: true })
          ).toHaveText(reissued.temporaryPassword);
          await page.evaluate(() => {
            window.dispatchEvent(new Event("online"));
          });
          await qualifyPresentation(page, testInfo, "reissue-handover", {
            criticalAction: copy,
            drafts: page.getByRole("checkbox"),
            focus: copy,
          });
          expect(reconnectReads).toBe(1);
          await expect(
            page.getByLabel("新臨時密碼", { exact: true })
          ).toHaveText(reissued.temporaryPassword);
          await page.reload();
          await expect(page.getByRole("status").first()).toContainText(
            "原臨時密碼不能再次讀取"
          );
          await expect(
            page.getByLabel("新臨時密碼", { exact: true })
          ).toHaveCount(0);
        }
      );

      dedicatedTest(
        "lost recovery response remains UNKNOWN and reconciles its original receipt after native Worker update",
        {
          tag: [
            "@risk-recovery",
            "@risk-privacy",
            "@risk-resilience",
            "@risk-actor-target-key",
            "@risk-non-replay",
            "@mobile-critical",
          ],
        },
        async ({ caseApp, staffPage: page, staff }, testInfo) => {
          const holder = syntheticAccount("lost-reset");
          const targetUserId = await caseApp.provision.account(holder);
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
            if (
              request.url().endsWith("/api/v2/staff/accounts/password-reset")
            ) {
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
            throw new Error(
              "UNKNOWN recovery did not preserve the original key"
            );
          }
          const operation = storedStaffAccountOperationSchema.parse(
            JSON.parse(raw)
          );
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
          await caseApp.harness.update((current) => {
            const [primary, ...remaining] = current.workers;
            if (!primary || !("configPath" in primary)) {
              throw new Error(
                "Native app primary worker config is unavailable"
              );
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
          const updatedWorker = caseApp.harness.getWorker<{
            DB: NativeApp["db"];
            N13_NATIVE_UPDATE_MARKER: string;
          }>("efcc-system");
          const updatedEnvironment = await updatedWorker.getEnv();
          expect(updatedEnvironment.N13_NATIVE_UPDATE_MARKER).toBe(marker);
          await expectResponseStatus(staff.context.get("/api/v2/me"), 200);
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

          await page.context().setOffline(true);
          const reconciliationRequest = page.waitForRequest(
            (request) =>
              request.method() === "POST" &&
              request.url().endsWith("/api/v2/staff/accounts/reconcile")
          );
          await page.context().setOffline(false);
          const reconcile = await reconciliationRequest;
          expect(reconcile.postDataJSON()).toEqual({
            operationKey: operation.key,
          });
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
          await expect(
            page.getByLabel("新臨時密碼", { exact: true })
          ).toHaveCount(0);
          const replay = await expectResponseStatus(
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
        "lost Staff creation recovers through fresh-confirmed reset and private reissue before native first password change",
        {
          tag: [
            "@risk-auth",
            "@risk-recovery",
            "@risk-privacy",
            "@risk-actor-target-key",
            "@risk-non-replay",
            "@mobile-critical",
          ],
        },
        async ({ caseApp, staffPage: page, staff }, testInfo) => {
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
          await page
            .getByLabel("中文全名", { exact: true })
            .fill(lost.fullName);
          await page
            .getByLabel("使用者名稱", { exact: true })
            .fill(lost.username);
          await page.getByLabel("電話", { exact: true }).fill(lost.phone);
          await page
            .getByLabel("已親身核實此人的身分", { exact: true })
            .check();
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
          await expect(
            page.getByLabel("新臨時密碼", { exact: true })
          ).toHaveCount(0);
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
            throw new Error(
              "Lost creation response did not retain its original key"
            );
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
          await page
            .getByRole("link", { exact: true, name: "返回帳戶詳情" })
            .click();
          const leaveDialog = page.getByRole("dialog");
          await expect(leaveDialog).toBeVisible();
          await leaveDialog.getByRole("button", { name: "繼續編輯" }).click();
          await expect(verification).toBeChecked();
          await page
            .getByRole("link", { exact: true, name: "返回帳戶詳情" })
            .click();
          await leaveDialog.getByRole("button", { name: "放棄變更" }).click();
          await caseApp.db
            .prepare(
              "UPDATE session SET password_confirmed_at = 0 WHERE user_id = ?"
            )
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
            page.getByRole("heading", {
              exact: true,
              level: 1,
              name: "檢查重設密碼",
            })
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
            page.getByRole("heading", {
              exact: true,
              level: 1,
              name: "檢查重設密碼",
            })
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
          await expect(
            page.getByLabel("新臨時密碼", { exact: true })
          ).toHaveCount(0);
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
            page.getByRole("heading", {
              exact: true,
              level: 1,
              name: "檢查重新發出",
            })
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
          await expect(
            page.getByLabel("新臨時密碼", { exact: true })
          ).toHaveCount(0);

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
          await page
            .getByLabel("臨時密碼", { exact: true })
            .fill(reissuedPassword);
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
          await page
            .getByRole("button", { exact: true, name: "更改密碼" })
            .click();
          const firstChange = await firstChangeResponse;
          expect(firstChange.status()).toBe(201);
          await expectResponseStatus(
            page.context().request.get(`${caseApp.origin}/api/v2/me`),
            200
          );
          await page
            .getByRole("button", { exact: true, name: "查看帳戶狀態" })
            .click();
          await expect(page).toHaveURL(/\/status$/u);
          await page
            .getByRole("button", { exact: true, name: "前往主頁" })
            .click();
          await expect(page).toHaveURL(`${caseApp.origin}/`);
          expect(createRequests).toBe(1);
        }
      );
    });
  }
);
