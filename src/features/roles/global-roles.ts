import { createHmac } from "node:crypto";

import {
  asc,
  and,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  not,
  or,
  sql,
} from "drizzle-orm";
import type { SQLWrapper } from "drizzle-orm";

import { getAuth } from "../../server/auth";
import { getDb } from "../../server/db/client";
import type { Database } from "../../server/db/client";
import { accountSecurityOperation } from "../../server/db/schema/account-security";
import { auditEvent } from "../../server/db/schema/applications";
import { account, session, user } from "../../server/db/schema/auth";
import { personProfile } from "../../server/db/schema/identity";
import {
  roleAssignerAssignment,
  roleAssignmentHistory,
  roleChangeOperation,
} from "../../server/db/schema/roles";
import { requireStaff } from "../account/account-actors";
import { requireSensitiveStaff } from "../account/account-change-operations";
import { BusinessApiError, readBoundedJson } from "../account/business-request";
import {
  normalizedStaffAccountPage,
  parseStaffSearch,
  STAFF_ACCOUNT_PAGE_SIZE,
} from "../account/staff-search-contract";
import { dateToUnixSeconds, sqliteNowSeconds } from "../account/timestamps";
import type {
  GlobalRoleChangeInput,
  GlobalRoleReceipt,
} from "./global-role-contract";
import {
  globalRoleChangeSchema,
  globalRoleReconciliationSchema,
} from "./global-role-contract";
import { findRoleChangeOperation } from "./role-change-operation";
import {
  prepareStaffExitCleanup,
  ROLE_SCOPE_ID,
  ROLE_SCOPE_NAME,
  staffExitCleanupWrites,
  staffExitCleanupWrittenAssertion,
} from "./staff-exit-cleanup";
import type { StaffExitCleanupPlan } from "./staff-exit-cleanup";

const roleDenied = () =>
  new BusinessApiError(
    403,
    "business_access_denied",
    "只有目前有效的管理員可以管理全域角色。"
  );

const conflict = () =>
  new BusinessApiError(409, "conflict", "帳戶角色或狀態已改變，請重新查核。");

const eligibilityConflict = () =>
  new BusinessApiError(409, "conflict", "此帳戶目前未符合新增職員身份的條件。");

const adminEligibilityConflict = () =>
  new BusinessApiError(
    409,
    "conflict",
    "此帳戶目前未符合新增管理員身份的條件。"
  );

export type GlobalRoleAdminActor = Awaited<ReturnType<typeof requireStaff>>;
export type ConfirmedGlobalRoleAdminActor = Awaited<
  ReturnType<typeof requireSensitiveStaff>
>;

export const requireGlobalRoleAdmin = async (
  headers: Headers
): Promise<GlobalRoleAdminActor> => {
  const actor = await requireStaff(headers);
  if (actor.role !== "admin") {
    throw roleDenied();
  }
  return actor;
};

export const requireConfirmedGlobalRoleAdmin = async (
  headers: Headers
): Promise<ConfirmedGlobalRoleAdminActor> => {
  const actor = await requireSensitiveStaff(headers);
  if (actor.role !== "admin") {
    throw roleDenied();
  }
  return actor;
};

const eligibleStaffCandidate = (
  db: Database,
  targetUserId: SQLWrapper | string
) =>
  exists(
    db
      .select({ present: sql`1` })
      .from(personProfile)
      .leftJoin(
        account,
        and(
          eq(account.userId, personProfile.userId),
          eq(account.accountId, personProfile.userId),
          eq(account.providerId, "credential")
        )
      )
      .where(
        and(
          eq(personProfile.userId, targetUserId),
          eq(personProfile.accountRole, "member"),
          eq(personProfile.membershipStatus, "active"),
          isNull(personProfile.bannedAt),
          isNull(account.temporaryPasswordExpiresAt)
        )
      )
  );

