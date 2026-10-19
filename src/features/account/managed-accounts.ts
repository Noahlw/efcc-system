import { and, asc, eq, exists, gt, isNull, ne, sql } from "drizzle-orm";

import { getDb } from "../../server/db/client";
import type { Database } from "../../server/db/client";
import { account, session, user } from "../../server/db/schema/auth";
import type {
  AccountRole,
  MembershipStatus,
} from "../../server/db/schema/identity";
import { personProfile } from "../../server/db/schema/identity";
import { requireStaff } from "./account-actors";
import type { StaffActor } from "./account-actors";
import { BusinessApiError } from "./business-request";
import {
  normalizedStaffAccountPage,
  parseStaffSearch,
  STAFF_ACCOUNT_PAGE_SIZE,
} from "./staff-search-contract";
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

/** Completed Staff receipts use current read/Audit authority, never fresh-write proof. */
export const requireManagedReceiptAccess = async (
  headers: Headers,
  targetUserId: string
) => {
  const actor = await requireStaff(headers);
  const target = await getDb()
    .select({ role: personProfile.accountRole })
    .from(personProfile)
    .where(eq(personProfile.userId, targetUserId))
    .get();
  // A missing target is recoverable under the same current Staff Audit authority.
  if (
    target &&
    (targetUserId === actor.userId ||
      (actor.role === "staff" && target.role !== "member"))
  ) {
    throw denied();
  }
  await requireStaff(headers);
};
const storedSeconds = (value: Date | null): number | null =>
  value === null ? null : dateToUnixSeconds(value);

const currentStaffSession = (db: Database, actor: StaffActor) =>
  db
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
        eq(personProfile.accountRole, actor.role)
      )
    );

const discoverableRole = (actor: StaffActor) =>
  actor.role === "admin" ? undefined : eq(personProfile.accountRole, "member");

export interface StaffAccountDirectoryEntry {
  userId: string;
  fullName: string;
  username: string | null;
}

export interface StaffAccountPage {
  accounts: StaffAccountDirectoryEntry[];
  hasNextPage: boolean;
  page: number;
}

export const getStaffAccounts = async (
  headers: Headers
): Promise<ManagedAccount[]> => {
  const actor = await requireStaff(headers);
  const db = getDb();
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
        discoverableRole(actor),
        exists(currentStaffSession(db, actor))
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

export const staffAccountPageQuery = (
  db: Database,
  actor: StaffActor,
  pageNumber: number,
  query: string
) =>
  db
    .select({
      fullName: user.name,
      userId: user.id,
      username: user.displayUsername,
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
        discoverableRole(actor),
        query
          ? sql`instr(${personProfile.staffSearchKey}, ${query}) > 0`
          : undefined,
        exists(currentStaffSession(db, actor))
      )
    )
    .orderBy(asc(user.name), asc(user.id))
    .limit(STAFF_ACCOUNT_PAGE_SIZE + 1)
    .offset((pageNumber - 1) * STAFF_ACCOUNT_PAGE_SIZE);

export const getStaffAccountPage = async (
  headers: Headers,
  requestedPage: string | undefined,
  requestedQuery?: string
): Promise<StaffAccountPage> => {
  const actor = await requireStaff(headers);
  const db = getDb();
  const query = parseStaffSearch(requestedQuery);
  if (query) {
    const incomplete = await db
      .select({ id: personProfile.userId })
      .from(personProfile)
      .where(isNull(personProfile.staffSearchKey))
      .limit(1)
      .get();
    if (incomplete) {
      await requireStaff(headers);
      throw new Error("Staff search projection backfill is incomplete");
    }
  }
  let page = normalizedStaffAccountPage(requestedPage);

  const readPage = (pageNumber: number) =>
    staffAccountPageQuery(db, actor, pageNumber, query).all();

  let rows = await readPage(page);
  if (page > 1 && rows.length === 0) {
    page = 1;
    rows = await readPage(page);
  }
  await requireStaff(headers);

  return {
    accounts: rows.slice(0, STAFF_ACCOUNT_PAGE_SIZE),
    hasNextPage: rows.length > STAFF_ACCOUNT_PAGE_SIZE,
    page,
  };
};

export const getStaffAccountDetail = async (
  headers: Headers,
  id: string
): Promise<ManagedAccount | undefined> => {
  const actor = await requireStaff(headers);
  const db = getDb();
  const discoverableTargetRole =
    actor.role === "admin"
      ? undefined
      : eq(personProfile.accountRole, "member");
  const row = await db
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
        eq(user.id, id),
        ne(user.id, actor.userId),
        discoverableTargetRole,
        exists(currentStaffSession(db, actor))
      )
    )
    .limit(1)
    .get();
  await requireStaff(headers);
  if (!row) {
    return undefined;
  }
  return {
    ...row,
    banned: storedSeconds(row.banned),
    phoneShared: row.phoneShared ? 1 : 0,
    temporaryPasswordExpiresAt: storedSeconds(row.temporaryPasswordExpiresAt),
  };
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
    row.role === "admin" ||
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
