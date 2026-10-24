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
  return { context, userId };
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
  return { scopeId, targetUserId };
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