const eligibleAdminCandidate = (
  db: Database,
  targetUserId: SQLWrapper | string,
  expectedRole: "member" | "staff"
) =>
  exists(
    db
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
          eq(personProfile.userId, targetUserId),
          eq(personProfile.accountRole, expectedRole),
          eq(personProfile.membershipStatus, "active"),
          isNull(personProfile.bannedAt),
          isNotNull(account.password),
          ne(account.password, ""),
          isNull(account.temporaryPasswordExpiresAt)
        )
      )
  );

export const staffTarget = (db: Database, targetUserId: SQLWrapper | string) =>
  exists(
    db
      .select({ present: sql`1` })
      .from(personProfile)
      .where(
        and(
          eq(personProfile.userId, targetUserId),
          eq(personProfile.accountRole, "staff")
        )
      )
  );

const roleAssignerIsAbsent = (db: Database, targetUserId: string) =>
  not(
    exists(
      db
        .select({ present: sql`1` })
        .from(roleAssignerAssignment)
        .where(eq(roleAssignerAssignment.userId, targetUserId))
    )
  );

const roleAssignerMatchesPlan = (
  db: Database,
  targetUserId: string,
  plan: StaffExitCleanupPlan
) =>
  plan.assignmentId
    ? exists(
        db
          .select({ present: sql`1` })
          .from(roleAssignerAssignment)
          .where(
            and(
              eq(roleAssignerAssignment.id, plan.assignmentId),
              eq(roleAssignerAssignment.userId, targetUserId)
            )
          )
      )
    : roleAssignerIsAbsent(db, targetUserId);

const currentGlobalRoleAdminSession = (
  db: Database,
  actor: GlobalRoleAdminActor
) =>
  db
    .select({ id: session.id })
    .from(session)
    .innerJoin(personProfile, eq(personProfile.userId, session.userId))
    .innerJoin(
      account,
      and(
        eq(account.userId, session.userId),
        eq(account.accountId, session.userId),
        eq(account.providerId, "credential"),
        isNotNull(account.password),
        ne(account.password, ""),
        isNull(account.temporaryPasswordExpiresAt),
        eq(account.credentialRevision, session.credentialRevision)
      )
    )
    .where(
      and(
        eq(session.id, actor.sessionId),
        eq(session.userId, actor.userId),
        gt(session.expiresAt, sqliteNowSeconds),
        eq(personProfile.accountRole, "admin"),
        eq(personProfile.membershipStatus, "active"),
        isNull(personProfile.bannedAt)
      )
    );

export const confirmedGlobalRoleAdminExists = (
  db: Database,
  actor: ConfirmedGlobalRoleAdminActor
) =>
  exists(
    db
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
      .where(
        and(
          eq(session.id, actor.sessionId),
          eq(session.userId, actor.userId),
          gt(session.expiresAt, sqliteNowSeconds),
          isNotNull(account.password),
          ne(account.password, ""),
          isNull(account.temporaryPasswordExpiresAt),
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
          eq(personProfile.accountRole, "admin"),
          eq(personProfile.membershipStatus, "active"),
          isNull(personProfile.bannedAt)
        )
      )
  );

export interface GlobalRolePerson {
  eligibleForAdmin: boolean;
  eligibleForStaff: boolean;
  eligibleForRoleAssigner: boolean;
  fullName: string;
  role: "member" | "staff";
  roleAssignerAssignment: { assignmentId: string; createdAt: number } | null;
  userId: string;
  username: string | null;
}

export interface GlobalRoleCandidate {
  fullName: string;
  userId: string;
  username: string | null;
}

export interface GlobalRoleSearchPage {
  actorUserId: string;
  candidates: GlobalRoleCandidate[];
  hasNextPage: boolean;
  page: number;
}

