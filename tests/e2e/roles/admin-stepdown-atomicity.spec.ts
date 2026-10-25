import { randomBytes, randomUUID } from "node:crypto";

import type {
  APIRequestContext,
  APIResponse,
  PlaywrightWorkerArgs,
} from "@playwright/test";

import type { NativeApp } from "../../support/fixtures";
import { dedicatedTest, expect } from "../../support/fixtures";

type Playwright = PlaywrightWorkerArgs["playwright"];
type FaultAction = "ABORT" | "IGNORE";
type FaultBoundary = "session-delete" | "history-insert";

interface StepDownActor {
  context: APIRequestContext;
  operationKey: string;
  password: string;
  userId: string;
  username: string;
}

const actorPassword = "Synthetic-stepdown-atomicity-actor!";
const peerPassword = "Synthetic-stepdown-atomicity-peer!";

const clientIp = (base: number, offset: number) => {
  const address = (base + offset) % 65_536;
  return `198.19.${Math.floor(address / 256)}.${address % 256}`;
};

const expectResponseStatus = async (
  response: APIResponse,
  expected: number
) => {
  const body: unknown = await response.json().catch(() => null);
  expect(response.status(), JSON.stringify(body)).toBe(expected);
  return body;
};

const signIn = async (
  context: APIRequestContext,
  username: string,
  password: string
) => {
  const response = await context.post("/api/auth/sign-in/username", {
    data: { password, username },
  });
  await expectResponseStatus(response, 200);
};

const confirmPassword = async (
  context: APIRequestContext,
  password: string
) => {
  const response = await context.post("/api/v2/account/password-confirmation", {
    data: { operationKey: randomUUID(), password },
  });
  await expectResponseStatus(response, 201);
};

