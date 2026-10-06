import { spawn } from "node:child_process";
/* eslint-disable no-await-in-loop -- Stateful permission and limiter checks require ordered requests. */
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";

import { expect, test } from "@playwright/test";
import type { APIRequestContext, APIResponse } from "@playwright/test";

import { E2E_BASE_URL } from "../scenarios/local-env";
import { queryLocalSql, runLocalSql, seedSyntheticAccounts } from "./seed";

const syntheticHolder = () => {
  const suffix = randomBytes(6).toString("hex");
  return {
    email: `assisted.${suffix}@example.invalid`,
    fullName: `陳協助${suffix}`,
    membershipStatus: "active" as const,
    password: "Synthetic-staff-password!",
    username: `assisted.${suffix}`,
  };
};
const status = async (pending: Promise<APIResponse>, expected: number) => {
  const response = await pending;
  expect(response.status()).toBe(expected);
  return response;
};
const assistedTest = test.extend<{
  staff: APIRequestContext;
  staffUserId: string;
}>({
  staff: async ({ playwright, staffUserId }, use) => {
    const [holder] = queryLocalSql<{ username: string }>(
      `SELECT username FROM user WHERE id='${staffUserId}'`
    );
    if (!holder) {
      throw new Error("Synthetic Staff missing");
    }
    const context = await playwright.request.newContext({
      baseURL: E2E_BASE_URL,
      extraHTTPHeaders: {
        "cf-connecting-ip": `198.19.${randomBytes(1)[0]}.${randomBytes(1)[0]}`,
        origin: E2E_BASE_URL,
      },
    });
    await status(
      context.post("/api/auth/sign-in/username", {
        data: {
          password: "Synthetic-staff-password!",
          username: holder.username,
        },
      }),
      200
    );
    await status(
      context.post("/api/v2/account/password-confirmation", {
        data: {
          operationKey: randomUUID(),
          password: "Synthetic-staff-password!",
        },
      }),
      201
    );
    await use(context);
    await context.dispose();
  },
  staffUserId: async ({ baseURL }, use) => {
    expect(baseURL).toBe(E2E_BASE_URL);
    const holder = syntheticHolder();
    await seedSyntheticAccounts([holder]);
    const [row] = queryLocalSql<{ id: string }>(
      `SELECT id FROM user WHERE username='${holder.username}'`
    );
    if (!row) {
      throw new Error("Synthetic Staff missing");
    }
    runLocalSql(
      `UPDATE person_profile SET account_role='staff' WHERE user_id='${row.id}'`
    );
    await use(row.id);
  },
});

const creation = () => {
  const suffix = randomBytes(6).toString("hex");
  return {
    email: null,
    fullName: `陳新會員${suffix}`,
    identityCheck: "face_to_face",
    operationKey: randomUUID(),
    phone: String(60_000_000 + (Number.parseInt(suffix, 16) % 10_000_000)),
    sharedPhone: false,
    username: `created.${suffix}`,
  };
};

assistedTest(
  "paused old-password native sign-in cannot mint a session across Staff recovery",
  async ({ staff }) => {
    const assets = mkdtempSync(nodePath.join(tmpdir(), "efcc-staff-race-"));
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
        stdio: ["ignore", "ignore", "ignore"],
      }
    );
    const closed = once(worker, "close");
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
      for (const choice of ["username", "name"]) {
        const holder = syntheticHolder();
        await seedSyntheticAccounts([holder]);
        const [target] = queryLocalSql<{ id: string }>(
          `SELECT id FROM user WHERE username='${holder.username}'`
        );
        if (!target) {
          throw new Error("Synthetic target missing");
        }
        await fetch("http://localhost:5200/arm");
        const oldSignIn = fetch(
          `http://localhost:5200/api/auth/sign-in/${choice}`,
          {
            body: JSON.stringify(
              choice === "username"
                ? { password: holder.password, username: holder.username }
                : { fullName: holder.fullName, password: holder.password }
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
        await status(
          staff.post("/api/v2/staff/accounts/password-reset", {
            data: {
              identityCheck: "face_to_face",
              operationKey: randomUUID(),
              targetUserId: target.id,
            },
          }),
          201
        );
        await fetch("http://localhost:5200/release");
        const response = await oldSignIn;
        expect(response.status).toBe(401);
        expect(response.headers.has("set-cookie")).toBe(false);
        expect(
          queryLocalSql(
            `SELECT count(*) AS count FROM session WHERE user_id='${target.id}'`
          )
        ).toEqual([{ count: 0 }]);
      }
    } finally {
      await fetch("http://localhost:5200/release").catch(() => null);
      worker.kill("SIGTERM");
      await closed;
      rmSync(assets, { force: true, recursive: true });
    }
  }
);

assistedTest(
  "concurrent matching recovery returns one issuance and never replays plaintext",
  async ({ staff }) => {
    const holder = syntheticHolder();
    await seedSyntheticAccounts([holder]);
    const [target] = queryLocalSql<{ id: string }>(
      `SELECT id FROM user WHERE username='${holder.username}'`
    );
    if (!target) {
      throw new Error("Synthetic target missing");
    }
    const data = {
      identityCheck: "face_to_face",
      operationKey: randomUUID(),
      targetUserId: target.id,
    };
    const responses = await Promise.all([
      staff.post("/api/v2/staff/accounts/password-reset", { data }),
      staff.post("/api/v2/staff/accounts/password-reset", { data }),
    ]);
    expect(responses.map((response) => response.status()).toSorted()).toEqual([
      200, 201,
    ]);
    const bodies = await Promise.all(
      responses.map((response) => response.json())
    );
    expect(bodies[0].data.receipt).toEqual(bodies[1].data.receipt);
    expect(
      bodies.filter((body) => typeof body.data.temporaryPassword === "string")
    ).toHaveLength(1);
    expect(
      queryLocalSql(
        `SELECT count(*) AS count FROM audit_event WHERE target_user_id='${target.id}' AND action='staff_password_reset'`
      )
    ).toEqual([{ count: 1 }]);
    await status(
      staff.post("/api/v2/staff/accounts/password-reset", {
        data: { ...data, identityCheck: "verified_phone" },
      }),
      409
    );
  }
);