export const searchGlobalRolePeople = async (
  headers: Headers,
  requestedQuery: string | undefined,
  requestedPage: string | undefined
): Promise<GlobalRoleSearchPage> => {
  const actor = await requireGlobalRoleAdmin(headers);
  const query = parseStaffSearch(requestedQuery);
  const page = normalizedStaffAccountPage(requestedPage);
  if (!query) {
    return {
      actorUserId: actor.userId,
      candidates: [],
      hasNextPage: false,
      page: 1,
    };
  }

  const db = getDb();
  const eligibleMember = eligibleStaffCandidate(db, user.id);
  const currentStaff = staffTarget(db, user.id);
  const rows = await db
    .select({
      fullName: user.name,
      userId: user.id,
      username: user.displayUsername,
    })
    .from(user)
    .innerJoin(personProfile, eq(personProfile.userId, user.id))
    .where(
      and(
        sql`instr(${personProfile.staffSearchKey}, ${query}) > 0`,
        or(eligibleMember, currentStaff),
        exists(currentGlobalRoleAdminSession(db, actor))
      )
    )
    .orderBy(asc(user.name), asc(user.id))
    .limit(STAFF_ACCOUNT_PAGE_SIZE + 1)
    .offset((page - 1) * STAFF_ACCOUNT_PAGE_SIZE);
  await requireGlobalRoleAdmin(headers);
  return {
    actorUserId: actor.userId,
    candidates: rows.slice(0, STAFF_ACCOUNT_PAGE_SIZE),
    hasNextPage: rows.length > STAFF_ACCOUNT_PAGE_SIZE,
    page,
  };
};

export const getGlobalRolePerson = async (
  headers: Headers,
  targetUserId: string
): Promise<GlobalRolePerson | null> => {
  const actor = await requireGlobalRoleAdmin(headers);
  const db = getDb();
  const row = await db
    .select({
      accountRole: personProfile.accountRole,
      assignmentCreatedAt: roleAssignerAssignment.createdAt,
      assignmentId: roleAssignerAssignment.id,
      bannedAt: personProfile.bannedAt,
      fullName: user.name,
      hasUsablePermanentCredential: sql<boolean>`COALESCE(
        ${account.password} IS NOT NULL
        AND ${account.password} <> ''
        AND ${account.temporaryPasswordExpiresAt} IS NULL,
        0
      )`.mapWith(Boolean),
      membershipStatus: personProfile.membershipStatus,
      temporaryPasswordExpiresAt: account.temporaryPasswordExpiresAt,
      userId: user.id,
      username: user.displayUsername,
    })
    .from(user)
    .innerJoin(personProfile, eq(personProfile.userId, user.id))
    .leftJoin(
      account,
      and(
        eq(account.userId, user.id),
        eq(account.accountId, user.id),
        eq(account.providerId, "credential")
      )
    )
    .leftJoin(
      roleAssignerAssignment,
      eq(roleAssignerAssignment.userId, user.id)
    )
    .where(
      and(
        eq(user.id, targetUserId),
        ne(user.id, actor.userId),
        inArray(personProfile.accountRole, ["member", "staff"]),
        exists(currentGlobalRoleAdminSession(db, actor))
      )
    )
    .limit(1)
    .get();
  await requireGlobalRoleAdmin(headers);
  if (!row || (row.accountRole !== "member" && row.accountRole !== "staff")) {
    return null;
  }
  const eligibleCurrentRole =
    row.membershipStatus === "active" &&
    row.bannedAt === null &&
    row.temporaryPasswordExpiresAt === null;
  return {
    eligibleForAdmin: eligibleCurrentRole && row.hasUsablePermanentCredential,
    eligibleForRoleAssigner: row.accountRole === "staff" && eligibleCurrentRole,
    eligibleForStaff: row.accountRole === "member" && eligibleCurrentRole,
    fullName: row.fullName,
    role: row.accountRole,
    roleAssignerAssignment:
      row.assignmentId && row.assignmentCreatedAt
        ? {
            assignmentId: row.assignmentId,
            createdAt: dateToUnixSeconds(row.assignmentCreatedAt),
          }
        : null,
    userId: row.userId,
    username: row.username,
  };
};

type GlobalRoleCurrentRole = "admin" | "member" | "staff";

