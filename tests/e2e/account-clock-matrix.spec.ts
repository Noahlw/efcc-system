import { randomBytes, randomUUID } from "node:crypto";

import type {
  APIRequestContext,
  APIResponse,
  PlaywrightWorkerArgs,
} from "@playwright/test";

import { expect, test } from "../support/causal";
import type { NativeApp } from "../support/fixtures";
import type { BatchControl } from "../worker/clock-matrix";

type App = NativeApp & { control: BatchControl };
type Client = PlaywrightWorkerArgs["playwright"];
const phone = () =>
  String(60_000_000 + (randomBytes(4).readUInt32BE() % 10_000_000));
const person = () => {
  const key = randomBytes(5).toString("hex");
  return {
    email: `${key}@example.com`,
    fullName: `陳時鐘${key}`,
    operationKey: randomBytes(32).toString("hex"),
    password: "Synthetic-clock-password!",
    phone: phone(),
    username: `clock.${key}`,
  };
};
const actor = (playwright: Client, app: App) =>
  playwright.request.newContext({
    baseURL: app.origin,
    extraHTTPHeaders: {
      "cf-connecting-ip": `2001:db8:${randomBytes(2).toString("hex")}::1`,
      origin: app.origin,
    },
  });
const status = async (response: APIResponse, expected: number) => {
  const body: unknown = await response.json().catch(() => null);
  expect(response.status(), JSON.stringify(body)).toBe(expected);
  return body;
};

/** Only causal polling: prove the actual effect isolate has parked before touching a deadline. */
const park = async (app: App, fire: () => Promise<APIResponse>) => {
  const before = await app.control.held();
  await app.control.arm();
  const pending = fire();
  // Attach rejection immediately; failure diagnostics must not become an unhandled rejection.
  // eslint-disable-next-line promise/prefer-await-to-callbacks -- Observe rejection immediately while the writer remains held.
  const outcome = pending.then(
    async (response) => `${response.status()} ${await response.text()}`,
    String
  );
  try {
    await expect
      .poll(
        async () => {
          const state = await app.control.held();
          return state.held;
        },
        { message: "actual production batch was never held", timeout: 30_000 }
      )
      .toBe(true);
    const held = await app.control.held();
    expect(held.entered).toBe(before.entered + 1);
    expect(held.completed).toBe(before.completed);
  } catch (error) {
    await app.control.release();
    throw new Error(`batch barrier failed; writer outcome: ${await outcome}`, {
      cause: error,
    });
  }
  return async () => {
    await app.control.release();
    const response = await pending;
    const state = await app.control.held();
    expect(state.held).toBe(false);
    return response;
  };
};

const recipes = [
  {
    action: "phone_changed",
    name: "own phone change",
    path: "/api/v2/account/phone",
    receipt: "account_change_operation",
  },
  {
    action: "identity_corrected",
    name: "Staff identity correction",
    path: "/api/v2/staff/accounts/identity",
    receipt: "account_change_operation",
  },
  {
    action: "account_banned",
    name: "restriction change",
    path: "/api/v2/staff/accounts/restrictions",
    receipt: "account_change_operation",
  },
  {
    action: "password_changed",
    name: "password change",
    path: "/api/v2/account/password",
    receipt: "account_security_operation",
  },
  {
    action: "other_sessions_revoked",
    name: "revoking other sessions",
    path: "/api/v2/account/sessions/revoke-others",
    receipt: "account_security_operation",
  },
  {
    action: "password_confirmed",
    name: "password confirmation",
    path: "/api/v2/account/password-confirmation",
    receipt: "account_security_operation",
  },
  {
    action: "application_approved",
    name: "application decision",
    path: "/api/v2/staff/application-decisions",
    receipt: "application_decision",
  },
  {
    action: "application_corrected",
    name: "applicant correction",
    path: "/api/v2/applications/actions",
    receipt: "applicant_operation",
  },
] as const;
type Recipe = (typeof recipes)[number];

