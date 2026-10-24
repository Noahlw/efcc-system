import { createHmac } from "node:crypto";

import {
  and,
  eq,
  exists,
  gt,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { getAuth } from "../../server/auth";
import { getDb } from "../../server/db/client";
import type { Database } from "../../server/db/client";
import { accountChangeOperation } from "../../server/db/schema/account-changes";
import type { accountChangeActions } from "../../server/db/schema/account-changes";
import { accountSecurityOperation } from "../../server/db/schema/account-security";
import { auditEvent } from "../../server/db/schema/applications";
import { account, session, user } from "../../server/db/schema/auth";
import { personProfile } from "../../server/db/schema/identity";
import { requireOwnBusinessAccess, requireStaff } from "./account-actors";
import type { StaffActor } from "./account-actors";
import { BusinessApiError } from "./business-request";
import type { IdentityCheck } from "./identity-changes/identity-contract";
import { requireManagedReceiptAccess } from "./managed-accounts";
import { requireFreshCredentialConfirmation } from "./security/security";
import type { ConfirmedCredentialActor } from "./security/security";
import {
  dateToUnixSeconds,
  unixSecondsToDate,
  sqliteNowSeconds,
} from "./timestamps";

type SensitiveActor = StaffActor & ConfirmedCredentialActor;

export const lastAdminError = () =>
  new BusinessApiError(
    409,
    "last_effective_admin",
    "不能移除最後一個可用管理員，請先保留另一個可管理系統的管理員。"
  );

/**
 * Durable Admin eligibility: another credential account that can really sign
 * in (stored password, no temporary-password window) with an active unbanned
 * Admin role. Live login sessions never count. Shared by the restriction and
 * deletion writers through the central builders.
 */
export const otherEffectiveAdminExists = async (targetUserId: string) => {
  const row = await getDb()
    .select({ present: sql`1` })
    .from(personProfile)
    .innerJoin(
      account,
      and(
        eq(account.userId, personProfile.userId),
        eq(account.accountId, personProfile.userId),
        eq(account.providerId, "credential")
      )
    )
    .where(
      and(
        ne(personProfile.userId, targetUserId),
        eq(personProfile.accountRole, "admin"),
        eq(personProfile.membershipStatus, "active"),
        isNull(personProfile.bannedAt),
        isNotNull(account.password),
        isNull(account.temporaryPasswordExpiresAt)
      )
    )
    .limit(1)
    .get();
  return row !== undefined;
};

export const requireSensitiveStaff = async (
  headers: Headers
): Promise<SensitiveActor> => {
  const staff = await requireStaff(headers);
  const actor = await requireFreshCredentialConfirmation(headers);
  return {
    ...actor,
    ...staff,
    confirmationOperationId: actor.confirmationOperationId,
  };
};

/** One lazy Drizzle item; the caller places it in the same ordered D1 batch. */
export type AccountChangeBatchItem = Parameters<Database["batch"]>[0][number];

export interface AccountChangeReceipt {
  id: string;
  action: (typeof accountChangeActions)[number];
  targetUserId: string;
  createdAt: number;
}

export interface AccountChangeOperationRow extends AccountChangeReceipt {
  requestHash: string;
}

/** The actor fields the shared authority/identity guards bind into a batch. */
export interface SensitiveStaffActor {
  sessionId: string;
  userId: string;
  credentialRevision: number;
  confirmationOperationId: string | null;
}

export const conflict = () =>
  new BusinessApiError(
    409,
    "conflict",
    "帳戶資料或使用者名稱／聯絡資料已改變，請重新查核。"
  );

export const findAccountChange = async (
  headers: Headers,
  actorUserId: string,
  key: string
): Promise<AccountChangeOperationRow | null> => {
  const row = await getDb()
    .select({
      action: accountChangeOperation.action,
      createdAt: accountChangeOperation.createdAt,
      id: accountChangeOperation.id,
      requestHash: accountChangeOperation.requestHash,
      targetUserId: accountChangeOperation.targetUserId,
    })
    .from(accountChangeOperation)
    .where(
      and(
        eq(accountChangeOperation.actorUserId, actorUserId),
        eq(accountChangeOperation.operationKey, key)
      )
    )
    .limit(1)
    .get();
  if (row) {
    await (row.action === "own_phone_changed"
      ? requireOwnBusinessAccess(headers)
      : requireManagedReceiptAccess(headers, row.targetUserId));
  }
  return row ? { ...row, createdAt: dateToUnixSeconds(row.createdAt) } : null;
};

const projection = ({
  id,
  action,
  targetUserId,
  createdAt,
}: AccountChangeOperationRow): AccountChangeReceipt => ({
  action,
  createdAt,
  id,
  targetUserId,
});

export const matchingAccountChange = (
  row: AccountChangeOperationRow,
  hash: string
) => {
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

/**
 * Shared atomic guards for Staff identity/restriction/deletion writers.
 * Each returns a lazy Drizzle batch item for the caller's one ordered D1 batch.
 */
export const sensitiveStaffAssertion = (
  actor: SensitiveStaffActor,
  targetUserId: string
) => {
  const database = getDb();
  const target = alias(personProfile, "target");
  const staffAuthorityIsCurrent = exists(
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
      .innerJoin(
        accountSecurityOperation,
        eq(accountSecurityOperation.id, session.confirmationOperationId)
      )
      .innerJoin(target, eq(target.userId, targetUserId))
      .where(
        and(
          eq(session.id, actor.sessionId),
          eq(session.userId, actor.userId),
          ne(session.userId, targetUserId),
          gt(session.expiresAt, sqliteNowSeconds),
          isNull(account.temporaryPasswordExpiresAt),
          isNotNull(account.password),
          ne(account.password, ""),
          eq(account.credentialRevision, session.credentialRevision),
          eq(session.credentialRevision, actor.credentialRevision),
          sql`${session.confirmationOperationId} = ${actor.confirmationOperationId}`,
          eq(accountSecurityOperation.action, "password_confirmed"),
          eq(accountSecurityOperation.userId, session.userId),
          eq(accountSecurityOperation.sessionId, session.id),
          eq(
            accountSecurityOperation.credentialRevision,
            session.credentialRevision
          ),
          eq(session.passwordConfirmedAt, accountSecurityOperation.createdAt),
          lte(session.passwordConfirmedAt, sqliteNowSeconds),
          gt(session.passwordConfirmedAt, sql`${sqliteNowSeconds} - 600`),
          eq(personProfile.membershipStatus, "active"),
          isNull(personProfile.bannedAt),
          ne(target.accountRole, "admin"),
          or(
            eq(personProfile.accountRole, "admin"),
            and(
              eq(personProfile.accountRole, "staff"),
              eq(target.accountRole, "member")
            )
          )
        )
      )
  );
  return database
    .select({
      complete: sql`json(CASE WHEN ${staffAuthorityIsCurrent} THEN 'null' ELSE 'Staff authority changed' END)`,
    })
    .from(user)
    .limit(1);
};

/**
 * Required audit/operation pair plus its same-batch completeness assertion.
 * Invalid JSON deliberately aborts and rolls back the batch when a required
 * write was ignored.
 */
export const recordAccountChange = (
  receipt: AccountChangeReceipt,
  actorUserId: string,
  key: string,
  hash: string,
  identityCheck: IdentityCheck | null
): AccountChangeBatchItem[] => {
  const database = getDb();
  const createdAt = unixSecondsToDate(receipt.createdAt);
  return [
    database.insert(auditEvent).values({
      action: receipt.action,
      actorUserId,
      createdAt,
      id: receipt.id,
      targetUserId: receipt.targetUserId,
    }),
    database.insert(accountChangeOperation).values({
      action: receipt.action,
      actorUserId,
      createdAt,
      id: receipt.id,
      identityCheck,
      operationKey: key,
      requestHash: hash,
      targetUserId: receipt.targetUserId,
    }),
    database
      .select({
        complete: sql`json(CASE WHEN EXISTS(
          SELECT 1 FROM ${accountChangeOperation} WHERE ${accountChangeOperation.id} = ${receipt.id}
        ) AND EXISTS(
          SELECT 1 FROM ${auditEvent} WHERE ${auditEvent.id} = ${receipt.id}
          AND ${auditEvent.actorUserId} = ${actorUserId}
          AND ${auditEvent.targetUserId} = ${receipt.targetUserId}
          AND ${auditEvent.action} = ${receipt.action}
        ) THEN 'null' ELSE 'Incomplete account change' END)`,
      })
      .from(user)
      .limit(1),
  ];
};