const globalRoleTargetIsCurrent = (
  db: Database,
  actor: ConfirmedGlobalRoleAdminActor,
  input: GlobalRoleChangeInput,
  expectedCurrentRole: GlobalRoleCurrentRole
): SQLWrapper => {
  if (input.role === "admin") {
    if (input.action === "withdrawn") {
      return (
        and(
          eq(user.id, actor.userId),
          confirmedGlobalRoleAdminExists(db, actor)
        ) ?? sql`0`
      );
    }
    if (expectedCurrentRole === "admin") {
      return sql`0`;
    }
    return eligibleAdminCandidate(db, input.targetUserId, expectedCurrentRole);
  }
  if (input.action === "granted") {
    return eligibleStaffCandidate(db, input.targetUserId);
  }
  return staffTarget(db, input.targetUserId);
};

const globalRoleWriteAssertion = (
  db: Database,
  actor: ConfirmedGlobalRoleAdminActor,
  input: GlobalRoleChangeInput,
  cleanup: StaffExitCleanupPlan,
  expectedCurrentRole: GlobalRoleCurrentRole
) => {
  const confirmedActor = confirmedGlobalRoleAdminExists(db, actor);
  const targetCurrent = globalRoleTargetIsCurrent(
    db,
    actor,
    input,
    expectedCurrentRole
  );
  const delegationCurrent = roleAssignerMatchesPlan(
    db,
    input.targetUserId,
    cleanup
  );
  return db
    .select({
      complete: sql`json(CASE WHEN ${and(
        confirmedActor,
        targetCurrent,
        delegationCurrent,
        input.action === "withdrawn" && input.role === "admin"
          ? eq(user.id, actor.userId)
          : ne(user.id, actor.userId)
      )} THEN 'null' ELSE 'Global role authority changed' END)`,
    })
    .from(user)
    .where(eq(user.id, input.targetUserId))
    .limit(1);
};

const requiredGlobalRoleWrites = (
  db: Database,
  actorUserId: string,
  input: GlobalRoleChangeInput,
  resultingGlobalRole: "admin" | "member" | "staff",
  historyId: string,
  auditId: string,
  operationId: string
) => {
  const roleWritten = exists(
    db
      .select({ present: sql`1` })
      .from(personProfile)
      .where(
        and(
          eq(personProfile.userId, input.targetUserId),
          eq(personProfile.accountRole, resultingGlobalRole)
        )
      )
  );
  const noRevivedDelegation = roleAssignerIsAbsent(db, input.targetUserId);
  const targetSessionsRevoked =
    input.role === "admin"
      ? not(
          exists(
            db
              .select({ present: sql`1` })
              .from(session)
              .where(eq(session.userId, input.targetUserId))
          )
        )
      : sql`1`;
  const historyWritten = exists(
    db
      .select({ present: sql`1` })
      .from(roleAssignmentHistory)
      .where(
        and(
          eq(roleAssignmentHistory.id, historyId),
          eq(roleAssignmentHistory.actorUserId, actorUserId),
          eq(roleAssignmentHistory.targetUserId, input.targetUserId),
          eq(roleAssignmentHistory.scopeId, ROLE_SCOPE_ID),
          eq(roleAssignmentHistory.scopeName, ROLE_SCOPE_NAME),
          eq(roleAssignmentHistory.action, input.action),
          eq(roleAssignmentHistory.role, input.role),
          eq(roleAssignmentHistory.resultingGlobalRole, resultingGlobalRole)
        )
      )
  );
  const auditWritten = exists(
    db
      .select({ present: sql`1` })
      .from(auditEvent)
      .where(
        and(
          eq(auditEvent.id, auditId),
          eq(auditEvent.actorUserId, actorUserId),
          eq(auditEvent.targetUserId, input.targetUserId),
          eq(auditEvent.action, "global_role_changed")
        )
      )
  );
  const operationWritten = exists(
    db
      .select({ present: sql`1` })
      .from(roleChangeOperation)
      .where(
        and(
          eq(roleChangeOperation.id, operationId),
          eq(roleChangeOperation.actorUserId, actorUserId),
          eq(roleChangeOperation.operationKey, input.operationKey),
          eq(roleChangeOperation.targetUserId, input.targetUserId),
          eq(roleChangeOperation.scopeId, ROLE_SCOPE_ID),
          eq(roleChangeOperation.scopeName, ROLE_SCOPE_NAME),
          eq(roleChangeOperation.action, input.action),
          eq(roleChangeOperation.role, input.role),
          eq(roleChangeOperation.resultingGlobalRole, resultingGlobalRole)
        )
      )
  );
  return db
    .select({
      complete: sql`json(CASE WHEN ${and(
        roleWritten,
        noRevivedDelegation,
        targetSessionsRevoked,
        historyWritten,
        auditWritten,
        operationWritten
      )} THEN 'null' ELSE 'Incomplete Global role change' END)`,
      createdAt: sql<number>`(
        SELECT created_at FROM role_change_operation WHERE id = ${operationId}
      )`,
    })
    .from(user)
    .where(eq(user.id, input.targetUserId))
    .limit(1);
};

