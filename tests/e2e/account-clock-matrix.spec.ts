import { createHash, randomBytes, randomUUID } from "node:crypto";

import type {
  APIRequestContext,
  APIResponse,
  PlaywrightWorkerArgs,
} from "@playwright/test";

import { expect, test } from "../support/causal";
import type { NativeApp } from "../support/fixtures";
import type { BatchControl } from "../worker/clock-matrix";
import { creation, creationEffects } from "./account-assisted/fixtures";

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
const expectResponseStatus = async (
  response: APIResponse,
  expected: number
) => {
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
    action: "own_phone_changed",
    name: "own phone change",
    path: "/api/v2/account/phone",
    receipt: "account_change_operation",
  },
  {
    action: "staff_identity_corrected",
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
    await expectResponseStatus(
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
  await expectResponseStatus(
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
    await expectResponseStatus(
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
      await expectResponseStatus(
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
    await expectResponseStatus(
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
  const original = await app.db
    .prepare(
      "SELECT u.username AS canonicalUsername, u.email, u.name AS fullName, u.display_username AS username, p.phone, p.phone_shared AS phoneShared FROM user u JOIN person_profile p ON p.user_id = u.id WHERE u.id = ?"
    )
    .bind(targetId)
    .first<{
      canonicalUsername: string | null;
      email: string;
      fullName: string;
      username: string | null;
      phone: string | null;
      phoneShared: number;
    }>();
  if (!original) {
    throw new Error("Synthetic original identity missing");
  }
  const bodies: Record<Recipe["name"], object> = {
    "Staff identity correction": {
      ...identity,
      identityCheck: "face_to_face",
      operationKey,
      original,
      sharedPhone: false,
      targetUserId: targetId,
      username: `changed.${randomBytes(5).toString("hex")}`,
    },
    "applicant correction": {
      ...identity,
      action: "application_corrected",
      applicationId,
      operationKey,
      original,
    },
    "application decision": {
      applicationId,
      operationKey,
      outcome: "approved",
    },
    "own phone change": {
      operationKey,
      original: { phone: original.phone, phoneShared: original.phoneShared },
      phone: newPhone,
    },
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
    password: holder.password,
    sessionId: session.id,
    targetId,
    userId,
  };
};

const prepareStaffCreation = async (app: App, playwright: Client) => {
  const holder = person();
  const userId = await app.provision.account({
    ...holder,
    membershipStatus: "active",
    role: "staff",
  });
  const context = await actor(playwright, app);
  try {
    await expectResponseStatus(
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
      throw new Error(
        "HTTP login did not establish the creation Staff session"
      );
    }
    await expectResponseStatus(
      await context.post("/api/v2/account/password-confirmation", {
        data: { operationKey: randomUUID(), password: holder.password },
      }),
      201
    );
    return { context, input: creation(), sessionId: session.id, userId };
  } catch (error) {
    await context.dispose();
    throw error;
  }
};

const creationLedgerEffects = (
  app: App,
  actorUserId: string,
  operationKey: string
) =>
  app.db
    .prepare(`SELECT
      (SELECT COUNT(*) FROM audit_event WHERE actor_user_id = ? AND action = 'assisted_account_created') AS audits,
      (SELECT COUNT(*) FROM staff_account_operation WHERE actor_user_id = ? AND operation_key = ? AND action = 'assisted_account_created') AS receipts`)
    .bind(actorUserId, actorUserId, operationKey)
    .first<{ audits: number; receipts: number }>();

interface Scenario {
  applicationId: string;
  context: APIRequestContext;
  contexts: APIRequestContext[];
  identity: { email: string; fullName: string; phone: string };
  newPhone: string;
  operationKey: string;
  password: string;
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
  const audit = await app.db
    .prepare(
      `SELECT action, actor_user_id, target_user_id FROM audit_event WHERE id = (SELECT id FROM ${recipe.receipt} WHERE operation_key = ?)`
    )
    .bind(s.operationKey)
    .all();
  expect(audit.results).toEqual([
    {
      action: recipe.action,
      actor_user_id: s.userId,
      target_user_id: s.targetId,
    },
  ]);
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
  if (recipe.name === "own phone change") {
    for (const password of [null, ""]) {
      test(
        `${recipe.name}: ${password === null ? "removed" : "empty"} credential at held D1 execution leaves no effects`,
        {
          tag: [
            "@native",
            "@http",
            "@account-clock-matrix",
            "@risk-authority",
            "@risk-atomicity",
          ],
        },
        async ({ causal: app, playwright }) => {
          const s = await prepare(app, playwright, recipe);
          try {
            const release = await park(app, () =>
              s.context.post(recipe.path, { data: s.body })
            );
            await app.db
              .prepare("UPDATE account SET password = ? WHERE user_id = ?")
              .bind(password, s.userId)
              .run();
            const beforeRelease = await snapshot(app);
            await expectResponseStatus(await release(), 401);
            expect(await snapshot(app)).toEqual(beforeRelease);
          } finally {
            await app.control.release();
            await Promise.all(s.contexts.map((context) => context.dispose()));
          }
        }
      );
    }
  }
  if (
    recipe.name === "own phone change" ||
    recipe.name === "applicant correction"
  ) {
    test(
      `${recipe.name}: real credential change at held D1 execution invalidates the original actor proof`,
      {
        tag: [
          "@native",
          "@http",
          "@account-clock-matrix",
          "@risk-authority",
          "@risk-atomicity",
        ],
      },
      async ({ causal: app, playwright }) => {
        const s = await prepare(app, playwright, recipe);
        try {
          const release = await park(app, () =>
            s.context.post(recipe.path, { data: s.body })
          );
          await expectResponseStatus(
            await s.context.post("/api/v2/account/password", {
              data: {
                currentPassword: s.password,
                newPassword: "Synthetic-proof-rotated-password!",
                operationKey: randomUUID(),
              },
            }),
            201
          );
          const beforeRelease = await snapshot(app);
          await expectResponseStatus(await release(), 409);
          expect(await snapshot(app)).toEqual(beforeRelease);
        } finally {
          await app.control.release();
          await Promise.all(s.contexts.map((context) => context.dispose()));
        }
      }
    );
  }
  test(
    `${recipe.name}: Ban introduced at held D1 execution denies all domain and receipt effects`,
    {
      tag: [
        "@native",
        "@http",
        "@account-clock-matrix",
        "@risk-authority",
        "@risk-atomicity",
      ],
    },
    async ({ causal: app, playwright }) => {
      const s = await prepare(app, playwright, recipe);
      try {
        const release = await park(app, () =>
          s.context.post(recipe.path, { data: s.body })
        );
        await app.db
          .prepare(
            "UPDATE person_profile SET banned_at = unixepoch() WHERE user_id = ?"
          )
          .bind(s.userId)
          .run();
        const beforeRelease = await snapshot(app);
        await expectResponseStatus(await release(), 403);
        expect(await snapshot(app)).toEqual(beforeRelease);
      } finally {
        await app.control.release();
        await Promise.all(s.contexts.map((context) => context.dispose()));
      }
    }
  );
  if (
    recipe.name === "Staff identity correction" ||
    recipe.name === "restriction change"
  ) {
    test(
      `${recipe.name}: Admin target promotion at held D1 execution denies all effects`,
      {
        tag: [
          "@native",
          "@http",
          "@account-clock-matrix",
          "@risk-authority",
          "@risk-atomicity",
        ],
      },
      async ({ causal: app, playwright }) => {
        const s = await prepare(app, playwright, recipe);
        try {
          await app.db
            .prepare(
              "UPDATE person_profile SET account_role = 'admin' WHERE user_id = ?"
            )
            .bind(s.userId)
            .run();
          const release = await park(app, () =>
            s.context.post(recipe.path, { data: s.body })
          );
          await app.db
            .prepare(
              "UPDATE person_profile SET account_role = 'admin' WHERE user_id = ?"
            )
            .bind(s.targetId)
            .run();
          const beforeRelease = await snapshot(app);
          await expectResponseStatus(await release(), 403);
          expect(await snapshot(app)).toEqual(beforeRelease);
        } finally {
          await app.control.release();
          await Promise.all(s.contexts.map((context) => context.dispose()));
        }
      }
    );
  }
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
            // The intentional expiry mutation is not a business effect: freeze its
            // actual persisted value before release, independently of the original
            // pre-writer effect snapshot, so clearing the deadline cannot escape proof.
            const credentialDeadline = await app.db
              .prepare(
                "SELECT temporary_password_expires_at FROM account WHERE user_id = ?"
              )
              .bind(s.userId)
              .first<{ temporary_password_expires_at: number | null }>();
            if (deadline === "temporary credential") {
              expect(
                credentialDeadline?.temporary_password_expires_at
              ).toBeGreaterThan(0);
            }
            const response = await release();
            if (expired) {
              if (deadline === "confirmation") {
                expect(await expectResponseStatus(response, 403)).toMatchObject(
                  {
                    error: { code: "password_confirmation_required" },
                  }
                );
              } else if (
                deadline === "temporary credential" ||
                recipe.name === "application decision"
              ) {
                expect(response.ok(), await response.text()).toBe(false);
              } else {
                await expectResponseStatus(response, 401);
              }
              expect(await snapshot(app)).toEqual(before);
              expect(
                await app.db
                  .prepare(
                    "SELECT temporary_password_expires_at FROM account WHERE user_id = ?"
                  )
                  .bind(s.userId)
                  .first()
              ).toEqual(credentialDeadline);
            } else {
              await expectResponseStatus(response, 201);
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
      await expectResponseStatus(html, 200);
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
      await expectResponseStatus(denied, 401);
      expect(denied.headers()["cache-control"]).toContain("no-store");
      const holder = person();
      await app.provision.account({ ...holder, membershipStatus: "active" });
      const evil = await context.post("/api/auth/sign-in/username", {
        data: { password: holder.password, username: holder.username },
        headers: { origin: "https://evil.example" },
      });
      await expectResponseStatus(evil, 403);
      await expectResponseStatus(
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
      await expectResponseStatus(await release(), 201);
      await verifyCommitted(app, recipe, s);
    } finally {
      await app.control.release();
      await Promise.all(s.contexts.map((context) => context.dispose()));
    }
  }
);

for (const recipe of recipes.filter((value) =>
  [
    "own phone change",
    "Staff identity correction",
    "applicant correction",
  ].includes(value.name)
)) {
  test(
    `${recipe.name}: original-value dependency changed at held D1 execution rejects the whole operation`,
    {
      tag: [
        "@native",
        "@http",
        "@account-clock-matrix",
        "@risk-freshness",
        "@risk-atomicity",
        "@risk-recovery",
      ],
    },
    async ({ causal: app, playwright }) => {
      const scenario = await prepare(app, playwright, recipe);
      try {
        const release = await park(app, () =>
          scenario.context.post(recipe.path, { data: scenario.body })
        );
        if (recipe.name === "own phone change") {
          await app.db
            .prepare(
              "UPDATE person_profile SET phone_shared = 1 WHERE user_id = ?"
            )
            .bind(scenario.targetId)
            .run();
        } else if (recipe.name === "Staff identity correction") {
          await app.db
            .prepare("UPDATE user SET name = ? WHERE id = ?")
            .bind(`Intervening ${randomUUID()}`, scenario.targetId)
            .run();
        } else {
          await app.db
            .prepare("UPDATE user SET display_username = ? WHERE id = ?")
            .bind(`Intervening.${randomUUID().slice(0, 8)}`, scenario.targetId)
            .run();
        }
        const beforeRelease = await snapshot(app);
        const response = await release();
        expect(response.status()).toBe(409);
        const body = await response.json();
        expect(body.error.code).toBe("stale_identity");
        expect(await snapshot(app)).toEqual(beforeRelease);
      } finally {
        await app.control.release();
        await Promise.all(
          scenario.contexts.map((context) => context.dispose())
        );
      }
    }
  );
}

const auditInvalidations = [
  {
    name: "NULL password",
    sql: "UPDATE account SET password=NULL WHERE user_id=?",
    status: 401,
  },
  {
    name: "empty password",
    sql: "UPDATE account SET password='' WHERE user_id=?",
    status: 401,
  },
  {
    name: "credential revision",
    sql: "UPDATE account SET credential_revision=credential_revision+1 WHERE user_id=?",
    status: 401,
  },
  {
    name: "temporary credential",
    sql: "UPDATE account SET temporary_password_expires_at=unixepoch()+604800 WHERE user_id=?",
    status: 401,
  },
  {
    name: "Ban",
    sql: "UPDATE person_profile SET banned_at=unixepoch() WHERE user_id=?",
    status: 403,
  },
  {
    name: "deactivation",
    sql: "UPDATE person_profile SET membership_status='deactivated' WHERE user_id=?",
    status: 403,
  },
  {
    name: "role loss",
    sql: "UPDATE person_profile SET account_role='member' WHERE user_id=?",
    status: 403,
  },
  {
    name: "genuine expiry",
    sql: "UPDATE session SET expires_at=unixepoch()+1 WHERE user_id=?",
    status: 401,
  },
] as const;

for (const surface of ["JSON", "HTML", "RSC"] as const) {
  for (const change of auditInvalidations) {
    const stages =
      surface === "JSON"
        ? (["list", "detail"] as const)
        : (["detail"] as const);
    for (const stage of stages) {
      test(
        `Audit ${surface}: ${change.name} at held ${stage} read withholds private output`,
        {
          tag: [
            "@native",
            "@http",
            "@account-clock-matrix",
            "@risk-privacy",
            "@risk-authorization",
            "@risk-freshness",
          ],
        },
        async ({ causal: app, playwright }, testInfo) => {
          const holder = person();
          const userId = await app.provision.account({
            ...holder,
            membershipStatus: "active",
            role: "staff",
          });
          const context = await actor(playwright, app);
          try {
            const login = await context.post("/api/auth/sign-in/username", {
              data: { password: holder.password, username: holder.username },
            });
            expect(login.status()).toBe(200);
            const applicant = person();
            const created = await context.post("/api/v2/applications", {
              data: applicant,
            });
            expect(created.status()).toBe(201);
            const application = await app.db
              .prepare(
                "SELECT a.id FROM membership_application a JOIN user u ON u.id=a.user_id WHERE u.username=?"
              )
              .bind(applicant.username)
              .first<{ id: string }>();
            if (!application) {
              throw new Error("Synthetic Audit application missing");
            }
            const note = `held-Audit-private-${randomUUID()}`;
            const decision = await context.post(
              "/api/v2/staff/application-decisions",
              {
                data: {
                  applicationId: application.id,
                  internalNote: note,
                  operationKey: randomUUID(),
                  outcome: "rejected",
                  visibleReason: "Synthetic public reason",
                },
              }
            );
            expect(decision.status()).toBe(201);
            const body = await decision.json();
            const recordId = body.data.decision.id;
            const path = `${surface === "JSON" ? "/api/v2" : ""}/staff/account-audit?record=${recordId}${surface === "RSC" ? `&_rsc=${randomUUID()}` : ""}`;
            const renderHeaders: Record<string, string> =
              surface === "RSC" ? { RSC: "1" } : {};
            const options = {
              headers: renderHeaders,
              maxRedirects: 0,
            };
            const positive = await context.get(path, {
              ...options,
              maxRedirects: 3,
            });
            await testInfo.attach("audit-positive-boundary", {
              body: JSON.stringify({
                headers: positive.headers(),
                status: positive.status(),
              }),
              contentType: "application/json",
            });
            expect(positive.status()).toBe(200);
            if (surface === "RSC") {
              expect(positive.headers()["content-type"]).toContain(
                "text/x-component"
              );
            }
            expect(await positive.text()).toContain(note);
            await app.control.armAuditRead(stage);
            const pending = context.get(positive.url(), options);
            // eslint-disable-next-line promise/prefer-await-to-callbacks -- Observe rejection while the real native request is held.
            const outcome = pending.then(
              (response) => response.status(),
              String
            );
            try {
              await expect
                .poll(async () => {
                  const state = await app.control.held();
                  return state.held;
                })
                .toBe(true);
              await app.db.prepare(change.sql).bind(userId).run();
              if (change.name === "genuine expiry") {
                await expect
                  .poll(async () => {
                    const deadline = await app.db
                      .prepare(
                        "SELECT expires_at<=unixepoch() AS expired FROM session WHERE user_id=?"
                      )
                      .bind(userId)
                      .first<{ expired: number }>();
                    return deadline?.expired;
                  })
                  .toBe(1);
              }
              const before = await snapshot(app);
              await app.control.release();
              const denied = await pending;
              const text = await denied.text();
              const after = await snapshot(app);
              await testInfo.attach("audit-read-state", {
                body: JSON.stringify({
                  afterRows: after.map((rows) => rows.length),
                  afterSha256: createHash("sha256")
                    .update(JSON.stringify(after))
                    .digest("hex"),
                  beforeRows: before.map((rows) => rows.length),
                  beforeSha256: createHash("sha256")
                    .update(JSON.stringify(before))
                    .digest("hex"),
                }),
                contentType: "application/json",
              });
              await testInfo.attach("audit-held-read-disposition", {
                body: JSON.stringify({
                  barrier: await app.control.held(),
                  invalidation: change.name,
                  noteDisclosed: text.includes(note),
                  status: denied.status(),
                  surface,
                }),
                contentType: "application/json",
              });
              expect(text).not.toContain(note);
              if (surface === "JSON") {
                expect(denied.status()).toBe(change.status);
              } else if (change.status === 401) {
                // SSR may stream a redirect in an HTTP200 shell; it must be an actual denial/redirect payload.
                if (surface === "RSC") {
                  expect(text).toMatch(
                    /NEXT_REDIRECT;(?:replace;|;)(?:%2F|\/)sign-in(?:;307;)?/u
                  );
                } else {
                  expect(text + JSON.stringify(denied.headers())).toContain(
                    "/sign-in"
                  );
                }
              } else {
                expect(text).toContain("沒有帳戶管理權限");
              }
              expect(after).toEqual(before);
            } finally {
              await app.control.release();
              await outcome;
            }
          } finally {
            await context.dispose();
          }
        }
      );
    }
  }
}

const emptyCreationEffects = {
  audits: 0,
  credentials: 0,
  plaintext: 0,
  profiles: 0,
  receipts: 0,
  reservations: 0,
  users: 0,
};

const creationAuthorityChanges = [
  {
    code: "business_access_denied",
    name: "Staff role loss",
    sql: "UPDATE person_profile SET account_role = 'member' WHERE user_id = ?",
    status: 403,
    subject: "actor",
  },
  {
    code: "business_access_denied",
    name: "membership deactivation",
    sql: "UPDATE person_profile SET membership_status = 'deactivated' WHERE user_id = ?",
    status: 403,
    subject: "actor",
  },
  {
    code: "business_access_denied",
    name: "Security Ban",
    sql: "UPDATE person_profile SET banned_at = unixepoch() WHERE user_id = ?",
    status: 403,
    subject: "actor",
  },
  {
    code: "password_confirmation_required",
    name: "password confirmation revocation",
    sql: "UPDATE session SET confirmation_operation_id = NULL WHERE id = ?",
    status: 403,
    subject: "session",
  },
  {
    code: "unauthorized",
    name: "session expiry",
    sql: "UPDATE session SET expires_at = 0 WHERE id = ?",
    status: 401,
    subject: "session",
  },
  {
    code: "unauthorized",
    name: "credential revision change",
    sql: "UPDATE account SET credential_revision = credential_revision + 1 WHERE user_id = ?",
    status: 401,
    subject: "actor",
  },
] as const;

for (const change of creationAuthorityChanges) {
  test(
    `assisted creation: ${change.name} changed at held D1 execution denies every creation effect`,
    {
      tag: [
        "@native",
        "@http",
        "@account-assisted",
        "@account-clock-matrix",
        "@risk-authority",
        "@risk-atomicity",
      ],
    },
    async ({ causal: app, playwright }) => {
      const staff = await prepareStaffCreation(app, playwright);
      try {
        const initialEffects = await creationEffects(
          app,
          staff.input.username,
          null
        );
        expect(initialEffects).toEqual(emptyCreationEffects);
        const initialLedgerEffects = await creationLedgerEffects(
          app,
          staff.userId,
          staff.input.operationKey
        );
        expect(initialLedgerEffects).toEqual({ audits: 0, receipts: 0 });
        const release = await park(app, () =>
          staff.context.post("/api/v2/staff/accounts", {
            data: staff.input,
            headers: { "x-efcc-expected-actor-id": staff.userId },
          })
        );
        const subjectId =
          change.subject === "session" ? staff.sessionId : staff.userId;
        await app.db.prepare(change.sql).bind(subjectId).run();
        const beforeRelease = await snapshot(app);
        expect(await creationEffects(app, staff.input.username, null)).toEqual(
          initialEffects
        );
        expect(
          await creationLedgerEffects(
            app,
            staff.userId,
            staff.input.operationKey
          )
        ).toEqual(initialLedgerEffects);

        const body = await expectResponseStatus(await release(), change.status);
        expect(body).toMatchObject({ error: { code: change.code } });
        expect(await snapshot(app)).toEqual(beforeRelease);
        expect(await creationEffects(app, staff.input.username, null)).toEqual(
          initialEffects
        );
        expect(
          await creationLedgerEffects(
            app,
            staff.userId,
            staff.input.operationKey
          )
        ).toEqual(initialLedgerEffects);
      } finally {
        await app.control.release();
        await staff.context.dispose();
      }
    }
  );
}

test(
  "assisted creation: unchanged confirmed Staff authority commits the complete creation once",
  {
    tag: [
      "@native",
      "@http",
      "@account-assisted",
      "@account-clock-matrix",
      "@risk-authority",
      "@risk-atomicity",
    ],
  },
  async ({ causal: app, playwright }) => {
    const staff = await prepareStaffCreation(app, playwright);
    try {
      const initialEffects = await creationEffects(
        app,
        staff.input.username,
        null
      );
      expect(initialEffects).toEqual(emptyCreationEffects);
      expect(
        await creationLedgerEffects(app, staff.userId, staff.input.operationKey)
      ).toEqual({ audits: 0, receipts: 0 });
      const release = await park(app, () =>
        staff.context.post("/api/v2/staff/accounts", {
          data: staff.input,
          headers: { "x-efcc-expected-actor-id": staff.userId },
        })
      );
      const response = await release();
      expect(response.status()).toBe(201);
      const payload = (await response.json()) as {
        data: {
          receipt: {
            action: string;
            id: string;
            targetUserId: string;
          };
          temporaryPassword: string;
          temporaryPasswordExpiresAt: number;
        };
      };
      const { receipt, temporaryPassword, temporaryPasswordExpiresAt } =
        payload.data;
      expect(receipt.action).toBe("assisted_account_created");
      expect(receipt.targetUserId).toBeTruthy();
      expect(temporaryPassword.length).toBe(32);
      expect(temporaryPasswordExpiresAt).toBeGreaterThan(0);
      expect(
        await creationEffects(app, staff.input.username, temporaryPassword)
      ).toEqual({
        ...emptyCreationEffects,
        audits: 1,
        credentials: 1,
        profiles: 1,
        receipts: 1,
        reservations: 1,
        users: 1,
      });
      expect(
        await creationLedgerEffects(app, staff.userId, staff.input.operationKey)
      ).toEqual({ audits: 1, receipts: 1 });
      const persisted = await app.db
        .prepare(
          `SELECT u.id, a.credential_revision, a.temporary_password_expires_at,
            p.account_role, p.banned_at, p.membership_status, p.name_lookup_key,
            p.phone, p.staff_search_key
          FROM user u
          JOIN account a ON a.user_id = u.id
          JOIN person_profile p ON p.user_id = u.id
          WHERE u.username = ?`
        )
        .bind(staff.input.username)
        .first<{
          account_role: string;
          banned_at: number | null;
          credential_revision: number;
          id: string;
          membership_status: string;
          name_lookup_key: string;
          phone: string;
          staff_search_key: string;
          temporary_password_expires_at: number;
        }>();
      expect(persisted).toEqual({
        account_role: "member",
        banned_at: null,
        credential_revision: 0,
        id: receipt.targetUserId,
        membership_status: "active",
        name_lookup_key: expect.any(String),
        phone: `+852${staff.input.phone}`,
        staff_search_key: expect.any(String),
        temporary_password_expires_at: temporaryPasswordExpiresAt,
      });
      expect(
        await app.db
          .prepare(
            "SELECT user_id FROM username_reservation WHERE username_key = ?"
          )
          .bind(staff.input.username.toLowerCase())
          .first()
      ).toEqual({ user_id: receipt.targetUserId });
      expect(
        await app.db
          .prepare(
            `SELECT o.actor_user_id, o.actor_session_id,
              o.actor_credential_revision, o.confirmation_operation_id,
              a.actor_user_id AS audit_actor_user_id
            FROM staff_account_operation o
            JOIN audit_event a ON a.id = o.id
            WHERE o.id = ? AND o.action = 'assisted_account_created'`
          )
          .bind(receipt.id)
          .first()
      ).toEqual({
        actor_credential_revision: 0,
        actor_session_id: staff.sessionId,
        actor_user_id: staff.userId,
        audit_actor_user_id: staff.userId,
        confirmation_operation_id: expect.any(String),
      });
    } finally {
      await app.control.release();
      await staff.context.dispose();
    }
  }
);