assistedTest(
  "new Staff commands retain origin checks and separate action limits",
  async ({ staff }) => {
    for (const endpoint of [
      "/api/v2/staff/accounts",
      "/api/v2/staff/accounts/password-reset",
      "/api/v2/staff/accounts/password-reissue",
      "/api/v2/staff/accounts/reconcile",
    ]) {
      await status(
        staff.post(endpoint, {
          data: {},
          headers: { origin: "https://evil.example" },
        }),
        403
      );
      for (let index = 0; index < 10; index += 1) {
        await status(staff.post(endpoint, { data: {} }), 400);
      }
      await status(staff.post(endpoint, { data: {} }), 429);
    }
    await status(staff.get("/api/v2/staff/accounts"), 200);
  }
);

for (const table of ["account", "person_profile", "audit_event"]) {
  for (const failure of [
    "ABORT, 'Synthetic assisted write failure'",
    "IGNORE",
  ]) {
    assistedTest(
      `assisted creation ${table} ${failure} leaves no partial canonical account`,
      async ({ staff }) => {
        const input = creation();
        const trigger = `synthetic_assisted_${randomBytes(8).toString("hex")}`;
        const field = table === "audit_event" ? "target_user_id" : "user_id";
        runLocalSql(`CREATE TRIGGER ${trigger} BEFORE INSERT ON ${table}
    WHEN NEW.${field}=(SELECT id FROM user WHERE username='${input.username}') BEGIN SELECT RAISE(${failure}); END;`);
        try {
          const response = await status(
            staff.post("/api/v2/staff/accounts", { data: input }),
            500
          );
          expect(await response.json()).toMatchObject({
            error: { code: "internal_error" },
          });
          expect(
            queryLocalSql(
              `SELECT count(*) AS count FROM user WHERE username='${input.username}'`
            )
          ).toEqual([{ count: 0 }]);
          expect(
            queryLocalSql(
              `SELECT count(*) AS count FROM username_reservation WHERE username_key='${input.username}'`
            )
          ).toEqual([{ count: 0 }]);
        } finally {
          runLocalSql(`DROP TRIGGER ${trigger}`);
        }
        await status(
          staff.post("/api/v2/staff/accounts", { data: input }),
          201
        );
      }
    );
  }
}

for (const table of [
  "account",
  "audit_event",
  "session",
  "staff_account_operation",
]) {
  for (const failure of ["ABORT, 'Synthetic recovery failure'", "IGNORE"]) {
    assistedTest(
      `recovery ${table} ${failure} rolls back credential, temporary state, sessions and audit`,
      async ({ staff, playwright }) => {
        const holder = syntheticHolder();
        await seedSyntheticAccounts([holder]);
        const [target] = queryLocalSql<{ id: string }>(
          `SELECT id FROM user WHERE username='${holder.username}'`
        );
        if (!target) {
          throw new Error("Synthetic target missing");
        }
        const person = await playwright.request.newContext({
          baseURL: E2E_BASE_URL,
          extraHTTPHeaders: {
            "cf-connecting-ip": `198.19.${randomBytes(1)[0]}.${randomBytes(1)[0]}`,
            origin: E2E_BASE_URL,
          },
        });
        await status(
          person.post("/api/auth/sign-in/username", {
            data: { password: holder.password, username: holder.username },
          }),
          200
        );
        const before = queryLocalSql(
          `SELECT password,credential_revision AS revision,temporary_password_expires_at AS expiry FROM account WHERE user_id='${target.id}'`
        );
        const trigger = `synthetic_recovery_${randomBytes(8).toString("hex")}`;
        const field =
          table === "audit_event" || table === "staff_account_operation"
            ? "target_user_id"
            : "user_id";
        const event = {
          account: "UPDATE",
          audit_event: "INSERT",
          session: "DELETE",
          staff_account_operation: "INSERT",
        }[table];
        const row = table === "session" ? "OLD" : "NEW";
        runLocalSql(
          `CREATE TRIGGER ${trigger} BEFORE ${event} ON ${table} WHEN ${row}.${field}='${target.id}' BEGIN SELECT RAISE(${failure}); END;`
        );
        const data = {
          identityCheck: "face_to_face",
          operationKey: randomUUID(),
          targetUserId: target.id,
        };
        try {
          await status(
            staff.post("/api/v2/staff/accounts/password-reset", { data }),
            500
          );
          expect(
            queryLocalSql(
              `SELECT password,credential_revision AS revision,temporary_password_expires_at AS expiry FROM account WHERE user_id='${target.id}'`
            )
          ).toEqual(before);
          await status(person.get("/api/v2/me"), 200);
          expect(
            queryLocalSql(
              `SELECT count(*) AS count FROM audit_event WHERE target_user_id='${target.id}' AND action='staff_password_reset'`
            )
          ).toEqual([{ count: 0 }]);
          const check = await staff.post("/api/v2/staff/accounts/reconcile", {
            data: { operationKey: data.operationKey },
          });
          const body = await check.json();
          expect(body.data.receipt).toBeNull();
        } finally {
          runLocalSql(`DROP TRIGGER ${trigger}`);
          await person.dispose();
        }
        await status(
          staff.post("/api/v2/staff/accounts/password-reset", { data }),
          201
        );
      }
    );
  }
}