const effectiveAdminCount = (caseApp: NativeApp) =>
  caseApp.db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM person_profile p
       INNER JOIN account a
         ON a.user_id=p.user_id
         AND a.account_id=p.user_id
         AND a.provider_id='credential'
       WHERE p.account_role='admin'
         AND p.membership_status='active'
         AND p.banned_at IS NULL
         AND a.password<>''
         AND a.temporary_password_expires_at IS NULL`
    )
    .first<{ count: number }>();

const makeScenario = async (
  caseApp: NativeApp,
  playwright: Playwright,
  suffix: string
) => {
  const actorUsername = `sd.a.${suffix}`;
  const actorUserId = await caseApp.provision.account({
    email: `stepdown.atomicity.actor.${suffix}@example.com`,
    fullName: `陳原子離任管理員${suffix}`,
    membershipStatus: "active",
    password: actorPassword,
    role: "admin",
    username: actorUsername,
  });
  await caseApp.provision.account({
    email: `stepdown.atomicity.peer.${suffix}@example.com`,
    fullName: `陳原子保留管理員${suffix}`,
    membershipStatus: "active",
    password: peerPassword,
    role: "admin",
    username: `sd.p.${suffix}`,
  });
  const ipBase = randomBytes(2).readUInt16BE(0);
  const contexts = await Promise.all(
    [0, 1].map((offset) =>
      playwright.request.newContext({
        baseURL: caseApp.origin,
        extraHTTPHeaders: {
          "cf-connecting-ip": clientIp(ipBase, offset),
          origin: caseApp.origin,
        },
      })
    )
  );
  const [actorContext, secondContext] = contexts;
  if (!actorContext || !secondContext) {
    await Promise.all(contexts.map((context) => context.dispose()));
    throw new Error("The actor fixture did not create two Session contexts.");
  }

  try {
    await signIn(actorContext, actorUsername, actorPassword);
    await signIn(secondContext, actorUsername, actorPassword);
    await confirmPassword(actorContext, actorPassword);

    const actorSessions = await caseApp.db
      .prepare("SELECT COUNT(*) AS count FROM session WHERE user_id=?")
      .bind(actorUserId)
      .first<{ count: number }>();
    expect(actorSessions).toEqual({ count: 2 });

    expect(await effectiveAdminCount(caseApp)).toEqual({ count: 2 });

    const actor: StepDownActor = {
      context: actorContext,
      operationKey: randomUUID(),
      password: actorPassword,
      userId: actorUserId,
      username: actorUsername,
    };
    return { actor, contexts, ipBase };
  } catch (error) {
    await Promise.all(contexts.map((context) => context.dispose()));
    throw error;
  }
};

const stepDownInput = (actor: StepDownActor) => ({
  action: "withdrawn",
  operationKey: actor.operationKey,
  resultingGlobalRole: "member",
  role: "admin",
  targetUserId: actor.userId,
});

const installFault = async (
  caseApp: NativeApp,
  boundary: FaultBoundary,
  fault: FaultAction,
  actorUserId: string,
  triggerName: string
) => {
  const failure =
    fault === "ABORT"
      ? `RAISE(ABORT, 'Synthetic self-step-down ${boundary} failure')`
      : "RAISE(IGNORE)";
  const trigger =
    boundary === "session-delete"
      ? `CREATE TRIGGER ${triggerName} BEFORE DELETE ON session
          WHEN OLD.user_id='${actorUserId}'
          BEGIN SELECT ${failure}; END`
      : `CREATE TRIGGER ${triggerName} BEFORE INSERT ON role_assignment_history
          WHEN NEW.actor_user_id='${actorUserId}'
            AND NEW.target_user_id='${actorUserId}'
            AND NEW.action='withdrawn'
            AND NEW.role='admin'
            AND NEW.resulting_global_role='member'
          BEGIN SELECT ${failure}; END`;
  await caseApp.db.prepare(trigger).run();
};

const actorEffects = (caseApp: NativeApp, actor: StepDownActor) =>
  caseApp.db
    .prepare(
      `SELECT
        p.account_role AS role,
        p.membership_status AS membershipStatus,
        p.banned_at AS bannedAt,
        CASE WHEN a.password<>'' THEN 1 ELSE 0 END AS permanentCredential,
        a.temporary_password_expires_at AS temporaryPasswordExpiresAt,
        (SELECT COUNT(*) FROM session WHERE user_id=p.user_id) AS sessions,
        (SELECT COUNT(*) FROM role_assignment_history
          WHERE actor_user_id=? AND target_user_id=? AND action='withdrawn'
            AND role='admin' AND resulting_global_role='member'
            AND scope_id='global' AND scope_name='全域角色') AS history,
        (SELECT COUNT(*) FROM role_change_operation
          WHERE actor_user_id=? AND target_user_id=? AND operation_key=?
            AND action='withdrawn' AND role='admin'
            AND resulting_global_role='member' AND scope_id='global'
            AND scope_name='全域角色') AS receipts,
        (SELECT COUNT(*) FROM audit_event
          WHERE actor_user_id=? AND target_user_id=?
            AND action='global_role_changed') AS audits
      FROM person_profile p
      INNER JOIN account a
        ON a.user_id=p.user_id
        AND a.account_id=p.user_id
        AND a.provider_id='credential'
      WHERE p.user_id=?`
    )
    .bind(
      actor.userId,
      actor.userId,
      actor.userId,
      actor.userId,
      actor.operationKey,
      actor.userId,
      actor.userId,
      actor.userId
    )
    .first<{
      audits: number;
      bannedAt: null | number;
      history: number;
      membershipStatus: string;
      permanentCredential: number;
      receipts: number;
      role: string;
      sessions: number;
      temporaryPasswordExpiresAt: null | number;
    }>();

const assertNoRecipientInboxWrite = async (actor: StepDownActor) => {
  const response = await actor.context.get("/api/v2/inbox");
  const inbox = (await expectResponseStatus(response, 200)) as {
    data: { roleChanges: unknown[] };
  };
  expect(inbox.data.roleChanges).toHaveLength(0);
};

const retryAndAssertSingleCommit = async (
  caseApp: NativeApp,
  playwright: Playwright,
  actor: StepDownActor,
  ipBase: number
) => {
  await confirmPassword(actor.context, actor.password);
  const retry = await actor.context.post("/api/v2/roles/global-roles", {
    data: stepDownInput(actor),
  });
  expect(await expectResponseStatus(retry, 201)).toMatchObject({
    data: {
      receipt: {
        action: "withdrawn",
        resultingGlobalRole: "member",
        role: "admin",
        targetUserId: actor.userId,
      },
    },
  });

  expect(await actorEffects(caseApp, actor)).toEqual({
    audits: 1,
    bannedAt: null,
    history: 1,
    membershipStatus: "active",
    permanentCredential: 1,
    receipts: 1,
    role: "member",
    sessions: 0,
    temporaryPasswordExpiresAt: null,
  });
  expect(await effectiveAdminCount(caseApp)).toEqual({ count: 1 });

  const freshContext = await playwright.request.newContext({
    baseURL: caseApp.origin,
    extraHTTPHeaders: {
      "cf-connecting-ip": clientIp(ipBase, 2),
      origin: caseApp.origin,
    },
  });
  try {
    await signIn(freshContext, actor.username, actor.password);
    const inbox = await freshContext.get("/api/v2/inbox");
    const inboxBody = (await expectResponseStatus(inbox, 200)) as {
      data: { roleChanges: unknown[] };
    };
    expect(inboxBody.data.roleChanges).toHaveLength(1);
    expect(inboxBody).toMatchObject({
      data: {
        roleChanges: [
          {
            action: "withdrawn",
            resultingGlobalRole: "member",
            role: "admin",
            scopeName: "全域角色",
          },
        ],
      },
    });
  } finally {
    await freshContext.dispose();
  }
};

for (const boundary of ["session-delete", "history-insert"] as const) {
  for (const fault of ["ABORT", "IGNORE"] as const) {
    dedicatedTest(
      `self-step-down ${boundary} RAISE(${fault}) rolls back and retries the same operation`,
      {
        tag: [
          "@native",
          "@http",
          "@risk-authorization",
          "@risk-atomicity",
          "@risk-history",
          "@risk-session",
        ],
      },
      async ({ caseApp, playwright }) => {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
        const { actor, contexts, ipBase } = await makeScenario(
          caseApp,
          playwright,
          suffix
        );
        const triggerName = [
          "native_stepdown",
          boundary.replaceAll("-", "_"),
          fault.toLowerCase(),
          suffix,
        ].join("_");
        const expectedFailure = fault === "ABORT" ? 500 : 409;
        const expectedErrorCode =
          fault === "ABORT" ? "internal_error" : "conflict";

        try {
          await installFault(
            caseApp,
            boundary,
            fault,
            actor.userId,
            triggerName
          );
          const failed = await actor.context.post(
            "/api/v2/roles/global-roles",
            { data: stepDownInput(actor) }
          );
          const failedBody = await expectResponseStatus(
            failed,
            expectedFailure
          );
          expect(failedBody).toMatchObject({
            error: { code: expectedErrorCode },
          });

          expect(await actorEffects(caseApp, actor)).toEqual({
            audits: 0,
            bannedAt: null,
            history: 0,
            membershipStatus: "active",
            permanentCredential: 1,
            receipts: 0,
            role: "admin",
            sessions: 2,
            temporaryPasswordExpiresAt: null,
          });
          expect(await effectiveAdminCount(caseApp)).toEqual({ count: 2 });
          const preservedSessions = await Promise.all(
            contexts.map(async (context) => {
              const session = await context.get("/api/auth/get-session");
              const sessionBody: unknown = await session.json();
              const protectedRead = await context.get(
                "/api/v2/roles/global-roles"
              );
              return {
                protectedReadStatus: protectedRead.status(),
                sessionBody,
                sessionStatus: session.status(),
              };
            })
          );
          expect(preservedSessions).toEqual(
            contexts.map(() => ({
              protectedReadStatus: 200,
              sessionBody: expect.objectContaining({
                user: expect.objectContaining({ id: actor.userId }),
              }),
              sessionStatus: 200,
            }))
          );
          await assertNoRecipientInboxWrite(actor);

          const reconciliation = await actor.context.post(
            "/api/v2/roles/global-roles/reconcile",
            { data: { operationKey: actor.operationKey } }
          );
          expect(await expectResponseStatus(reconciliation, 200)).toMatchObject(
            { data: { outcome: "unknown", receipt: null } }
          );

          await caseApp.db.exec(`DROP TRIGGER ${triggerName}`);
          await retryAndAssertSingleCommit(caseApp, playwright, actor, ipBase);
        } finally {
          try {
            await caseApp.db.exec(`DROP TRIGGER IF EXISTS ${triggerName}`);
          } finally {
            await Promise.all(contexts.map((context) => context.dispose()));
          }
        }
      }
    );
  }
}
