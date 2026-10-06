import { createHmac } from "node:crypto";

import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import * as z from "zod";

import { getAuth } from "../../server/auth";
import { getDb } from "../../server/db/client";
import type { accountChangeActions } from "../../server/db/schema/account-changes";
import { user } from "../../server/db/schema/auth";
import { personProfile } from "../../server/db/schema/identity";
import { canonicalNameKey } from "../identity/name-matching";
import {
  accountIdentitySchema,
  ApplicationRequestError,
  readBoundedJson,
} from "./applications";
import { requireStaff } from "./decisions";
import { getCredentialActor } from "./security";
import { requireManagedAccount, requireSensitiveStaff } from "./staff-accounts";

const keySchema = z.uuid().transform((value) => value.toLowerCase());
const ownSchema = z.strictObject({
  operationKey: keySchema,
  phone: accountIdentitySchema.shape.phone,
});
const staffSchema = accountIdentitySchema
  .extend({
    email: accountIdentitySchema.shape.email.nullable(),
    identityCheck: z.enum(["face_to_face", "verified_phone"]),
    operationKey: keySchema,
    sharedPhone: z.boolean(),
    targetUserId: z.string().min(1).max(128),
  })
  .strict();
const reconcileSchema = z.strictObject({ operationKey: keySchema });
export interface AccountChangeReceipt {
  id: string;
  action: (typeof accountChangeActions)[number];
  targetUserId: string;
  createdAt: number;
}
interface ReceiptRow extends AccountChangeReceipt {
  requestHash: string;
}
const denied = () =>
  new ApplicationRequestError(
    403,
    "business_access_denied",
    "你沒有修正此帳戶的權限。"
  );
const conflict = () =>
  new ApplicationRequestError(
    409,
    "conflict",
    "帳戶資料或使用者名稱／聯絡資料已改變，請重新查核。"
  );
export const parseOwnPhone = async (request: Request) => {
  const input = ownSchema.safeParse(await readBoundedJson(request));
  if (!input.success) {
    throw new ApplicationRequestError(
      400,
      "validation_error",
      "電話資料格式不正確。"
    );
  }
  return input.data;
};
export const parseStaffIdentity = async (request: Request) => {
  const input = staffSchema.safeParse(await readBoundedJson(request));
  if (!input.success) {
    throw new ApplicationRequestError(
      400,
      "validation_error",
      "帳戶修正資料或核實方式不正確。"
    );
  }
  return input.data;
};
export const parseIdentityReconciliation = async (request: Request) => {
  const input = reconcileSchema.safeParse(await readBoundedJson(request));
  if (!input.success) {
    throw new ApplicationRequestError(
      400,
      "validation_error",
      "操作代碼格式不正確。"
    );
  }
  return input.data;
};

export const getOwnAccountIdentity = async (headers: Headers) => {
  const actor = await getCredentialActor(headers);
  const [row] = await getDb()
    .select({
      email: user.email,
      fullName: user.name,
      membershipStatus: personProfile.membershipStatus,
      phone: personProfile.phone,
      phoneShared: personProfile.phoneShared,
      username: user.displayUsername,
    })
    .from(user)
    .innerJoin(personProfile, eq(personProfile.userId, user.id))
    .where(eq(user.id, actor.userId))
    .limit(1);
  if (!row) {
    return null;
  }
  return {
    ...row,
    actorUserId: actor.userId,
    phoneEditable:
      actor.temporaryPasswordExpiresAt === null &&
      ["active", "deactivated"].includes(row.membershipStatus),
    /** Stored 0/1, matching the existing identity/contact consumers. */
    phoneShared: row.phoneShared ? 1 : 0,
  };
};
export const findAccountChange = (actorUserId: string, key: string) =>
  env.DB.prepare(
    `SELECT id,action,target_user_id AS targetUserId,created_at AS createdAt,request_hash AS requestHash FROM account_change_operation WHERE actor_user_id=? AND operation_key=?`
  )
    .bind(actorUserId, key)
    .first<ReceiptRow>();
