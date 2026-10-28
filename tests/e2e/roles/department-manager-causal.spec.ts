import { randomBytes, randomUUID } from "node:crypto";

import type { APIResponse, PlaywrightWorkerArgs } from "@playwright/test";

import { expect, test } from "../../support/causal";
import type { NativeApp } from "../../support/fixtures";
import type { BatchControl } from "../../worker/clock-matrix";

type CausalApp = NativeApp & { control: BatchControl };
type Playwright = PlaywrightWorkerArgs["playwright"];

const expectResponseStatus = async (
  response: APIResponse,
  expected: number
) => {
  const body: unknown = await response.json().catch(() => null);
  expect(response.status(), JSON.stringify(body)).toBe(expected);
  return body;
};

const signInAdmin = async (app: CausalApp, playwright: Playwright) => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
  const username = `ca.${suffix}`;
  const password = "Synthetic-role-causal-admin!";
  const ip = randomBytes(2);
  const userId = await app.provision.account({
    email: `${suffix}@example.com`,
    fullName: `陳因果管理員${suffix}`,
    membershipStatus: "active",
    password,
    role: "admin",
    username,
  });
  const context = await playwright.request.newContext({
    baseURL: app.origin,
    extraHTTPHeaders: {
      "cf-connecting-ip": `198.19.${ip.readUInt8(0)}.${ip.readUInt8(1)}`,
      origin: app.origin,
    },
  });
  const login = await context.post("/api/auth/sign-in/username", {
    data: { password, username },
  });
  expect(login.status()).toBe(200);
  const confirmation = await context.post(
    "/api/v2/account/password-confirmation",
    { data: { operationKey: randomUUID(), password } }
  );
  expect(confirmation.status()).toBe(201);
  return { context, password, userId };
};

const confirmAdmin = async (admin: Awaited<ReturnType<typeof signInAdmin>>) => {
  const confirmation = await admin.context.post(
    "/api/v2/account/password-confirmation",
    {
      data: { operationKey: randomUUID(), password: admin.password },
    }
  );
  await expectResponseStatus(confirmation, 201);
};

const makeTargetAndDepartment = async (app: CausalApp, suffix: string) => {
  const targetUserId = await app.provision.account({
    email: `${suffix}@example.com`,
    fullName: `陳因果目標${suffix}`,
    membershipStatus: "active",
    password: "Synthetic-role-causal-target!",
    role: "member",
    username: `ct.${suffix}`,
  });
  const scopeId = randomUUID();
  await app.db
    .prepare(
      "INSERT INTO department (id, name, created_at) VALUES (?, ?, unixepoch())"
    )
    .bind(scopeId, `因果測試部門${suffix}`)
    .run();
  return { scopeId, targetUserId };
};

const createRoleAssigner = async (
  app: CausalApp,
  admin: Awaited<ReturnType<typeof signInAdmin>>,
  suffix: string
) => {
  const password = "Synthetic-role-assigner-manager!";
  const userId = await app.provision.account({
    email: `ra.${suffix}@example.com`,
    fullName: `陳因果委派員${suffix}`,
    membershipStatus: "active",
    password,
    role: "staff",
    username: `ra.${suffix}`,
  });
  const grant = await admin.context.post("/api/v2/roles/role-assigners", {
    data: {
      action: "granted",
      operationKey: randomUUID(),
      targetUserId: userId,
    },
  });
  await expectResponseStatus(grant, 201);
  const assignment = await app.db
    .prepare("SELECT id FROM role_assigner_assignment WHERE user_id = ?")
    .bind(userId)
    .first<{ id: string }>();
  if (!assignment) {
    throw new Error(
      "Public Role Assigner grant did not create its current row"
    );
  }
  return {
    authorityAssignmentId: assignment.id,
    password,
    userId,
    username: `ra.${suffix}`,
  };
};

/** Park the public command only after the actual production D1 batch enters. */
const park = async (app: CausalApp, fire: () => Promise<APIResponse>) => {
  const before = await app.control.held();
  await app.control.arm();
  const pending = fire();
  const outcome = (async () => {
    try {
      const response = await pending;
      return `HTTP ${response.status()}`;
    } catch (error) {
      return String(error);
    }
  })();
  try {
    await expect
      .poll(
        async () => {
          const current = await app.control.held();
          return current.held;
        },
        {
          message: "role command never reached the actual D1 batch",
          timeout: 30_000,
        }
      )
      .toBe(true);
    const held = await app.control.held();
    expect(held.entered).toBe(before.entered + 1);
    expect(held.completed).toBe(before.completed);
  } catch (error) {
    await app.control.release();
    throw new Error(
      `causal D1 barrier failed; writer outcome: ${await outcome}`,
      { cause: error }
    );
  }
  return async () => {
    await app.control.release();
    const response = await pending;
    const current = await app.control.held();
    expect(current.held).toBe(false);
    return response;
  };
};