assistedTest(
  "fresh confirmation and fixed Staff target rules cannot be bypassed",
  async ({ staff, staffUserId }) => {
    const holders = [syntheticHolder(), syntheticHolder(), syntheticHolder()];
    await seedSyntheticAccounts(holders);
    const ids = holders.map((holder) => {
      const [row] = queryLocalSql<{ id: string }>(
        `SELECT id FROM user WHERE username='${holder.username}'`
      );
      if (!row) {
        throw new Error("Synthetic target missing");
      }
      return row.id;
    });
    runLocalSql(
      `UPDATE person_profile SET account_role='staff' WHERE user_id='${ids[0]}'; UPDATE person_profile SET account_role='admin' WHERE user_id='${ids[1]}'`
    );
    for (const targetUserId of [staffUserId, ids[0], ids[1]]) {
      await status(
        staff.post("/api/v2/staff/accounts/password-reset", {
          data: {
            identityCheck: "face_to_face",
            operationKey: randomUUID(),
            targetUserId,
          },
        }),
        403
      );
    }
    runLocalSql(
      `UPDATE session SET password_confirmed_at=CAST(strftime('%s','now') AS INTEGER)-601 WHERE user_id='${staffUserId}'`
    );
    await status(
      staff.post("/api/v2/staff/accounts", { data: creation() }),
      403
    );
    await status(
      staff.post("/api/v2/staff/accounts/password-reset", {
        data: {
          identityCheck: "face_to_face",
          operationKey: randomUUID(),
          targetUserId: ids[2],
        },
      }),
      403
    );
    await status(
      staff.post("/api/v2/account/password-confirmation", {
        data: { operationKey: randomUUID(), password: "Wrong-password!" },
      }),
      400
    );
    await status(
      staff.post("/api/v2/staff/accounts/password-reset", {
        data: {
          identityCheck: "face_to_face",
          operationKey: randomUUID(),
          targetUserId: ids[2],
        },
      }),
      403
    );
    await status(
      staff.post("/api/v2/account/password-confirmation", {
        data: {
          operationKey: randomUUID(),
          password: "Synthetic-staff-password!",
        },
      }),
      201
    );
    const editedPhone = `+852${creation().phone}`;
    const verifiedPhone = `+852${creation().phone}`;
    runLocalSql(
      `UPDATE person_profile SET phone='${editedPhone}',verified_recovery_phone='${verifiedPhone}' WHERE user_id='${ids[2]}'`
    );
    await status(
      staff.post("/api/v2/staff/accounts/password-reset", {
        data: {
          identityCheck: "verified_phone",
          operationKey: randomUUID(),
          targetUserId: ids[2],
        },
      }),
      201
    );
  }
);

assistedTest(
  "face-to-face shared phone exception does not weaken public uniqueness",
  async ({ staff, playwright }) => {
    const first = creation();
    const second = { ...creation(), phone: first.phone, sharedPhone: true };
    await status(staff.post("/api/v2/staff/accounts", { data: first }), 201);
    await status(
      staff.post("/api/v2/staff/accounts", {
        data: { ...second, sharedPhone: false },
      }),
      409
    );
    await status(staff.post("/api/v2/staff/accounts", { data: second }), 201);
    const publicRequest = await playwright.request.newContext({
      baseURL: E2E_BASE_URL,
      extraHTTPHeaders: {
        "cf-connecting-ip": "198.19.9.12",
        origin: E2E_BASE_URL,
      },
    });
    try {
      const third = creation();
      await status(
        publicRequest.post("/api/v2/applications", {
          data: {
            email: `phone.${randomBytes(6).toString("hex")}@example.test`,
            fullName: third.fullName,
            operationKey: randomBytes(32).toString("hex"),
            password: "Synthetic-unique-phone!",
            phone: first.phone,
            username: third.username,
          },
        }),
        409
      );
    } finally {
      await publicRequest.dispose();
    }
  }
);

