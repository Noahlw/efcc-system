/* eslint-disable no-await-in-loop, unicorn/no-await-expression-member -- Ordered causal requests and direct native D1/RPC observations preserve independent effects without a SQL facade. */

import { randomBytes, randomUUID } from "node:crypto";

import { expect, test } from "../../support/credential-fixtures";
import type { NativeApp } from "../../support/fixtures";
import { securityAccount, expectStatus, securityTest } from "./fixtures";

const isolatedTest = test.extend<{ caseApp: NativeApp }>({
  caseApp: async ({ dedicatedApp }, use) => {
    await use(dedicatedApp);
  },
});

const isolatedSecurityTest = securityTest.extend<{ caseApp: NativeApp }>({
  caseApp: async ({ dedicatedApp }, use) => {
    await use(dedicatedApp);
  },
});

test(
  "own password change keeps the current native session and revokes every other session",
  { tag: ["@native", "@http", "@security", "@risk-auth", "@risk-security"] },
  async ({ request, playwright, caseApp, extraHTTPHeaders }) => {
    const account = securityAccount();
    await caseApp.provision.account(account);
    await expectStatus(
      request.post("/api/auth/sign-in/username", {
        data: { password: account.password, username: account.username },
      }),
      200
    );
    const originalSession = await request.get("/api/auth/get-session");
    const originalBody = await originalSession.json();
    const originalId: string = originalBody.session.id;
    const other = await playwright.request.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders: {
        ...extraHTTPHeaders,
        "cf-connecting-ip": "198.19.0.10",
      },
    });
    try {
      await expectStatus(
        other.post("/api/auth/sign-in/username", {
          data: { password: account.password, username: account.username },
        }),
        200
      );
      const newPassword = "Synthetic-new-password!";
      await expectStatus(
        request.post("/api/v2/account/password", {
          data: {
            currentPassword: account.password,
            newPassword,
            operationKey: randomUUID(),
          },
        }),
        201
      );
      await expectStatus(request.get("/api/v2/me"), 200);
      const retainedSession = await request.get("/api/auth/get-session");
      const retainedBody = await retainedSession.json();
      expect(retainedBody.session.id).toBe(originalId);
      await expectStatus(other.get("/api/v2/me"), 401);
      expect(
        (
          await caseApp.db
            .prepare(`select s.id from session s join user u on u.id = s.user_id
         where u.username = '${account.username}'`)
            .all()
        ).results
      ).toEqual([{ id: originalId }]);
      await expectStatus(
        other.post("/api/auth/sign-in/username", {
          data: { password: account.password, username: account.username },
        }),
        401
      );
      await expectStatus(
        other.post("/api/auth/sign-in/username", {
          data: { password: newPassword, username: account.username },
        }),
        200
      );
    } finally {
      await other.dispose();
    }
  }
);

securityTest(
  "password validation, replay and changed-payload conflict have no duplicate business effects",
  { tag: ["@native", "@http", "@security", "@risk-auth", "@risk-security"] },
  async ({ actor, holder, caseApp }) => {
    const data = {
      currentPassword: holder.password,
      newPassword: "Synthetic-replacement-password!",
      operationKey: randomUUID(),
    };
    const wrong = await expectStatus(
      actor.post("/api/v2/account/password", {
        data: { ...data, currentPassword: "Wrong-password!" },
      }),
      400
    );
    expect(await wrong.json()).toMatchObject({
      error: { code: "invalid_password" },
    });
    await expectStatus(
      actor.post("/api/v2/account/password", {
        data: { ...data, newPassword: "short" },
      }),
      400
    );
    const reconciledResponse = await actor.post(
      "/api/v2/account/security/reconcile",
      { data: { operationKey: data.operationKey } }
    );
    const reconciledBody = await reconciledResponse.json();
    expect(reconciledBody.data.receipt).toBeNull();
    const first = await expectStatus(
      actor.post("/api/v2/account/password", { data }),
      201
    );
    const firstBody = await first.json();
    const { receipt } = firstBody.data;
    const replay = await expectStatus(
      actor.post("/api/v2/account/password", { data }),
      200
    );
    const replayBody = await replay.json();
    expect(replayBody.data.receipt).toEqual(receipt);
    await expectStatus(
      actor.post("/api/v2/account/password", {
        data: { ...data, newPassword: "Different-password!" },
      }),
      409
    );
    expect(
      (
        await caseApp.db
          .prepare(`SELECT count(*) AS count FROM audit_event WHERE action = 'password_changed'
  AND target_user_id = (SELECT id FROM user WHERE username = '${holder.username}')`)
          .all()
      ).results
    ).toEqual([{ count: 1 }]);
    expect(
      (
        await caseApp.db
          .prepare(`SELECT count(*) AS count FROM account_security_operation
  WHERE user_id = (SELECT id FROM user WHERE username = '${holder.username}')`)
          .all()
      ).results
    ).toEqual([{ count: 1 }]);
  }
);

