import {
  and,
  eq,
  exists,
  gt,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import * as z from "zod";

import { getDb } from "../../../server/db/client";
import { usernameReservation } from "../../../server/db/schema/applications";
import { account, session, user } from "../../../server/db/schema/auth";
import { personProfile } from "../../../server/db/schema/identity";
import { canonicalNameKey } from "../../identity/name-matching";
import { requireOwnBusinessAccess, requireStaff } from "../account-actors";
import type {
  AccountChangeBatchItem,
  AccountChangeReceipt,
} from "../account-change-operations";
import {
  conflict,
  findAccountChange,
  fingerprintAccountChange,
  matchingAccountChange,
  recordAccountChange,
  sensitiveStaffAssertion,
  requireSensitiveStaff,
} from "../account-change-operations";
import { BusinessApiError, readBoundedJson } from "../business-request";
import { accountIdentitySchema } from "../identity-validation";
import {
  getStaffAccountDetail,
  requireManagedAccount,
} from "../managed-accounts";
import { getCredentialActor } from "../security/security";
import { staffSearchWrittenAssertion } from "../staff-search";
import { staffSearchKey } from "../staff-search-contract";
import { unixSecondsToDate, nowSeconds, sqliteNowSeconds } from "../timestamps";
import {
  originalIdentitySchema,
  originalIdentityValues,
  originalPhoneSchema,
} from "./identity-contract";

const staleIdentity = () =>
  new BusinessApiError(
    409,
    "stale_identity",
    "資料已更新，請重新載入最新資料後再核對修改。"
  );

const keySchema = z.uuid().transform((value) => value.toLowerCase());
const ownSchema = z.strictObject({
  operationKey: keySchema,
  original: originalPhoneSchema.optional(),
  phone: accountIdentitySchema.shape.phone,
});
const staffSchema = accountIdentitySchema
  .extend({
    email: accountIdentitySchema.shape.email.nullable(),
    identityCheck: z.enum(["face_to_face", "verified_phone"]),
    operationKey: keySchema,
    original: originalIdentitySchema.optional(),
    sharedPhone: z.boolean(),
    targetUserId: z.string().min(1).max(128),
  })
  .strict();
const reconcileSchema = z.strictObject({ operationKey: keySchema });
const denied = () =>
  new BusinessApiError(
    403,
    "business_access_denied",
    "你沒有修正此帳戶的權限。"
  );
export const parseOwnPhone = async (request: Request) => {
  const input = ownSchema.safeParse(await readBoundedJson(request));
  if (!input.success) {
    throw new BusinessApiError(400, "validation_error", "電話資料格式不正確。");
  }
  return input.data;
};
export const parseStaffIdentity = async (request: Request) => {
  const input = staffSchema.safeParse(await readBoundedJson(request));
  if (!input.success) {
    throw new BusinessApiError(
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
    throw new BusinessApiError(400, "validation_error", "操作代碼格式不正確。");
  }
  return input.data;
};

export const getOwnAccountIdentity = async (headers: Headers) => {
  await requireOwnBusinessAccess(headers);
  const actor = await getCredentialActor(headers);
  const [row] = await getDb()
    .select({
      canonicalUsername: user.username,
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
  await requireOwnBusinessAccess(headers);
  return {
    ...row,
    actorUserId: actor.userId,
    phoneEditable:
      actor.temporaryPasswordExpiresAt === null &&
      row.membershipStatus === "active",
    /** Stored 0/1, matching the existing identity/contact consumers. */
    phoneShared: row.phoneShared ? 1 : 0,
    userId: actor.userId,
  };
};

/** Explicit refresh uses the existing independently authorised detail reader. */
export const getStaffIdentityContact = async (
  headers: Headers,
  target: string | undefined
) => {
  await requireStaff(headers);
  const id = z.string().min(1).max(128).safeParse(target);
  if (!id.success) {
    throw new BusinessApiError(
      400,
      "validation_error",
      "請選擇需要查核的帳戶。"
    );
  }
  return (await getStaffAccountDetail(headers, id.data)) ?? null;
};

export const changeOwnPhone = async (
  headers: Headers,
  input: z.infer<typeof ownSchema>
) => {
  const actor = await getCredentialActor(headers);
  const database = getDb();
  const hash = await fingerprintAccountChange(
    actor.userId,
    "own_phone_changed",
    input.original ? { input, protocol: "identity-contact-v2" } : input
  );
  const old = await getOwnAccountIdentity(headers);
  const existing = await findAccountChange(
    headers,
    actor.userId,
    input.operationKey
  );
  if (existing) {
    return { created: false, receipt: matchingAccountChange(existing, hash) };
  }
  if (!old?.phoneEditable) {
    throw denied();
  }
  if (!input.original) {
    throw new BusinessApiError(
      409,
      "client_update_required",
      "頁面版本已過期，請保留原操作代碼並重新載入最新資料後再提交。"
    );
  }
  if (
    input.original.phone !== old.phone ||
    input.original.phoneShared !== old.phoneShared
  ) {
    throw staleIdentity();
  }
  const receipt: AccountChangeReceipt = {
    action: "own_phone_changed",
    createdAt: nowSeconds(),
    id: crypto.randomUUID(),
    targetUserId: actor.userId,
  };
  const now = unixSecondsToDate(receipt.createdAt);
  const ownContactIsCurrent = exists(
    database
      .select({ present: sql`1` })
      .from(session)
      .innerJoin(
        account,
        and(
          eq(account.userId, session.userId),
          eq(account.accountId, session.userId),
          eq(account.providerId, "credential")
        )
      )
      .innerJoin(personProfile, eq(personProfile.userId, session.userId))
      .where(
        and(
          eq(session.id, actor.sessionId),
          eq(session.userId, actor.userId),
          gt(session.expiresAt, sqliteNowSeconds),
          eq(account.credentialRevision, session.credentialRevision),
          eq(account.credentialRevision, actor.credentialRevision),
          isNotNull(account.password),
          ne(account.password, ""),
          isNull(account.temporaryPasswordExpiresAt),
          eq(personProfile.membershipStatus, "active"),
          isNull(personProfile.bannedAt),
          sql`${personProfile.phone} IS ${input.original.phone}`,
          eq(personProfile.phoneShared, input.original.phoneShared === 1)
        )
      )
  );
  const statements: [AccountChangeBatchItem, ...AccountChangeBatchItem[]] = [
    database
      .select({
        complete: sql`json(CASE WHEN ${ownContactIsCurrent} THEN 'null' ELSE 'Own contact state changed' END)`,
      })
      .from(user)
      .limit(1),
    database
      .update(personProfile)
      .set({ phone: input.phone, phoneShared: false, updatedAt: now })
      .where(eq(personProfile.userId, actor.userId)),
    ...recordAccountChange(
      receipt,
      actor.userId,
      input.operationKey,
      hash,
      null
    ),
    database
      .select({
        complete: sql`json(CASE WHEN EXISTS(
          SELECT 1 FROM ${personProfile} WHERE ${personProfile.userId} = ${actor.userId}
          AND ${personProfile.phone} = ${input.phone} AND ${personProfile.phoneShared} = 0
        ) THEN 'null' ELSE 'Incomplete own phone change' END)`,
      })
      .from(user)
      .limit(1),
  ];
  try {
    await database.batch(statements);
  } catch (error) {
    const committed = await findAccountChange(
      headers,
      actor.userId,
      input.operationKey
    );
    if (committed) {
      return {
        created: false,
        receipt: matchingAccountChange(committed, hash),
      };
    }
    const currentActor = await getCredentialActor(headers);
    if (currentActor.credentialRevision !== actor.credentialRevision) {
      throw conflict();
    }
    const current = await getOwnAccountIdentity(headers);
    if (!current?.phoneEditable) {
      throw denied();
    }
    if (
      current.phone !== old.phone ||
      current.phoneShared !== old.phoneShared
    ) {
      throw staleIdentity();
    }
    const occupied = await database
      .select({ present: sql`1` })
      .from(personProfile)
      .where(
        and(
          ne(personProfile.userId, actor.userId),
          eq(personProfile.phone, input.phone)
        )
      )
      .limit(1)
      .get();
    if (occupied) {
      throw conflict();
    }
    throw error;
  }
  await getCredentialActor(headers);
  await requireOwnBusinessAccess(headers);
  return { created: true, receipt };
};

export const correctStaffIdentity = async (
  headers: Headers,
  input: z.infer<typeof staffSchema>
) => {
  const actor = await requireStaff(headers);
  const action = input.sharedPhone
    ? "staff_shared_phone_corrected"
    : "staff_identity_corrected";
  const database = getDb();
  const hash = await fingerprintAccountChange(
    actor.userId,
    action,
    input.original ? { input, protocol: "identity-contact-v2" } : input
  );
  const existing = await findAccountChange(
    headers,
    actor.userId,
    input.operationKey
  );
  if (existing) {
    return { created: false, receipt: matchingAccountChange(existing, hash) };
  }
  const sensitiveActor = await requireSensitiveStaff(headers);
  const target = await requireManagedAccount(actor, input.targetUserId);
  if (!input.original) {
    throw new BusinessApiError(
      409,
      "client_update_required",
      "頁面版本已過期，請保留原操作代碼並重新載入最新資料後再提交。"
    );
  }
  if (
    JSON.stringify(originalIdentityValues(target)) !==
    JSON.stringify(originalIdentityValues(input.original))
  ) {
    throw staleIdentity();
  }
  if (
    input.identityCheck === "verified_phone" &&
    target.verifiedRecoveryPhone === null
  ) {
    throw new BusinessApiError(
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
  const nameLookupKey = canonicalNameKey(input.fullName);
  const receipt: AccountChangeReceipt = {
    action,
    createdAt: nowSeconds(),
    id: crypto.randomUUID(),
    targetUserId: target.userId,
  };
  const now = unixSecondsToDate(receipt.createdAt);
  const identityStateIsCurrent = exists(
    database
      .select({ present: sql`1` })
      .from(user)
      .innerJoin(personProfile, eq(personProfile.userId, user.id))
      .innerJoin(
        account,
        and(
          eq(account.userId, user.id),
          eq(account.accountId, user.id),
          eq(account.providerId, "credential")
        )
      )
      .where(
        and(
          eq(user.id, target.userId),
          eq(user.name, input.original.fullName),
          sql`${user.username} IS ${input.original.canonicalUsername}`,
          sql`${user.displayUsername} IS ${input.original.username}`,
          eq(user.email, input.original.email),
          sql`${personProfile.phone} IS ${input.original.phone}`,
          eq(personProfile.phoneShared, input.original.phoneShared === 1),
          eq(account.credentialRevision, target.credentialRevision),
          or(
            sql`${input.identityCheck} = 'face_to_face'`,
            sql`${personProfile.verifiedRecoveryPhone} IS ${target.verifiedRecoveryPhone}`
          )
        )
      )
  );
  const identityIsWritten = exists(
    database
      .select({ present: sql`1` })
      .from(user)
      .innerJoin(personProfile, eq(personProfile.userId, user.id))
      .where(
        and(
          eq(user.id, target.userId),
          eq(user.name, input.fullName),
          eq(user.username, username),
          eq(user.displayUsername, input.username),
          eq(user.email, email),
          eq(personProfile.phone, input.phone),
          eq(personProfile.phoneShared, input.sharedPhone),
          eq(personProfile.nameLookupKey, nameLookupKey),
          or(eq(user.email, target.email), eq(user.emailVerified, false))
        )
      )
  );
  const reservationIsHeld = exists(
    database
      .select({ present: sql`1` })
      .from(usernameReservation)
      .where(
        and(
          eq(usernameReservation.usernameKey, username),
          eq(usernameReservation.userId, target.userId)
        )
      )
  );
  const statements: [AccountChangeBatchItem, ...AccountChangeBatchItem[]] = [
    sensitiveStaffAssertion(sensitiveActor, target.userId),
    database
      .select({
        complete: sql`json(CASE WHEN ${identityStateIsCurrent} THEN 'null' ELSE 'Identity state changed' END)`,
      })
      .from(user)
      .limit(1),
    database
      .update(user)
      .set({
        displayUsername: input.username,
        email,
        emailVerified: sql`CASE WHEN ${user.email} <> ${email} THEN 0 ELSE ${user.emailVerified} END`,
        name: input.fullName,
        updatedAt: now,
        username,
      })
      .where(eq(user.id, target.userId)),
    database
      .update(personProfile)
      .set({
        nameLookupKey,
        phone: input.phone,
        phoneShared: input.sharedPhone,
        staffSearchKey: staffSearchKey(input.fullName, input.username),
        updatedAt: now,
      })
      .where(eq(personProfile.userId, target.userId)),
    staffSearchWrittenAssertion(
      database,
      target.userId,
      input.fullName,
      input.username
    ),
    ...recordAccountChange(
      receipt,
      actor.userId,
      input.operationKey,
      hash,
      input.identityCheck
    ),
    database
      .select({
        complete: sql`json(CASE WHEN ${identityIsWritten} AND ${reservationIsHeld} THEN 'null' ELSE 'Incomplete Staff identity change' END)`,
      })
      .from(user)
      .limit(1),
  ];
  try {
    await database.batch(statements);
  } catch (error) {
    const committed = await findAccountChange(
      headers,
      actor.userId,
      input.operationKey
    );
    if (committed) {
      return {
        created: false,
        receipt: matchingAccountChange(committed, hash),
      };
    }
    const currentActor = await requireSensitiveStaff(headers);
    const current = await requireManagedAccount(currentActor, target.userId);
    if (
      JSON.stringify(originalIdentityValues(current)) !==
      JSON.stringify(originalIdentityValues(input.original))
    ) {
      throw staleIdentity();
    }
    if (
      current.credentialRevision !== target.credentialRevision ||
      (input.identityCheck === "verified_phone" &&
        current.verifiedRecoveryPhone !== target.verifiedRecoveryPhone)
    ) {
      throw conflict();
    }
    const occupied = await database.get<{ occupied: number }>(sql`
      SELECT 1 AS occupied FROM ${usernameReservation}
      WHERE ${usernameReservation.usernameKey} = ${username}
      AND (${usernameReservation.userId} <> ${target.userId} OR ${usernameReservation.usernameKey} IS NOT (SELECT username FROM user WHERE id = ${target.userId}))
      UNION ALL
      SELECT 1 FROM ${user} WHERE lower(trim(${user.email})) = ${email} AND ${user.id} <> ${target.userId}
      UNION ALL
      SELECT 1 FROM ${personProfile} WHERE ${personProfile.phone} = ${input.phone} AND ${personProfile.userId} <> ${target.userId} AND ${input.sharedPhone ? 1 : 0} = 0
      LIMIT 1
    `);
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
  await requireOwnBusinessAccess(headers);
  const actor = await getCredentialActor(headers);
  const row = await findAccountChange(headers, actor.userId, key);
  await getCredentialActor(headers);
  return row
    ? {
        action: row.action,
        createdAt: row.createdAt,
        id: row.id,
        targetUserId: row.targetUserId,
      }
    : null;
};
