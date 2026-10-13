/* eslint-disable no-await-in-loop, unicorn/no-await-expression-member -- Ordered causal requests and direct native D1/RPC observations preserve independent effects without a SQL facade. */
import { randomBytes, randomUUID } from "node:crypto";

import type {
  APIRequestContext,
  APIResponse,
  Request,
  Route,
} from "@playwright/test";

import { expect, test } from "../support/credential-fixtures";
import type { NativeApp } from "../support/fixtures";

const securityAccount = () => {
  const suffix = randomBytes(6).toString("hex");
  return {
    email: `security.${suffix}@example.invalid`,
    fullName: `陳密碼${suffix}`,
    membershipStatus: "active" as const,
    password: "Synthetic-current-password!",
    username: `security.${suffix}`,
  };
};

const expectStatus = async (pending: Promise<APIResponse>, status: number) => {
  const response = await pending;
  expect(response.status()).toBe(status);
  return response;
};

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

const securityTest = test.extend<{
  holder: ReturnType<typeof securityAccount>;
  actor: APIRequestContext;
}>({
  actor: async ({ playwright, holder, caseApp, extraHTTPHeaders }, use) => {
    const actor = await playwright.request.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders: {
        ...extraHTTPHeaders,
        origin: caseApp.origin,
      },
    });
    try {
      await expectStatus(
        actor.post("/api/auth/sign-in/username", {
          data: { password: holder.password, username: holder.username },
        }),
        200
      );
      await use(actor);
    } finally {
      await actor.dispose();
    }
  },
  holder: async ({ caseApp }, use) => {
    const holder = securityAccount();
    await caseApp.provision.account(holder);
    await use(holder);
  },
});

// Schema faults and the per-isolate verifier control must not share ordinary worker state.
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
  "logout other sessions retains this session and cannot target another account",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@security",
      "@risk-auth",
      "@risk-security",
    ],
  },
  async ({ actor, holder, page, playwright, caseApp, extraHTTPHeaders }) => {
    const outsider = securityAccount();
    await caseApp.provision.account(outsider);
    const other = await playwright.request.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders: { ...extraHTTPHeaders, origin: caseApp.origin },
    });
    const unrelated = await playwright.request.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders: { ...extraHTTPHeaders, origin: caseApp.origin },
    });
    try {
      await expectStatus(
        other.post("/api/auth/sign-in/username", {
          data: { password: holder.password, username: holder.username },
        }),
        200
      );
      await expectStatus(
        unrelated.post("/api/auth/sign-in/username", {
          data: { password: outsider.password, username: outsider.username },
        }),
        200
      );
      const storage = await actor.storageState();
      await page.context().addCookies(storage.cookies);
      await page.goto("/account?task=sessions");
      const task = page.getByRole("main", { name: "帳戶安全操作" });
      const beforeResponse = await actor.get("/api/auth/get-session");
      const before = await beforeResponse.json();
      const data = { operationKey: randomUUID() };
      await expectStatus(
        actor.post("/api/v2/account/sessions/revoke-others", {
          data: { ...data, userId: outsider.username },
        }),
        400
      );
      const submitted = page.waitForRequest(
        (request) =>
          request.method() === "POST" &&
          new URL(request.url()).pathname ===
            "/api/v2/account/sessions/revoke-others"
      );
      const completed = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname ===
            "/api/v2/account/sessions/revoke-others"
      );
      await page
        .getByRole("button", { exact: true, name: "登出其他裝置" })
        .click();
      const command = await submitted;
      const first = await completed;
      expect(first.status()).toBe(201);
      const originalCommand = command.postDataJSON();
      expect(originalCommand.operationKey).toEqual(expect.any(String));
      await expect(task.getByRole("status")).toContainText("伺服器已確認");
      const replay = await expectStatus(
        actor.post("/api/v2/account/sessions/revoke-others", {
          data: originalCommand,
        }),
        200
      );
      const replayBody = await replay.json();
      const firstBody = await first.json();
      expect(replayBody.data.receipt).toEqual(firstBody.data.receipt);
      const afterResponse = await page.request.get("/api/auth/get-session");
      const after = await afterResponse.json();
      expect(after.session.id).toBe(before.session.id);
      await expectStatus(actor.get("/api/v2/me"), 200);
      await expectStatus(other.get("/api/v2/me"), 401);
      await expectStatus(unrelated.get("/api/v2/me"), 200);
      await expectStatus(
        other.post("/api/v2/account/password-confirmation", {
          data: { operationKey: randomUUID(), password: holder.password },
          headers: { "cf-connecting-ip": "198.18.9.3" },
        }),
        401
      );
      const hidden = await unrelated.post(
        "/api/v2/account/security/reconcile",
        {
          data: originalCommand,
          headers: { "cf-connecting-ip": "198.18.9.4" },
        }
      );
      const hiddenBody = await hidden.json();
      expect(hiddenBody.data.receipt).toBeNull();
    } finally {
      await other.dispose();
      await unrelated.dispose();
    }
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

