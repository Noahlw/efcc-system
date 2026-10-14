/* eslint-disable no-await-in-loop, unicorn/no-await-expression-member -- Ordered HTTP calls and direct native D1 observations preserve the original transaction, limiter and credential-race claims. */
import { randomBytes, randomUUID } from "node:crypto";

import { expect, test } from "../../support/fixtures";
import {
  status,
  staffData,
  issuedCredential,
  errorCode,
  creation,
  syntheticAccount,
  credentialRow,
  dedicatedTest,
  staffBrowserTest,
} from "./fixtures";
import type { RecoveryInput } from "./fixtures";

test.describe(
  "actor-authority",
  { tag: ["@native", "@account-assisted"] },
  () => {
    test.describe("HTTP contracts", { tag: ["@http"] }, () => {
      dedicatedTest(
        "actor and target bind creation, reset, reissue and private reconciliation keys",
        {
          tag: ["@risk-authorization", "@risk-recovery", "@risk-privacy"],
        },
        async ({ caseApp, extraHTTPHeaders, playwright, staff }) => {
          const secondStaffAccount = syntheticAccount(
            "second-staff-actor",
            "staff"
          );
          const secondStaffId =
            await caseApp.provision.account(secondStaffAccount);
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
              staff.context.post("/api/v2/staff/accounts", {
                data: firstCreation,
              }),
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
                  staff.context.post(
                    "/api/v2/staff/accounts/password-reissue",
                    {
                      data: firstReissueInput,
                    }
                  ),
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
                  staff.context.post(
                    "/api/v2/staff/accounts/password-reissue",
                    {
                      data: firstReissueInput,
                    }
                  ),
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
              [
                staff.userId,
                creationKey,
                firstTarget,
                "assisted_account_created",
              ],
              [
                secondStaffId,
                creationKey,
                secondTarget,
                "assisted_account_created",
              ],
              [staff.userId, resetKey, firstTarget, "staff_password_reset"],
              [secondStaffId, resetKey, secondTarget, "staff_password_reset"],
              [
                staff.userId,
                reissueKey,
                firstTarget,
                "temporary_password_reissued",
              ],
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
          tag: ["@risk-auth", "@risk-resilience", "@risk-security"],
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

      dedicatedTest(
        "fresh confirmation, protected Staff targets and current authority cannot be bypassed",
        {
          tag: ["@risk-authorization", "@risk-auth", "@risk-security"],
        },
        async ({ caseApp, staff }) => {
          const staffTarget = syntheticAccount("staff-target", "staff");
          const adminTarget = syntheticAccount("admin-target", "admin");
          const memberTarget = syntheticAccount("member-target");
          const staffTargetId = await caseApp.provision.account(staffTarget);
          const adminTargetId = await caseApp.provision.account(adminTarget);
          const memberTargetId = await caseApp.provision.account(memberTarget);

          for (const targetUserId of [
            staff.userId,
            staffTargetId,
            adminTargetId,
          ]) {
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
        { tag: ["@risk-authorization", "@risk-privacy"] },
        async ({ caseApp, extraHTTPHeaders, playwright, staff }) => {
          const first = creation();
          const second = {
            ...creation(),
            phone: first.phone,
            sharedPhone: true,
          };
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
    });
    test.describe("Browser journeys", { tag: ["@browser"] }, () => {
      staffBrowserTest(
        "Staff Management distinguishes same-name permitted accounts and retains person context across viewports",
        {
          tag: ["@risk-authorization", "@risk-privacy", "@mobile-critical"],
        },
        async ({ caseApp, page, playwright, staff }) => {
          const peerStaff = syntheticAccount("peer-staff", "staff");
          const admin = syntheticAccount("managed-admin", "admin");
          const pending = syntheticAccount(
            "managed-pending",
            undefined,
            "pending"
          );
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
                staff.context.post("/api/v2/staff/accounts", {
                  data: firstInput,
                }),
                201
              )
            )
          );
          const secondInput = { ...creation(), fullName: firstInput.fullName };
          const secondCreated = issuedCredential(
            await staffData(
              await status(
                staff.context.post("/api/v2/staff/accounts", {
                  data: secondInput,
                }),
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
          const rosterIds = rosterBody.data.accounts.map(
            (account) => account.userId
          );
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
            const adminIds = adminBody.data.accounts.map(
              (account) => account.userId
            );
            expect(adminIds).toContain(staff.userId);
            expect(adminIds).toContain(peerStaffId);
            expect(adminIds).not.toContain(adminId);
          } finally {
            await adminActor.dispose();
          }
          await caseApp.db
            .prepare(
              "UPDATE user SET display_username = NULL WHERE id IN (?, ?)"
            )
            .bind(firstId, secondId)
            .run();

          await page.goto("/staff/accounts");
          await expect(
            page.getByRole("link", { name: /角色管理/u })
          ).toHaveCount(0);
          await expect(
            page.getByRole("link", { name: /內容管理/u })
          ).toHaveCount(0);
          await page.getByRole("link", { name: /帳戶管理/u }).click();
          await expect(
            page.getByRole("link", {
              name: new RegExp(peerStaff.fullName, "u"),
            })
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
          await expect(
            page.getByRole("region", { name: "操作對象" })
          ).toHaveCount(0);
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
          await expect(
            page.getByRole("link", { name: /帳戶復原/u })
          ).toHaveAttribute(
            "href",
            new RegExp(`person=${secondId}.*task=recovery`, "u")
          );
          await page.setViewportSize({ height: 900, width: 1280 });
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
          await expect(
            page.getByRole("heading", { name: "帳戶復原" })
          ).toBeVisible();
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
    });
  }
);
