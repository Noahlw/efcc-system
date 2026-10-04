/* eslint-disable no-await-in-loop -- Limiter exhaustion and verification barriers require ordered requests. */
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";

import { expect, test } from "@playwright/test";
import type { APIRequestContext, APIResponse } from "@playwright/test";

import { waitForSignInWindow } from "../scenarios/limiter";
import { E2E_BASE_URL } from "../scenarios/local-env";
import { queryLocalSql, runLocalSql, seedSyntheticAccounts } from "./seed";

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

test("own password change keeps the current native session and revokes every other session", async ({
  request,
  playwright,
}) => {
  const account = securityAccount();
  await seedSyntheticAccounts([account]);
  await waitForSignInWindow();
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
    baseURL: test.info().project.use.baseURL,
    extraHTTPHeaders: {
      ...test.info().project.use.extraHTTPHeaders,
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
      queryLocalSql<{ id: string }>(
        `select s.id from session s join user u on u.id = s.user_id
         where u.username = '${account.username}'`
      )
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
});

const securityTest = test.extend<{
  holder: ReturnType<typeof securityAccount>;
  actor: APIRequestContext;
}>({
  actor: async ({ playwright, holder }, use) => {
    const actor = await playwright.request.newContext({
      baseURL: E2E_BASE_URL,
      extraHTTPHeaders: {
        "cf-connecting-ip": `198.18.${randomBytes(1)[0]}.${randomBytes(1)[0]}`,
        origin: E2E_BASE_URL,
      },
    });
    await expectStatus(
      actor.post("/api/auth/sign-in/username", {
        data: { password: holder.password, username: holder.username },
      }),
      200
    );
    await use(actor);
    await actor.dispose();
  },
  holder: async ({ baseURL }, use) => {
    expect(baseURL).toBe(E2E_BASE_URL);
    const holder = securityAccount();
    await seedSyntheticAccounts([holder]);
    await use(holder);
  },
});

securityTest(
  "password validation, replay and changed-payload conflict have no duplicate business effects",
  async ({ actor, holder }) => {
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
      queryLocalSql(`SELECT count(*) AS count FROM audit_event WHERE action = 'password_changed'
  AND target_user_id = (SELECT id FROM user WHERE username = '${holder.username}')`)
    ).toEqual([{ count: 1 }]);
    expect(
      queryLocalSql(`SELECT count(*) AS count FROM account_security_operation
  WHERE user_id = (SELECT id FROM user WHERE username = '${holder.username}')`)
    ).toEqual([{ count: 1 }]);
  }
);