/** Domain prerequisites use canonical RPC, but decisions and applications use production ingress. */
const prepare = async (
  app: App,
  playwright: Client,
  recipe: Recipe,
  confirmation = false,
  temporary = false
) => {
  const contexts: APIRequestContext[] = [];
  const context = await actor(playwright, app);
  contexts.push(context);
  const holder = person();
  const staff = recipe.path.includes("/staff/");
  const applicant = recipe.name === "applicant correction";
  let userId: string;
  if (applicant) {
    await status(
      await context.post("/api/v2/applications", { data: holder }),
      201
    );
    const row = await app.db
      .prepare("SELECT id FROM user WHERE username = ?")
      .bind(holder.username)
      .first<{ id: string }>();
    if (!row) {
      throw new Error("Application account missing in authoritative binding");
    }
    userId = row.id;
  } else {
    userId = await app.provision.account({
      ...holder,
      membershipStatus: "active",
      role: staff ? "staff" : "member",
    });
  }
  if (temporary) {
    await app.db
      .prepare(
        "UPDATE account SET temporary_password_expires_at = CAST(strftime('%s','now') AS INTEGER) + 604800 WHERE user_id = ?"
      )
      .bind(userId)
      .run();
  }
  await status(
    await context.post("/api/auth/sign-in/username", {
      data: { password: holder.password, username: holder.username },
    }),
    200
  );
  const session = await app.db
    .prepare(
      "SELECT id FROM session WHERE user_id = ? ORDER BY created_at DESC LIMIT 1"
    )
    .bind(userId)
    .first<{ id: string }>();
  if (!session) {
    throw new Error("HTTP login did not establish a real session");
  }
  if (staff && !confirmation) {
    await status(
      await context.post("/api/v2/account/password-confirmation", {
        data: { operationKey: randomUUID(), password: holder.password },
      }),
      201
    );
  }
  let targetId = userId;
  let applicationId = "";
  if (staff) {
    const target = person();
    if (recipe.name === "application decision") {
      const applicantContext = await actor(playwright, app);
      contexts.push(applicantContext);
      await status(
        await applicantContext.post("/api/v2/applications", { data: target }),
        201
      );
      const row = await app.db
        .prepare("SELECT id FROM user WHERE username = ?")
        .bind(target.username)
        .first<{ id: string }>();
      if (!row) {
        throw new Error("Target application missing");
      }
      targetId = row.id;
    } else {
      targetId = await app.provision.account({
        ...target,
        membershipStatus: "active",
      });
    }
  }
  if (applicant || recipe.name === "application decision") {
    const row = await app.db
      .prepare("SELECT id FROM membership_application WHERE user_id = ?")
      .bind(targetId)
      .first<{ id: string }>();
    if (!row) {
      throw new Error("Synthetic application missing");
    }
    applicationId = row.id;
  }
  if (recipe.name === "revoking other sessions") {
    const second = await actor(playwright, app);
    contexts.push(second);
    await status(
      await second.post("/api/auth/sign-in/username", {
        data: { password: holder.password, username: holder.username },
      }),
      200
    );
    const sessions = await app.db
      .prepare("SELECT id FROM session WHERE user_id = ?")
      .bind(userId)
      .all();
    expect(sessions.results).toHaveLength(2);
  }
  const operationKey = randomUUID();
  const newPhone = phone();
  const identity = {
    email: `${randomUUID()}@example.com`,
    fullName: `陳更正${randomBytes(5).toString("hex")}`,
    phone: newPhone,
  };
  const bodies: Record<Recipe["name"], object> = {
    "Staff identity correction": {
      ...identity,
      identityCheck: "face_to_face",
      operationKey,
      sharedPhone: false,
      targetUserId: targetId,
      username: `changed.${randomBytes(5).toString("hex")}`,
    },
    "applicant correction": {
      ...identity,
      action: "application_corrected",
      applicationId,
      operationKey,
    },
    "application decision": {
      applicationId,
      operationKey,
      outcome: "approved",
    },
    "own phone change": { operationKey, phone: newPhone },
    "password change": {
      currentPassword: holder.password,
      newPassword: "Synthetic-clock-rotated-password!",
      operationKey,
    },
    "password confirmation": { operationKey, password: holder.password },
    "restriction change": {
      action: "account_banned",
      operationKey,
      targetUserId: targetId,
    },
    "revoking other sessions": { operationKey },
  };
  return {
    applicationId,
    body: bodies[recipe.name],
    context,
    contexts,
    identity,
    newPhone,
    operationKey,
    sessionId: session.id,
    targetId,
    userId,
  };
};
interface Scenario {
  applicationId: string;
  context: APIRequestContext;
  contexts: APIRequestContext[];
  identity: { email: string; fullName: string; phone: string };
  newPhone: string;
  operationKey: string;
  sessionId: string;
  targetId: string;
  userId: string;
  body: object;
}

