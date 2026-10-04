import { createHmac } from "node:crypto";

import { env } from "cloudflare:workers";
import * as z from "zod";

import { getAuth } from "../../server/auth";
import { requireWrittenReceipt } from "../../server/db/required-receipt";
import type { accountSecurityActionValues } from "../../server/db/schema/account-security";
import { ApplicationRequestError, readBoundedJson } from "./applications";
import { accountActor } from "./decisions";
import type { AccountActor } from "./decisions";

export type AccountSecurityAction =
  (typeof accountSecurityActionValues)[number];

export interface AccountSecurityReceipt {
  id: string;
  action: AccountSecurityAction;
  createdAt: number;
}

interface CredentialActor extends AccountActor {
  accountId: string;
  credentialRevision: number;
  passwordHash: string;
  passwordConfirmedAt: number | null;
  temporaryPasswordExpiresAt: number | null;
  confirmationOperationId: string | null;
}

interface OperationRow extends AccountSecurityReceipt {
  requestHash: string;
  sessionId: string;
}

export const getCredentialActor = async (
  headers: Headers
): Promise<CredentialActor> => {
  const actor = accountActor(headers);
  const row = await env.DB.prepare(
    `SELECT a.id AS accountId, a.password AS passwordHash,
       a.credential_revision AS credentialRevision,
       a.temporary_password_expires_at AS temporaryPasswordExpiresAt,
       s.password_confirmed_at AS passwordConfirmedAt,
       s.confirmation_operation_id AS confirmationOperationId
     FROM session s INNER JOIN account a ON a.user_id = s.user_id
     WHERE s.id = ? AND s.user_id = ?
       AND s.expires_at > CAST(strftime('%s', 'now') AS INTEGER)
       AND a.provider_id = 'credential' AND a.account_id = s.user_id
       AND a.password IS NOT NULL AND s.credential_revision = a.credential_revision`
  )
    .bind(actor.sessionId, actor.userId)
    .first<Omit<CredentialActor, "userId" | "sessionId">>();
  if (!row) {
    throw new ApplicationRequestError(401, "unauthorized", "請重新登入。");
  }
  return { ...actor, ...row };
};

export const getAccountSecurityState = async (headers: Headers) => {
  const actor = await getCredentialActor(headers);
  const row = await env.DB.prepare(
    `SELECT a.temporary_password_expires_at AS temporaryPasswordExpiresAt,
      CASE WHEN a.temporary_password_expires_at <= CAST(strftime('%s', 'now') AS INTEGER) THEN 1 ELSE 0 END AS temporaryPasswordExpired,
      CASE WHEN password_confirmed_at <= CAST(strftime('%s', 'now') AS INTEGER)
       AND password_confirmed_at > CAST(strftime('%s', 'now') AS INTEGER) - 600
       AND confirmation_operation_id IS NOT NULL
       THEN password_confirmed_at + 600 ELSE NULL END AS passwordConfirmationExpiresAt
     FROM session INNER JOIN account a ON a.user_id=session.user_id AND a.account_id=session.user_id AND a.provider_id='credential' WHERE session.id = ? AND session.user_id = ?
       AND expires_at > CAST(strftime('%s', 'now') AS INTEGER)
       AND session.credential_revision = ?`
  )
    .bind(actor.sessionId, actor.userId, actor.credentialRevision)
    .first<{
      passwordConfirmationExpiresAt: number | null;
      temporaryPasswordExpiresAt: number | null;
      temporaryPasswordExpired: number;
    }>();
  if (!row) {
    throw new ApplicationRequestError(401, "unauthorized", "請重新登入。");
  }
  return {
    ...row,
    temporaryPasswordExpired: row.temporaryPasswordExpired === 1,
  };
};

const operationKeySchema = z.uuid().transform((value) => value.toLowerCase());
const currentPassword = z.string().min(1).max(128);
const securityRequestSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("password_changed"),
    input: z.strictObject({
      currentPassword,
      newPassword: z.string().min(8).max(128),
      operationKey: operationKeySchema,
    }),
  }),
  z.strictObject({
    action: z.literal("other_sessions_revoked"),
    input: z.strictObject({ operationKey: operationKeySchema }),
  }),
  z.strictObject({
    action: z.literal("password_confirmed"),
    input: z.strictObject({
      operationKey: operationKeySchema,
      password: currentPassword,
    }),
  }),
]);
const reconciliationSchema = z.strictObject({
  operationKey: operationKeySchema,
});

type SecurityInput = z.infer<typeof securityRequestSchema>;

export const parseAccountSecurityRequest = async (
  request: Request,
  action: AccountSecurityAction
): Promise<SecurityInput> => {
  const parsed = securityRequestSchema.safeParse({
    action,
    input: await readBoundedJson(request),
  });
  if (!parsed.success) {
    throw new ApplicationRequestError(
      400,
      "validation_error",
      "請填妥密碼資料；新密碼必須為 8 至 128 個字元。"
    );
  }
  return parsed.data;
};