const fingerprintGlobalRoleChange = async (
  actorUserId: string,
  input: GlobalRoleChangeInput
) => {
  const context = await getAuth().$context;
  return createHmac("sha256", context.secret)
    .update(JSON.stringify([actorUserId, "global_role", input]))
    .digest("hex");
};

const findGlobalRoleChange = async (
  headers: Headers,
  actorUserId: string,
  operationKey: string
) => {
  const row = await findRoleChangeOperation(getDb(), actorUserId, operationKey);
  if (!row) {
    return null;
  }
  await requireGlobalRoleAdmin(headers);
  return {
    ...row,
    createdAt: dateToUnixSeconds(row.createdAt),
  };
};

const matchingGlobalRoleChange = (
  row: NonNullable<Awaited<ReturnType<typeof findGlobalRoleChange>>>,
  requestHash: string
): GlobalRoleReceipt => {
  if (
    (row.role !== "staff" && row.role !== "admin") ||
    row.requestHash !== requestHash
  ) {
    throw conflict();
  }
  if (row.role === "admin") {
    if (row.action === "granted" && row.resultingGlobalRole === "admin") {
      return {
        action: "granted",
        createdAt: row.createdAt,
        id: row.id,
        resultingGlobalRole: "admin",
        role: "admin",
        targetUserId: row.targetUserId,
      };
    }
    if (
      row.action === "withdrawn" &&
      (row.resultingGlobalRole === "member" ||
        row.resultingGlobalRole === "staff")
    ) {
      return {
        action: "withdrawn",
        createdAt: row.createdAt,
        id: row.id,
        resultingGlobalRole: row.resultingGlobalRole,
        role: "admin",
        targetUserId: row.targetUserId,
      };
    }
    throw conflict();
  }
  if (
    row.resultingGlobalRole !== "member" &&
    row.resultingGlobalRole !== "staff"
  ) {
    throw conflict();
  }
  return {
    action: row.action,
    createdAt: row.createdAt,
    id: row.id,
    resultingGlobalRole: row.resultingGlobalRole,
    role: "staff",
    targetUserId: row.targetUserId,
  };
};

const targetRoleNow = async (targetUserId: string) => {
  const row = await getDb()
    .select({ role: personProfile.accountRole })
    .from(personProfile)
    .where(eq(personProfile.userId, targetUserId))
    .limit(1)
    .get();
  return row?.role ?? null;
};

const candidateIsEligibleNow = async (targetUserId: string) =>
  await getDb()
    .select({ present: sql`1` })
    .from(personProfile)
    .leftJoin(
      account,
      and(
        eq(account.userId, personProfile.userId),
        eq(account.accountId, personProfile.userId),
        eq(account.providerId, "credential")
      )
    )
    .where(
      and(
        eq(personProfile.userId, targetUserId),
        eq(personProfile.accountRole, "member"),
        eq(personProfile.membershipStatus, "active"),
        isNull(personProfile.bannedAt),
        isNull(account.temporaryPasswordExpiresAt)
      )
    )
    .limit(1)
    .get();

const adminCandidateIsEligibleNow = async (
  targetUserId: string,
  expectedRole: "member" | "staff"
) =>
  await getDb()
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
        eq(personProfile.userId, targetUserId),
        eq(personProfile.accountRole, expectedRole),
        eq(personProfile.membershipStatus, "active"),
        isNull(personProfile.bannedAt),
        isNotNull(account.password),
        ne(account.password, ""),
        isNull(account.temporaryPasswordExpiresAt)
      )
    )
    .limit(1)
    .get();