/** Independent durable effects: omit only renewal/deadline fields deliberately changed by the cause. */
const snapshot = async (app: App) => {
  const queries = [
    "SELECT * FROM user ORDER BY id",
    "SELECT * FROM person_profile ORDER BY user_id",
    "SELECT user_id, password, credential_revision FROM account ORDER BY id",
    "SELECT id, user_id, credential_revision, password_confirmed_at, confirmation_operation_id FROM session ORDER BY id",
    "SELECT * FROM membership_application ORDER BY id",
    "SELECT * FROM audit_event ORDER BY id",
    "SELECT * FROM account_change_operation ORDER BY id",
    "SELECT * FROM account_security_operation ORDER BY id",
    "SELECT * FROM application_decision ORDER BY id",
    "SELECT * FROM applicant_operation ORDER BY id",
  ];
  const rows = [];
  for (const query of queries) {
    // eslint-disable-next-line no-await-in-loop -- Ordered independent observations must not overlap the causal writer.
    const result = await app.db.prepare(query).all();
    rows.push(result.results);
  }
  return rows;
};

const verifyCommitted = async (app: App, recipe: Recipe, s: Scenario) => {
  const receipt = await app.db
    .prepare(
      `SELECT count(*) AS n FROM ${recipe.receipt} WHERE operation_key = ?`
    )
    .bind(s.operationKey)
    .first<{ n: number }>();
  expect(receipt?.n).toBe(1);
  if (recipe.name === "own phone change") {
    expect(
      await app.db
        .prepare("SELECT phone FROM person_profile WHERE user_id = ?")
        .bind(s.userId)
        .first()
    ).toEqual({ phone: `+852${s.newPhone}` });
  } else if (
    recipe.name === "Staff identity correction" ||
    recipe.name === "applicant correction"
  ) {
    expect(
      await app.db
        .prepare("SELECT email, name FROM user WHERE id = ?")
        .bind(s.targetId)
        .first()
    ).toEqual({ email: s.identity.email, name: s.identity.fullName });
  } else if (recipe.name === "restriction change") {
    const row = await app.db
      .prepare(
        "SELECT banned_at, membership_status FROM person_profile WHERE user_id = ?"
      )
      .bind(s.targetId)
      .first<{ banned_at: number; membership_status: string }>();
    expect(row?.banned_at).toBeGreaterThan(0);
    expect(row?.membership_status).toBe("active");
  } else if (recipe.name === "password change") {
    expect(
      await app.db
        .prepare(
          "SELECT credential_revision, temporary_password_expires_at FROM account WHERE user_id = ?"
        )
        .bind(s.userId)
        .first()
    ).toEqual({ credential_revision: 1, temporary_password_expires_at: null });
  } else if (recipe.name === "revoking other sessions") {
    const sessions = await app.db
      .prepare("SELECT id FROM session WHERE user_id = ?")
      .bind(s.userId)
      .all();
    expect(sessions.results).toEqual([{ id: s.sessionId }]);
  } else if (recipe.name === "password confirmation") {
    const row = await app.db
      .prepare(
        "SELECT password_confirmed_at, confirmation_operation_id FROM session WHERE id = ?"
      )
      .bind(s.sessionId)
      .first<{
        password_confirmed_at: number;
        confirmation_operation_id: string;
      }>();
    expect(row?.password_confirmed_at).toBeGreaterThan(0);
    expect(row?.confirmation_operation_id).toBeTruthy();
  } else {
    expect(
      await app.db
        .prepare("SELECT status FROM membership_application WHERE id = ?")
        .bind(s.applicationId)
        .first()
    ).toEqual({ status: "approved" });
    expect(
      await app.db
        .prepare(
          "SELECT membership_status FROM person_profile WHERE user_id = ?"
        )
        .bind(s.targetId)
        .first()
    ).toEqual({ membership_status: "active" });
  }
};

