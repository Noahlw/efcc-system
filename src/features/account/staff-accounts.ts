import { createHmac, randomBytes } from "node:crypto";

import { env } from "cloudflare:workers";
import * as z from "zod";

import { getAuth } from "../../server/auth";
import { requireWrittenReceipt } from "../../server/db/required-receipt";
import type {
  AccountRole,
  MembershipStatus,
} from "../../server/db/schema/identity";
import type { staffAccountActionValues } from "../../server/db/schema/staff-accounts";
import {
  accountIdentitySchema,
  ApplicationRequestError,
  prepareCanonicalAccount,
  readBoundedJson,
} from "./applications";
import { requireStaff } from "./decisions";
import { getCredentialActor } from "./security";

const TEMPORARY_PASSWORD_SECONDS = 7 * 24 * 60 * 60;
const keySchema = z.uuid().transform((value) => value.toLowerCase());
const createSchema = accountIdentitySchema
  .extend({
    email: accountIdentitySchema.shape.email.nullable(),
    identityCheck: z.literal("face_to_face"),
    operationKey: keySchema,
    sharedPhone: z.boolean(),
  })
  .strict();
const resetSchema = z.strictObject({
  identityCheck: z.enum(["face_to_face", "verified_phone"]),
  operationKey: keySchema,
  targetUserId: z.string().min(1).max(128),
});
const reconcileSchema = z.strictObject({ operationKey: keySchema });
type CreateInput = z.infer<typeof createSchema>;
type ResetInput = z.infer<typeof resetSchema>;
type StaffAction = (typeof staffAccountActionValues)[number];
type StaffActor = Awaited<ReturnType<typeof requireStaff>>;
type SensitiveActor = StaffActor &
  Awaited<ReturnType<typeof getCredentialActor>>;

export interface StaffAccountReceipt {
  id: string;
  action: StaffAction;
  targetUserId: string;
  createdAt: number;
}
interface OperationRow extends StaffAccountReceipt {
  requestHash: string;
}
export interface ManagedAccount {
  userId: string;
  fullName: string;
  username: string | null;
  email: string;
  phone: string | null;
  verifiedRecoveryPhone: string | null;
  temporaryPasswordExpiresAt: number | null;
  membershipStatus: MembershipStatus;
  banned: number | null;
  role: AccountRole;
  credentialRevision: number;
}

const validationError = () =>
  new ApplicationRequestError(
    400,
    "validation_error",
    "請填妥帳戶資料及身分核實方式。"
  );
const conflict = () =>
  new ApplicationRequestError(
    409,
    "conflict",
    "帳戶狀態或操作資料已改變，請重新查核。"
  );
const denied = () =>
  new ApplicationRequestError(
    403,
    "business_access_denied",
    "你沒有管理此帳戶的權限。"
  );

export const parseStaffCreationRequest = async (
  request: Request
): Promise<CreateInput> => {
  const result = createSchema.safeParse(await readBoundedJson(request));
  if (!result.success) {
    throw validationError();
  }
  return result.data;
};
export const parseStaffPasswordRequest = async (
  request: Request
): Promise<ResetInput> => {
  const result = resetSchema.safeParse(await readBoundedJson(request));
  if (!result.success) {
    throw validationError();
  }
  return result.data;
};
export const parseStaffAccountReconciliation = async (request: Request) => {
  const result = reconcileSchema.safeParse(await readBoundedJson(request));
  if (!result.success) {
    throw validationError();
  }
  return result.data;
};