const expectedCurrentRoleForGlobalRoleChange = async (
  input: GlobalRoleChangeInput,
  actorUserId: string
): Promise<GlobalRoleCurrentRole> => {
  if (input.role === "admin") {
    if (input.action === "withdrawn") {
      if (
        input.targetUserId !== actorUserId ||
        (await targetRoleNow(input.targetUserId)) !== "admin"
      ) {
        throw conflict();
      }
      return "admin";
    }
    const currentRole = await targetRoleNow(input.targetUserId);
    if (currentRole !== "member" && currentRole !== "staff") {
      throw conflict();
    }
    if (!(await adminCandidateIsEligibleNow(input.targetUserId, currentRole))) {
      throw adminEligibilityConflict();
    }
    return currentRole;
  }
  if (input.action === "granted") {
    if (!(await candidateIsEligibleNow(input.targetUserId))) {
      throw eligibilityConflict();
    }
    return "member";
  }
  if ((await targetRoleNow(input.targetUserId)) !== "staff") {
    throw conflict();
  }
  return "staff";
};

const resultingGlobalRoleForChange = (
  input: GlobalRoleChangeInput
): "admin" | "member" | "staff" => {
  if (input.role === "admin") {
    return input.action === "granted" ? "admin" : input.resultingGlobalRole;
  }
  if (input.action === "granted") {
    return "staff";
  }
  return "member";
};

const targetStillEligibleForGlobalRoleChange = async (
  input: GlobalRoleChangeInput,
  expectedCurrentRole: GlobalRoleCurrentRole
): Promise<boolean> => {
  if ((await targetRoleNow(input.targetUserId)) !== expectedCurrentRole) {
    return false;
  }
  if (input.role === "admin") {
    if (input.action === "withdrawn" || expectedCurrentRole === "admin") {
      return false;
    }
    return Boolean(
      await adminCandidateIsEligibleNow(input.targetUserId, expectedCurrentRole)
    );
  }
  if (input.action === "granted") {
    return Boolean(await candidateIsEligibleNow(input.targetUserId));
  }
  return true;
};

interface PreparedGlobalRoleChange {
  actor: GlobalRoleAdminActor;
  auditId: string;
  cleanup: StaffExitCleanupPlan;
  confirmedActor: ConfirmedGlobalRoleAdminActor;
  db: Database;
  expectedCurrentRole: GlobalRoleCurrentRole;
  historyId: string;
  resultingGlobalRole: "admin" | "member" | "staff";
  roleAssignerCleanupRequired: boolean;
  selfStepdown: boolean;
  operationId: string;
}

const prepareGlobalRoleChange = async (
  headers: Headers,
  input: GlobalRoleChangeInput,
  actor: GlobalRoleAdminActor,
  selfStepdown: boolean
): Promise<PreparedGlobalRoleChange> => {
  const confirmedActor = await requireConfirmedGlobalRoleAdmin(headers);
  const expectedCurrentRole = await expectedCurrentRoleForGlobalRoleChange(
    input,
    actor.userId
  );
  const db = getDb();
  const cleanup =
    (input.role === "staff" && input.action === "withdrawn") ||
    (input.role === "admin" &&
      input.action === "granted" &&
      expectedCurrentRole === "staff")
      ? await prepareStaffExitCleanup(db, input.targetUserId)
      : { assignmentId: null, auditId: null, historyId: null };
  const roleAssignerCleanupRequired =
    (input.role === "staff" && input.action === "withdrawn") ||
    (input.role === "admin" &&
      input.action === "granted" &&
      expectedCurrentRole === "staff");
  return {
    actor,
    auditId: crypto.randomUUID(),
    cleanup,
    confirmedActor,
    db,
    expectedCurrentRole,
    historyId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    resultingGlobalRole: resultingGlobalRoleForChange(input),
    roleAssignerCleanupRequired,
    selfStepdown,
  };
};

