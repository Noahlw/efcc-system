import { spawn } from "node:child_process";
import path from "node:path";

import {
  dedicatedTest as isolatedTest,
  test,
  expect,
  openApp,
} from "../support/fixtures";

test("@native @browser @foundation @risk-auth @risk-csrf @risk-session-cookie V1/V2 built HTML/assets/hydration, UI login and action use native cookies", async ({
  page,
  request,
  account,
  app,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const html = await request.get("/sign-in");
  expect(html.status()).toBe(200);
  expect(
    html.headers()["keep-alive"],
    "local ingress advertises its idle connection lifetime"
  ).toMatch(/^timeout=\d+/u);
  expect(html.headers()["content-type"]).toContain("text/html");
  expect(await html.text()).toContain("登入");
  const seed = await request.post("/api/internal/test-setup", {
    data: { accounts: [] },
  });
  expect(seed.status()).toBe(404);
  await page.goto("/sign-in");
  const scripts = await page
    .locator("script[src]")
    .evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLScriptElement).src)
    );
  expect(scripts.length).toBeGreaterThan(0);
  const assets = await Promise.all(
    scripts.map((script) => request.get(script))
  );
  for (const asset of assets) {
    expect(asset.status()).toBe(200);
  }
  await page.getByLabel("Username").fill(account.username);
  await page.getByLabel("密碼", { exact: true }).fill(account.password);
  await page.getByRole("button", { exact: true, name: "登入" }).click();
  await expect(page.getByRole("heading", { name: "我的主頁" })).toBeVisible();
  const cookies = await page.context().cookies();
  const session = cookies.find((cookie) =>
    cookie.name.includes("session_token")
  );
  expect(session).toMatchObject({
    domain: new URL(app.origin).hostname,
    httpOnly: true,
    path: "/",
    sameSite: "Lax",
  });
  expect(errors).toEqual([]);
  const rsc: number[] = [];
  page.on("response", (response) => {
    if (response.request().headers().rsc) {
      rsc.push(response.status());
    }
  });
  await page
    .getByRole("navigation", { name: "主要導覽" })
    .getByRole("link", { exact: true, name: "帳戶" })
    .click();
  await expect(
    page.getByRole("heading", { exact: true, name: "帳戶" })
  ).toBeVisible();
  expect(rsc).toContain(200);
  await page.getByRole("button", { exact: true, name: "登出" }).click();
  await expect(page).toHaveURL(/\/sign-in/u);
});

test("@native @browser @foundation @risk-auth @risk-origin @risk-csrf @risk-session V2 HTTP login/native state, exact Origin allow-deny, and V3 bidirectional actual D1", async ({
  request,
  account,
  app,
  signedInPage: page,
}) => {
  const denied = await request.post("/api/auth/sign-in/username", {
    data: { password: account.password, username: account.username },
    headers: { origin: "https://untrusted.example" },
  });
  expect(denied.status()).toBe(403);
  const login = await request.post("/api/auth/sign-in/username", {
    data: { password: account.password, username: account.username },
  });
  expect(login.status()).toBe(200);
  expect(login.headers()["set-cookie"]).toContain("HttpOnly");
  const session = await app.db
    .prepare("SELECT user_id FROM session WHERE user_id = ?")
    .bind(account.userId)
    .first();
  expect(session).toEqual({ user_id: account.userId });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "我的主頁" })).toBeVisible();
  await app.db
    .prepare(
      "UPDATE person_profile SET membership_status = 'pending' WHERE user_id = ?"
    )
    .bind(account.userId)
    .run();
  await page.reload();
  await expect(page).toHaveURL(/\/status/u);
  const rejected = await request.post("/api/auth/sign-out", {
    data: {},
    headers: { origin: "https://untrusted.example" },
  });
  expect(rejected.status()).toBe(403);
  const signOut = await request.post("/api/auth/sign-out", { data: {} });
  expect(signOut.status()).toBe(200);
});