assistedTest(
  "sibling self-application and decision receipts roll back ignored final writes",
  async ({ staff, playwright }) => {
    const input = {
      ...creation(),
      email: `guard.${randomBytes(6).toString("hex")}@example.test`,
      operationKey: randomBytes(32).toString("hex"),
      password: "Synthetic-receipt-guard!",
    };
    const application = {
      email: input.email,
      fullName: input.fullName,
      operationKey: input.operationKey,
      password: input.password,
      phone: input.phone,
      username: input.username,
    };
    const publicRequest = await playwright.request.newContext({
      baseURL: E2E_BASE_URL,
      extraHTTPHeaders: {
        "cf-connecting-ip": "198.19.9.11",
        origin: E2E_BASE_URL,
      },
    });
    const creationTrigger = `synthetic_app_receipt_${randomBytes(8).toString("hex")}`;
    runLocalSql(`CREATE TRIGGER ${creationTrigger} BEFORE INSERT ON membership_application
  WHEN NEW.user_id=(SELECT id FROM user WHERE username='${input.username}') BEGIN SELECT RAISE(IGNORE); END;`);
    try {
      await status(
        publicRequest.post("/api/v2/applications", { data: application }),
        500
      );
      expect(
        queryLocalSql(
          `SELECT count(*) AS count FROM user WHERE username='${input.username}'`
        )
      ).toEqual([{ count: 0 }]);
    } finally {
      runLocalSql(`DROP TRIGGER ${creationTrigger}`);
    }
    await status(
      publicRequest.post("/api/v2/applications", { data: application }),
      201
    );
    const [row] = queryLocalSql<{ id: string; userId: string }>(
      `SELECT a.id,a.user_id AS userId FROM membership_application a JOIN user u ON u.id=a.user_id WHERE u.username='${input.username}'`
    );
    if (!row) {
      throw new Error("Synthetic application missing");
    }
    const operationKey = randomUUID();
    const decisionTrigger = `synthetic_decision_receipt_${randomBytes(8).toString("hex")}`;
    runLocalSql(`CREATE TRIGGER ${decisionTrigger} BEFORE INSERT ON application_decision
  WHEN NEW.operation_key='${operationKey}' BEGIN SELECT RAISE(IGNORE); END;`);
    const decision = {
      applicationId: row.id,
      operationKey,
      outcome: "approved",
    };
    try {
      await status(
        staff.post("/api/v2/staff/application-decisions", { data: decision }),
        500
      );
      expect(
        queryLocalSql(`SELECT a.status,p.membership_status AS membership,
   (SELECT count(*) FROM audit_event WHERE target_user_id='${row.userId}' AND action='application_approved') AS audits
   FROM membership_application a JOIN person_profile p ON p.user_id=a.user_id WHERE a.id='${row.id}'`)
      ).toEqual([{ audits: 0, membership: "pending", status: "pending" }]);
    } finally {
      runLocalSql(`DROP TRIGGER ${decisionTrigger}`);
      await publicRequest.dispose();
    }
    await status(
      staff.post("/api/v2/staff/application-decisions", { data: decision }),
      201
    );
  }
);

assistedTest(
  "ignored own-security receipt leaves the current password and session intact",
  async ({ staff, staffUserId }) => {
    const operationKey = randomUUID();
    const trigger = `synthetic_own_receipt_${randomBytes(8).toString("hex")}`;
    runLocalSql(`CREATE TRIGGER ${trigger} BEFORE INSERT ON account_security_operation
  WHEN NEW.operation_key='${operationKey}' BEGIN SELECT RAISE(IGNORE); END;`);
    const before = queryLocalSql(
      `SELECT password,credential_revision AS revision FROM account WHERE user_id='${staffUserId}'`
    );
    const data = {
      currentPassword: "Synthetic-staff-password!",
      newPassword: "Synthetic-new-own-password!",
      operationKey,
    };
    try {
      await status(staff.post("/api/v2/account/password", { data }), 500);
      expect(
        queryLocalSql(
          `SELECT password,credential_revision AS revision FROM account WHERE user_id='${staffUserId}'`
        )
      ).toEqual(before);
      await status(staff.get("/api/v2/me"), 200);
    } finally {
      runLocalSql(`DROP TRIGGER ${trigger}`);
    }
    await status(staff.post("/api/v2/account/password", { data }), 201);
  }
);

assistedTest(
  "an ignored final receipt cannot leave an orphan assisted account or audit",
  async ({ staff }) => {
    const input = creation();
    const trigger = `synthetic_ignored_staff_receipt_${randomBytes(8).toString("hex")}`;
    runLocalSql(`CREATE TRIGGER ${trigger} BEFORE INSERT ON staff_account_operation
  WHEN NEW.operation_key='${input.operationKey}' BEGIN SELECT RAISE(IGNORE); END;`);
    try {
      await status(staff.post("/api/v2/staff/accounts", { data: input }), 500);
      expect(
        queryLocalSql(
          `SELECT count(*) AS count FROM user WHERE username='${input.username}'`
        )
      ).toEqual([{ count: 0 }]);
      expect(
        queryLocalSql(
          `SELECT count(*) AS count FROM username_reservation WHERE username_key='${input.username}'`
        )
      ).toEqual([{ count: 0 }]);
    } finally {
      runLocalSql(`DROP TRIGGER ${trigger}`);
    }
    await status(staff.post("/api/v2/staff/accounts", { data: input }), 201);
  }
);

assistedTest(
  "Staff recovery requires established identity evidence and revokes existing native credentials/sessions",
  async ({ staff, playwright }) => {
    const holder = syntheticHolder();
    await seedSyntheticAccounts([holder]);
    const [target] = queryLocalSql<{ id: string }>(
      `SELECT id FROM user WHERE username='${holder.username}'`
    );
    if (!target) {
      throw new Error("Synthetic target missing");
    }
    const person = await playwright.request.newContext({
      baseURL: E2E_BASE_URL,
      extraHTTPHeaders: {
        "cf-connecting-ip": "198.19.9.4",
        origin: E2E_BASE_URL,
      },
    });
    try {
      await status(
        person.post("/api/auth/sign-in/username", {
          data: { password: holder.password, username: holder.username },
        }),
        200
      );
      const data = {
        identityCheck: "face_to_face",
        operationKey: randomUUID(),
        targetUserId: target.id,
      };
      const reset = await status(
        staff.post("/api/v2/staff/accounts/password-reset", { data }),
        201
      );
      const body = await reset.json();
      expect(body.data.temporaryPassword).toHaveLength(32);
      await status(person.get("/api/v2/me"), 401);
      await status(
        person.post("/api/auth/sign-in/username", {
          data: { password: holder.password, username: holder.username },
        }),
        401
      );
      await status(
        person.post("/api/auth/sign-in/username", {
          data: {
            password: body.data.temporaryPassword,
            username: holder.username,
          },
        }),
        200
      );
      const gated = await status(person.get("/api/v2/me"), 403);
      expect(await gated.json()).toMatchObject({
        error: { code: "password_change_required" },
      });
      await status(
        staff.post("/api/v2/staff/accounts/password-reset", {
          data: {
            ...data,
            identityCheck: "verified_phone",
            operationKey: randomUUID(),
          },
        }),
        403
      );
      await status(
        staff.post("/api/v2/staff/accounts/password-reset", {
          data: { ...data, operationKey: randomUUID(), phone: "+85269999999" },
        }),
        400
      );
      const replay = await status(
        staff.post("/api/v2/staff/accounts/password-reset", { data }),
        200
      );
      const replayBody = await replay.json();
      expect(replayBody.data.receipt).toEqual(body.data.receipt);
      expect(replayBody.data.temporaryPassword).toBeUndefined();
    } finally {
      await person.dispose();
    }
  }
);