const performGlobalRoleBatch = (
  input: GlobalRoleChangeInput,
  plan: PreparedGlobalRoleChange,
  requestHash: string
): Promise<unknown[]> => {
  const operationCreatedAt = sql`(
    SELECT created_at FROM role_change_operation WHERE id = ${plan.operationId}
  )`;
  const {
    actor,
    auditId,
    cleanup,
    confirmedActor,
    db,
    expectedCurrentRole,
    historyId,
    operationId,
    resultingGlobalRole,
    roleAssignerCleanupRequired,
  } = plan;
  return db.batch([
    globalRoleWriteAssertion(
      db,
      confirmedActor,
      input,
      cleanup,
      expectedCurrentRole
    ),
    db.insert(roleChangeOperation).values({
      action: input.action,
      actorUserId: actor.userId,
      createdAt: sql`unixepoch()`,
      id: operationId,
      operationKey: input.operationKey,
      requestHash,
      resultingGlobalRole,
      role: input.role,
      scopeId: ROLE_SCOPE_ID,
      scopeName: ROLE_SCOPE_NAME,
      targetUserId: input.targetUserId,
    }),
    db
      .update(personProfile)
      .set({ accountRole: resultingGlobalRole, updatedAt: sql`unixepoch()` })
      .where(
        and(
          eq(personProfile.userId, input.targetUserId),
          eq(personProfile.accountRole, expectedCurrentRole)
        )
      ),
    ...staffExitCleanupWrites(
      db,
      actor.userId,
      input.targetUserId,
      cleanup,
      operationCreatedAt
    ),
    db.insert(roleAssignmentHistory).values({
      action: input.action,
      actorUserId: actor.userId,
      createdAt: operationCreatedAt,
      id: historyId,
      resultingGlobalRole,
      role: input.role,
      scopeId: ROLE_SCOPE_ID,
      scopeName: ROLE_SCOPE_NAME,
      targetUserId: input.targetUserId,
    }),
    db.insert(auditEvent).values({
      action: "global_role_changed",
      actorUserId: actor.userId,
      createdAt: operationCreatedAt,
      id: auditId,
      targetUserId: input.targetUserId,
    }),
    ...(roleAssignerCleanupRequired
      ? [
          staffExitCleanupWrittenAssertion(
            db,
            actor.userId,
            input.targetUserId,
            cleanup
          ),
        ]
      : []),
    ...(input.role === "admin"
      ? [db.delete(session).where(eq(session.userId, input.targetUserId))]
      : []),
    requiredGlobalRoleWrites(
      db,
      actor.userId,
      input,
      resultingGlobalRole,
      historyId,
      auditId,
      operationId
    ),
  ]);
};

const handleGlobalRoleBatchFailure = async (
  headers: Headers,
  input: GlobalRoleChangeInput,
  plan: PreparedGlobalRoleChange,
  requestHash: string,
  error: unknown
) => {
  if (plan.selfStepdown) {
    if (
      error instanceof Error &&
      /Last effective administrator|Global role authority changed|Incomplete Global role change|malformed JSON/u.test(
        error.message
      )
    ) {
      throw conflict();
    }
    throw error;
  }
  const committed = await findGlobalRoleChange(
    headers,
    plan.actor.userId,
    input.operationKey
  );
  if (committed) {
    return {
      created: false,
      receipt: matchingGlobalRoleChange(committed, requestHash),
    };
  }
  await requireConfirmedGlobalRoleAdmin(headers);
  if (
    !(await targetStillEligibleForGlobalRoleChange(
      input,
      plan.expectedCurrentRole
    ))
  ) {
    throw conflict();
  }
  throw error;
};