securityTest(
  "confirmation is session-bound, expires after ten minutes and rejects invalid receipt windows",
  { tag: ["@native", "@http", "@security", "@risk-auth", "@risk-security"] },
  async ({ actor, holder, playwright, caseApp, extraHTTPHeaders }) => {
    const data = { operationKey: randomUUID(), password: holder.password };
    await expectStatus(
      actor.post("/api/v2/account/password-confirmation", {
        data: { ...data, password: "Wrong-password!" },
      }),
      400
    );
    const first = await expectStatus(
      actor.post("/api/v2/account/password-confirmation", { data }),
      201
    );
    const firstBody = await first.json();
    const { receipt } = firstBody.data;
    const state = await expectStatus(
      actor.get("/api/v2/account/security"),
      200
    );
    expect(state.headers()["cache-control"]).toContain("no-store");
    const stateBody = await state.json();
    const expiry = stateBody.data.state.passwordConfirmationExpiresAt;
    expect(expiry).toBe(receipt.createdAt + 600);
    expect(expiry - Math.floor(Date.now() / 1000)).toBeGreaterThan(590);
    expect(expiry - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(600);
    const other = await playwright.request.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders: {
        ...extraHTTPHeaders,
        "cf-connecting-ip": "198.18.9.5",
        origin: caseApp.origin,
      },
    });
    try {
      await expectStatus(
        other.post("/api/auth/sign-in/username", {
          data: { password: holder.password, username: holder.username },
        }),
        200
      );
      const otherState = await other.get("/api/v2/account/security");
      const otherBody = await otherState.json();
      expect(otherBody.data.state.passwordConfirmationExpiresAt).toBeNull();
    } finally {
      await other.dispose();
    }
    const replay = await expectStatus(
      actor.post("/api/v2/account/password-confirmation", { data }),
      200
    );
    const replayBody = await replay.json();
    expect(replayBody.data.receipt).toEqual(receipt);
    await caseApp.db
      .prepare(`UPDATE session SET password_confirmed_at = CAST(strftime('%s','now') AS INTEGER) - 600
  WHERE user_id = (SELECT id FROM user WHERE username = '${holder.username}')`)
      .run();
    const expiredResponse = await actor.get("/api/v2/account/security");
    const expiredBody = await expiredResponse.json();
    expect(expiredBody.data.state.passwordConfirmationExpiresAt).toBeNull();
    const id = randomUUID();
    await expect(
      caseApp.db
        .prepare(`INSERT INTO account_security_operation
  (action,created_at,credential_revision,id,operation_key,request_hash,session_id,user_id)
  SELECT 'password_confirmed', CAST(strftime('%s','now') AS INTEGER)-601, 0, '${id}', '${randomUUID()}', 'synthetic', s.id, s.user_id
  FROM session s JOIN user u ON u.id=s.user_id WHERE u.username='${holder.username}'`)
        .run()
    ).rejects.toThrow();
  }
);