assistedTest(
  "expiry requires explicit private reissue and first change preserves ban/deactivation",
  async ({ staff, playwright }) => {
    const input = creation();
    const response = await status(
      staff.post("/api/v2/staff/accounts", { data: input }),
      201
    );
    const created = await response.json();
    const { targetUserId } = created.data.receipt;
    const person = await playwright.request.newContext({
      baseURL: E2E_BASE_URL,
      extraHTTPHeaders: {
        "cf-connecting-ip": "198.19.9.2",
        origin: E2E_BASE_URL,
      },
    });
    try {
      await status(
        person.post("/api/auth/sign-in/name", {
          data: {
            fullName: input.fullName,
            password: created.data.temporaryPassword,
          },
        }),
        200
      );
      runLocalSql(`UPDATE person_profile SET membership_status='deactivated',banned_at=CAST(strftime('%s','now') AS INTEGER) WHERE user_id='${targetUserId}';
   UPDATE account SET temporary_password_expires_at=CAST(strftime('%s','now') AS INTEGER)-1 WHERE user_id='${targetUserId}'`);
      await status(
        person.post("/api/v2/account/password", {
          data: {
            currentPassword: created.data.temporaryPassword,
            newPassword: "Synthetic-after-expiry!",
            operationKey: randomUUID(),
          },
        }),
        403
      );
      const expired = await status(
        person.post("/api/auth/sign-in/name", {
          data: {
            fullName: input.fullName,
            password: created.data.temporaryPassword,
          },
        }),
        401
      );
      expect(await expired.json()).toMatchObject({
        code: "TEMPORARY_PASSWORD_EXPIRED",
      });
      const data = {
        identityCheck: "face_to_face",
        operationKey: randomUUID(),
        targetUserId,
      };
      const issued = await status(
        staff.post("/api/v2/staff/accounts/password-reissue", { data }),
        201
      );
      const issuance = await issued.json();
      expect(issuance.data.temporaryPassword).toHaveLength(32);
      expect(issuance.data.temporaryPassword).not.toBe(
        created.data.temporaryPassword
      );
      const replay = await status(
        staff.post("/api/v2/staff/accounts/password-reissue", { data }),
        200
      );
      const replayBody = await replay.json();
      expect(replayBody.data.receipt).toEqual(issuance.data.receipt);
      expect(replayBody.data.temporaryPassword).toBeUndefined();
      await status(person.get("/api/v2/account/security"), 401);
      await status(
        person.post("/api/auth/sign-in/name", {
          data: {
            fullName: input.fullName,
            password: issuance.data.temporaryPassword,
          },
          headers: { "cf-connecting-ip": "198.19.9.3" },
        }),
        200
      );
      await status(person.get("/api/v2/me"), 403);
      await status(
        person.post("/api/v2/account/password", {
          data: {
            currentPassword: issuance.data.temporaryPassword,
            newPassword: "Synthetic-final-holder-password!",
            operationKey: randomUUID(),
          },
        }),
        201
      );
      await status(person.get("/api/v2/me"), 403);
      const current = await person.get("/api/v2/status");
      const state = await current.json();
      expect(state.data.reasons).toHaveLength(2);
      expect(
        queryLocalSql(
          `SELECT membership_status AS membership,banned_at IS NOT NULL AS banned FROM person_profile WHERE user_id='${targetUserId}'`
        )
      ).toEqual([{ banned: 1, membership: "deactivated" }]);
    } finally {
      await person.dispose();
    }
  }
);

assistedTest(
  "assisted creation is approved, private and forces native first change before business access",
  async ({ staff, playwright }) => {
    const input = creation();
    const created = await status(
      staff.post("/api/v2/staff/accounts", { data: input }),
      201
    );
    expect(created.headers()["cache-control"]).toContain("no-store");
    const body = await created.json();
    expect(body.data.temporaryPassword).toHaveLength(32);
    expect(body.data.receipt.action).toBe("assisted_account_created");
    const replay = await status(
      staff.post("/api/v2/staff/accounts", { data: input }),
      200
    );
    const replayBody = await replay.json();
    expect(replayBody.data.receipt).toEqual(body.data.receipt);
    expect(replayBody.data.temporaryPassword).toBeUndefined();
    const person = await playwright.request.newContext({
      baseURL: E2E_BASE_URL,
      extraHTTPHeaders: {
        "cf-connecting-ip": "198.19.9.1",
        origin: E2E_BASE_URL,
      },
    });
    try {
      await status(
        person.post("/api/auth/sign-in/username", {
          data: {
            password: body.data.temporaryPassword,
            username: input.username,
          },
        }),
        200
      );
      const denied = await status(person.get("/api/v2/me"), 403);
      expect(await denied.json()).toMatchObject({
        error: { code: "password_change_required" },
      });
      await status(
        person.post("/api/v2/account/sessions/revoke-others", {
          data: { operationKey: randomUUID() },
        }),
        403
      );
      const home = await person.get("/", { maxRedirects: 0 });
      expect(home.headers().location).toContain("/account");
      const stateResponse = await person.get("/api/v2/account/security");
      const state = await stateResponse.json();
      expect(state.data.state.temporaryPasswordExpiresAt).toBe(
        body.data.receipt.createdAt + 7 * 24 * 60 * 60
      );
      await status(
        person.post("/api/v2/account/password", {
          data: {
            currentPassword: body.data.temporaryPassword,
            newPassword: "Synthetic-holder-password!",
            operationKey: randomUUID(),
          },
        }),
        201
      );
      await status(person.get("/api/v2/me"), 200);
    } finally {
      await person.dispose();
    }
  }
);