export const requireSensitiveStaff = async (
  headers: Headers
): Promise<SensitiveActor> => {
  const staff = await requireStaff(headers);
  const actor = await getCredentialActor(headers);
  const confirmed = await env.DB.prepare(`SELECT 1 AS valid FROM session s
  INNER JOIN account_security_operation o ON o.id = s.confirmation_operation_id
  WHERE s.id = ? AND s.user_id = ? AND o.user_id = s.user_id AND o.session_id = s.id
   AND o.action = 'password_confirmed' AND o.credential_revision = s.credential_revision
   AND s.password_confirmed_at = o.created_at
   AND s.password_confirmed_at <= CAST(strftime('%s','now') AS INTEGER)
   AND s.password_confirmed_at > CAST(strftime('%s','now') AS INTEGER)-600`)
    .bind(actor.sessionId, actor.userId)
    .first();
  if (!confirmed || actor.temporaryPasswordExpiresAt !== null) {
    throw new ApplicationRequestError(
      403,
      "password_confirmation_required",
      "請先在帳戶安全頁確認目前密碼，確認只在此登入內有效十分鐘。"
    );
  }
  return { ...actor, ...staff };
};

export const getStaffAccounts = async (
  headers: Headers
): Promise<ManagedAccount[]> => {
  const actor = await requireStaff(headers);
  const rows =
    await env.DB.prepare(`SELECT u.id AS userId, u.name AS fullName, u.display_username AS username,
  u.email, p.phone, p.verified_recovery_phone AS verifiedRecoveryPhone,
  a.temporary_password_expires_at AS temporaryPasswordExpiresAt, p.membership_status AS membershipStatus,
  p.banned_at AS banned, p.account_role AS role, a.credential_revision AS credentialRevision
  FROM user u INNER JOIN person_profile p ON p.user_id=u.id
  INNER JOIN account a ON a.user_id=u.id AND a.account_id=u.id AND a.provider_id='credential'
  WHERE u.id <> ? AND (? = 'admin' OR p.account_role='member')
   AND EXISTS (SELECT 1 FROM session s INNER JOIN person_profile sp ON sp.user_id=s.user_id
    INNER JOIN account sa ON sa.user_id=s.user_id AND sa.account_id=s.user_id AND sa.provider_id='credential'
    WHERE s.id=? AND s.user_id=? AND s.expires_at>CAST(strftime('%s','now') AS INTEGER)
     AND s.credential_revision=sa.credential_revision AND sa.temporary_password_expires_at IS NULL
     AND sp.membership_status='active' AND sp.banned_at IS NULL AND sp.account_role IN ('staff','admin'))
  ORDER BY u.name,u.id`)
      .bind(actor.userId, actor.role, actor.sessionId, actor.userId)
      .all<ManagedAccount>();
  await requireStaff(headers);
  return rows.results;
};

const requireTarget = async (
  actor: StaffActor,
  id: string
): Promise<ManagedAccount> => {
  const target =
    await env.DB.prepare(`SELECT u.id AS userId, u.name AS fullName, u.display_username AS username,
  u.email, p.phone, p.verified_recovery_phone AS verifiedRecoveryPhone,
  a.temporary_password_expires_at AS temporaryPasswordExpiresAt, p.membership_status AS membershipStatus,
  p.banned_at AS banned, p.account_role AS role, a.credential_revision AS credentialRevision
  FROM user u JOIN person_profile p ON p.user_id=u.id
  JOIN account a ON a.user_id=u.id AND a.account_id=u.id AND a.provider_id='credential' WHERE u.id=?`)
      .bind(id)
      .first<ManagedAccount>();
  if (
    !target ||
    id === actor.userId ||
    (actor.role === "staff" && target.role !== "member")
  ) {
    throw denied();
  }
  return target;
};

const findOperation = (actor: StaffActor, key: string) =>
  env.DB.prepare(`SELECT id,action,target_user_id AS targetUserId,
 created_at AS createdAt, request_hash AS requestHash FROM staff_account_operation
 WHERE actor_user_id=? AND operation_key=?`)
    .bind(actor.userId, key)
    .first<OperationRow>();
