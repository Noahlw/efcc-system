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
  const username = `pl.ca.${suffix}`;
  const password = "Synthetic-role-causal-admin!";
  const ip = randomBytes(2);
  const userId = await app.provision.account({
    email: `${suffix}@example.com`,
    fullName: `陳聚會因果管理員${suffix}`,
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
    { data: { operationKey: randomUUID(), password: admin.password } }
  );
  expect(confirmation.status()).toBe(201);
};

const signInDepartmentManager = async (
  app: CausalApp,
  playwright: Playwright,
  suffix: string,
  departmentId: string
) => {
  const username = `pl.dm.${suffix}`;
  const password = "Synthetic-role-causal-manager!";
  const ip = randomBytes(2);
  const userId = await app.provision.account({
    email: `${suffix}.manager@example.com`,
    fullName: `陳聚會因果部門負責人${suffix}`,
    membershipStatus: "active",
    password,
    role: "member",
    username,
  });
  const assignmentId = randomUUID();
  await app.db
    .prepare(
      "INSERT INTO department_manager_assignment (id, department_id, user_id, created_at) VALUES (?, ?, ?, unixepoch())"
    )
    .bind(assignmentId, departmentId, userId)
    .run();
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
  return { assignmentId, context, userId };
};

const signInRoleAssigner = async (
  app: CausalApp,
  playwright: Playwright,
  admin: Awaited<ReturnType<typeof signInAdmin>>,
  suffix: string
) => {
  const username = `pl.ra.${suffix}`;
  const password = "Synthetic-role-causal-assigner!";
  const userId = await app.provision.account({
    email: `${suffix}.assigner@example.com`,
    fullName: `陳聚會因果委派員${suffix}`,
    membershipStatus: "active",
    password,
    role: "staff",
    username,
  });
  const delegation = await admin.context.post("/api/v2/roles/role-assigners", {
    data: {
      action: "granted",
      operationKey: randomUUID(),
      targetUserId: userId,
    },
  });
  expect(await expectResponseStatus(delegation, 201)).toMatchObject({
    data: { receipt: { role: "role_assigner", targetUserId: userId } },
  });
  const assignment = await app.db
    .prepare("SELECT id FROM role_assigner_assignment WHERE user_id = ?")
    .bind(userId)
    .first<{ id: string }>();
  if (!assignment) {
    throw new Error("Public Role Assigner grant created no current row");
  }

  const ip = randomBytes(2);
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
  return { assignmentId: assignment.id, context, userId };
};

const makeTargetAndProgram = async (app: CausalApp, suffix: string) => {
  const targetUserId = await app.provision.account({
    email: `${suffix}@example.com`,
    fullName: `陳聚會因果目標${suffix}`,
    membershipStatus: "active",
    password: "Synthetic-role-causal-target!",
    role: "member",
    username: `pl.ct.${suffix}`,
  });
  const departmentId = randomUUID();
  const scopeId = randomUUID();
  await app.db
    .prepare(
      "INSERT INTO department (id, name, created_at) VALUES (?, ?, unixepoch())"
    )
    .bind(departmentId, `因果測試部門${suffix}`)
    .run();
  await app.db
    .prepare(
      "INSERT INTO program (id, department_id, name, created_at) VALUES (?, ?, ?, unixepoch())"
    )
    .bind(scopeId, departmentId, `因果測試聚會${suffix}`)
    .run();
  return { departmentId, scopeId, targetUserId };
};

/** Park only after the public command entered its actual production D1 batch. */
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
          message: "Program Leader command never reached the actual D1 batch",
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

const expectNoProgramLeaderWrites = async (
  app: CausalApp,
  actorUserId: string,
  targetUserId: string,
  operationKey: string
) => {
  const effects = await app.db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM program_leader_assignment WHERE user_id = ?) AS assignments,
        (SELECT COUNT(*) FROM role_assignment_history WHERE target_user_id = ? AND role = 'program_leader') AS history,
        (SELECT COUNT(*) FROM audit_event WHERE target_user_id = ? AND action IN ('program_leader_granted','program_leader_withdrawn')) AS audits,
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