securityTest(
  "password task recovers a committed response and keeps confirmation inside Account Security",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@security",
      "@risk-auth",
      "@risk-security",
    ],
  },
  async ({ page, holder, actor }) => {
    const storage = await actor.storageState();
    await page.context().addCookies(storage.cookies);
    await page.goto("/account");
    await page.getByRole("link", { name: /^帳戶安全/u }).click();
    await page.getByRole("link", { name: /更改密碼/u }).click();
    const task = page.getByRole("main", { name: "帳戶安全操作" });
    await expect(
      task.getByRole("heading", { exact: true, name: "更改密碼" })
    ).toBeVisible();
    await page.route("**/api/v2/account/password", async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      await route.abort("failed");
    });
    await page.route("**/api/v2/account/security/reconcile", (route) =>
      route.abort("failed")
    );
    await page.getByLabel("目前密碼", { exact: true }).fill(holder.password);
    await page
      .getByLabel("新密碼", { exact: true })
      .fill("Synthetic-UI-new-password!");
    await page
      .getByLabel("再次輸入新密碼", { exact: true })
      .fill("Synthetic-UI-new-password!");
    await page.getByRole("button", { exact: true, name: "更改密碼" }).click();
    await expect(task.getByRole("status")).toContainText("結果仍未確認");
    const saved = await page.evaluate(() =>
      localStorage.getItem("efcc.account-security.operation.v1")
    );
    expect(saved).not.toContain("password!");
    await page.unroute("**/api/v2/account/security/reconcile");
    await page.reload();
    await expect(
      page.getByRole("main", { name: "帳戶安全操作" }).getByRole("status")
    ).toContainText("伺服器已確認");
    await expect(page.getByLabel("目前密碼", { exact: true })).toHaveCount(0);
    const currentSession = await actor.get("/api/v2/me");
    expect(currentSession.status()).toBe(200);
    await page.getByRole("button", { name: "完成，返回帳戶安全" }).click();
    await page.getByRole("link", { name: /^確認目前密碼/u }).click();
    await page
      .getByLabel("目前密碼", { exact: true })
      .fill("Synthetic-UI-new-password!");
    await page
      .getByRole("button", { exact: true, name: "再次確認目前密碼" })
      .click();
    await expect(
      page.getByRole("main", { name: "帳戶安全操作" }).getByRole("status")
    ).toContainText("伺服器已確認");
  }
);

