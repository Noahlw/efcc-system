import { randomUUID } from "node:crypto";

import type { APIRequestContext, APIResponse } from "@playwright/test";

import type { NativeApp } from "../../support/fixtures";
import { dedicatedTest, expect } from "../../support/fixtures";
import type { ProvisionAccount } from "../../worker/provision";

interface AdminActor {
  account: ProvisionAccount;
  context: APIRequestContext;
  userId: string;
}

interface EffectSnapshot {
  assignments: number;
  audits: number;
  history: number;
  receipts: number;
}

interface TestAccount {
  account: ProvisionAccount;
  userId: string;
}

const password = "Synthetic-native-password!";

const nativeAccount = (
  prefix: string,
  role: "admin" | "member" | "staff" = "member"
): ProvisionAccount => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
  return {
    email: `${prefix}.${suffix}@example.com`,
    fullName: `陳授權測試${suffix}`,
    membershipStatus: "active",
    password,
    role,
    username: `roles.${prefix}.${suffix}`,
  };
};

const provisionAccount = async (
  app: NativeApp,
  prefix: string,
  role: "admin" | "member" | "staff" = "member"
): Promise<TestAccount> => {
  const account = nativeAccount(prefix, role);
  return { account, userId: await app.provision.account(account) };
};

const roleAuthorityTest = dedicatedTest.extend<{
  admin: AdminActor;
}>({
  admin: async ({ caseApp, extraHTTPHeaders, playwright }, use) => {
    const account = nativeAccount("admin", "admin");
    const userId = await caseApp.provision.account(account);
    const context = await playwright.request.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders,
    });
    try {
      const login = await context.post("/api/auth/sign-in/username", {
        data: { password: account.password, username: account.username },
      });
      expect(login.status()).toBe(200);
      const confirmation = await context.post(
        "/api/v2/account/password-confirmation",
        { data: { operationKey: randomUUID(), password: account.password } }
      );
      expect(confirmation.status()).toBe(201);
      await use({ account, context, userId });
    } finally {
      await context.dispose();
    }
  },
});

const createDepartment = async (app: NativeApp, name: string) => {
  const id = randomUUID();
  const result = await app.db
    .prepare(
      "insert into department (id, name, created_at) values (?, ?, unixepoch())"
    )
    .bind(id, name)
    .run();
  expect(result.meta.changes).toBe(1);
  return id;
};

const grantDepartmentManager = (
  context: APIRequestContext,
  targetUserId: string,
  scopeId: string,
  operationKey = randomUUID()
) =>
  context.post("/api/v2/roles/department-managers", {
    data: {
      action: "granted",
      operationKey,
      scopeId,
      targetUserId,
    },
  });

const roleEffects = async (
  app: NativeApp,
  targetUserId: string,
  operationKeys: readonly string[]
): Promise<EffectSnapshot> => {
  const placeholders = operationKeys.map(() => "?").join(", ");
  const result = await app.db
    .prepare(
      `select ` +
        `(select count(*) from department_manager_assignment where user_id = ?) as assignments, ` +
        `(select count(*) from role_assignment_history where target_user_id = ?) as history, ` +
        `(select count(*) from audit_event where target_user_id = ? and action in ('department_manager_granted', 'department_manager_withdrawn')) as audits, ` +
        `(select count(*) from role_change_operation where operation_key in (${
          placeholders
        })) as receipts`
    )
    .bind(targetUserId, targetUserId, targetUserId, ...operationKeys)
    .first<EffectSnapshot>();
  if (!result) {
    throw new Error("Expected a Department Manager effect snapshot");
  }
  return result;
};

const expectDeniedWithoutDetails = async (
  response: APIResponse,
  forbiddenValues: readonly string[]
) => {
  expect(response.status()).toBe(403);
  const body: unknown = await response.json();
  expect(body).toMatchObject({ error: { code: "business_access_denied" } });
  const serialized = JSON.stringify(body);
  for (const value of forbiddenValues) {
    expect(serialized).not.toContain(value);
  }
};