for (const table of ["account", "audit_event", "session"] as const) {
  for (const failure of ["ABORT, 'Synthetic credential failure'", "IGNORE"]) {
    isolatedSecurityTest(
      `${table} ${failure} rolls back password, sessions, audit and receipt then retries`,
      {
        tag: [
          "@native",
          "@http",
          "@security",
          "@risk-auth",
          "@risk-security",
          "@resilience",
        ],
      },
      async ({ actor, holder, playwright, caseApp, extraHTTPHeaders }) => {
        const other = await playwright.request.newContext({
          baseURL: caseApp.origin,
          extraHTTPHeaders: { ...extraHTTPHeaders, origin: caseApp.origin },
        });
        await expectStatus(
          other.post("/api/auth/sign-in/username", {
            data: { password: holder.password, username: holder.username },
          }),
          200
        );
        const sessionResponse = await actor.get("/api/auth/get-session");
        const sessionBody = await sessionResponse.json();
        const sessionId = sessionBody.session.id;
        const before = (
          await caseApp.db
            .prepare(
              `SELECT a.password, a.credential_revision AS revision FROM account a JOIN user u ON u.id=a.user_id WHERE u.username='${holder.username}'`
            )
            .all()
        ).results;
        const trigger = `synthetic_security_${randomBytes(8).toString("hex")}`;
        const event = {
          account: "UPDATE",
          audit_event: "INSERT",
          session: "DELETE",
        }[table];
        const subject = table === "session" ? "OLD" : "NEW";
        const field = table === "audit_event" ? "target_user_id" : "user_id";
        await caseApp.db
          .prepare(`CREATE TRIGGER ${trigger} BEFORE ${event} ON ${table}
    WHEN ${subject}.${field}=(SELECT id FROM user WHERE username='${holder.username}')
    ${table === "session" ? `AND OLD.id <> '${sessionId}'` : ""}
    BEGIN SELECT RAISE(${failure}); END;`)
          .run();
        const data = {
          currentPassword: holder.password,
          newPassword: "Synthetic-after-fault!",
          operationKey: randomUUID(),
        };
        try {
          const response = await expectStatus(
            actor.post("/api/v2/account/password", { data }),
            500
          );
          expect(await response.json()).toEqual({
            error: {
              code: "internal_error",
              message: "系統暫時無法完成請求，請稍後再試。",
            },
          });
          expect(
            (
              await caseApp.db
                .prepare(
                  `SELECT a.password, a.credential_revision AS revision FROM account a JOIN user u ON u.id=a.user_id WHERE u.username='${holder.username}'`
                )
                .all()
            ).results
          ).toEqual(before);
          await expectStatus(actor.get("/api/v2/me"), 200);
          await expectStatus(other.get("/api/v2/me"), 200);
          const reconciledResponse = await actor.post(
            "/api/v2/account/security/reconcile",
            { data: { operationKey: data.operationKey } }
          );
          const reconciledBody = await reconciledResponse.json();
          expect(reconciledBody.data.receipt).toBeNull();
          expect(
            (
              await caseApp.db
                .prepare(
                  `SELECT count(*) AS count FROM audit_event WHERE target_user_id=(SELECT id FROM user WHERE username='${holder.username}') AND action='password_changed'`
                )
                .all()
            ).results
          ).toEqual([{ count: 0 }]);
        } finally {
          await caseApp.db.prepare(`DROP TRIGGER ${trigger}`).run();
          await other.dispose();
        }
        await expectStatus(
          actor.post("/api/v2/account/password", { data }),
          201
        );
      }
    );
  }
}