test("@native @http @foundation @risk-atomicity V3 original migrations/tracking/triggers, ABORT rollback and unaffected store", async ({
  dedicatedApp: app,
}) => {
  const other = await openApp();
  try {
    await app.server
      .getWorker<Cloudflare.Env>("efcc-system")
      .applyD1Migrations("DB");
    const migrations = await app.db
      .prepare("SELECT name FROM d1_migrations ORDER BY name")
      .all<{ name: string }>();
    expect(migrations.results.map((row) => row.name)).toEqual([
      "0000_access_foundation.sql",
      "0001_account_application.sql",
      "0002_application_decisions.sql",
      "0003_account_security.sql",
      "0004_assisted_accounts.sql",
      "0005_applicant_actions.sql",
      "0006_application_retention.sql",
      "0007_account_identity.sql",
      "0008_access_restrictions.sql",
      "0009_eligible_deletion.sql",
    ]);
    const triggers = await app.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name"
      )
      .all<{ name: string }>();
    expect(triggers.results.map((row) => row.name)).toEqual([
      "account_change_operation_immutable_delete",
      "account_change_operation_immutable_update",
      "account_security_operation_immutable_delete",
      "account_security_operation_immutable_update",
      "account_security_operation_requires_complete_write",
      "account_security_operation_requires_completed_password_change",
      "applicant_operation_immutable_delete",
      "applicant_operation_immutable_update",
      "application_decision_immutable_delete",
      "application_decision_immutable_update",
      "application_decision_requires_complete_write",
      "membership_application_requires_complete_account",
      "membership_application_retained_delete",
      "membership_application_terminal_state_immutable",
      "person_profile_preserves_last_admin_delete",
      "person_profile_preserves_last_admin_update",
      "person_profile_requires_unique_phone_insert",
      "person_profile_requires_unique_phone_update",
      "session_requires_current_credential_revision",
      "session_requires_unexpired_temporary_password",
      "session_revision_update_requires_current_credential",
      "staff_account_operation_immutable_delete",
      "staff_account_operation_immutable_update",
      "staff_account_operation_requires_complete_write",
      "user_preserves_church_history_delete",
      "user_preserves_last_admin_delete",
      "user_reserve_username_after_insert",
      "user_reserve_username_after_update",
    ]);
    const pragma = await app.db.prepare("PRAGMA foreign_keys").first();
    expect(pragma?.foreign_keys).toBe(1);
    await app.db.exec(
      "CREATE TABLE native_probe (id TEXT PRIMARY KEY); CREATE TRIGGER native_abort BEFORE INSERT ON native_probe WHEN NEW.id = 'fail' BEGIN SELECT RAISE(ABORT, 'native fault'); END;"
    );
    await expect(
      app.db.batch([
        app.db.prepare("INSERT INTO native_probe VALUES ('before')"),
        app.db.prepare("INSERT INTO native_probe VALUES ('fail')"),
      ])
    ).rejects.toThrow();
    expect(
      await app.db.prepare("SELECT COUNT(*) AS count FROM native_probe").first()
    ).toEqual({ count: 0 });
    expect(
      await other.db
        .prepare("SELECT name FROM sqlite_master WHERE name='native_probe'")
        .first()
    ).toBeNull();
    await app.db.exec(
      "DROP TRIGGER native_abort; CREATE TRIGGER native_ignore BEFORE INSERT ON native_probe WHEN NEW.id = 'ignore' BEGIN SELECT RAISE(IGNORE); END;"
    );
    await app.db.batch([
      app.db.prepare("INSERT INTO native_probe VALUES ('ok')"),
      app.db.prepare("INSERT INTO native_probe VALUES ('ignore')"),
    ]);
    expect(
      await app.db.prepare("SELECT id FROM native_probe").all()
    ).toMatchObject({ results: [{ id: "ok" }] });
  } finally {
    await other.close();
  }
});

