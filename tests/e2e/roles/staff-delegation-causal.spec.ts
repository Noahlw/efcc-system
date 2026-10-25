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
  const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
  const username = `gs.${suffix}`;
  const password = "Synthetic-global-staff-causal-admin!";
  const ip = randomBytes(2);
  const userId = await app.provision.account({
    email: `${suffix}@example.com`,
    fullName: `陳全域因果管理員${suffix}`,
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
  await expectResponseStatus(login, 200);
  const confirmation = await context.post(
    "/api/v2/account/password-confirmation",
    { data: { operationKey: randomUUID(), password } }
  );
  await expectResponseStatus(confirmation, 201);
  return { context, password, userId, username };
};

const loginExistingAdmin = async (
  app: CausalApp,
  playwright: Playwright,
  admin: Awaited<ReturnType<typeof signInAdmin>>
) => {
  const context = await playwright.request.newContext({
    baseURL: app.origin,
    extraHTTPHeaders: { origin: app.origin },
  });
  const login = await context.post("/api/auth/sign-in/username", {
    data: { password: admin.password, username: admin.username },
  });
  await expectResponseStatus(login, 200);
  return context;
};

const makeMember = (app: CausalApp, suffix: string) =>
  app.provision.account({
    email: `${suffix}@example.com`,
    fullName: `陳全域目標${suffix}`,
    membershipStatus: "active",
    password: "Synthetic-global-staff-causal-target!",
    role: "member",
    username: `gm.${suffix}`,
  });

const makeStaff = (app: CausalApp, suffix: string) =>
  app.provision.account({
    email: `${suffix}@example.com`,
    fullName: `陳全域職員目標${suffix}`,
    membershipStatus: "active",
    password: "Synthetic-role-assigner-causal-target!",
    role: "staff",
    username: `gs.${suffix}`,
  });

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
          const state = await app.control.held();
          return state.held;
        },
        {
          message: "Global Staff command never reached the actual D1 batch",
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
    const state = await app.control.held();
    expect(state.held).toBe(false);
    return response;
  };
};

const expectNoGlobalRoleWrites = async (
  app: CausalApp,
  actorUserId: string,
  targetUserId: string,
  operationKey: string
) => {
  const effects = await app.db
    .prepare(
      `SELECT
        (SELECT account_role FROM person_profile WHERE user_id = ?) AS role,
        (SELECT COUNT(*) FROM role_assigner_assignment WHERE user_id = ?) AS delegations,
        (SELECT COUNT(*) FROM role_assignment_history WHERE target_user_id = ? AND role = 'staff') AS history,
        (SELECT COUNT(*) FROM audit_event WHERE target_user_id = ? AND action = 'global_role_changed') AS audits,
        (SELECT COUNT(*) FROM role_change_operation WHERE actor_user_id = ? AND operation_key = ?) AS receipts`
    )
    .bind(
      targetUserId,
      targetUserId,
      targetUserId,
      targetUserId,
      actorUserId,
      operationKey
    )
    .first<{
      audits: number;
      delegations: number;
      history: number;
      receipts: number;
      role: string;
    }>();
  expect(effects).toEqual({
    audits: 0,
    delegations: 0,
    history: 0,
    receipts: 0,
    role: "member",
  });
};

const expectUnknownGlobalRole = async (
  context: Awaited<ReturnType<typeof loginExistingAdmin>>,
  operationKey: string
) => {
  const reconciliation = await context.post(
    "/api/v2/roles/global-roles/reconcile",
    { data: { operationKey } }
  );
  expect(await expectResponseStatus(reconciliation, 200)).toMatchObject({
    data: { outcome: "unknown", receipt: null },
  });
};