const projection = (row: OperationRow): StaffAccountReceipt => ({
  action: row.action,
  createdAt: row.createdAt,
  id: row.id,
  targetUserId: row.targetUserId,
});
const matching = (row: OperationRow, hash: string) => {
  if (row.requestHash !== hash) {
    throw conflict();
  }
  return projection(row);
};
const fingerprint = (
  actor: StaffActor,
  action: StaffAction,
  input: CreateInput | ResetInput,
  secret: string
) =>
  createHmac("sha256", secret)
    .update(JSON.stringify([actor.userId, action, input]))
    .digest("hex");

const receiptStatement = (
  actor: SensitiveActor,
  row: StaffAccountReceipt,
  key: string,
  requestHash: string,
  targetRevision: number,
  identityCheck: string
) =>
  env.DB.prepare(`INSERT INTO staff_account_operation
 (id,action,actor_user_id,actor_session_id,actor_credential_revision,confirmation_operation_id,
  target_user_id,target_credential_revision,operation_key,request_hash,identity_check,created_at)
 VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
    row.id,
    row.action,
    actor.userId,
    actor.sessionId,
    actor.credentialRevision,
    actor.confirmationOperationId,
    row.targetUserId,
    targetRevision,
    key,
    requestHash,
    identityCheck,
    row.createdAt
  );

export const createAssistedAccount = async (
  headers: Headers,
  input: CreateInput
) => {
  const actor = await requireSensitiveStaff(headers);
  const authContext = await getAuth().$context;
  const requestHash = fingerprint(
    actor,
    "assisted_account_created",
    input,
    authContext.secret
  );
  const previous = await findOperation(actor, input.operationKey);
  if (previous) {
    return { created: false, receipt: matching(previous, requestHash) };
  }
  const userId = crypto.randomUUID();
  const temporaryPassword = randomBytes(24).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const canonicalInput = {
    ...input,
    email: input.email ?? `${userId}@accounts.efcc.invalid`,
    password: temporaryPassword,
  };
  const canonical = await prepareCanonicalAccount(canonicalInput, {
    membershipStatus: "active",
    sharedPhone: input.sharedPhone,
    temporaryPasswordExpiresAt: now + TEMPORARY_PASSWORD_SECONDS,
    userId,
  });
  const receipt: StaffAccountReceipt = {
    action: "assisted_account_created",
    createdAt: now,
    id: crypto.randomUUID(),
    targetUserId: userId,
  };
  try {
    await env.DB.batch([
      ...canonical.statements,
      env.DB.prepare(
        `INSERT INTO audit_event (id,action,actor_user_id,target_user_id,created_at) VALUES (?,'assisted_account_created',?,?,?)`
      ).bind(receipt.id, actor.userId, userId, now),
      receiptStatement(
        actor,
        receipt,
        input.operationKey,
        requestHash,
        0,
        input.identityCheck
      ),
      requireWrittenReceipt("staff_account_operation", receipt.id),
    ]);
  } catch (error) {
    const committed = await findOperation(actor, input.operationKey);
    if (committed) {
      return { created: false, receipt: matching(committed, requestHash) };
    }
    await requireSensitiveStaff(headers);
    const duplicate =
      await env.DB.prepare(`SELECT EXISTS(SELECT 1 FROM username_reservation WHERE username_key=?)
   OR EXISTS(SELECT 1 FROM user WHERE lower(trim(email))=?)
   OR (?=0 AND EXISTS(SELECT 1 FROM person_profile WHERE phone=?)) AS present`)
        .bind(
          input.username.toLowerCase(),
          canonicalInput.email,
          input.sharedPhone ? 1 : 0,
          input.phone
        )
        .first<{ present: number }>();
    if (duplicate?.present) {
      throw conflict();
    }
    throw error;
  }
  const committed = await findOperation(actor, input.operationKey);
  if (!committed) {
    await requireStaff(headers);
    throw new Error("Missing assisted creation receipt");
  }
  await requireStaff(headers);
  return {
    created: true,
    receipt: matching(committed, requestHash),
    temporaryPassword,
  };
};

export const resetStaffPassword = async (
  headers: Headers,
  input: ResetInput,
  reissue: boolean
) => {
  const actor = await requireSensitiveStaff(headers);
  const action = reissue
    ? "temporary_password_reissued"
    : "staff_password_reset";
  const authContext = await getAuth().$context;
  const requestHash = fingerprint(actor, action, input, authContext.secret);
  const previous = await findOperation(actor, input.operationKey);
  if (previous) {
    return { created: false, receipt: matching(previous, requestHash) };
  }
  const target = await requireTarget(actor, input.targetUserId);
  if (reissue && target.temporaryPasswordExpiresAt === null) {
    throw conflict();
  }
  if (
    input.identityCheck === "verified_phone" &&
    target.verifiedRecoveryPhone === null
  ) {
    throw new ApplicationRequestError(
      403,
      "identity_verification_required",
      "必須親身核實身分，或由職員透過教會原有已核實電話主動聯絡。新聯絡資料不能作復原憑證。"
    );
  }
  const temporaryPassword = randomBytes(24).toString("base64url");
  const passwordHash = await authContext.password.hash(temporaryPassword);
  const now = Math.floor(Date.now() / 1000);
  const receipt: StaffAccountReceipt = {
    action,
    createdAt: now,
    id: crypto.randomUUID(),
    targetUserId: target.userId,
  };
  const revision = target.credentialRevision + 1;
  try {
    await env.DB.batch([
      env.DB.prepare(`UPDATE account SET password=?, credential_revision=?, temporary_password_expires_at=?, updated_at=?
    WHERE user_id=? AND account_id=user_id AND provider_id='credential' AND credential_revision=?
     AND EXISTS (SELECT 1 FROM person_profile WHERE user_id=account.user_id AND (?='face_to_face' OR verified_recovery_phone=?))`).bind(
        passwordHash,
        revision,
        now + TEMPORARY_PASSWORD_SECONDS,
        now,
        target.userId,
        target.credentialRevision,
        input.identityCheck,
        target.verifiedRecoveryPhone
      ),
      env.DB.prepare(`DELETE FROM session WHERE user_id=?
    AND EXISTS(SELECT 1 FROM account WHERE user_id=? AND account_id=user_id AND provider_id='credential'
     AND password=? AND credential_revision=?)`).bind(
        target.userId,
        target.userId,
        passwordHash,
        revision
      ),
      env.DB.prepare(`INSERT INTO audit_event (id,action,actor_user_id,target_user_id,created_at)
    SELECT ?,?,?,user_id,? FROM account WHERE user_id=? AND account_id=user_id AND provider_id='credential'
     AND password=? AND credential_revision=?`).bind(
        receipt.id,
        action,
        actor.userId,
        now,
        target.userId,
        passwordHash,
        revision
      ),
      receiptStatement(
        actor,
        receipt,
        input.operationKey,
        requestHash,
        revision,
        input.identityCheck
      ),
      requireWrittenReceipt("staff_account_operation", receipt.id),
    ]);
  } catch (error) {
    const committed = await findOperation(actor, input.operationKey);
    if (committed) {
      return { created: false, receipt: matching(committed, requestHash) };
    }
    const currentActor = await requireSensitiveStaff(headers);
    const current = await requireTarget(currentActor, target.userId);
    if (
      current.credentialRevision !== target.credentialRevision ||
      (input.identityCheck === "verified_phone" &&
        current.verifiedRecoveryPhone !== target.verifiedRecoveryPhone)
    ) {
      throw conflict();
    }
    throw error;
  }
  const committed = await findOperation(actor, input.operationKey);
  if (!committed) {
    await requireStaff(headers);
    throw new Error("Missing Staff credential receipt");
  }
  await requireStaff(headers);
  return {
    created: true,
    receipt: matching(committed, requestHash),
    temporaryPassword,
  };
};

export const reconcileStaffAccount = async (
  headers: Headers,
  operationKey: string
) => {
  const actor = await requireStaff(headers);
  const row = await findOperation(actor, operationKey);
  await requireStaff(headers);
  return row ? projection(row) : null;
};