const projection = ({
  id,
  action,
  targetUserId,
  createdAt,
}: ReceiptRow): AccountChangeReceipt => ({
  action,
  createdAt,
  id,
  targetUserId,
});
export const matchingAccountChange = (row: ReceiptRow, hash: string) => {
  if (row.requestHash !== hash) {
    throw conflict();
  }
  return projection(row);
};
export const fingerprintAccountChange = async (
  actorUserId: string,
  action: AccountChangeReceipt["action"],
  input: object
) => {
  const context = await getAuth().$context;
  return createHmac("sha256", context.secret)
    .update(JSON.stringify([actorUserId, action, input]))
    .digest("hex");
};
export const recordAccountChange = (
  receipt: AccountChangeReceipt,
  actorUserId: string,
  key: string,
  hash: string,
  identityCheck: string | null
) => [
  env.DB.prepare(
    `INSERT INTO audit_event(id,actor_user_id,target_user_id,action,created_at) VALUES(?,?,?,?,?)`
  ).bind(
    receipt.id,
    actorUserId,
    receipt.targetUserId,
    receipt.action,
    receipt.createdAt
  ),
  env.DB.prepare(
    `INSERT INTO account_change_operation(id,actor_user_id,target_user_id,action,created_at,operation_key,request_hash,identity_check) VALUES(?,?,?,?,?,?,?,?)`
  ).bind(
    receipt.id,
    actorUserId,
    receipt.targetUserId,
    receipt.action,
    receipt.createdAt,
    key,
    hash,
    identityCheck
  ),
  env.DB.prepare(
    `SELECT json(CASE WHEN EXISTS(SELECT 1 FROM account_change_operation WHERE id=?) AND EXISTS(SELECT 1 FROM audit_event WHERE id=? AND actor_user_id=? AND target_user_id=? AND action=?) THEN 'null' ELSE 'Incomplete account change' END)`
  ).bind(
    receipt.id,
    receipt.id,
    actorUserId,
    receipt.targetUserId,
    receipt.action
  ),
];

// Concrete shared authority for Staff identity/restriction/deletion writers.
// The caller places it inside the same D1 batch as the required effects.
export const sensitiveStaffAssertion = (
  actor: Awaited<ReturnType<typeof requireSensitiveStaff>>,
  targetUserId: string
) =>
  env.DB.prepare(`SELECT json(CASE WHEN EXISTS(
 SELECT 1 FROM session s INNER JOIN account a ON a.user_id=s.user_id AND a.account_id=s.user_id AND a.provider_id='credential'
 INNER JOIN person_profile p ON p.user_id=s.user_id INNER JOIN account_security_operation o ON o.id=s.confirmation_operation_id
 INNER JOIN person_profile target ON target.user_id=?
 WHERE s.id=? AND s.user_id=? AND s.user_id<>target.user_id AND s.expires_at>CAST(strftime('%s','now') AS INTEGER)
 AND a.temporary_password_expires_at IS NULL AND a.credential_revision=s.credential_revision AND s.credential_revision=?
 AND s.confirmation_operation_id=? AND o.action='password_confirmed' AND o.user_id=s.user_id AND o.session_id=s.id AND o.credential_revision=s.credential_revision
 AND s.password_confirmed_at=o.created_at AND s.password_confirmed_at<=CAST(strftime('%s','now') AS INTEGER) AND s.password_confirmed_at>CAST(strftime('%s','now') AS INTEGER)-600
 AND p.membership_status='active' AND p.banned_at IS NULL AND (p.account_role='admin' OR(p.account_role='staff' AND target.account_role='member'))
) THEN 'null' ELSE 'Staff authority changed' END)`).bind(
    targetUserId,
    actor.sessionId,
    actor.userId,
    actor.credentialRevision,
    actor.confirmationOperationId
  );