securityTest(
  "restricted holders retain account controls with origin and independent action rate limits",
  { tag: ["@native", "@http", "@security", "@risk-auth", "@risk-security"] },
  async ({ actor, holder, caseApp }) => {
    await caseApp.db
      .prepare(
        `UPDATE person_profile SET membership_status='deactivated', banned_at=CAST(strftime('%s','now') AS INTEGER) WHERE user_id=(SELECT id FROM user WHERE username='${holder.username}')`
      )
      .run();
    await expectStatus(actor.get("/api/v2/me"), 403);
    await expectStatus(actor.get("/account"), 200);
    const paths = [
      "/api/v2/account/password",
      "/api/v2/account/sessions/revoke-others",
      "/api/v2/account/password-confirmation",
      "/api/v2/account/security/reconcile",
    ];
    for (const path of paths) {
      await expectStatus(
        actor.post(path, {
          data: {},
          headers: { origin: "https://evil.example" },
        }),
        403
      );
      for (let index = 0; index < 10; index += 1) {
        await expectStatus(actor.post(path, { data: {} }), 400);
      }
      await expectStatus(actor.post(path, { data: {} }), 429);
    }
    await expectStatus(actor.get("/api/v2/account/security"), 200);
    for (const path of [
      "/api/auth/change-password",
      "/api/auth/reset-password",
      "/api/auth/request-password-reset",
      "/api/auth/send-verification-email",
      "/api/auth/sign-in/email",
      "/api/auth/revoke-sessions",
    ]) {
      await expectStatus(actor.post(path, { data: {} }), 404);
    }
  }
);

securityTest(
  "database rejects stale credential-proof session insertion",
  { tag: ["@native", "@http", "@security", "@risk-auth", "@risk-security"] },
  async ({ actor, holder, caseApp }) => {
    await expectStatus(
      actor.post("/api/v2/account/password", {
        data: {
          currentPassword: holder.password,
          newPassword: "Synthetic-revision-one!",
          operationKey: randomUUID(),
        },
      }),
      201
    );
    await expect(
      caseApp.db
        .prepare(`INSERT INTO session (id, token, user_id, expires_at, created_at, updated_at, credential_revision)
  SELECT '${randomUUID()}', '${randomUUID()}', u.id, CAST(strftime('%s','now') AS INTEGER)+10000, CAST(strftime('%s','now') AS INTEGER), CAST(strftime('%s','now') AS INTEGER), 0 FROM user u WHERE username='${holder.username}'`)
        .run()
    ).rejects.toThrow();
  }
);

isolatedSecurityTest(
  "both native sign-in choices reject old-password proof paused across a committed change",
  {
    tag: [
      "@native",
      "@http",
      "@security",
      "@risk-auth",
      "@risk-security",
      "@resilience",
      "@risk-verifier-race",
    ],
  },
  async ({
    actor,
    holder,
    caseApp,
    credential,
    playwright,
    extraHTTPHeaders,
  }) => {
    const concurrent = await playwright.request.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders: {
        ...extraHTTPHeaders,
        "cf-connecting-ip": "198.18.9.90",
      },
    });
    let currentPassword = holder.password;
    try {
      const initial = await credential.verified();
      await credential.arm();
      try {
        await expectStatus(
          concurrent.post("/api/auth/sign-in/username", {
            data: {
              password: "Synthetic-wrong-password!",
              username: holder.username,
            },
          }),
          401
        );
        expect(await credential.verified()).toEqual({
          ...initial,
          armed: true,
        });
      } finally {
        await credential.release();
      }
      for (const choice of ["username", "name"]) {
        const before = await credential.verified();
        await credential.arm();
        const pending = concurrent.post(`/api/auth/sign-in/${choice}`, {
          data:
            choice === "username"
              ? { password: currentPassword, username: holder.username }
              : { fullName: holder.fullName, password: currentPassword },
          headers: {
            "cf-connecting-ip":
              choice === "username" ? "198.18.9.92" : "198.18.9.93",
          },
        });
        try {
          await expect
            .poll(async () => (await credential.verified()).held)
            .toBe(true);
          expect((await credential.verified()).verified).toBe(
            before.verified + 1
          );
          await expect(
            (async () => {
              await credential.arm();
            })()
          ).rejects.toThrow();
          await expectStatus(actor.get("/api/v2/me"), 200);
          const newPassword = `Synthetic-race-${choice}-replacement!`;
          await expectStatus(
            actor.post("/api/v2/account/password", {
              data: {
                currentPassword,
                newPassword,
                operationKey: randomUUID(),
              },
            }),
            201
          );
          currentPassword = newPassword;
        } finally {
          await credential.release();
        }
        const rejected = await pending;
        expect(rejected.status()).toBe(401);
        expect(rejected.headers()["set-cookie"]).toBeUndefined();
        expect(await rejected.json()).toMatchObject({
          code: "INVALID_USERNAME_OR_PASSWORD",
        });
        await expectStatus(actor.get("/api/v2/me"), 200);
        await expect
          .poll(async () => (await credential.verified()).completed)
          .toBe(before.completed + 1);
      }
      expect(
        (
          await caseApp.db
            .prepare(
              `SELECT count(*) AS count FROM session WHERE user_id=(SELECT id FROM user WHERE username='${holder.username}')`
            )
            .all()
        ).results
      ).toEqual([{ count: 1 }]);
      const trigger = `synthetic_native_session_${randomBytes(8).toString("hex")}`;
      await caseApp.db
        .prepare(`CREATE TRIGGER ${trigger} BEFORE INSERT ON session
        WHEN NEW.user_id=(SELECT id FROM user WHERE username='${holder.username}')
        BEGIN SELECT RAISE(ABORT, 'Synthetic credential proof failure'); END;`)
        .run();
      try {
        await credential.arm();
        const pending = concurrent.post("/api/auth/sign-in/username", {
          data: { password: currentPassword, username: holder.username },
        });
        try {
          await expect
            .poll(async () => (await credential.verified()).held)
            .toBe(true);
        } finally {
          await credential.release();
        }
        const failed = await pending;
        expect(failed.status()).toBe(500);
        expect(await failed.json()).toEqual({
          code: "INTERNAL_SERVER_ERROR",
          message: "系統暫時無法完成驗證，請稍後再試。",
        });
        expect(failed.headers()["set-cookie"]).toBeUndefined();
        expect(JSON.stringify(caseApp.server.getLogs())).not.toMatch(
          /Synthetic credential proof failure|insert into|scrypt/iu
        );
      } finally {
        await credential.release();
        await caseApp.db.prepare(`DROP TRIGGER ${trigger}`).run();
      }
      await credential.arm();
      await credential.release();
      await expectStatus(
        concurrent.post("/api/auth/sign-in/username", {
          data: { password: currentPassword, username: holder.username },
          headers: { "cf-connecting-ip": "198.18.9.91" },
        }),
        200
      );
    } finally {
      await credential.release();
      await concurrent.dispose();
    }
  }
);

