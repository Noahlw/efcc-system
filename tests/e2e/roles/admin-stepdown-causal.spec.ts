import { randomBytes, randomUUID } from "node:crypto";

import type {
  APIRequestContext,
  APIResponse,
  PlaywrightWorkerArgs,
} from "@playwright/test";

import { expect, test } from "../../support/causal";
import type { NativeApp } from "../../support/fixtures";
import type { BatchControl } from "../../worker/clock-matrix";

type CausalApp = NativeApp & { control: BatchControl };
type Playwright = PlaywrightWorkerArgs["playwright"];

interface AdminActor {
  contexts: APIRequestContext[];
  operationKey: string;
  userId: string;
}

const password = "Synthetic-stepdown-causal-admin!";

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

const makeConfirmedAdmin = async (
  app: CausalApp,
  playwright: Playwright,
  suffix: string,
  label: "a" | "b",
  ipBase: number,
  firstIpOffset: number
): Promise<AdminActor> => {
  const username = `sd.c.${label}.${suffix}`;
  const userId = await app.provision.account({
    email: `stepdown.causal.${label}.${suffix}@example.com`,
    fullName: `陳因果離任管理員${label}${suffix}`,
    membershipStatus: "active",
    password,
    role: "admin",
    username,
  });
  const contexts = await Promise.all(
    [0, 1].map((offset) =>
      playwright.request.newContext({
        baseURL: app.origin,
        extraHTTPHeaders: {
          "cf-connecting-ip": clientIp(ipBase, firstIpOffset + offset),
          origin: app.origin,
        },
      })
    )
  );
  const [firstContext, secondContext] = contexts;
  if (!firstContext || !secondContext) {
    await Promise.all(contexts.map((context) => context.dispose()));
    throw new Error("The Admin Session fixture did not create two contexts.");
  }

  try {
    await Promise.all(
      contexts.map(async (context) => {
        const login = await context.post("/api/auth/sign-in/username", {
          data: { password, username },
        });
        await expectResponseStatus(login, 200);
      })
    );

    const confirmation = await firstContext.post(
      "/api/v2/account/password-confirmation",
      { data: { operationKey: randomUUID(), password } }
    );
    await expectResponseStatus(confirmation, 201);

    const sessions = await app.db
      .prepare("SELECT COUNT(*) AS count FROM session WHERE user_id=?")
      .bind(userId)
      .first<{ count: number }>();
    expect(sessions).toEqual({ count: 2 });

    return { contexts, operationKey: randomUUID(), userId };
  } catch (error) {
    await Promise.all(contexts.map((context) => context.dispose()));
    throw error;
  }
};

const selfStepDown = (actor: AdminActor) => {
  const [context] = actor.contexts;
  if (!context) {
    throw new Error("The Admin actor has no initiating Session context.");
  }
  return context.post("/api/v2/roles/global-roles", {
    data: {
      action: "withdrawn",
      operationKey: actor.operationKey,
      resultingGlobalRole: "member",
      role: "admin",
      targetUserId: actor.userId,
    },
  });
};

const actorEffects = (app: CausalApp, actor: AdminActor) =>
  app.db
    .prepare(
      `SELECT
        (SELECT account_role FROM person_profile WHERE user_id=?) AS role,
        (SELECT COUNT(*) FROM session WHERE user_id=?) AS sessions,
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
            AND action='global_role_changed') AS audits`
    )
    .bind(
      actor.userId,
      actor.userId,
      actor.userId,
      actor.userId,
      actor.userId,
      actor.userId,
      actor.operationKey,
      actor.userId,
      actor.userId
    )
    .first<{
      audits: number;
      history: number;
      receipts: number;
      role: string;
      sessions: number;
    }>();

const effectiveAdminCount = (app: CausalApp) =>
  app.db
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

