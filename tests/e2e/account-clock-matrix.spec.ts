import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";
import type {
  APIRequestContext,
  APIResponse,
  PlaywrightWorkerArgs,
} from "@playwright/test";

import { apiTransportHeaders, E2E_BASE_URL } from "../scenarios/local-env";
import { queryLocalSql, runLocalSql, seedSyntheticAccounts } from "./seed";
import {
  createApprovedMember,
  createStaffActor,
  syntheticPerson,
  syntheticPhone,
  userIdOf,
} from "./staff-fixture";
import type { SyntheticPerson } from "./staff-fixture";

/**
 * Execution-time authority deadlines through the real writer -> Worker -> D1
 * seam. The clock harness parks an already-built ordered batch, the suite then
 * moves the persisted deadline past the run's real time, and the released
 * batch must refuse the write. Both suites use the unchanged production SQL;
 * only the batch start is delayed.
 */
const clockPort = 5344;
const clockOrigin = `http://localhost:${clockPort}`;

type PlaywrightClient = PlaywrightWorkerArgs["playwright"];

let harness: { close: () => Promise<void>; log: () => string } | undefined;

const startClockHarness = async () => {
  const assets = mkdtempSync(path.join(tmpdir(), "efcc-clock-matrix-"));
  const worker = spawn(
    path.resolve("node_modules/.bin/wrangler"),
    [
      "dev",
      "tests/worker/clock-matrix.ts",
      "--config",
      "wrangler.jsonc",
      "--assets",
      assets,
      "--local",
      "--port",
      String(clockPort),
      "--inspector-port",
      "0",
      "--var",
      `BETTER_AUTH_TRUSTED_ORIGINS:${E2E_BASE_URL},${clockOrigin}`,
    ],
    {
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  const closed = once(worker, "close");
  let log = "";
  const record = (chunk: string) => {
    log += chunk;
  };
  worker.stdout?.setEncoding("utf-8").on("data", record);
  worker.stderr?.setEncoding("utf-8").on("data", record);
  const close = async () => {
    worker.kill("SIGTERM");
    try {
      await closed;
    } finally {
      rmSync(assets, { force: true, recursive: true });
    }
  };
  try {
    await expect
      .poll(
        async () => {
          try {
            const response = await fetch(`${clockOrigin}/health`);
            return response.status;
          } catch {
            return 0;
          }
        },
        { timeout: 30_000 }
      )
      .toBe(200);
  } catch (error) {
    await close();
    throw error;
  }
  return { close, log: () => log };
};

const clockActor = (playwright: PlaywrightClient) =>
  playwright.request.newContext({
    baseURL: clockOrigin,
    extraHTTPHeaders: {
      ...apiTransportHeaders,
      "cf-connecting-ip": `198.30.${randomBytes(1)[0]}.${randomBytes(1)[0]}`,
      origin: clockOrigin,
    },
  });

/** A clock-origin context carrying an established actor's cookies. */
const clockWriter = async (
  playwright: PlaywrightClient,
  source: APIRequestContext
): Promise<APIRequestContext> => {
  const storageState = await source.storageState();
  return playwright.request.newContext({
    baseURL: clockOrigin,
    extraHTTPHeaders: {
      ...apiTransportHeaders,
      "cf-connecting-ip": `198.31.${randomBytes(1)[0]}.${randomBytes(1)[0]}`,
      origin: clockOrigin,
    },
    storageState,
  });
};

const signInClockActor = async (
  context: APIRequestContext,
  person: SyntheticPerson
) => {
  const response = await context.post("/api/auth/sign-in/username", {
    data: { password: person.password, username: person.username },
  });
  expect(response.status(), await response.text()).toBe(200);
};

/** Writer outcome for the park-timeout message, including a rejected request. */
const describeOutcome = async (pending: Promise<APIResponse>) => {
  try {
    const response = await pending;
    return `${response.status()} ${await response.text()}`;
  } catch (error) {
    return `request failed: ${String(error)}`;
  }
};

/** Arms the harness, fires the writer, and returns the parked release task. */
const parkNextBatch = async (
  fire: () => Promise<APIResponse>
): Promise<() => Promise<APIResponse>> => {
  await fetch(`${clockOrigin}/arm`);
  const pending = fire();
  try {
    await expect
      .poll(
        async () => {
          const response = await fetch(`${clockOrigin}/held`);
          const body: unknown = await response.json();
          if (
            typeof body === "object" &&
            body !== null &&
            "held" in body &&
            typeof body.held === "boolean"
          ) {
            return body.held;
          }
          throw new Error("Clock harness returned an invalid held state");
        },
        { message: "the writer batch was never parked", timeout: 30_000 }
      )
      .toBe(true);
  } catch (error) {
    const outcome = await describeOutcome(pending);
    throw new Error(
      `the writer batch was never parked; writer outcome: ${outcome}`,
      { cause: error }
    );
  }
  return async () => {
    await fetch(`${clockOrigin}/release`);
    return pending;
  };
};

const expectStatus = async (response: APIResponse, expected: number) => {
  const body: unknown = await response.json().catch(() => null);
  expect(response.status(), JSON.stringify(body)).toBe(expected);
  return body;
};

const sessionIdOf = (username: string): string => {
  const [row] = queryLocalSql<{ id: string }>(
    `SELECT id FROM session WHERE user_id = (SELECT id FROM user WHERE username = '${username.toLowerCase()}') ORDER BY created_at DESC LIMIT 1`
  );
  if (!row) {
    throw new Error(`No stored session for ${username}`);
  }
  return row.id;
};

/** Sets a near-future session expiry while the writer's batch is parked. */
const setNearSessionExpiry = (sessionId: string): void => {
  runLocalSql(
    `UPDATE session SET expires_at = CAST(strftime('%s','now') AS INTEGER) + 4 WHERE id = '${sessionId}'`
  );
};

const waitUntilSessionExpired = (sessionId: string) =>
  expect
    .poll(
      () => {
        const [row] = queryLocalSql<{ open: number }>(
          `SELECT (expires_at > CAST(strftime('%s','now') AS INTEGER)) AS open FROM session WHERE id = '${sessionId}'`
        );
        return row?.open ?? 1;
      },
      { timeout: 20_000 }
    )
    .toBe(0);

/**
 * Seeds a genuine ten-minute confirmation boundary: the operation row and the
 * session reference are created six seconds before the window closes, exactly
 * as a real confirmation made 9m54s ago would read.
 */
const seedNearConfirmationDeadline = (sessionId: string): string => {
  const operationId = randomUUID();
  runLocalSql(
    `UPDATE session SET confirmation_operation_id = '${operationId}', password_confirmed_at = CAST(strftime('%s','now') AS INTEGER) - 594 WHERE id = '${sessionId}';
INSERT INTO audit_event (id, action, actor_user_id, target_user_id, created_at)
  SELECT '${operationId}', 'password_confirmed', s.user_id, s.user_id, s.password_confirmed_at FROM session s WHERE s.id = '${sessionId}';
INSERT INTO account_security_operation (action, created_at, credential_revision, id, operation_key, request_hash, session_id, user_id)
  SELECT 'password_confirmed', s.password_confirmed_at, s.credential_revision, '${operationId}', '${randomUUID()}', 'clock-matrix-seed', s.id, s.user_id FROM session s WHERE s.id = '${sessionId}'`
  );
  return operationId;
};

const waitUntilConfirmationStale = (sessionId: string) =>
  expect
    .poll(
      () => {
        const [row] = queryLocalSql<{ stale: number }>(
          `SELECT (CAST(strftime('%s','now') AS INTEGER) - password_confirmed_at >= 600) AS stale FROM session WHERE id = '${sessionId}'`
        );
        return row?.stale ?? 0;
      },
      { timeout: 20_000 }
    )
    .toBe(1);

const setNearTemporaryPasswordExpiry = (userId: string): void => {
  runLocalSql(
    `UPDATE account SET temporary_password_expires_at = CAST(strftime('%s','now') AS INTEGER) + 4 WHERE user_id = '${userId}'`
  );
};

const waitUntilTemporaryPasswordExpired = (userId: string) =>
  expect
    .poll(
      () => {
        const [row] = queryLocalSql<{ open: number }>(
          `SELECT (temporary_password_expires_at > CAST(strftime('%s','now') AS INTEGER)) AS open FROM account WHERE user_id = '${userId}'`
        );
        return row?.open ?? 1;
      },
      { timeout: 20_000 }
    )
    .toBe(0);

const changeCount = (table: string, where: string): number => {
  const [row] = queryLocalSql<{ n: number }>(
    `SELECT count(*) AS n FROM ${table} WHERE ${where}`
  );
  return row?.n ?? -1;
};

const identityInput = (targetUserId: string) => ({
  email: `clock.${randomBytes(5).toString("hex")}@example.com`,
  fullName: `陳時鐘${randomBytes(5).toString("hex")}`,
  identityCheck: "face_to_face" as const,
  operationKey: randomUUID(),
  phone: syntheticPhone(),
  sharedPhone: false,
  targetUserId,
  username: `Clock.${randomBytes(5).toString("hex")}`,
});

test.describe("a deadline crossed at D1 execution", () => {
  test.beforeAll(async () => {
    harness = await startClockHarness();
  });
  test.afterAll(async () => {
    await harness?.close();
    harness = undefined;
  });

  test("own phone change rejects the session that expired before its batch ran", async ({
    playwright,
  }) => {
    const context = await clockActor(playwright);
    try {
      const holder = {
        ...syntheticPerson("clock.own"),
        membershipStatus: "active" as const,
      };
      await seedSyntheticAccounts([holder]);
      await signInClockActor(context, holder);
      const holderId = userIdOf(holder.username);
      const sessionId = sessionIdOf(holder.username);
      const originalPhone = `+852${syntheticPhone()}`;
      runLocalSql(
        `UPDATE person_profile SET phone = '${originalPhone}', phone_shared = 0 WHERE user_id = '${holderId}'`
      );
      const phone = syntheticPhone();
      const operationKey = randomUUID();
      const release = await parkNextBatch(() =>
        context.post("/api/v2/account/phone", {
          data: { operationKey, phone },
        })
      );
      setNearSessionExpiry(sessionId);
      await waitUntilSessionExpired(sessionId);
      await expectStatus(await release(), 401);
      expect(
        queryLocalSql<{ phone: string }>(
          `SELECT phone FROM person_profile WHERE user_id = '${holderId}'`
        )
      ).toEqual([{ phone: originalPhone }]);
      expect(
        changeCount(
          "account_change_operation",
          `actor_user_id = '${holderId}' AND operation_key = '${operationKey}'`
        )
      ).toBe(0);
      expect(changeCount("audit_event", `actor_user_id = '${holderId}'`)).toBe(
        0
      );
    } finally {
      await context.dispose();
    }
  });

  test("Staff identity correction rejects the session that expired before its batch ran", async ({
    playwright,
  }) => {
    const staff = await createStaffActor(playwright, {
      account: syntheticPerson("clock.staff"),
    });
    const writer = await clockWriter(playwright, staff.context);
    const holder = syntheticPerson("clock.target");
    const member = await createApprovedMember(
      playwright,
      holder,
      staff.context
    );
    try {
      const targetId = userIdOf(holder.username);
      const sessionId = sessionIdOf(staff.account.username);
      const [before] = queryLocalSql<{ name: string }>(
        `SELECT name FROM user WHERE id = '${targetId}'`
      );
      const input = identityInput(targetId);
      const release = await parkNextBatch(() =>
        writer.post("/api/v2/staff/accounts/identity", { data: input })
      );
      setNearSessionExpiry(sessionId);
      await waitUntilSessionExpired(sessionId);
      await expectStatus(await release(), 401);
      expect(
        queryLocalSql<{ name: string }>(
          `SELECT name FROM user WHERE id = '${targetId}'`
        )
      ).toEqual([{ name: before?.name }]);
      expect(
        changeCount(
          "account_change_operation",
          `actor_user_id = '${staff.userId}' AND operation_key = '${input.operationKey}'`
        )
      ).toBe(0);
    } finally {
      await staff.context.dispose();
      await writer.dispose();
      await member.dispose();
    }
  });

  test("Staff identity correction rejects a confirmation that expires before its batch runs", async ({
    playwright,
  }) => {
    const staff = await createStaffActor(playwright, {
      account: syntheticPerson("clock.confirm"),
      confirmed: false,
    });
    const writer = await clockWriter(playwright, staff.context);
    const holder = syntheticPerson("clock.cftarget");
    const member = await createApprovedMember(
      playwright,
      holder,
      staff.context
    );
    try {
      const targetId = userIdOf(holder.username);
      const sessionId = sessionIdOf(staff.account.username);
      seedNearConfirmationDeadline(sessionId);
      const [before] = queryLocalSql<{ name: string }>(
        `SELECT name FROM user WHERE id = '${targetId}'`
      );
      const input = identityInput(targetId);
      const release = await parkNextBatch(() =>
        writer.post("/api/v2/staff/accounts/identity", { data: input })
      );
      await waitUntilConfirmationStale(sessionId);
      const body = await expectStatus(await release(), 403);
      expect(body).toMatchObject({
        error: { code: "password_confirmation_required" },
      });
      expect(
        queryLocalSql<{ name: string }>(
          `SELECT name FROM user WHERE id = '${targetId}'`
        )
      ).toEqual([{ name: before?.name }]);
      expect(
        changeCount(
          "account_change_operation",
          `actor_user_id = '${staff.userId}' AND operation_key = '${input.operationKey}'`
        )
      ).toBe(0);
    } finally {
      await staff.context.dispose();
      await writer.dispose();
      await member.dispose();
    }
  });

  test("restriction change rejects the session that expired before its batch ran", async ({
    playwright,
  }) => {
    const staff = await createStaffActor(playwright, {
      account: syntheticPerson("clock.restrict"),
    });
    const writer = await clockWriter(playwright, staff.context);
    const holder = syntheticPerson("clock.rttarget");
    const member = await createApprovedMember(
      playwright,
      holder,
      staff.context
    );
    try {
      const targetId = userIdOf(holder.username);
      const sessionId = sessionIdOf(staff.account.username);
      const input = {
        action: "account_banned" as const,
        operationKey: randomUUID(),
        targetUserId: targetId,
      };
      const release = await parkNextBatch(() =>
        writer.post("/api/v2/staff/accounts/restrictions", { data: input })
      );
      setNearSessionExpiry(sessionId);
      await waitUntilSessionExpired(sessionId);
      await expectStatus(await release(), 401);
      expect(
        queryLocalSql<{ banned_at: number | null; membership_status: string }>(
          `SELECT banned_at, membership_status FROM person_profile WHERE user_id = '${targetId}'`
        )
      ).toEqual([{ banned_at: null, membership_status: "active" }]);
      expect(
        changeCount(
          "account_change_operation",
          `actor_user_id = '${staff.userId}' AND operation_key = '${input.operationKey}'`
        )
      ).toBe(0);
    } finally {
      await staff.context.dispose();
      await writer.dispose();
      await member.dispose();
    }
  });

  test("password change rejects the temporary credential that expired before its batch ran", async ({
    playwright,
  }) => {
    const context = await clockActor(playwright);
    try {
      const holder = {
        ...syntheticPerson("clock.temp"),
        membershipStatus: "active" as const,
      };
      await seedSyntheticAccounts([holder]);
      await signInClockActor(context, holder);
      const holderId = userIdOf(holder.username);
      const operationKey = randomUUID();
      const release = await parkNextBatch(() =>
        context.post("/api/v2/account/password", {
          data: {
            currentPassword: holder.password,
            newPassword: "Synthetic-clock-rotated-password!",
            operationKey,
          },
        })
      );
      setNearTemporaryPasswordExpiry(holderId);
      await waitUntilTemporaryPasswordExpired(holderId);
      const response = await release();
      const responseBody: unknown = await response.json().catch(() => null);
      expect(response.ok(), JSON.stringify(responseBody)).toBe(false);
      const [account] = queryLocalSql<{
        credential_revision: number;
        temporary_password_expires_at: number | null;
      }>(
        `SELECT credential_revision, temporary_password_expires_at FROM account WHERE user_id = '${holderId}'`
      );
      expect(account?.credential_revision).toBe(0);
      expect(account?.temporary_password_expires_at).not.toBeNull();
      expect(
        changeCount(
          "account_security_operation",
          `user_id = '${holderId}' AND operation_key = '${operationKey}'`
        )
      ).toBe(0);
    } finally {
      await context.dispose();
    }
  });

  test("password change rejects the session that expired before its batch ran", async ({
    playwright,
  }) => {
    const context = await clockActor(playwright);
    try {
      const holder = {
        ...syntheticPerson("clock.psession"),
        membershipStatus: "active" as const,
      };
      await seedSyntheticAccounts([holder]);
      await signInClockActor(context, holder);
      const holderId = userIdOf(holder.username);
      const sessionId = sessionIdOf(holder.username);
      const operationKey = randomUUID();
      const release = await parkNextBatch(() =>
        context.post("/api/v2/account/password", {
          data: {
            currentPassword: holder.password,
            newPassword: "Synthetic-clock-session-password!",
            operationKey,
          },
        })
      );
      setNearSessionExpiry(sessionId);
      await waitUntilSessionExpired(sessionId);
      await expectStatus(await release(), 401);
      const [account] = queryLocalSql<{ credential_revision: number }>(
        `SELECT credential_revision FROM account WHERE user_id = '${holderId}'`
      );
      expect(account?.credential_revision).toBe(0);
      expect(
        changeCount(
          "account_security_operation",
          `user_id = '${holderId}' AND operation_key = '${operationKey}'`
        )
      ).toBe(0);
    } finally {
      await context.dispose();
    }
  });

  test("revoking other sessions rejects the session that expired before its batch ran", async ({
    playwright,
  }) => {
    const context = await clockActor(playwright);
    const second = await clockActor(playwright);
    try {
      const holder = {
        ...syntheticPerson("clock.revoke"),
        membershipStatus: "active" as const,
      };
      await seedSyntheticAccounts([holder]);
      await signInClockActor(context, holder);
      const holderId = userIdOf(holder.username);
      const sessionId = sessionIdOf(holder.username);
      await signInClockActor(second, holder);
      expect(changeCount("session", `user_id = '${holderId}'`)).toBe(2);
      const operationKey = randomUUID();
      const release = await parkNextBatch(() =>
        context.post("/api/v2/account/sessions/revoke-others", {
          data: { operationKey },
        })
      );
      setNearSessionExpiry(sessionId);
      await waitUntilSessionExpired(sessionId);
      await expectStatus(await release(), 401);
      expect(changeCount("session", `user_id = '${holderId}'`)).toBe(2);
      expect(
        changeCount(
          "account_security_operation",
          `user_id = '${holderId}' AND operation_key = '${operationKey}'`
        )
      ).toBe(0);
    } finally {
      await context.dispose();
      await second.dispose();
    }
  });

  test("password confirmation rejects the session that expired before its batch ran", async ({
    playwright,
  }) => {
    const context = await clockActor(playwright);
    try {
      const holder = {
        ...syntheticPerson("clock.confirmpw"),
        membershipStatus: "active" as const,
      };
      await seedSyntheticAccounts([holder]);
      await signInClockActor(context, holder);
      const holderId = userIdOf(holder.username);
      const sessionId = sessionIdOf(holder.username);
      const operationKey = randomUUID();
      const release = await parkNextBatch(() =>
        context.post("/api/v2/account/password-confirmation", {
          data: { operationKey, password: holder.password },
        })
      );
      setNearSessionExpiry(sessionId);
      await waitUntilSessionExpired(sessionId);
      await expectStatus(await release(), 401);
      expect(
        queryLocalSql<{
          confirmation_operation_id: string | null;
          password_confirmed_at: number | null;
        }>(
          `SELECT confirmation_operation_id, password_confirmed_at FROM session WHERE id = '${sessionId}'`
        )
      ).toEqual([
        { confirmation_operation_id: null, password_confirmed_at: null },
      ]);
      expect(
        changeCount(
          "account_security_operation",
          `user_id = '${holderId}' AND operation_key = '${operationKey}'`
        )
      ).toBe(0);
    } finally {
      await context.dispose();
    }
  });

  test("application decision rejects the session that expired before its batch ran", async ({
    playwright,
  }) => {
    const staff = await createStaffActor(playwright, {
      account: syntheticPerson("clock.decider"),
    });
    const writer = await clockWriter(playwright, staff.context);
    const applicant = syntheticPerson("clock.applicant");
    const applicantContext = await clockActor(playwright);
    try {
      const created = await applicantContext.post("/api/v2/applications", {
        data: applicant,
      });
      expect(created.status(), await created.text()).toBe(201);
      const applicantId = userIdOf(applicant.username);
      const [application] = queryLocalSql<{ id: string }>(
        `SELECT id FROM membership_application WHERE user_id = '${applicantId}'`
      );
      if (!application) {
        throw new Error("Synthetic application is missing");
      }
      const sessionId = sessionIdOf(staff.account.username);
      const operationKey = randomUUID();
      const release = await parkNextBatch(() =>
        writer.post("/api/v2/staff/application-decisions", {
          data: {
            applicationId: application.id,
            operationKey,
            outcome: "approved",
          },
        })
      );
      setNearSessionExpiry(sessionId);
      await waitUntilSessionExpired(sessionId);
      const response = await release();
      const responseBody: unknown = await response.json().catch(() => null);
      expect(response.ok(), JSON.stringify(responseBody)).toBe(false);
      expect(
        queryLocalSql<{ status: string }>(
          `SELECT status FROM membership_application WHERE id = '${application.id}'`
        )
      ).toEqual([{ status: "pending" }]);
      expect(
        queryLocalSql<{ membership_status: string }>(
          `SELECT membership_status FROM person_profile WHERE user_id = '${applicantId}'`
        )
      ).toEqual([{ membership_status: "pending" }]);
      expect(
        changeCount(
          "application_decision",
          `actor_user_id = '${staff.userId}' AND operation_key = '${operationKey}'`
        )
      ).toBe(0);
    } finally {
      await staff.context.dispose();
      await writer.dispose();
      await applicantContext.dispose();
    }
  });

  test("applicant correction rejects the session that expired before its batch ran", async ({
    playwright,
  }) => {
    const context = await clockActor(playwright);
    try {
      const applicant = syntheticPerson("clock.applicant2");
      const submitted = await context.post("/api/v2/applications", {
        data: applicant,
      });
      expect(submitted.status(), await submitted.text()).toBe(201);
      await signInClockActor(context, applicant);
      const applicantId = userIdOf(applicant.username);
      const sessionId = sessionIdOf(applicant.username);
      const [application] = queryLocalSql<{ id: string }>(
        `SELECT id FROM membership_application WHERE user_id = '${applicantId}'`
      );
      if (!application) {
        throw new Error("Synthetic application is missing");
      }
      const [before] = queryLocalSql<{ email: string; name: string }>(
        `SELECT email, name FROM user WHERE id = '${applicantId}'`
      );
      const correction = {
        action: "application_corrected" as const,
        applicationId: application.id,
        email: `clock.corrected.${randomBytes(5).toString("hex")}@example.com`,
        fullName: `陳更正${randomBytes(5).toString("hex")}`,
        operationKey: randomUUID(),
        phone: syntheticPhone(),
      };
      const release = await parkNextBatch(() =>
        context.post("/api/v2/applications/actions", { data: correction })
      );
      setNearSessionExpiry(sessionId);
      await waitUntilSessionExpired(sessionId);
      await expectStatus(await release(), 401);
      expect(
        queryLocalSql<{ email: string; name: string }>(
          `SELECT email, name FROM user WHERE id = '${applicantId}'`
        )
      ).toEqual([{ email: before?.email, name: before?.name }]);
      expect(
        changeCount(
          "applicant_operation",
          `user_id = '${applicantId}' AND operation_key = '${correction.operationKey}'`
        )
      ).toBe(0);
      expect(
        changeCount(
          "audit_event",
          `actor_user_id = '${applicantId}' AND action = 'application_corrected'`
        )
      ).toBe(0);
    } finally {
      await context.dispose();
    }
  });
});

test.describe("an unexpired deadline at D1 execution", () => {
  test.beforeAll(async () => {
    harness = await startClockHarness();
  });
  test.afterAll(async () => {
    await harness?.close();
    harness = undefined;
  });

  test("own phone change commits after its parked batch resumes", async ({
    playwright,
  }) => {
    const context = await clockActor(playwright);
    try {
      const holder = {
        ...syntheticPerson("clock.own.ok"),
        membershipStatus: "active" as const,
      };
      await seedSyntheticAccounts([holder]);
      await signInClockActor(context, holder);
      const holderId = userIdOf(holder.username);
      const phone = syntheticPhone();
      const canonicalPhone = `+852${phone}`;
      const operationKey = randomUUID();
      const release = await parkNextBatch(() =>
        context.post("/api/v2/account/phone", {
          data: { operationKey, phone },
        })
      );
      await expectStatus(await release(), 201);
      expect(
        queryLocalSql<{ phone: string }>(
          `SELECT phone FROM person_profile WHERE user_id = '${holderId}'`
        )
      ).toEqual([{ phone: canonicalPhone }]);
      expect(
        changeCount(
          "account_change_operation",
          `actor_user_id = '${holderId}' AND operation_key = '${operationKey}'`
        )
      ).toBe(1);
    } finally {
      await context.dispose();
    }
  });

  test("Staff identity correction commits with a fresh confirmation after its parked batch resumes", async ({
    playwright,
  }) => {
    const staff = await createStaffActor(playwright, {
      account: syntheticPerson("clock.staff.ok"),
    });
    const writer = await clockWriter(playwright, staff.context);
    const holder = syntheticPerson("clock.target.ok");
    const member = await createApprovedMember(
      playwright,
      holder,
      staff.context
    );
    try {
      const targetId = userIdOf(holder.username);
      const input = identityInput(targetId);
      const release = await parkNextBatch(() =>
        writer.post("/api/v2/staff/accounts/identity", { data: input })
      );
      await expectStatus(await release(), 201);
      expect(
        queryLocalSql<{ name: string }>(
          `SELECT name FROM user WHERE id = '${targetId}'`
        )
      ).toEqual([{ name: input.fullName }]);
      expect(
        changeCount(
          "account_change_operation",
          `actor_user_id = '${staff.userId}' AND operation_key = '${input.operationKey}'`
        )
      ).toBe(1);
    } finally {
      await staff.context.dispose();
      await writer.dispose();
      await member.dispose();
    }
  });

  test("application decision commits after its parked batch resumes", async ({
    playwright,
  }) => {
    const staff = await createStaffActor(playwright, {
      account: syntheticPerson("clock.decider.ok"),
    });
    const writer = await clockWriter(playwright, staff.context);
    const applicant = syntheticPerson("clock.applicant.ok");
    const applicantContext = await clockActor(playwright);
    try {
      const created = await applicantContext.post("/api/v2/applications", {
        data: applicant,
      });
      expect(created.status(), await created.text()).toBe(201);
      const applicantId = userIdOf(applicant.username);
      const [application] = queryLocalSql<{ id: string }>(
        `SELECT id FROM membership_application WHERE user_id = '${applicantId}'`
      );
      if (!application) {
        throw new Error("Synthetic application is missing");
      }
      const operationKey = randomUUID();
      const release = await parkNextBatch(() =>
        writer.post("/api/v2/staff/application-decisions", {
          data: {
            applicationId: application.id,
            operationKey,
            outcome: "approved",
          },
        })
      );
      await expectStatus(await release(), 201);
      expect(
        queryLocalSql<{ status: string }>(
          `SELECT status FROM membership_application WHERE id = '${application.id}'`
        )
      ).toEqual([{ status: "approved" }]);
      expect(
        queryLocalSql<{ membership_status: string }>(
          `SELECT membership_status FROM person_profile WHERE user_id = '${applicantId}'`
        )
      ).toEqual([{ membership_status: "active" }]);
      expect(
        changeCount(
          "application_decision",
          `actor_user_id = '${staff.userId}' AND operation_key = '${operationKey}'`
        )
      ).toBe(1);
    } finally {
      await staff.context.dispose();
      await writer.dispose();
      await applicantContext.dispose();
    }
  });

  test("applicant correction commits after its parked batch resumes", async ({
    playwright,
  }) => {
    const context = await clockActor(playwright);
    try {
      const applicant = syntheticPerson("clock.applicant.ok2");
      const submitted = await context.post("/api/v2/applications", {
        data: applicant,
      });
      expect(submitted.status(), await submitted.text()).toBe(201);
      await signInClockActor(context, applicant);
      const applicantId = userIdOf(applicant.username);
      const [application] = queryLocalSql<{ id: string }>(
        `SELECT id FROM membership_application WHERE user_id = '${applicantId}'`
      );
      if (!application) {
        throw new Error("Synthetic application is missing");
      }
      const correction = {
        action: "application_corrected" as const,
        applicationId: application.id,
        email: `clock.ok.${randomBytes(5).toString("hex")}@example.com`,
        fullName: `陳正常更正${randomBytes(5).toString("hex")}`,
        operationKey: randomUUID(),
        phone: syntheticPhone(),
      };
      const release = await parkNextBatch(() =>
        context.post("/api/v2/applications/actions", { data: correction })
      );
      await expectStatus(await release(), 201);
      expect(
        queryLocalSql<{ email: string; name: string }>(
          `SELECT email, name FROM user WHERE id = '${applicantId}'`
        )
      ).toEqual([{ email: correction.email, name: correction.fullName }]);
      expect(
        changeCount(
          "applicant_operation",
          `user_id = '${applicantId}' AND operation_key = '${correction.operationKey}'`
        )
      ).toBe(1);
    } finally {
      await context.dispose();
    }
  });
});
