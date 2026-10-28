import { randomUUID } from "node:crypto";

import type { APIRequestContext } from "@playwright/test";

import { dedicatedTest, expect } from "../../support/fixtures";

const roleTest = dedicatedTest.extend<{
  admin: { context: APIRequestContext; userId: string };
}>({
  admin: async ({ caseApp, extraHTTPHeaders, playwright }, use) => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
    const username = `roles.admin.${suffix}`;
    const password = "Synthetic-native-password!";
    const userId = await caseApp.provision.account({
      email: `${suffix}@example.com`,
      fullName: `陳角色${suffix}`,
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
      await use({ context, userId });
    } finally {
      await context.dispose();
    }
  },
});

const requiredAssignmentId = (assignment: { id: string } | null) => {
  if (!assignment) {
    throw new Error("Expected Department Manager assignment");
  }
  return assignment.id;
};

roleTest.describe(
  "Admin Department Manager assignments",
  {
    tag: [
      "@native",
      "@risk-authorization",
      "@risk-atomicity",
      "@risk-privacy",
      "@home",
    ],
  },
  () => {
    roleTest(
      "one person-scoped command commits once, replays reordered intent, and rejects collisions and over-cap sets",
      { tag: ["@http", "@risk-atomicity"] },
      async ({ admin, caseApp }) => {
        const scopes = Array.from({ length: 5 }, () => randomUUID());
        await caseApp.db.batch(
          scopes.map((scope, index) =>
            caseApp.db
              .prepare(
                "INSERT INTO department (id,name,created_at) VALUES (?,?,unixepoch())"
              )
              .bind(scope, `批次部門${index}`)
          )
        );
        const operationKey = randomUUID();
        const changes = scopes
          .slice(0, 4)
          .map((scopeId) => ({ action: "granted", scopeId }));
        const input = { changes, operationKey, targetUserId: admin.userId };
        const baseline = await admin.context.get(
          `/api/v2/roles/scoped-department-managers/${encodeURIComponent(admin.userId)}?page=1`
        );
        expect(baseline.status()).toBe(200);
        const baselineBody = await baseline.json();
        const baselineData = baselineBody.data;
        expect(baselineData.changeLimit).toBe(4);
        expect(
          baselineData.departments.filter((row: { scopeId: string }) =>
            scopes.some((scope) => scope === row.scopeId)
          )
        ).toEqual(
          expect.arrayContaining(
            scopes.map((scopeId) =>
              expect.objectContaining({ assignmentId: null, scopeId })
            )
          )
        );
        const over = await admin.context.post(
          "/api/v2/roles/scoped-department-managers",
          {
            data: {
              ...input,
              changes: scopes.map((scopeId) => ({
                action: "granted",
                scopeId,
              })),
            },
          }
        );
        expect(over.status()).toBe(400);
        const save = await admin.context.post(
          "/api/v2/roles/scoped-department-managers",
          { data: input }
        );
        expect(save.status()).toBe(201);
        const replay = await admin.context.post(
          "/api/v2/roles/scoped-department-managers",
          {
            data: { ...input, changes: changes.toReversed() },
          }
        );
        expect(replay.status()).toBe(200);
        const savedBody = await save.json();
        expect(await replay.json()).toEqual(savedBody);
        const reconciled = await admin.context.post(
          "/api/v2/roles/scoped-department-managers/reconcile",
          { data: { operationKey } }
        );
        expect(reconciled.status()).toBe(200);
        expect(await reconciled.json()).toEqual({
          data: {
            outcome: "committed",
            receipt: savedBody.data.receipt,
          },
        });
        const missing = await admin.context.post(
          "/api/v2/roles/scoped-department-managers/reconcile",
          { data: { operationKey: randomUUID() } }
        );
        expect(await missing.json()).toEqual({
          data: { outcome: "unknown", receipt: null },
        });
        const different = await admin.context.post(
          "/api/v2/roles/scoped-department-managers",
          {
            data: { ...input, changes: changes.slice(0, 3) },
          }
        );
        expect(different.status()).toBe(409);
        const collision = await admin.context.post(
          "/api/v2/roles/department-managers",
          {
            data: {
              action: "granted",
              operationKey,
              scopeId: scopes[4],
              targetUserId: admin.userId,
            },
          }
        );
        expect(collision.status()).toBe(409);
        const counts = await caseApp.db
          .prepare(`SELECT
          (SELECT count(*) FROM department_manager_assignment WHERE user_id = ?) AS assignments,
          (SELECT count(*) FROM role_assignment_history WHERE target_user_id = ?) AS history,
          (SELECT count(*) FROM audit_event WHERE target_user_id = ? AND action = 'department_manager_granted') AS audits,
          (SELECT count(*) FROM role_change_operation WHERE actor_user_id = ? AND operation_key = ?) AS receipts`)
          .bind(
            admin.userId,
            admin.userId,
            admin.userId,
            admin.userId,
            operationKey
          )
          .first();
        expect(counts).toEqual({
          assignments: 4,
          audits: 4,
          history: 4,
          receipts: 1,
        });
        const witness = await caseApp.db
          .prepare(
            "SELECT id FROM department_manager_assignment WHERE user_id = ? AND department_id = ?"
          )
          .bind(admin.userId, scopes[0])
          .first<{ id: string }>();
        expect(witness).not.toBeNull();
        const mixed = await admin.context.post(
          "/api/v2/roles/scoped-department-managers",
          {
            data: {
              changes: [
                {
                  action: "withdrawn",
                  expectedAssignmentId: witness?.id,
                  scopeId: scopes[0],
                },
                { action: "granted", scopeId: scopes[4] },
              ],
              operationKey: randomUUID(),
              targetUserId: admin.userId,
            },
          }
        );
        expect(mixed.status()).toBe(201);
        const remaining = await caseApp.db
          .prepare(
            "SELECT department_id FROM department_manager_assignment WHERE user_id = ?"
          )
          .bind(admin.userId)
          .all<{ department_id: string }>();
        expect(
          remaining.results.map((row) => row.department_id).toSorted()
        ).toEqual(scopes.slice(1).toSorted());
        const otherScope = randomUUID();
        await caseApp.db
          .prepare(
            "INSERT INTO department (id,name,created_at) VALUES (?,?,unixepoch())"
          )
          .bind(otherScope, "單項角色部門")
          .run();
        const singleKey = randomUUID();
        const single = await admin.context.post(
          "/api/v2/roles/department-managers",
          {
            data: {
              action: "granted",
              operationKey: singleKey,
              scopeId: otherScope,
              targetUserId: admin.userId,
            },
          }
        );
        expect(single.status()).toBe(201);
        const reverseCollision = await admin.context.post(
          "/api/v2/roles/scoped-department-managers",
          {
            data: {
              changes: [{ action: "granted", scopeId: scopes[0] }],
              operationKey: singleKey,
              targetUserId: admin.userId,
            },
          }
        );
        expect(reverseCollision.status()).toBe(409);
      }
    );
    roleTest(
      "a current Admin can grant a Department Manager assignment to themselves and Home uses it",
      { tag: ["@browser", "@mobile-critical"] },
      async ({ admin, browser, caseApp, extraHTTPHeaders }) => {
        const departmentId = randomUUID();
        const programId = randomUUID();
        await caseApp.db
          .prepare(
            "insert into department (id,name,created_at) values (?,?,unixepoch())"
          )
          .bind(departmentId, "角色測試部門")
          .run();
        await caseApp.db
          .prepare(
            "insert into program (id,department_id,name,created_at) values (?,?,?,unixepoch())"
          )
          .bind(programId, departmentId, "角色測試聚會")
          .run();
        await caseApp.db
          .prepare(
            "insert into notice (id,title,body,scope_type,scope_id,published_at,expires_at,created_at) values (?,?,?,'program',?,unixepoch(),null,unixepoch())"
          )
          .bind(randomUUID(), "角色測試消息", "只有目前負責人可見。", programId)
          .run();

        const response = await admin.context.post(
          "/api/v2/roles/department-managers",
          {
            data: {
              action: "granted",
              operationKey: randomUUID(),
              scopeId: departmentId,
              targetUserId: admin.userId,
            },
          }
        );
        expect(response.status()).toBe(201);

        const pageContext = await browser.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
          storageState: await admin.context.storageState(),
        });
        try {
          const page = await pageContext.newPage();
          await page.goto("/");
          await expect(
            page
              .getByRole("region", { name: "教會消息" })
              .getByText("角色測試消息")
          ).toBeVisible();
        } finally {
          await pageContext.close();
        }

        const memberships = await caseApp.db
          .prepare(
            "select count(*) as count from department_membership where user_id = ?"
          )
          .bind(admin.userId)
          .first<{ count: number }>();
        const enrolments = await caseApp.db
          .prepare("select count(*) as count from enrolment where user_id = ?")
          .bind(admin.userId)
          .first<{ count: number }>();
        expect(memberships?.count).toBe(0);
        expect(enrolments?.count).toBe(0);
      }
    );

    roleTest(
      "a Member receives only their retained Department Manager events and withdrawal removes only that Home authority",
      {
        tag: [
          "@browser",
          "@mobile-critical",
          "@risk-history",
          "@risk-presentation",
        ],
      },
      async ({ admin, browser, caseApp, extraHTTPHeaders, playwright }) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
        const password = "Synthetic-recipient-password!";
        const username = `roles.member.${suffix}`;
        const targetUserId = await caseApp.provision.account({
          email: `${suffix}@example.com`,
          fullName: `陳收件人${suffix}`,
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

          const departmentId = randomUUID();
          const programId = randomUUID();
          const independentDepartmentId = randomUUID();
          await caseApp.db
            .prepare(
              "insert into department (id,name,created_at) values (?,?,unixepoch())"
            )
            .bind(departmentId, `角色收件部門${suffix}`)
            .run();
          await caseApp.db
            .prepare(
              "insert into department (id,name,created_at) values (?,?,unixepoch())"
            )
            .bind(independentDepartmentId, `獨立會籍部門${suffix}`)
            .run();
          await caseApp.db
            .prepare(
              "insert into program (id,department_id,name,created_at) values (?,?,?,unixepoch())"
            )
            .bind(programId, departmentId, `角色收件聚會${suffix}`)
            .run();
          await caseApp.db
            .prepare(
              "insert into notice (id,title,body,scope_type,scope_id,published_at,expires_at,created_at) values (?,?,?,'program',?,unixepoch(),null,unixepoch())"
            )
            .bind(
              randomUUID(),
              `角色負責消息${suffix}`,
              "只有目前負責人可見。",
              programId
            )
            .run();
          await caseApp.db
            .prepare(
              "insert into notice (id,title,body,scope_type,scope_id,published_at,expires_at,created_at) values (?,?,?,'department',?,unixepoch(),null,unixepoch())"
            )
            .bind(
              randomUUID(),
              `角色部門消息${suffix}`,
              "由目前部門負責人讀取。",
              departmentId
            )
            .run();
          await caseApp.db
            .prepare(
              "insert into notice (id,title,body,scope_type,scope_id,published_at,expires_at,created_at) values (?,?,?,'department',?,unixepoch(),null,unixepoch())"
            )
            .bind(
              randomUUID(),
              `獨立會籍消息${suffix}`,
              "獨立會籍權限不應改變。",
              independentDepartmentId
            )
            .run();
          await caseApp.db
            .prepare(
              "insert into department_membership (id,department_id,user_id,created_at) values (?,?,?,unixepoch())"
            )
            .bind(randomUUID(), independentDepartmentId, targetUserId)
            .run();

          const grantInput = {
            action: "granted" as const,
            operationKey: randomUUID(),
            scopeId: departmentId,
            targetUserId,
          };
          const grant = await admin.context.post(
            "/api/v2/roles/department-managers",
            { data: grantInput }
          );
          expect(grant.status()).toBe(201);
          const grantBody = (await grant.json()) as {
            data: {
              receipt: {
                action: string;
                createdAt: number;
                id: string;
                scopeId: string;
                scopeName: string;
                targetUserId: string;
              };
            };
          };
          const assignment = await caseApp.db
            .prepare(
              "select id from department_manager_assignment where user_id = ? and department_id = ?"
            )
            .bind(targetUserId, departmentId)
            .first<{ id: string }>();
          expect(assignment).not.toBeNull();

          const grantedHomeContext = await browser.newContext({
            baseURL: caseApp.origin,
            extraHTTPHeaders,
            storageState: await recipient.storageState(),
          });
          try {
            const page = await grantedHomeContext.newPage();
            await page.goto("/");
            await expect(
              page
                .getByRole("region", { name: "教會消息" })
                .getByText(`角色負責消息${suffix}`)
            ).toBeVisible();
            await expect(
              page
                .getByRole("region", { name: "教會消息" })
                .getByText(`角色部門消息${suffix}`)
            ).toBeVisible();
            await expect(
              page
                .getByRole("region", { name: "教會消息" })
                .getByText(`獨立會籍消息${suffix}`)
            ).toBeVisible();
          } finally {
            await grantedHomeContext.close();
          }

          const grantReplay = await admin.context.post(
            "/api/v2/roles/department-managers",
            { data: grantInput }
          );
          expect(grantReplay.status()).toBe(200);
          expect(await grantReplay.json()).toEqual(grantBody);

          const withdrawalInput = {
            action: "withdrawn" as const,
            expectedAssignmentId: requiredAssignmentId(assignment),
            operationKey: randomUUID(),
            scopeId: departmentId,
            targetUserId,
          };
          const withdrawal = await admin.context.post(
            "/api/v2/roles/department-managers",
            { data: withdrawalInput }
          );
          expect(withdrawal.status()).toBe(201);
          const withdrawnHomeContext = await browser.newContext({
            baseURL: caseApp.origin,
            extraHTTPHeaders,
            storageState: await recipient.storageState(),
          });
          try {
            const page = await withdrawnHomeContext.newPage();
            await page.goto("/");
            await expect(
              page
                .getByRole("region", { name: "教會消息" })
                .getByText(`角色負責消息${suffix}`)
            ).toHaveCount(0);
            await expect(
              page
                .getByRole("region", { name: "教會消息" })
                .getByText(`角色部門消息${suffix}`)
            ).toHaveCount(0);
            await expect(
              page
                .getByRole("region", { name: "教會消息" })
                .getByText(`獨立會籍消息${suffix}`)
            ).toBeVisible();
          } finally {
            await withdrawnHomeContext.close();
          }

          const inbox = await recipient.get("/api/v2/inbox");
          expect(inbox.status()).toBe(200);
          const inboxBody = (await inbox.json()) as {
            data: {
              roleChanges: {
                action: string;
                createdAt: number;
                role: string;
                scopeName: string;
              }[];
            };
          };
          expect(inboxBody.data.roleChanges).toHaveLength(2);
          for (const change of inboxBody.data.roleChanges) {
            expect(Object.keys(change).toSorted()).toEqual([
              "action",
              "createdAt",
              "role",
              "scopeName",
            ]);
          }
          expect(inboxBody.data.roleChanges).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                action: "granted",
                role: "department_manager",
                scopeName: `角色收件部門${suffix}`,
              }),
              expect.objectContaining({
                action: "withdrawn",
                role: "department_manager",
                scopeName: `角色收件部門${suffix}`,
              }),
            ])
          );
          expect(JSON.stringify(inboxBody)).not.toContain(targetUserId);
          expect(JSON.stringify(inboxBody)).not.toContain(
            grantInput.operationKey
          );
          expect(JSON.stringify(inboxBody)).not.toContain(
            grantBody.data.receipt.id
          );
          expect(JSON.stringify(inboxBody)).not.toContain(username);

          const inboxPageContext = await browser.newContext({
            baseURL: caseApp.origin,
            extraHTTPHeaders,
            storageState: await recipient.storageState(),
          });
          try {
            const page = await inboxPageContext.newPage();
            await page.goto("/inbox");
            const main = page.getByRole("main");
            await expect(
              main.getByRole("heading", { name: "職責變更紀錄" })
            ).toBeVisible();
            await expect(
              main.getByRole("heading", { name: "獲委任為部門負責人" })
            ).toBeVisible();
            await expect(
              main.getByRole("heading", { name: "部門負責人職責已撤回" })
            ).toBeVisible();
            await expect(
              main.getByText(`角色收件部門${suffix}`, { exact: true })
            ).toHaveCount(2);
          } finally {
            await inboxPageContext.close();
          }

          const durableEffects = await caseApp.db
            .prepare(
              "select (select count(*) from role_assignment_history where target_user_id = ?) as history, (select count(*) from audit_event where target_user_id = ? and action in ('department_manager_granted','department_manager_withdrawn')) as audits, (select count(*) from role_change_operation where actor_user_id = ? and operation_key in (?, ?)) as receipts"
            )
            .bind(
              targetUserId,
              targetUserId,
              admin.userId,
              grantInput.operationKey,
              withdrawalInput.operationKey
            )
            .first<{ audits: number; history: number; receipts: number }>();
          expect(durableEffects).toEqual({
            audits: 2,
            history: 2,
            receipts: 2,
          });
          expect(
            await caseApp.db
              .prepare(
                "select count(*) as count from department_membership where user_id = ?"
              )
              .bind(targetUserId)
              .first<{ count: number }>()
          ).toEqual({ count: 1 });
          expect(
            await caseApp.db
              .prepare(
                "select count(*) as count from department_membership where user_id = ? and department_id = ?"
              )
              .bind(targetUserId, departmentId)
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
        } finally {
          await recipient.dispose();
        }
      }
    );

    roleTest(
      "ordinary Department Manager grants do not require a usable permanent credential",
      {
        tag: [
          "@http",
          "@risk-authorization",
          "@risk-atomicity",
          "@risk-privacy",
        ],
      },
      async ({ admin, caseApp }) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
        const targetUserId = await caseApp.provision.account({
          email: `${suffix}@example.com`,
          fullName: `陳一般職責${suffix}`,
          membershipStatus: "active",
          password: "Synthetic-no-permanent-target-password!",
          role: "member",
          username: `np.${suffix}`,
        });
        await caseApp.db
          .prepare(
            "update account set password = '' where user_id = ? and provider_id = 'credential'"
          )
          .bind(targetUserId)
          .run();
        const departmentId = randomUUID();
        await caseApp.db
          .prepare(
            "insert into department (id,name,created_at) values (?,?,unixepoch())"
          )
          .bind(departmentId, `一般職責部門${suffix}`)
          .run();

        const response = await admin.context.post(
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
        const responseBody: unknown = await response.json();
        expect(response.status(), JSON.stringify(responseBody)).toBe(201);
        expect(
          await caseApp.db
            .prepare(
              "select count(*) as count from department_manager_assignment where user_id = ? and department_id = ?"
            )
            .bind(targetUserId, departmentId)
            .first<{ count: number }>()
        ).toEqual({ count: 1 });
      }
    );

    for (const targetRole of ["staff", "admin"] as const) {
      roleTest(
        `a current Admin may grant Department Manager to an active ${targetRole} target`,
        {
          tag: [
            "@http",
            "@risk-authorization",
            "@risk-atomicity",
            "@risk-privacy",
          ],
        },
        async ({ admin, caseApp }) => {
          const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
          const targetUserId = await caseApp.provision.account({
            email: `${suffix}@example.com`,
            fullName: `陳${targetRole}負責人${suffix}`,
            membershipStatus: "active",
            password: "Synthetic-protected-role-target!",
            role: targetRole,
            username: `rt.${targetRole}.${suffix}`,
          });
          const departmentId = randomUUID();
          await caseApp.db
            .prepare(
              "INSERT INTO department (id, name, created_at) VALUES (?, ?, unixepoch())"
            )
            .bind(departmentId, `${targetRole}負責部門${suffix}`)
            .run();
          const response = await admin.context.post(
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
          const body: unknown = await response.json();
          expect(response.status(), JSON.stringify(body)).toBe(201);
          expect(
            await caseApp.db
              .prepare(
                "SELECT COUNT(*) AS count FROM department_manager_assignment WHERE user_id = ? AND department_id = ?"
              )
              .bind(targetUserId, departmentId)
              .first()
          ).toEqual({ count: 1 });
        }
      );
    }

    for (const restrictedState of ["deactivated", "banned"] as const) {
      roleTest(
        `an existing ${restrictedState} assignee remains reachable for withdrawal`,
        {
          tag: [
            "@http",
            "@risk-authorization",
            "@risk-atomicity",
            "@risk-recovery",
          ],
        },
        async ({ admin, caseApp }) => {
          const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
          const targetUserId = await caseApp.provision.account({
            email: `${suffix}@example.com`,
            fullName: `陳受限負責人${suffix}`,
            membershipStatus: "active",
            password: "Synthetic-restricted-role-target!",
            role: "member",
            username: `rr.${suffix}`,
          });
          const departmentId = randomUUID();
          await caseApp.db
            .prepare(
              "INSERT INTO department (id, name, created_at) VALUES (?, ?, unixepoch())"
            )
            .bind(departmentId, `受限負責部門${suffix}`)
            .run();
          const grant = await admin.context.post(
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
          expect(grant.status()).toBe(201);
          const assignment = await caseApp.db
            .prepare(
              "SELECT id FROM department_manager_assignment WHERE user_id = ? AND department_id = ?"
            )
            .bind(targetUserId, departmentId)
            .first<{ id: string }>();
          expect(assignment).not.toBeNull();
          const restrictionUpdate =
            restrictedState === "deactivated"
              ? "UPDATE person_profile SET membership_status = 'deactivated' WHERE user_id = ?"
              : "UPDATE person_profile SET banned_at = unixepoch() WHERE user_id = ?";
          await caseApp.db.prepare(restrictionUpdate).bind(targetUserId).run();

          const detail = await admin.context.get(
            `/api/v2/roles/department-managers/${encodeURIComponent(targetUserId)}`
          );
          expect(detail.status()).toBe(200);
          const detailBody = (await detail.json()) as {
            data: {
              person: {
                assignments: { assignmentId: string; scopeId: string }[];
                eligibleForGrant: boolean;
              };
            };
          };
          expect(detailBody.data.person.eligibleForGrant).toBe(false);
          expect(detailBody.data.person.assignments).toEqual([
            expect.objectContaining({
              assignmentId: requiredAssignmentId(assignment),
              scopeId: departmentId,
            }),
          ]);
          const withdrawal = await admin.context.post(
            "/api/v2/roles/department-managers",
            {
              data: {
                action: "withdrawn",
                expectedAssignmentId: requiredAssignmentId(assignment),
                operationKey: randomUUID(),
                scopeId: departmentId,
                targetUserId,
              },
            }
          );
          expect(withdrawal.status()).toBe(201);
          expect(
            await caseApp.db
              .prepare(
                "SELECT COUNT(*) AS count FROM department_manager_assignment WHERE user_id = ? AND department_id = ?"
              )
              .bind(targetUserId, departmentId)
              .first()
          ).toEqual({ count: 0 });
          expect(
            await caseApp.db
              .prepare(
                "SELECT action FROM role_assignment_history WHERE target_user_id = ? ORDER BY rowid"
              )
              .bind(targetUserId)
              .all<{ action: string }>()
          ).toMatchObject({
            results: [{ action: "granted" }, { action: "withdrawn" }],
          });
        }
      );
    }

    roleTest(
      "withdrawn Department Manager history blocks later account deletion",
      { tag: ["@http", "@risk-history", "@risk-deletion", "@risk-atomicity"] },
      async ({ admin, caseApp }) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
        const targetUserId = await caseApp.provision.account({
          email: `${suffix}@example.com`,
          fullName: `陳保留歷史${suffix}`,
          membershipStatus: "active",
          password: "Synthetic-role-history-password!",
          role: "member",
          username: `rh.${suffix}`,
        });
        const departmentId = randomUUID();
        await caseApp.db
          .prepare(
            "insert into department (id,name,created_at) values (?,?,unixepoch())"
          )
          .bind(departmentId, `保留歷史部門${suffix}`)
          .run();
        const grant = await admin.context.post(
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
        expect(grant.status()).toBe(201);
        const assignment = await caseApp.db
          .prepare(
            "select id from department_manager_assignment where user_id = ? and department_id = ?"
          )
          .bind(targetUserId, departmentId)
          .first<{ id: string }>();
        expect(assignment).not.toBeNull();
        const withdrawal = await admin.context.post(
          "/api/v2/roles/department-managers",
          {
            data: {
              action: "withdrawn",
              expectedAssignmentId: requiredAssignmentId(assignment),
              operationKey: randomUUID(),
              scopeId: departmentId,
              targetUserId,
            },
          }
        );
        expect(withdrawal.status()).toBe(201);

        const deletion = await admin.context.post(
          "/api/v2/staff/accounts/delete",
          { data: { operationKey: randomUUID(), targetUserId } }
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
            .prepare("select id from user where id = ?")
            .bind(targetUserId)
            .first<{ id: string }>()
        ).toEqual({ id: targetUserId });
        expect(
          await caseApp.db
            .prepare(
              "select action from role_assignment_history where target_user_id = ? order by action"
            )
            .bind(targetUserId)
            .all<{ action: string }>()
        ).toMatchObject({
          results: [{ action: "granted" }, { action: "withdrawn" }],
        });
        expect(
          await caseApp.db
            .prepare(
              "select id from audit_event where target_user_id = ? and action = 'account_deleted'"
            )
            .bind(targetUserId)
            .all<{ id: string }>()
        ).toMatchObject({ results: [] });
      }
    );

    roleTest(
      "a required Audit write failure rolls back the grant, history, receipt, and Inbox event before same-key retry",
      { tag: ["@http", "@risk-atomicity", "@risk-recovery", "@risk-privacy"] },
      async ({ admin, caseApp, extraHTTPHeaders, playwright }) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
        const password = "Synthetic-role-rollback-password!";
        const username = `rb.${suffix}`;
        const targetUserId = await caseApp.provision.account({
          email: `${suffix}@example.com`,
          fullName: `陳原子目標${suffix}`,
          membershipStatus: "active",
          password,
          role: "member",
          username,
        });
        const recipient = await playwright.request.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        const departmentId = randomUUID();
        const operationKey = randomUUID();
        const input = {
          action: "granted" as const,
          operationKey,
          scopeId: departmentId,
          targetUserId,
        };
        const trigger = `synthetic_role_audit_failure_${randomUUID().replaceAll("-", "")}`;
        await caseApp.db
          .prepare(
            "INSERT INTO department (id, name, created_at) VALUES (?, ?, unixepoch())"
          )
          .bind(departmentId, `原子性部門${suffix}`)
          .run();
        try {
          const login = await recipient.post("/api/auth/sign-in/username", {
            data: { password, username },
          });
          expect(login.status()).toBe(200);
          await caseApp.db
            .prepare(
              `CREATE TRIGGER ${trigger} BEFORE INSERT ON audit_event
                WHEN NEW.target_user_id = '${targetUserId}'
                  AND NEW.action = 'department_manager_granted'
                BEGIN SELECT RAISE(ABORT, 'Synthetic role audit failure'); END`
            )
            .run();
          try {
            const failed = await admin.context.post(
              "/api/v2/roles/department-managers",
              { data: input }
            );
            const failureBody = (await failed.json()) as {
              error?: { code?: string };
            };
            expect(failed.status(), JSON.stringify(failureBody)).toBe(500);
            expect(failureBody.error?.code).toBe("internal_error");
            expect(
              await caseApp.db
                .prepare(
                  `SELECT
                    (SELECT COUNT(*) FROM department_manager_assignment WHERE user_id = ?) AS assignments,
                    (SELECT COUNT(*) FROM role_assignment_history WHERE target_user_id = ?) AS history,
                    (SELECT COUNT(*) FROM audit_event WHERE target_user_id = ? AND action = 'department_manager_granted') AS audits,
                    (SELECT COUNT(*) FROM role_change_operation WHERE actor_user_id = ? AND operation_key = ?) AS receipts`
                )
                .bind(
                  targetUserId,
                  targetUserId,
                  targetUserId,
                  admin.userId,
                  operationKey
                )
                .first()
            ).toEqual({ assignments: 0, audits: 0, history: 0, receipts: 0 });
            const emptyInbox = await recipient.get("/api/v2/inbox");
            expect(emptyInbox.status()).toBe(200);
            const emptyInboxBody = await emptyInbox.json();
            expect(emptyInboxBody.data.roleChanges).toEqual([]);
            const unknown = await admin.context.post(
              "/api/v2/roles/department-managers/reconcile",
              { data: { operationKey } }
            );
            expect(unknown.status()).toBe(200);
            expect(await unknown.json()).toMatchObject({
              data: { outcome: "unknown", receipt: null },
            });
          } finally {
            await caseApp.db.prepare(`DROP TRIGGER ${trigger}`).run();
          }

          const retry = await admin.context.post(
            "/api/v2/roles/department-managers",
            { data: input }
          );
          expect(retry.status()).toBe(201);
          const retryBody = (await retry.json()) as {
            data: { receipt: { action: string; createdAt: number } };
          };
          expect(retryBody.data.receipt.action).toBe("granted");
          const effects = await caseApp.db
            .prepare(
              `SELECT
                (SELECT COUNT(*) FROM department_manager_assignment WHERE user_id = ?) AS assignments,
                (SELECT COUNT(*) FROM role_assignment_history WHERE target_user_id = ?) AS history,
                (SELECT COUNT(*) FROM audit_event WHERE target_user_id = ? AND action = 'department_manager_granted') AS audits,
                (SELECT COUNT(*) FROM role_change_operation WHERE actor_user_id = ? AND operation_key = ?) AS receipts`
            )
            .bind(
              targetUserId,
              targetUserId,
              targetUserId,
              admin.userId,
              operationKey
            )
            .first();
          expect(effects).toEqual({
            assignments: 1,
            audits: 1,
            history: 1,
            receipts: 1,
          });
          const retainedInbox = await recipient.get("/api/v2/inbox");
          expect(retainedInbox.status()).toBe(200);
          const inboxBody = (await retainedInbox.json()) as {
            data: {
              roleChanges: {
                action: string;
                createdAt: number;
                role: string;
                scopeName: string;
              }[];
            };
          };
          expect(inboxBody.data.roleChanges).toEqual([
            {
              action: "granted",
              createdAt: retryBody.data.receipt.createdAt,
              role: "department_manager",
              scopeName: `原子性部門${suffix}`,
            },
          ]);
        } finally {
          await recipient.dispose();
        }
      }
    );

    roleTest(
      "a stale withdrawal cannot remove a later replacement assignment",
      {
        tag: [
          "@http",
          "@risk-atomicity",
          "@risk-concurrency",
          "@risk-non-replay",
        ],
      },
      async ({ admin, caseApp }) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
        const targetUserId = await caseApp.provision.account({
          email: `${suffix}@example.com`,
          fullName: `陳替換負責人${suffix}`,
          membershipStatus: "active",
          password: "Synthetic-replaced-role-password!",
          role: "member",
          username: `roles.replace.${suffix}`,
        });
        const departmentId = randomUUID();
        await caseApp.db
          .prepare(
            "INSERT INTO department (id, name, created_at) VALUES (?, ?, unixepoch())"
          )
          .bind(departmentId, `替換部門${suffix}`)
          .run();
        const grant = async (operationKey: string) => {
          const response = await admin.context.post(
            "/api/v2/roles/department-managers",
            {
              data: {
                action: "granted",
                operationKey,
                scopeId: departmentId,
                targetUserId,
              },
            }
          );
          expect(response.status()).toBe(201);
        };
        await grant(randomUUID());
        const original = await caseApp.db
          .prepare(
            "SELECT id FROM department_manager_assignment WHERE user_id = ? AND department_id = ?"
          )
          .bind(targetUserId, departmentId)
          .first<{ id: string }>();
        expect(original).not.toBeNull();
        const withdrawal = await admin.context.post(
          "/api/v2/roles/department-managers",
          {
            data: {
              action: "withdrawn",
              expectedAssignmentId: requiredAssignmentId(original),
              operationKey: randomUUID(),
              scopeId: departmentId,
              targetUserId,
            },
          }
        );
        expect(withdrawal.status()).toBe(201);
        await grant(randomUUID());
        const replacement = await caseApp.db
          .prepare(
            "SELECT id FROM department_manager_assignment WHERE user_id = ? AND department_id = ?"
          )
          .bind(targetUserId, departmentId)
          .first<{ id: string }>();
        expect(replacement).not.toBeNull();
        const originalAssignmentId = requiredAssignmentId(original);
        const replacementAssignmentId = requiredAssignmentId(replacement);
        expect(replacementAssignmentId).not.toBe(originalAssignmentId);

        const stale = await admin.context.post(
          "/api/v2/roles/department-managers",
          {
            data: {
              action: "withdrawn",
              expectedAssignmentId: originalAssignmentId,
              operationKey: randomUUID(),
              scopeId: departmentId,
              targetUserId,
            },
          }
        );
        expect(stale.status()).toBe(409);
        expect(await stale.json()).toMatchObject({
          error: { code: "conflict" },
        });
        expect(
          await caseApp.db
            .prepare(
              "SELECT id FROM department_manager_assignment WHERE user_id = ? AND department_id = ?"
            )
            .bind(targetUserId, departmentId)
            .first()
        ).toEqual(replacement);
        expect(
          await caseApp.db
            .prepare(
              "SELECT action FROM role_assignment_history WHERE target_user_id = ? ORDER BY rowid"
            )
            .bind(targetUserId)
            .all<{ action: string }>()
        ).toMatchObject({
          results: [
            { action: "granted" },
            { action: "withdrawn" },
            { action: "granted" },
          ],
        });
      }
    );
  }
);
