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
  return { context, userId };
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
});