assistedTest(
  "actual Staff page hands over once and recovers lost creation with explicit reissue",
  async ({ staff, staffUserId, page, browser }) => {
    const signedState = await staff.storageState();
    await page.context().addCookies(signedState.cookies);
    await page.goto("/staff/accounts");
    await page.getByRole("link", { name: /建立帳戶/u }).click();
    await expect(
      page.getByRole("button", { name: "檢查帳戶資料" })
    ).toBeEnabled();
    const input = creation();
    await page.getByLabel("中文全名", { exact: true }).fill(input.fullName);
    await page.getByLabel("使用者名稱", { exact: true }).fill(input.username);
    await page.getByLabel("電話", { exact: true }).fill(input.phone);
    await page.getByLabel("已親身核實此人的身分", { exact: true }).check();
    let createRequests = 0;
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().endsWith("/api/v2/staff/accounts")
      ) {
        createRequests += 1;
      }
    });
    await page.getByRole("button", { name: "檢查帳戶資料" }).click();
    await expect(
      page.getByRole("heading", { exact: true, name: "確認帳戶資料" })
    ).toBeVisible();
    expect(createRequests).toBe(0);
    await expect(page.getByText(input.fullName, { exact: true })).toBeVisible();
    await expect(page.getByText(input.username, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "返回修改" }).click();
    await expect(page.getByLabel("中文全名", { exact: true })).toHaveValue(
      input.fullName
    );
    await expect(page.getByLabel("使用者名稱", { exact: true })).toHaveValue(
      input.username
    );
    await page.getByRole("button", { name: "檢查帳戶資料" }).click();
    await expect(
      page.getByRole("heading", { exact: true, name: "確認帳戶資料" })
    ).toBeVisible();
    await page
      .getByRole("button", { name: "確認並建立帳戶及發出臨時密碼" })
      .click();
    await expect(page.getByLabel("新臨時密碼", { exact: true })).toBeVisible();
    expect(createRequests).toBe(1);
    const password = await page
      .getByLabel("新臨時密碼", { exact: true })
      .textContent();
    expect(password).toHaveLength(32);
    await expect(
      page.getByText(`交接對象：${input.fullName}（${input.username}）`, {
        exact: true,
      })
    ).toBeVisible();
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.getByRole("button", { name: "複製臨時密碼" }).click();
    expect(
      await page.evaluate(
        (expected) =>
          navigator.clipboard.readText().then((value) => value === expected),
        password
      )
    ).toBe(true);
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: () =>
            Promise.reject(
              new DOMException("Clipboard unavailable", "NotAllowedError")
            ),
        },
      });
    });
    await page.getByRole("button", { name: "複製臨時密碼" }).click();
    await expect(
      page.getByText("未能複製，請手動選取臨時密碼；不要把密碼寫入公開訊息。", {
        exact: true,
      })
    ).toBeVisible();
    await expect(page.getByLabel("新臨時密碼", { exact: true })).toBeVisible();
    const saved = await page.evaluate(() =>
      localStorage.getItem("efcc.staff-account.operation.v1")
    );
    expect(saved).not.toContain(password);
    expect(Object.keys(JSON.parse(saved ?? "{}")).toSorted()).toEqual([
      "action",
      "actorUserId",
      "key",
      "targetUserId",
    ]);
    await page.reload();
    await expect(page.getByRole("status")).toContainText(
      "原臨時密碼不能再次讀取"
    );
    await expect(page.getByLabel("新臨時密碼", { exact: true })).toHaveCount(0);
    const [createdTarget] = queryLocalSql<{ id: string }>(
      `SELECT id FROM user WHERE username='${input.username}'`
    );
    if (!createdTarget) {
      throw new Error("Synthetic created target missing");
    }
    await page
      .getByRole("button", { name: "重新核實並發出新臨時密碼" })
      .click();
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === "/staff/accounts" &&
        url.searchParams.get("person") === createdTarget.id &&
        url.searchParams.get("task") === "recovery" &&
        url.searchParams.get("view") === "people"
    );
    await expect(
      page.getByRole("heading", { exact: true, name: "帳戶復原" })
    ).toBeVisible();
    expect(
      await page.evaluate(() =>
        localStorage.getItem("efcc.staff-account.operation.v1")
      )
    ).toBeNull();
    await page.goto("/staff/accounts");
    await page.getByRole("link", { name: /建立帳戶/u }).click();
    const lost = creation();
    await page.route("**/api/v2/staff/accounts", async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      await route.abort("failed");
    });
    await page.route("**/api/v2/staff/accounts/reconcile", (route) =>
      route.abort("failed")
    );
    await page.getByLabel("中文全名", { exact: true }).fill(lost.fullName);
    await page.getByLabel("使用者名稱", { exact: true }).fill(lost.username);
    await page.getByLabel("電話", { exact: true }).fill(lost.phone);
    await page.getByLabel("已親身核實此人的身分", { exact: true }).check();
    await page.getByRole("button", { name: "檢查帳戶資料" }).click();
    await page
      .getByRole("button", { name: "確認並建立帳戶及發出臨時密碼" })
      .click();
    await expect(page.getByRole("status")).toContainText("結果仍未確認");
    await page.unroute("**/api/v2/staff/accounts/reconcile");
    await page.reload();
    await expect(page.getByRole("status")).toContainText(
      "伺服器已確認操作完成"
    );
    await expect(page.getByLabel("新臨時密碼", { exact: true })).toHaveCount(0);
    const [target] = queryLocalSql<{ id: string }>(
      `SELECT id FROM user WHERE username='${lost.username}'`
    );
    if (!target) {
      throw new Error("Synthetic created target missing");
    }
    await page
      .getByRole("button", { name: "重新核實並發出新臨時密碼" })
      .click();
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === "/staff/accounts" &&
        url.searchParams.get("person") === target.id &&
        url.searchParams.get("task") === "recovery" &&
        url.searchParams.get("view") === "people"
    );
    await expect(
      page.getByRole("heading", { exact: true, name: "帳戶復原" })
    ).toBeVisible();
    const verification = page.getByLabel("已按以上方式核實身分", {
      exact: false,
    });
    await verification.check();
    await page.getByRole("link", { name: "← 返回帳戶詳情" }).click();
    const leaveDialog = page.getByRole("dialog");
    await expect(leaveDialog).toBeVisible();
    await leaveDialog.getByRole("button", { name: "繼續編輯" }).click();
    await expect(verification).toBeChecked();
    await page.getByRole("link", { name: "← 返回帳戶詳情" }).click();
    await leaveDialog.getByRole("button", { name: "放棄變更" }).click();
    runLocalSql(
      `UPDATE session SET password_confirmed_at=0 WHERE user_id='${staffUserId}'`
    );
    await page.getByRole("link", { name: /帳戶復原/u }).click();
    await expect(
      page.getByLabel("已按以上方式核實身分", { exact: false })
    ).not.toBeChecked();
    await page.getByLabel("已按以上方式核實身分", { exact: false }).check();
    let resetRequests = 0;
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().endsWith("/api/v2/staff/accounts/password-reset")
      ) {
        resetRequests += 1;
      }
    });
    await page.getByRole("button", { name: "檢查重設資料" }).click();
    await expect(
      page.getByRole("heading", { exact: true, name: "核對帳戶操作" })
    ).toBeVisible();
    expect(resetRequests).toBe(0);
    await expect(
      page.getByRole("button", {
        exact: true,
        name: "確認並重設密碼及登出全部裝置",
      })
    ).toBeVisible();
    await expect(
      page.getByText(
        "發出七日有效的臨時密碼並登出對象的其他裝置；首次登入必須更改密碼",
        { exact: true }
      )
    ).toBeVisible();
    await page.getByRole("button", { name: "返回修改" }).click();
    await expect(
      page.getByLabel("已按以上方式核實身分", { exact: false })
    ).toBeChecked();
    await page.getByRole("button", { name: "檢查重設資料" }).click();
    await page
      .getByRole("button", {
        exact: true,
        name: "確認並重設密碼及登出全部裝置",
      })
      .click();
    await expect(
      page.getByRole("heading", { exact: true, name: "確認目前密碼" })
    ).toBeVisible();
    await page
      .getByLabel("目前密碼", { exact: true })
      .fill("Synthetic-staff-password!");
    const confirmationDialog = page.getByRole("dialog");
    await page
      .getByRole("button", { exact: true, name: "確認並返回檢查" })
      .click();
    await expect(confirmationDialog.getByRole("status")).toContainText(
      "伺服器已確認"
    );
    await confirmationDialog
      .getByRole("button", { exact: true, name: "確認並返回檢查" })
      .click();
    await expect(
      page.getByRole("heading", { exact: true, name: "核對帳戶操作" })
    ).toBeVisible();
    expect(resetRequests).toBe(0);
    const confirmationMetadata = await page.evaluate(() =>
      localStorage.getItem("efcc.account-security.operation.v1")
    );
    expect(confirmationMetadata).toBeNull();
    await page
      .getByRole("button", {
        exact: true,
        name: "確認並重設密碼及登出全部裝置",
      })
      .click();
    await expect(page.getByLabel("新臨時密碼", { exact: true })).toBeVisible();
    expect(resetRequests).toBe(1);
    await page.reload();
    await expect(page.getByRole("status")).toContainText(
      "原臨時密碼不能再次讀取"
    );
    await expect(page.getByLabel("新臨時密碼", { exact: true })).toHaveCount(0);
    await page
      .getByRole("button", { name: "重新核實並發出新臨時密碼" })
      .click();
    await expect(
      page.getByRole("heading", { exact: true, name: "帳戶復原" })
    ).toBeVisible();
    await page.getByLabel("已按以上方式核實身分", { exact: false }).check();
    let reissueRequests = 0;
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().endsWith("/api/v2/staff/accounts/password-reissue")
      ) {
        reissueRequests += 1;
      }
    });
    await page.getByRole("button", { name: "檢查重新發出資料" }).click();
    await expect(
      page.getByRole("heading", { exact: true, name: "核對帳戶操作" })
    ).toBeVisible();
    expect(reissueRequests).toBe(0);
    await expect(
      page.getByRole("button", {
        exact: true,
        name: "確認並重新發出臨時密碼",
      })
    ).toBeVisible();
    await page
      .getByRole("button", {
        exact: true,
        name: "確認並重新發出臨時密碼",
      })
      .click();
    await expect(page.getByLabel("新臨時密碼", { exact: true })).toBeVisible();
    expect(reissueRequests).toBe(1);
    const newPassword = await page
      .getByLabel("新臨時密碼", { exact: true })
      .textContent();
    const member = await browser.newContext({
      extraHTTPHeaders: {
        "cf-connecting-ip": "198.19.9.17",
        origin: E2E_BASE_URL,
      },
      hasTouch: true,
      isMobile: true,
      viewport: { height: 915, width: 412 },
    });
    try {
      await status(
        member.request.post(`${E2E_BASE_URL}/api/auth/sign-in/name`, {
          data: { fullName: lost.fullName, password: newPassword },
        }),
        200
      );
      const memberPage = await member.newPage();
      await memberPage.goto(`${E2E_BASE_URL}/`);
      await expect(memberPage).toHaveURL(/\/account$/u);
      await expect(
        memberPage.getByRole("link", { exact: true, name: "我的申請" })
      ).toHaveCount(0);
      await expect(
        memberPage.getByRole("button", { exact: true, name: "登出其他裝置" })
      ).toHaveCount(0);
      await memberPage
        .getByLabel("目前密碼", { exact: true })
        .fill(newPassword ?? "");
      await memberPage
        .getByLabel("新密碼", { exact: true })
        .fill("Synthetic-Android-holder-password!");
      await memberPage
        .getByLabel("再次輸入新密碼")
        .fill("Synthetic-Android-holder-password!");
      await memberPage
        .getByRole("button", { exact: true, name: "更改密碼" })
        .click();
      await expect(
        memberPage
          .getByRole("heading", { name: "操作已確認完成" })
          .locator("..")
          .getByRole("status")
      ).toContainText("伺服器已確認");
      await memberPage
        .getByRole("button", {
          exact: true,
          name: "完成，返回帳戶安全",
        })
        .click();
      await expect(memberPage).toHaveURL(/\/account$/u);
      await memberPage.getByRole("link", { exact: true, name: "主頁" }).click();
      await expect(
        memberPage.getByRole("heading", { exact: true, name: "我的主頁" })
      ).toBeVisible();
    } finally {
      await member.close();
    }
  }
);