export const parseSecurityReconciliationRequest = async (request: Request) => {
  const parsed = reconciliationSchema.safeParse(await readBoundedJson(request));
  if (!parsed.success) {
    throw new ApplicationRequestError(
      400,
      "validation_error",
      "操作代碼格式不正確。"
    );
  }
  return parsed.data;
};

const findOperation = (actor: AccountActor, key: string) =>
  env.DB.prepare(
    `SELECT o.id, o.action, o.created_at AS createdAt,
       o.request_hash AS requestHash, o.session_id AS sessionId
     FROM account_security_operation o WHERE o.user_id = ? AND o.operation_key = ?
       AND EXISTS (SELECT 1 FROM session s INNER JOIN account a ON a.user_id = s.user_id
         WHERE s.id = ? AND s.user_id = ?
           AND s.expires_at > CAST(strftime('%s', 'now') AS INTEGER)
           AND a.provider_id = 'credential' AND a.account_id = s.user_id
           AND a.password IS NOT NULL AND s.credential_revision = a.credential_revision)`
  )
    .bind(actor.userId, key, actor.sessionId, actor.userId)
    .first<OperationRow>();

const receiptProjection = (row: OperationRow): AccountSecurityReceipt => ({
  action: row.action,
  createdAt: row.createdAt,
  id: row.id,
});

const operationConflict = () =>
  new ApplicationRequestError(
    409,
    "conflict",
    "帳戶或登入狀態已改變，或操作代碼已用於其他資料。請重新查核。"
  );

const payloadHash = (
  input: SecurityInput,
  actor: AccountActor,
  sessionId: string,
  secret: string
) =>
  createHmac("sha256", secret)
    .update(
      JSON.stringify([
        actor.userId,
        sessionId,
        input.action,
        input.input.operationKey,
        "currentPassword" in input.input ? input.input.currentPassword : null,
        "newPassword" in input.input ? input.input.newPassword : null,
        "password" in input.input ? input.input.password : null,
      ])
    )
    .digest("hex");

const matchingReceipt = (
  row: OperationRow,
  input: SecurityInput,
  actor: AccountActor,
  secret: string
): AccountSecurityReceipt => {
  if (
    row.action !== input.action ||
    row.requestHash !== payloadHash(input, actor, row.sessionId, secret)
  ) {
    throw operationConflict();
  }
  return receiptProjection(row);
};