securityTest(
  "temporary password completion returns authoritative status without lifting restrictions",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@security",
      "@risk-auth",
      "@risk-security",
    ],
  },
  async ({ page, holder, actor, caseApp }) => {
    await caseApp.db.batch([
      caseApp.db
        .prepare(`UPDATE account SET temporary_password_expires_at=CAST(strftime('%s','now') AS INTEGER)+3600
       WHERE user_id=(SELECT id FROM user WHERE username='${holder.username}') AND provider_id='credential'`),
      caseApp.db
        .prepare(`UPDATE person_profile SET membership_status='deactivated',banned_at=CAST(strftime('%s','now') AS INTEGER)
       WHERE user_id=(SELECT id FROM user WHERE username='${holder.username}')`),
    ]);
    const storage = await actor.storageState();
    await page.context().addCookies(storage.cookies);
    await page.goto("/account");
    const newPassword = "Synthetic-temporary-completion!";
    await page.getByLabel("新密碼", { exact: true }).fill(newPassword);
    await page.getByLabel("再次輸入新密碼", { exact: true }).fill(newPassword);
    await page
      .getByLabel("臨時密碼", { exact: true })
      .fill("Synthetic-wrong-temporary-password!");
    const rejected = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/v2/account/password" &&
        response.request().method() === "POST"
    );
    await page.getByRole("button", { exact: true, name: "更改密碼" }).click();
    const rejectedResponse = await rejected;
    expect(rejectedResponse.status()).toBe(400);
    const task = page.getByRole("main", { name: "帳戶安全操作" });
    await expect(task.getByRole("alert")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "查看帳戶狀態" })
    ).toHaveCount(0);
    const operationStorageKey = "efcc.account-security.operation.v1";
    let passwordPosts = 0;
    const observePasswordRequest = (request: Request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/v2/account/password"
      ) {
        passwordPosts += 1;
      }
    };
    page.on("request", observePasswordRequest);
    let preflightOperationKey: string | null = null;
    try {
      await page.evaluate((key) => {
        const originalGetItem = Storage.prototype.getItem;
        const originalSetItem = Storage.prototype.setItem;
        let failVerificationRead = false;
        Storage.prototype.setItem = function setItem(storageKey, value) {
          originalSetItem.call(this, storageKey, value);
          if (storageKey === key) {
            failVerificationRead = true;
          }
        };
        Storage.prototype.getItem = function getItem(storageKey) {
          if (storageKey === key && failVerificationRead) {
            failVerificationRead = false;
            Storage.prototype.getItem = originalGetItem;
            Storage.prototype.setItem = originalSetItem;
            throw new DOMException(
              "Synthetic storage read-back failure",
              "SecurityError"
            );
          }
          return originalGetItem.call(this, storageKey);
        };
      }, operationStorageKey);
      await page.getByLabel("臨時密碼", { exact: true }).fill(holder.password);
      await page.getByLabel("新密碼", { exact: true }).fill(newPassword);
      await page
        .getByLabel("再次輸入新密碼", { exact: true })
        .fill(newPassword);
      await page.getByRole("button", { exact: true, name: "更改密碼" }).click();
      const localRecordCheck = page.getByRole("button", {
        exact: true,
        name: "重新檢查本機操作記錄",
      });
      await expect(localRecordCheck).toBeVisible();
      expect(passwordPosts).toBe(0);
      const storedBeforeCheck = await page.evaluate(
        (key) => localStorage.getItem(key),
        operationStorageKey
      );
      if (storedBeforeCheck === null) {
        throw new Error(
          "Pre-send storage failure did not retain its reference"
        );
      }
      const reference = JSON.parse(storedBeforeCheck) as {
        action: string;
        actorUserId: string;
        key: string;
      };
      if (reference.action !== "password_changed" || !reference.key) {
        throw new Error("Pre-send storage recovery reference is invalid");
      }
      preflightOperationKey = reference.key;
      const reconciliationRequest = page.waitForRequest(
        (request) =>
          request.method() === "POST" &&
          new URL(request.url()).pathname ===
            "/api/v2/account/security/reconcile"
      );
      await localRecordCheck.click();
      const reconciliation = await reconciliationRequest;
      const reconciliationBody = reconciliation.postDataJSON() as {
        operationKey?: string;
      };
      expect(reconciliationBody.operationKey === preflightOperationKey).toBe(
        true
      );
      await expect(page.getByLabel("臨時密碼", { exact: true })).toBeVisible();
      const storedAfterCheck = await page.evaluate(
        (key) => localStorage.getItem(key),
        operationStorageKey
      );
      expect(storedAfterCheck === storedBeforeCheck).toBe(true);
      expect(passwordPosts).toBe(0);
    } finally {
      page.off("request", observePasswordRequest);
    }
    if (preflightOperationKey === null) {
      throw new Error("Pre-send storage recovery lost its operation key");
    }
    await page.getByLabel("臨時密碼", { exact: true }).fill(holder.password);
    await page.getByLabel("新密碼", { exact: true }).fill(newPassword);
    await page.getByLabel("再次輸入新密碼", { exact: true }).fill(newPassword);
    const arrived = Promise.withResolvers<boolean>();
    const release = Promise.withResolvers<boolean>();
    const settled = Promise.withResolvers<boolean>();
    let submissions = 0;
    const passwordEndpoint = "**/api/v2/account/password";
    await page.route(passwordEndpoint, async (route) => {
      submissions += 1;
      arrived.resolve(true);
      try {
        await release.promise;
        await route.continue();
      } finally {
        settled.resolve(true);
      }
    });
    const submittedPasswordRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/v2/account/password"
    );
    await page.getByRole("button", { exact: true, name: "更改密碼" }).click();
    try {
      await arrived.promise;
      const submittedRequest = await submittedPasswordRequest;
      const submittedBody = submittedRequest.postDataJSON() as {
        operationKey?: string;
      };
      expect(submittedBody.operationKey === preflightOperationKey).toBe(true);
      for (const label of ["臨時密碼", "新密碼", "再次輸入新密碼"]) {
        const field = page.getByLabel(label, { exact: true });
        await expect(field).toHaveValue("");
        await expect(field).toBeDisabled();
      }
      await expect(
        page.getByRole("button", { exact: true, name: "顯示臨時密碼" })
      ).toBeDisabled();
      await page.keyboard.press("Enter");
    } finally {
      release.resolve(true);
      await settled.promise;
      await page.unroute(passwordEndpoint);
    }
    const finish = page.getByRole("button", { name: "查看帳戶狀態" });
    await expect(finish).toBeVisible();
    expect(submissions).toBe(1);
    await expect(page.getByLabel("臨時密碼", { exact: true })).toHaveCount(0);
    const originalOperation = await page.evaluate(() =>
      localStorage.getItem("efcc.account-security.operation.v1")
    );
    if (originalOperation === null) {
      throw new Error("Confirmed synthetic operation reference missing");
    }
    const originalOperationBody = JSON.parse(originalOperation) as {
      key: string;
    };
    expect(originalOperationBody.key === preflightOperationKey).toBe(true);
    await finish.click();
    await expect(page).toHaveURL(/\/status$/u);
    await expect(
      page.getByRole("heading", { exact: true, name: "會籍已停用" })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { exact: true, name: "帳戶已暫停使用" })
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "前往主頁" })).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        localStorage.getItem("efcc.account-security.operation.v1")
      )
    ).toBeNull();
    await expectStatus(actor.get("/api/v2/me"), 403);
    await expectStatus(actor.get("/api/auth/get-session"), 200);

    // A historical password-change receipt is not proof that a later temporary gate is satisfied.
    await caseApp.db
      .prepare(`UPDATE account SET temporary_password_expires_at=CAST(strftime('%s','now') AS INTEGER)+3600
     WHERE user_id=(SELECT id FROM user WHERE username='${holder.username}') AND provider_id='credential'`)
      .run();
    await page.evaluate((reference) => {
      localStorage.setItem("efcc.account-security.operation.v1", reference);
    }, originalOperation);
    await page.goto("/account");
    await expect(
      page.getByRole("button", { name: "完成，返回帳戶安全" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "查看帳戶狀態" })
    ).toHaveCount(0);
    await page.getByRole("button", { name: "完成，返回帳戶安全" }).click();
    await expect(page).toHaveURL(/\/account$/u);
    await expect(page.getByLabel("臨時密碼", { exact: true })).toBeVisible();
    await expectStatus(actor.get("/api/v2/me"), 403);
  }
);

