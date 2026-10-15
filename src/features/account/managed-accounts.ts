import {
  and,
  asc,
  eq,
  exists,
  gt,
  inArray,
  isNull,
  ne,
  sql,
} from "drizzle-orm";

import { getDb } from "../../server/db/client";
import { account, session, user } from "../../server/db/schema/auth";
import type {
  AccountRole,
  MembershipStatus,
} from "../../server/db/schema/identity";
import { personProfile } from "../../server/db/schema/identity";
import { requireStaff } from "./account-actors";
import type { StaffActor } from "./account-actors";
import { BusinessApiError } from "./business-request";
import { dateToUnixSeconds } from "./timestamps";

export interface ManagedAccount {
  userId: string;
  fullName: string;
  username: string | null;
  email: string;
  phone: string | null;
  phoneShared: number;
  verifiedRecoveryPhone: string | null;
  temporaryPasswordExpiresAt: number | null;
  membershipStatus: MembershipStatus;
  banned: number | null;
  role: AccountRole;
  credentialRevision: number;
}

const denied = () =>
  new BusinessApiError(
    403,
    "business_access_denied",
    "你沒有管理此帳戶的權限。"
  );
const storedSeconds = (value: Date | null): number | null =>
  value === null ? null : dateToUnixSeconds(value);

export const getStaffAccounts = async (
  headers: Headers
): Promise<ManagedAccount[]> => {
  const actor = await requireStaff(headers);
  const db = getDb();
  const currentStaffSession = db
    .select({ id: session.id })
    .from(session)
    .innerJoin(personProfile, eq(personProfile.userId, session.userId))
    .innerJoin(
      account,
      and(
        eq(account.userId, session.userId),
        eq(account.accountId, session.userId),
        eq(account.providerId, "credential")
      )
    )
    .where(
      and(
        eq(session.id, actor.sessionId),
        eq(session.userId, actor.userId),
        gt(session.expiresAt, sql`CAST(strftime('%s','now') AS INTEGER)`),
        eq(session.credentialRevision, account.credentialRevision),
        isNull(account.temporaryPasswordExpiresAt),
        eq(personProfile.membershipStatus, "active"),
        isNull(personProfile.bannedAt),
        inArray(personProfile.accountRole, ["staff", "admin"])
      )
    );
  const discoverableRole =
    actor.role === "admin"
      ? undefined
      : eq(personProfile.accountRole, "member");

  const rows = await db
    .select({
      banned: personProfile.bannedAt,
      credentialRevision: account.credentialRevision,
      email: user.email,
      fullName: user.name,
      membershipStatus: personProfile.membershipStatus,
      phone: personProfile.phone,
      phoneShared: personProfile.phoneShared,
      role: personProfile.accountRole,
      temporaryPasswordExpiresAt: account.temporaryPasswordExpiresAt,
      userId: user.id,
      username: user.displayUsername,
      verifiedRecoveryPhone: personProfile.verifiedRecoveryPhone,
    })
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
        ne(user.id, actor.userId),
        discoverableRole,
        exists(currentStaffSession)
      )
    )
    .orderBy(asc(user.name), asc(user.id));
  await requireStaff(headers);
  return rows.map((row) => ({
    ...row,
    banned: storedSeconds(row.banned),
    phoneShared: row.phoneShared ? 1 : 0,
    temporaryPasswordExpiresAt: storedSeconds(row.temporaryPasswordExpiresAt),
  }));
};

export const requireManagedAccount = async (
  actor: StaffActor,
  id: string
): Promise<ManagedAccount> => {
  const row = await getDb()
    .select({
      banned: personProfile.bannedAt,
      credentialRevision: account.credentialRevision,
      email: user.email,
      fullName: user.name,
      membershipStatus: personProfile.membershipStatus,
      phone: personProfile.phone,
      phoneShared: personProfile.phoneShared,
      role: personProfile.accountRole,
      temporaryPasswordExpiresAt: account.temporaryPasswordExpiresAt,
      userId: user.id,
      username: user.displayUsername,
      verifiedRecoveryPhone: personProfile.verifiedRecoveryPhone,
    })
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
    .where(eq(user.id, id))
    .limit(1)
    .get();
  if (
    !row ||
    id === actor.userId ||
    (actor.role === "staff" && row.role !== "member")
  ) {
    throw denied();
  }
  return {
    ...row,
    banned: storedSeconds(row.banned),
    phoneShared: row.phoneShared ? 1 : 0,
    temporaryPasswordExpiresAt: storedSeconds(row.temporaryPasswordExpiresAt),
  };
};
