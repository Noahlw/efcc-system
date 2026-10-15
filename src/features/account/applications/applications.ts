import { timingSafeEqual } from "node:crypto";

import { and, desc, eq, exists, gt, sql, or } from "drizzle-orm";
import type * as z from "zod";

import { getAuth } from "../../../server/auth";
import { getDb, schema } from "../../../server/db/client";
import type { Database } from "../../../server/db/client";
import { requireDrizzleWrittenReceipt } from "../../../server/db/required-receipt";
import { membershipApplication } from "../../../server/db/schema/applications";
import { session, user } from "../../../server/db/schema/auth";
import { personProfile } from "../../../server/db/schema/identity";
import { canonicalNameKey } from "../../identity/name-matching";
import { accountActor } from "../account-actors";
import { BusinessApiError } from "../business-request";
import { dateToUnixSeconds } from "../timestamps";
import type { applicationBodySchema } from "./application-contract";

const encoder = new TextEncoder();

const conflictError = (): BusinessApiError =>
  new BusinessApiError(
    409,
    "conflict",
    "使用者名稱或聯絡資料已被使用，或操作代碼已用於其他資料。"
  );

type ApplicationInput = z.infer<typeof applicationBodySchema>;
interface OperationRow {
  requestHash: string;
}

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const operationKeyBytes = (operationKey: string): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(new ArrayBuffer(operationKey.length / 2));
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(
      operationKey.slice(index * 2, index * 2 + 2),
      16
    );
  }
  return bytes;
};

const operationKeyHash = async (
  key: Uint8Array<ArrayBuffer>
): Promise<string> =>
  toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", key)));

// Compare retries without persisting the operation capability or password.
const requestHash = async (
  key: Uint8Array<ArrayBuffer>,
  input: ApplicationInput
): Promise<string> => {
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    key,
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"]
  );
  const fingerprint = JSON.stringify([
    input.fullName,
    input.username,
    input.email,
    input.phone,
    input.password,
    input.referral ?? null,
    input.group ?? null,
    input.intent ?? null,
  ]);
  return toHex(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", hmacKey, encoder.encode(fingerprint))
    )
  );
};

const findOperation = async (
  database: Database,
  keyHash: string
): Promise<OperationRow | null> => {
  const row = await database
    .select({ requestHash: schema.membershipApplication.requestHash })
    .from(schema.membershipApplication)
    .where(eq(schema.membershipApplication.operationKeyHash, keyHash))
    .get();
  return row ?? null;
};
const assertMatchingReplay = (
  operation: OperationRow,
  candidateHash: string
): "replay" => {
  if (
    operation.requestHash.length !== candidateHash.length ||
    !timingSafeEqual(
      encoder.encode(operation.requestHash),
      encoder.encode(candidateHash)
    )
  ) {
    throw conflictError();
  }
  return "replay";
};

const hasIdentityConflict = async (
  database: Database,
  username: string,
  email: string,
  phone: string
): Promise<boolean> => {
  const row = await database.get<{ conflicting: number }>(sql`
    SELECT ${or(
      exists(
        database
          .select({ usernameKey: schema.usernameReservation.usernameKey })
          .from(schema.usernameReservation)
          .where(eq(schema.usernameReservation.usernameKey, username))
      ),
      exists(
        database
          .select({ id: schema.user.id })
          .from(schema.user)
          .where(eq(sql`lower(trim(${schema.user.email}))`, email))
      ),
      exists(
        database
          .select({ userId: schema.personProfile.userId })
          .from(schema.personProfile)
          .where(eq(schema.personProfile.phone, phone))
      )
    )} AS conflicting
  `);
  if (!row) {
    throw new Error("Identity conflict check returned no row.");
  }
  return row.conflicting !== 0;
};

