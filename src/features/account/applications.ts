import { timingSafeEqual } from "node:crypto";

import { env } from "cloudflare:workers";
import { eq, exists, or, sql } from "drizzle-orm";
import type * as z from "zod";

import { getAuth } from "../../server/auth";
import { getDb, schema } from "../../server/db/client";
import type { Database } from "../../server/db/client";
import { requireDrizzleWrittenReceipt } from "../../server/db/required-receipt";
import { canonicalNameKey } from "../identity/name-matching";
import type { applicationBodySchema } from "./application-contract";

export { accountIdentitySchema } from "./application-contract";

export const MAX_REQUEST_BYTES = 8192;
const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_REQUESTS = 10;
const encoder = new TextEncoder();

export class ApplicationRequestError extends Error {
  readonly code: string;
  readonly status: 400 | 401 | 403 | 409 | 429;

  constructor(
    status: 400 | 401 | 403 | 409 | 429,
    code: string,
    message: string
  ) {
    super(message);
    this.name = "ApplicationRequestError";
    this.code = code;
    this.status = status;
  }
}

const validationError = (): ApplicationRequestError =>
  new ApplicationRequestError(400, "validation_error", "申請資料格式不正確。");

const conflictError = (): ApplicationRequestError =>
  new ApplicationRequestError(
    409,
    "conflict",
    "使用者名稱或聯絡資料已被使用，或操作代碼已用於其他資料。"
  );

type ApplicationInput = z.infer<typeof applicationBodySchema>;
interface OperationRow {
  requestHash: string;
}

export const readBoundedJson = async (request: Request): Promise<unknown> => {
  const mediaType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  const contentLength = request.headers.get("content-length");
  if (
    mediaType !== "application/json" ||
    (contentLength !== null &&
      (!/^\d+$/u.test(contentLength) ||
        Number(contentLength) > MAX_REQUEST_BYTES))
  ) {
    throw validationError();
  }

  const { body } = request;
  if (!body) {
    throw validationError();
  }
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  for await (const chunk of body) {
    byteLength += chunk.byteLength;
    if (byteLength > MAX_REQUEST_BYTES) {
      throw validationError();
    }
    chunks.push(chunk);
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw validationError();
  }
};

const sameOriginRequest = (request: Request): boolean => {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  return (
    (!origin || origin === new URL(request.url).origin) &&
    (!fetchSite || fetchSite === "same-origin" || fetchSite === "none")
  );
};

export const guardApplicationRequest = async (
  request: Request,
  action:
    | "create"
    | "reconcile"
    | "decision"
    | "decision-reconcile"
    | "password-change"
    | "session-revoke"
    | "password-confirmation"
    | "security-reconcile"
    | "staff-account-create"
    | "staff-account-reconcile"
    | "staff-password-reset"
    | "staff-password-reissue"
    | "applicant-action"
    | "applicant-reconcile"
    | "own-phone"
    | "staff-identity"
    | "account-change-reconcile"
    | "account-restriction"
    | "account-deletion"
): Promise<void> => {
  if (!sameOriginRequest(request)) {
    throw new ApplicationRequestError(
      403,
      "origin_denied",
      "只允許同一來源提交請求。"
    );
  }

  const clientIp = request.headers.get("cf-connecting-ip")?.trim();
  if (!clientIp || clientIp.length > 64 || /[\s,]/u.test(clientIp)) {
    throw new ApplicationRequestError(
      429,
      "rate_limited",
      "提交次數過多，請稍後再試。"
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const result = await env.DB.prepare(
    `INSERT INTO rate_limit (id, key, count, last_request)
     VALUES (?, ?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE
         WHEN excluded.last_request - rate_limit.last_request >= ? THEN 1
         ELSE rate_limit.count + 1
       END,
       last_request = CASE
         WHEN excluded.last_request - rate_limit.last_request >= ?
           THEN excluded.last_request
         ELSE rate_limit.last_request
       END
     RETURNING count`
  )
    .bind(
      crypto.randomUUID(),
      `application:${action}:${clientIp}`,
      now,
      RATE_LIMIT_WINDOW_SECONDS,
      RATE_LIMIT_WINDOW_SECONDS
    )
    .first<{ count: number }>();

  if (!result) {
    throw new Error("Application rate limiter returned no row.");
  }
  if (result.count > RATE_LIMIT_MAX_REQUESTS) {
    throw new ApplicationRequestError(
      429,
      "rate_limited",
      "提交次數過多，請稍後再試。"
    );
  }
};

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