export const createAccountSecurityOperation = async (
  headers: Headers,
  input: SecurityInput
): Promise<{ receipt: AccountSecurityReceipt; created: boolean }> => {
  const actor = await getCredentialActor(headers);
  if (actor.temporaryPasswordExpiresAt !== null) {
    if (input.action !== "password_changed") {
      throw new ApplicationRequestError(
        403,
        "password_change_required",
        "請先更改臨時密碼。"
      );
    }
    if (actor.temporaryPasswordExpiresAt <= Math.floor(Date.now() / 1000)) {
      throw new ApplicationRequestError(
        403,
        "temporary_password_expired",
        "臨時密碼已到期，請聯絡職員重新發出。"
      );
    }
    if (input.input.newPassword === input.input.currentPassword) {
      throw new ApplicationRequestError(
        400,
        "validation_error",
        "請選擇另一個新密碼，不可繼續使用職員發出的臨時密碼。"
      );
    }
  }
  const authContext = await getAuth().$context;
  const previous = await findOperation(actor, input.input.operationKey);
  if (previous) {
    return {
      created: false,
      receipt: matchingReceipt(previous, input, actor, authContext.secret),
    };
  }
  if (input.action !== "other_sessions_revoked") {
    const password =
      input.action === "password_changed"
        ? input.input.currentPassword
        : input.input.password;
    if (
      !(await authContext.password.verify({
        hash: actor.passwordHash,
        password,
      }))
    ) {
      throw new ApplicationRequestError(
        400,
        "invalid_password",
        "目前密碼不正確，未有作出變更或確認。"
      );
    }
  }
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const requestHash = payloadHash(
    input,
    actor,
    actor.sessionId,
    authContext.secret
  );
  let statements: D1PreparedStatement[];
  if (input.action === "password_changed") {
    const { minPasswordLength, maxPasswordLength } =
      authContext.password.config;
    if (
      input.input.newPassword.length < minPasswordLength ||
      input.input.newPassword.length > maxPasswordLength
    ) {
      throw new ApplicationRequestError(
        400,
        "validation_error",
        "新密碼長度不符合密碼規則。"
      );
    }
    const passwordHash = await authContext.password.hash(
      input.input.newPassword
    );
    const revision = actor.credentialRevision + 1;
    statements = [
      env.DB.prepare(
        `UPDATE account SET password = ?, credential_revision = ?, temporary_password_expires_at = NULL, updated_at = ?
         WHERE id = ? AND user_id = ? AND provider_id = 'credential'
           AND account_id = user_id AND password = ? AND credential_revision = ?
           AND (temporary_password_expires_at IS NULL OR temporary_password_expires_at > CAST(strftime('%s','now') AS INTEGER))
           AND EXISTS (SELECT 1 FROM session s WHERE s.id = ? AND s.user_id = account.user_id
             AND s.expires_at > CAST(strftime('%s', 'now') AS INTEGER)
             AND s.credential_revision = account.credential_revision)`
      ).bind(
        passwordHash,
        revision,
        now,
        actor.accountId,
        actor.userId,
        actor.passwordHash,
        actor.credentialRevision,
        actor.sessionId
      ),
      env.DB.prepare(
        `UPDATE session SET credential_revision = ?, password_confirmed_at = NULL,
           confirmation_operation_id = NULL, updated_at = ?
         WHERE id = ? AND user_id = ? AND EXISTS (SELECT 1 FROM account
           WHERE id = ? AND password = ? AND credential_revision = ?)`
      ).bind(
        revision,
        now,
        actor.sessionId,
        actor.userId,
        actor.accountId,
        passwordHash,
        revision
      ),
      env.DB.prepare(
        `DELETE FROM session WHERE user_id = ? AND id <> ?
         AND EXISTS (SELECT 1 FROM account WHERE id = ? AND password = ? AND credential_revision = ?)`
      ).bind(
        actor.userId,
        actor.sessionId,
        actor.accountId,
        passwordHash,
        revision
      ),
      env.DB.prepare(
        `INSERT INTO audit_event (action, actor_user_id, created_at, id, target_user_id)
         SELECT 'password_changed', user_id, ?, ?, user_id FROM account
         WHERE id = ? AND password = ? AND credential_revision = ?`
      ).bind(now, id, actor.accountId, passwordHash, revision),
    ];
  } else if (input.action === "other_sessions_revoked") {
    statements = [
      env.DB.prepare(
        `INSERT INTO audit_event (action, actor_user_id, created_at, id, target_user_id)
         SELECT 'other_sessions_revoked', s.user_id, ?, ?, s.user_id FROM session s
         INNER JOIN account a ON a.user_id = s.user_id
         WHERE s.id = ? AND s.user_id = ?
           AND s.expires_at > CAST(strftime('%s', 'now') AS INTEGER)
           AND a.id = ? AND a.password = ? AND a.credential_revision = ?
           AND s.credential_revision = a.credential_revision`
      ).bind(
        now,
        id,
        actor.sessionId,
        actor.userId,
        actor.accountId,
        actor.passwordHash,
        actor.credentialRevision
      ),
      env.DB.prepare(
        `DELETE FROM session WHERE user_id = ? AND id <> ?
         AND EXISTS (SELECT 1 FROM audit_event WHERE id = ? AND actor_user_id = ?)`
      ).bind(actor.userId, actor.sessionId, id, actor.userId),
    ];
  } else {
    statements = [
      env.DB.prepare(
        `UPDATE session SET password_confirmed_at = ?,
           confirmation_operation_id = ?, updated_at = CAST(strftime('%s', 'now') AS INTEGER)
         WHERE id = ? AND user_id = ?
           AND expires_at > CAST(strftime('%s', 'now') AS INTEGER)
           AND credential_revision = ?
           AND EXISTS (SELECT 1 FROM account WHERE id = ? AND password = ? AND credential_revision = ?)`
      ).bind(
        now,
        id,
        actor.sessionId,
        actor.userId,
        actor.credentialRevision,
        actor.accountId,
        actor.passwordHash,
        actor.credentialRevision
      ),
      env.DB.prepare(
        `INSERT INTO audit_event (action, actor_user_id, created_at, id, target_user_id)
         SELECT 'password_confirmed', user_id, password_confirmed_at, ?, user_id
         FROM session WHERE id = ? AND user_id = ? AND confirmation_operation_id = ?`
      ).bind(id, actor.sessionId, actor.userId, id),
    ];
  }
  // Always attempt the final receipt: a skipped SELECT must not bypass its
  // completeness trigger and commit an ignored required write.
  statements.push(
    env.DB.prepare(
      `INSERT INTO account_security_operation
    (action, created_at, credential_revision, id, operation_key, request_hash, session_id, user_id)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      input.action,
      now,
      actor.credentialRevision + (input.action === "password_changed" ? 1 : 0),
      id,
      input.input.operationKey,
      requestHash,
      actor.sessionId,
      actor.userId
    ),
    requireWrittenReceipt("account_security_operation", id)
  );
  try {
    await env.DB.batch(statements);
  } catch (error) {
    const committed = await findOperation(actor, input.input.operationKey);
    if (committed) {
      return {
        created: false,
        receipt: matchingReceipt(committed, input, actor, authContext.secret),
      };
    }
    const current = await getCredentialActor(headers);
    if (current.credentialRevision !== actor.credentialRevision) {
      throw operationConflict();
    }
    throw error;
  }
  const committed = await findOperation(actor, input.input.operationKey);
  if (!committed) {
    await getCredentialActor(headers);
    throw operationConflict();
  }
  return {
    created: committed.id === id,
    receipt: matchingReceipt(committed, input, actor, authContext.secret),
  };
};

export const reconcileAccountSecurityOperation = async (
  headers: Headers,
  operationKey: string
): Promise<AccountSecurityReceipt | null> => {
  const actor = await getCredentialActor(headers);
  const committed = await findOperation(actor, operationKey);
  await getCredentialActor(headers);
  return committed ? receiptProjection(committed) : null;
};