const expectNoRoleWrites = async (
  app: CausalApp,
  actorUserId: string,
  targetUserId: string,
  operationKey: string
) => {
  const effects = await app.db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM department_manager_assignment WHERE user_id = ?) AS assignments,
        (SELECT COUNT(*) FROM role_assignment_history WHERE target_user_id = ?) AS history,
        (SELECT COUNT(*) FROM audit_event WHERE target_user_id = ? AND action IN ('department_manager_granted','department_manager_withdrawn')) AS audits,
        (SELECT COUNT(*) FROM role_change_operation WHERE actor_user_id = ? AND operation_key = ?) AS receipts`
    )
    .bind(targetUserId, targetUserId, targetUserId, actorUserId, operationKey)
    .first<{
      assignments: number;
      audits: number;
      history: number;
      receipts: number;
    }>();
  expect(effects).toEqual({
    assignments: 0,
    audits: 0,
    history: 0,
    receipts: 0,
  });
};

test.describe("Department Manager public command causal checks", () => {
  test(
    "a replaced withdrawal witness rolls back an earlier aggregate grant",
    { tag: ["@native", "@http", "@account-clock-matrix", "@risk-atomicity"] },
    async ({ causal: app, playwright }) => {
      const admin = await signInAdmin(app, playwright);
      try {
        const target = await makeTargetAndDepartment(
          app,
          randomUUID().replaceAll("-", "").slice(0, 12)
        );
        const first = `a-${randomUUID()}`;
        const later = `z-${randomUUID()}`;
        await app.db.batch(
          [first, later].map((scope) =>
            app.db
              .prepare(
                "INSERT INTO department (id,name,created_at) VALUES (?,?,unixepoch())"
              )
              .bind(scope, scope)
          )
        );
        const oldId = randomUUID();
        await app.db
          .prepare(
            "INSERT INTO department_manager_assignment (id,user_id,department_id,created_at) VALUES (?,?,?,unixepoch())"
          )
          .bind(oldId, target.targetUserId, later)
          .run();
        const operationKey = randomUUID();
        const release = await park(app, () =>
          admin.context.post("/api/v2/roles/scoped-department-managers", {
            data: {
              changes: [
                { action: "granted", scopeId: first },
                {
                  action: "withdrawn",
                  expectedAssignmentId: oldId,
                  scopeId: later,
                },
              ],
              operationKey,
              targetUserId: target.targetUserId,
            },
          })
        );
        const replacement = randomUUID();
        await app.db
          .prepare("DELETE FROM department_manager_assignment WHERE id = ?")
          .bind(oldId)
          .run();
        await app.db
          .prepare(
            "INSERT INTO department_manager_assignment (id,user_id,department_id,created_at) VALUES (?,?,?,unixepoch())"
          )
          .bind(replacement, target.targetUserId, later)
          .run();
        const response = await release();
        expect(response.status()).toBe(409);
        const rows = await app.db
          .prepare(
            "SELECT id,department_id FROM department_manager_assignment WHERE user_id = ?"
          )
          .bind(target.targetUserId)
          .all();
        expect(rows.results).toEqual([
          { department_id: later, id: replacement },
        ]);
        const counts = await app.db
          .prepare(`SELECT
          (SELECT count(*) FROM role_assignment_history WHERE target_user_id = ?) AS history,
          (SELECT count(*) FROM audit_event WHERE target_user_id = ? AND action IN ('department_manager_granted','department_manager_withdrawn')) AS audits,
          (SELECT count(*) FROM role_change_operation WHERE actor_user_id = ? AND operation_key = ?) AS receipts`)
          .bind(
            target.targetUserId,
            target.targetUserId,
            admin.userId,
            operationKey
          )
          .first();
        expect(counts).toEqual({ audits: 0, history: 0, receipts: 0 });
      } finally {
        await admin.context.dispose();
      }
    }
  );
  for (const effect of ["history", "audit", "receipt"] as const) {
    test(
      `aggregate ${effect} suppression rolls back all writes`,
      { tag: ["@native", "@http", "@account-clock-matrix", "@risk-atomicity"] },
      async ({ causal: app, playwright }) => {
        const admin = await signInAdmin(app, playwright);
        try {
          const target = await makeTargetAndDepartment(
            app,
            randomUUID().replaceAll("-", "").slice(0, 12)
          );
          const scopes = [`a-${randomUUID()}`, `z-${randomUUID()}`];
          await app.db.batch(
            scopes.map((scope) =>
              app.db
                .prepare(
                  "INSERT INTO department (id,name,created_at) VALUES (?,?,unixepoch())"
                )
                .bind(scope, scope)
            )
          );
          const table = {
            audit: "audit_event",
            history: "role_assignment_history",
            receipt: "role_change_operation",
          }[effect];
          const condition = {
            audit:
              "NEW.action = 'department_manager_granted' AND EXISTS (SELECT 1 FROM audit_event WHERE target_user_id = NEW.target_user_id AND action = 'department_manager_granted')",
            history: `NEW.scope_id = '${scopes[1]}'`,
            receipt: "NEW.command_family = 'person_scoped'",
          }[effect];
          await app.db
            .prepare(
              `CREATE TRIGGER suppress_aggregate_effect BEFORE INSERT ON ${table} WHEN ${condition} BEGIN SELECT RAISE(IGNORE); END`
            )
            .run();
          const operationKey = randomUUID();
          const response = await admin.context.post(
            "/api/v2/roles/scoped-department-managers",
            {
              data: {
                changes: scopes.map((scopeId) => ({
                  action: "granted",
                  scopeId,
                })),
                operationKey,
                targetUserId: target.targetUserId,
              },
            }
          );
          expect(response.status()).toBe(500);
          await expectNoRoleWrites(
            app,
            admin.userId,
            target.targetUserId,
            operationKey
          );
        } finally {
          await admin.context.dispose();
        }
      }
    );
  }
  test(
    "a later aggregate guard miss rolls back earlier changes",
    { tag: ["@native", "@http", "@account-clock-matrix", "@risk-atomicity"] },
    async ({ causal: app, playwright }) => {
      const admin = await signInAdmin(app, playwright);
      try {
        const target = await makeTargetAndDepartment(
          app,
          randomUUID().replaceAll("-", "").slice(0, 12)
        );
        const first = `a-${randomUUID()}`;
        const later = `z-${randomUUID()}`;
        await app.db.batch(
          [first, later].map((scopeId) =>
            app.db
              .prepare(
                "INSERT INTO department (id,name,created_at) VALUES (?,?,unixepoch())"
              )
              .bind(scopeId, scopeId)
          )
        );
        const operationKey = randomUUID();
        const release = await park(app, () =>
          admin.context.post("/api/v2/roles/scoped-department-managers", {
            data: {
              changes: [
                { action: "granted", scopeId: first },
                { action: "granted", scopeId: later },
              ],
              operationKey,
              targetUserId: target.targetUserId,
            },
          })
        );
        await app.db
          .prepare(
            "INSERT INTO department_manager_assignment (id,user_id,department_id,created_at) VALUES (?,?,?,unixepoch())"
          )
          .bind(randomUUID(), target.targetUserId, later)
          .run();
        const response = await release();
        expect(response.status()).toBe(409);
        const effects = await app.db
          .prepare(`SELECT
          (SELECT count(*) FROM department_manager_assignment WHERE user_id = ? AND department_id = ?) AS earlier,
          (SELECT count(*) FROM role_assignment_history WHERE target_user_id = ?) AS history,
          (SELECT count(*) FROM audit_event WHERE target_user_id = ? AND action = 'department_manager_granted') AS audits,
          (SELECT count(*) FROM role_change_operation WHERE actor_user_id = ? AND operation_key = ?) AS receipts`)
          .bind(
            target.targetUserId,
            first,
            target.targetUserId,
            target.targetUserId,
            admin.userId,
            operationKey
          )
          .first();
        expect(effects).toEqual({
          audits: 0,
          earlier: 0,
          history: 0,
          receipts: 0,
        });
      } finally {
        await admin.context.dispose();
      }
    }
  );
  test(
    "a current Role Assigner grants a Department Manager through the public command",
    {
      tag: [
        "@native",
        "@http",
        "@account-clock-matrix",
        "@risk-authorization",
        "@risk-atomicity",
      ],
    },
    async ({ causal: app, playwright }) => {
      const admin = await signInAdmin(app, playwright);
      let roleAssignerContext:
        | Awaited<ReturnType<typeof playwright.request.newContext>>
        | undefined;
      try {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
        const roleAssigner = await createRoleAssigner(app, admin, suffix);
        const ip = randomBytes(2);
        const roleAssignerRequest = await playwright.request.newContext({
          baseURL: app.origin,
          extraHTTPHeaders: {
            "cf-connecting-ip": `198.19.${ip.readUInt8(0)}.${ip.readUInt8(1)}`,
            origin: app.origin,
          },
        });
        roleAssignerContext = roleAssignerRequest;
        const login = await roleAssignerRequest.post(
          "/api/auth/sign-in/username",
          {
            data: {
              password: roleAssigner.password,
              username: roleAssigner.username,
            },
          }
        );
        await expectResponseStatus(login, 200);
        const confirmation = await roleAssignerRequest.post(
          "/api/v2/account/password-confirmation",
          {
            data: {
              operationKey: randomUUID(),
              password: roleAssigner.password,
            },
          }
        );
        await expectResponseStatus(confirmation, 201);

        const target = await makeTargetAndDepartment(app, suffix);
        const input = {
          action: "granted",
          authorityAssignmentId: roleAssigner.authorityAssignmentId,
          operationKey: randomUUID(),
          scopeId: target.scopeId,
          targetUserId: target.targetUserId,
        };
        const grant = await roleAssignerRequest.post(
          "/api/v2/roles/department-managers",
          { data: input }
        );
        const body: unknown = await grant.json().catch(() => null);
        if (grant.status() !== 201) {
          await expectNoRoleWrites(
            app,
            roleAssigner.userId,
            target.targetUserId,
            input.operationKey
          );
        }
        expect(grant.status(), JSON.stringify(body)).toBe(201);
        expect(body).toMatchObject({
          data: {
            receipt: {
              action: "granted",
              scopeId: target.scopeId,
              targetUserId: target.targetUserId,
            },
          },
        });

        const detail = await admin.context.get(
          `/api/v2/roles/department-managers/${encodeURIComponent(target.targetUserId)}`
        );
        await expectResponseStatus(detail, 200);
        const detailBody = (await detail.json()) as {
          data: {
            person: {
              assignments: { scopeId: string }[];
              eligibleForGrant: boolean;
            };
          };
        };
        expect(detailBody.data.person.eligibleForGrant).toBe(true);
        expect(detailBody.data.person.assignments).toEqual([
          expect.objectContaining({ scopeId: target.scopeId }),
        ]);

        const history = await app.db
          .prepare(
            "SELECT COUNT(*) AS count FROM role_assignment_history WHERE actor_user_id = ? AND target_user_id = ? AND scope_id = ? AND role = 'department_manager' AND action = 'granted'"
          )
          .bind(roleAssigner.userId, target.targetUserId, target.scopeId)
          .first<{ count: number }>();
        expect(history?.count).toBe(1);
      } finally {
        await roleAssignerContext?.dispose();
        await admin.context.dispose();
      }
    }
  );

  test(
    "a held Role Assigner grant cannot survive delegation revoke and regrant",
    {
      tag: [
        "@native",
        "@http",
        "@account-clock-matrix",
        "@risk-authorization",
        "@risk-atomicity",
        "@risk-recovery",
      ],
    },
    async ({ causal: app, playwright }) => {
      const admin = await signInAdmin(app, playwright);
      let roleAssignerContext:
        | Awaited<ReturnType<typeof playwright.request.newContext>>
        | undefined;
      let releaseHeld: (() => Promise<APIResponse>) | undefined;
      try {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
        const roleAssigner = await createRoleAssigner(app, admin, suffix);
        const ip = randomBytes(2);
        const roleAssignerRequest = await playwright.request.newContext({
          baseURL: app.origin,
          extraHTTPHeaders: {
            "cf-connecting-ip": `198.19.${ip.readUInt8(0)}.${ip.readUInt8(1)}`,
            origin: app.origin,
          },
        });
        roleAssignerContext = roleAssignerRequest;
        const login = await roleAssignerRequest.post(
          "/api/auth/sign-in/username",
          {
            data: {
              password: roleAssigner.password,
              username: roleAssigner.username,
            },
          }
        );
        await expectResponseStatus(login, 200);
        const confirmation = await roleAssignerRequest.post(
          "/api/v2/account/password-confirmation",
          {
            data: {
              operationKey: randomUUID(),
              password: roleAssigner.password,
            },
          }
        );
        await expectResponseStatus(confirmation, 201);

        const target = await makeTargetAndDepartment(app, suffix);
        const input = {
          action: "granted",
          authorityAssignmentId: roleAssigner.authorityAssignmentId,
          operationKey: randomUUID(),
          scopeId: target.scopeId,
          targetUserId: target.targetUserId,
        };
        releaseHeld = await park(app, () =>
          roleAssignerRequest.post("/api/v2/roles/department-managers", {
            data: input,
          })
        );

        await confirmAdmin(admin);
        const withdrawal = await admin.context.post(
          "/api/v2/roles/role-assigners",
          {
            data: {
              action: "withdrawn",
              expectedAssignmentId: roleAssigner.authorityAssignmentId,
              operationKey: randomUUID(),
              targetUserId: roleAssigner.userId,
            },
          }
        );
        await expectResponseStatus(withdrawal, 201);

        await confirmAdmin(admin);
        const regrant = await admin.context.post(
          "/api/v2/roles/role-assigners",
          {
            data: {
              action: "granted",
              operationKey: randomUUID(),
              targetUserId: roleAssigner.userId,
            },
          }
        );
        await expectResponseStatus(regrant, 201);
        const currentAuthority = await app.db
          .prepare("SELECT id FROM role_assigner_assignment WHERE user_id = ?")
          .bind(roleAssigner.userId)
          .first<{ id: string }>();
        if (!currentAuthority) {
          throw new Error("Regranted Role Assigner row is missing");
        }
        expect(currentAuthority.id).not.toBe(
          roleAssigner.authorityAssignmentId
        );

        const release = releaseHeld;
        if (!release) {
          throw new Error("Held Department Manager request was not released");
        }
        releaseHeld = undefined;
        const staleResult = await release();
        expect(await expectResponseStatus(staleResult, 409)).toMatchObject({
          error: { code: "conflict" },
        });
        await expectNoRoleWrites(
          app,
          roleAssigner.userId,
          target.targetUserId,
          input.operationKey
        );

        const staleRetry = await roleAssignerRequest.post(
          "/api/v2/roles/department-managers",
          { data: input }
        );
        expect(await expectResponseStatus(staleRetry, 409)).toMatchObject({
          error: { code: "conflict" },
        });
        await expectNoRoleWrites(
          app,
          roleAssigner.userId,
          target.targetUserId,
          input.operationKey
        );
        const reconciliation = await roleAssignerRequest.post(
          "/api/v2/roles/department-managers/reconcile",
          { data: { operationKey: input.operationKey } }
        );
        expect(await expectResponseStatus(reconciliation, 200)).toMatchObject({
          data: { outcome: "unknown", receipt: null },
        });
      } finally {
        await releaseHeld?.().catch(() => null);
        await app.control.release();
        await roleAssignerContext?.dispose();
        await admin.context.dispose();
      }
    }
  );

  test(
    "a revoked Role Assigner loses its Department Manager receipt but keeps Staff Audit",
    {
      tag: [
        "@native",
        "@http",
        "@account-clock-matrix",
        "@risk-authorization",
        "@risk-history",
      ],
    },
    async ({ causal: app, playwright }) => {
      const admin = await signInAdmin(app, playwright);
      let roleAssignerContext:
        | Awaited<ReturnType<typeof playwright.request.newContext>>
        | undefined;
      try {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
        const roleAssigner = await createRoleAssigner(app, admin, suffix);
        const ip = randomBytes(2);
        roleAssignerContext = await playwright.request.newContext({
          baseURL: app.origin,
          extraHTTPHeaders: {
            "cf-connecting-ip": `198.19.${ip.readUInt8(0)}.${ip.readUInt8(1)}`,
            origin: app.origin,
          },
        });
        const login = await roleAssignerContext.post(
          "/api/auth/sign-in/username",
          {
            data: {
              password: roleAssigner.password,
              username: roleAssigner.username,
            },
          }
        );
        await expectResponseStatus(login, 200);
        const confirmation = await roleAssignerContext.post(
          "/api/v2/account/password-confirmation",
          {
            data: {
              operationKey: randomUUID(),
              password: roleAssigner.password,
            },
          }
        );
        await expectResponseStatus(confirmation, 201);

        const target = await makeTargetAndDepartment(app, suffix);
        const input = {
          action: "granted",
          authorityAssignmentId: roleAssigner.authorityAssignmentId,
          operationKey: randomUUID(),
          scopeId: target.scopeId,
          targetUserId: target.targetUserId,
        };
        const grant = await roleAssignerContext.post(
          "/api/v2/roles/department-managers",
          { data: input }
        );
        const grantBody = await expectResponseStatus(grant, 201);
        expect(grantBody).toMatchObject({
          data: {
            receipt: {
              action: "granted",
              scopeId: target.scopeId,
              targetUserId: target.targetUserId,
            },
          },
        });
        const audit = await app.db
          .prepare(
            "SELECT id FROM audit_event WHERE actor_user_id = ? AND target_user_id = ? AND action = 'department_manager_granted'"
          )
          .bind(roleAssigner.userId, target.targetUserId)
          .first<{ id: string }>();
        if (!audit) {
          throw new Error("Committed Department Manager Audit row is missing");
        }

        await confirmAdmin(admin);
        const withdrawal = await admin.context.post(
          "/api/v2/roles/role-assigners",
          {
            data: {
              action: "withdrawn",
              expectedAssignmentId: roleAssigner.authorityAssignmentId,
              operationKey: randomUUID(),
              targetUserId: roleAssigner.userId,
            },
          }
        );
        await expectResponseStatus(withdrawal, 201);

        const deniedReceipt = await roleAssignerContext.post(
          "/api/v2/roles/department-managers/reconcile",
          { data: { operationKey: input.operationKey } }
        );
        expect(await expectResponseStatus(deniedReceipt, 403)).toMatchObject({
          error: { code: "business_access_denied" },
        });

        const staffAudit = await roleAssignerContext.get(
          `/api/v2/staff/account-audit?record=${encodeURIComponent(audit.id)}`
        );
        expect(await expectResponseStatus(staffAudit, 200)).toMatchObject({
          data: {
            selectedEvent: {
              action: "department_manager_granted",
              actorUserId: roleAssigner.userId,
              id: audit.id,
              targetUserId: target.targetUserId,
            },
          },
        });
      } finally {
        await app.control.release();
        await roleAssignerContext?.dispose();
        await admin.context.dispose();
      }
    }
  );

  test(
    "grant rechecks current target eligibility at the held atomic write boundary",
    {
      tag: [
        "@native",
        "@http",
        "@account-clock-matrix",
        "@risk-authorization",
        "@risk-atomicity",
      ],
    },
    async ({ causal: app, playwright }) => {
      const admin = await signInAdmin(app, playwright);
      try {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
        const target = await makeTargetAndDepartment(app, suffix);
        const input = {
          action: "granted",
          operationKey: randomUUID(),
          scopeId: target.scopeId,
          targetUserId: target.targetUserId,
        };
        const release = await park(app, () =>
          admin.context.post("/api/v2/roles/department-managers", {
            data: input,
          })
        );
        await app.db
          .prepare(
            "UPDATE person_profile SET membership_status = 'deactivated' WHERE user_id = ?"
          )
          .bind(target.targetUserId)
          .run();

        const result = await release();
        const body = await expectResponseStatus(result, 409);
        expect(body).toMatchObject({ error: { code: "conflict" } });
        await expectNoRoleWrites(
          app,
          admin.userId,
          target.targetUserId,
          input.operationKey
        );
        const reconciliation = await admin.context.post(
          "/api/v2/roles/department-managers/reconcile",
          { data: { operationKey: input.operationKey } }
        );
        expect(await expectResponseStatus(reconciliation, 200)).toMatchObject({
          data: { outcome: "unknown", receipt: null },
        });
      } finally {
        await app.control.release();
        await admin.context.dispose();
      }
    }
  );

  test(
    "grant rechecks current Admin authority at the held atomic write boundary",
    {
      tag: [
        "@native",
        "@http",
        "@account-clock-matrix",
        "@risk-authorization",
        "@risk-atomicity",
      ],
    },
    async ({ causal: app, playwright }) => {
      const admin = await signInAdmin(app, playwright);
      try {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
        await app.provision.account({
          email: `${suffix}.second@example.com`,
          fullName: `陳備援管理員${suffix}`,
          membershipStatus: "active",
          password: "Synthetic-secondary-admin!",
          role: "admin",
          username: `ca2.${suffix}`,
        });
        const target = await makeTargetAndDepartment(app, suffix);
        const input = {
          action: "granted",
          operationKey: randomUUID(),
          scopeId: target.scopeId,
          targetUserId: target.targetUserId,
        };
        const release = await park(app, () =>
          admin.context.post("/api/v2/roles/department-managers", {
            data: input,
          })
        );
        await app.db
          .prepare(
            "UPDATE person_profile SET account_role = 'staff' WHERE user_id = ?"
          )
          .bind(admin.userId)
          .run();

        const result = await release();
        const body = await expectResponseStatus(result, 403);
        expect(body).toMatchObject({
          error: { code: "business_access_denied" },
        });
        await expectNoRoleWrites(
          app,
          admin.userId,
          target.targetUserId,
          input.operationKey
        );
        const reconciliation = await admin.context.post(
          "/api/v2/roles/department-managers/reconcile",
          { data: { operationKey: input.operationKey } }
        );
        expect(await expectResponseStatus(reconciliation, 403)).toMatchObject({
          error: { code: "business_access_denied" },
        });
      } finally {
        await app.control.release();
        await admin.context.dispose();
      }
    }
  );

  test(
    "grant rechecks the reviewed scope name at the held atomic write boundary",
    {
      tag: [
        "@native",
        "@http",
        "@account-clock-matrix",
        "@risk-authorization",
        "@risk-atomicity",
      ],
    },
    async ({ causal: app, playwright }) => {
      const admin = await signInAdmin(app, playwright);
      try {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
        const target = await makeTargetAndDepartment(app, suffix);
        const input = {
          action: "granted",
          operationKey: randomUUID(),
          scopeId: target.scopeId,
          targetUserId: target.targetUserId,
        };
        const release = await park(app, () =>
          admin.context.post("/api/v2/roles/department-managers", {
            data: input,
          })
        );
        await app.db
          .prepare("UPDATE department SET name = ? WHERE id = ?")
          .bind(`重新命名部門${suffix}`, target.scopeId)
          .run();

        const result = await release();
        const body = await expectResponseStatus(result, 409);
        expect(body).toMatchObject({ error: { code: "conflict" } });
        await expectNoRoleWrites(
          app,
          admin.userId,
          target.targetUserId,
          input.operationKey
        );
        const reconciliation = await admin.context.post(
          "/api/v2/roles/department-managers/reconcile",
          { data: { operationKey: input.operationKey } }
        );
        expect(await expectResponseStatus(reconciliation, 200)).toMatchObject({
          data: { outcome: "unknown", receipt: null },
        });
      } finally {
        await app.control.release();
        await admin.context.dispose();
      }
    }
  );

  test(
    "grant rechecks the ten-minute password proof at the held atomic write boundary",
    {
      tag: [
        "@native",
        "@http",
        "@account-clock-matrix",
        "@risk-authorization",
        "@risk-atomicity",
        "@risk-deadline",
      ],
    },
    async ({ causal: app, playwright }) => {
      const admin = await signInAdmin(app, playwright);
      try {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
        const target = await makeTargetAndDepartment(app, suffix);
        const sessionRow = await app.db
          .prepare(
            "SELECT id FROM session WHERE user_id = ? ORDER BY created_at DESC LIMIT 1"
          )
          .bind(admin.userId)
          .first<{ id: string }>();
        if (!sessionRow) {
          throw new Error("Admin session was not created by public login");
        }
        const proofId = randomUUID();
        const proofKey = randomUUID();
        await app.db
          .prepare(
            "UPDATE session SET confirmation_operation_id = ?, password_confirmed_at = unixepoch() - 594 WHERE id = ?"
          )
          .bind(proofId, sessionRow.id)
          .run();
        await app.db
          .prepare(
            "INSERT INTO audit_event (id, action, actor_user_id, target_user_id, created_at) SELECT ?, 'password_confirmed', user_id, user_id, password_confirmed_at FROM session WHERE id = ?"
          )
          .bind(proofId, sessionRow.id)
          .run();
        await app.db
          .prepare(
            "INSERT INTO account_security_operation (action, created_at, credential_revision, id, operation_key, request_hash, session_id, user_id) SELECT 'password_confirmed', password_confirmed_at, credential_revision, ?, ?, 'synthetic-role-deadline-proof', id, user_id FROM session WHERE id = ?"
          )
          .bind(proofId, proofKey, sessionRow.id)
          .run();
        const input = {
          action: "granted",
          operationKey: randomUUID(),
          scopeId: target.scopeId,
          targetUserId: target.targetUserId,
        };
        const release = await park(app, () =>
          admin.context.post("/api/v2/roles/department-managers", {
            data: input,
          })
        );
        await expect
          .poll(
            async () => {
              const row = await app.db
                .prepare(
                  "SELECT (CAST(strftime('%s','now') AS INTEGER) - password_confirmed_at < 600) AS open FROM session WHERE id = ?"
                )
                .bind(sessionRow.id)
                .first<{ open: number }>();
              return row?.open;
            },
            {
              message:
                "real D1 clock did not cross the ten-minute proof deadline",
              timeout: 20_000,
            }
          )
          .toBe(0);

        const result = await release();
        const body = await expectResponseStatus(result, 403);
        expect(body).toMatchObject({
          error: { code: "password_confirmation_required" },
        });
        await expectNoRoleWrites(
          app,
          admin.userId,
          target.targetUserId,
          input.operationKey
        );
        const reconciliation = await admin.context.post(
          "/api/v2/roles/department-managers/reconcile",
          { data: { operationKey: input.operationKey } }
        );
        expect(await expectResponseStatus(reconciliation, 200)).toMatchObject({
          data: { outcome: "unknown", receipt: null },
        });
      } finally {
        await app.control.release();
        await admin.context.dispose();
      }
    }
  );

  test(
    "a Role Assigner grant rechecks that its target remains a Member at the held atomic write boundary",
    {
      tag: [
        "@native",
        "@http",
        "@account-clock-matrix",
        "@risk-authorization",
        "@risk-atomicity",
      ],
    },
    async ({ causal: app, playwright }) => {
      const admin = await signInAdmin(app, playwright);
      let roleAssignerContext:
        | Awaited<ReturnType<typeof playwright.request.newContext>>
        | undefined;
      try {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
        const roleAssigner = await createRoleAssigner(app, admin, suffix);
        const roleAssignerRequest = await playwright.request.newContext({
          baseURL: app.origin,
          extraHTTPHeaders: {
            "cf-connecting-ip": "198.19.33.34",
            origin: app.origin,
          },
        });
        roleAssignerContext = roleAssignerRequest;
        const login = await roleAssignerRequest.post(
          "/api/auth/sign-in/username",
          {
            data: {
              password: roleAssigner.password,
              username: roleAssigner.username,
            },
          }
        );
        await expectResponseStatus(login, 200);
        const confirmation = await roleAssignerRequest.post(
          "/api/v2/account/password-confirmation",
          {
            data: {
              operationKey: randomUUID(),
              password: roleAssigner.password,
            },
          }
        );
        await expectResponseStatus(confirmation, 201);

        const target = await makeTargetAndDepartment(app, suffix);
        const input = {
          action: "granted",
          authorityAssignmentId: roleAssigner.authorityAssignmentId,
          operationKey: randomUUID(),
          scopeId: target.scopeId,
          targetUserId: target.targetUserId,
        };
        const release = await park(app, () =>
          roleAssignerRequest.post("/api/v2/roles/department-managers", {
            data: input,
          })
        );
        await app.db
          .prepare(
            "UPDATE person_profile SET account_role = 'staff' WHERE user_id = ?"
          )
          .bind(target.targetUserId)
          .run();

        const result = await release();
        const body = await expectResponseStatus(result, 409);
        expect(body).toMatchObject({ error: { code: "conflict" } });
        await expectNoRoleWrites(
          app,
          roleAssigner.userId,
          target.targetUserId,
          input.operationKey
        );
        const reconciliation = await roleAssignerContext.post(
          "/api/v2/roles/department-managers/reconcile",
          { data: { operationKey: input.operationKey } }
        );
        expect(await expectResponseStatus(reconciliation, 200)).toMatchObject({
          data: { outcome: "unknown", receipt: null },
        });
      } finally {
        await app.control.release();
        await roleAssignerContext?.dispose();
        await admin.context.dispose();
      }
    }
  );

  test(
    "a Role Assigner grant rechecks the ten-minute proof at the held atomic write boundary",
    {
      tag: [
        "@native",
        "@http",
        "@account-clock-matrix",
        "@risk-authorization",
        "@risk-atomicity",
        "@risk-deadline",
      ],
    },
    async ({ causal: app, playwright }) => {
      const admin = await signInAdmin(app, playwright);
      let roleAssignerContext:
        | Awaited<ReturnType<typeof playwright.request.newContext>>
        | undefined;
      try {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
        const roleAssigner = await createRoleAssigner(app, admin, suffix);
        const roleAssignerRequest = await playwright.request.newContext({
          baseURL: app.origin,
          extraHTTPHeaders: {
            "cf-connecting-ip": "198.19.35.36",
            origin: app.origin,
          },
        });
        roleAssignerContext = roleAssignerRequest;
        const login = await roleAssignerRequest.post(
          "/api/auth/sign-in/username",
          {
            data: {
              password: roleAssigner.password,
              username: roleAssigner.username,
            },
          }
        );
        await expectResponseStatus(login, 200);
        const confirmation = await roleAssignerRequest.post(
          "/api/v2/account/password-confirmation",
          {
            data: {
              operationKey: randomUUID(),
              password: roleAssigner.password,
            },
          }
        );
        await expectResponseStatus(confirmation, 201);

        const target = await makeTargetAndDepartment(app, suffix);
        const sessionRow = await app.db
          .prepare(
            "SELECT id FROM session WHERE user_id = ? ORDER BY created_at DESC LIMIT 1"
          )
          .bind(roleAssigner.userId)
          .first<{ id: string }>();
        if (!sessionRow) {
          throw new Error(
            "Role Assigner session was not created by public login"
          );
        }
        const proofId = randomUUID();
        const proofKey = randomUUID();
        await app.db
          .prepare(
            "UPDATE session SET confirmation_operation_id = ?, password_confirmed_at = unixepoch() - 594 WHERE id = ?"
          )
          .bind(proofId, sessionRow.id)
          .run();
        await app.db
          .prepare(
            "INSERT INTO audit_event (id, action, actor_user_id, target_user_id, created_at) SELECT ?, 'password_confirmed', user_id, user_id, password_confirmed_at FROM session WHERE id = ?"
          )
          .bind(proofId, sessionRow.id)
          .run();
        await app.db
          .prepare(
            "INSERT INTO account_security_operation (action, created_at, credential_revision, id, operation_key, request_hash, session_id, user_id) SELECT 'password_confirmed', password_confirmed_at, credential_revision, ?, ?, 'synthetic-role-assigner-deadline-proof', id, user_id FROM session WHERE id = ?"
          )
          .bind(proofId, proofKey, sessionRow.id)
          .run();

        const input = {
          action: "granted",
          authorityAssignmentId: roleAssigner.authorityAssignmentId,
          operationKey: randomUUID(),
          scopeId: target.scopeId,
          targetUserId: target.targetUserId,
        };
        const release = await park(app, () =>
          roleAssignerRequest.post("/api/v2/roles/department-managers", {
            data: input,
          })
        );
        await expect
          .poll(
            async () => {
              const row = await app.db
                .prepare(
                  "SELECT (CAST(strftime('%s','now') AS INTEGER) - password_confirmed_at < 600) AS open FROM session WHERE id = ?"
                )
                .bind(sessionRow.id)
                .first<{ open: number }>();
              return row?.open;
            },
            {
              message:
                "real D1 clock did not cross the Role Assigner proof deadline",
              timeout: 20_000,
            }
          )
          .toBe(0);

        const result = await release();
        const body = await expectResponseStatus(result, 403);
        expect(body).toMatchObject({
          error: { code: "password_confirmation_required" },
        });
        await expectNoRoleWrites(
          app,
          roleAssigner.userId,
          target.targetUserId,
          input.operationKey
        );
        const reconciliation = await roleAssignerContext.post(
          "/api/v2/roles/department-managers/reconcile",
          { data: { operationKey: input.operationKey } }
        );
        expect(await expectResponseStatus(reconciliation, 200)).toMatchObject({
          data: { outcome: "unknown", receipt: null },
        });
      } finally {
        await app.control.release();
        await roleAssignerContext?.dispose();
        await admin.context.dispose();
      }
    }
  );

  test(
    "a Role Assigner grant cannot commit against a changed Staff credential revision",
    {
      tag: [
        "@native",
        "@http",
        "@account-clock-matrix",
        "@risk-authorization",
        "@risk-atomicity",
        "@risk-session",
      ],
    },
    async ({ causal: app, playwright }) => {
      const admin = await signInAdmin(app, playwright);
      let roleAssignerContext:
        | Awaited<ReturnType<typeof playwright.request.newContext>>
        | undefined;
      let currentRoleAssignerContext:
        | Awaited<ReturnType<typeof playwright.request.newContext>>
        | undefined;
      let releaseHeld: (() => Promise<APIResponse>) | undefined;
      try {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
        const roleAssigner = await createRoleAssigner(app, admin, suffix);
        const roleAssignerRequest = await playwright.request.newContext({
          baseURL: app.origin,
          extraHTTPHeaders: {
            "cf-connecting-ip": "198.19.37.38",
            origin: app.origin,
          },
        });
        roleAssignerContext = roleAssignerRequest;
        const login = await roleAssignerRequest.post(
          "/api/auth/sign-in/username",
          {
            data: {
              password: roleAssigner.password,
              username: roleAssigner.username,
            },
          }
        );
        await expectResponseStatus(login, 200);
        const confirmation = await roleAssignerRequest.post(
          "/api/v2/account/password-confirmation",
          {
            data: {
              operationKey: randomUUID(),
              password: roleAssigner.password,
            },
          }
        );
        await expectResponseStatus(confirmation, 201);

        const target = await makeTargetAndDepartment(app, suffix);
        const input = {
          action: "granted",
          authorityAssignmentId: roleAssigner.authorityAssignmentId,
          operationKey: randomUUID(),
          scopeId: target.scopeId,
          targetUserId: target.targetUserId,
        };
        releaseHeld = await park(app, () =>
          roleAssignerRequest.post("/api/v2/roles/department-managers", {
            data: input,
          })
        );
        await app.db
          .prepare(
            "UPDATE account SET credential_revision = credential_revision + 1 WHERE user_id = ?"
          )
          .bind(roleAssigner.userId)
          .run();

        const release = releaseHeld;
        if (!release) {
          throw new Error("Held Department Manager request was not released");
        }
        releaseHeld = undefined;
        const response = await release();
        expect(await expectResponseStatus(response, 401)).toMatchObject({
          error: { code: "unauthorized" },
        });
        await expectNoRoleWrites(
          app,
          roleAssigner.userId,
          target.targetUserId,
          input.operationKey
        );

        const currentRequest = await playwright.request.newContext({
          baseURL: app.origin,
          extraHTTPHeaders: {
            "cf-connecting-ip": "198.19.39.40",
            origin: app.origin,
          },
        });
        currentRoleAssignerContext = currentRequest;
        const currentLogin = await currentRequest.post(
          "/api/auth/sign-in/username",
          {
            data: {
              password: roleAssigner.password,
              username: roleAssigner.username,
            },
          }
        );
        await expectResponseStatus(currentLogin, 200);
        const reconciliation = await currentRequest.post(
          "/api/v2/roles/department-managers/reconcile",
          { data: { operationKey: input.operationKey } }
        );
        expect(await expectResponseStatus(reconciliation, 200)).toMatchObject({
          data: { outcome: "unknown", receipt: null },
        });
      } finally {
        await releaseHeld?.().catch(() => null);
        await app.control.release();
        await currentRoleAssignerContext?.dispose();
        await roleAssignerContext?.dispose();
        await admin.context.dispose();
      }
    }
  );
});

for (const stage of ["search", "detail", "duties"] as const) {
  for (const change of [
    "revoked delegation",
    "replacement delegation",
    "protected target",
  ] as const) {
    test(
      `Person workspace ${stage} read withholds protected data after ${change} at native SQL`,
      {
        tag: [
          "@native",
          "@http",
          "@account-clock-matrix",
          "@risk-authorization",
          "@risk-privacy",
        ],
      },
      async ({ causal: app, playwright }) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
        const password = "Synthetic-person-read-causal!";
        const username = `read.ra.${suffix}`;
        const actorUserId = await app.provision.account({
          email: `${username}@example.com`,
          fullName: `因果職務指派員${suffix}`,
          membershipStatus: "active",
          password,
          role: "staff",
          username,
        });
        await app.db
          .prepare(
            "insert into role_assigner_assignment (id,user_id,created_at) values (?,?,unixepoch())"
          )
          .bind(randomUUID(), actorUserId)
          .run();
        const target = await makeTargetAndDepartment(app, `read.${suffix}`);
        await app.db
          .prepare(
            "insert into department_manager_assignment (id,department_id,user_id,created_at) values (?,?,?,unixepoch())"
          )
          .bind(randomUUID(), target.scopeId, target.targetUserId)
          .run();
        const context = await playwright.request.newContext({
          baseURL: app.origin,
          extraHTTPHeaders: {
            "cf-connecting-ip": "198.19.41.20",
            origin: app.origin,
          },
        });
        try {
          const login = await context.post("/api/auth/sign-in/username", {
            data: { password, username },
          });
          expect(login.status()).toBe(200);
          const path =
            stage === "search"
              ? `/api/v2/roles/people?q=${encodeURIComponent(`read.${suffix}`)}`
              : `/api/v2/roles/people/${target.targetUserId}`;
          const positive = await context.get(path);
          expect(positive.status()).toBe(200);
          expect(await positive.text()).toContain(target.targetUserId);
          await app.control.armRolePeopleRead(stage);
          const pending = context.get(path);
          // eslint-disable-next-line promise/prefer-await-to-callbacks -- Observe the held request's rejection before cleanup.
          const outcome = pending.then((response) => response.status(), String);
          try {
            await expect
              .poll(async () => {
                const current = await app.control.held();
                return current.held;
              })
              .toBe(true);
            if (change === "protected target") {
              await app.db
                .prepare(
                  "update person_profile set account_role = 'staff' where user_id = ?"
                )
                .bind(target.targetUserId)
                .run();
            } else {
              await app.db
                .prepare(
                  "delete from role_assigner_assignment where user_id = ?"
                )
                .bind(actorUserId)
                .run();
              if (change === "replacement delegation") {
                await app.db
                  .prepare(
                    "insert into role_assigner_assignment (id,user_id,created_at) values (?,?,unixepoch())"
                  )
                  .bind(randomUUID(), actorUserId)
                  .run();
              }
            }
            await app.control.release();
            const response = await pending;
            const text = await response.text();
            expect(text).not.toContain(target.targetUserId);
            expect(text).not.toContain(`陳因果目標read.${suffix}`);
            expect(text).not.toContain(target.scopeId);
            if (change === "protected target") {
              expect(response.status()).toBe(stage === "search" ? 200 : 404);
              if (stage === "search") {
                expect(JSON.parse(text)).toMatchObject({
                  data: { candidates: [] },
                });
              }
            } else {
              expect(response.status()).toBe(
                change === "revoked delegation" ? 403 : 409
              );
            }
          } finally {
            await app.control.release();
            await outcome;
          }
        } finally {
          await app.control.release();
          await context.dispose();
        }
      }
    );
  }
}

test(
  "Person workspace omits a Department whose last duty disappears after group selection",
  {
    tag: [
      "@native",
      "@http",
      "@account-clock-matrix",
      "@risk-authorization",
      "@risk-privacy",
    ],
  },
  async ({ causal: app, playwright }) => {
    const admin = await signInAdmin(app, playwright);
    try {
      const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
      const target = await makeTargetAndDepartment(app, suffix);
      const programId = randomUUID();
      await app.db
        .prepare(
          "insert into program (id,department_id,name,created_at) values (?,?,?,unixepoch())"
        )
        .bind(programId, target.scopeId, `已撤回聚會${suffix}`)
        .run();
      await app.db
        .prepare(
          "insert into program_leader_assignment (id,program_id,user_id,created_at) values (?,?,?,unixepoch())"
        )
        .bind(randomUUID(), programId, target.targetUserId)
        .run();
      const path = `/api/v2/roles/people/${target.targetUserId}`;
      const positive = await admin.context.get(path);
      expect(positive.status()).toBe(200);
      expect(await positive.text()).toContain(target.scopeId);
      await app.control.armRolePeopleRead("programs");
      const pending = admin.context.get(path);
      // eslint-disable-next-line promise/prefer-await-to-callbacks -- Observe rejection while the native assignment SELECT is held.
      const outcome = pending.then((response) => response.status(), String);
      try {
        await expect
          .poll(async () => {
            const current = await app.control.held();
            return current.held;
          })
          .toBe(true);
        await app.db
          .prepare(
            "delete from program_leader_assignment where program_id = ? and user_id = ?"
          )
          .bind(programId, target.targetUserId)
          .run();
        await app.control.release();
        const response = await pending;
        expect(response.status()).toBe(200);
        const body = await response.json();
        expect(body).toMatchObject({
          data: {
            person: {
              duties: { groups: [], hasNextPage: false, status: "complete" },
              identity: { userId: target.targetUserId },
            },
          },
        });
        expect(JSON.stringify(body)).not.toContain(target.scopeId);
        expect(JSON.stringify(body)).not.toContain(`已撤回聚會${suffix}`);
      } finally {
        await app.control.release();
        await outcome;
      }
    } finally {
      await app.control.release();
      await admin.context.dispose();
    }
  }
);