test.describe("Program Leader public command causal checks", () => {
  test(
    "a current Role Assigner grants a Member a Program Leader assignment through the public command",
    {
      tag: [
        "@native",
        "@http",
        "@account-clock-matrix",
        "@risk-authorization",
        "@risk-atomicity",
        "@risk-history",
      ],
    },
    async ({ causal: app, playwright }) => {
      const admin = await signInAdmin(app, playwright);
      let roleAssigner:
        | Awaited<ReturnType<typeof signInRoleAssigner>>
        | undefined;
      try {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
        const target = await makeTargetAndProgram(app, suffix);
        const actor = await signInRoleAssigner(app, playwright, admin, suffix);
        roleAssigner = actor;
        const operationKey = randomUUID();
        const grant = await roleAssigner.context.post(
          "/api/v2/roles/program-leaders",
          {
            data: {
              action: "granted",
              authorityAssignmentId: roleAssigner.assignmentId,
              operationKey,
              scopeId: target.scopeId,
              targetUserId: target.targetUserId,
            },
          }
        );
        expect(await expectResponseStatus(grant, 201)).toMatchObject({
          data: {
            receipt: {
              action: "granted",
              scopeId: target.scopeId,
              targetUserId: target.targetUserId,
            },
          },
        });

        const effects = await app.db
          .prepare(
            `SELECT
              (SELECT COUNT(*) FROM program_leader_assignment WHERE user_id = ? AND program_id = ?) AS assignments,
              (SELECT COUNT(*) FROM role_assignment_history WHERE actor_user_id = ? AND target_user_id = ? AND role = 'program_leader' AND action = 'granted' AND scope_id = ?) AS history,
              (SELECT COUNT(*) FROM audit_event WHERE actor_user_id = ? AND target_user_id = ? AND action = 'program_leader_granted') AS audits,
              (SELECT COUNT(*) FROM role_change_operation WHERE actor_user_id = ? AND operation_key = ? AND target_user_id = ? AND role = 'program_leader' AND action = 'granted' AND scope_id = ?) AS receipts,
              (SELECT COUNT(*) FROM department_membership WHERE user_id = ?) AS department_memberships,
              (SELECT COUNT(*) FROM enrolment WHERE user_id = ?) AS enrolments`
          )
          .bind(
            target.targetUserId,
            target.scopeId,
            roleAssigner.userId,
            target.targetUserId,
            target.scopeId,
            roleAssigner.userId,
            target.targetUserId,
            roleAssigner.userId,
            operationKey,
            target.targetUserId,
            target.scopeId,
            target.targetUserId,
            target.targetUserId
          )
          .first<{
            assignments: number;
            audits: number;
            department_memberships: number;
            enrolments: number;
            history: number;
            receipts: number;
          }>();
        expect(effects).toEqual({
          assignments: 1,
          audits: 1,
          department_memberships: 0,
          enrolments: 0,
          history: 1,
          receipts: 1,
        });
      } finally {
        await roleAssigner?.context.dispose();
        await admin.context.dispose();
      }
    }
  );

  test(
    "a revoked and regranted Role Assigner cannot release its held Program Leader intent",
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
      let roleAssigner:
        | Awaited<ReturnType<typeof signInRoleAssigner>>
        | undefined;
      let releaseHeld: (() => Promise<APIResponse>) | undefined;
      try {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
        const actor = await signInRoleAssigner(app, playwright, admin, suffix);
        roleAssigner = actor;
        const target = await makeTargetAndProgram(app, suffix);
        const input = {
          action: "granted",
          authorityAssignmentId: roleAssigner.assignmentId,
          operationKey: randomUUID(),
          scopeId: target.scopeId,
          targetUserId: target.targetUserId,
        };
        releaseHeld = await park(app, () =>
          actor.context.post("/api/v2/roles/program-leaders", {
            data: input,
          })
        );

        await confirmAdmin(admin);
        const withdrawal = await admin.context.post(
          "/api/v2/roles/role-assigners",
          {
            data: {
              action: "withdrawn",
              expectedAssignmentId: roleAssigner.assignmentId,
              operationKey: randomUUID(),
              targetUserId: roleAssigner.userId,
            },
          }
        );
        expect(await expectResponseStatus(withdrawal, 201)).toMatchObject({
          data: { receipt: { action: "withdrawn" } },
        });

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
        expect(await expectResponseStatus(regrant, 201)).toMatchObject({
          data: { receipt: { action: "granted" } },
        });
        const currentAuthority = await app.db
          .prepare("SELECT id FROM role_assigner_assignment WHERE user_id = ?")
          .bind(roleAssigner.userId)
          .first<{ id: string }>();
        expect(currentAuthority).not.toBeNull();
        expect(currentAuthority?.id).not.toBe(roleAssigner.assignmentId);

        const release = releaseHeld;
        if (!release) {
          throw new Error(
            "Held Role Assigner Program Leader request is missing"
          );
        }
        releaseHeld = undefined;
        expect(await expectResponseStatus(await release(), 409)).toMatchObject({
          error: { code: "conflict" },
        });
        await expectNoProgramLeaderWrites(
          app,
          roleAssigner.userId,
          target.targetUserId,
          input.operationKey
        );

        const staleRetry = await roleAssigner.context.post(
          "/api/v2/roles/program-leaders",
          { data: input }
        );
        expect(await expectResponseStatus(staleRetry, 409)).toMatchObject({
          error: { code: "conflict" },
        });
        await expectNoProgramLeaderWrites(
          app,
          roleAssigner.userId,
          target.targetUserId,
          input.operationKey
        );
        const reconciliation = await roleAssigner.context.post(
          "/api/v2/roles/program-leaders/reconcile",
          { data: { operationKey: input.operationKey } }
        );
        expect(await expectResponseStatus(reconciliation, 200)).toMatchObject({
          data: { outcome: "unknown", receipt: null },
        });
      } finally {
        await releaseHeld?.().catch(() => null);
        await app.control.release();
        await roleAssigner?.context.dispose();
        await admin.context.dispose();
      }
    }
  );

  test(
    "an exact surviving Department Manager witness remains usable after Role Assigner withdrawal",
    {
      tag: [
        "@native",
        "@http",
        "@account-clock-matrix",
        "@risk-authorization",
        "@risk-atomicity",
        "@risk-history",
      ],
    },
    async ({ causal: app, playwright }) => {
      const admin = await signInAdmin(app, playwright);
      let roleAssigner:
        | Awaited<ReturnType<typeof signInRoleAssigner>>
        | undefined;
      let releaseHeld: (() => Promise<APIResponse>) | undefined;
      try {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
        const actor = await signInRoleAssigner(app, playwright, admin, suffix);
        roleAssigner = actor;
        const target = await makeTargetAndProgram(app, suffix);
        const managerGrant = await admin.context.post(
          "/api/v2/roles/department-managers",
          {
            data: {
              action: "granted",
              operationKey: randomUUID(),
              scopeId: target.departmentId,
              targetUserId: roleAssigner.userId,
            },
          }
        );
        expect(await expectResponseStatus(managerGrant, 201)).toMatchObject({
          data: {
            receipt: {
              action: "granted",
              scopeId: target.departmentId,
              targetUserId: roleAssigner.userId,
            },
          },
        });
        const managerAuthority = await app.db
          .prepare(
            "SELECT id FROM department_manager_assignment WHERE department_id = ? AND user_id = ?"
          )
          .bind(target.departmentId, roleAssigner.userId)
          .first<{ id: string }>();
        if (!managerAuthority) {
          throw new Error(
            "Public Admin grant created no Department Manager row"
          );
        }
        await app.db
          .prepare(
            "INSERT INTO department_membership (id, department_id, user_id, created_at) VALUES (?, ?, ?, unixepoch())"
          )
          .bind(randomUUID(), target.departmentId, target.targetUserId)
          .run();

        const input = {
          action: "granted",
          authorityAssignmentId: managerAuthority.id,
          operationKey: randomUUID(),
          scopeId: target.scopeId,
          targetUserId: target.targetUserId,
        };
        releaseHeld = await park(app, () =>
          actor.context.post("/api/v2/roles/program-leaders", {
            data: input,
          })
        );

        await confirmAdmin(admin);
        const roleAssignerWithdrawal = await admin.context.post(
          "/api/v2/roles/role-assigners",
          {
            data: {
              action: "withdrawn",
              expectedAssignmentId: roleAssigner.assignmentId,
              operationKey: randomUUID(),
              targetUserId: roleAssigner.userId,
            },
          }
        );
        expect(
          await expectResponseStatus(roleAssignerWithdrawal, 201)
        ).toMatchObject({ data: { receipt: { action: "withdrawn" } } });

        const release = releaseHeld;
        if (!release) {
          throw new Error(
            "Held Department Manager Program Leader request is missing"
          );
        }
        releaseHeld = undefined;
        expect(await expectResponseStatus(await release(), 201)).toMatchObject({
          data: {
            receipt: {
              action: "granted",
              scopeId: target.scopeId,
              targetUserId: target.targetUserId,
            },
          },
        });

        const scopeRead = await roleAssigner.context.get(
          "/api/v2/roles/program-leaders/departments?page=1"
        );
        expect(await expectResponseStatus(scopeRead, 200)).toMatchObject({
          data: {
            departments: [expect.objectContaining({ id: target.departmentId })],
          },
        });
        const currentDelegation = await app.db
          .prepare("SELECT id FROM role_assigner_assignment WHERE user_id = ?")
          .bind(roleAssigner.userId)
          .first();
        expect(currentDelegation).toBeNull();
        expect(
          await app.db
            .prepare(
              "SELECT id FROM department_manager_assignment WHERE id = ? AND user_id = ?"
            )
            .bind(managerAuthority.id, roleAssigner.userId)
            .first()
        ).toEqual({ id: managerAuthority.id });
        const effects = await app.db
          .prepare(
            `SELECT
              (SELECT COUNT(*) FROM program_leader_assignment WHERE user_id = ? AND program_id = ?) AS assignments,
              (SELECT COUNT(*) FROM role_assignment_history WHERE actor_user_id = ? AND target_user_id = ? AND role = 'program_leader' AND action = 'granted' AND scope_id = ?) AS history,
              (SELECT COUNT(*) FROM audit_event WHERE actor_user_id = ? AND target_user_id = ? AND action = 'program_leader_granted') AS audits,
              (SELECT COUNT(*) FROM role_change_operation WHERE actor_user_id = ? AND operation_key = ? AND target_user_id = ? AND role = 'program_leader') AS receipts,
              (SELECT COUNT(*) FROM department_membership WHERE user_id = ?) AS memberships`
          )
          .bind(
            target.targetUserId,
            target.scopeId,
            roleAssigner.userId,
            target.targetUserId,
            target.scopeId,
            roleAssigner.userId,
            target.targetUserId,
            roleAssigner.userId,
            input.operationKey,
            target.targetUserId,
            target.targetUserId
          )
          .first();
        expect(effects).toEqual({
          assignments: 1,
          audits: 1,
          history: 1,
          memberships: 1,
          receipts: 1,
        });
      } finally {
        await releaseHeld?.().catch(() => null);
        await app.control.release();
        await roleAssigner?.context.dispose();
        await admin.context.dispose();
      }
    }
  );

  test(
    "a revoked Role Assigner cannot reconcile its Program Leader receipt but retains Staff Audit",
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
      let roleAssigner:
        | Awaited<ReturnType<typeof signInRoleAssigner>>
        | undefined;
      try {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
        roleAssigner = await signInRoleAssigner(app, playwright, admin, suffix);
        const target = await makeTargetAndProgram(app, suffix);
        const operationKey = randomUUID();
        const grant = await roleAssigner.context.post(
          "/api/v2/roles/program-leaders",
          {
            data: {
              action: "granted",
              authorityAssignmentId: roleAssigner.assignmentId,
              operationKey,
              scopeId: target.scopeId,
              targetUserId: target.targetUserId,
            },
          }
        );
        expect(await expectResponseStatus(grant, 201)).toMatchObject({
          data: { receipt: { action: "granted" } },
        });
        const audit = await app.db
          .prepare(
            "SELECT id FROM audit_event WHERE actor_user_id = ? AND target_user_id = ? AND action = 'program_leader_granted'"
          )
          .bind(roleAssigner.userId, target.targetUserId)
          .first<{ id: string }>();
        if (!audit) {
          throw new Error("Committed Program Leader Audit row is missing");
        }

        await confirmAdmin(admin);
        const withdrawal = await admin.context.post(
          "/api/v2/roles/role-assigners",
          {
            data: {
              action: "withdrawn",
              expectedAssignmentId: roleAssigner.assignmentId,
              operationKey: randomUUID(),
              targetUserId: roleAssigner.userId,
            },
          }
        );
        expect(await expectResponseStatus(withdrawal, 201)).toMatchObject({
          data: { receipt: { action: "withdrawn" } },
        });

        const receiptRead = await roleAssigner.context.post(
          "/api/v2/roles/program-leaders/reconcile",
          { data: { operationKey } }
        );
        expect(await expectResponseStatus(receiptRead, 403)).toMatchObject({
          error: { code: "business_access_denied" },
        });
        const currentPrograms = await roleAssigner.context.get(
          "/api/v2/roles/program-leaders/programs?page=1"
        );
        expect(await expectResponseStatus(currentPrograms, 403)).toMatchObject({
          error: { code: "business_access_denied" },
        });
        const staffAudit = await roleAssigner.context.get(
          `/api/v2/staff/account-audit?record=${encodeURIComponent(audit.id)}`
        );
        expect(await expectResponseStatus(staffAudit, 200)).toMatchObject({
          data: {
            selectedEvent: {
              action: "program_leader_granted",
              actorUserId: roleAssigner.userId,
              id: audit.id,
              targetUserId: target.targetUserId,
            },
          },
        });
      } finally {
        await roleAssigner?.context.dispose();
        await admin.context.dispose();
      }
    }
  );

  test(
    "Department Manager reconciles only within the exact current Program authority",
    {
      tag: [
        "@native",
        "@http",
        "@account-clock-matrix",
        "@risk-authorization",
        "@risk-recovery",
      ],
    },
    async ({ causal: app, playwright }) => {
      const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
      const target = await makeTargetAndProgram(app, suffix);
      const manager = await signInDepartmentManager(
        app,
        playwright,
        suffix,
        target.departmentId
      );
      try {
        await app.db
          .prepare(
            "INSERT INTO department_membership (id, department_id, user_id, created_at) VALUES (?, ?, ?, unixepoch())"
          )
          .bind(randomUUID(), target.departmentId, target.targetUserId)
          .run();
        const operationKey = randomUUID();
        const grant = await manager.context.post(
          "/api/v2/roles/program-leaders",
          {
            data: {
              action: "granted",
              authorityAssignmentId: manager.assignmentId,
              operationKey,
              scopeId: target.scopeId,
              targetUserId: target.targetUserId,
            },
          }
        );
        expect(await expectResponseStatus(grant, 201)).toMatchObject({
          data: {
            receipt: {
              action: "granted",
              scopeId: target.scopeId,
              targetUserId: target.targetUserId,
            },
          },
        });

        const reconciliation = { operationKey };
        const committed = await manager.context.post(
          "/api/v2/roles/program-leaders/reconcile",
          { data: reconciliation }
        );
        expect(await expectResponseStatus(committed, 200)).toMatchObject({
          data: {
            outcome: "committed",
            receipt: {
              action: "granted",
              scopeId: target.scopeId,
              targetUserId: target.targetUserId,
            },
          },
        });

        const unknown = await manager.context.post(
          "/api/v2/roles/program-leaders/reconcile",
          {
            data: {
              ...reconciliation,
              operationKey: randomUUID(),
            },
          }
        );
        expect(await expectResponseStatus(unknown, 200)).toMatchObject({
          data: { outcome: "unknown", receipt: null },
        });

        const outsideDepartmentId = randomUUID();
        const replacementAssignmentId = randomUUID();
        await app.db
          .prepare(
            "INSERT INTO department (id, name, created_at) VALUES (?, ?, unixepoch())"
          )
          .bind(outsideDepartmentId, `未授權收據部門${suffix}`)
          .run();
        await app.db
          .prepare("DELETE FROM department_manager_assignment WHERE id = ?")
          .bind(manager.assignmentId)
          .run();
        await app.db
          .prepare(
            "INSERT INTO department_manager_assignment (id, department_id, user_id, created_at) VALUES (?, ?, ?, unixepoch())"
          )
          .bind(replacementAssignmentId, outsideDepartmentId, manager.userId)
          .run();
        const otherDepartmentReceipt = await manager.context.post(
          "/api/v2/roles/program-leaders/reconcile",
          { data: reconciliation }
        );
        expect(
          await expectResponseStatus(otherDepartmentReceipt, 403)
        ).toMatchObject({
          error: { code: "business_access_denied" },
        });

        await app.db
          .prepare(
            "DELETE FROM department_manager_assignment WHERE user_id = ?"
          )
          .bind(manager.userId)
          .run();
        await app.db
          .prepare(
            "INSERT INTO department_manager_assignment (id, department_id, user_id, created_at) VALUES (?, ?, ?, unixepoch())"
          )
          .bind(randomUUID(), target.departmentId, manager.userId)
          .run();
        const reacquiredAuthorityReceipt = await manager.context.post(
          "/api/v2/roles/program-leaders/reconcile",
          { data: reconciliation }
        );
        expect(
          await expectResponseStatus(reacquiredAuthorityReceipt, 200)
        ).toMatchObject({
          data: {
            outcome: "committed",
            receipt: {
              action: "granted",
              scopeId: target.scopeId,
              targetUserId: target.targetUserId,
            },
          },
        });
        await app.db
          .prepare(
            "UPDATE person_profile SET account_role = 'staff' WHERE user_id = ?"
          )
          .bind(target.targetUserId)
          .run();
        const ineligibleTargetReceipt = await manager.context.post(
          "/api/v2/roles/program-leaders/reconcile",
          { data: reconciliation }
        );
        expect(
          await expectResponseStatus(ineligibleTargetReceipt, 403)
        ).toMatchObject({
          error: { code: "business_access_denied" },
        });
        await app.db
          .prepare(
            "UPDATE person_profile SET account_role = 'member' WHERE user_id = ?"
          )
          .bind(target.targetUserId)
          .run();

        await app.db
          .prepare(
            "DELETE FROM department_manager_assignment WHERE user_id = ?"
          )
          .bind(manager.userId)
          .run();
        const formerManagerUnknown = await manager.context.post(
          "/api/v2/roles/program-leaders/reconcile",
          { data: { operationKey: randomUUID() } }
        );
        expect(
          await expectResponseStatus(formerManagerUnknown, 403)
        ).toMatchObject({
          error: { code: "business_access_denied" },
        });
      } finally {
        await manager.context.dispose();
      }
    }
  );

  test(
    "Department Manager proof and credential revision remain current at the Program Leader write boundary",
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
      const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
      const target = await makeTargetAndProgram(app, suffix);
      const manager = await signInDepartmentManager(
        app,
        playwright,
        suffix,
        target.departmentId
      );
      const sessionRow = await app.db
        .prepare(
          "SELECT id FROM session WHERE user_id = ? ORDER BY created_at DESC LIMIT 1"
        )
        .bind(manager.userId)
        .first<{ id: string }>();
      if (!sessionRow) {
        throw new Error("Member Department Manager session was not created");
      }
      try {
        await app.db
          .prepare(
            "INSERT INTO department_membership (id, department_id, user_id, created_at) VALUES (?, ?, ?, unixepoch())"
          )
          .bind(randomUUID(), target.departmentId, target.targetUserId)
          .run();
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
            "INSERT INTO account_security_operation (action, created_at, credential_revision, id, operation_key, request_hash, session_id, user_id) SELECT 'password_confirmed', password_confirmed_at, credential_revision, ?, ?, 'synthetic-dm-program-leader-proof', id, user_id FROM session WHERE id = ?"
          )
          .bind(proofId, proofKey, sessionRow.id)
          .run();

        const expiredProofInput = {
          action: "granted",
          authorityAssignmentId: manager.assignmentId,
          operationKey: randomUUID(),
          scopeId: target.scopeId,
          targetUserId: target.targetUserId,
        };
        const releaseExpiredProof = await park(app, () =>
          manager.context.post("/api/v2/roles/program-leaders", {
            data: expiredProofInput,
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
        const expiredProofResponse = await releaseExpiredProof();
        expect(
          await expectResponseStatus(expiredProofResponse, 403)
        ).toMatchObject({
          error: { code: "password_confirmation_required" },
        });
        await expectNoProgramLeaderWrites(
          app,
          manager.userId,
          target.targetUserId,
          expiredProofInput.operationKey
        );

        const confirmation = await manager.context.post(
          "/api/v2/account/password-confirmation",
          {
            data: {
              operationKey: randomUUID(),
              password: "Synthetic-role-causal-manager!",
            },
          }
        );
        expect(confirmation.status()).toBe(201);
        const changedCredentialInput = {
          ...expiredProofInput,
          operationKey: randomUUID(),
        };
        const releaseChangedCredential = await park(app, () =>
          manager.context.post("/api/v2/roles/program-leaders", {
            data: changedCredentialInput,
          })
        );
        await app.db
          .prepare(
            "UPDATE account SET credential_revision = credential_revision + 1 WHERE user_id = ?"
          )
          .bind(manager.userId)
          .run();
        expect(
          await expectResponseStatus(await releaseChangedCredential(), 401)
        ).toMatchObject({ error: { code: "unauthorized" } });
        await expectNoProgramLeaderWrites(
          app,
          manager.userId,
          target.targetUserId,
          changedCredentialInput.operationKey
        );
      } finally {
        await app.control.release();
        await manager.context.dispose();
      }
    }
  );

  test(
    "Department Manager reads current Program Leaders and bounded same-Department Member candidates",
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
      const target = await makeTargetAndProgram(app, suffix);
      const manager = await signInDepartmentManager(
        app,
        playwright,
        suffix,
        target.departmentId
      );
      const candidateUserId = await app.provision.account({
        email: `${suffix}.eligible@example.com`,
        fullName: `Eligible member ${suffix}`,
        membershipStatus: "active",
        password: "Synthetic-role-candidate!",
        role: "member",
        username: `pl.ec.${suffix}`,
      });
      const outsideUserId = await app.provision.account({
        email: `${suffix}.outside@example.com`,
        fullName: `Eligible outside ${suffix}`,
        membershipStatus: "active",
        password: "Synthetic-role-candidate!",
        role: "member",
        username: `pl.eo.${suffix}`,
      });
      const staffUserId = await app.provision.account({
        email: `${suffix}.protected@example.com`,
        fullName: `Protected staff ${suffix}`,
        membershipStatus: "active",
        password: "Synthetic-role-staff!",
        role: "staff",
        username: `pl.ps.${suffix}`,
      });
      const outsideDepartmentId = randomUUID();
      const departedAssignmentId = randomUUID();
      const staffAssignmentId = randomUUID();
      const selfAssignmentId = randomUUID();
      try {
        await app.db.batch([
          app.db
            .prepare(
              "INSERT INTO department (id, name, created_at) VALUES (?, ?, unixepoch())"
            )
            .bind(outsideDepartmentId, `候選測試外部部門${suffix}`),
          app.db
            .prepare(
              "INSERT INTO department_membership (id, department_id, user_id, created_at) VALUES (?, ?, ?, unixepoch())"
            )
            .bind(randomUUID(), target.departmentId, candidateUserId),
          app.db
            .prepare(
              "INSERT INTO department_membership (id, department_id, user_id, created_at) VALUES (?, ?, ?, unixepoch())"
            )
            .bind(randomUUID(), outsideDepartmentId, outsideUserId),
          app.db
            .prepare(
              "INSERT INTO program_leader_assignment (id, program_id, user_id, created_at) VALUES (?, ?, ?, unixepoch())"
            )
            .bind(departedAssignmentId, target.scopeId, target.targetUserId),
          app.db
            .prepare(
              "INSERT INTO program_leader_assignment (id, program_id, user_id, created_at) VALUES (?, ?, ?, unixepoch())"
            )
            .bind(staffAssignmentId, target.scopeId, staffUserId),
          app.db
            .prepare(
              "INSERT INTO program_leader_assignment (id, program_id, user_id, created_at) VALUES (?, ?, ?, unixepoch())"
            )
            .bind(selfAssignmentId, target.scopeId, manager.userId),
        ]);
        await app.db
          .prepare(
            "UPDATE person_profile SET membership_status = 'deactivated' WHERE user_id = ?"
          )
          .bind(target.targetUserId)
          .run();

        const rosterResponse = await manager.context.get(
          `/api/v2/roles/program-leaders/programs/${target.scopeId}/leaders?page=1`
        );
        const rosterBody = (await expectResponseStatus(
          rosterResponse,
          200
        )) as {
          data: {
            actorUserId: string;
            authorityAssignmentId: string;
            hasNextPage: boolean;
            leaders: {
              assignmentId: string;
              createdAt: number;
              eligibleForWithdrawal: boolean;
              fullName: string;
              userId: string;
              username: string | null;
            }[];
            page: number;
          };
        };
        expect(rosterBody).toMatchObject({
          data: {
            actorUserId: manager.userId,
            authorityAssignmentId: manager.assignmentId,
            hasNextPage: false,
            page: 1,
          },
        });
        expect(rosterBody.data.leaders).toHaveLength(3);
        expect(rosterBody.data.leaders).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              assignmentId: departedAssignmentId,
              eligibleForWithdrawal: true,
              userId: target.targetUserId,
            }),
            expect.objectContaining({
              assignmentId: staffAssignmentId,
              eligibleForWithdrawal: false,
              userId: staffUserId,
            }),
            expect.objectContaining({
              assignmentId: selfAssignmentId,
              eligibleForWithdrawal: false,
              userId: manager.userId,
            }),
          ])
        );
        for (const leader of rosterBody.data.leaders) {
          expect(Object.keys(leader).toSorted()).toEqual([
            "assignmentId",
            "createdAt",
            "eligibleForWithdrawal",
            "fullName",
            "userId",
            "username",
          ]);
        }

        const candidatesResponse = await manager.context.get(
          `/api/v2/roles/program-leaders/programs/${target.scopeId}/candidates?q=eligible&page=1`
        );
        const candidateBody = (await expectResponseStatus(
          candidatesResponse,
          200
        )) as {
          data: {
            actorUserId: string;
            authorityAssignmentId: string;
            candidates: {
              fullName: string;
              userId: string;
              username: string | null;
            }[];
            hasNextPage: false;
            page: 1;
          };
        };
        expect(candidateBody).toMatchObject({
          data: {
            actorUserId: manager.userId,
            authorityAssignmentId: manager.assignmentId,
            hasNextPage: false,
            page: 1,
          },
        });
        expect(candidateBody.data.candidates).toEqual([
          {
            fullName: `Eligible member ${suffix}`,
            userId: candidateUserId,
            username: `pl.ec.${suffix}`,
          },
        ]);

        await app.db
          .prepare("DELETE FROM department_manager_assignment WHERE id = ?")
          .bind(manager.assignmentId)
          .run();
        const formerManagerRoster = await manager.context.get(
          `/api/v2/roles/program-leaders/programs/${target.scopeId}/leaders?page=1`
        );
        expect(
          await expectResponseStatus(formerManagerRoster, 403)
        ).toMatchObject({ error: { code: "business_access_denied" } });
      } finally {
        await manager.context.dispose();
      }
    }
  );

  test(
    "Department Manager reads only managed Departments and their current Programs",
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
      const managed = await makeTargetAndProgram(app, suffix);
      const manager = await signInDepartmentManager(
        app,
        playwright,
        suffix,
        managed.departmentId
      );
      const outsideDepartmentId = randomUUID();
      const outsideProgramId = randomUUID();
      try {
        await app.db.batch([
          app.db
            .prepare(
              "INSERT INTO department (id, name, created_at) VALUES (?, ?, unixepoch())"
            )
            .bind(outsideDepartmentId, `未管理部門${suffix}`),
          app.db
            .prepare(
              "INSERT INTO program (id, department_id, name, created_at) VALUES (?, ?, ?, unixepoch())"
            )
            .bind(outsideProgramId, outsideDepartmentId, `未管理聚會${suffix}`),
        ]);

        const departmentsResponse = await manager.context.get(
          "/api/v2/roles/program-leaders/departments?page=1"
        );
        expect(
          await expectResponseStatus(departmentsResponse, 200)
        ).toMatchObject({
          data: {
            departments: [
              {
                assignmentId: manager.assignmentId,
                id: managed.departmentId,
                name: `因果測試部門${suffix}`,
              },
            ],
            hasNextPage: false,
            page: 1,
          },
        });

        const programsResponse = await manager.context.get(
          `/api/v2/roles/program-leaders/programs?departmentId=${managed.departmentId}&page=1`
        );
        expect(await expectResponseStatus(programsResponse, 200)).toMatchObject(
          {
            data: {
              hasNextPage: false,
              page: 1,
              programs: [
                {
                  departmentName: `因果測試部門${suffix}`,
                  id: managed.scopeId,
                  name: `因果測試聚會${suffix}`,
                },
              ],
            },
          }
        );

        const outsideProgramsResponse = await manager.context.get(
          `/api/v2/roles/program-leaders/programs?departmentId=${outsideDepartmentId}&page=1`
        );
        expect(
          await expectResponseStatus(outsideProgramsResponse, 403)
        ).toMatchObject({ error: { code: "business_access_denied" } });
      } finally {
        await manager.context.dispose();
      }
    }
  );

  test(
    "replacing current Department Manager authority before the write denies the held grant",
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
      const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
      const target = await makeTargetAndProgram(app, suffix);
      const manager = await signInDepartmentManager(
        app,
        playwright,
        suffix,
        target.departmentId
      );
      try {
        await app.db
          .prepare(
            "INSERT INTO department_membership (id, department_id, user_id, created_at) VALUES (?, ?, ?, unixepoch())"
          )
          .bind(randomUUID(), target.departmentId, target.targetUserId)
          .run();
        const input = {
          action: "granted",
          authorityAssignmentId: manager.assignmentId,
          operationKey: randomUUID(),
          scopeId: target.scopeId,
          targetUserId: target.targetUserId,
        };
        const release = await park(app, () =>
          manager.context.post("/api/v2/roles/program-leaders", {
            data: input,
          })
        );
        const replacementId = randomUUID();
        await app.db
          .prepare("DELETE FROM department_manager_assignment WHERE id = ?")
          .bind(manager.assignmentId)
          .run();
        await app.db
          .prepare(
            "INSERT INTO department_manager_assignment (id, department_id, user_id, created_at) VALUES (?, ?, ?, unixepoch())"
          )
          .bind(replacementId, target.departmentId, manager.userId)
          .run();

        const result = await release();
        const body = await expectResponseStatus(result, 409);
        expect(body).toMatchObject({ error: { code: "conflict" } });
        expect(
          await app.db
            .prepare(
              "SELECT id FROM department_manager_assignment WHERE department_id = ? AND user_id = ?"
            )
            .bind(target.departmentId, manager.userId)
            .first()
        ).toEqual({ id: replacementId });
        await expectNoProgramLeaderWrites(
          app,
          manager.userId,
          target.targetUserId,
          input.operationKey
        );
        const retry = await manager.context.post(
          "/api/v2/roles/program-leaders",
          { data: input }
        );
        expect(await expectResponseStatus(retry, 409)).toMatchObject({
          error: { code: "conflict" },
        });
        await expectNoProgramLeaderWrites(
          app,
          manager.userId,
          target.targetUserId,
          input.operationKey
        );
      } finally {
        await app.control.release();
        await manager.context.dispose();
      }
    }
  );

  test(
    "keeps the scoped grant authorized when an unrelated Department Manager assignment changes",
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
      const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
      const target = await makeTargetAndProgram(app, suffix);
      const manager = await signInDepartmentManager(
        app,
        playwright,
        suffix,
        target.departmentId
      );
      try {
        await app.db
          .prepare(
            "INSERT INTO department_membership (id, department_id, user_id, created_at) VALUES (?, ?, ?, unixepoch())"
          )
          .bind(randomUUID(), target.departmentId, target.targetUserId)
          .run();
        const unrelatedDepartmentId = randomUUID();
        const unrelatedAssignmentId = randomUUID();
        await app.db.batch([
          app.db
            .prepare(
              "INSERT INTO department (id, name, created_at) VALUES (?, ?, unixepoch())"
            )
            .bind(unrelatedDepartmentId, `另一因果部門${suffix}`),
          app.db
            .prepare(
              "INSERT INTO department_manager_assignment (id, department_id, user_id, created_at) VALUES (?, ?, ?, unixepoch())"
            )
            .bind(unrelatedAssignmentId, unrelatedDepartmentId, manager.userId),
        ]);
        const input = {
          action: "granted",
          authorityAssignmentId: manager.assignmentId,
          operationKey: randomUUID(),
          scopeId: target.scopeId,
          targetUserId: target.targetUserId,
        };
        const release = await park(app, () =>
          manager.context.post("/api/v2/roles/program-leaders", {
            data: input,
          })
        );
        const replacementId = randomUUID();
        await app.db
          .prepare("DELETE FROM department_manager_assignment WHERE id = ?")
          .bind(unrelatedAssignmentId)
          .run();
        await app.db
          .prepare(
            "INSERT INTO department_manager_assignment (id, department_id, user_id, created_at) VALUES (?, ?, ?, unixepoch())"
          )
          .bind(replacementId, unrelatedDepartmentId, manager.userId)
          .run();

        const result = await release();
        const body = await expectResponseStatus(result, 201);
        expect(body).toMatchObject({
          data: {
            receipt: {
              action: "granted",
              scopeId: target.scopeId,
              targetUserId: target.targetUserId,
            },
          },
        });
        expect(
          await app.db
            .prepare(
              "SELECT id FROM department_manager_assignment WHERE department_id = ? AND user_id = ?"
            )
            .bind(target.departmentId, manager.userId)
            .first()
        ).toEqual({ id: manager.assignmentId });
        expect(
          await app.db
            .prepare(
              "SELECT id FROM department_manager_assignment WHERE department_id = ? AND user_id = ?"
            )
            .bind(unrelatedDepartmentId, manager.userId)
            .first()
        ).toEqual({ id: replacementId });
        const effects = await app.db
          .prepare(
            `SELECT
              (SELECT COUNT(*) FROM program_leader_assignment WHERE user_id = ? AND program_id = ?) AS assignments,
              (SELECT COUNT(*) FROM role_assignment_history WHERE target_user_id = ? AND role = 'program_leader' AND scope_id = ? AND action = 'granted') AS history,
              (SELECT COUNT(*) FROM audit_event WHERE target_user_id = ? AND action = 'program_leader_granted') AS audits,
              (SELECT COUNT(*) FROM role_change_operation WHERE actor_user_id = ? AND operation_key = ? AND role = 'program_leader') AS receipts`
          )
          .bind(
            target.targetUserId,
            target.scopeId,
            target.targetUserId,
            target.scopeId,
            target.targetUserId,
            manager.userId,
            input.operationKey
          )
          .first();
        expect(effects).toEqual({
          assignments: 1,
          audits: 1,
          history: 1,
          receipts: 1,
        });
      } finally {
        await app.control.release();
        await manager.context.dispose();
      }
    }
  );

  test(
    "Department Manager grant rechecks Member eligibility at the held Program Leader write boundary",
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
      const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
      const target = await makeTargetAndProgram(app, suffix);
      const manager = await signInDepartmentManager(
        app,
        playwright,
        suffix,
        target.departmentId
      );
      const input = {
        action: "granted",
        authorityAssignmentId: manager.assignmentId,
        operationKey: randomUUID(),
        scopeId: target.scopeId,
        targetUserId: target.targetUserId,
      };
      try {
        await app.db
          .prepare(
            "INSERT INTO department_membership (id, department_id, user_id, created_at) VALUES (?, ?, ?, unixepoch())"
          )
          .bind(randomUUID(), target.departmentId, target.targetUserId)
          .run();
        const release = await park(app, () =>
          manager.context.post("/api/v2/roles/program-leaders", {
            data: input,
          })
        );
        await app.db
          .prepare(
            "UPDATE person_profile SET account_role = 'staff' WHERE user_id = ?"
          )
          .bind(target.targetUserId)
          .run();
        expect(
          await app.db
            .prepare(
              "SELECT account_role FROM person_profile WHERE user_id = ?"
            )
            .bind(target.targetUserId)
            .first()
        ).toEqual({ account_role: "staff" });

        expect(await expectResponseStatus(await release(), 409)).toMatchObject({
          error: { code: "conflict" },
        });
        await expectNoProgramLeaderWrites(
          app,
          manager.userId,
          target.targetUserId,
          input.operationKey
        );
      } finally {
        await app.control.release();
        await manager.context.dispose();
      }
    }
  );

  test(
    "Department Manager grant rechecks current Program ownership at the held write boundary",
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
      const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
      const target = await makeTargetAndProgram(app, suffix);
      const manager = await signInDepartmentManager(
        app,
        playwright,
        suffix,
        target.departmentId
      );
      const newDepartmentId = randomUUID();
      const input = {
        action: "granted",
        authorityAssignmentId: manager.assignmentId,
        operationKey: randomUUID(),
        scopeId: target.scopeId,
        targetUserId: target.targetUserId,
      };
      try {
        await app.db.batch([
          app.db
            .prepare(
              "INSERT INTO department (id, name, created_at) VALUES (?, ?, unixepoch())"
            )
            .bind(newDepartmentId, `新擁有部門${suffix}`),
          app.db
            .prepare(
              "INSERT INTO department_membership (id, department_id, user_id, created_at) VALUES (?, ?, ?, unixepoch())"
            )
            .bind(randomUUID(), target.departmentId, target.targetUserId),
        ]);
        const release = await park(app, () =>
          manager.context.post("/api/v2/roles/program-leaders", {
            data: input,
          })
        );
        await app.db.batch([
          app.db
            .prepare("UPDATE program SET department_id = ? WHERE id = ?")
            .bind(newDepartmentId, target.scopeId),
          app.db
            .prepare(
              "DELETE FROM department_membership WHERE department_id = ? AND user_id = ?"
            )
            .bind(target.departmentId, target.targetUserId),
          app.db
            .prepare(
              "INSERT INTO department_membership (id, department_id, user_id, created_at) VALUES (?, ?, ?, unixepoch())"
            )
            .bind(randomUUID(), newDepartmentId, target.targetUserId),
        ]);

        expect(await expectResponseStatus(await release(), 403)).toMatchObject({
          error: { code: "business_access_denied" },
        });
        await expectNoProgramLeaderWrites(
          app,
          manager.userId,
          target.targetUserId,
          input.operationKey
        );
      } finally {
        await app.control.release();
        await manager.context.dispose();
      }
    }
  );

  test(
    "Department Manager may withdraw only another current Member's Program Leader assignment",
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
      const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
      const target = await makeTargetAndProgram(app, suffix);
      const manager = await signInDepartmentManager(
        app,
        playwright,
        suffix,
        target.departmentId
      );
      try {
        const staffUserId = await app.provision.account({
          email: `${suffix}.staff@example.com`,
          fullName: `陳因果職員PL${suffix}`,
          membershipStatus: "active",
          password: "Synthetic-role-causal-staff!",
          role: "staff",
          username: `pl.st.${suffix}`,
        });
        const adminUserId = await app.provision.account({
          email: `${suffix}.admin@example.com`,
          fullName: `陳因果管理員PL${suffix}`,
          membershipStatus: "active",
          password: "Synthetic-role-causal-admin!",
          role: "admin",
          username: `pl.ad.${suffix}`,
        });
        await app.db
          .prepare(
            "UPDATE person_profile SET membership_status = 'deactivated' WHERE user_id = ?"
          )
          .bind(target.targetUserId)
          .run();

        const staffAssignment = { id: randomUUID(), userId: staffUserId };
        const adminAssignment = { id: randomUUID(), userId: adminUserId };
        const selfAssignment = { id: randomUUID(), userId: manager.userId };
        const departedMemberAssignment = {
          id: randomUUID(),
          userId: target.targetUserId,
        };
        const assignments = [
          staffAssignment,
          adminAssignment,
          selfAssignment,
          departedMemberAssignment,
        ];
        await app.db.batch(
          assignments.map(({ id, userId }) =>
            app.db
              .prepare(
                "INSERT INTO program_leader_assignment (id, program_id, user_id, created_at) VALUES (?, ?, ?, unixepoch())"
              )
              .bind(id, target.scopeId, userId)
          )
        );
        const attempts = [
          { assignment: staffAssignment, expectedStatus: 409 },
          { assignment: adminAssignment, expectedStatus: 409 },
          { assignment: selfAssignment, expectedStatus: 409 },
          { assignment: departedMemberAssignment, expectedStatus: 201 },
        ];
        const outcomes = await Promise.all(
          attempts.map(async (attempt) => {
            const operationKey = randomUUID();
            const targetUserId = attempt.assignment.userId;
            const response = await manager.context.post(
              "/api/v2/roles/program-leaders",
              {
                data: {
                  action: "withdrawn",
                  authorityAssignmentId: manager.assignmentId,
                  expectedAssignmentId: attempt.assignment.id,
                  operationKey,
                  scopeId: target.scopeId,
                  targetUserId,
                },
              }
            );
            return {
              assignment: attempt.assignment,
              body: await response.json(),
              operationKey,
              status: response.status(),
              targetUserId,
            };
          })
        );
        expect(outcomes.map(({ status }) => status)).toEqual(
          attempts.map(({ expectedStatus }) => expectedStatus)
        );
        await Promise.all(
          outcomes.slice(0, 3).map(async (outcome) => {
            expect(outcome.body).toMatchObject({
              error: { code: "conflict" },
            });
            expect(
              await app.db
                .prepare(
                  "SELECT id FROM program_leader_assignment WHERE id = ? AND user_id = ? AND program_id = ?"
                )
                .bind(
                  outcome.assignment.id,
                  outcome.targetUserId,
                  target.scopeId
                )
                .first()
            ).toEqual({ id: outcome.assignment.id });
            const effects = await app.db
              .prepare(
                `SELECT
                (SELECT COUNT(*) FROM role_assignment_history WHERE target_user_id = ? AND role = 'program_leader' AND action = 'withdrawn') AS history,
                (SELECT COUNT(*) FROM audit_event WHERE target_user_id = ? AND action = 'program_leader_withdrawn') AS audits,
                (SELECT COUNT(*) FROM role_change_operation WHERE actor_user_id = ? AND operation_key = ?) AS receipts`
              )
              .bind(
                outcome.targetUserId,
                outcome.targetUserId,
                manager.userId,
                outcome.operationKey
              )
              .first();
            expect(effects).toEqual({ audits: 0, history: 0, receipts: 0 });
          })
        );
        expect(outcomes[3]?.body).toMatchObject({
          data: {
            receipt: {
              action: "withdrawn",
              scopeId: target.scopeId,
              targetUserId: target.targetUserId,
            },
          },
        });
        expect(
          await app.db
            .prepare(
              "SELECT id FROM program_leader_assignment WHERE user_id = ? AND program_id = ?"
            )
            .bind(target.targetUserId, target.scopeId)
            .first()
        ).toBeNull();

        const departedMember = outcomes.at(-1);
        if (!departedMember) {
          throw new Error("The departed Member withdrawal outcome is missing");
        }
        await app.db
          .prepare(
            "UPDATE person_profile SET account_role = 'staff' WHERE user_id = ?"
          )
          .bind(departedMember.targetUserId)
          .run();
        const staleReceipt = await manager.context.post(
          "/api/v2/roles/program-leaders",
          {
            data: {
              action: "withdrawn",
              authorityAssignmentId: manager.assignmentId,
              expectedAssignmentId: departedMember.assignment.id,
              operationKey: departedMember.operationKey,
              scopeId: target.scopeId,
              targetUserId: departedMember.targetUserId,
            },
          }
        );
        expect(staleReceipt.status()).toBe(403);
        expect(await staleReceipt.json()).toMatchObject({
          error: { code: "business_access_denied" },
        });
        expect(
          await app.db
            .prepare(
              `SELECT
                (SELECT COUNT(*) FROM role_assignment_history WHERE target_user_id = ? AND role = 'program_leader' AND action = 'withdrawn') AS history,
                (SELECT COUNT(*) FROM audit_event WHERE target_user_id = ? AND action = 'program_leader_withdrawn') AS audits,
                (SELECT COUNT(*) FROM role_change_operation WHERE actor_user_id = ? AND operation_key = ?) AS receipts`
            )
            .bind(
              departedMember.targetUserId,
              departedMember.targetUserId,
              manager.userId,
              departedMember.operationKey
            )
            .first()
        ).toEqual({ audits: 1, history: 1, receipts: 1 });
      } finally {
        await app.control.release();
        await manager.context.dispose();
      }
    }
  );

  test(
    "does not withdraw a Member promoted to Staff before the held batch commits",
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
      const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
      const target = await makeTargetAndProgram(app, suffix);
      const manager = await signInDepartmentManager(
        app,
        playwright,
        suffix,
        target.departmentId
      );
      const assignmentId = randomUUID();
      const input = {
        action: "withdrawn",
        authorityAssignmentId: manager.assignmentId,
        expectedAssignmentId: assignmentId,
        operationKey: randomUUID(),
        scopeId: target.scopeId,
        targetUserId: target.targetUserId,
      };
      try {
        await app.db
          .prepare(
            "INSERT INTO program_leader_assignment (id, program_id, user_id, created_at) VALUES (?, ?, ?, unixepoch())"
          )
          .bind(assignmentId, target.scopeId, target.targetUserId)
          .run();
        const release = await park(app, () =>
          manager.context.post("/api/v2/roles/program-leaders", {
            data: input,
          })
        );
        await app.db
          .prepare(
            "UPDATE person_profile SET account_role = 'staff' WHERE user_id = ?"
          )
          .bind(target.targetUserId)
          .run();

        const response = await release();
        expect(await expectResponseStatus(response, 409)).toMatchObject({
          error: { code: "conflict" },
        });
        expect(
          await app.db
            .prepare(
              "SELECT id FROM program_leader_assignment WHERE id = ? AND program_id = ? AND user_id = ?"
            )
            .bind(assignmentId, target.scopeId, target.targetUserId)
            .first()
        ).toEqual({ id: assignmentId });
        expect(
          await app.db
            .prepare(
              `SELECT
                (SELECT COUNT(*) FROM role_assignment_history WHERE target_user_id = ? AND role = 'program_leader' AND action = 'withdrawn') AS history,
                (SELECT COUNT(*) FROM audit_event WHERE target_user_id = ? AND action = 'program_leader_withdrawn') AS audits,
                (SELECT COUNT(*) FROM role_change_operation WHERE actor_user_id = ? AND operation_key = ?) AS receipts`
            )
            .bind(
              target.targetUserId,
              target.targetUserId,
              manager.userId,
              input.operationKey
            )
            .first()
        ).toEqual({ audits: 0, history: 0, receipts: 0 });
      } finally {
        await app.control.release();
        await manager.context.dispose();
      }
    }
  );

  test(
    "stale withdrawal cannot remove a replacement assignment",
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
        const target = await makeTargetAndProgram(app, suffix);
        const grant = await admin.context.post(
          "/api/v2/roles/program-leaders",
          {
            data: {
              action: "granted",
              operationKey: randomUUID(),
              scopeId: target.scopeId,
              targetUserId: target.targetUserId,
            },
          }
        );
        await expectResponseStatus(grant, 201);
        const oldAssignment = await app.db
          .prepare(
            "SELECT id FROM program_leader_assignment WHERE user_id = ? AND program_id = ?"
          )
          .bind(target.targetUserId, target.scopeId)
          .first<{ id: string }>();
        if (!oldAssignment) {
          throw new Error("Program Leader grant did not create an assignment");
        }
        const input = {
          action: "withdrawn",
          expectedAssignmentId: oldAssignment.id,
          operationKey: randomUUID(),
          scopeId: target.scopeId,
          targetUserId: target.targetUserId,
        };
        const release = await park(app, () =>
          admin.context.post("/api/v2/roles/program-leaders", { data: input })
        );
        await app.db
          .prepare("DELETE FROM program_leader_assignment WHERE id = ?")
          .bind(oldAssignment.id)
          .run();
        const replacementId = randomUUID();
        await app.db
          .prepare(
            "INSERT INTO program_leader_assignment(id,program_id,user_id,created_at) VALUES(?,?,?,unixepoch())"
          )
          .bind(replacementId, target.scopeId, target.targetUserId)
          .run();

        const result = await release();
        const body = await expectResponseStatus(result, 409);
        expect(body).toMatchObject({ error: { code: "conflict" } });
        expect(
          await app.db
            .prepare(
              "SELECT id FROM program_leader_assignment WHERE user_id = ? AND program_id = ?"
            )
            .bind(target.targetUserId, target.scopeId)
            .first()
        ).toEqual({ id: replacementId });
        const withdrawalEffects = await app.db
          .prepare(
            "SELECT COUNT(*) AS count FROM role_assignment_history WHERE target_user_id = ? AND role = 'program_leader' AND action = 'withdrawn'"
          )
          .bind(target.targetUserId)
          .first<{ count: number }>();
        expect(withdrawalEffects?.count).toBe(0);
        const reconciliation = await admin.context.post(
          "/api/v2/roles/program-leaders/reconcile",
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
    "required-write failure rolls back assignment, retained history, audit and receipt",
    {
      tag: [
        "@native",
        "@http",
        "@account-clock-matrix",
        "@risk-atomicity",
        "@risk-recovery",
      ],
    },
    async ({ causal: app, playwright }) => {
      const admin = await signInAdmin(app, playwright);
      try {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
        const target = await makeTargetAndProgram(app, suffix);
        await app.db.exec(
          "CREATE TRIGGER fail_program_leader_audit BEFORE INSERT ON audit_event WHEN NEW.action='program_leader_granted' BEGIN SELECT RAISE(ABORT, 'synthetic role audit failure'); END;"
        );
        const input = {
          action: "granted",
          operationKey: randomUUID(),
          scopeId: target.scopeId,
          targetUserId: target.targetUserId,
        };
        try {
          const result = await admin.context.post(
            "/api/v2/roles/program-leaders",
            { data: input }
          );
          await expectResponseStatus(result, 500);
        } finally {
          await app.db.exec("DROP TRIGGER fail_program_leader_audit");
        }
        await expectNoProgramLeaderWrites(
          app,
          admin.userId,
          target.targetUserId,
          input.operationKey
        );
        const reconciliation = await admin.context.post(
          "/api/v2/roles/program-leaders/reconcile",
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
});