assistedTest(
  "Staff Management distinguishes same-name permitted accounts and keeps person context when the viewport changes",
  async ({ page, staff }) => {
    const first = creation();
    const firstResponse = await status(
      staff.post("/api/v2/staff/accounts", { data: first }),
      201
    );
    const firstBody = (await firstResponse.json()) as {
      data: { receipt: { targetUserId: string } };
    };
    const second = { ...creation(), fullName: first.fullName };
    const secondResponse = await status(
      staff.post("/api/v2/staff/accounts", { data: second }),
      201
    );
    const secondBody = (await secondResponse.json()) as {
      data: { receipt: { targetUserId: string } };
    };

    const staffState = await staff.storageState();
    await page.context().addCookies(staffState.cookies);
    await page.goto("/staff/accounts");
    await expect(page.getByRole("link", { name: /角色管理/u })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /內容管理/u })).toHaveCount(0);
    await page.getByRole("link", { name: /帳戶管理/u }).click();
    await page
      .getByRole("searchbox", { name: "搜尋姓名或 Username" })
      .fill(first.fullName);
    await page
      .getByRole("searchbox", { name: "搜尋姓名或 Username" })
      .press("Enter");
    await expect(page.getByText(first.username, { exact: true })).toBeVisible();
    await expect(
      page.getByText(second.username, { exact: true })
    ).toBeVisible();

    await page
      .getByRole("link", { name: new RegExp(second.username, "u") })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`person=${secondBody.data.receipt.targetUserId}`, "u")
    );
    await expect(
      page.getByRole("heading", { exact: true, name: second.fullName })
    ).toBeVisible();
    const selectedPersonHeading = page
      .getByRole("heading", { exact: true, name: second.fullName })
      .locator("..");
    await expect(
      selectedPersonHeading.getByText(second.username, { exact: true })
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /帳戶復原/u })).toHaveAttribute(
      "href",
      new RegExp(
        `person=${secondBody.data.receipt.targetUserId}.*task=recovery`,
        "u"
      )
    );
    await expect(
      page.getByRole("navigation", { name: "主要導覽" })
    ).toBeVisible();

    await page.setViewportSize({ height: 844, width: 390 });
    await expect(
      page.getByRole("navigation", { name: "主要導覽" })
    ).toBeHidden();
    await expect(
      page.getByRole("searchbox", { name: "搜尋姓名或 Username" })
    ).toBeHidden();
    await expect(
      page.getByRole("heading", { exact: true, name: second.fullName })
    ).toBeVisible();

    await page.setViewportSize({ height: 900, width: 1280 });
    await expect(
      page.getByRole("navigation", { name: "主要導覽" })
    ).toBeVisible();
    await expect(
      selectedPersonHeading.getByText(second.username, { exact: true })
    ).toBeVisible();
    expect(firstBody.data.receipt.targetUserId).not.toBe(
      secondBody.data.receipt.targetUserId
    );

    await page.setViewportSize({ height: 844, width: 390 });
    await page.goto(
      `${E2E_BASE_URL}/staff/accounts?view=people&person=not-a-permitted-target`
    );
    await expect(
      page.getByRole("navigation", { name: "主要導覽" })
    ).toBeVisible();
    await expect(
      page.getByRole("searchbox", { name: "搜尋姓名或 Username" })
    ).toBeVisible();
    await expect(
      page.getByText("not-a-permitted-target", { exact: true })
    ).toHaveCount(0);
  }
);