for (const recipe of recipes) {
  const deadlines = ["session"];
  if (recipe.name === "Staff identity correction") {
    deadlines.push("confirmation");
  }
  if (recipe.name === "password change") {
    deadlines.push("temporary credential");
  }
  for (const deadline of deadlines) {
    for (const expired of [true, false]) {
      test(
        `${recipe.name}: ${deadline} ${expired ? "expired" : "fresh"} at actual D1 execution`,
        {
          tag: [
            "@http",
            "@account-clock-matrix",
            "@risk-deadline",
            "@risk-atomicity",
            "@native",
          ],
        },
        async ({ causal: app, playwright }) => {
          const s = await prepare(
            app,
            playwright,
            recipe,
            deadline === "confirmation",
            deadline === "temporary credential"
          );
          try {
            if (deadline === "confirmation") {
              const id = randomUUID();
              // Genuine ten-minute persisted proof, not a fake clock or changed window.
              await app.db
                .exec(`UPDATE session SET confirmation_operation_id = '${id}', password_confirmed_at = CAST(strftime('%s','now') AS INTEGER) - ${expired ? 594 : 0} WHERE id = '${s.sessionId}';
INSERT INTO audit_event (id, action, actor_user_id, target_user_id, created_at) SELECT '${id}', 'password_confirmed', user_id, user_id, password_confirmed_at FROM session WHERE id = '${s.sessionId}';
INSERT INTO account_security_operation (action, created_at, credential_revision, id, operation_key, request_hash, session_id, user_id) SELECT 'password_confirmed', password_confirmed_at, credential_revision, '${id}', '${randomUUID()}', 'clock-matrix-seed', id, user_id FROM session WHERE id = '${s.sessionId}';`);
            }
            const before = await snapshot(app);
            const release = await park(app, () =>
              s.context.post(recipe.path, { data: s.body })
            );
            if (expired) {
              let expiryQuery: string;
              if (deadline === "session") {
                await app.db
                  .prepare(
                    "UPDATE session SET expires_at = CAST(strftime('%s','now') AS INTEGER) + 4 WHERE id = ?"
                  )
                  .bind(s.sessionId)
                  .run();
                expiryQuery = `SELECT (expires_at > CAST(strftime('%s','now') AS INTEGER)) AS open FROM session WHERE id = '${s.sessionId}'`;
              } else if (deadline === "temporary credential") {
                await app.db
                  .prepare(
                    "UPDATE account SET temporary_password_expires_at = CAST(strftime('%s','now') AS INTEGER) + 4 WHERE user_id = ?"
                  )
                  .bind(s.userId)
                  .run();
                expiryQuery = `SELECT (temporary_password_expires_at > CAST(strftime('%s','now') AS INTEGER)) AS open FROM account WHERE user_id = '${s.userId}'`;
              } else {
                expiryQuery = `SELECT (CAST(strftime('%s','now') AS INTEGER) - password_confirmed_at < 600) AS open FROM session WHERE id = '${s.sessionId}'`;
              }
              // Waiting for the REAL D1 clock to cross the authority deadline is the claim.
              await expect
                .poll(
                  async () => {
                    const row = await app.db
                      .prepare(expiryQuery)
                      .first<{ open: number }>();
                    return row?.open;
                  },
                  { timeout: 20_000 }
                )
                .toBe(0);
            }
            const response = await release();
            if (expired) {
              if (deadline === "confirmation") {
                expect(await status(response, 403)).toMatchObject({
                  error: { code: "password_confirmation_required" },
                });
              } else if (
                deadline === "temporary credential" ||
                recipe.name === "application decision"
              ) {
                expect(response.ok(), await response.text()).toBe(false);
              } else {
                await status(response, 401);
              }
              expect(await snapshot(app)).toEqual(before);
            } else {
              await status(response, 201);
              await verifyCommitted(app, recipe, s);
            }
          } finally {
            await app.control.release();
            await Promise.all(s.contexts.map((context) => context.dispose()));
          }
        }
      );
    }
  }
  for (const fault of ["ABORT", "IGNORE"] as const) {
    test(
      `${recipe.name}: real ${fault} at held batch rolls back all effects`,
      { tag: ["@http", "@account-clock-matrix", "@risk-atomicity", "@native"] },
      async ({ causal: app, playwright }) => {
        const s = await prepare(app, playwright, recipe);
        try {
          const before = await snapshot(app);
          const release = await park(app, () =>
            s.context.post(recipe.path, { data: s.body })
          );
          await app.db.exec(
            `CREATE TRIGGER clock_receipt_fault BEFORE INSERT ON ${recipe.receipt} WHEN NEW.operation_key = '${s.operationKey}' BEGIN SELECT RAISE(${fault}${fault === "ABORT" ? ", 'synthetic clock fault'" : ""}); END;`
          );
          const response = await release();
          expect(response.ok(), await response.text()).toBe(false);
          expect(await snapshot(app)).toEqual(before);
        } finally {
          await app.control.release();
          await app.db.exec("DROP TRIGGER IF EXISTS clock_receipt_fault");
          await Promise.all(s.contexts.map((context) => context.dispose()));
        }
      }
    );
  }
}

