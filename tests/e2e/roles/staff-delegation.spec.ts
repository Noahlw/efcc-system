import { randomUUID } from "node:crypto";

import type { APIRequestContext } from "@playwright/test";

import { dedicatedTest, expect } from "../../support/fixtures";

const roleTest = dedicatedTest.extend<{
  admin: { context: APIRequestContext; password: string; userId: string };
}>({
  admin: async ({ caseApp, extraHTTPHeaders, playwright }, use) => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
    const username = `roles.admin.${suffix}`;
    const password = "Synthetic-native-password!";
    const userId = await caseApp.provision.account({
      email: `${suffix}@example.com`,
      fullName: `陳角色管理員${suffix}`,
      membershipStatus: "active",
      password,
      role: "admin",
      username,
    });
    const context = await playwright.request.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders,
    });
    try {
      const login = await context.post("/api/auth/sign-in/username", {
        data: { password, username },
      });
      expect(login.status()).toBe(200);
      const confirmation = await context.post(
        "/api/v2/account/password-confirmation",
        { data: { operationKey: randomUUID(), password } }
      );
      expect(confirmation.status()).toBe(201);
      await use({ context, password, userId });
    } finally {
      await context.dispose();
    }
  },
});

const confirmAdmin = async (context: APIRequestContext, password: string) => {
  const confirmation = await context.post(
    "/api/v2/account/password-confirmation",
    { data: { operationKey: randomUUID(), password } }
  );
  expect(confirmation.status()).toBe(201);
};