export const createApplication = async (
  input: ApplicationInput
): Promise<"created" | "replay"> => {
  const database = getDb();
  const keyBytes = operationKeyBytes(input.operationKey);
  const [keyHash, payloadHash] = await Promise.all([
    operationKeyHash(keyBytes),
    requestHash(keyBytes, input),
  ]);

  const previous = await findOperation(database, keyHash);
  if (previous) {
    return assertMatchingReplay(previous, payloadHash);
  }

  const userId = crypto.randomUUID();
  const applicationId = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const { password } = await getAuth().$context;
  const passwordHash = await password.hash(input.password);
  const now = Math.floor(Date.now() / 1000);
  const createdAt = new Date(now * 1000);
  const username = input.username.toLowerCase();

  try {
    await database.batch([
      database.insert(schema.user).values({
        createdAt,
        displayUsername: input.username,
        email: input.email,
        emailVerified: false,
        id: userId,
        name: input.fullName,
        updatedAt: createdAt,
        username,
      }),
      database.insert(schema.account).values({
        accountId: userId,
        createdAt,
        id: crypto.randomUUID(),
        password: passwordHash,
        providerId: "credential",
        temporaryPasswordExpiresAt: null,
        updatedAt: createdAt,
        userId,
      }),
      database.insert(schema.personProfile).values({
        bannedAt: null,
        createdAt,
        membershipStatus: "pending",
        nameLookupKey: canonicalNameKey(input.fullName),
        phone: input.phone,
        phoneShared: false,
        updatedAt: createdAt,
        userId,
      }),
      database.insert(schema.auditEvent).values({
        action: "self_application_created",
        actorUserId: userId,
        createdAt,
        id: auditId,
        targetUserId: userId,
      }),
      database.insert(schema.membershipApplication).values({
        createdAt,
        groupNote: input.group ?? null,
        id: applicationId,
        intentNote: input.intent ?? null,
        operationKeyHash: keyHash,
        referralNote: input.referral ?? null,
        requestHash: payloadHash,
        status: "pending",
        userId,
      }),
      requireDrizzleWrittenReceipt(database, {
        id: applicationId,
        table: "membership_application",
      }),
    ]);
    return "created";
  } catch (error) {
    const committed = await findOperation(database, keyHash);
    if (committed) {
      return assertMatchingReplay(committed, payloadHash);
    }
    if (
      await hasIdentityConflict(database, username, input.email, input.phone)
    ) {
      throw conflictError();
    }
    throw error;
  }
};

export const reconcileApplication = async (
  operationKey: string
): Promise<"pending" | "not_found"> => {
  const database = getDb();
  const keyHash = await operationKeyHash(operationKeyBytes(operationKey));
  return (await findOperation(database, keyHash)) ? "pending" : "not_found";
};

export interface OwnApplication {
  id: string;
  status: "pending" | "approved" | "rejected" | "withdrawn";
  fullName: string;
  username: string | null;
  email: string;
  phone: string | null;
  createdAt: number;
}

export const getOwnApplication = async (
  headers: Headers
): Promise<OwnApplication | null> => {
  const actor = accountActor(headers);
  const database = getDb();
  const row = await database
    .select({
      createdAt: membershipApplication.createdAt,
      email: user.email,
      fullName: user.name,
      id: membershipApplication.id,
      phone: personProfile.phone,
      status: membershipApplication.status,
      username: user.displayUsername,
    })
    .from(session)
    .innerJoin(user, eq(user.id, session.userId))
    .leftJoin(personProfile, eq(personProfile.userId, user.id))
    .leftJoin(
      membershipApplication,
      eq(
        membershipApplication.id,
        database
          .select({ id: membershipApplication.id })
          .from(membershipApplication)
          .where(eq(membershipApplication.userId, user.id))
          .orderBy(desc(sql`rowid`))
          .limit(1)
      )
    )
    .where(
      and(
        eq(session.id, actor.sessionId),
        eq(session.userId, actor.userId),
        gt(session.expiresAt, new Date())
      )
    )
    .get();
  if (!row) {
    throw new BusinessApiError(401, "unauthorized", "請重新登入。");
  }
  if (row.id === null || row.status === null || row.createdAt === null) {
    return null;
  }
  return {
    createdAt: dateToUnixSeconds(row.createdAt),
    email: row.email,
    fullName: row.fullName,
    id: row.id,
    phone: row.phone,
    status: row.status,
    username: row.username,
  };
};