export const changeOwnPhone = async (
  headers: Headers,
  input: z.infer<typeof ownSchema>
) => {
  const actor = await getCredentialActor(headers);
  const hash = await fingerprintAccountChange(
    actor.userId,
    "own_phone_changed",
    input
  );
  const old = await getOwnAccountIdentity(headers);
  const existing = await findAccountChange(actor.userId, input.operationKey);
  if (existing) {
    return { created: false, receipt: matchingAccountChange(existing, hash) };
  }
  if (!old?.phoneEditable) {
    throw denied();
  }
  const receipt: AccountChangeReceipt = {
    action: "own_phone_changed",
    createdAt: Math.floor(Date.now() / 1000),
    id: crypto.randomUUID(),
    targetUserId: actor.userId,
  };
  try {
    await env.DB.batch([
      env.DB.prepare(
        `SELECT json(CASE WHEN EXISTS(SELECT 1 FROM session s INNER JOIN account a ON a.user_id=s.user_id AND a.account_id=s.user_id AND a.provider_id='credential' INNER JOIN person_profile p ON p.user_id=s.user_id WHERE s.id=? AND s.user_id=? AND s.expires_at>CAST(strftime('%s','now') AS INTEGER) AND a.credential_revision=s.credential_revision AND a.temporary_password_expires_at IS NULL AND p.membership_status IN ('active','deactivated') AND p.phone IS ?) THEN 'null' ELSE 'Own contact state changed' END)`
      ).bind(actor.sessionId, actor.userId, old.phone),
      env.DB.prepare(
        `UPDATE person_profile SET phone=?,phone_shared=0,updated_at=? WHERE user_id=?`
      ).bind(input.phone, receipt.createdAt, actor.userId),
      ...recordAccountChange(
        receipt,
        actor.userId,
        input.operationKey,
        hash,
        null
      ),
      env.DB.prepare(
        `SELECT json(CASE WHEN EXISTS(SELECT 1 FROM person_profile WHERE user_id=? AND phone=? AND phone_shared=0) THEN 'null' ELSE 'Incomplete own phone change' END)`
      ).bind(actor.userId, input.phone),
    ]);
  } catch (error) {
    const committed = await findAccountChange(actor.userId, input.operationKey);
    if (committed) {
      return {
        created: false,
        receipt: matchingAccountChange(committed, hash),
      };
    }
    const current = await getOwnAccountIdentity(headers);
    if (!current?.phoneEditable) {
      throw denied();
    }
    if (current.phone !== old.phone) {
      throw conflict();
    }
    const occupied = await env.DB.prepare(
      `SELECT 1 FROM person_profile WHERE user_id<>? AND phone=?`
    )
      .bind(actor.userId, input.phone)
      .first();
    if (occupied) {
      throw conflict();
    }
    throw error;
  }
  await getCredentialActor(headers);
  return { created: true, receipt };
};
export const correctStaffIdentity = async (
  headers: Headers,
  input: z.infer<typeof staffSchema>
) => {
  const actor = await requireSensitiveStaff(headers);
  const action = input.sharedPhone
    ? "staff_shared_phone_corrected"
    : "staff_identity_corrected";
  const hash = await fingerprintAccountChange(actor.userId, action, input);
  const existing = await findAccountChange(actor.userId, input.operationKey);
  if (existing) {
    return { created: false, receipt: matchingAccountChange(existing, hash) };
  }
  const target = await requireManagedAccount(actor, input.targetUserId);
  if (
    input.identityCheck === "verified_phone" &&
    target.verifiedRecoveryPhone === null
  ) {
    throw new ApplicationRequestError(
      403,
      "identity_verification_required",
      "請親身核實，或由職員透過教會原有已核實電話主動聯絡；新聯絡資料不能作復原憑證。"
    );
  }
  const email =
    input.email ??
    (target.email.endsWith(".invalid")
      ? target.email
      : `${crypto.randomUUID()}@accounts.efcc.invalid`);
  const username = input.username.toLowerCase();
  const receipt: AccountChangeReceipt = {
    action,
    createdAt: Math.floor(Date.now() / 1000),
    id: crypto.randomUUID(),
    targetUserId: target.userId,
  };
  try {
    await env.DB.batch([
      sensitiveStaffAssertion(actor, target.userId),
      env.DB.prepare(
        `SELECT json(CASE WHEN EXISTS(SELECT 1 FROM user u INNER JOIN person_profile p ON p.user_id=u.id INNER JOIN account a ON a.user_id=u.id AND a.account_id=u.id AND a.provider_id='credential' WHERE u.id=? AND u.name=? AND u.display_username IS ? AND u.email=? AND p.phone IS ? AND p.phone_shared=? AND a.credential_revision=? AND(?='face_to_face' OR p.verified_recovery_phone IS ?)) THEN 'null' ELSE 'Identity state changed' END)`
      ).bind(
        target.userId,
        target.fullName,
        target.username,
        target.email,
        target.phone,
        target.phoneShared,
        target.credentialRevision,
        input.identityCheck,
        target.verifiedRecoveryPhone
      ),
      env.DB.prepare(
        `UPDATE user SET name=?,username=?,display_username=?,email=?,email_verified=CASE WHEN email<>? THEN 0 ELSE email_verified END,updated_at=? WHERE id=?`
      ).bind(
        input.fullName,
        username,
        input.username,
        email,
        email,
        receipt.createdAt,
        target.userId
      ),
      env.DB.prepare(
        `UPDATE person_profile SET name_lookup_key=?,phone=?,phone_shared=?,updated_at=? WHERE user_id=?`
      ).bind(
        canonicalNameKey(input.fullName),
        input.phone,
        input.sharedPhone ? 1 : 0,
        receipt.createdAt,
        target.userId
      ),
      ...recordAccountChange(
        receipt,
        actor.userId,
        input.operationKey,
        hash,
        input.identityCheck
      ),
      env.DB.prepare(
        `SELECT json(CASE WHEN EXISTS(SELECT 1 FROM user u INNER JOIN person_profile p ON p.user_id=u.id WHERE u.id=? AND u.name=? AND u.username=? AND u.display_username=? AND u.email=? AND p.phone=? AND p.phone_shared=? AND p.name_lookup_key=? AND (u.email=? OR u.email_verified=0)) AND EXISTS(SELECT 1 FROM username_reservation WHERE username_key=? AND user_id=?) THEN 'null' ELSE 'Incomplete Staff identity change' END)`
      ).bind(
        target.userId,
        input.fullName,
        username,
        input.username,
        email,
        input.phone,
        input.sharedPhone ? 1 : 0,
        canonicalNameKey(input.fullName),
        target.email,
        username,
        target.userId
      ),
    ]);
  } catch (error) {
    const committed = await findAccountChange(actor.userId, input.operationKey);
    if (committed) {
      return {
        created: false,
        receipt: matchingAccountChange(committed, hash),
      };
    }
    const currentActor = await requireSensitiveStaff(headers);
    const current = await requireManagedAccount(currentActor, target.userId);
    if (
      (
        [
          "fullName",
          "username",
          "email",
          "phone",
          "phoneShared",
          "credentialRevision",
        ] as const
      ).some((field) => current[field] !== target[field]) ||
      (input.identityCheck === "verified_phone" &&
        current.verifiedRecoveryPhone !== target.verifiedRecoveryPhone)
    ) {
      throw conflict();
    }
    const occupied = await env.DB.prepare(
      `SELECT 1 FROM username_reservation WHERE username_key=? AND (user_id<>? OR username_key IS NOT (SELECT username FROM user WHERE id=?)) UNION ALL SELECT 1 FROM user WHERE lower(trim(email))=? AND id<>? UNION ALL SELECT 1 FROM person_profile WHERE phone=? AND user_id<>? AND ?=0 LIMIT 1`
    )
      .bind(
        username,
        target.userId,
        target.userId,
        email,
        target.userId,
        input.phone,
        target.userId,
        input.sharedPhone ? 1 : 0
      )
      .first();
    if (occupied) {
      throw conflict();
    }
    throw error;
  }
  await requireStaff(headers);
  return { created: true, receipt };
};
export const reconcileIdentityChange = async (
  headers: Headers,
  key: string
) => {
  const actor = await getCredentialActor(headers);
  const row = await findAccountChange(actor.userId, key);
  await getCredentialActor(headers);
  return row ? projection(row) : null;
};