securityTest(
  "password and confirmation tasks keep an unsubmitted draft on Back until explicit discard",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@security",
      "@risk-auth",
      "@risk-security",
    ],
  },
  async ({ page, actor }) => {
    const storage = await actor.storageState();
    await page.context().addCookies(storage.cookies);
    const dialogue = page.getByRole("dialog", { name: "放棄未提交的更改？" });
    const back = page.getByRole("link", { exact: true, name: "返回帳戶安全" });
    const draft = "Synthetic-unsubmitted-password!";

    await page.goto("/account?task=password");
    await expect(
      page.getByRole("heading", { exact: true, name: "更改密碼" })
    ).toBeVisible();
    await page.getByLabel("目前密碼", { exact: true }).fill(draft);
    await back.click();
    await expect(dialogue).toBeVisible();
    await page.getByRole("button", { name: "繼續編輯" }).click();
    await expect(dialogue).not.toBeVisible();
    await expect(page.getByLabel("目前密碼", { exact: true })).toHaveValue(
      draft
    );
    await back.click();
    await expect(dialogue).toBeVisible();
    await page.getByRole("button", { name: "放棄變更" }).click();
    await expect(page).toHaveURL(/\/account\?task=security$/u);
    await expect(
      page.getByRole("main", { name: "帳戶安全操作" })
    ).toBeVisible();

    await page.goto("/account?task=confirm");
    await expect(
      page.getByRole("heading", { exact: true, level: 1, name: "確認目前密碼" })
    ).toBeVisible();
    await page.getByLabel("目前密碼", { exact: true }).fill(draft);
    await back.click();
    await expect(dialogue).toBeVisible();
    await page.getByRole("button", { name: "繼續編輯" }).click();
    await expect(dialogue).not.toBeVisible();
    await expect(page.getByLabel("目前密碼", { exact: true })).toHaveValue(
      draft
    );
    await back.click();
    await expect(dialogue).toBeVisible();
    await page.getByRole("button", { name: "放棄變更" }).click();
    await expect(page).toHaveURL(/\/account\?task=security$/u);
  }
);

