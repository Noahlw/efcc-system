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
  const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
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