isolatedTest(
  "ignored credential write returns a safe failure and leaves every required effect unchanged",
  {
    tag: [
      "@native",
      "@http",
      "@security",
      "@risk-auth",
      "@risk-security",
      "@resilience",
    ],
  },
  async ({ request, caseApp }) => {
    const account = securityAccount();
    await caseApp.provision.account(account);
    await expectStatus(
      request.post("/api/auth/sign-in/username", {
        data: { password: account.password, username: account.username },
      }),
      200
    );
    const trigger = `synthetic_security_${account.username.replaceAll(".", "")}`;
    const data = {
      currentPassword: account.password,
      newPassword: "Synthetic-new-password!",
      operationKey: randomUUID(),
    };
    await caseApp.db
      .prepare(`CREATE TRIGGER ${trigger} BEFORE UPDATE ON account
  WHEN NEW.user_id = (SELECT id FROM user WHERE username = '${account.username}')
  BEGIN SELECT RAISE(IGNORE); END;`)
      .run();
    try {
      const response = await expectStatus(
        request.post("/api/v2/account/password", { data }),
        500
      );
      expect(await response.json()).toMatchObject({
        error: { code: "internal_error" },
      });
      expect(
        (
          await caseApp.db
            .prepare(`SELECT a.credential_revision AS revision,
   (SELECT count(*) FROM audit_event WHERE target_user_id = u.id AND action = 'password_changed') AS audits,
   (SELECT count(*) FROM account_security_operation WHERE user_id = u.id) AS receipts
   FROM user u JOIN account a ON a.user_id = u.id WHERE u.username = '${account.username}'`)
            .all()
        ).results
      ).toEqual([{ audits: 0, receipts: 0, revision: 0 }]);
    } finally {
      await caseApp.db.prepare(`DROP TRIGGER ${trigger}`).run();
    }
    await expectStatus(request.post("/api/v2/account/password", { data }), 201);
  }
);