securityTest(
  "cancelling an in-flight security reconciliation aborts its read transport",
  {
    tag: [
      "@native",
      "@browser",
      "@mobile-critical",
      "@security",
      "@risk-auth",
      "@risk-security",
    ],
  },
  async ({ page, holder, actor, caseApp }) => {
    // A temporary-password holder keeps the account page that also offers sign-out.
    await caseApp.db
      .prepare(`UPDATE account SET temporary_password_expires_at=CAST(strftime('%s','now') AS INTEGER)+3600
      WHERE user_id=(SELECT id FROM user WHERE username='${holder.username}') AND provider_id='credential'`)
      .run();
    const [account] = (
      await caseApp.db
        .prepare(`SELECT id FROM user WHERE username='${holder.username}'`)
        .all<{ id: string }>()
    ).results;
    if (!account) {
      throw new Error("Synthetic security account missing");
    }
    const storage = await actor.storageState();
    await page.context().addCookies(storage.cookies);
    // The last session left an unresolved change-password operation behind.
    const saved = {
      action: "password_changed",
      actorUserId: account.id,
      key: randomUUID(),
    };
    // Seed it before the first document so the production mount-time
    // restoration boundary reads it without racing two lifecycles.
    await page.addInitScript((reference) => {
      localStorage.setItem(
        "efcc.account-security.operation.v1",
        JSON.stringify(reference)
      );
    }, saved);
    let heldReconciliation: Route | undefined;
    let heldSignIn: Route | undefined;
    const {
      promise: signInDocumentReached,
      resolve: markSignInDocumentReached,
    } = Promise.withResolvers<boolean>();
    try {
      // The response never arrives: only cancellation can end this read.
      await page.route("**/api/v2/account/security/reconcile", (route) => {
        heldReconciliation = route;
      });
      // Hold the sign-in document so its unload cannot be the cause of the abort.
      await page.route("**/sign-in", (route) => {
        heldSignIn = route;
        markSignInDocumentReached(true);
      });
      const reconciliationRequest = page.waitForRequest((request) => {
        if (request.method() !== "POST") {
          return false;
        }
        if (
          !new URL(request.url()).pathname.endsWith(
            "/api/v2/account/security/reconcile"
          )
        ) {
          return false;
        }
        if (request.headers()["x-efcc-expected-actor-id"] !== account.id) {
          return false;
        }
        const body: unknown = request.postDataJSON();
        return (
          typeof body === "object" &&
          body !== null &&
          "operationKey" in body &&
          body.operationKey === saved.key
        );
      });
      await page.goto("/account");
      const captured = await reconciliationRequest;
      const task = page.getByRole("main", { name: "帳戶安全操作" });
      await expect(
        task.getByRole("status").filter({ hasText: "正在向伺服器查核結果。" })
      ).toBeVisible();
      // Sign-out clears the query cache, cancelling the in-flight read. Only
      // the captured request may report the abort; a later same-path request
      // cannot stand in for it.
      const abortedRead = page.waitForEvent("requestfailed", {
        predicate: (request) => request === captured,
      });
      await page
        .getByRole("button", { name: "登出" })
        .click({ noWaitAfter: true });
      const failed = await abortedRead;
      await signInDocumentReached;
      // Native engines report the same cancelled read with different protocol strings.
      expect(failed.failure()?.errorText).toMatch(/ABORTED|cancelled/u);
      // The cancelled read settles into the same UNKNOWN catch as a lost
      // response, keeping the stored operation reference rather than reading
      // as a rollback. This hidden, navigating document cannot reliably
      // expose that state; the dropped-response tests cover the shared catch.
    } finally {
      await heldReconciliation?.abort().catch(() => null);
      await heldSignIn?.abort().catch(() => null);
      await page
        .unroute("**/api/v2/account/security/reconcile")
        .catch(() => null);
      await page.unroute("**/sign-in").catch(() => null);
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
