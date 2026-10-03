import { timingSafeEqual } from "node:crypto";

import { env } from "cloudflare:workers";
import * as z from "zod";

import { getAuth } from "../../server/auth";
import { canonicalNameKey } from "../identity/name-matching";

const MAX_REQUEST_BYTES = 8192;
const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_REQUESTS = 10;
const encoder = new TextEncoder();
const usernamePattern = /^[A-Za-z0-9_.]{3,30}$/u;

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

const phoneToCanonical = (value: string): string | null => {
  const compact = value
    .normalize("NFKC")
    .trim()
    .replaceAll(/[ .()-]/gu, "");
  const local = /^[2-9]\d{7}$/u.exec(compact)?.[0];
  if (local) {
    return `+852${local}`;
  }
  const hongKong = /^\+?852(?<subscriber>[2-9]\d{7})$/u.exec(compact)?.groups
    ?.subscriber;
  if (hongKong) {
    return `+852${hongKong}`;
  }
  if (/^\+?852/u.test(compact)) {
    return null;
  }
  return /^\+[1-9]\d{7,14}$/u.test(compact) ? compact : null;
};

const isValidFullName = (value: string): boolean => {
  const { length } = [...value];
  return (
    length >= 1 &&
    length <= 100 &&
    canonicalNameKey(value).length > 0 &&
    !/\p{Cc}/u.test(value)
  );
};

const boundedNote = z
  .string()
  .max(1000)
  .refine((value) => [...value].length <= 500);

const applicationBodySchema = z.strictObject({
  email: z
    .string()
    .max(512)
    .transform((value) => value.trim().toLowerCase())
    .pipe(z.email().max(254))
    .refine(
      (value) => !value.slice(value.lastIndexOf("@")).endsWith(".invalid")
    ),
  fullName: z.string().max(200).refine(isValidFullName),
  group: boundedNote.optional(),
  intent: boundedNote.optional(),
  operationKey: z
    .string()
    .regex(/^[\da-f]{64}$/iu)
    .transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(128),
  phone: z
    .string()
    .max(40)
    .refine((value) => phoneToCanonical(value) !== null)
    .transform((value) => phoneToCanonical(value) ?? ""),
  referral: boundedNote.optional(),
  username: z.string().regex(usernamePattern),
});

const reconciliationBodySchema = z.strictObject({
  operationKey: z
    .string()
    .regex(/^[\da-f]{64}$/iu)
    .transform((value) => value.toLowerCase()),
});

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

export const parseApplicationRequest = async (
  request: Request
): Promise<ApplicationInput> => {
  const parsed = applicationBodySchema.safeParse(
    await readBoundedJson(request)
  );
  if (!parsed.success) {
    throw validationError();
  }
  return parsed.data;
};

export const parseReconciliationRequest = async (
  request: Request
): Promise<z.infer<typeof reconciliationBodySchema>> => {
  const parsed = reconciliationBodySchema.safeParse(
    await readBoundedJson(request)
  );
  if (!parsed.success) {
    throw validationError();
  }
  return parsed.data;
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
  action: "create" | "reconcile" | "decision" | "decision-reconcile"
): Promise<void> => {
  if (!sameOriginRequest(request)) {
    throw new ApplicationRequestError(
      403,
      "origin_denied",
      "只允許同一來源提交申請。"
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

const findOperation = (keyHash: string): Promise<OperationRow | null> =>
  env.DB.prepare(
    `SELECT request_hash AS requestHash
     FROM membership_application
     WHERE operation_key_hash = ?
     LIMIT 1`
  )
    .bind(keyHash)
    .first<OperationRow>();

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
  username: string,
  email: string,
  phone: string
): Promise<boolean> => {
  const row = await env.DB.prepare(
    `SELECT
       EXISTS(SELECT 1 FROM username_reservation WHERE username_key = ?) OR
       EXISTS(SELECT 1 FROM user WHERE lower(trim(email)) = ?) OR
       EXISTS(SELECT 1 FROM person_profile WHERE phone = ?) AS conflicting`
  )
    .bind(username, email, phone)
    .first<{ conflicting: number }>();
  if (!row) {
    throw new Error("Identity conflict check returned no row.");
  }
  return row.conflicting !== 0;
};

export const createApplication = async (
  input: ApplicationInput
): Promise<"created" | "replay"> => {
  const keyBytes = operationKeyBytes(input.operationKey);
  const [keyHash, payloadHash] = await Promise.all([
    operationKeyHash(keyBytes),
    requestHash(keyBytes, input),
  ]);

  const previous = await findOperation(keyHash);
  if (previous) {
    return assertMatchingReplay(previous, payloadHash);
  }

  const authContext = await getAuth().$context;
  const passwordHash = await authContext.password.hash(input.password);
  const userId = crypto.randomUUID();
  const applicationId = crypto.randomUUID();
  const credentialId = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const username = input.username.toLowerCase();
  const nameLookupKey = canonicalNameKey(input.fullName);

  // Constraints and guards arbitrate concurrent creates inside one D1 transaction.
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO user
           (id, created_at, display_username, email, email_verified, name, updated_at, username)
         VALUES (?, ?, ?, ?, 0, ?, ?, ?)`
      ).bind(
        userId,
        now,
        input.username,
        input.email,
        input.fullName,
        now,
        username
      ),
      env.DB.prepare(
        `INSERT INTO account
           (id, account_id, created_at, password, provider_id, updated_at, user_id)
         VALUES (?, ?, ?, ?, 'credential', ?, ?)`
      ).bind(credentialId, userId, now, passwordHash, now, userId),
      env.DB.prepare(
        `INSERT INTO person_profile
           (banned_at, created_at, membership_status, name_lookup_key, phone, updated_at, user_id)
         VALUES (NULL, ?, 'pending', ?, ?, ?, ?)`
      ).bind(now, nameLookupKey, input.phone, now, userId),
      env.DB.prepare(
        `INSERT INTO audit_event
           (action, actor_user_id, created_at, id, target_user_id)
         VALUES ('self_application_created', ?, ?, ?, ?)`
      ).bind(userId, now, auditId, userId),
      env.DB.prepare(
        `INSERT INTO membership_application
           (created_at, group_note, id, intent_note, operation_key_hash,
            referral_note, request_hash, status, user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
      ).bind(
        now,
        input.group ?? null,
        applicationId,
        input.intent ?? null,
        keyHash,
        input.referral ?? null,
        payloadHash,
        userId
      ),
    ]);
    return "created";
  } catch (error) {
    const committed = await findOperation(keyHash);
    if (committed) {
      return assertMatchingReplay(committed, payloadHash);
    }
    if (await hasIdentityConflict(username, input.email, input.phone)) {
      throw conflictError();
    }
    throw error;
  }
};

export const reconcileApplication = async (
  operationKey: string
): Promise<"pending" | "not_found"> => {
  const keyHash = await operationKeyHash(operationKeyBytes(operationKey));
  return (await findOperation(keyHash)) ? "pending" : "not_found";
};