const selfStepdownReceiptFromBatch = (
  input: GlobalRoleChangeInput,
  plan: PreparedGlobalRoleChange,
  batchResults: unknown[]
) => {
  const lastResult = batchResults.at(-1);
  const witness =
    Array.isArray(lastResult) &&
    lastResult[0] !== null &&
    typeof lastResult[0] === "object"
      ? (lastResult[0] as { complete?: unknown; createdAt?: unknown })
      : undefined;
  if (
    !witness ||
    witness.complete !== "null" ||
    typeof witness.createdAt !== "number" ||
    !Number.isSafeInteger(witness.createdAt) ||
    witness.createdAt < 0
  ) {
    throw new Error("Committed Admin step-down has no bounded completion");
  }
  return {
    created: true,
    receipt: {
      action: "withdrawn" as const,
      createdAt: witness.createdAt,
      id: plan.operationId,
      resultingGlobalRole: plan.resultingGlobalRole,
      role: "admin" as const,
      targetUserId: input.targetUserId,
    },
  };
};

const receiptAfterGlobalRoleBatch = async (
  headers: Headers,
  input: GlobalRoleChangeInput,
  plan: PreparedGlobalRoleChange,
  requestHash: string
) => {
  const committed = await findGlobalRoleChange(
    headers,
    plan.actor.userId,
    input.operationKey
  );
  if (!committed) {
    throw new Error("Committed Global role change has no receipt");
  }
  return {
    created: true,
    receipt: matchingGlobalRoleChange(committed, requestHash),
  };
};

export const changeGlobalRole = async (
  headers: Headers,
  input: GlobalRoleChangeInput
) => {
  const actor = await requireGlobalRoleAdmin(headers);
  const selfStepdown = input.role === "admin" && input.action === "withdrawn";
  if ((actor.userId === input.targetUserId) !== selfStepdown) {
    throw conflict();
  }
  const requestHash = await fingerprintGlobalRoleChange(actor.userId, input);
  const existing = await findGlobalRoleChange(
    headers,
    actor.userId,
    input.operationKey
  );
  if (existing) {
    return {
      created: false,
      receipt: matchingGlobalRoleChange(existing, requestHash),
    };
  }

  const plan = await prepareGlobalRoleChange(
    headers,
    input,
    actor,
    selfStepdown
  );
  let batchResults: unknown[];
  try {
    batchResults = await performGlobalRoleBatch(input, plan, requestHash);
  } catch (error) {
    return handleGlobalRoleBatchFailure(
      headers,
      input,
      plan,
      requestHash,
      error
    );
  }
  return selfStepdown
    ? selfStepdownReceiptFromBatch(input, plan, batchResults)
    : receiptAfterGlobalRoleBatch(headers, input, plan, requestHash);
};

export const reconcileGlobalRoleChange = async (
  headers: Headers,
  operationKey: string
): Promise<GlobalRoleReceipt | null> => {
  const actor = await requireGlobalRoleAdmin(headers);
  const row = await findGlobalRoleChange(headers, actor.userId, operationKey);
  if (!row) {
    return null;
  }
  if (row.role === "admin") {
    return row.action === "granted" && row.resultingGlobalRole === "admin"
      ? {
          action: "granted",
          createdAt: row.createdAt,
          id: row.id,
          resultingGlobalRole: "admin",
          role: "admin",
          targetUserId: row.targetUserId,
        }
      : null;
  }
  return row.role === "staff" &&
    (row.resultingGlobalRole === "member" ||
      row.resultingGlobalRole === "staff")
    ? {
        action: row.action,
        createdAt: row.createdAt,
        id: row.id,
        resultingGlobalRole: row.resultingGlobalRole,
        role: "staff",
        targetUserId: row.targetUserId,
      }
    : null;
};

export const parseGlobalRoleChange = async (request: Request) => {
  const parsed = globalRoleChangeSchema.safeParse(
    await readBoundedJson(request)
  );
  if (!parsed.success) {
    throw new BusinessApiError(
      400,
      "validation_error",
      "角色變更資料格式不正確。"
    );
  }
  return parsed.data;
};

export const parseGlobalRoleReconciliation = async (request: Request) => {
  const parsed = globalRoleReconciliationSchema.safeParse(
    await readBoundedJson(request)
  );
  if (!parsed.success) {
    throw new BusinessApiError(400, "validation_error", "操作代碼格式不正確。");
  }
  return parsed.data;
};