const expectNoRoleAssignerWrites = async (
  app: CausalApp,
  actorUserId: string,
  targetUserId: string,
  operationKey: string,
  expectedRole: string
) => {
  const effects = await app.db
    .prepare(
      `SELECT
        (SELECT account_role FROM person_profile WHERE user_id = ?) AS role,
        (SELECT COUNT(*) FROM role_assigner_assignment WHERE user_id = ?) AS assignments,
        (SELECT COUNT(*) FROM role_assignment_history WHERE target_user_id = ? AND role = 'role_assigner') AS history,
        (SELECT COUNT(*) FROM audit_event WHERE target_user_id = ? AND action IN ('role_assigner_granted','role_assigner_withdrawn')) AS audits,
        (SELECT COUNT(*) FROM role_change_operation WHERE actor_user_id = ? AND operation_key = ?) AS receipts`
    )
    .bind(
      targetUserId,
      targetUserId,
      targetUserId,
      targetUserId,
      actorUserId,
      operationKey
    )
    .first<{
      assignments: number;
      audits: number;
      history: number;
      receipts: number;
      role: string;
    }>();
  expect(effects).toEqual({
    assignments: 0,
    audits: 0,
    history: 0,
    receipts: 0,
    role: expectedRole,
  });
};

const expireAdminProof = async (app: CausalApp, adminUserId: string) => {
  const session = await app.db
    .prepare(
      "SELECT id FROM session WHERE user_id = ? ORDER BY created_at DESC LIMIT 1"
    )
    .bind(adminUserId)
    .first<{ id: string }>();
  if (!session) {
    throw new Error("Admin session was not created by public login");
  }
  const proofId = randomUUID();
  const proofKey = randomUUID();
  await app.db
    .prepare(
      "UPDATE session SET confirmation_operation_id = ?, password_confirmed_at = unixepoch() - 594 WHERE id = ?"
    )
    .bind(proofId, session.id)
    .run();
  await app.db
    .prepare(
      "INSERT INTO audit_event (id, action, actor_user_id, target_user_id, created_at) SELECT ?, 'password_confirmed', user_id, user_id, password_confirmed_at FROM session WHERE id = ?"
    )
    .bind(proofId, session.id)
    .run();
  await app.db
    .prepare(
      "INSERT INTO account_security_operation (action, created_at, credential_revision, id, operation_key, request_hash, session_id, user_id) SELECT 'password_confirmed', password_confirmed_at, credential_revision, ?, ?, 'synthetic-global-staff-deadline-proof', id, user_id FROM session WHERE id = ?"
    )
    .bind(proofId, proofKey, session.id)
    .run();
  return session.id;
};

