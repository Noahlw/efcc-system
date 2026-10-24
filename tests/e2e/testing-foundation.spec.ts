import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { createTestHarness } from "wrangler";

import { dedicatedTest, test, expect, openApp } from "../support/fixtures";
import { assertNativeSource } from "../support/native-source";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");

const openMigrationStore = async (configPath: string) => {
  assertNativeSource(repositoryRoot);
  const harness = createTestHarness({
    root: repositoryRoot,
    workers: [
      {
        configPath,
        secrets: { BETTER_AUTH_SECRET: randomBytes(32).toString("hex") },
      },
    ],
  });

  try {
    await harness.listen();
    const worker = harness.getWorker<Cloudflare.Env>("efcc-system");
    await worker.applyD1Migrations("DB");
    const { DB: db } = await worker.getEnv();
    return { close: () => harness.close(), db, worker };
  } catch (error) {
    await harness.close();
    throw error;
  }
};

test("@native @browser @foundation @risk-auth @risk-csrf @risk-session-cookie built HTML/assets/hydration, UI login and action use native cookies", async ({
  page,
  request,
  account,
  app,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const html = await request.get("/sign-in");
  expect(html.status()).toBe(200);
  expect(html.headers().connection).toBe("keep-alive");
  expect(
    html.headers()["keep-alive"],
    "the fixture owns connection closure without advertising an idle deadline"
  ).toBeUndefined();
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

test("@native @browser @foundation @risk-auth @risk-origin @risk-csrf @risk-session HTTP login/native state, exact Origin allow-deny, and bidirectional actual D1", async ({
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

test("@native @http @foundation @risk-resilience built asset methods, bytes and headers match native routing", async ({
  app,
  request,
}) => {
  const html = await request.get("/sign-in");
  expect(html.status()).toBe(200);
  const script = /<script[^>]+src="(?<src>[^"]+)"/u.exec(await html.text())
    ?.groups?.src;
  expect(script).toBeTruthy();
  if (!script) {
    throw new Error("Built sign-in page has no script asset");
  }
  const assetUrl = new URL(script, app.origin).href;
  const cases = [
    { method: "GET", status: 200, url: assetUrl },
    { method: "HEAD", status: 200, url: assetUrl },
    { method: "POST", status: 405, url: assetUrl },
    { method: "OPTIONS", status: 405, url: assetUrl },
    { method: "GET", status: 200, url: `${assetUrl}?native-parity=1` },
    {
      method: "GET",
      status: 404,
      url: `${app.origin}/missing-native-asset.js`,
    },
  ];
  await Promise.all(
    cases.map(async ({ method, status, url }) => {
      const baseline = await app.harness.fetch(url, { method });
      const candidate = await request.fetch(url, { method });
      expect(baseline.status).toBe(status);
      expect(candidate.status()).toBe(status);
      for (const header of ["content-type", "cache-control", "etag"]) {
        expect(candidate.headers()[header] ?? null).toBe(
          baseline.headers.get(header)
        );
      }
      expect(await candidate.body()).toEqual(
        Buffer.from(await baseline.arrayBuffer())
      );
    })
  );
});

test("@native @http @foundation @risk-resilience fixed five-second auth requests finish once through native ingress", async ({
  account,
  app,
}) => {
  test.setTimeout(240_000);
  const countSessions = () =>
    app.db
      .prepare("SELECT count(*) AS count FROM session WHERE user_id = ?")
      .bind(account.userId)
      .first<{ count: number }>();
  expect(await countSessions()).toEqual({ count: 0 });
  const start = performance.now();
  const sendRequest = async (index: number): Promise<void> => {
    const deadline = start + index * 5000;
    await delay(Math.max(1, Math.ceil(deadline - performance.now())));
    const response = await fetch(`${app.origin}/api/auth/sign-in/username`, {
      body: JSON.stringify({
        password: account.password,
        username: account.username,
      }),
      headers: {
        "cf-connecting-ip": `198.18.4.${index + 1}`,
        "content-type": "application/json",
        origin: app.origin,
      },
      method: "POST",
    });
    const body = await response.json();
    expect(response.status, `request ${index + 1}`).toBe(200);
    expect(body).toMatchObject({ user: { id: account.userId } });
    expect(await countSessions()).toEqual({ count: index + 1 });
    if (index < 35) {
      await sendRequest(index + 1);
    }
  };
  await sendRequest(0);
});

test("@native @http @foundation @risk-resilience native ingress keeps an idle HTTP connection until its fixture closes", async () => {
  const app = await openApp();
  let socket: ReturnType<typeof createConnection> | undefined;
  let appClosed = false;
  try {
    const origin = new URL(app.origin);
    socket = createConnection({
      host: origin.hostname,
      port: Number(origin.port),
    });
    await once(socket, "connect", { signal: AbortSignal.timeout(10_000) });
    const response = once(socket, "data", {
      signal: AbortSignal.timeout(10_000),
    });
    socket.write(
      `GET /sign-in HTTP/1.1\r\nHost: ${origin.host}\r\nConnection: keep-alive\r\n\r\n`
    );
    const [firstChunk] = await response;
    expect(String(firstChunk)).toMatch(/^HTTP\/1\.1 200/u);
    socket.resume();
    // Cross the previous 5s idle timeout plus 1s buffer once, without replay.
    await delay(6250);
    expect(socket.destroyed).toBe(false);
    expect(socket.readableEnded).toBe(false);
    const closed = once(socket, "close", {
      signal: AbortSignal.timeout(10_000),
    });
    await app.close();
    appClosed = true;
    await closed;
    expect(socket.destroyed).toBe(true);
  } finally {
    try {
      socket?.destroy();
    } finally {
      if (!appClosed) {
        await app.close();
      }
    }
  }
});

test("@native @http @foundation @risk-atomicity original migrations/tracking/triggers, ABORT rollback and unaffected store", async () => {
  const configPath = path.join(repositoryRoot, "dist/server/wrangler.json");
  const app = await openMigrationStore(configPath);
  let other: Awaited<ReturnType<typeof openMigrationStore>> | undefined;
  try {
    other = await openMigrationStore(configPath);
    await app.worker.applyD1Migrations("DB");
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
      "0010_business_rate_limit.sql",
      "0011_staff_search_projection.sql",
      "0012_roles_department_manager.sql",
      "0013_program_leader.sql",
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
      "role_assignment_history_immutable_delete",
      "role_assignment_history_immutable_update",
      "role_change_operation_immutable_delete",
      "role_change_operation_immutable_update",
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
    try {
      await other?.close();
    } finally {
      await app.close();
    }
  }
});

test("@native @http @foundation @risk-atomicity @risk-recovery populated business quota upgrade preserves exhausted and native rows", async () => {
  const historicalMigrations = [
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
  ];
  const scratchRoot = path.join(repositoryRoot, ".scratch");
  mkdirSync(scratchRoot, { recursive: true });
  const fixtureRoot = mkdtempSync(
    path.join(scratchRoot, "w03-populated-upgrade-")
  );
  const migrationsRoot = path.join(fixtureRoot, "migrations");
  mkdirSync(migrationsRoot);
  const configPath = path.join(fixtureRoot, "wrangler.json");
  const config = JSON.parse(
    readFileSync(
      path.join(repositoryRoot, "dist/server/wrangler.json"),
      "utf-8"
    )
  ) as {
    assets: { directory: string };
    configPath: string;
    d1_databases: { migrations_dir: string }[];
    main: string;
    userConfigPath: string;
  };
  const [database] = config.d1_databases;
  if (!database) {
    throw new Error("Native app config omitted its D1 binding");
  }
  config.configPath = configPath;
  config.userConfigPath = configPath;
  config.main = path.relative(
    fixtureRoot,
    path.join(repositoryRoot, "dist/server/index.js")
  );
  config.assets.directory = path.relative(
    fixtureRoot,
    path.join(repositoryRoot, "dist/client")
  );
  database.migrations_dir = "migrations";
  writeFileSync(configPath, JSON.stringify(config));

  for (const migration of historicalMigrations) {
    copyFileSync(
      path.join(repositoryRoot, "migrations", migration),
      path.join(migrationsRoot, migration)
    );
  }

  const businessRows = [
    {
      count: 10,
      id: "business-create-exhausted",
      key: "application:create:203.0.113.50",
      lastRequest: 1_790_000_001,
    },
    {
      count: 1,
      id: "business-create-other-ip",
      key: "application:create:203.0.113.51",
      lastRequest: 1_790_000_003,
    },
    {
      count: 11,
      id: "business-reconcile-exhausted",
      key: "application:reconcile:203.0.113.50",
      lastRequest: 1_790_000_002,
    },
  ];
  const nativeRow = {
    count: 8,
    id: "native-auth-bucket",
    key: "2001:db8:0001:0002:0000:0000:0000:0000|/sign-in/username",
    lastRequest: 1_792_130_000_000,
  };
  let harness: ReturnType<typeof createTestHarness> | undefined;

  try {
    harness = createTestHarness({
      root: repositoryRoot,
      workers: [
        {
          configPath,
          secrets: { BETTER_AUTH_SECRET: randomBytes(32).toString("hex") },
        },
      ],
    });
    await harness.listen();
    const worker = harness.getWorker<Cloudflare.Env>("efcc-system");
    await worker.applyD1Migrations("DB");
    const { DB: db } = await worker.getEnv();

    const migrationsBefore = await db
      .prepare("SELECT name FROM d1_migrations ORDER BY name")
      .all<{ name: string }>();
    expect(migrationsBefore.results.map((row) => row.name)).toEqual(
      historicalMigrations
    );
    expect(
      await db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='business_rate_limit'"
        )
        .first()
    ).toBeNull();

    await db.batch(
      [...businessRows, nativeRow].map((row) =>
        db
          .prepare(
            "INSERT INTO rate_limit (id, key, count, last_request) VALUES (?, ?, ?, ?)"
          )
          .bind(row.id, row.key, row.count, row.lastRequest)
      )
    );
    copyFileSync(
      path.join(repositoryRoot, "migrations/0010_business_rate_limit.sql"),
      path.join(migrationsRoot, "0010_business_rate_limit.sql")
    );
    await worker.applyD1Migrations("DB");

    const migratedBusiness = await db
      .prepare(
        "SELECT id, key, count, last_request FROM business_rate_limit ORDER BY key"
      )
      .all();
    expect(migratedBusiness.results).toEqual(
      businessRows.map(({ count, id, key, lastRequest }) => ({
        count,
        id,
        key,
        last_request: lastRequest,
      }))
    );
    expect(
      await db
        .prepare(
          "SELECT id, key, count, last_request FROM rate_limit WHERE key=?"
        )
        .bind(nativeRow.key)
        .first()
    ).toEqual({
      count: nativeRow.count,
      id: nativeRow.id,
      key: nativeRow.key,
      last_request: nativeRow.lastRequest,
    });
    const retainedLegacyBusiness = await db
      .prepare(
        "SELECT id, key, count, last_request FROM rate_limit WHERE key GLOB 'application:*' ORDER BY key"
      )
      .all();
    expect(retainedLegacyBusiness.results).toEqual(
      businessRows.map(({ count, id, key, lastRequest }) => ({
        count,
        id,
        key,
        last_request: lastRequest,
      }))
    );
    const migrationsAfter = await db
      .prepare("SELECT name FROM d1_migrations ORDER BY name")
      .all<{ name: string }>();
    expect(migrationsAfter.results.map((row) => row.name)).toEqual([
      ...historicalMigrations,
      "0010_business_rate_limit.sql",
    ]);
  } finally {
    try {
      await harness?.close();
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  }
});

test("@native @http @foundation @risk-atomicity @risk-recovery Program Leader role-check upgrade preserves T1 history, receipts and deletion guard", async () => {
  assertNativeSource(repositoryRoot);
  const historicalMigrations = [
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
    "0010_business_rate_limit.sql",
    "0011_staff_search_projection.sql",
    "0012_roles_department_manager.sql",
  ];
  const scratchRoot = path.join(repositoryRoot, ".scratch");
  mkdirSync(scratchRoot, { recursive: true });
  const fixtureRoot = mkdtempSync(
    path.join(scratchRoot, "program-leader-role-upgrade-")
  );
  const migrationsRoot = path.join(fixtureRoot, "migrations");
  mkdirSync(migrationsRoot);
  const configPath = path.join(fixtureRoot, "wrangler.json");
  const config = JSON.parse(
    readFileSync(
      path.join(repositoryRoot, "dist/server/wrangler.json"),
      "utf-8"
    )
  ) as {
    assets: { directory: string };
    configPath: string;
    d1_databases: { migrations_dir: string }[];
    main: string;
    userConfigPath: string;
  };
  const [database] = config.d1_databases;
  if (!database) {
    throw new Error("Native app config omitted its D1 binding");
  }
  config.configPath = configPath;
  config.userConfigPath = configPath;
  config.main = path.relative(
    fixtureRoot,
    path.join(repositoryRoot, "dist/server/index.js")
  );
  config.assets.directory = path.relative(
    fixtureRoot,
    path.join(repositoryRoot, "dist/client")
  );
  database.migrations_dir = "migrations";
  writeFileSync(configPath, JSON.stringify(config));
  for (const migration of historicalMigrations) {
    copyFileSync(
      path.join(repositoryRoot, "migrations", migration),
      path.join(migrationsRoot, migration)
    );
  }

  const history = {
    action: "granted",
    actorUserId: "synthetic-t1-admin",
    createdAt: 1_792_000_001,
    id: "synthetic-t1-history",
    role: "department_manager",
    scopeId: "synthetic-t1-department",
    scopeName: "Retained T1 Department",
    targetUserId: "synthetic-t1-target",
  };
  const receipt = {
    ...history,
    id: "synthetic-t1-receipt",
    operationKey: "synthetic-t1-operation-key",
    requestHash: "synthetic-t1-request-hash",
  };
  let harness: ReturnType<typeof createTestHarness> | undefined;
  try {
    harness = createTestHarness({
      root: repositoryRoot,
      workers: [
        {
          configPath,
          secrets: { BETTER_AUTH_SECRET: randomBytes(32).toString("hex") },
        },
      ],
    });
    await harness.listen();
    const worker = harness.getWorker<Cloudflare.Env>("efcc-system");
    await worker.applyD1Migrations("DB");
    const { DB: db } = await worker.getEnv();
    await db.batch([
      db
        .prepare(
          "INSERT INTO role_assignment_history(action,actor_user_id,created_at,id,role,scope_id,scope_name,target_user_id) VALUES(?,?,?,?,?,?,?,?)"
        )
        .bind(
          history.action,
          history.actorUserId,
          history.createdAt,
          history.id,
          history.role,
          history.scopeId,
          history.scopeName,
          history.targetUserId
        ),
      db
        .prepare(
          "INSERT INTO role_change_operation(action,actor_user_id,created_at,id,operation_key,request_hash,role,scope_id,scope_name,target_user_id) VALUES(?,?,?,?,?,?,?,?,?,?)"
        )
        .bind(
          receipt.action,
          receipt.actorUserId,
          receipt.createdAt,
          receipt.id,
          receipt.operationKey,
          receipt.requestHash,
          receipt.role,
          receipt.scopeId,
          receipt.scopeName,
          receipt.targetUserId
        ),
      db
        .prepare(
          "INSERT INTO user(id,name,email,email_verified,created_at,updated_at,username,display_username) VALUES(?,?,?,0,?,?,NULL,NULL)"
        )
        .bind(
          history.targetUserId,
          "Synthetic retained target",
          "synthetic-t1-target@example.com",
          history.createdAt,
          history.createdAt
        ),
    ]);

    copyFileSync(
      path.join(repositoryRoot, "migrations/0013_program_leader.sql"),
      path.join(migrationsRoot, "0013_program_leader.sql")
    );
    await worker.applyD1Migrations("DB");

    expect(
      await db
        .prepare(
          "SELECT action,actor_user_id,created_at,id,role,scope_id,scope_name,target_user_id FROM role_assignment_history WHERE id=?"
        )
        .bind(history.id)
        .first()
    ).toEqual({
      action: history.action,
      actor_user_id: history.actorUserId,
      created_at: history.createdAt,
      id: history.id,
      role: history.role,
      scope_id: history.scopeId,
      scope_name: history.scopeName,
      target_user_id: history.targetUserId,
    });
    expect(
      await db
        .prepare(
          "SELECT action,actor_user_id,created_at,id,operation_key,request_hash,role,scope_id,scope_name,target_user_id FROM role_change_operation WHERE id=?"
        )
        .bind(receipt.id)
        .first()
    ).toEqual({
      action: receipt.action,
      actor_user_id: receipt.actorUserId,
      created_at: receipt.createdAt,
      id: receipt.id,
      operation_key: receipt.operationKey,
      request_hash: receipt.requestHash,
      role: receipt.role,
      scope_id: receipt.scopeId,
      scope_name: receipt.scopeName,
      target_user_id: receipt.targetUserId,
    });
    await expect(
      db
        .prepare(
          "INSERT INTO role_change_operation(action,actor_user_id,created_at,id,operation_key,request_hash,role,scope_id,scope_name,target_user_id) VALUES('granted',?,?,? ,?,'other-hash','program_leader','new-scope','New Program','new-target')"
        )
        .bind(
          receipt.actorUserId,
          receipt.createdAt,
          "duplicate-cross-role-receipt",
          receipt.operationKey
        )
        .run()
    ).rejects.toThrow();
    await expect(
      db
        .prepare(
          "UPDATE role_assignment_history SET scope_name='changed' WHERE id=?"
        )
        .bind(history.id)
        .run()
    ).rejects.toThrow();
    await expect(
      db
        .prepare("DELETE FROM role_assignment_history WHERE id=?")
        .bind(history.id)
        .run()
    ).rejects.toThrow();
    await expect(
      db
        .prepare(
          "UPDATE role_change_operation SET scope_name='changed' WHERE id=?"
        )
        .bind(receipt.id)
        .run()
    ).rejects.toThrow();
    await expect(
      db
        .prepare("DELETE FROM role_change_operation WHERE id=?")
        .bind(receipt.id)
        .run()
    ).rejects.toThrow();
    await expect(
      db.prepare("DELETE FROM user WHERE id=?").bind(history.targetUserId).run()
    ).rejects.toThrow();

    const trigger = await db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type='trigger' AND name='user_preserves_church_history_delete'"
      )
      .first<{ sql: string }>();
    expect(trigger?.sql).toContain("program_leader_assignment");
    expect(trigger?.sql).toContain("role_assignment_history");
    const foreignKeys = await db.prepare("PRAGMA foreign_keys").first();
    expect(foreignKeys?.foreign_keys).toBe(1);
    const migrations = await db
      .prepare("SELECT name FROM d1_migrations ORDER BY name")
      .all<{ name: string }>();
    expect(migrations.results.map((row) => row.name)).toEqual([
      ...historicalMigrations,
      "0013_program_leader.sql",
    ]);
  } finally {
    try {
      await harness?.close();
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  }
});

test("@native @http @foundation colliding identities in independent stores and native close/replacement", async ({
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
    `@native @http @foundation native worker ${mode} releases listener and replacement storage`,
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

test("@native @http @foundation @risk-auth @risk-atomicity @risk-recovery actual app session trigger failure rolls back and restores without affecting another store", async ({
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

dedicatedTest(
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

dedicatedTest(
  "@native @http @foundation @risk-atomicity @risk-recovery populated Staff search upgrade remains unavailable until restartable application backfill completes",
  async ({ playwright }) => {
    const root = path.resolve(import.meta.dirname, "../..");
    const owned = mkdtempSync(path.join(tmpdir(), "efcc-search-upgrade-"));
    const migrationDirectory = path.join(owned, "migrations");
    mkdirSync(migrationDirectory);
    for (const name of readdirSync(path.join(root, "migrations"))) {
      if (/^000[0-9]_.*\.sql$/u.test(name)) {
        copyFileSync(
          path.join(root, "migrations", name),
          path.join(migrationDirectory, name)
        );
      }
    }
    const configFile = path.join(
      root,
      "dist/server",
      `wrangler-search-upgrade-${randomUUID()}.json`
    );
    const config = JSON.parse(
      readFileSync(path.join(root, "dist/server/wrangler.json"), "utf-8")
    );
    config.d1_databases = config.d1_databases.map(
      (binding: { migrations_dir: string }) => ({
        ...binding,
        migrations_dir: migrationDirectory,
      })
    );
    writeFileSync(configFile, JSON.stringify(config));
    let app: Awaited<ReturnType<typeof openApp>> | undefined;
    let request:
      | Awaited<ReturnType<typeof playwright.request.newContext>>
      | undefined;
    try {
      app = await openApp(configFile);
      const legacy = app;
      const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
      const staffAccount = {
        email: `upgrade-staff.${suffix}@example.invalid`,
        fullName: "陳舊職員",
        membershipStatus: "active" as const,
        password: "Synthetic-upgrade-password!",
        role: "staff" as const,
        username: `upgrade.${suffix}`,
      };
      await legacy.provision.legacyAccount(staffAccount);
      const ids = await Promise.all(
        Array.from({ length: 27 }, (_, index) =>
          legacy.provision.legacyAccount({
            email: `legacy.${suffix}.${index}@example.invalid`,
            fullName: index === 0 ? "陳Ａİ" : `陳舊資料${index}`,
            membershipStatus: "active",
            password: "Synthetic-upgrade-password!",
            username: `old.${suffix}.${index}`,
          })
        )
      );
      await legacy.db
        .prepare("UPDATE user SET display_username=NULL WHERE id=?")
        .bind(ids[0])
        .run();
      const identities = await legacy.db
        .prepare(
          "SELECT id, name, display_username, username, email FROM user ORDER BY id"
        )
        .all();
      const quotaAnchor = Math.floor(Date.now() / 1000);
      const quotaKey = "application:reconcile:198.51.100.88";
      await legacy.db.batch([
        legacy.db
          .prepare(
            "INSERT INTO rate_limit (id,key,count,last_request) VALUES (?,?,?,?)"
          )
          .bind("combined-exhausted-business", quotaKey, 10, quotaAnchor),
        legacy.db
          .prepare(
            "INSERT INTO rate_limit (id,key,count,last_request) VALUES (?,?,?,?)"
          )
          .bind(
            "combined-native-auth",
            "synthetic-native-auth-preserved",
            3,
            quotaAnchor
          ),
      ]);
      copyFileSync(
        path.join(root, "migrations/0010_business_rate_limit.sql"),
        path.join(migrationDirectory, "0010_business_rate_limit.sql")
      );
      copyFileSync(
        path.join(root, "migrations/0011_staff_search_projection.sql"),
        path.join(migrationDirectory, "0011_staff_search_projection.sql")
      );
      await legacy.harness
        .getWorker<Cloudflare.Env>("efcc-system")
        .applyD1Migrations("DB");
      request = await playwright.request.newContext({
        baseURL: legacy.origin,
        extraHTTPHeaders: {
          "cf-connecting-ip": "198.51.100.88",
          origin: legacy.origin,
        },
      });
      const login = await request.post("/api/auth/sign-in/username", {
        data: {
          password: staffAccount.password,
          username: staffAccount.username,
        },
      });
      expect(login.status()).toBe(200);
      expect(
        await legacy.db
          .prepare("SELECT name FROM d1_migrations ORDER BY name")
          .all()
      ).toMatchObject({
        results: [
          ...Array.from({ length: 10 }, (_, index) => ({
            name: expect.stringMatching(new RegExp(`^000${index}_`, "u")),
          })),
          { name: "0010_business_rate_limit.sql" },
          { name: "0011_staff_search_projection.sql" },
        ],
      });
      expect(
        await legacy.db
          .prepare(
            "SELECT id,count,last_request FROM business_rate_limit WHERE key=?"
          )
          .bind(quotaKey)
          .first()
      ).toEqual({
        count: 10,
        id: "combined-exhausted-business",
        last_request: quotaAnchor,
      });
      expect(
        await legacy.db
          .prepare("SELECT id,count,last_request FROM rate_limit WHERE key=?")
          .bind("synthetic-native-auth-preserved")
          .first()
      ).toEqual({
        count: 3,
        id: "combined-native-auth",
        last_request: quotaAnchor,
      });
      const exhausted = await request.post("/api/v2/applications/reconcile", {
        data: { operationKey: "c".repeat(64) },
      });
      expect(exhausted.status()).toBe(429);
      expect(await exhausted.json()).toMatchObject({
        error: { code: "rate_limited" },
      });
      const before = await request.get("/api/v2/staff/accounts?q=舊資料");
      expect(before.status()).toBe(500);
      expect(await before.json()).toEqual({
        error: {
          code: "internal_error",
          message: "系統暫時無法完成請求，請稍後再試。",
        },
      });
      await legacy.db.exec(
        "CREATE TRIGGER synthetic_search_backfill_abort BEFORE UPDATE OF staff_search_key ON person_profile BEGIN SELECT RAISE(ABORT, 'Synthetic search backfill failure'); END;"
      );
      await expect(
        Promise.resolve().then(() => legacy.provision.backfillStaffSearch())
      ).rejects.toThrow("Synthetic search backfill failure");
      expect(
        await legacy.db
          .prepare(
            "SELECT count(*) AS count FROM person_profile WHERE staff_search_key IS NOT NULL"
          )
          .first()
      ).toEqual({ count: 0 });
      await legacy.db.exec("DROP TRIGGER synthetic_search_backfill_abort;");
      expect(await legacy.provision.backfillStaffSearch()).toEqual({
        attempted: 20,
        complete: false,
      });
      expect(
        await legacy.db
          .prepare(
            "SELECT count(*) AS count FROM person_profile WHERE staff_search_key IS NOT NULL"
          )
          .first()
      ).toEqual({ count: 20 });
      const interrupted = await request.get("/api/v2/staff/accounts?q=舊資料");
      expect(interrupted.status()).toBe(500);
      expect(await legacy.provision.backfillStaffSearch()).toEqual({
        attempted: 8,
        complete: true,
      });
      expect(await legacy.provision.backfillStaffSearch()).toEqual({
        attempted: 0,
        complete: true,
      });
      const found = await request.get("/api/v2/staff/accounts?q=舊資料");
      expect(found.status()).toBe(200);
      expect(await found.json()).toMatchObject({
        data: { accounts: expect.any(Array), hasNextPage: true, page: 1 },
      });
      const nullable = await request.get("/api/v2/staff/accounts?q=陳Ａİ");
      expect(nullable.status()).toBe(200);
      expect(await nullable.json()).toEqual({
        data: {
          accounts: [{ fullName: "陳Ａİ", userId: ids[0], username: null }],
          hasNextPage: false,
          page: 1,
        },
      });
      expect(
        await legacy.db
          .prepare(
            "SELECT staff_search_key FROM person_profile WHERE user_id=?"
          )
          .bind(ids[0])
          .first()
      ).toEqual({ staff_search_key: "陳ａi\u0307 " });
      const afterIdentities = await legacy.db
        .prepare(
          "SELECT id, name, display_username, username, email FROM user ORDER BY id"
        )
        .all();
      expect(afterIdentities.results).toEqual(identities.results);
    } finally {
      try {
        await request?.dispose();
      } finally {
        try {
          await app?.close();
        } finally {
          rmSync(configFile, { force: true });
          rmSync(owned, { force: true, recursive: true });
        }
      }
    }
  }
);

for (const configuration of [
  { name: "missing", secret: "" },
  { name: "short", secret: "Synthetic-short" },
]) {
  dedicatedTest(
    `${configuration.name} auth configuration rejects native startup with fixed attribution`,
    {
      tag: [
        "@native",
        "@foundation",
        "@startup",
        "@risk-auth",
        "@risk-privacy",
      ],
    },
    async () => {
      const root = path.resolve(import.meta.dirname, "../..");
      const harness = createTestHarness({
        root,
        workers: [
          {
            configPath: path.join(root, "dist/server/wrangler.json"),
            secrets: { BETTER_AUTH_SECRET: configuration.secret },
          },
        ],
      });
      try {
        await expect(harness.listen()).rejects.toThrow(
          /runtime failed to start/u
        );
        const messages = harness.getLogs().map(({ message }) => message);
        const events: unknown[] = messages.flatMap((message) => {
          try {
            const event: unknown = JSON.parse(message);
            return [event];
          } catch {
            return [];
          }
        });
        expect(events).toContainEqual({
          category: "configuration",
          outcome: "rejected",
          stage: "native-auth-initialization",
        });
        if (configuration.secret) {
          for (const message of messages) {
            expect(message).not.toContain(configuration.secret);
          }
        }
      } finally {
        await harness.close();
      }
    }
  );
}