test(
  "competing confirmed Admin self-step-downs leave one effective Admin and roll back the loser",
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
  async ({ causal, playwright }) => {
    const app = causal as CausalApp;
    const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
    const ipBase = randomBytes(2).readUInt16BE(0);
    const actors: AdminActor[] = [];

    try {
      const first = await makeConfirmedAdmin(
        app,
        playwright,
        suffix,
        "a",
        ipBase,
        0
      );
      actors.push(first);
      const second = await makeConfirmedAdmin(
        app,
        playwright,
        suffix,
        "b",
        ipBase,
        2
      );
      actors.push(second);

      expect(await effectiveAdminCount(app)).toEqual({ count: 2 });
      const before = await app.control.held();
      await app.control.arm();
      let firstResponse: APIResponse | undefined;
      let firstError: unknown;
      const firstOutcome = (async () => {
        try {
          firstResponse = await selfStepDown(first);
        } catch (error) {
          firstError = error;
        }
      })();

      await expect
        .poll(
          async () => {
            const held = await app.control.held();
            return held.held;
          },
          {
            message:
              "The first self-step-down did not reach its actual D1 batch",
            timeout: 30_000,
          }
        )
        .toBe(true);
      const firstHeld = await app.control.held();
      expect(firstHeld.entered).toBe(before.entered + 1);
      expect(firstHeld.completed).toBe(before.completed);

      const winningResponse = await selfStepDown(second);
      expect(await expectResponseStatus(winningResponse, 201)).toMatchObject({
        data: {
          receipt: {
            action: "withdrawn",
            resultingGlobalRole: "member",
            role: "admin",
            targetUserId: second.userId,
          },
        },
      });

      const whileFirstIsHeld = await app.control.held();
      expect(whileFirstIsHeld.held).toBe(true);
      expect(await actorEffects(app, second)).toEqual({
        audits: 1,
        history: 1,
        receipts: 1,
        role: "member",
        sessions: 0,
      });
      await Promise.all(
        second.contexts.map(async (context) => {
          const session = await context.get("/api/auth/get-session");
          expect(await session.json()).toBeNull();
          const reconciliation = await context.post(
            "/api/v2/roles/global-roles/reconcile",
            { data: { operationKey: second.operationKey } }
          );
          expect(reconciliation.status()).toBe(401);
        })
      );

      await app.control.release();
      await firstOutcome;
      if (firstError !== undefined) {
        throw new Error("The held self-step-down request failed", {
          cause: firstError,
        });
      }
      if (!firstResponse) {
        throw new Error(
          "The held self-step-down request returned no response."
        );
      }
      expect(await expectResponseStatus(firstResponse, 409)).toMatchObject({
        error: { code: "conflict" },
      });

      expect(await actorEffects(app, first)).toEqual({
        audits: 0,
        history: 0,
        receipts: 0,
        role: "admin",
        sessions: 2,
      });

      const survivingSessions = await Promise.all(
        first.contexts.map(async (context) => {
          const session = await context.get("/api/auth/get-session");
          const sessionBody: unknown = await session.json();
          const protectedRead = await context.get("/api/v2/roles/global-roles");
          return {
            protectedReadStatus: protectedRead.status(),
            sessionBody,
            sessionStatus: session.status(),
          };
        })
      );
      expect(survivingSessions).toEqual(
        first.contexts.map(() => ({
          protectedReadStatus: 200,
          sessionBody: expect.objectContaining({
            user: expect.objectContaining({ id: first.userId }),
          }),
          sessionStatus: 200,
        }))
      );

      const [, losingInboxContext] = first.contexts;
      if (!losingInboxContext) {
        throw new Error("The losing Admin has no second Session context.");
      }
      const losingInbox = await losingInboxContext.get("/api/v2/inbox");
      expect(await expectResponseStatus(losingInbox, 200)).toMatchObject({
        data: { roleChanges: [] },
      });

      expect(await effectiveAdminCount(app)).toEqual({ count: 1 });
    } finally {
      await app.control.release();
      await Promise.all(
        actors
          .flatMap((actor) => actor.contexts)
          .map((context) => context.dispose())
      );
    }
  }
);