test.describe("Staff delegation public command causal checks", () => {
  test(
    "a held Role Assigner grant rechecks that its target remains eligible Staff",
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
        const targetSuffix = randomUUID().replaceAll("-", "").slice(0, 8);
        const targetUserId = await makeStaff(app, targetSuffix);
        const input = {
          action: "granted",
          operationKey: randomUUID(),
          targetUserId,
        };
        const release = await park(app, () =>
          admin.context.post("/api/v2/roles/role-assigners", { data: input })
        );
        await app.db
          .prepare(
            "UPDATE person_profile SET account_role = 'member' WHERE user_id = ?"
          )
          .bind(targetUserId)
          .run();

        const response = await release();
        expect(await expectResponseStatus(response, 409)).toMatchObject({
          error: { code: "conflict" },
        });
        await expectNoRoleAssignerWrites(
          app,
          admin.userId,
          targetUserId,
          input.operationKey,
          "member"
        );
        const reconciliation = await admin.context.post(
          "/api/v2/roles/role-assigners/reconcile",
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
    "a held Staff promotion rechecks that its target is still an eligible Member",
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
        const targetUserId = await makeMember(
          app,
          randomUUID().replaceAll("-", "").slice(0, 8)
        );
        const input = {
          action: "granted",
          operationKey: randomUUID(),
          role: "staff",
          targetUserId,
        };
        const release = await park(app, () =>
          admin.context.post("/api/v2/roles/global-roles", { data: input })
        );
        await app.db
          .prepare(
            "UPDATE person_profile SET membership_status = 'deactivated' WHERE user_id = ?"
          )
          .bind(targetUserId)
          .run();

        const response = await release();
        expect(await expectResponseStatus(response, 409)).toMatchObject({
          error: { code: "conflict" },
        });
        await expectNoGlobalRoleWrites(
          app,
          admin.userId,
          targetUserId,
          input.operationKey
        );
        await expectUnknownGlobalRole(admin.context, input.operationKey);
      } finally {
        await app.control.release();
        await admin.context.dispose();
      }
    }
  );

  test(
    "a held Staff promotion rechecks the ten-minute Admin password proof",
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
        const targetUserId = await makeMember(
          app,
          randomUUID().replaceAll("-", "").slice(0, 8)
        );
        const sessionId = await expireAdminProof(app, admin.userId);
        const input = {
          action: "granted",
          operationKey: randomUUID(),
          role: "staff",
          targetUserId,
        };
        const release = await park(app, () =>
          admin.context.post("/api/v2/roles/global-roles", { data: input })
        );
        await expect
          .poll(
            async () => {
              const row = await app.db
                .prepare(
                  "SELECT (CAST(strftime('%s','now') AS INTEGER) - password_confirmed_at < 600) AS open FROM session WHERE id = ?"
                )
                .bind(sessionId)
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

        const response = await release();
        expect(await expectResponseStatus(response, 403)).toMatchObject({
          error: { code: "password_confirmation_required" },
        });
        await expectNoGlobalRoleWrites(
          app,
          admin.userId,
          targetUserId,
          input.operationKey
        );
        await expectUnknownGlobalRole(admin.context, input.operationKey);
      } finally {
        await app.control.release();
        await admin.context.dispose();
      }
    }
  );

  test(
    "a held Staff promotion cannot commit against a changed Admin credential revision",
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
      let currentAdminContext:
        | Awaited<ReturnType<typeof playwright.request.newContext>>
        | undefined;
      try {
        const targetUserId = await makeMember(
          app,
          randomUUID().replaceAll("-", "").slice(0, 8)
        );
        const input = {
          action: "granted",
          operationKey: randomUUID(),
          role: "staff",
          targetUserId,
        };
        const release = await park(app, () =>
          admin.context.post("/api/v2/roles/global-roles", { data: input })
        );
        await app.db
          .prepare(
            "UPDATE account SET credential_revision = credential_revision + 1 WHERE user_id = ?"
          )
          .bind(admin.userId)
          .run();

        const response = await release();
        expect(await expectResponseStatus(response, 401)).toMatchObject({
          error: { code: "unauthorized" },
        });
        await expectNoGlobalRoleWrites(
          app,
          admin.userId,
          targetUserId,
          input.operationKey
        );

        currentAdminContext = await loginExistingAdmin(app, playwright, admin);
        await expectUnknownGlobalRole(currentAdminContext, input.operationKey);
      } finally {
        await app.control.release();
        await currentAdminContext?.dispose();
        await admin.context.dispose();
      }
    }
  );

  test(
    "a held Staff promotion rechecks the Admin Session at the D1 write",
    {
      tag: [
        "@native",
        "@http",
        "@account-clock-matrix",
        "@risk-authorization",
        "@risk-atomicity",
        "@risk-deadline",
        "@risk-session",
      ],
    },
    async ({ causal: app, playwright }) => {
      const admin = await signInAdmin(app, playwright);
      let currentAdminContext:
        | Awaited<ReturnType<typeof playwright.request.newContext>>
        | undefined;
      try {
        const targetUserId = await makeMember(
          app,
          randomUUID().replaceAll("-", "").slice(0, 8)
        );
        const before = await app.db
          .prepare(
            `SELECT
              s.id AS sessionId,
              s.expires_at AS expiresAt,
              s.credential_revision AS sessionRevision,
              s.confirmation_operation_id AS confirmationId,
              s.password_confirmed_at AS confirmedAt,
              a.credential_revision AS accountRevision,
              a.temporary_password_expires_at AS temporaryExpiresAt
            FROM session s
            INNER JOIN account a ON a.user_id = s.user_id
              AND a.account_id = s.user_id
              AND a.provider_id = 'credential'
            WHERE s.user_id = ?
            ORDER BY s.created_at DESC
            LIMIT 1`
          )
          .bind(admin.userId)
          .first<{
            accountRevision: number;
            confirmedAt: number;
            confirmationId: string;
            expiresAt: number;
            sessionId: string;
            sessionRevision: number;
            temporaryExpiresAt: number | null;
          }>();
        if (!before) {
          throw new Error("Admin public login did not create a Session");
        }
        expect(before.confirmationId).toBeTruthy();
        expect(before.temporaryExpiresAt).toBeNull();
        expect(before.sessionRevision).toBe(before.accountRevision);
        expect(before.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
        const proof = await app.db
          .prepare(
            "SELECT id FROM account_security_operation WHERE id = ? AND user_id = ? AND session_id = ? AND action = 'password_confirmed' AND credential_revision = ?"
          )
          .bind(
            before.confirmationId,
            admin.userId,
            before.sessionId,
            before.sessionRevision
          )
          .first<{ id: string }>();
        expect(proof).toEqual({ id: before.confirmationId });

        const input = {
          action: "granted",
          operationKey: randomUUID(),
          role: "staff",
          targetUserId,
        };
        const release = await park(app, () =>
          admin.context.post("/api/v2/roles/global-roles", { data: input })
        );
        await app.db
          .prepare(
            "UPDATE session SET expires_at = unixepoch() - 1 WHERE id = ?"
          )
          .bind(before.sessionId)
          .run();

        const after = await app.db
          .prepare(
            `SELECT
              s.expires_at AS expiresAt,
              s.credential_revision AS sessionRevision,
              s.confirmation_operation_id AS confirmationId,
              s.password_confirmed_at AS confirmedAt,
              a.credential_revision AS accountRevision,
              a.temporary_password_expires_at AS temporaryExpiresAt
            FROM session s
            INNER JOIN account a ON a.user_id = s.user_id
              AND a.account_id = s.user_id
              AND a.provider_id = 'credential'
            WHERE s.id = ?`
          )
          .bind(before.sessionId)
          .first<{
            accountRevision: number;
            confirmedAt: number;
            confirmationId: string;
            expiresAt: number;
            sessionRevision: number;
            temporaryExpiresAt: number | null;
          }>();
        expect(after).toEqual({
          accountRevision: before.accountRevision,
          confirmationId: before.confirmationId,
          confirmedAt: before.confirmedAt,
          expiresAt: expect.any(Number),
          sessionRevision: before.sessionRevision,
          temporaryExpiresAt: before.temporaryExpiresAt,
        });
        expect(after?.expiresAt).toBeLessThanOrEqual(
          Math.floor(Date.now() / 1000)
        );
        const stillValidProof = await app.db
          .prepare(
            "SELECT (unixepoch() - password_confirmed_at < 600) AS valid FROM session WHERE id = ?"
          )
          .bind(before.sessionId)
          .first<{ valid: number }>();
        expect(stillValidProof?.valid).toBe(1);

        const response = await release();
        expect(await expectResponseStatus(response, 401)).toMatchObject({
          error: { code: "unauthorized" },
        });
        await expectNoGlobalRoleWrites(
          app,
          admin.userId,
          targetUserId,
          input.operationKey
        );

        currentAdminContext = await loginExistingAdmin(app, playwright, admin);
        await expectUnknownGlobalRole(currentAdminContext, input.operationKey);
      } finally {
        await app.control.release();
        await currentAdminContext?.dispose();
        await admin.context.dispose();
      }
    }
  );
});
