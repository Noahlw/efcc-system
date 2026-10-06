import { randomBytes, randomUUID } from "node:crypto";

import { expect } from "@playwright/test";
import type {
  APIRequestContext,
  APIResponse,
  PlaywrightWorkerArgs,
} from "@playwright/test";

import { E2E_BASE_URL } from "../scenarios/local-env";
import { queryLocalSql, runLocalSql, seedSyntheticAccounts } from "./seed";

type PlaywrightClient = PlaywrightWorkerArgs["playwright"];

/** The harness's exact failure behavior; keeps response access for callers. */
export const status = async (
  promise: Promise<APIResponse>,
  expected: number
) => {
  const response = await promise;
  expect(response.status()).toBe(expected);
  return response;
};

export interface SyntheticPerson {
  email: string;
  fullName: string;
  operationKey: string;
  password: string;
  phone: string;
  username: string;
}

export const syntheticPhone = () =>
  String(60_000_000 + (randomBytes(4).readUInt32BE() % 10_000_000));

export const syntheticPerson = (namespace: string): SyntheticPerson => {
  const suffix = randomBytes(5).toString("hex");
  return {
    email: `${namespace}.${suffix}@example.com`,
    fullName: `陳資料${suffix}`,
    operationKey: randomBytes(32).toString("hex"),
    password: "Synthetic-identity-password!",
    phone: syntheticPhone(),
    username: `${namespace}.${suffix}`,
  };
};

/** A fresh API context with the harness's trusted origin and a distinct IP. */
export const apiContext = (playwright: PlaywrightClient, ipPrefix: string) =>
  playwright.request.newContext({
    baseURL: E2E_BASE_URL,
    extraHTTPHeaders: {
      "cf-connecting-ip": `${ipPrefix}.${randomBytes(1)[0]}.${randomBytes(1)[0]}`,
      origin: E2E_BASE_URL,
    },
  });

/** The account id a fixture just created; fails loudly instead of guessing. */
export const userIdOf = (username: string): string => {
  const [row] = queryLocalSql<{ id: string }>(
    `SELECT id FROM user WHERE username='${username}'`
  );
  if (!row) {
    throw new Error(`Synthetic account ${username} missing`);
  }
  return row.id;
};

export interface StaffActor {
  account: SyntheticPerson;
  context: APIRequestContext;
  userId: string;
}

/**
 * The ordered Staff protocol the identity, restriction and deletion suites
 * repeat: seed an active account, grant the role, sign in, then (unless the
 * case deliberately tests a stale confirmation) confirm the current password.
 * The caller owns the context and disposes it in its fixture teardown.
 */
export const createStaffActor = async (
  playwright: PlaywrightClient,
  {
    account = syntheticPerson("staff"),
    confirmed = true,
    role = "staff",
  }: {
    account?: SyntheticPerson;
    confirmed?: boolean;
    role?: "admin" | "staff";
  } = {}
): Promise<StaffActor> => {
  await seedSyntheticAccounts([{ ...account, membershipStatus: "active" }]);
  const userId = userIdOf(account.username);
  runLocalSql(
    `UPDATE person_profile SET account_role='${role}' WHERE user_id='${userId}'`
  );
  const context = await apiContext(playwright, "198.25");
  await status(
    context.post("/api/auth/sign-in/username", {
      data: { password: account.password, username: account.username },
    }),
    200
  );
  if (confirmed) {
    await status(
      context.post("/api/v2/account/password-confirmation", {
        data: { operationKey: randomUUID(), password: account.password },
      }),
      201
    );
  }
  return { account, context, userId };
};

/**
 * Signed-in member whose application the shared Staff actor approved; the
 * caller disposes the returned context.
 */
export const createApprovedMember = async (
  playwright: PlaywrightClient,
  holder: SyntheticPerson,
  staff: APIRequestContext
): Promise<APIRequestContext> => {
  const context = await apiContext(playwright, "198.26");
  await status(context.post("/api/v2/applications", { data: holder }), 201);
  await status(
    context.post("/api/auth/sign-in/username", {
      data: { password: holder.password, username: holder.username },
    }),
    200
  );
  const own = await status(context.get("/api/v2/applications/mine"), 200);
  const body = (await own.json()) as {
    data: { application: { id: string } };
  };
  await status(
    staff.post("/api/v2/staff/application-decisions", {
      data: {
        applicationId: body.data.application.id,
        operationKey: randomUUID(),
        outcome: "approved",
      },
    }),
    201
  );
  return context;
};