const expectOrdinaryActorDenied = async (
  context: APIRequestContext,
  operationKey: string,
  target: TestAccount,
  scopeId: string,
  scopeName: string
) => {
  const identityValues = [
    target.userId,
    target.account.email,
    target.account.fullName,
  ];

  // The selected-person request is direct: it does not rely on a prior
  // successful or cached candidate-list response.
  await expectDeniedWithoutDetails(
    await context.get(
      `/api/v2/roles/department-managers/${encodeURIComponent(
        target.userId
      )}?assignmentPage=1`
    ),
    identityValues
  );
  await expectDeniedWithoutDetails(
    await context.get(
      `/api/v2/roles/department-managers?q=${encodeURIComponent(
        target.account.fullName
      )}&page=1`
    ),
    identityValues
  );
  await expectDeniedWithoutDetails(
    await context.get("/api/v2/roles/department-managers/departments?page=1"),
    [target.userId, target.account.email, scopeName]
  );
  await expectDeniedWithoutDetails(
    await context.post("/api/v2/roles/department-managers", {
      data: {
        action: "granted",
        operationKey,
        scopeId,
        targetUserId: target.userId,
      },
    }),
    [
      operationKey,
      target.userId,
      target.account.email,
      target.account.fullName,
      scopeName,
    ]
  );
  await expectDeniedWithoutDetails(
    await context.post("/api/v2/roles/department-managers/reconcile", {
      data: { operationKey },
    }),
    [
      operationKey,
      target.userId,
      target.account.email,
      target.account.fullName,
      scopeName,
    ]
  );
};