test(
  "causal composition retains production guards, private headers, assets and safe errors",
  { tag: ["@http", "@account-clock-matrix", "@risk-auth", "@native"] },
  async ({ causal: app, playwright }) => {
    const context = await actor(playwright, app);
    try {
      const html = await context.get("/sign-in");
      await status(html, 200);
      const markup = await html.text();
      expect(markup).toContain("使用者名稱");
      const asset = markup.match(
        /(?:src|href)="(?<asset>[^"]*\/_next\/static\/[^"]+)"/u
      )?.groups?.asset;
      expect(
        asset,
        "emitted HTML must reference a production asset"
      ).toBeTruthy();
      if (!asset) {
        throw new Error("Emitted asset reference missing");
      }
      const assetResponse = await context.get(asset);
      expect(assetResponse.status()).toBe(200);
      const denied = await context.post("/api/v2/account/phone", {
        data: { operationKey: randomUUID(), phone: phone() },
        headers: {
          "x-efcc-access": "active",
          "x-efcc-session-id": "forged",
          "x-efcc-user-id": "forged",
        },
      });
      await status(denied, 401);
      expect(denied.headers()["cache-control"]).toContain("no-store");
      const holder = person();
      await app.provision.account({ ...holder, membershipStatus: "active" });
      const evil = await context.post("/api/auth/sign-in/username", {
        data: { password: holder.password, username: holder.username },
        headers: { origin: "https://evil.example" },
      });
      await status(evil, 403);
      await status(
        await context.post("/api/auth/sign-in/username", {
          data: { password: holder.password, username: holder.username },
        }),
        200
      );
      await app.db.exec(
        "ALTER TABLE person_profile RENAME TO clock_missing_profile"
      );
      try {
        const failed = await context.get("/api/v2/account");
        expect(failed.status()).toBe(500);
        expect(failed.headers()["cache-control"]).toContain("no-store");
        expect(await failed.text()).not.toMatch(
          /SELECT|clock_missing_profile|password/iu
        );
      } finally {
        await app.db.exec(
          "ALTER TABLE clock_missing_profile RENAME TO person_profile"
        );
      }
    } finally {
      await context.dispose();
    }
  }
);

test(
  "RPC refuses double arm and releases a held writer on assertion failure",
  { tag: ["@http", "@account-clock-matrix", "@risk-deadline", "@native"] },
  async ({ causal: app, playwright }) => {
    const [recipe] = recipes;
    const s = await prepare(app, playwright, recipe);
    try {
      await app.control.arm();
      await expect(async () => {
        await app.control.arm();
      }).rejects.toThrow("already armed");
      await app.control.release();
      const release = await park(app, () =>
        s.context.post(recipe.path, { data: s.body })
      );
      try {
        throw new Error("synthetic assertion failure");
      } catch {
        await app.control.release();
      }
      await status(await release(), 201);
      await verifyCommitted(app, recipe, s);
    } finally {
      await app.control.release();
      await Promise.all(s.contexts.map((context) => context.dispose()));
    }
  }
);