test("@native @http @foundation V4 colliding identities in independent stores and native close/replacement", async ({
  dedicatedApp: app,
}) => {
  const other = await openApp();
  const input = {
    email: "same@example.com",
    fullName: "陳隔離",
    membershipStatus: "active" as const,
    password: "Synthetic-native-password!",
    username: "same.identity",
  };
  try {
    const a = await app.provision.account(input);
    const b = await other.provision.account(input);
    expect(a).not.toBe(b);
    await app.db
      .prepare(
        "UPDATE person_profile SET membership_status='pending' WHERE user_id=?"
      )
      .bind(a)
      .run();
    expect(
      await other.db
        .prepare("SELECT membership_status FROM person_profile WHERE user_id=?")
        .bind(b)
        .first()
    ).toEqual({ membership_status: "active" });
    const { origin } = other;
    await other.close();
    await expect(fetch(origin)).rejects.toThrow();
    const replacement = await openApp();
    try {
      expect(
        await replacement.db
          .prepare("SELECT id FROM user WHERE username='same.identity'")
          .first()
      ).toBeNull();
    } finally {
      await replacement.close();
    }
  } finally {
    await other.close();
  }
});

test("@native @http @foundation @risk-auth canonical Staff prerequisites retain genuine password confirmation", async ({
  app,
  staff,
  signedInRequest,
}) => {
  const member = await signedInRequest.get("/api/v2/me");
  expect(member.status()).toBe(200);
  expect(
    await app.db
      .prepare(
        "SELECT account_role, membership_status, name_lookup_key FROM person_profile WHERE user_id=?"
      )
      .bind(staff.userId)
      .first()
  ).toEqual({
    account_role: "staff",
    membership_status: "active",
    name_lookup_key: staff.account.fullName.toLowerCase(),
  });
  const proof = await app.db
    .prepare("SELECT password_confirmed_at FROM session WHERE user_id=?")
    .bind(staff.userId)
    .first<{ password_confirmed_at: number }>();
  expect(proof?.password_confirmed_at).toBeGreaterThan(0);
});

for (const mode of ["assertion failure", "interrupt"]) {
  test(
    `@native @http @foundation V4 native worker ${mode} releases listener and replacement storage`,
    { tag: ["@lifecycle"] },
    async () => {
      const root = path.resolve(import.meta.dirname, "../..");
      const child = spawn(
        process.execPath,
        [
          path.join(root, "node_modules/@playwright/test/cli.js"),
          "test",
          "--config",
          "playwright.lifecycle.config.ts",
          "--output",
          test.info().outputPath("lifecycle-child"),
          "--grep",
          mode,
        ],
        { cwd: root, stdio: ["ignore", "pipe", "pipe"] }
      );
      const exited = Promise.withResolvers<number | null>();
      child.once("error", exited.reject);
      child.once("exit", exited.resolve);
      let origin: string | undefined;
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += String(chunk);
        const match =
          /NATIVE_LIFECYCLE_ORIGIN=(?<origin>http:\/\/[\d.:a-z]+)/u.exec(
            output
          );
        if (match && !origin) {
          origin = match.groups?.origin;
          if (mode === "interrupt") {
            child.kill("SIGINT");
          }
        }
      });
      child.stderr.on("data", (chunk) => {
        output += String(chunk);
      });
      try {
        const code = await exited.promise;
        expect(code, output).not.toBe(0);
        if (mode === "assertion failure") {
          expect(output).toContain("NATIVE_LIFECYCLE_REPLACED");
        }
        if (!origin) {
          throw new Error(`Child did not establish native origin: ${output}`);
        }
        await expect(fetch(origin)).rejects.toThrow();
        const replacement = await openApp();
        try {
          expect(
            await replacement.db
              .prepare(
                "SELECT name FROM sqlite_master WHERE name='interrupted_probe'"
              )
              .first()
          ).toBeNull();
        } finally {
          await replacement.close();
        }
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGINT");
        }
      }
    }
  );
}