roleAuthorityTest.describe(
  "Department Manager public authorization and privacy",
  { tag: ["@native", "@risk-authorization", "@risk-privacy"] },
  () => {
    roleAuthorityTest(
      "a Role Assigner reads and withdraws a restricted member's Program without exposing protected targets",
      { tag: ["@http", "@risk-atomicity"] },
      async ({ admin, caseApp, extraHTTPHeaders, playwright }) => {
        const actor = await provisionAccount(caseApp, "mixedra", "staff");
        const target = await provisionAccount(caseApp, "mixedrestricted");
        const authorityId = randomUUID();
        const assignmentId = randomUUID();
        const departmentId = await createDepartment(caseApp, "受限聚會部門");
        const programId = randomUUID();
        await caseApp.db.batch([
          caseApp.db
            .prepare(
              "INSERT INTO role_assigner_assignment (id,user_id,created_at) VALUES (?,?,unixepoch())"
            )
            .bind(authorityId, actor.userId),
          caseApp.db
            .prepare(
              "INSERT INTO program (id,department_id,name,created_at) VALUES (?,?,?,unixepoch())"
            )
            .bind(programId, departmentId, "受限聚會"),
          caseApp.db
            .prepare(
              "INSERT INTO program_leader_assignment (id,user_id,program_id,created_at) VALUES (?,?,?,unixepoch())"
            )
            .bind(assignmentId, target.userId, programId),
          caseApp.db
            .prepare(
              "UPDATE person_profile SET membership_status = 'deactivated' WHERE user_id = ?"
            )
            .bind(target.userId),
        ]);
        const context = await playwright.request.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const login = await context.post("/api/auth/sign-in/username", {
            data: { password, username: actor.account.username },
          });
          expect(login.status()).toBe(200);
          const confirmation = await context.post(
            "/api/v2/account/password-confirmation",
            { data: { operationKey: randomUUID(), password } }
          );
          expect(confirmation.status()).toBe(201);
          const path = `/api/v2/roles/scoped-department-managers/${target.userId}/programs?departmentId=${departmentId}&programId=${programId}&page=1`;
          const baseline = await context.get(path);
          expect(baseline.status()).toBe(200);
          const baselineBody = await baseline.json();
          expect(baselineBody.data).toMatchObject({
            authorityAssignmentId: authorityId,
            departmentId,
            departmentName: "受限聚會部門",
            eligibleForGrant: false,
            programs: [{ assignmentId, scopeId: programId }],
          });
          const protectedRead = await context.get(
            `/api/v2/roles/scoped-department-managers/${admin.userId}/programs?departmentId=${departmentId}&page=1`
          );
          expect([403, 404]).toContain(protectedRead.status());
          expect(await protectedRead.text()).not.toContain("受限聚會");
          const save = await context.post(
            "/api/v2/roles/scoped-department-managers",
            {
              data: {
                authorityAssignmentId: authorityId,
                changes: [
                  {
                    action: "withdrawn",
                    expectedAssignmentId: assignmentId,
                    expectedDepartmentId: departmentId,
                    role: "program_leader",
                    scopeId: programId,
                  },
                ],
                operationKey: randomUUID(),
                targetUserId: target.userId,
              },
            }
          );
          expect(save.status()).toBe(201);
          expect(
            await caseApp.db
              .prepare(
                "SELECT count(*) AS count FROM program_leader_assignment WHERE id = ?"
              )
              .bind(assignmentId)
              .first()
          ).toEqual({ count: 0 });
        } finally {
          await context.dispose();
        }
      }
    );
    roleAuthorityTest(
      "a former Role Assigner cannot reconcile a committed person-scoped operation",
      { tag: ["@http", "@risk-recovery"] },
      async ({ admin, caseApp, extraHTTPHeaders, playwright }) => {
        const manager = await provisionAccount(caseApp, "batchra", "staff");
        const target = await provisionAccount(caseApp, "batchtarget");
        const scopeId = await createDepartment(caseApp, "委派收據部門");
        const grant = await admin.context.post("/api/v2/roles/role-assigners", {
          data: {
            action: "granted",
            operationKey: randomUUID(),
            targetUserId: manager.userId,
          },
        });
        expect(grant.status()).toBe(201);
        const authority = await caseApp.db
          .prepare("SELECT id FROM role_assigner_assignment WHERE user_id = ?")
          .bind(manager.userId)
          .first<{ id: string }>();
        if (!authority) {
          throw new Error("Expected delegation");
        }
        const context = await playwright.request.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const login = await context.post("/api/auth/sign-in/username", {
            data: {
              password: manager.account.password,
              username: manager.account.username,
            },
          });
          expect(login.status()).toBe(200);
          const confirmation = await context.post(
            "/api/v2/account/password-confirmation",
            {
              data: {
                operationKey: randomUUID(),
                password: manager.account.password,
              },
            }
          );
          expect(confirmation.status()).toBe(201);
          const operationKey = randomUUID();
          const command = {
            authorityAssignmentId: authority.id,
            changes: [
              { action: "granted", role: "department_manager", scopeId },
            ],
            operationKey,
            targetUserId: target.userId,
          };
          const batchGrant = await context.post(
            "/api/v2/roles/scoped-department-managers",
            {
              data: command,
            }
          );
          expect(batchGrant.status()).toBe(201);
          const revoke = await admin.context.post(
            "/api/v2/roles/role-assigners",
            {
              data: {
                action: "withdrawn",
                expectedAssignmentId: authority.id,
                operationKey: randomUUID(),
                targetUserId: manager.userId,
              },
            }
          );
          expect(revoke.status()).toBe(201);
          await expectDeniedWithoutDetails(
            await context.post(
              "/api/v2/roles/scoped-department-managers/reconcile",
              { data: { operationKey } }
            ),
            [target.userId, target.account.fullName, scopeId]
          );
          await expectDeniedWithoutDetails(
            await context.post("/api/v2/roles/scoped-department-managers", {
              data: command,
            }),
            [target.userId, target.account.fullName, scopeId]
          );
        } finally {
          await context.dispose();
        }
      }
    );
    roleAuthorityTest(
      "ordinary Member and Staff cannot read or change public Department Manager operations",
      { tag: ["@http"] },
      async ({ caseApp, signedInRequest, staff }) => {
        const target = await provisionAccount(caseApp, "target");
        const scopeName = `授權保護部門${target.userId.slice(0, 8)}`;
        const scopeId = await createDepartment(caseApp, scopeName);
        const memberKey = randomUUID();
        const staffKey = randomUUID();
        const before = await roleEffects(caseApp, target.userId, [
          memberKey,
          staffKey,
        ]);

        await expectOrdinaryActorDenied(
          signedInRequest,
          memberKey,
          target,
          scopeId,
          scopeName
        );
        await expectOrdinaryActorDenied(
          staff.context,
          staffKey,
          target,
          scopeId,
          scopeName
        );

        expect(
          await roleEffects(caseApp, target.userId, [memberKey, staffKey])
        ).toEqual(before);
      }
    );

    roleAuthorityTest(
      "person-scoped Role Assigner changes preserve restricted withdrawal and reject protected grants",
      { tag: ["@http", "@risk-atomicity"] },
      async ({ admin, caseApp, extraHTTPHeaders, playwright }) => {
        const roleAssigner = await provisionAccount(
          caseApp,
          "batchra",
          "staff"
        );
        const staffTarget = await provisionAccount(
          caseApp,
          "batchstaff",
          "staff"
        );
        const target = await provisionAccount(caseApp, "batchtarget");
        const scopeId = await createDepartment(caseApp, "批次授權部門");
        const delegation = await admin.context.post(
          "/api/v2/roles/role-assigners",
          {
            data: {
              action: "granted",
              operationKey: randomUUID(),
              targetUserId: roleAssigner.userId,
            },
          }
        );
        expect(delegation.status()).toBe(201);
        const authority = await caseApp.db
          .prepare("SELECT id FROM role_assigner_assignment WHERE user_id = ?")
          .bind(roleAssigner.userId)
          .first<{ id: string }>();
        if (!authority) {
          throw new Error("Admin grant returned no current Role Assigner row");
        }
        const grant = await grantDepartmentManager(
          admin.context,
          target.userId,
          scopeId
        );
        expect(grant.status()).toBe(201);
        const assignment = await caseApp.db
          .prepare(
            "SELECT id FROM department_manager_assignment WHERE user_id = ? AND department_id = ?"
          )
          .bind(target.userId, scopeId)
          .first<{ id: string }>();
        if (!assignment) {
          throw new Error("Admin grant returned no Department Manager row");
        }
        await caseApp.db
          .prepare(
            "UPDATE person_profile SET membership_status = 'deactivated' WHERE user_id = ?"
          )
          .bind(target.userId)
          .run();
        const roleAssignerContext = await playwright.request.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const login = await roleAssignerContext.post(
            "/api/auth/sign-in/username",
            {
              data: {
                password: roleAssigner.account.password,
                username: roleAssigner.account.username,
              },
            }
          );
          expect(login.status()).toBe(200);
          const confirmation = await roleAssignerContext.post(
            "/api/v2/account/password-confirmation",
            {
              data: {
                operationKey: randomUUID(),
                password: roleAssigner.account.password,
              },
            }
          );
          expect(confirmation.status()).toBe(201);
          const otherScopeId = await createDepartment(
            caseApp,
            "不可新增測試部門"
          );
          const rejectedKey = randomUUID();
          const rejectedBatch = await roleAssignerContext.post(
            "/api/v2/roles/scoped-department-managers",
            {
              data: {
                authorityAssignmentId: authority.id,
                changes: [
                  {
                    action: "withdrawn",
                    expectedAssignmentId: assignment.id,
                    role: "department_manager",
                    scopeId,
                  },
                  {
                    action: "granted",
                    role: "department_manager",
                    scopeId: otherScopeId,
                  },
                ],
                operationKey: rejectedKey,
                targetUserId: target.userId,
              },
            }
          );
          expect(rejectedBatch.status()).toBe(409);
          const rejectedEffects = await roleEffects(caseApp, target.userId, [
            rejectedKey,
          ]);
          expect(rejectedEffects).toEqual({
            assignments: 1,
            audits: 1,
            history: 1,
            receipts: 0,
          });
          const protectedKey = randomUUID();
          const protectedBatch = await roleAssignerContext.post(
            "/api/v2/roles/scoped-department-managers",
            {
              data: {
                authorityAssignmentId: authority.id,
                changes: [
                  { action: "granted", role: "department_manager", scopeId },
                ],
                operationKey: protectedKey,
                targetUserId: staffTarget.userId,
              },
            }
          );
          expect(protectedBatch.status()).toBe(409);
          expect(
            await roleEffects(caseApp, staffTarget.userId, [protectedKey])
          ).toEqual({ assignments: 0, audits: 0, history: 0, receipts: 0 });
          const restricted = await provisionAccount(caseApp, "batchrestricted");
          const restrictedGrantOne = await grantDepartmentManager(
            admin.context,
            restricted.userId,
            scopeId
          );
          expect(restrictedGrantOne.status()).toBe(201);
          const restrictedGrantTwo = await grantDepartmentManager(
            admin.context,
            restricted.userId,
            otherScopeId
          );
          expect(restrictedGrantTwo.status()).toBe(201);
          const witnesses = await caseApp.db
            .prepare(
              "SELECT id,department_id FROM department_manager_assignment WHERE user_id = ?"
            )
            .bind(restricted.userId)
            .all<{ id: string; department_id: string }>();
          expect(witnesses.results).toHaveLength(2);
          await caseApp.db
            .prepare(
              "UPDATE person_profile SET membership_status = 'deactivated' WHERE user_id = ?"
            )
            .bind(restricted.userId)
            .run();
          const restrictedKey = randomUUID();
          const restrictedWithdrawal = await roleAssignerContext.post(
            "/api/v2/roles/scoped-department-managers",
            {
              data: {
                authorityAssignmentId: authority.id,
                changes: witnesses.results.map((row) => ({
                  action: "withdrawn",
                  expectedAssignmentId: row.id,
                  role: "department_manager",
                  scopeId: row.department_id,
                })),
                operationKey: restrictedKey,
                targetUserId: restricted.userId,
              },
            }
          );
          expect(restrictedWithdrawal.status()).toBe(201);
          expect(
            await roleEffects(caseApp, restricted.userId, [restrictedKey])
          ).toEqual({ assignments: 0, audits: 4, history: 4, receipts: 1 });
        } finally {
          await roleAssignerContext.dispose();
        }
      }
    );

    roleAuthorityTest(
      "a Role Assigner can withdraw a restricted Member assignment but cannot grant protected targets or delegate further",
      { tag: ["@http"] },
      async ({ admin, caseApp, extraHTTPHeaders, playwright }) => {
        const roleAssigner = await provisionAccount(caseApp, "ra", "staff");
        const staffTarget = await provisionAccount(caseApp, "ps", "staff");
        const scopeName = `委派員跨部門${roleAssigner.userId.slice(0, 8)}`;
        const scopeId = await createDepartment(caseApp, scopeName);

        const delegation = await admin.context.post(
          "/api/v2/roles/role-assigners",
          {
            data: {
              action: "granted",
              operationKey: randomUUID(),
              targetUserId: roleAssigner.userId,
            },
          }
        );
        expect(delegation.status()).toBe(201);
        const authority = await caseApp.db
          .prepare("SELECT id FROM role_assigner_assignment WHERE user_id = ?")
          .bind(roleAssigner.userId)
          .first<{ id: string }>();
        expect(authority).not.toBeNull();
        if (!authority) {
          throw new Error("Admin grant returned no current Role Assigner row");
        }

        const target = await provisionAccount(caseApp, "rm");
        const adminGrantKey = randomUUID();
        const adminGrant = await grantDepartmentManager(
          admin.context,
          target.userId,
          scopeId,
          adminGrantKey
        );
        expect(adminGrant.status()).toBe(201);
        const assignment = await caseApp.db
          .prepare(
            "SELECT id FROM department_manager_assignment WHERE user_id = ? AND department_id = ?"
          )
          .bind(target.userId, scopeId)
          .first<{ id: string }>();
        expect(assignment).not.toBeNull();
        if (!assignment) {
          throw new Error("Admin grant returned no Department Manager row");
        }
        await caseApp.db
          .prepare(
            "UPDATE person_profile SET membership_status = 'deactivated' WHERE user_id = ?"
          )
          .bind(target.userId)
          .run();

        const roleAssignerContext = await playwright.request.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const login = await roleAssignerContext.post(
            "/api/auth/sign-in/username",
            {
              data: {
                password: roleAssigner.account.password,
                username: roleAssigner.account.username,
              },
            }
          );
          expect(login.status()).toBe(200);
          const confirmation = await roleAssignerContext.post(
            "/api/v2/account/password-confirmation",
            {
              data: {
                operationKey: randomUUID(),
                password: roleAssigner.account.password,
              },
            }
          );
          expect(confirmation.status()).toBe(201);

          const withdrawalKey = randomUUID();
          const withdrawal = await roleAssignerContext.post(
            "/api/v2/roles/department-managers",
            {
              data: {
                action: "withdrawn",
                authorityAssignmentId: authority.id,
                expectedAssignmentId: assignment.id,
                operationKey: withdrawalKey,
                scopeId,
                targetUserId: target.userId,
              },
            }
          );
          expect(withdrawal.status()).toBe(201);
          expect(await withdrawal.json()).toMatchObject({
            data: {
              receipt: {
                action: "withdrawn",
                scopeId,
                scopeName,
                targetUserId: target.userId,
              },
            },
          });
          expect(
            await caseApp.db
              .prepare(
                "SELECT COUNT(*) AS count FROM department_membership WHERE user_id IN (?, ?)"
              )
              .bind(roleAssigner.userId, target.userId)
              .first()
          ).toEqual({ count: 0 });
          expect(
            await caseApp.db
              .prepare(
                "SELECT COUNT(*) AS count FROM department_manager_assignment WHERE user_id = ? AND department_id = ?"
              )
              .bind(target.userId, scopeId)
              .first()
          ).toEqual({ count: 0 });

          const deniedRequests = await Promise.all(
            [roleAssigner.userId, staffTarget.userId, admin.userId].map(
              async (targetUserId) => {
                const operationKey = randomUUID();
                const denied = await roleAssignerContext.post(
                  "/api/v2/roles/department-managers",
                  {
                    data: {
                      action: "granted",
                      authorityAssignmentId: authority.id,
                      operationKey,
                      scopeId,
                      targetUserId,
                    },
                  }
                );
                const body: unknown = await denied.json();
                return { body, operationKey, status: denied.status() };
              }
            )
          );
          for (const { body, status } of deniedRequests) {
            expect(status).toBe(409);
            expect(body).toMatchObject({ error: { code: "conflict" } });
            const serialized = JSON.stringify(body);
            for (const identity of [
              roleAssigner.userId,
              staffTarget.userId,
              admin.userId,
            ]) {
              expect(serialized).not.toContain(identity);
            }
          }

          const furtherDelegationKey = randomUUID();
          const furtherDelegation = await roleAssignerContext.post(
            "/api/v2/roles/role-assigners",
            {
              data: {
                action: "granted",
                operationKey: furtherDelegationKey,
                targetUserId: staffTarget.userId,
              },
            }
          );
          expect(furtherDelegation.status()).toBe(403);
          expect(await furtherDelegation.json()).toMatchObject({
            error: { code: "business_access_denied" },
          });

          expect(
            await caseApp.db
              .prepare(
                `SELECT COUNT(*) AS count FROM role_change_operation
                 WHERE actor_user_id = ? AND operation_key IN (${[
                   ...deniedRequests.map(({ operationKey }) => operationKey),
                   furtherDelegationKey,
                 ]
                   .map(() => "?")
                   .join(", ")})`
              )
              .bind(
                roleAssigner.userId,
                ...deniedRequests.map(({ operationKey }) => operationKey),
                furtherDelegationKey
              )
              .first()
          ).toEqual({ count: 0 });
          expect(
            await caseApp.db
              .prepare(
                "SELECT COUNT(*) AS count FROM role_assigner_assignment WHERE user_id = ?"
              )
              .bind(staffTarget.userId)
              .first()
          ).toEqual({ count: 0 });
          expect(
            await caseApp.db
              .prepare(
                "SELECT action FROM role_assignment_history WHERE target_user_id = ? AND role = 'department_manager' ORDER BY rowid"
              )
              .bind(target.userId)
              .all<{ action: string }>()
          ).toMatchObject({
            results: [{ action: "granted" }, { action: "withdrawn" }],
          });
        } finally {
          await roleAssignerContext.dispose();
        }
      }
    );

    roleAuthorityTest(
      "Admin selected-person data and recipient Inbox expose only their bounded projections",
      { tag: ["@http"] },
      async ({ admin, caseApp, extraHTTPHeaders, playwright, staff }) => {
        const target = await provisionAccount(caseApp, "target");
        const otherTarget = await provisionAccount(caseApp, "other");
        const targetPhone = "+85255510011";
        const targetRecoveryPhone = "+85255510012";
        const targetContact = await caseApp.db
          .prepare(
            "update person_profile set phone = ?, phone_shared = 1, verified_recovery_phone = ? where user_id = ?"
          )
          .bind(targetPhone, targetRecoveryPhone, target.userId)
          .run();
        expect(targetContact.meta.changes).toBe(1);

        const targetScopeName = `指定管理部門${target.userId.slice(0, 8)}`;
        const unrelatedScopeName = `其他人士部門${otherTarget.userId.slice(0, 8)}`;
        const targetScopeId = await createDepartment(caseApp, targetScopeName);
        const unrelatedScopeId = await createDepartment(
          caseApp,
          unrelatedScopeName
        );
        const targetOperationKey = randomUUID();
        const unrelatedOperationKey = randomUUID();
        const targetGrant = await grantDepartmentManager(
          admin.context,
          target.userId,
          targetScopeId,
          targetOperationKey
        );
        expect(targetGrant.status()).toBe(201);
        const targetGrantBody = (await targetGrant.json()) as {
          data: {
            receipt: {
              id: string;
              scopeId: string;
              targetUserId: string;
            };
          };
        };
        const unrelatedGrant = await grantDepartmentManager(
          admin.context,
          otherTarget.userId,
          unrelatedScopeId,
          unrelatedOperationKey
        );
        expect(unrelatedGrant.status()).toBe(201);
        const unrelatedGrantBody = (await unrelatedGrant.json()) as {
          data: { receipt: { id: string } };
        };
        const unrelatedAssignment = await caseApp.db
          .prepare(
            "select id from department_manager_assignment where user_id = ? and department_id = ?"
          )
          .bind(otherTarget.userId, unrelatedScopeId)
          .first<{ id: string }>();
        expect(unrelatedAssignment).not.toBeNull();
        if (!unrelatedAssignment) {
          throw new Error("Expected the other target's role assignment");
        }

        // This is a direct detail request; Admin does not need to have loaded
        // a candidate list first.
        const detailResponse = await admin.context.get(
          `/api/v2/roles/department-managers/${encodeURIComponent(
            target.userId
          )}?assignmentPage=1`
        );
        expect(detailResponse.status()).toBe(200);
        const detail = (await detailResponse.json()) as {
          data: {
            person: {
              assignmentPage: { hasNextPage: boolean; number: number };
              assignments: {
                assignmentId: string;
                createdAt: number;
                scopeId: string;
                scopeName: string;
              }[];
              eligibleForGrant: boolean;
              fullName: string;
              userId: string;
              username: string | null;
            };
          };
        };
        const { person } = detail.data;
        expect(Object.keys(person).toSorted()).toEqual([
          "assignmentPage",
          "assignments",
          "eligibleForGrant",
          "fullName",
          "userId",
          "username",
        ]);
        expect(person).toMatchObject({
          assignmentPage: { hasNextPage: false, number: 1 },
          eligibleForGrant: true,
          fullName: target.account.fullName,
          userId: target.userId,
        });
        expect(person.assignments).toHaveLength(1);
        const [assignment] = person.assignments;
        if (!assignment) {
          throw new Error("Expected the selected target's assignment");
        }
        expect(Object.keys(assignment).toSorted()).toEqual([
          "assignmentId",
          "createdAt",
          "scopeId",
          "scopeName",
        ]);
        expect(assignment).toMatchObject({
          scopeId: targetScopeId,
          scopeName: targetScopeName,
        });
        const detailText = JSON.stringify(detail);
        for (const value of [
          target.account.email,
          targetPhone,
          targetRecoveryPhone,
          unrelatedScopeName,
          otherTarget.userId,
          unrelatedAssignment.id,
        ]) {
          expect(detailText).not.toContain(value);
        }

        const emptySearch = await admin.context.get(
          "/api/v2/roles/department-managers?page=1"
        );
        expect(emptySearch.status()).toBe(200);
        expect(await emptySearch.json()).toMatchObject({
          data: { candidates: [], hasNextPage: false, page: 1 },
        });
        const search = await admin.context.get(
          `/api/v2/roles/department-managers?q=${encodeURIComponent(
            target.account.fullName
          )}&page=1`
        );
        expect(search.status()).toBe(200);
        const searchBody = (await search.json()) as {
          data: {
            actorUserId: string;
            candidates: {
              fullName: string;
              userId: string;
              username: string | null;
            }[];
          };
        };
        expect(searchBody.data.candidates).toEqual([
          {
            fullName: target.account.fullName,
            userId: target.userId,
            username: target.account.username,
          },
        ]);
        const [candidate] = searchBody.data.candidates;
        if (!candidate) {
          throw new Error("Expected the target in bounded role search");
        }
        expect(Object.keys(candidate).toSorted()).toEqual([
          "fullName",
          "userId",
          "username",
        ]);
        expect(searchBody.data.actorUserId).toBe(admin.userId);
        const searchText = JSON.stringify(searchBody);
        expect(searchText).not.toContain(target.account.email);
        expect(searchText).not.toContain(targetPhone);
        expect(searchText).not.toContain(targetRecoveryPhone);
        expect(searchText).not.toContain(otherTarget.userId);

        const scopes = await admin.context.get(
          "/api/v2/roles/department-managers/departments?page=1"
        );
        expect(scopes.status()).toBe(200);
        const scopeBody = (await scopes.json()) as {
          data: {
            departments: { id: string; name: string }[];
            hasNextPage: boolean;
            page: number;
          };
        };
        expect(scopeBody.data.departments).toHaveLength(2);
        for (const department of scopeBody.data.departments) {
          expect(Object.keys(department).toSorted()).toEqual(["id", "name"]);
        }
        expect(scopeBody.data.departments).toEqual(
          expect.arrayContaining([
            { id: targetScopeId, name: targetScopeName },
            { id: unrelatedScopeId, name: unrelatedScopeName },
          ])
        );

        const recipient = await playwright.request.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders,
        });
        try {
          const login = await recipient.post("/api/auth/sign-in/username", {
            data: {
              password: target.account.password,
              username: target.account.username,
            },
          });
          expect(login.status()).toBe(200);
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
          expect(inboxBody.data.roleChanges).toEqual([
            {
              action: "granted",
              createdAt: expect.any(Number),
              role: "department_manager",
              scopeName: targetScopeName,
            },
          ]);
          const [roleChange] = inboxBody.data.roleChanges;
          if (!roleChange) {
            throw new Error("Expected the recipient's role-change Inbox event");
          }
          expect(Object.keys(roleChange).toSorted()).toEqual([
            "action",
            "createdAt",
            "role",
            "scopeName",
          ]);
          const inboxText = JSON.stringify(inboxBody);
          for (const value of [
            target.userId,
            target.account.email,
            target.account.username,
            targetPhone,
            targetRecoveryPhone,
            targetScopeId,
            targetOperationKey,
            targetGrantBody.data.receipt.id,
            targetGrantBody.data.receipt.targetUserId,
            otherTarget.userId,
            unrelatedScopeName,
            unrelatedOperationKey,
            unrelatedGrantBody.data.receipt.id,
          ]) {
            expect(inboxText).not.toContain(value);
          }

          const otherInbox = await staff.context.get("/api/v2/inbox");
          expect(otherInbox.status()).toBe(200);
          const otherInboxBody = (await otherInbox.json()) as {
            data: { roleChanges: unknown[] };
          };
          expect(otherInboxBody.data.roleChanges).toEqual([]);
          expect(JSON.stringify(otherInboxBody)).not.toContain(targetScopeName);
          expect(JSON.stringify(otherInboxBody)).not.toContain(target.userId);
        } finally {
          await recipient.dispose();
        }
      }
    );

    roleAuthorityTest(
      "protected receipts stay with their original actor and current Admin authority",
      { tag: ["@http"] },
      async ({ admin, caseApp, staff }) => {
        const target = await provisionAccount(caseApp, "recv");
        const scopeName = `收據權限部門${target.userId.slice(0, 8)}`;
        const scopeId = await createDepartment(caseApp, scopeName);
        const operationKey = randomUUID();
        const change = await grantDepartmentManager(
          admin.context,
          target.userId,
          scopeId,
          operationKey
        );
        expect(change.status()).toBe(201);
        const changeBody = (await change.json()) as {
          data: {
            receipt: {
              action: string;
              id: string;
              scopeId: string;
              scopeName: string;
              targetUserId: string;
            };
          };
        };
        const { receipt } = changeBody.data;
        const beforeDeniedLookups = await roleEffects(caseApp, target.userId, [
          operationKey,
        ]);

        const authorizedSettlement = await admin.context.post(
          "/api/v2/roles/department-managers/reconcile",
          { data: { operationKey } }
        );
        expect(authorizedSettlement.status()).toBe(200);
        expect(await authorizedSettlement.json()).toEqual({
          data: { outcome: "committed", receipt },
        });

        await expectDeniedWithoutDetails(
          await staff.context.post(
            "/api/v2/roles/department-managers/reconcile",
            { data: { operationKey } }
          ),
          [
            operationKey,
            receipt.id,
            receipt.targetUserId,
            receipt.scopeId,
            receipt.scopeName,
          ]
        );

        // The D1 invariant protects the last effective Admin. Retain one
        // synthetic Admin while simulating this actor's authority loss.
        await provisionAccount(caseApp, "backup", "admin");
        const roleChange = await caseApp.db
          .prepare(
            "update person_profile set account_role = 'staff', updated_at = unixepoch() where user_id = ?"
          )
          .bind(admin.userId)
          .run();
        expect(roleChange.meta.changes).toBe(1);
        await expectDeniedWithoutDetails(
          await admin.context.post(
            "/api/v2/roles/department-managers/reconcile",
            { data: { operationKey } }
          ),
          [
            operationKey,
            receipt.id,
            receipt.targetUserId,
            receipt.scopeId,
            receipt.scopeName,
          ]
        );

        expect(
          await roleEffects(caseApp, target.userId, [operationKey])
        ).toEqual(beforeDeniedLookups);
      }
    );
  }
);