securityTest(
  "logout other sessions retains this session and cannot target another account",
  async ({ actor, holder, playwright }) => {
    const outsider = securityAccount();
    await seedSyntheticAccounts([outsider]);
    const other = await playwright.request.newContext({
      baseURL: E2E_BASE_URL,
      extraHTTPHeaders: { origin: E2E_BASE_URL },
    });
    const unrelated = await playwright.request.newContext({
      baseURL: E2E_BASE_URL,
      extraHTTPHeaders: { origin: E2E_BASE_URL },
    });
    try {
      await waitForSignInWindow();
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
      const data = { operationKey: randomUUID() };
      await expectStatus(
        actor.post("/api/v2/account/sessions/revoke-others", {
          data: { ...data, userId: outsider.username },
        }),
        400
      );
      const first = await expectStatus(
        actor.post("/api/v2/account/sessions/revoke-others", { data }),
        201
      );
      const replay = await expectStatus(
        actor.post("/api/v2/account/sessions/revoke-others", { data }),
        200
      );
      const replayBody = await replay.json();
      const firstBody = await first.json();
      expect(replayBody.data.receipt).toEqual(firstBody.data.receipt);
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
        { data, headers: { "cf-connecting-ip": "198.18.9.4" } }
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
  async ({ actor, holder, playwright }) => {
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
      baseURL: E2E_BASE_URL,
      extraHTTPHeaders: {
        "cf-connecting-ip": "198.18.9.5",
        origin: E2E_BASE_URL,
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
    runLocalSql(`UPDATE session SET password_confirmed_at = CAST(strftime('%s','now') AS INTEGER) - 600
  WHERE user_id = (SELECT id FROM user WHERE username = '${holder.username}')`);
    const expiredResponse = await actor.get("/api/v2/account/security");
    const expiredBody = await expiredResponse.json();
    expect(expiredBody.data.state.passwordConfirmationExpiresAt).toBeNull();
    const id = randomUUID();
    expect(() =>
      runLocalSql(`INSERT INTO account_security_operation
  (action,created_at,credential_revision,id,operation_key,request_hash,session_id,user_id)
  SELECT 'password_confirmed', CAST(strftime('%s','now') AS INTEGER)-601, 0, '${id}', '${randomUUID()}', 'synthetic', s.id, s.user_id
  FROM session s JOIN user u ON u.id=s.user_id WHERE u.username='${holder.username}'`)
    ).toThrow();
  }
);

for (const table of ["account", "audit_event", "session"] as const) {
  for (const failure of ["ABORT, 'Synthetic credential failure'", "IGNORE"]) {
    securityTest(
      `${table} ${failure} rolls back password, sessions, audit and receipt then retries`,
      async ({ actor, holder, playwright }) => {
        const other = await playwright.request.newContext({
          baseURL: E2E_BASE_URL,
          extraHTTPHeaders: { origin: E2E_BASE_URL },
        });
        await waitForSignInWindow();
        await expectStatus(
          other.post("/api/auth/sign-in/username", {
            data: { password: holder.password, username: holder.username },
          }),
          200
        );
        const sessionResponse = await actor.get("/api/auth/get-session");
        const sessionBody = await sessionResponse.json();
        const sessionId = sessionBody.session.id;
        const before = queryLocalSql(
          `SELECT a.password, a.credential_revision AS revision FROM account a JOIN user u ON u.id=a.user_id WHERE u.username='${holder.username}'`
        );
        const trigger = `synthetic_security_${randomBytes(8).toString("hex")}`;
        const event = {
          account: "UPDATE",
          audit_event: "INSERT",
          session: "DELETE",
        }[table];
        const subject = table === "session" ? "OLD" : "NEW";
        const field = table === "audit_event" ? "target_user_id" : "user_id";
        runLocalSql(`CREATE TRIGGER ${trigger} BEFORE ${event} ON ${table}
    WHEN ${subject}.${field}=(SELECT id FROM user WHERE username='${holder.username}')
    ${table === "session" ? `AND OLD.id <> '${sessionId}'` : ""}
    BEGIN SELECT RAISE(${failure}); END;`);
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
            queryLocalSql(
              `SELECT a.password, a.credential_revision AS revision FROM account a JOIN user u ON u.id=a.user_id WHERE u.username='${holder.username}'`
            )
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
            queryLocalSql(
              `SELECT count(*) AS count FROM audit_event WHERE target_user_id=(SELECT id FROM user WHERE username='${holder.username}') AND action='password_changed'`
            )
          ).toEqual([{ count: 0 }]);
        } finally {
          runLocalSql(`DROP TRIGGER ${trigger}`);
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
  async ({ actor, holder }) => {
    runLocalSql(
      `UPDATE person_profile SET membership_status='deactivated', banned_at=CAST(strftime('%s','now') AS INTEGER) WHERE user_id=(SELECT id FROM user WHERE username='${holder.username}')`
    );
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
  async ({ actor, holder }) => {
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
    expect(() =>
      runLocalSql(`INSERT INTO session (id, token, user_id, expires_at, created_at, updated_at, credential_revision)
  SELECT '${randomUUID()}', '${randomUUID()}', u.id, CAST(strftime('%s','now') AS INTEGER)+10000, CAST(strftime('%s','now') AS INTEGER), CAST(strftime('%s','now') AS INTEGER), 0 FROM user u WHERE username='${holder.username}'`)
    ).toThrow();
  }
);

securityTest(
  "both native sign-in choices reject old-password proof paused across a committed change",
  async ({ actor, holder }) => {
    const assets = mkdtempSync(
      nodePath.join(tmpdir(), "efcc-credential-race-")
    );
    const worker = spawn(
      nodePath.resolve("node_modules/.bin/wrangler"),
      [
        "dev",
        "tests/worker/credential-race.ts",
        "--config",
        "wrangler.jsonc",
        "--assets",
        assets,
        "--local",
        "--port",
        "5200",
        "--inspector-port",
        "0",
      ],
      {
        env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    const closed = once(worker, "close");
    let workerOutput = "";
    const record = (chunk: string) => {
      workerOutput += chunk;
    };
    worker.stdout?.setEncoding("utf-8").on("data", record);
    worker.stderr?.setEncoding("utf-8").on("data", record);
    try {
      await expect
        .poll(
          async () => {
            try {
              const response = await fetch("http://localhost:5200/health");
              return response.status;
            } catch {
              return 0;
            }
          },
          { timeout: 20_000 }
        )
        .toBe(200);
      let currentPassword = holder.password;
      for (const choice of ["username", "name"]) {
        await fetch("http://localhost:5200/arm");
        const oldSignIn = fetch(
          `http://localhost:5200/api/auth/sign-in/${choice}`,
          {
            body: JSON.stringify(
              choice === "username"
                ? { password: currentPassword, username: holder.username }
                : { fullName: holder.fullName, password: currentPassword }
            ),
            headers: {
              "content-type": "application/json",
              origin: E2E_BASE_URL,
            },
            method: "POST",
          }
        );
        await expect
          .poll(async () => {
            const response = await fetch("http://localhost:5200/verified");
            const value: unknown = await response.json();
            return (
              typeof value === "object" &&
              value !== null &&
              "verified" in value &&
              value.verified === true
            );
          })
          .toBe(true);
        const newPassword = `Synthetic-race-${choice}-replacement!`;
        await expectStatus(
          actor.post("/api/v2/account/password", {
            data: { currentPassword, newPassword, operationKey: randomUUID() },
          }),
          201
        );
        await fetch("http://localhost:5200/release");
        const rejected = await oldSignIn;
        expect(rejected.status).toBe(401);
        expect(rejected.headers.has("set-cookie")).toBe(false);
        expect(await rejected.json()).toMatchObject({
          code: "INVALID_USERNAME_OR_PASSWORD",
        });
        await expectStatus(actor.get("/api/v2/me"), 200);
        currentPassword = newPassword;
      }
      expect(
        queryLocalSql(
          `SELECT count(*) AS count FROM session WHERE user_id=(SELECT id FROM user WHERE username='${holder.username}')`
        )
      ).toEqual([{ count: 1 }]);
      const trigger = `synthetic_native_session_${randomBytes(8).toString("hex")}`;
      runLocalSql(`CREATE TRIGGER ${trigger} BEFORE INSERT ON session
       WHEN NEW.user_id=(SELECT id FROM user WHERE username='${holder.username}')
       BEGIN SELECT RAISE(ABORT, 'Synthetic credential proof failure'); END;`);
      try {
        const failed = await fetch(
          "http://localhost:5200/api/auth/sign-in/username",
          {
            body: JSON.stringify({
              password: currentPassword,
              username: holder.username,
            }),
            headers: {
              "content-type": "application/json",
              origin: E2E_BASE_URL,
            },
            method: "POST",
          }
        );
        expect(failed.status).toBe(500);
        expect(await failed.json()).toEqual({
          code: "INTERNAL_SERVER_ERROR",
          message: "系統暫時無法完成驗證，請稍後再試。",
        });
        expect(failed.headers.has("set-cookie")).toBe(false);
        expect(workerOutput).not.toMatch(
          /Synthetic credential proof failure|insert into|scrypt/iu
        );
      } finally {
        runLocalSql(`DROP TRIGGER ${trigger}`);
      }
    } finally {
      await fetch("http://localhost:5200/release").catch(() => null);
      worker.kill("SIGTERM");
      await closed;
      rmSync(assets, { force: true, recursive: true });
    }
  }
);

securityTest(
  "account page recovers a committed response after reload without retaining passwords",
  async ({ page, holder, actor }) => {
    const storage = await actor.storageState();
    await page.context().addCookies(storage.cookies);
    await page.goto("/account");
    await expect(
      page.getByRole("heading", { exact: true, name: "帳戶安全" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { exact: true, name: "更改密碼" })
    ).toBeEnabled();
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
    await page.getByLabel("再次輸入新密碼").fill("Synthetic-UI-new-password!");
    await page.getByRole("button", { exact: true, name: "更改密碼" }).click();
    await expect(
      page.getByRole("region", { name: "帳戶安全操作" }).getByRole("status")
    ).toContainText("結果仍未確認");
    const saved = await page.evaluate(() =>
      localStorage.getItem("efcc.account-security.operation.v1")
    );
    expect(saved).not.toContain("password!");
    expect(Object.keys(JSON.parse(saved ?? "{}")).toSorted()).toEqual([
      "action",
      "actorUserId",
      "key",
    ]);
    await page.unroute("**/api/v2/account/security/reconcile");
    await page.reload();
    await expect(
      page.getByRole("region", { name: "帳戶安全操作" }).getByRole("status")
    ).toContainText("伺服器已確認");
    await expect(page.getByLabel("目前密碼", { exact: true })).toHaveValue("");
    await page.getByRole("button", { name: "完成，開始另一項操作" }).click();
    await page
      .getByLabel("確認目前密碼", { exact: true })
      .fill("Synthetic-UI-new-password!");
    await page
      .getByRole("button", { exact: true, name: "確認目前密碼" })
      .click();
    await expect(
      page.getByRole("region", { name: "帳戶安全操作" }).getByRole("status")
    ).toContainText("伺服器已確認");
  }
);

test("ignored credential write returns a safe failure and leaves every required effect unchanged", async ({
  request,
}) => {
  const account = securityAccount();
  await seedSyntheticAccounts([account]);
  await waitForSignInWindow();
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
  runLocalSql(`CREATE TRIGGER ${trigger} BEFORE UPDATE ON account
  WHEN NEW.user_id = (SELECT id FROM user WHERE username = '${account.username}')
  BEGIN SELECT RAISE(IGNORE); END;`);
  try {
    const response = await expectStatus(
      request.post("/api/v2/account/password", { data }),
      500
    );
    expect(await response.json()).toMatchObject({
      error: { code: "internal_error" },
    });
    expect(
      queryLocalSql(`SELECT a.credential_revision AS revision,
   (SELECT count(*) FROM audit_event WHERE target_user_id = u.id AND action = 'password_changed') AS audits,
   (SELECT count(*) FROM account_security_operation WHERE user_id = u.id) AS receipts
   FROM user u JOIN account a ON a.user_id = u.id WHERE u.username = '${account.username}'`)
    ).toEqual([{ audits: 0, receipts: 0, revision: 0 }]);
  } finally {
    runLocalSql(`DROP TRIGGER ${trigger}`);
  }
  await expectStatus(request.post("/api/v2/account/password", { data }), 201);
});