test("@native @http @foundation @risk-auth @risk-atomicity @risk-recovery V3 actual app session trigger failure rolls back and restores without affecting another store", async ({
  dedicatedApp: app,
  playwright,
}) => {
  const other = await openApp();
  try {
    const account = {
      email: "trigger@example.com",
      fullName: "陳觸發",
      membershipStatus: "active" as const,
      password: "Synthetic-native-password!",
      username: "trigger.person",
    };
    const id = await app.provision.account(account);
    const context = await playwright.request.newContext({
      baseURL: app.origin,
      extraHTTPHeaders: {
        "cf-connecting-ip": "2001:db8::f",
        origin: app.origin,
      },
    });
    try {
      await app.db.exec(
        "CREATE TRIGGER native_session_abort BEFORE INSERT ON session BEGIN SELECT RAISE(ABORT, 'native session fault'); END;"
      );
      const failed = await context.post("/api/auth/sign-in/username", {
        data: { password: account.password, username: account.username },
      });
      expect(failed.status()).toBe(500);
      expect(
        await app.db
          .prepare("SELECT id FROM session WHERE user_id=?")
          .bind(id)
          .first()
      ).toBeNull();
      expect(
        await other.db
          .prepare(
            "SELECT name FROM sqlite_master WHERE name='native_session_abort'"
          )
          .first()
      ).toBeNull();
      await app.db.exec("DROP TRIGGER native_session_abort");
      const recovered = await context.post("/api/auth/sign-in/username", {
        data: { password: account.password, username: account.username },
      });
      expect(recovered.status()).toBe(200);
      expect(
        await app.db
          .prepare("SELECT user_id FROM session WHERE user_id=?")
          .bind(id)
          .first()
      ).toEqual({ user_id: id });
    } finally {
      try {
        await app.db.exec("DROP TRIGGER IF EXISTS native_session_abort");
      } finally {
        await context.dispose();
      }
    }
  } finally {
    await other.close();
  }
});

isolatedTest(
  "@native @browser @foundation case store selection binds accounts, Staff and HTTP/browser sessions to the dedicated app",
  async ({
    caseApp,
    app,
    account,
    staff,
    signedInPage,
    staffPage,
    request,
    playwright,
    extraHTTPHeaders,
  }) => {
    expect(
      await caseApp.db
        .prepare("SELECT username FROM user WHERE id=?")
        .bind(account.userId)
        .first()
    ).toEqual({ username: account.username });
    expect(
      await caseApp.db
        .prepare("SELECT account_role FROM person_profile WHERE user_id=?")
        .bind(staff.userId)
        .first()
    ).toEqual({ account_role: "staff" });
    expect(
      await app.db
        .prepare("SELECT id FROM user WHERE id=?")
        .bind(account.userId)
        .first()
    ).toBeNull();
    const me = await staff.context.get("/api/v2/me");
    expect(me.status()).toBe(200);
    await signedInPage.goto("/");
    await expect(
      signedInPage.getByRole("heading", { name: "我的主頁" })
    ).toBeVisible();
    expect(new URL(signedInPage.url()).origin).toBe(caseApp.origin);
    expect(staffPage.context()).not.toBe(signedInPage.context());
    const staffSession = await staffPage.request.get("/api/auth/get-session");
    expect(await staffSession.json()).toMatchObject({
      user: { id: staff.userId },
    });
    const memberSession = await request.get("/api/auth/get-session");
    expect(await memberSession.json()).toMatchObject({
      user: { id: account.userId },
    });
    const anonymous = await playwright.request.newContext({
      baseURL: caseApp.origin,
      extraHTTPHeaders,
    });
    try {
      const session = await anonymous.get("/api/auth/get-session");
      expect(await session.json()).toBeNull();
      const business = await anonymous.get("/api/v2/me");
      expect(business.status()).toBe(401);
    } finally {
      await anonymous.dispose();
    }
  }
);
