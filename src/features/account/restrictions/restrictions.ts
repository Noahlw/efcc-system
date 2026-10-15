import { and, eq, exists, isNull, sql } from "drizzle-orm";

import { getDb } from "../../../server/db/client";
import { user } from "../../../server/db/schema/auth";
import { personProfile } from "../../../server/db/schema/identity";
import type {
  AccountChangeBatchItem,
  AccountChangeReceipt,
} from "../account-change-operations";
import {
  findAccountChange,
  lastAdminError,
  otherEffectiveAdminExists,
  fingerprintAccountChange,
  matchingAccountChange,
  recordAccountChange,
  sensitiveStaffAssertion,
  requireSensitiveStaff,
} from "../account-change-operations";
import { BusinessApiError, readBoundedJson } from "../business-request";
import { requireManagedAccount } from "../managed-accounts";
import type { ManagedAccount } from "../managed-accounts";
import { unixSecondsToDate, nowSeconds } from "../timestamps";
import { restrictionRequestSchema } from "./restriction-contract";
import type {
  RestrictionAction,
  RestrictionRequest,
} from "./restriction-contract";

const conflict = () =>
  new BusinessApiError(409, "conflict", "帳戶限制狀態已改變，請重新查核。");
export const parseRestrictionRequest = async (request: Request) => {
  const parsed = restrictionRequestSchema.safeParse(
    await readBoundedJson(request)
  );
  if (!parsed.success) {
    throw new BusinessApiError(
      400,
      "validation_error",
      "帳戶限制操作格式不正確。"
    );
  }
  return parsed.data;
};
const eligible = (action: RestrictionAction, target: ManagedAccount) => {
  if (action === "account_banned") {
    return target.banned === null;
  }
  if (action === "account_unbanned") {
    return target.banned !== null;
  }
  if (action === "membership_deactivated") {
    return target.membershipStatus === "active";
  }
  return target.membershipStatus === "deactivated";
};
export const changeAccountRestriction = async (
  headers: Headers,
  input: RestrictionRequest
) => {
  const actor = await requireSensitiveStaff(headers);
  const database = getDb();
  const hash = await fingerprintAccountChange(
    actor.userId,
    input.action,
    input
  );
  const existing = await findAccountChange(actor.userId, input.operationKey);
  if (existing) {
    return { created: false, receipt: matchingAccountChange(existing, hash) };
  }
  const target = await requireManagedAccount(actor, input.targetUserId);
  if (!eligible(input.action, target)) {
    const committed = await findAccountChange(actor.userId, input.operationKey);
    if (committed) {
      return {
        created: false,
        receipt: matchingAccountChange(committed, hash),
      };
    }
    throw conflict();
  }
  const receipt: AccountChangeReceipt = {
    action: input.action,
    createdAt: nowSeconds(),
    id: crypto.randomUUID(),
    targetUserId: target.userId,
  };
  let membership = target.membershipStatus;
  let ban = target.banned;
  if (input.action === "account_banned") {
    ban = receipt.createdAt;
  }
  if (input.action === "account_unbanned") {
    ban = null;
  }
  if (input.action === "membership_deactivated") {
    membership = "deactivated";
  }
  if (input.action === "membership_reactivated") {
    membership = "active";
  }
  const now = unixSecondsToDate(receipt.createdAt);
  const previousBan =
    target.banned === null ? null : unixSecondsToDate(target.banned);
  const nextBan = ban === null ? null : unixSecondsToDate(ban);
  const restrictionStateIsCurrent = exists(
    database
      .select({ present: sql`1` })
      .from(personProfile)
      .where(
        and(
          eq(personProfile.userId, target.userId),
          eq(personProfile.membershipStatus, target.membershipStatus),
          previousBan === null
            ? isNull(personProfile.bannedAt)
            : eq(personProfile.bannedAt, previousBan)
        )
      )
  );
  const restrictionStateIsWritten = exists(
    database
      .select({ present: sql`1` })
      .from(personProfile)
      .where(
        and(
          eq(personProfile.userId, target.userId),
          eq(personProfile.membershipStatus, membership),
          nextBan === null
            ? isNull(personProfile.bannedAt)
            : eq(personProfile.bannedAt, nextBan)
        )
      )
  );
  const statements: [AccountChangeBatchItem, ...AccountChangeBatchItem[]] = [
    sensitiveStaffAssertion(actor, target.userId),
    database
      .select({
        complete: sql`json(CASE WHEN ${restrictionStateIsCurrent} THEN 'null' ELSE 'Restriction state changed' END)`,
      })
      .from(user)
      .limit(1),
    database
      .update(personProfile)
      .set({ bannedAt: nextBan, membershipStatus: membership, updatedAt: now })
      .where(eq(personProfile.userId, target.userId)),
    ...recordAccountChange(
      receipt,
      actor.userId,
      input.operationKey,
      hash,
      null
    ),
    database
      .select({
        complete: sql`json(CASE WHEN ${restrictionStateIsWritten} THEN 'null' ELSE 'Incomplete restriction change' END)`,
      })
      .from(user)
      .limit(1),
  ];
  try {
    await database.batch(statements);
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
      current.membershipStatus !== target.membershipStatus ||
      current.banned !== target.banned
    ) {
      throw conflict();
    }
    if (
      target.role === "admin" &&
      ["account_banned", "membership_deactivated"].includes(input.action) &&
      !(await otherEffectiveAdminExists(target.userId))
    ) {
      throw lastAdminError();
    }
    throw error;
  }
  await requireSensitiveStaff(headers);
  return { created: true, receipt };
};