roleTest.describe(
  "Staff delegation",
  {
    tag: ["@native", "@risk-authorization", "@risk-atomicity", "@risk-history"],
  },
  () => {
    roleTest(
      "an eligible Admin can promote an eligible Member to Staff and retained Staff history blocks deletion",
      { tag: ["@http"] },
      async ({ admin, caseApp, extraHTTPHeaders, playwright }) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
        const username = `roles.member.${suffix}`;
        const password = "Synthetic-member-password!";
        const targetUserId = await caseApp.provision.account({
          email: `${suffix}@example.com`,
          fullName: `陳新職員${suffix}`,
          membershipStatus: "active",
          password,
          role: "member",
          username,
        });
        const recipient = await playwright.request.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        const operationKey = randomUUID();
        try {
          const login = await recipient.post("/api/auth/sign-in/username", {
            data: { password, username },
          });
          expect(login.status()).toBe(200);

          const input = {
            action: "granted" as const,
            operationKey,
            role: "staff" as const,
            targetUserId,
          };
          const response = await admin.context.post(
            "/api/v2/roles/global-roles",
            { data: input }
          );

          expect(response.status()).toBe(201);
          const responseBody = (await response.json()) as {
            data: {
              receipt: {
                action: string;
                id: string;
                resultingGlobalRole: string;
                role: string;
                targetUserId: string;
              };
            };
          };
          expect(responseBody.data.receipt).toMatchObject({
            action: "granted",
            resultingGlobalRole: "staff",
            role: "staff",
            targetUserId,
          });

          const staffAccountTools = await recipient.get(
            "/api/v2/staff/accounts"
          );
          expect(staffAccountTools.status()).toBe(200);
          expect(await staffAccountTools.json()).toMatchObject({
            data: { accounts: expect.any(Array) },
          });

          expect(
            await caseApp.db
              .prepare(
                "select account_role as role, membership_status as membershipStatus, banned_at as bannedAt from person_profile where user_id = ?"
              )
              .bind(targetUserId)
              .first<{
                bannedAt: number | null;
                membershipStatus: string;
                role: string;
              }>()
          ).toEqual({
            bannedAt: null,
            membershipStatus: "active",
            role: "staff",
          });
          expect(
            await caseApp.db
              .prepare(
                "select count(*) as count from department_membership where user_id = ?"
              )
              .bind(targetUserId)
              .first<{ count: number }>()
          ).toEqual({ count: 0 });
          expect(
            await caseApp.db
              .prepare(
                "select count(*) as count from enrolment where user_id = ?"
              )
              .bind(targetUserId)
              .first<{ count: number }>()
          ).toEqual({ count: 0 });

          const inbox = await recipient.get("/api/v2/inbox");
          expect(inbox.status()).toBe(200);
          const inboxBody = (await inbox.json()) as {
            data: {
              roleChanges: {
                action: string;
                createdAt: number;
                resultingGlobalRole: string;
                role: string;
                scopeName: string;
              }[];
            };
          };
          expect(inboxBody.data.roleChanges).toEqual([
            expect.objectContaining({
              action: "granted",
              resultingGlobalRole: "staff",
              role: "staff",
              scopeName: "全域角色",
            }),
          ]);
          expect(inboxBody.data.roleChanges).toHaveLength(1);
          expect(
            Object.keys(inboxBody.data.roleChanges[0] ?? {}).toSorted()
          ).toEqual([
            "action",
            "createdAt",
            "resultingGlobalRole",
            "role",
            "scopeName",
          ]);
          expect(JSON.stringify(inboxBody)).not.toContain(targetUserId);
          expect(JSON.stringify(inboxBody)).not.toContain(operationKey);
          expect(JSON.stringify(inboxBody)).not.toContain(username);

          const replay = await admin.context.post(
            "/api/v2/roles/global-roles",
            { data: input }
          );
          expect(replay.status()).toBe(200);
          expect(await replay.json()).toEqual(responseBody);

          const durableEffects = await caseApp.db
            .prepare(
              "select (select count(*) from role_assignment_history where target_user_id = ? and role = 'staff') as history, (select count(*) from audit_event where actor_user_id = ? and target_user_id = ? and action = 'global_role_changed') as audits, (select count(*) from role_change_operation where actor_user_id = ? and operation_key = ? and target_user_id = ? and role = 'staff') as receipts"
            )
            .bind(
              targetUserId,
              admin.userId,
              targetUserId,
              admin.userId,
              operationKey,
              targetUserId
            )
            .first<{ audits: number; history: number; receipts: number }>();
          expect(durableEffects).toEqual({
            audits: 1,
            history: 1,
            receipts: 1,
          });

          const deletionBlockers = await caseApp.db
            .prepare(
              `SELECT
                (SELECT COUNT(*) FROM department_membership WHERE user_id = ?) AS departmentMemberships,
                (SELECT COUNT(*) FROM enrolment WHERE user_id = ?) AS enrolments,
                (SELECT COUNT(*) FROM invitation WHERE user_id = ?) AS invitations,
                (SELECT COUNT(*) FROM department_manager_assignment WHERE user_id = ?) AS departmentManagerAssignments,
                (SELECT COUNT(*) FROM program_leader_assignment WHERE user_id = ?) AS programLeaderAssignments,
                (SELECT COUNT(*) FROM role_assigner_assignment WHERE user_id = ?) AS roleAssignerAssignments`
            )
            .bind(
              targetUserId,
              targetUserId,
              targetUserId,
              targetUserId,
              targetUserId,
              targetUserId
            )
            .first();
          expect(deletionBlockers).toEqual({
            departmentManagerAssignments: 0,
            departmentMemberships: 0,
            enrolments: 0,
            invitations: 0,
            programLeaderAssignments: 0,
            roleAssignerAssignments: 0,
          });

          await confirmAdmin(admin.context, admin.password);
          const deletionKey = randomUUID();
          const deletion = await admin.context.post(
            "/api/v2/staff/accounts/delete",
            { data: { operationKey: deletionKey, targetUserId } }
          );
          expect(deletion.status()).toBe(409);
          expect(await deletion.json()).toMatchObject({
            error: { code: "church_history_retained" },
          });
          await expect(
            caseApp.db
              .prepare("DELETE FROM user WHERE id = ?")
              .bind(targetUserId)
              .run()
          ).rejects.toThrow();

          expect(
            await caseApp.db
              .prepare("SELECT id FROM user WHERE id = ?")
              .bind(targetUserId)
              .first()
          ).toEqual({ id: targetUserId });
          const staffHistory = await caseApp.db
            .prepare(
              "SELECT action, role, resulting_global_role AS resultingGlobalRole, scope_id AS scopeId, scope_name AS scopeName FROM role_assignment_history WHERE target_user_id = ?"
            )
            .bind(targetUserId)
            .all();
          expect(staffHistory.results).toEqual([
            {
              action: "granted",
              resultingGlobalRole: "staff",
              role: "staff",
              scopeId: "global",
              scopeName: "全域角色",
            },
          ]);
          expect(
            await caseApp.db
              .prepare(
                `SELECT
                  (SELECT COUNT(*) FROM audit_event WHERE target_user_id = ? AND action = 'account_deleted') AS deletionAudits,
                  (SELECT COUNT(*) FROM account_change_operation WHERE actor_user_id = ? AND target_user_id = ? AND operation_key = ? AND action = 'account_deleted') AS deletionReceipts`
              )
              .bind(targetUserId, admin.userId, targetUserId, deletionKey)
              .first()
          ).toEqual({ deletionAudits: 0, deletionReceipts: 0 });
        } finally {
          await recipient.dispose();
        }
      }
    );

    roleTest(
      "an eligible Admin grants Admin directly to a Member and revokes every target Session",
      { tag: ["@http", "@risk-session", "@risk-recovery"] },
      async ({ admin, caseApp, extraHTTPHeaders, playwright }) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
        const password = "Synthetic-admin-grant-member-password!";
        const username = `adm.member.${suffix}`;
        const fullName = `陳新管理員${suffix}`;
        const targetUserId = await caseApp.provision.account({
          email: `${suffix}@example.com`,
          fullName,
          membershipStatus: "active",
          password,
          role: "member",
          username,
        });
        const targetContexts = await Promise.all(
          ["198.19.20.31", "198.19.20.32"].map((ip) =>
            playwright.request.newContext({
              baseURL: caseApp.origin,
              extraHTTPHeaders: { ...extraHTTPHeaders, "cf-connecting-ip": ip },
            })
          )
        );
        try {
          await Promise.all(
            targetContexts.map(async (context) => {
              const login = await context.post("/api/auth/sign-in/username", {
                data: { password, username },
              });
              expect(login.status()).toBe(200);
              const inbox = await context.get("/api/v2/inbox");
              expect(inbox.status()).toBe(200);
            })
          );
          expect(
            await caseApp.db
              .prepare(
                "SELECT COUNT(*) AS count FROM session WHERE user_id = ?"
              )
              .bind(targetUserId)
              .first()
          ).toEqual({ count: 2 });
          expect(
            await caseApp.db
              .prepare(
                "SELECT email_verified AS verified FROM user WHERE id = ?"
              )
              .bind(targetUserId)
              .first()
          ).toEqual({ verified: 0 });

          await confirmAdmin(admin.context, admin.password);
          const operationKey = randomUUID();
          const grant = await admin.context.post("/api/v2/roles/global-roles", {
            data: {
              action: "granted",
              operationKey,
              role: "admin",
              targetUserId,
            },
          });
          expect(grant.status()).toBe(201);
          const body = (await grant.json()) as {
            data: {
              receipt: {
                action: string;
                id: string;
                resultingGlobalRole: string;
                role: string;
                targetUserId: string;
              };
            };
          };
          expect(body.data.receipt).toMatchObject({
            action: "granted",
            resultingGlobalRole: "admin",
            role: "admin",
            targetUserId,
          });
          const replay = await admin.context.post(
            "/api/v2/roles/global-roles",
            {
              data: {
                action: "granted",
                operationKey,
                role: "admin",
                targetUserId,
              },
            }
          );
          expect(replay.status()).toBe(200);
          expect(await replay.json()).toEqual({
            data: { receipt: body.data.receipt },
          });

          expect(
            await caseApp.db
              .prepare(
                `SELECT
                  (SELECT account_role FROM person_profile WHERE user_id = ?) AS role,
                  (SELECT COUNT(*) FROM session WHERE user_id = ?) AS sessions,
                  (SELECT COUNT(*) FROM role_assignment_history WHERE target_user_id = ? AND role = 'admin' AND action = 'granted' AND resulting_global_role = 'admin') AS adminHistory,
                  (SELECT COUNT(*) FROM role_assignment_history WHERE target_user_id = ? AND role = 'staff') AS staffHistory,
                  (SELECT COUNT(*) FROM role_change_operation WHERE actor_user_id = ? AND operation_key = ? AND target_user_id = ? AND role = 'admin' AND resulting_global_role = 'admin') AS receipts,
                  (SELECT COUNT(*) FROM audit_event WHERE actor_user_id = ? AND target_user_id = ? AND action = 'global_role_changed') AS audits,
                  (SELECT COUNT(*) FROM invitation WHERE user_id = ?) AS invitations`
              )
              .bind(
                targetUserId,
                targetUserId,
                targetUserId,
                targetUserId,
                admin.userId,
                operationKey,
                targetUserId,
                admin.userId,
                targetUserId,
                targetUserId
              )
              .first()
          ).toEqual({
            adminHistory: 1,
            audits: 1,
            invitations: 0,
            receipts: 1,
            role: "admin",
            sessions: 0,
            staffHistory: 0,
          });

          const revokedInboxStatuses = await Promise.all(
            targetContexts.map(async (context) => {
              const inbox = await context.get("/api/v2/inbox");
              return inbox.status();
            })
          );
          expect(revokedInboxStatuses).toEqual([401, 401]);
          const grantorStillAdmin = await admin.context.get(
            "/api/v2/roles/global-roles"
          );
          expect(grantorStillAdmin.status()).toBe(200);

          const recipient = await playwright.request.newContext({
            baseURL: caseApp.origin,
            extraHTTPHeaders: {
              ...extraHTTPHeaders,
              "cf-connecting-ip": "198.19.20.33",
            },
          });
          try {
            const freshLogin = await recipient.post(
              "/api/auth/sign-in/username",
              { data: { password, username } }
            );
            expect(freshLogin.status()).toBe(200);
            const adminPage = await recipient.get("/api/v2/roles/global-roles");
            expect(adminPage.status()).toBe(200);
            expect(await adminPage.json()).toMatchObject({
              data: { actorUserId: targetUserId },
            });
            const inbox = await recipient.get("/api/v2/inbox");
            expect(inbox.status()).toBe(200);
            const inboxBody = await inbox.json();
            expect(inboxBody).toMatchObject({
              data: {
                roleChanges: [
                  expect.objectContaining({
                    action: "granted",
                    resultingGlobalRole: "admin",
                    role: "admin",
                    scopeName: "全域角色",
                  }),
                ],
              },
            });
            expect(JSON.stringify(inboxBody)).not.toContain(operationKey);
          } finally {
            await recipient.dispose();
          }

          await expect(
            caseApp.db
              .prepare("DELETE FROM user WHERE id = ?")
              .bind(targetUserId)
              .run()
          ).rejects.toThrow();
          expect(
            await caseApp.db
              .prepare("SELECT id FROM user WHERE id = ?")
              .bind(targetUserId)
              .first()
          ).toEqual({ id: targetUserId });
        } finally {
          await Promise.all(targetContexts.map((context) => context.dispose()));
        }
      }
    );

    roleTest(
      "direct Admin grants reject inactive, banned, missing, empty and temporary credentials",
      { tag: ["@http", "@risk-authorization"] },
      async ({ admin, caseApp }) => {
        const password = "Synthetic-ineligible-admin-target-password!";
        const cases = [
          {
            mutate: (targetUserId: string) =>
              caseApp.db
                .prepare(
                  "UPDATE person_profile SET membership_status='deactivated' WHERE user_id=?"
                )
                .bind(targetUserId)
                .run(),
            name: "inactive Membership",
          },
          {
            mutate: (targetUserId: string) =>
              caseApp.db
                .prepare(
                  "UPDATE person_profile SET banned_at=unixepoch() WHERE user_id=?"
                )
                .bind(targetUserId)
                .run(),
            name: "Security Ban",
          },
          {
            mutate: (targetUserId: string) =>
              caseApp.db
                .prepare(
                  "DELETE FROM account WHERE user_id=? AND provider_id='credential'"
                )
                .bind(targetUserId)
                .run(),
            name: "missing permanent credential",
          },
          {
            mutate: (targetUserId: string) =>
              caseApp.db
                .prepare(
                  "UPDATE account SET password='' WHERE user_id=? AND provider_id='credential'"
                )
                .bind(targetUserId)
                .run(),
            name: "empty permanent credential",
          },
          {
            mutate: (targetUserId: string) =>
              caseApp.db
                .prepare(
                  "UPDATE account SET temporary_password_expires_at=unixepoch()+3600 WHERE user_id=? AND provider_id='credential'"
                )
                .bind(targetUserId)
                .run(),
            name: "temporary first-password credential",
          },
        ];

        /* eslint-disable no-await-in-loop -- Each eligibility case shares one Admin Session and must perform a fresh credential proof before its own command. */
        for (const [index, candidate] of cases.entries()) {
          const suffix = `${randomUUID().replaceAll("-", "").slice(0, 6)}${index}`;
          const targetUserId = await caseApp.provision.account({
            email: `${suffix}@example.com`,
            fullName: `陳未符合管理員資格${suffix}`,
            membershipStatus: "active",
            password,
            role: "member",
            username: `ineligible.${suffix}`,
          });
          await candidate.mutate(targetUserId);

          const detail = await admin.context.get(
            `/api/v2/roles/global-roles/${encodeURIComponent(targetUserId)}`
          );
          expect(detail.status(), candidate.name).toBe(200);
          const detailBody = await detail.json();
          expect(detailBody).toMatchObject({
            data: { person: { eligibleForAdmin: false, role: "member" } },
          });
          expect(JSON.stringify(detailBody)).not.toContain(password);

          await confirmAdmin(admin.context, admin.password);
          const operationKey = randomUUID();
          const result = await admin.context.post(
            "/api/v2/roles/global-roles",
            {
              data: {
                action: "granted",
                operationKey,
                role: "admin",
                targetUserId,
              },
            }
          );
          expect(result.status(), candidate.name).toBe(409);
          expect(await result.json()).toMatchObject({
            error: { code: "conflict" },
          });
          expect(
            await caseApp.db
              .prepare(
                `SELECT
                  (SELECT account_role FROM person_profile WHERE user_id=?) AS role,
                  (SELECT COUNT(*) FROM role_assignment_history WHERE target_user_id=? AND role='admin') AS history,
                  (SELECT COUNT(*) FROM audit_event WHERE target_user_id=? AND action='global_role_changed') AS audits,
                  (SELECT COUNT(*) FROM role_change_operation WHERE actor_user_id=? AND operation_key=?) AS receipts`
              )
              .bind(
                targetUserId,
                targetUserId,
                targetUserId,
                admin.userId,
                operationKey
              )
              .first()
          ).toEqual({ audits: 0, history: 0, receipts: 0, role: "member" });
        }
        /* eslint-enable no-await-in-loop */
      }
    );

    roleTest(
      "concurrent direct Admin grants keep one effect for a shared key and competing keys",
      { tag: ["@http", "@risk-atomicity", "@risk-history"] },
      async ({ admin, caseApp }) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
        const makeTarget = (part: string) =>
          caseApp.provision.account({
            email: `${part}.${suffix}@example.com`,
            fullName: `陳並行管理員${part}${suffix}`,
            membershipStatus: "active",
            password: "Synthetic-concurrent-admin-target-password!",
            role: "member",
            username: `concurrent.${part}.${suffix}`,
          });
        const [sameKeyTarget, competingTarget] = await Promise.all([
          makeTarget("same"),
          makeTarget("compete"),
        ]);
        await confirmAdmin(admin.context, admin.password);

        const sharedKey = randomUUID();
        const sharedInput = {
          action: "granted",
          operationKey: sharedKey,
          role: "admin",
          targetUserId: sameKeyTarget,
        };
        const sharedResponses = await Promise.all([
          admin.context.post("/api/v2/roles/global-roles", {
            data: sharedInput,
          }),
          admin.context.post("/api/v2/roles/global-roles", {
            data: sharedInput,
          }),
        ]);
        expect(
          sharedResponses.map((response) => response.status()).toSorted()
        ).toEqual([200, 201]);
        const sharedBodies = await Promise.all(
          sharedResponses.map((response) => response.json())
        );
        expect(sharedBodies[0]).toEqual(sharedBodies[1]);

        const reusedKey = await admin.context.post(
          "/api/v2/roles/global-roles",
          {
            data: {
              ...sharedInput,
              targetUserId: competingTarget,
            },
          }
        );
        expect(reusedKey.status()).toBe(409);

        const firstKey = randomUUID();
        const secondKey = randomUUID();
        const competingResponses = await Promise.all(
          [firstKey, secondKey].map((operationKey) =>
            admin.context.post("/api/v2/roles/global-roles", {
              data: {
                action: "granted",
                operationKey,
                role: "admin",
                targetUserId: competingTarget,
              },
            })
          )
        );
        expect(
          competingResponses.map((response) => response.status()).toSorted()
        ).toEqual([201, 409]);

        expect(
          await caseApp.db
            .prepare(
              `SELECT
                (SELECT account_role FROM person_profile WHERE user_id=?) AS role,
                (SELECT COUNT(*) FROM role_assignment_history WHERE target_user_id=? AND role='admin' AND resulting_global_role='admin') AS history,
                (SELECT COUNT(*) FROM audit_event WHERE target_user_id=? AND action='global_role_changed') AS audits,
                (SELECT COUNT(*) FROM role_change_operation WHERE target_user_id=? AND role='admin') AS receipts,
                (SELECT COUNT(*) FROM role_change_operation WHERE actor_user_id=? AND operation_key IN (?,?) AND role='admin') AS competingKeyReceipts`
            )
            .bind(
              competingTarget,
              competingTarget,
              competingTarget,
              competingTarget,
              admin.userId,
              firstKey,
              secondKey
            )
            .first()
        ).toEqual({
          audits: 1,
          competingKeyReceipts: 1,
          history: 1,
          receipts: 1,
          role: "admin",
        });
        expect(
          await caseApp.db
            .prepare(
              `SELECT
                (SELECT COUNT(*) FROM role_assignment_history WHERE target_user_id=? AND role='admin') AS history,
                (SELECT COUNT(*) FROM audit_event WHERE target_user_id=? AND action='global_role_changed') AS audits,
                (SELECT COUNT(*) FROM role_change_operation WHERE actor_user_id=? AND operation_key=?) AS receipts`
            )
            .bind(sameKeyTarget, sameKeyTarget, admin.userId, sharedKey)
            .first()
        ).toEqual({ audits: 1, history: 1, receipts: 1 });
      }
    );

    roleTest(
      "a Staff-to-Admin grant removes only Role Assigner, preserves changed-target rows and revokes every target Session",
      { tag: ["@http", "@risk-session", "@risk-deletion"] },
      async ({ admin, caseApp, extraHTTPHeaders, playwright }) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
        const password = "Synthetic-admin-grant-staff-password!";
        const username = `adm.staff.${suffix}`;
        const targetUserId = await caseApp.provision.account({
          email: `${suffix}@example.com`,
          fullName: `陳新職員管理員${suffix}`,
          membershipStatus: "active",
          password,
          role: "member",
          username,
        });
        const departmentId = randomUUID();
        const programId = randomUUID();
        await caseApp.db
          .prepare(
            "INSERT INTO department(id,name,created_at) VALUES(?,?,unixepoch())"
          )
          .bind(departmentId, `管理員保留部門${suffix}`)
          .run();
        await caseApp.db
          .prepare(
            "INSERT INTO program(id,department_id,name,created_at) VALUES(?,?,?,unixepoch())"
          )
          .bind(programId, departmentId, `管理員保留聚會${suffix}`)
          .run();
        await caseApp.db
          .prepare(
            "INSERT INTO department_membership(id,department_id,user_id,created_at) VALUES(?,?,?,unixepoch())"
          )
          .bind(randomUUID(), departmentId, targetUserId)
          .run();
        await caseApp.db
          .prepare(
            "INSERT INTO enrolment(created_at,id,program_id,status,updated_at,user_id) VALUES(unixepoch(),?,?, 'approved',unixepoch(),?)"
          )
          .bind(randomUUID(), programId, targetUserId)
          .run();

        await confirmAdmin(admin.context, admin.password);
        const departmentManager = await admin.context.post(
          "/api/v2/roles/department-managers",
          {
            data: {
              action: "granted",
              operationKey: randomUUID(),
              scopeId: departmentId,
              targetUserId,
            },
          }
        );
        expect(departmentManager.status()).toBe(201);
        await confirmAdmin(admin.context, admin.password);
        const programLeader = await admin.context.post(
          "/api/v2/roles/program-leaders",
          {
            data: {
              action: "granted",
              operationKey: randomUUID(),
              scopeId: programId,
              targetUserId,
            },
          }
        );
        expect(programLeader.status()).toBe(201);

        await confirmAdmin(admin.context, admin.password);
        const staffGrant = await admin.context.post(
          "/api/v2/roles/global-roles",
          {
            data: {
              action: "granted",
              operationKey: randomUUID(),
              role: "staff",
              targetUserId,
            },
          }
        );
        expect(staffGrant.status()).toBe(201);
        await confirmAdmin(admin.context, admin.password);
        const roleAssignerGrant = await admin.context.post(
          "/api/v2/roles/role-assigners",
          {
            data: {
              action: "granted",
              operationKey: randomUUID(),
              targetUserId,
            },
          }
        );
        expect(roleAssignerGrant.status()).toBe(201);

        const readChangedTargetRows = async () => {
          const [
            departmentManagerRows,
            departmentMembershipRows,
            enrolments,
            programLeaderRows,
          ] = await Promise.all([
            caseApp.db
              .prepare(
                "SELECT id,department_id AS departmentId,created_at AS createdAt FROM department_manager_assignment WHERE user_id=? ORDER BY id"
              )
              .bind(targetUserId)
              .all(),
            caseApp.db
              .prepare(
                "SELECT id,department_id AS departmentId,created_at AS createdAt FROM department_membership WHERE user_id=? ORDER BY id"
              )
              .bind(targetUserId)
              .all(),
            caseApp.db
              .prepare(
                "SELECT id,program_id AS programId,status,created_at AS createdAt,updated_at AS updatedAt FROM enrolment WHERE user_id=? ORDER BY id"
              )
              .bind(targetUserId)
              .all(),
            caseApp.db
              .prepare(
                "SELECT id,program_id AS programId,created_at AS createdAt FROM program_leader_assignment WHERE user_id=? ORDER BY id"
              )
              .bind(targetUserId)
              .all(),
          ]);
          return {
            departmentManagers: departmentManagerRows.results,
            departmentMemberships: departmentMembershipRows.results,
            enrolments: enrolments.results,
            programLeaders: programLeaderRows.results,
          };
        };
        const preservedBefore = await readChangedTargetRows();
        expect(preservedBefore.departmentMemberships).toHaveLength(1);
        expect(preservedBefore.departmentManagers).toHaveLength(1);
        expect(preservedBefore.enrolments).toHaveLength(1);
        expect(preservedBefore.programLeaders).toHaveLength(1);

        const targetContexts = await Promise.all(
          ["198.19.20.41", "198.19.20.42"].map((ip) =>
            playwright.request.newContext({
              baseURL: caseApp.origin,
              extraHTTPHeaders: { ...extraHTTPHeaders, "cf-connecting-ip": ip },
            })
          )
        );
        try {
          await Promise.all(
            targetContexts.map(async (context) => {
              const login = await context.post("/api/auth/sign-in/username", {
                data: { password, username },
              });
              expect(login.status()).toBe(200);
              const inbox = await context.get("/api/v2/inbox");
              expect(inbox.status()).toBe(200);
            })
          );
          expect(
            await caseApp.db
              .prepare("SELECT COUNT(*) AS count FROM session WHERE user_id=?")
              .bind(targetUserId)
              .first()
          ).toEqual({ count: 2 });

          await confirmAdmin(admin.context, admin.password);
          const operationKey = randomUUID();
          const adminGrant = await admin.context.post(
            "/api/v2/roles/global-roles",
            {
              data: {
                action: "granted",
                operationKey,
                role: "admin",
                targetUserId,
              },
            }
          );
          expect(adminGrant.status()).toBe(201);
          expect(await adminGrant.json()).toMatchObject({
            data: {
              receipt: {
                action: "granted",
                resultingGlobalRole: "admin",
                role: "admin",
                targetUserId,
              },
            },
          });

          const revokedInboxStatuses = await Promise.all(
            targetContexts.map(async (context) => {
              const inbox = await context.get("/api/v2/inbox");
              return inbox.status();
            })
          );
          expect(revokedInboxStatuses).toEqual([401, 401]);
          const grantorRoleRead = await admin.context.get(
            "/api/v2/roles/global-roles"
          );
          expect(grantorRoleRead.status()).toBe(200);
          expect(
            await caseApp.db
              .prepare(
                `SELECT
                  (SELECT account_role FROM person_profile WHERE user_id=?) AS role,
                  (SELECT COUNT(*) FROM session WHERE user_id=?) AS sessions,
                  (SELECT COUNT(*) FROM role_assigner_assignment WHERE user_id=?) AS currentRoleAssigners,
                  (SELECT COUNT(*) FROM role_assignment_history WHERE target_user_id=? AND role='role_assigner' AND action='withdrawn' AND resulting_global_role IS NULL AND actor_user_id=?) AS roleAssignerWithdrawals,
                  (SELECT COUNT(*) FROM role_change_operation WHERE target_user_id=? AND role='role_assigner') AS roleAssignerReceipts,
                  (SELECT COUNT(*) FROM role_assignment_history WHERE target_user_id=? AND role='admin' AND action='granted' AND resulting_global_role='admin') AS adminHistory,
                  (SELECT COUNT(*) FROM role_change_operation WHERE actor_user_id=? AND operation_key=? AND target_user_id=? AND role='admin' AND resulting_global_role='admin') AS adminReceipts,
                  (SELECT COUNT(*) FROM audit_event WHERE actor_user_id=? AND target_user_id=? AND action='role_assigner_withdrawn') AS roleAssignerAudits,
                  (SELECT COUNT(*) FROM audit_event WHERE actor_user_id=? AND target_user_id=? AND action='global_role_changed') AS globalRoleAudits`
              )
              .bind(
                targetUserId,
                targetUserId,
                targetUserId,
                targetUserId,
                admin.userId,
                targetUserId,
                targetUserId,
                admin.userId,
                operationKey,
                targetUserId,
                admin.userId,
                targetUserId,
                admin.userId,
                targetUserId
              )
              .first()
          ).toEqual({
            adminHistory: 1,
            adminReceipts: 1,
            currentRoleAssigners: 0,
            globalRoleAudits: 2,
            role: "admin",
            roleAssignerAudits: 1,
            roleAssignerReceipts: 1,
            roleAssignerWithdrawals: 1,
            sessions: 0,
          });

          const preservedAfter = await readChangedTargetRows();
          expect(preservedAfter).toEqual(preservedBefore);

          const recipient = await playwright.request.newContext({
            baseURL: caseApp.origin,
            extraHTTPHeaders: {
              ...extraHTTPHeaders,
              "cf-connecting-ip": "198.19.20.43",
            },
          });
          try {
            const recipientLogin = await recipient.post(
              "/api/auth/sign-in/username",
              { data: { password, username } }
            );
            expect(recipientLogin.status()).toBe(200);
            const globalRoleRead = await recipient.get(
              "/api/v2/roles/global-roles"
            );
            expect(globalRoleRead.status()).toBe(200);
            const inbox = await recipient.get("/api/v2/inbox");
            expect(inbox.status()).toBe(200);
            expect(await inbox.json()).toMatchObject({
              data: {
                roleChanges: expect.arrayContaining([
                  expect.objectContaining({
                    action: "granted",
                    resultingGlobalRole: "admin",
                    role: "admin",
                    scopeName: "全域角色",
                  }),
                  expect.objectContaining({
                    action: "withdrawn",
                    role: "role_assigner",
                    scopeName: "全域角色",
                  }),
                ]),
              },
            });
          } finally {
            await recipient.dispose();
          }
          await expect(
            caseApp.db
              .prepare("DELETE FROM user WHERE id=?")
              .bind(targetUserId)
              .run()
          ).rejects.toThrow();
        } finally {
          await Promise.all(targetContexts.map((context) => context.dispose()));
        }
      }
    );

    roleTest(
      "withdrawn Role Assigner history blocks deletion while a clean Staff control remains deletable",
      { tag: ["@http"] },
      async ({ admin, caseApp }) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
        const controlUserId = await caseApp.provision.account({
          email: `ra-control.${suffix}@example.com`,
          fullName: `陳全新職員控制${suffix}`,
          membershipStatus: "active",
          password: "Synthetic-staff-deletion-password!",
          role: "staff",
          username: `ra.control.${suffix}`,
        });
        const targetUserId = await caseApp.provision.account({
          email: `ra-history.${suffix}@example.com`,
          fullName: `陳委派歷史職員${suffix}`,
          membershipStatus: "active",
          password: "Synthetic-staff-deletion-password!",
          role: "staff",
          username: `ra.history.${suffix}`,
        });

        const cleanControl = await caseApp.db
          .prepare(
            `SELECT
              (SELECT account_role FROM person_profile WHERE user_id = ?) AS role,
              (SELECT membership_status FROM person_profile WHERE user_id = ?) AS membershipStatus,
              (SELECT banned_at FROM person_profile WHERE user_id = ?) AS bannedAt,
              (SELECT COUNT(*) FROM department_membership WHERE user_id = ?) AS departmentMemberships,
              (SELECT COUNT(*) FROM enrolment WHERE user_id = ?) AS enrolments,
              (SELECT COUNT(*) FROM invitation WHERE user_id = ?) AS invitations,
              (SELECT COUNT(*) FROM department_manager_assignment WHERE user_id = ?) AS departmentManagerAssignments,
              (SELECT COUNT(*) FROM program_leader_assignment WHERE user_id = ?) AS programLeaderAssignments,
              (SELECT COUNT(*) FROM role_assigner_assignment WHERE user_id = ?) AS roleAssignerAssignments,
              (SELECT COUNT(*) FROM role_assignment_history WHERE target_user_id = ?) AS roleHistory`
          )
          .bind(
            controlUserId,
            controlUserId,
            controlUserId,
            controlUserId,
            controlUserId,
            controlUserId,
            controlUserId,
            controlUserId,
            controlUserId,
            controlUserId
          )
          .first();
        expect(cleanControl).toEqual({
          bannedAt: null,
          departmentManagerAssignments: 0,
          departmentMemberships: 0,
          enrolments: 0,
          invitations: 0,
          membershipStatus: "active",
          programLeaderAssignments: 0,
          role: "staff",
          roleAssignerAssignments: 0,
          roleHistory: 0,
        });

        await confirmAdmin(admin.context, admin.password);
        const controlDeletionKey = randomUUID();
        const controlDeletion = await admin.context.post(
          "/api/v2/staff/accounts/delete",
          {
            data: {
              operationKey: controlDeletionKey,
              targetUserId: controlUserId,
            },
          }
        );
        expect(controlDeletion.status()).toBe(201);
        expect(await controlDeletion.json()).toMatchObject({
          data: {
            receipt: {
              action: "account_deleted",
              targetUserId: controlUserId,
            },
          },
        });
        expect(
          await caseApp.db
            .prepare(
              "SELECT (SELECT COUNT(*) FROM user WHERE id = ?) AS users, (SELECT COUNT(*) FROM person_profile WHERE user_id = ?) AS profiles"
            )
            .bind(controlUserId, controlUserId)
            .first()
        ).toEqual({ profiles: 0, users: 0 });
        expect(
          await caseApp.db
            .prepare(
              `SELECT
                (SELECT COUNT(*) FROM audit_event WHERE target_user_id = ? AND action = 'account_deleted') AS deletionAudits,
                (SELECT COUNT(*) FROM account_change_operation WHERE actor_user_id = ? AND target_user_id = ? AND operation_key = ? AND action = 'account_deleted') AS deletionReceipts`
            )
            .bind(
              controlUserId,
              admin.userId,
              controlUserId,
              controlDeletionKey
            )
            .first()
        ).toEqual({ deletionAudits: 1, deletionReceipts: 1 });

        const grantKey = randomUUID();
        await confirmAdmin(admin.context, admin.password);
        const grant = await admin.context.post("/api/v2/roles/role-assigners", {
          data: {
            action: "granted",
            operationKey: grantKey,
            targetUserId,
          },
        });
        expect(grant.status()).toBe(201);
        expect(await grant.json()).toMatchObject({
          data: {
            receipt: {
              action: "granted",
              role: "role_assigner",
              targetUserId,
            },
          },
        });

        const selected = await admin.context.get(
          `/api/v2/roles/global-roles/${encodeURIComponent(targetUserId)}`
        );
        expect(selected.status()).toBe(200);
        const selectedBody = (await selected.json()) as {
          data: {
            person: {
              roleAssignerAssignment: { assignmentId: string } | null;
            };
          };
        };
        const assignmentId =
          selectedBody.data.person.roleAssignerAssignment?.assignmentId;
        if (!assignmentId) {
          throw new Error("Role Assigner grant returned no current assignment");
        }

        const withdrawalKey = randomUUID();
        await confirmAdmin(admin.context, admin.password);
        const withdrawal = await admin.context.post(
          "/api/v2/roles/role-assigners",
          {
            data: {
              action: "withdrawn",
              expectedAssignmentId: assignmentId,
              operationKey: withdrawalKey,
              targetUserId,
            },
          }
        );
        expect(withdrawal.status()).toBe(201);
        expect(await withdrawal.json()).toMatchObject({
          data: {
            receipt: {
              action: "withdrawn",
              role: "role_assigner",
              targetUserId,
            },
          },
        });

        const targetBlockers = await caseApp.db
          .prepare(
            `SELECT
              (SELECT COUNT(*) FROM department_membership WHERE user_id = ?) AS departmentMemberships,
              (SELECT COUNT(*) FROM enrolment WHERE user_id = ?) AS enrolments,
              (SELECT COUNT(*) FROM invitation WHERE user_id = ?) AS invitations,
              (SELECT COUNT(*) FROM department_manager_assignment WHERE user_id = ?) AS departmentManagerAssignments,
              (SELECT COUNT(*) FROM program_leader_assignment WHERE user_id = ?) AS programLeaderAssignments,
              (SELECT COUNT(*) FROM role_assigner_assignment WHERE user_id = ?) AS roleAssignerAssignments,
              (SELECT COUNT(*) FROM role_assignment_history WHERE target_user_id = ? AND role <> 'role_assigner') AS otherRoleHistory`
          )
          .bind(
            targetUserId,
            targetUserId,
            targetUserId,
            targetUserId,
            targetUserId,
            targetUserId,
            targetUserId
          )
          .first();
        expect(targetBlockers).toEqual({
          departmentManagerAssignments: 0,
          departmentMemberships: 0,
          enrolments: 0,
          invitations: 0,
          otherRoleHistory: 0,
          programLeaderAssignments: 0,
          roleAssignerAssignments: 0,
        });

        await confirmAdmin(admin.context, admin.password);
        const deletionKey = randomUUID();
        const deletion = await admin.context.post(
          "/api/v2/staff/accounts/delete",
          { data: { operationKey: deletionKey, targetUserId } }
        );
        expect(deletion.status()).toBe(409);
        expect(await deletion.json()).toMatchObject({
          error: { code: "church_history_retained" },
        });
        await expect(
          caseApp.db
            .prepare("DELETE FROM user WHERE id = ?")
            .bind(targetUserId)
            .run()
        ).rejects.toThrow();

        expect(
          await caseApp.db
            .prepare(
              "SELECT account_role AS role, membership_status AS membershipStatus, banned_at AS bannedAt FROM person_profile WHERE user_id = ?"
            )
            .bind(targetUserId)
            .first()
        ).toEqual({
          bannedAt: null,
          membershipStatus: "active",
          role: "staff",
        });
        expect(
          await caseApp.db
            .prepare("SELECT id FROM user WHERE id = ?")
            .bind(targetUserId)
            .first()
        ).toEqual({ id: targetUserId });
        const roleAssignerHistory = await caseApp.db
          .prepare(
            "SELECT action, role, resulting_global_role AS resultingGlobalRole, scope_id AS scopeId, scope_name AS scopeName FROM role_assignment_history WHERE target_user_id = ?"
          )
          .bind(targetUserId)
          .all();
        expect(roleAssignerHistory.results).toEqual(
          expect.arrayContaining([
            {
              action: "granted",
              resultingGlobalRole: null,
              role: "role_assigner",
              scopeId: "global",
              scopeName: "全域角色",
            },
            {
              action: "withdrawn",
              resultingGlobalRole: null,
              role: "role_assigner",
              scopeId: "global",
              scopeName: "全域角色",
            },
          ])
        );
        expect(
          await caseApp.db
            .prepare(
              "SELECT COUNT(*) AS count FROM role_assignment_history WHERE target_user_id = ?"
            )
            .bind(targetUserId)
            .first()
        ).toEqual({ count: 2 });
        const roleAssignerAudits = await caseApp.db
          .prepare(
            "SELECT action, COUNT(*) AS count FROM audit_event WHERE target_user_id = ? GROUP BY action ORDER BY action"
          )
          .bind(targetUserId)
          .all();
        expect(roleAssignerAudits.results).toEqual([
          { action: "role_assigner_granted", count: 1 },
          { action: "role_assigner_withdrawn", count: 1 },
        ]);
        const roleAssignerReceipts = await caseApp.db
          .prepare(
            "SELECT actor_user_id AS actorUserId, action, role, operation_key AS operationKey, resulting_global_role AS resultingGlobalRole, scope_id AS scopeId, scope_name AS scopeName FROM role_change_operation WHERE target_user_id = ? ORDER BY action"
          )
          .bind(targetUserId)
          .all();
        expect(roleAssignerReceipts.results).toEqual([
          {
            action: "granted",
            actorUserId: admin.userId,
            operationKey: grantKey,
            resultingGlobalRole: null,
            role: "role_assigner",
            scopeId: "global",
            scopeName: "全域角色",
          },
          {
            action: "withdrawn",
            actorUserId: admin.userId,
            operationKey: withdrawalKey,
            resultingGlobalRole: null,
            role: "role_assigner",
            scopeId: "global",
            scopeName: "全域角色",
          },
        ]);
        expect(
          await caseApp.db
            .prepare(
              "SELECT action FROM audit_event WHERE target_user_id = ? AND action = 'account_deleted'"
            )
            .bind(targetUserId)
            .first()
        ).toBeNull();
        expect(
          await caseApp.db
            .prepare(
              "SELECT action FROM account_change_operation WHERE actor_user_id = ? AND target_user_id = ? AND operation_key = ? AND action = 'account_deleted'"
            )
            .bind(admin.userId, targetUserId, deletionKey)
            .first()
        ).toBeNull();
      }
    );

    roleTest(
      "an Admin can delegate Role Assigner and Staff exit never restores it",
      { tag: ["@http"] },
      async ({ admin, caseApp, extraHTTPHeaders, playwright }) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
        const username = `roles.exit.${suffix}`;
        const password = "Synthetic-staff-exit-password!";
        const targetUserId = await caseApp.provision.account({
          email: `${suffix}@example.com`,
          fullName: `陳角色退出${suffix}`,
          membershipStatus: "active",
          password,
          role: "member",
          username,
        });
        const recipient = await playwright.request.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const login = await recipient.post("/api/auth/sign-in/username", {
            data: { password, username },
          });
          expect(login.status()).toBe(200);

          await confirmAdmin(admin.context, admin.password);
          const staffGrant = await admin.context.post(
            "/api/v2/roles/global-roles",
            {
              data: {
                action: "granted",
                operationKey: randomUUID(),
                role: "staff",
                targetUserId,
              },
            }
          );
          expect(staffGrant.status()).toBe(201);

          await confirmAdmin(admin.context, admin.password);
          const roleAssignerGrantInput = {
            action: "granted" as const,
            operationKey: randomUUID(),
            targetUserId,
          };
          const roleAssignerGrant = await admin.context.post(
            "/api/v2/roles/role-assigners",
            { data: roleAssignerGrantInput }
          );
          expect(roleAssignerGrant.status()).toBe(201);
          const roleAssignerGrantBody = (await roleAssignerGrant.json()) as {
            data: {
              receipt: {
                role: string;
                targetUserId: string;
              };
            };
          };
          expect(roleAssignerGrantBody.data.receipt).toMatchObject({
            role: "role_assigner",
            targetUserId,
          });
          expect(roleAssignerGrantBody.data.receipt).not.toHaveProperty(
            "resultingGlobalRole"
          );
          const roleAssignerGrantReplay = await admin.context.post(
            "/api/v2/roles/role-assigners",
            { data: roleAssignerGrantInput }
          );
          expect(roleAssignerGrantReplay.status()).toBe(200);
          expect(await roleAssignerGrantReplay.json()).toEqual(
            roleAssignerGrantBody
          );

          const selected = await admin.context.get(
            `/api/v2/roles/global-roles/${encodeURIComponent(targetUserId)}`
          );
          expect(selected.status()).toBe(200);
          const selectedBody = (await selected.json()) as {
            data: {
              person: {
                roleAssignerAssignment: {
                  assignmentId: string;
                  createdAt: number;
                } | null;
              };
            };
          };
          const firstAssignment =
            selectedBody.data.person.roleAssignerAssignment;
          expect(firstAssignment).not.toBeNull();
          if (!firstAssignment) {
            throw new Error(
              "Role Assigner grant returned no current assignment"
            );
          }

          const roleAssignerWithdrawInput = {
            action: "withdrawn" as const,
            expectedAssignmentId: firstAssignment.assignmentId,
            operationKey: randomUUID(),
            targetUserId,
          };
          await confirmAdmin(admin.context, admin.password);
          const roleAssignerWithdrawal = await admin.context.post(
            "/api/v2/roles/role-assigners",
            { data: roleAssignerWithdrawInput }
          );
          expect(roleAssignerWithdrawal.status()).toBe(201);
          expect(await roleAssignerWithdrawal.json()).toMatchObject({
            data: { receipt: { action: "withdrawn" } },
          });

          await confirmAdmin(admin.context, admin.password);
          const roleAssignerRegrant = await admin.context.post(
            "/api/v2/roles/role-assigners",
            {
              data: {
                action: "granted",
                operationKey: randomUUID(),
                targetUserId,
              },
            }
          );
          expect(roleAssignerRegrant.status()).toBe(201);

          const regrantedSelection = await admin.context.get(
            `/api/v2/roles/global-roles/${encodeURIComponent(targetUserId)}`
          );
          expect(regrantedSelection.status()).toBe(200);
          expect(
            (
              (await regrantedSelection.json()) as {
                data: {
                  person: {
                    roleAssignerAssignment: { assignmentId: string } | null;
                  };
                };
              }
            ).data.person.roleAssignerAssignment
          ).not.toBeNull();

          await confirmAdmin(admin.context, admin.password);
          const staffExit = await admin.context.post(
            "/api/v2/roles/global-roles",
            {
              data: {
                action: "withdrawn",
                operationKey: randomUUID(),
                role: "staff",
                targetUserId,
              },
            }
          );
          expect(staffExit.status()).toBe(201);
          expect(await staffExit.json()).toMatchObject({
            data: {
              receipt: {
                action: "withdrawn",
                resultingGlobalRole: "member",
                role: "staff",
                targetUserId,
              },
            },
          });

          const memberSelection = await admin.context.get(
            `/api/v2/roles/global-roles/${encodeURIComponent(targetUserId)}`
          );
          expect(memberSelection.status()).toBe(200);
          expect(await memberSelection.json()).toMatchObject({
            data: {
              person: {
                role: "member",
                roleAssignerAssignment: null,
                userId: targetUserId,
              },
            },
          });

          await confirmAdmin(admin.context, admin.password);
          const staffReentry = await admin.context.post(
            "/api/v2/roles/global-roles",
            {
              data: {
                action: "granted",
                operationKey: randomUUID(),
                role: "staff",
                targetUserId,
              },
            }
          );
          expect(staffReentry.status()).toBe(201);

          const staffTools = await recipient.get("/api/v2/staff/accounts");
          expect(staffTools.status()).toBe(200);
          const finalSelection = await admin.context.get(
            `/api/v2/roles/global-roles/${encodeURIComponent(targetUserId)}`
          );
          expect(finalSelection.status()).toBe(200);
          expect(await finalSelection.json()).toMatchObject({
            data: {
              person: {
                role: "staff",
                roleAssignerAssignment: null,
                userId: targetUserId,
              },
            },
          });

          const inbox = await recipient.get("/api/v2/inbox");
          expect(inbox.status()).toBe(200);
          const inboxBody = (await inbox.json()) as {
            data: {
              roleChanges: {
                action: string;
                createdAt: number;
                resultingGlobalRole?: string;
                role: string;
                scopeName: string;
              }[];
            };
          };
          const roleAssignerEvents = inboxBody.data.roleChanges.filter(
            (event) => event.role === "role_assigner"
          );
          expect(roleAssignerEvents).toHaveLength(4);
          expect(
            roleAssignerEvents.every(
              (event) => !("resultingGlobalRole" in event)
            )
          ).toBe(true);
          expect(
            roleAssignerEvents.map((event) => Object.keys(event).toSorted())
          ).toEqual(
            Array.from({ length: 4 }, () => [
              "action",
              "createdAt",
              "role",
              "scopeName",
            ])
          );
          expect(
            roleAssignerEvents.filter((event) => event.action === "granted")
          ).toHaveLength(2);
          expect(
            roleAssignerEvents.filter((event) => event.action === "withdrawn")
          ).toHaveLength(2);
          const staffEvents = inboxBody.data.roleChanges.filter(
            (event) => event.role === "staff"
          );
          expect(staffEvents).toHaveLength(3);
          expect(staffEvents.map((event) => event.action).toSorted()).toEqual([
            "granted",
            "granted",
            "withdrawn",
          ]);
          expect(
            staffEvents.find((event) => event.action === "withdrawn")
          ).toMatchObject({ resultingGlobalRole: "member" });
          expect(
            staffEvents
              .filter((event) => event.action === "granted")
              .every((event) => event.resultingGlobalRole === "staff")
          ).toBe(true);
          expect(
            staffEvents.map((event) => Object.keys(event).toSorted())
          ).toEqual(
            Array.from({ length: 3 }, () => [
              "action",
              "createdAt",
              "resultingGlobalRole",
              "role",
              "scopeName",
            ])
          );
          expect(JSON.stringify(inboxBody)).not.toContain(targetUserId);
          expect(JSON.stringify(inboxBody)).not.toContain(
            roleAssignerGrantInput.operationKey
          );

          const durableEffects = await caseApp.db
            .prepare(
              "select (select count(*) from role_assigner_assignment where user_id = ?) as currentDelegations, (select count(*) from role_assignment_history where target_user_id = ? and role = 'role_assigner') as delegationHistory, (select count(*) from audit_event where actor_user_id = ? and target_user_id = ? and action in ('role_assigner_granted', 'role_assigner_withdrawn')) as delegationAudits, (select count(*) from role_change_operation where actor_user_id = ? and target_user_id = ? and role = 'role_assigner') as delegationReceipts, (select count(*) from role_assignment_history where target_user_id = ? and role = 'staff') as staffHistory, (select count(*) from audit_event where actor_user_id = ? and target_user_id = ? and action = 'global_role_changed') as staffAudits, (select count(*) from role_change_operation where actor_user_id = ? and target_user_id = ? and role = 'staff') as staffReceipts"
            )
            .bind(
              targetUserId,
              targetUserId,
              admin.userId,
              targetUserId,
              admin.userId,
              targetUserId,
              targetUserId,
              admin.userId,
              targetUserId,
              admin.userId,
              targetUserId
            )
            .first<{
              currentDelegations: number;
              delegationAudits: number;
              delegationHistory: number;
              delegationReceipts: number;
              staffAudits: number;
              staffHistory: number;
              staffReceipts: number;
            }>();
          expect(durableEffects).toEqual({
            currentDelegations: 0,
            delegationAudits: 4,
            delegationHistory: 4,
            delegationReceipts: 3,
            staffAudits: 3,
            staffHistory: 3,
            staffReceipts: 3,
          });
        } finally {
          await recipient.dispose();
        }
      }
    );

    roleTest(
      "Staff exit removes Role Assigner while preserving and using independent DM and Program Leader assignments",
      { tag: ["@http", "@risk-deletion"] },
      async ({ admin, caseApp, extraHTTPHeaders, playwright }) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
        const username = `scopeexit${suffix.slice(0, 8)}`;
        const password = "Synthetic-scoped-role-exit-password!";
        const targetUserId = await caseApp.provision.account({
          email: `scope-exit.${suffix}@example.com`,
          fullName: `陳保留職務${suffix}`,
          membershipStatus: "active",
          password,
          role: "member",
          username,
        });
        const nextLeaderUserId = await caseApp.provision.account({
          email: `scope-target.${suffix}@example.com`,
          fullName: `陳離任後候選人${suffix}`,
          membershipStatus: "active",
          password: "Synthetic-after-exit-member-password!",
          role: "member",
          username: `afterexit${suffix.slice(0, 8)}`,
        });
        const departmentId = randomUUID();
        const programId = randomUUID();
        await caseApp.db
          .prepare(
            "INSERT INTO department(id,name,created_at) VALUES(?,?,unixepoch())"
          )
          .bind(departmentId, `保留職務部門${suffix}`)
          .run();
        await caseApp.db
          .prepare(
            "INSERT INTO program(id,department_id,name,created_at) VALUES(?,?,?,unixepoch())"
          )
          .bind(programId, departmentId, `保留職務聚會${suffix}`)
          .run();
        await caseApp.db
          .prepare(
            "INSERT INTO department_membership (id, department_id, user_id, created_at) VALUES (?, ?, ?, unixepoch())"
          )
          .bind(randomUUID(), departmentId, nextLeaderUserId)
          .run();

        const recipient = await playwright.request.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const login = await recipient.post("/api/auth/sign-in/username", {
            data: { password, username },
          });
          expect(login.status()).toBe(200);

          await confirmAdmin(admin.context, admin.password);
          const departmentManagerGrant = await admin.context.post(
            "/api/v2/roles/department-managers",
            {
              data: {
                action: "granted",
                operationKey: randomUUID(),
                scopeId: departmentId,
                targetUserId,
              },
            }
          );
          expect(departmentManagerGrant.status()).toBe(201);
          const departmentManagerAssignment = await caseApp.db
            .prepare(
              "SELECT id FROM department_manager_assignment WHERE department_id = ? AND user_id = ?"
            )
            .bind(departmentId, targetUserId)
            .first<{ id: string }>();
          if (!departmentManagerAssignment) {
            throw new Error("Admin DM grant did not create its current row");
          }

          await confirmAdmin(admin.context, admin.password);
          const programLeaderGrant = await admin.context.post(
            "/api/v2/roles/program-leaders",
            {
              data: {
                action: "granted",
                operationKey: randomUUID(),
                scopeId: programId,
                targetUserId,
              },
            }
          );
          expect(programLeaderGrant.status()).toBe(201);
          const programLeaderAssignment = await caseApp.db
            .prepare(
              "SELECT id FROM program_leader_assignment WHERE program_id = ? AND user_id = ?"
            )
            .bind(programId, targetUserId)
            .first<{ id: string }>();
          if (!programLeaderAssignment) {
            throw new Error("Admin PL grant did not create its current row");
          }

          await confirmAdmin(admin.context, admin.password);
          const staffGrant = await admin.context.post(
            "/api/v2/roles/global-roles",
            {
              data: {
                action: "granted",
                operationKey: randomUUID(),
                role: "staff",
                targetUserId,
              },
            }
          );
          expect(staffGrant.status()).toBe(201);

          await confirmAdmin(admin.context, admin.password);
          const roleAssignerGrant = await admin.context.post(
            "/api/v2/roles/role-assigners",
            {
              data: {
                action: "granted",
                operationKey: randomUUID(),
                targetUserId,
              },
            }
          );
          expect(roleAssignerGrant.status()).toBe(201);

          await confirmAdmin(admin.context, admin.password);
          const staffExit = await admin.context.post(
            "/api/v2/roles/global-roles",
            {
              data: {
                action: "withdrawn",
                operationKey: randomUUID(),
                role: "staff",
                targetUserId,
              },
            }
          );
          expect(staffExit.status()).toBe(201);
          expect(await staffExit.json()).toMatchObject({
            data: {
              receipt: {
                action: "withdrawn",
                resultingGlobalRole: "member",
                role: "staff",
                targetUserId,
              },
            },
          });

          const assignmentsAfterExit = await caseApp.db
            .prepare(
              `SELECT
                (SELECT account_role FROM person_profile WHERE user_id = ?) AS role,
                (SELECT id FROM department_manager_assignment WHERE department_id = ? AND user_id = ?) AS departmentManagerAssignmentId,
                (SELECT id FROM program_leader_assignment WHERE program_id = ? AND user_id = ?) AS programLeaderAssignmentId,
                (SELECT id FROM role_assigner_assignment WHERE user_id = ?) AS roleAssignerAssignmentId,
                (SELECT COUNT(*) FROM department_membership WHERE department_id = ? AND user_id = ?) AS nextLeaderMemberships`
            )
            .bind(
              targetUserId,
              departmentId,
              targetUserId,
              programId,
              targetUserId,
              targetUserId,
              departmentId,
              nextLeaderUserId
            )
            .first();
          expect(assignmentsAfterExit).toEqual({
            departmentManagerAssignmentId: departmentManagerAssignment.id,
            nextLeaderMemberships: 1,
            programLeaderAssignmentId: programLeaderAssignment.id,
            role: "member",
            roleAssignerAssignmentId: null,
          });

          const confirmation = await recipient.post(
            "/api/v2/account/password-confirmation",
            { data: { operationKey: randomUUID(), password } }
          );
          expect(confirmation.status()).toBe(201);
          const postExitProgramLeaderGrant = await recipient.post(
            "/api/v2/roles/program-leaders",
            {
              data: {
                action: "granted",
                authorityAssignmentId: departmentManagerAssignment.id,
                operationKey: randomUUID(),
                scopeId: programId,
                targetUserId: nextLeaderUserId,
              },
            }
          );
          expect(postExitProgramLeaderGrant.status()).toBe(201);
          expect(await postExitProgramLeaderGrant.json()).toMatchObject({
            data: {
              receipt: {
                action: "granted",
                scopeId: programId,
                targetUserId: nextLeaderUserId,
              },
            },
          });
          expect(
            await caseApp.db
              .prepare(
                "SELECT id FROM program_leader_assignment WHERE program_id = ? AND user_id = ?"
              )
              .bind(programId, nextLeaderUserId)
              .first()
          ).not.toBeNull();
          expect(
            await caseApp.db
              .prepare(
                "SELECT COUNT(*) AS count FROM department_membership WHERE department_id = ? AND user_id = ?"
              )
              .bind(departmentId, nextLeaderUserId)
              .first()
          ).toEqual({ count: 1 });

          await confirmAdmin(admin.context, admin.password);
          const deletion = await admin.context.post(
            "/api/v2/staff/accounts/delete",
            { data: { operationKey: randomUUID(), targetUserId } }
          );
          expect(deletion.status()).toBe(409);
          expect(await deletion.json()).toMatchObject({
            error: { code: "church_history_retained" },
          });
          const retained = await caseApp.db
            .prepare(
              `SELECT
                (SELECT id FROM user WHERE id = ?) AS userId,
                (SELECT COUNT(*) FROM department_manager_assignment WHERE department_id = ? AND user_id = ?) AS departmentManagerAssignments,
                (SELECT COUNT(*) FROM program_leader_assignment WHERE program_id = ? AND user_id = ?) AS programLeaderAssignments,
                (SELECT COUNT(*) FROM role_assigner_assignment WHERE user_id = ?) AS roleAssignerAssignments,
                (SELECT COUNT(*) FROM role_assignment_history WHERE target_user_id = ? AND role = 'department_manager') AS departmentManagerHistory,
                (SELECT COUNT(*) FROM role_assignment_history WHERE target_user_id = ? AND role = 'program_leader') AS programLeaderHistory,
                (SELECT COUNT(*) FROM role_assignment_history WHERE target_user_id = ? AND role = 'role_assigner') AS roleAssignerHistory,
                (SELECT COUNT(*) FROM role_assignment_history WHERE target_user_id = ? AND role = 'staff') AS staffHistory,
                (SELECT COUNT(*) FROM audit_event WHERE target_user_id = ? AND action = 'account_deleted') AS deletionAudits`
            )
            .bind(
              targetUserId,
              departmentId,
              targetUserId,
              programId,
              targetUserId,
              targetUserId,
              targetUserId,
              targetUserId,
              targetUserId,
              targetUserId,
              targetUserId
            )
            .first();
          expect(retained).toEqual({
            deletionAudits: 0,
            departmentManagerAssignments: 1,
            departmentManagerHistory: 1,
            programLeaderAssignments: 1,
            programLeaderHistory: 1,
            roleAssignerAssignments: 0,
            roleAssignerHistory: 2,
            staffHistory: 2,
            userId: targetUserId,
          });
        } finally {
          await recipient.dispose();
        }
      }
    );

    roleTest(
      "a required Staff-exit cleanup Audit failure rolls back the role change and delegation before same-key retry",
      { tag: ["@http", "@risk-recovery", "@risk-rollback"] },
      async ({ admin, caseApp, extraHTTPHeaders, playwright }) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
        const username = `rb.${suffix}`;
        const password = "Synthetic-staff-exit-rollback-password!";
        const targetUserId = await caseApp.provision.account({
          email: `${suffix}@example.com`,
          fullName: `陳退出原子目標${suffix}`,
          membershipStatus: "active",
          password,
          role: "member",
          username,
        });
        const recipient = await playwright.request.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        const promotionKey = randomUUID();
        const delegationKey = randomUUID();
        const exitKey = randomUUID();
        const trigger = `synthetic_staff_exit_cleanup_${randomUUID().replaceAll("-", "")}`;

        try {
          const login = await recipient.post("/api/auth/sign-in/username", {
            data: { password, username },
          });
          expect(login.status()).toBe(200);

          await confirmAdmin(admin.context, admin.password);
          const promotion = await admin.context.post(
            "/api/v2/roles/global-roles",
            {
              data: {
                action: "granted",
                operationKey: promotionKey,
                role: "staff",
                targetUserId,
              },
            }
          );
          expect(promotion.status()).toBe(201);

          await confirmAdmin(admin.context, admin.password);
          const delegation = await admin.context.post(
            "/api/v2/roles/role-assigners",
            {
              data: {
                action: "granted",
                operationKey: delegationKey,
                targetUserId,
              },
            }
          );
          expect(delegation.status()).toBe(201);
          const assignment = await caseApp.db
            .prepare(
              "SELECT id FROM role_assigner_assignment WHERE user_id = ?"
            )
            .bind(targetUserId)
            .first<{ id: string }>();
          if (!assignment) {
            throw new Error(
              "Role Assigner grant did not create its current row"
            );
          }

          await caseApp.db
            .prepare(
              `CREATE TRIGGER ${trigger} BEFORE INSERT ON audit_event
                WHEN NEW.target_user_id = '${targetUserId}'
                  AND NEW.action = 'role_assigner_withdrawn'
                BEGIN SELECT RAISE(ABORT, 'Synthetic Staff-exit cleanup Audit failure'); END`
            )
            .run();
          try {
            await confirmAdmin(admin.context, admin.password);
            const exit = await admin.context.post(
              "/api/v2/roles/global-roles",
              {
                data: {
                  action: "withdrawn",
                  operationKey: exitKey,
                  role: "staff",
                  targetUserId,
                },
              }
            );
            const exitBody = (await exit.json()) as {
              error?: { code?: string };
            };
            expect(exit.status(), JSON.stringify(exitBody)).toBe(500);
            expect(exitBody.error?.code).toBe("internal_error");
          } finally {
            await caseApp.db.prepare(`DROP TRIGGER ${trigger}`).run();
          }

          const failedEffects = await caseApp.db
            .prepare(
              `SELECT
                (SELECT account_role FROM person_profile WHERE user_id = ?) AS role,
                (SELECT id FROM role_assigner_assignment WHERE user_id = ?) AS delegation,
                (SELECT COUNT(*) FROM role_assignment_history WHERE target_user_id = ? AND role = 'staff') AS staffHistory,
                (SELECT COUNT(*) FROM role_assignment_history WHERE target_user_id = ? AND role = 'role_assigner') AS delegationHistory,
                (SELECT COUNT(*) FROM audit_event WHERE actor_user_id = ? AND target_user_id = ? AND action = 'global_role_changed') AS staffAudits,
                (SELECT COUNT(*) FROM audit_event WHERE actor_user_id = ? AND target_user_id = ? AND action IN ('role_assigner_granted','role_assigner_withdrawn')) AS delegationAudits,
                (SELECT COUNT(*) FROM role_change_operation WHERE actor_user_id = ? AND target_user_id = ? AND role = 'staff') AS staffReceipts,
                (SELECT COUNT(*) FROM role_change_operation WHERE actor_user_id = ? AND target_user_id = ? AND role = 'role_assigner') AS delegationReceipts,
                (SELECT COUNT(*) FROM role_change_operation WHERE actor_user_id = ? AND operation_key = ?) AS exitReceipt`
            )
            .bind(
              targetUserId,
              targetUserId,
              targetUserId,
              targetUserId,
              admin.userId,
              targetUserId,
              admin.userId,
              targetUserId,
              admin.userId,
              targetUserId,
              admin.userId,
              targetUserId,
              admin.userId,
              exitKey
            )
            .first();
          expect(failedEffects).toEqual({
            delegation: assignment.id,
            delegationAudits: 1,
            delegationHistory: 1,
            delegationReceipts: 1,
            exitReceipt: 0,
            role: "staff",
            staffAudits: 1,
            staffHistory: 1,
            staffReceipts: 1,
          });
          const unchangedInbox = await recipient.get("/api/v2/inbox");
          expect(unchangedInbox.status()).toBe(200);
          const unchangedInboxBody = await unchangedInbox.json();
          expect(unchangedInboxBody.data.roleChanges).toHaveLength(2);
          const unknown = await admin.context.post(
            "/api/v2/roles/global-roles/reconcile",
            { data: { operationKey: exitKey } }
          );
          expect(unknown.status()).toBe(200);
          expect(await unknown.json()).toMatchObject({
            data: { outcome: "unknown", receipt: null },
          });

          await confirmAdmin(admin.context, admin.password);
          const retry = await admin.context.post("/api/v2/roles/global-roles", {
            data: {
              action: "withdrawn",
              operationKey: exitKey,
              role: "staff",
              targetUserId,
            },
          });
          expect(retry.status()).toBe(201);
          expect(await retry.json()).toMatchObject({
            data: {
              receipt: {
                action: "withdrawn",
                resultingGlobalRole: "member",
                role: "staff",
                targetUserId,
              },
            },
          });

          const committedEffects = await caseApp.db
            .prepare(
              `SELECT
                (SELECT account_role FROM person_profile WHERE user_id = ?) AS role,
                (SELECT COUNT(*) FROM role_assigner_assignment WHERE user_id = ?) AS delegations,
                (SELECT COUNT(*) FROM role_assignment_history WHERE target_user_id = ? AND role = 'staff') AS staffHistory,
                (SELECT COUNT(*) FROM role_assignment_history WHERE target_user_id = ? AND role = 'role_assigner') AS delegationHistory,
                (SELECT COUNT(*) FROM audit_event WHERE actor_user_id = ? AND target_user_id = ? AND action = 'global_role_changed') AS staffAudits,
                (SELECT COUNT(*) FROM audit_event WHERE actor_user_id = ? AND target_user_id = ? AND action IN ('role_assigner_granted','role_assigner_withdrawn')) AS delegationAudits,
                (SELECT COUNT(*) FROM role_change_operation WHERE actor_user_id = ? AND target_user_id = ? AND role = 'staff') AS staffReceipts,
                (SELECT COUNT(*) FROM role_change_operation WHERE actor_user_id = ? AND target_user_id = ? AND role = 'role_assigner') AS delegationReceipts`
            )
            .bind(
              targetUserId,
              targetUserId,
              targetUserId,
              targetUserId,
              admin.userId,
              targetUserId,
              admin.userId,
              targetUserId,
              admin.userId,
              targetUserId,
              admin.userId,
              targetUserId
            )
            .first();
          expect(committedEffects).toEqual({
            delegationAudits: 2,
            delegationHistory: 2,
            delegationReceipts: 1,
            delegations: 0,
            role: "member",
            staffAudits: 2,
            staffHistory: 2,
            staffReceipts: 2,
          });
          const committedInbox = await recipient.get("/api/v2/inbox");
          expect(committedInbox.status()).toBe(200);
          const committedInboxBody = await committedInbox.json();
          const events = committedInboxBody.data.roleChanges as {
            action: string;
            resultingGlobalRole?: string;
            role: string;
          }[];
          expect(events).toHaveLength(4);
          expect(
            events.filter((event) => event.role === "role_assigner")
          ).toHaveLength(2);
          expect(
            events
              .filter((event) => event.role === "role_assigner")
              .every((event) => !("resultingGlobalRole" in event))
          ).toBe(true);
          expect(events.filter((event) => event.role === "staff")).toHaveLength(
            2
          );
          expect(
            events.find(
              (event) => event.role === "staff" && event.action === "withdrawn"
            )
          ).toMatchObject({ resultingGlobalRole: "member" });
          expect(JSON.stringify(events)).not.toContain(targetUserId);
          expect(JSON.stringify(events)).not.toContain(exitKey);

          const committed = await admin.context.post(
            "/api/v2/roles/global-roles/reconcile",
            { data: { operationKey: exitKey } }
          );
          expect(committed.status()).toBe(200);
          expect(await committed.json()).toMatchObject({
            data: { outcome: "committed", receipt: { action: "withdrawn" } },
          });

          await confirmAdmin(admin.context, admin.password);
          const deletionKey = randomUUID();
          const deletion = await admin.context.post(
            "/api/v2/staff/accounts/delete",
            { data: { operationKey: deletionKey, targetUserId } }
          );
          expect(deletion.status()).toBe(409);
          expect(await deletion.json()).toMatchObject({
            error: { code: "church_history_retained" },
          });
          expect(
            await caseApp.db
              .prepare(
                "SELECT action, role FROM role_assignment_history WHERE target_user_id = ? AND role = 'role_assigner'"
              )
              .bind(targetUserId)
              .all()
          ).toMatchObject({
            results: [
              { action: "granted", role: "role_assigner" },
              { action: "withdrawn", role: "role_assigner" },
            ],
          });
          expect(
            await caseApp.db
              .prepare("SELECT id FROM user WHERE id = ?")
              .bind(targetUserId)
              .first()
          ).not.toBeNull();
          expect(
            await caseApp.db
              .prepare(
                "SELECT id FROM audit_event WHERE target_user_id = ? AND action = 'account_deleted'"
              )
              .bind(targetUserId)
              .first()
          ).toBeNull();
        } finally {
          await caseApp.db
            .prepare(`DROP TRIGGER IF EXISTS ${trigger}`)
            .run()
            .catch(() => null);
          await recipient.dispose();
        }
      }
    );
  }
);
