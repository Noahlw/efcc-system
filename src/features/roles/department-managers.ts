import { createHmac } from "node:crypto";

import {
  and,
  asc,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  not,
  ne,
  or,
  sql,
} from "drizzle-orm";
import type { SQLWrapper } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import { getAuth } from "../../server/auth";
import { getDb } from "../../server/db/client";
import type { Database } from "../../server/db/client";
import { accountSecurityOperation } from "../../server/db/schema/account-security";
import { department, program } from "../../server/db/schema/activities";
import { auditEvent } from "../../server/db/schema/applications";
import { account, session, user } from "../../server/db/schema/auth";
import { personProfile } from "../../server/db/schema/identity";
import {
  departmentManagerAssignment,
  programLeaderAssignment,
} from "../../server/db/schema/notices";
import {
  roleAssignmentHistory,
  roleAssignerAssignment,
  roleChangeOperation,
} from "../../server/db/schema/roles";
import { requireStaff } from "../account/account-actors";
import { requireSensitiveStaff as requireStaffPasswordProof } from "../account/account-change-operations";
import { BusinessApiError, readBoundedJson } from "../account/business-request";
import {
  normalizedStaffAccountPage,
  parseStaffSearch,
  STAFF_ACCOUNT_PAGE_SIZE,
} from "../account/staff-search-contract";
import { sqliteNowSeconds, dateToUnixSeconds } from "../account/timestamps";
import type {
  DepartmentManagerChangeInput,
  DepartmentManagerReceipt,
} from "./department-manager-contract";
import {
  departmentManagerChangeSchema,
  departmentManagerReconciliationSchema,
} from "./department-manager-contract";
import {
  getProgramLeaderPerson,
  preparePersonScopedProgramChange,
} from "./program-leaders";
import { findRoleChangeOperation } from "./role-change-operation";
import {
  MIXED_SCOPED_ROLE_CHANGE_LIMIT,
  legacyScopedRoleChangeReceiptSchema,
  SCOPED_ROLE_CHANGE_LIMIT,
  scopedRoleChangeReceiptSchema,
  scopedRoleChangeSchema,
} from "./scoped-role-change-contract";
import type {
  ScopedRoleChangeInput,
  ScopedRoleChangeReceipt,
} from "./scoped-role-change-contract";

const denied = () =>
  new BusinessApiError(
    403,
    "business_access_denied",
    "目前帳戶沒有管理部門負責人的權限。"
  );

const conflict = () =>
  new BusinessApiError(409, "conflict", "負責人或部門資料已改變，請重新查核。");

const eligibilityConflict = () =>
  new BusinessApiError(
    409,
    "conflict",
    "此帳戶目前未符合新增部門負責人的條件。"
  );

type AdminActor = Awaited<ReturnType<typeof requireStaff>>;
type ConfirmedAdminActor = Awaited<
  ReturnType<typeof requireStaffPasswordProof>
>;

type DepartmentManagerWriteAuthority =
  | { kind: "admin" }
  | { authorityAssignmentId: string; kind: "role-assigner" };

export interface DepartmentManagerReadAuthority {
  actor: AdminActor;
  authorityAssignmentId: string | null;
}

export const requireDepartmentManagerReadAuthority = async (
  headers: Headers
): Promise<DepartmentManagerReadAuthority> => {
  const actor = await requireStaff(headers);
  if (actor.role === "admin") {
    return { actor, authorityAssignmentId: null };
  }
  const assignment = await getDb()
    .select({ id: roleAssignerAssignment.id })
    .from(roleAssignerAssignment)
    .where(eq(roleAssignerAssignment.userId, actor.userId))
    .limit(1)
    .get();
  if (!assignment) {
    throw denied();
  }
  return { actor, authorityAssignmentId: assignment.id };
};

const assertCurrentDepartmentManagerReadAuthority = async (
  headers: Headers,
  expected: DepartmentManagerReadAuthority
) => {
  const current = await requireDepartmentManagerReadAuthority(headers);
  if (
    current.actor.userId !== expected.actor.userId ||
    current.authorityAssignmentId !== expected.authorityAssignmentId
  ) {
    throw conflict();
  }
};

const resolveDepartmentManagerWriteAuthority = async (
  actor: AdminActor,
  input: DepartmentManagerChangeInput
): Promise<DepartmentManagerWriteAuthority> => {
  if (actor.role === "admin") {
    return { kind: "admin" };
  }
  const current = await getDb()
    .select({ id: roleAssignerAssignment.id })
    .from(roleAssignerAssignment)
    .where(eq(roleAssignerAssignment.userId, actor.userId))
    .limit(1)
    .get();
  if (!current) {
    throw denied();
  }
  if (input.authorityAssignmentId !== current.id) {
    throw conflict();
  }
  return {
    authorityAssignmentId: current.id,
    kind: "role-assigner",
  };
};

const requireDepartmentManagerWriteActor = async (
  headers: Headers,
  input: DepartmentManagerChangeInput
) => {
  const actor = await requireStaff(headers);
  const authority = await resolveDepartmentManagerWriteAuthority(actor, input);
  return { actor, authority };
};

const requireConfirmedDepartmentManagerWriteActor = async (
  headers: Headers,
  input: DepartmentManagerChangeInput
) => {
  const actor = await requireStaffPasswordProof(headers);
  const authority = await resolveDepartmentManagerWriteAuthority(actor, input);
  return { actor, authority };
};

const requireDepartmentManagerReceiptAuthority = async (headers: Headers) => {
  const actor = await requireStaff(headers);
  if (actor.role === "admin") {
    return actor;
  }
  const current = await getDb()
    .select({ id: roleAssignerAssignment.id })
    .from(roleAssignerAssignment)
    .where(eq(roleAssignerAssignment.userId, actor.userId))
    .limit(1)
    .get();
  if (!current) {
    throw denied();
  }
  return actor;
};

const currentAdminSession = (db: Database, actor: AdminActor) =>
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
    .where(
      and(
        eq(session.id, actor.sessionId),
        eq(session.userId, actor.userId),
        gt(session.expiresAt, sqliteNowSeconds),
        eq(account.credentialRevision, session.credentialRevision),
        isNotNull(account.password),
        ne(account.password, ""),
        isNull(account.temporaryPasswordExpiresAt),
        eq(personProfile.accountRole, "admin"),
        eq(personProfile.membershipStatus, "active"),
        isNull(personProfile.bannedAt)
      )
    );

const currentRoleAssignerReadSession = (
  db: Database,
  actor: AdminActor,
  authorityAssignmentId: string
) =>
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
      roleAssignerAssignment,
      and(
        eq(roleAssignerAssignment.id, authorityAssignmentId),
        eq(roleAssignerAssignment.userId, session.userId)
      )
    )
    .where(
      and(
        eq(session.id, actor.sessionId),
        eq(session.userId, actor.userId),
        gt(session.expiresAt, sqliteNowSeconds),
        eq(account.credentialRevision, session.credentialRevision),
        isNotNull(account.password),
        ne(account.password, ""),
        isNull(account.temporaryPasswordExpiresAt),
        eq(personProfile.accountRole, "staff"),
        eq(personProfile.membershipStatus, "active"),
        isNull(personProfile.bannedAt)
      )
    );

export const currentDepartmentManagerReadSession = (
  db: Database,
  authority: DepartmentManagerReadAuthority
) =>
  authority.authorityAssignmentId === null
    ? currentAdminSession(db, authority.actor)
    : currentRoleAssignerReadSession(
        db,
        authority.actor,
        authority.authorityAssignmentId
      );

export const hasDepartmentManagerAssignment = (
  db: Database,
  targetUserId: SQLWrapper | string
) =>
  exists(
    db
      .select({ present: sql`1` })
      .from(departmentManagerAssignment)
      .where(eq(departmentManagerAssignment.userId, targetUserId))
  );

export const eligibleDepartmentManagerTarget = (
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
          inArray(personProfile.accountRole, ["member", "staff", "admin"]),
          eq(personProfile.membershipStatus, "active"),
          isNull(personProfile.bannedAt),
          isNull(account.temporaryPasswordExpiresAt)
        )
      )
  );

const eligibleRoleAssignerDepartmentManagerTarget = (
  db: Database,
  targetUserId: SQLWrapper | string,
  actorUserId: string
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
          ne(personProfile.userId, actorUserId),
          eq(personProfile.accountRole, "member"),
          eq(personProfile.membershipStatus, "active"),
          isNull(personProfile.bannedAt),
          isNull(account.temporaryPasswordExpiresAt)
        )
      )
  );

export const roleAssignerDepartmentManagerMemberTarget = (
  db: Database,
  actorUserId: string,
  targetUserId: SQLWrapper | string
) =>
  exists(
    db
      .select({ present: sql`1` })
      .from(personProfile)
      .where(
        and(
          eq(personProfile.userId, targetUserId),
          ne(personProfile.userId, actorUserId),
          eq(personProfile.accountRole, "member")
        )
      )
  );

const currentRoleAssignerDepartmentManagerTarget = (
  actorUserId: string,
  targetUserId: string
) =>
  getDb()
    .select({ present: sql`1` })
    .from(personProfile)
    .where(
      and(
        eq(personProfile.userId, targetUserId),
        ne(personProfile.userId, actorUserId),
        eq(personProfile.accountRole, "member")
      )
    )
    .limit(1)
    .get();

export interface DepartmentManagerCandidate {
  fullName: string;
  userId: string;
  username: string | null;
}

export interface DepartmentManagerSearchPage {
  actorUserId: string;
  authorityAssignmentId?: string;
  candidates: DepartmentManagerCandidate[];
  hasNextPage: boolean;
  page: number;
}

export const getDepartmentManagerSearch = async (
  headers: Headers,
  requestedQuery: string | undefined,
  requestedPage: string | undefined
): Promise<DepartmentManagerSearchPage> => {
  const authority = await requireDepartmentManagerReadAuthority(headers);
  const { actor } = authority;
  const query = parseStaffSearch(requestedQuery);
  const page = normalizedStaffAccountPage(requestedPage);
  if (!query) {
    await assertCurrentDepartmentManagerReadAuthority(headers, authority);
    return {
      actorUserId: actor.userId,
      ...(authority.authorityAssignmentId
        ? { authorityAssignmentId: authority.authorityAssignmentId }
        : {}),
      candidates: [],
      hasNextPage: false,
      page: 1,
    };
  }

  const db = getDb();
  const eligible = eligibleDepartmentManagerTarget(db, user.id);
  const assigned = hasDepartmentManagerAssignment(db, user.id);
  const candidateTarget =
    authority.authorityAssignmentId === null
      ? or(eligible, assigned)
      : and(
          roleAssignerDepartmentManagerMemberTarget(db, actor.userId, user.id),
          or(
            eligibleRoleAssignerDepartmentManagerTarget(
              db,
              user.id,
              actor.userId
            ),
            assigned
          )
        );
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
        candidateTarget,
        exists(currentDepartmentManagerReadSession(db, authority))
      )
    )
    .orderBy(asc(user.name), asc(user.id))
    .limit(STAFF_ACCOUNT_PAGE_SIZE + 1)
    .offset((page - 1) * STAFF_ACCOUNT_PAGE_SIZE);
  await assertCurrentDepartmentManagerReadAuthority(headers, authority);
  return {
    actorUserId: actor.userId,
    ...(authority.authorityAssignmentId
      ? { authorityAssignmentId: authority.authorityAssignmentId }
      : {}),
    candidates: rows.slice(0, STAFF_ACCOUNT_PAGE_SIZE),
    hasNextPage: rows.length > STAFF_ACCOUNT_PAGE_SIZE,
    page,
  };
};

export interface DepartmentManagerAssignmentSummary {
  assignmentId: string;
  createdAt: number;
  scopeId: string;
  scopeName: string;
}

export interface DepartmentManagerPerson {
  eligibleForGrant: boolean;
  fullName: string;
  userId: string;
  username: string | null;
  assignments: DepartmentManagerAssignmentSummary[];
  assignmentPage: { hasNextPage: boolean; number: number };
}

export const getDepartmentManagerPerson = async (
  headers: Headers,
  targetUserId: string,
  requestedAssignmentPage: string | undefined
): Promise<DepartmentManagerPerson | null> => {
  const authority = await requireDepartmentManagerReadAuthority(headers);
  const { actor } = authority;
  const db = getDb();
  const eligible = eligibleDepartmentManagerTarget(db, user.id);
  const assigned = hasDepartmentManagerAssignment(db, user.id);
  const personTarget =
    authority.authorityAssignmentId === null
      ? or(eligible, assigned)
      : and(
          roleAssignerDepartmentManagerMemberTarget(db, actor.userId, user.id),
          or(
            eligibleRoleAssignerDepartmentManagerTarget(
              db,
              user.id,
              actor.userId
            ),
            assigned
          )
        );
  const person = await db
    .select({
      accountRole: personProfile.accountRole,
      bannedAt: personProfile.bannedAt,
      fullName: user.name,
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
    .where(
      and(
        eq(user.id, targetUserId),
        personTarget,
        exists(currentDepartmentManagerReadSession(db, authority))
      )
    )
    .limit(1)
    .get();
  if (!person) {
    await assertCurrentDepartmentManagerReadAuthority(headers, authority);
    return null;
  }

  const assignmentPage = normalizedStaffAccountPage(requestedAssignmentPage);
  const rows = await db
    .select({
      assignmentId: departmentManagerAssignment.id,
      createdAt: departmentManagerAssignment.createdAt,
      scopeId: department.id,
      scopeName: department.name,
    })
    .from(departmentManagerAssignment)
    .innerJoin(
      department,
      eq(department.id, departmentManagerAssignment.departmentId)
    )
    .where(
      and(
        eq(departmentManagerAssignment.userId, targetUserId),
        exists(currentDepartmentManagerReadSession(db, authority))
      )
    )
    .orderBy(asc(department.name), asc(department.id))
    .limit(STAFF_ACCOUNT_PAGE_SIZE + 1)
    .offset((assignmentPage - 1) * STAFF_ACCOUNT_PAGE_SIZE);
  await assertCurrentDepartmentManagerReadAuthority(headers, authority);
  return {
    assignmentPage: {
      hasNextPage: rows.length > STAFF_ACCOUNT_PAGE_SIZE,
      number: assignmentPage,
    },
    assignments: rows.slice(0, STAFF_ACCOUNT_PAGE_SIZE).map((row) => ({
      assignmentId: row.assignmentId,
      createdAt: dateToUnixSeconds(row.createdAt),
      scopeId: row.scopeId,
      scopeName: row.scopeName,
    })),
    eligibleForGrant:
      (authority.authorityAssignmentId === null ||
        (person.accountRole === "member" && actor.userId !== person.userId)) &&
      person.membershipStatus === "active" &&
      person.bannedAt === null &&
      person.temporaryPasswordExpiresAt === null,
    fullName: person.fullName,
    userId: person.userId,
    username: person.username,
  };
};

export interface DepartmentManagerDepartmentPage {
  departments: { id: string; name: string }[];
  hasNextPage: boolean;
  page: number;
}

export const getDepartmentManagerDepartments = async (
  headers: Headers,
  requestedPage: string | undefined
): Promise<DepartmentManagerDepartmentPage> => {
  const authority = await requireDepartmentManagerReadAuthority(headers);
  const page = normalizedStaffAccountPage(requestedPage);
  const db = getDb();
  const rows = await db
    .select({ id: department.id, name: department.name })
    .from(department)
    .where(exists(currentDepartmentManagerReadSession(db, authority)))
    .orderBy(asc(department.name), asc(department.id))
    .limit(STAFF_ACCOUNT_PAGE_SIZE + 1)
    .offset((page - 1) * STAFF_ACCOUNT_PAGE_SIZE);
  await assertCurrentDepartmentManagerReadAuthority(headers, authority);
  return {
    departments: rows.slice(0, STAFF_ACCOUNT_PAGE_SIZE),
    hasNextPage: rows.length > STAFF_ACCOUNT_PAGE_SIZE,
    page,
  };
};

const fingerprintDepartmentManagerChange = async (
  actorUserId: string,
  input: DepartmentManagerChangeInput
) => {
  const context = await getAuth().$context;
  return createHmac("sha256", context.secret)
    .update(JSON.stringify([actorUserId, "department_manager", input]))
    .digest("hex");
};

const findDepartmentManagerChange = async (
  headers: Headers,
  actorUserId: string,
  operationKey: string
) => {
  const row = await findRoleChangeOperation(getDb(), actorUserId, operationKey);
  if (!row) {
    return null;
  }
  const actor = await requireDepartmentManagerReceiptAuthority(headers);
  if (row.commandFamily !== "single") {
    throw conflict();
  }
  if (
    actor.role === "staff" &&
    !(await currentRoleAssignerDepartmentManagerTarget(
      actor.userId,
      row.targetUserId
    ))
  ) {
    throw denied();
  }
  return {
    ...row,
    createdAt: dateToUnixSeconds(row.createdAt),
  };
};

const matchingDepartmentManagerChange = (
  row: NonNullable<Awaited<ReturnType<typeof findDepartmentManagerChange>>>,
  requestHash: string
): DepartmentManagerReceipt => {
  if (row.role !== "department_manager" || row.requestHash !== requestHash) {
    throw conflict();
  }
  return {
    action: row.action,
    createdAt: row.createdAt,
    id: row.id,
    scopeId: row.scopeId,
    scopeName: row.scopeName,
    targetUserId: row.targetUserId,
  };
};

const currentTargetState = (targetUserId: string) =>
  getDb()
    .select({
      bannedAt: personProfile.bannedAt,
      membershipStatus: personProfile.membershipStatus,
      temporaryPasswordExpiresAt: account.temporaryPasswordExpiresAt,
    })
    .from(personProfile)
    .leftJoin(
      account,
      and(
        eq(account.userId, personProfile.userId),
        eq(account.accountId, personProfile.userId),
        eq(account.providerId, "credential")
      )
    )
    .where(eq(personProfile.userId, targetUserId))
    .limit(1)
    .get();

const eligibleTargetNow = async (targetUserId: string) => {
  const target = await currentTargetState(targetUserId);
  return Boolean(
    target &&
    target.membershipStatus === "active" &&
    target.bannedAt === null &&
    target.temporaryPasswordExpiresAt === null
  );
};

const eligibleRoleAssignerTargetNow = async (
  actorUserId: string,
  targetUserId: string
) =>
  Boolean(
    await getDb()
      .select({ present: sql`1` })
      .from(user)
      .where(
        and(
          eq(user.id, targetUserId),
          eligibleRoleAssignerDepartmentManagerTarget(
            getDb(),
            targetUserId,
            actorUserId
          )
        )
      )
      .limit(1)
      .get()
  );

const departmentNameNow = async (scopeId: string) => {
  const row = await getDb()
    .select({ name: department.name })
    .from(department)
    .where(eq(department.id, scopeId))
    .limit(1)
    .get();
  return row?.name ?? null;
};

const assignmentNow = (input: DepartmentManagerChangeInput) =>
  getDb()
    .select({ id: departmentManagerAssignment.id })
    .from(departmentManagerAssignment)
    .where(
      and(
        eq(departmentManagerAssignment.userId, input.targetUserId),
        eq(departmentManagerAssignment.departmentId, input.scopeId)
      )
    )
    .limit(1)
    .get();

const isEligibleDepartmentManagerGrantTarget = (
  actorUserId: string,
  authority: DepartmentManagerWriteAuthority,
  targetUserId: string
) => {
  if (authority.kind === "admin") {
    return eligibleTargetNow(targetUserId);
  }
  return eligibleRoleAssignerTargetNow(actorUserId, targetUserId);
};

const validateDepartmentManagerChangeBeforeWrite = async (
  actorUserId: string,
  authority: DepartmentManagerWriteAuthority,
  input: DepartmentManagerChangeInput
) => {
  const scopeName = await departmentNameNow(input.scopeId);
  if (!scopeName) {
    throw conflict();
  }
  if (input.action === "granted") {
    if (
      !(await isEligibleDepartmentManagerGrantTarget(
        actorUserId,
        authority,
        input.targetUserId
      ))
    ) {
      throw eligibilityConflict();
    }
    if (await assignmentNow(input)) {
      throw conflict();
    }
    return scopeName;
  }
  if (authority.kind === "role-assigner") {
    const currentTarget = await currentRoleAssignerDepartmentManagerTarget(
      actorUserId,
      input.targetUserId
    );
    if (!currentTarget) {
      throw conflict();
    }
  }
  const assignment = await assignmentNow(input);
  if (!assignment || assignment.id !== input.expectedAssignmentId) {
    throw conflict();
  }
  return scopeName;
};

const revalidateDepartmentManagerChangeAfterFailure = async (
  headers: Headers,
  actorUserId: string,
  input: DepartmentManagerChangeInput,
  originalScopeName: string
) => {
  const { authority } = await requireConfirmedDepartmentManagerWriteActor(
    headers,
    input
  );
  const currentAssignment = await assignmentNow(input);
  if ((await departmentNameNow(input.scopeId)) !== originalScopeName) {
    throw conflict();
  }
  if (input.action === "granted") {
    if (
      !(await isEligibleDepartmentManagerGrantTarget(
        actorUserId,
        authority,
        input.targetUserId
      )) ||
      currentAssignment
    ) {
      throw conflict();
    }
    return;
  }
  if (currentAssignment?.id !== input.expectedAssignmentId) {
    throw conflict();
  }
  if (authority.kind === "role-assigner") {
    const currentTarget = await currentRoleAssignerDepartmentManagerTarget(
      actorUserId,
      input.targetUserId
    );
    if (!currentTarget) {
      throw conflict();
    }
  }
};

const confirmedDepartmentManagerAdminSession = (
  db: Database,
  actor: ConfirmedAdminActor
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

const confirmedRoleAssignerSession = (
  db: Database,
  actor: ConfirmedAdminActor,
  authorityAssignmentId: string
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
      .innerJoin(
        roleAssignerAssignment,
        and(
          eq(roleAssignerAssignment.id, authorityAssignmentId),
          eq(roleAssignerAssignment.userId, session.userId)
        )
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
          eq(personProfile.accountRole, "staff"),
          eq(personProfile.membershipStatus, "active"),
          isNull(personProfile.bannedAt)
        )
      )
  );

const roleAssignerMemberTarget = (
  db: Database,
  actorUserId: string,
  targetUserId: SQLWrapper | string
) =>
  exists(
    db
      .select({ present: sql`1` })
      .from(personProfile)
      .where(
        and(
          eq(personProfile.userId, targetUserId),
          ne(personProfile.userId, actorUserId),
          eq(personProfile.accountRole, "member")
        )
      )
  );

const departmentManagerTargetCurrent = (
  db: Database,
  actorUserId: string,
  authority: DepartmentManagerWriteAuthority,
  input: DepartmentManagerChangeInput
) => {
  if (authority.kind === "admin" && input.action === "granted") {
    return eligibleDepartmentManagerTarget(db, input.targetUserId);
  }
  if (authority.kind === "admin") {
    return exists(
      db
        .select({ present: sql`1` })
        .from(user)
        .where(eq(user.id, input.targetUserId))
    );
  }
  if (input.action === "granted") {
    return eligibleRoleAssignerDepartmentManagerTarget(
      db,
      input.targetUserId,
      actorUserId
    );
  }
  return roleAssignerMemberTarget(db, actorUserId, input.targetUserId);
};

const departmentManagerWriteAssertion = (
  db: Database,
  actor: ConfirmedAdminActor,
  authority: DepartmentManagerWriteAuthority,
  input: DepartmentManagerChangeInput,
  scopeName: string
) => {
  const confirmedActor =
    authority.kind === "admin"
      ? confirmedDepartmentManagerAdminSession(db, actor)
      : confirmedRoleAssignerSession(
          db,
          actor,
          authority.authorityAssignmentId
        );
  const departmentCurrent = exists(
    db
      .select({ present: sql`1` })
      .from(department)
      .where(
        and(eq(department.id, input.scopeId), eq(department.name, scopeName))
      )
  );
  const targetCurrent = departmentManagerTargetCurrent(
    db,
    actor.userId,
    authority,
    input
  );
  const assignmentCurrent =
    input.action === "granted"
      ? exists(
          db
            .select({ present: sql`1` })
            .from(user)
            .where(
              and(
                eq(user.id, input.targetUserId),
                sql`NOT EXISTS(
                  SELECT 1 FROM department_manager_assignment
                  WHERE user_id = ${input.targetUserId}
                    AND department_id = ${input.scopeId}
                )`
              )
            )
        )
      : exists(
          db
            .select({ present: sql`1` })
            .from(departmentManagerAssignment)
            .where(
              and(
                eq(departmentManagerAssignment.id, input.expectedAssignmentId),
                eq(departmentManagerAssignment.userId, input.targetUserId),
                eq(departmentManagerAssignment.departmentId, input.scopeId)
              )
            )
        );
  return db
    .select({
      complete: sql`json(CASE WHEN ${and(
        confirmedActor,
        departmentCurrent,
        targetCurrent,
        assignmentCurrent
      )} THEN 'null' ELSE 'Department Manager authority changed' END)`,
    })
    .from(sql`(select 1)`);
};

const requiredDepartmentManagerWrites = (
  db: Database,
  actorUserId: string,
  input: DepartmentManagerChangeInput,
  assignmentId: string,
  historyId: string,
  auditId: string,
  operationId: string,
  aggregateResult?: string,
  scopeName?: string,
  requestHash?: string
) => {
  const assignmentWritten =
    input.action === "granted"
      ? exists(
          db
            .select({ present: sql`1` })
            .from(departmentManagerAssignment)
            .where(
              and(
                eq(departmentManagerAssignment.id, assignmentId),
                eq(departmentManagerAssignment.userId, input.targetUserId),
                eq(departmentManagerAssignment.departmentId, input.scopeId),
                ...(aggregateResult === undefined
                  ? []
                  : [
                      eq(
                        departmentManagerAssignment.createdAt,
                        sql`(SELECT created_at FROM role_change_operation WHERE id = ${operationId})`
                      ),
                    ])
              )
            )
        )
      : not(
          exists(
            db
              .select({ present: sql`1` })
              .from(departmentManagerAssignment)
              .where(
                and(
                  eq(departmentManagerAssignment.userId, input.targetUserId),
                  eq(departmentManagerAssignment.departmentId, input.scopeId)
                )
              )
          )
        );
  const historyWritten = exists(
    db
      .select({ present: sql`1` })
      .from(roleAssignmentHistory)
      .where(
        and(
          eq(roleAssignmentHistory.id, historyId),
          eq(roleAssignmentHistory.actorUserId, actorUserId),
          eq(roleAssignmentHistory.targetUserId, input.targetUserId),
          eq(roleAssignmentHistory.scopeId, input.scopeId),
          eq(roleAssignmentHistory.action, input.action),
          eq(roleAssignmentHistory.role, "department_manager"),
          ...(scopeName === undefined
            ? []
            : [
                eq(roleAssignmentHistory.scopeName, scopeName),
                eq(
                  roleAssignmentHistory.createdAt,
                  sql`(SELECT created_at FROM role_change_operation WHERE id = ${operationId})`
                ),
              ])
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
          eq(
            auditEvent.action,
            input.action === "granted"
              ? "department_manager_granted"
              : "department_manager_withdrawn"
          ),
          ...(aggregateResult === undefined
            ? []
            : [
                eq(
                  auditEvent.createdAt,
                  sql`(SELECT created_at FROM role_change_operation WHERE id = ${operationId})`
                ),
              ])
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
          ...(aggregateResult === undefined
            ? [
                eq(roleChangeOperation.scopeId, input.scopeId),
                eq(roleChangeOperation.action, input.action),
                eq(roleChangeOperation.role, "department_manager"),
              ]
            : [
                eq(roleChangeOperation.commandFamily, "person_scoped"),
                eq(roleChangeOperation.aggregateResult, aggregateResult),
                ...(requestHash === undefined
                  ? []
                  : [eq(roleChangeOperation.requestHash, requestHash)]),
              ])
        )
      )
  );
  return db
    .select({
      complete: sql`json(CASE WHEN ${and(
        assignmentWritten,
        historyWritten,
        auditWritten,
        operationWritten
      )} THEN 'null' ELSE 'Incomplete Department Manager change' END)`,
    })
    .from(sql`(select 1)`);
};

export const changeDepartmentManager = async (
  headers: Headers,
  input: DepartmentManagerChangeInput
) => {
  const { actor, authority } = await requireDepartmentManagerWriteActor(
    headers,
    input
  );
  const requestHash = await fingerprintDepartmentManagerChange(
    actor.userId,
    input
  );
  const existing = await findDepartmentManagerChange(
    headers,
    actor.userId,
    input.operationKey
  );
  if (existing) {
    return {
      created: false,
      receipt: matchingDepartmentManagerChange(existing, requestHash),
    };
  }

  const { actor: confirmedActor, authority: confirmedAuthority } =
    await requireConfirmedDepartmentManagerWriteActor(headers, input);
  const scopeName = await validateDepartmentManagerChangeBeforeWrite(
    actor.userId,
    authority,
    input
  );

  const assignmentId = crypto.randomUUID();
  const historyId = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const operationId = crypto.randomUUID();
  const operationCreatedAt = sql`(
    SELECT created_at FROM role_change_operation WHERE id = ${operationId}
  )`;
  const db = getDb();
  try {
    await db.batch([
      departmentManagerWriteAssertion(
        db,
        confirmedActor,
        confirmedAuthority,
        input,
        scopeName
      ),
      db.insert(roleChangeOperation).values({
        action: input.action,
        actorUserId: actor.userId,
        createdAt: sql`unixepoch()`,
        id: operationId,
        operationKey: input.operationKey,
        requestHash,
        role: "department_manager",
        scopeId: input.scopeId,
        scopeName,
        targetUserId: input.targetUserId,
      }),
      input.action === "granted"
        ? db.insert(departmentManagerAssignment).values({
            createdAt: operationCreatedAt,
            departmentId: input.scopeId,
            id: assignmentId,
            userId: input.targetUserId,
          })
        : db
            .delete(departmentManagerAssignment)
            .where(
              and(
                eq(departmentManagerAssignment.id, input.expectedAssignmentId),
                eq(departmentManagerAssignment.departmentId, input.scopeId),
                eq(departmentManagerAssignment.userId, input.targetUserId)
              )
            ),
      db.insert(roleAssignmentHistory).values({
        action: input.action,
        actorUserId: actor.userId,
        createdAt: operationCreatedAt,
        id: historyId,
        role: "department_manager",
        scopeId: input.scopeId,
        scopeName,
        targetUserId: input.targetUserId,
      }),
      db.insert(auditEvent).values({
        action:
          input.action === "granted"
            ? "department_manager_granted"
            : "department_manager_withdrawn",
        actorUserId: actor.userId,
        createdAt: operationCreatedAt,
        id: auditId,
        targetUserId: input.targetUserId,
      }),
      requiredDepartmentManagerWrites(
        db,
        actor.userId,
        input,
        assignmentId,
        historyId,
        auditId,
        operationId
      ),
    ]);
  } catch (error) {
    const committed = await findDepartmentManagerChange(
      headers,
      actor.userId,
      input.operationKey
    );
    if (committed) {
      return {
        created: false,
        receipt: matchingDepartmentManagerChange(committed, requestHash),
      };
    }
    await revalidateDepartmentManagerChangeAfterFailure(
      headers,
      actor.userId,
      input,
      scopeName
    );
    throw error;
  }
  const committed = await findDepartmentManagerChange(
    headers,
    actor.userId,
    input.operationKey
  );
  if (!committed) {
    throw new Error("Committed Department Manager change has no receipt");
  }
  return {
    created: true,
    receipt: matchingDepartmentManagerChange(committed, requestHash),
  };
};

export const reconcileDepartmentManagerChange = async (
  headers: Headers,
  operationKey: string
): Promise<DepartmentManagerReceipt | null> => {
  const actor = await requireDepartmentManagerReceiptAuthority(headers);
  const row = await findDepartmentManagerChange(
    headers,
    actor.userId,
    operationKey
  );
  return row && row.role === "department_manager"
    ? {
        action: row.action,
        createdAt: row.createdAt,
        id: row.id,
        scopeId: row.scopeId,
        scopeName: row.scopeName,
        targetUserId: row.targetUserId,
      }
    : null;
};

export const parseDepartmentManagerChange = async (request: Request) => {
  const parsed = departmentManagerChangeSchema.safeParse(
    await readBoundedJson(request)
  );
  if (!parsed.success) {
    throw new BusinessApiError(
      400,
      "validation_error",
      "請選擇一位人士及一個部門，再確認新增或撤回。"
    );
  }
  return parsed.data;
};

export const parseDepartmentManagerReconciliation = async (
  request: Request
) => {
  const parsed = departmentManagerReconciliationSchema.safeParse(
    await readBoundedJson(request)
  );
  if (!parsed.success) {
    throw new BusinessApiError(400, "validation_error", "操作代碼格式不正確。");
  }
  return parsed.data;
};

const aggregateMemberInputs = (
  input: ScopedRoleChangeInput
): DepartmentManagerChangeInput[] =>
  input.changes.map((change) => ({
    ...change,
    authorityAssignmentId: input.authorityAssignmentId,
    operationKey: input.operationKey,
    targetUserId: input.targetUserId,
  }));

const findScopedRoleReceipt = async (
  headers: Headers,
  actorUserId: string,
  operationKey: string
) => {
  const row = await findRoleChangeOperation(getDb(), actorUserId, operationKey);
  if (!row) {
    return null;
  }
  const actor = await requireDepartmentManagerReceiptAuthority(headers);
  if (row.commandFamily !== "person_scoped") {
    throw conflict();
  }
  if (
    actor.role === "staff" &&
    !(await currentRoleAssignerDepartmentManagerTarget(
      actor.userId,
      row.targetUserId
    ))
  ) {
    throw denied();
  }
  const stored = {
    changes: JSON.parse(row.aggregateResult),
    createdAt: dateToUnixSeconds(row.createdAt),
    id: row.id,
    targetUserId: row.targetUserId,
  };
  const legacy = legacyScopedRoleChangeReceiptSchema.safeParse(stored);
  const receipt = legacy.success
    ? legacy.data
    : scopedRoleChangeReceiptSchema.parse(stored);
  return { legacy: legacy.success, receipt, requestHash: row.requestHash };
};

export const changeScopedDepartmentManagers = async (
  headers: Headers,
  input: ScopedRoleChangeInput
) => {
  const members = aggregateMemberInputs(input);
  const [first] = members;
  if (!first) {
    throw conflict();
  }
  const { actor, authority } = await requireDepartmentManagerWriteActor(
    headers,
    first
  );
  const context = await getAuth().$context;
  const requestHash = createHmac("sha256", context.secret)
    .update(JSON.stringify([actor.userId, "person_scoped", input]))
    .digest("hex");
  const legacyHash = input.changes.every(
    (change) => change.role === "department_manager"
  )
    ? createHmac("sha256", context.secret)
        .update(
          JSON.stringify([
            actor.userId,
            "person_scoped",
            {
              ...(input.authorityAssignmentId
                ? { authorityAssignmentId: input.authorityAssignmentId }
                : {}),
              changes: input.changes.map((change) =>
                change.action === "granted"
                  ? { action: change.action, scopeId: change.scopeId }
                  : {
                      action: change.action,
                      expectedAssignmentId: change.expectedAssignmentId,
                      scopeId: change.scopeId,
                    }
              ),
              operationKey: input.operationKey,
              targetUserId: input.targetUserId,
            },
          ])
        )
        .digest("hex")
    : null;
  const existing = await findScopedRoleReceipt(
    headers,
    actor.userId,
    input.operationKey
  );
  if (existing) {
    if (
      existing.requestHash !== requestHash &&
      !(existing.legacy && existing.requestHash === legacyHash)
    ) {
      throw conflict();
    }
    return { created: false, receipt: existing.receipt };
  }
  const { actor: confirmedActor, authority: confirmedAuthority } =
    await requireConfirmedDepartmentManagerWriteActor(headers, first);
  const prepared = await Promise.all(
    input.changes.map(async (change, index) => {
      const member = members[index];
      if (!member) {
        throw conflict();
      }
      if (change.role === "program_leader") {
        const programChange = await preparePersonScopedProgramChange(
          headers,
          member,
          change.expectedDepartmentId
        );
        return {
          programChange,
          role: change.role,
          scopeName: programChange.scopeName,
        };
      }
      return {
        programChange: null,
        role: change.role,
        scopeName: await validateDepartmentManagerChangeBeforeWrite(
          actor.userId,
          authority,
          member
        ),
      };
    })
  );
  const operationId = crypto.randomUUID();
  const receipt = scopedRoleChangeReceiptSchema.parse({
    changes: members.map((member, index) => ({
      action: member.action,
      role: prepared[index]?.role,
      scopeId: member.scopeId,
      scopeName: prepared[index]?.scopeName,
    })),
    createdAt: 0,
    id: operationId,
    targetUserId: input.targetUserId,
  });
  const aggregateResult = JSON.stringify(receipt.changes);
  const db = getDb();
  const operationCreatedAt = sql`(SELECT created_at FROM role_change_operation WHERE id = ${operationId})`;
  const operationWrite = db.insert(roleChangeOperation).values({
    actorUserId: actor.userId,
    aggregateResult,
    commandFamily: "person_scoped",
    createdAt: sql`unixepoch()`,
    id: operationId,
    operationKey: input.operationKey,
    requestHash,
    targetUserId: input.targetUserId,
  });
  const statements: BatchItem<"sqlite">[] = [];
  const requiredWrites: BatchItem<"sqlite">[] = [];
  for (const [index, member] of members.entries()) {
    const entry = prepared[index];
    if (!entry) {
      throw new Error("Missing scoped role preparation");
    }
    const { scopeName } = entry;
    if (entry.programChange) {
      const programWrites = entry.programChange.build(
        operationId,
        aggregateResult,
        requestHash
      );
      statements.push(...programWrites.writes);
      requiredWrites.push(programWrites.required);
      continue;
    }
    const assignmentId = crypto.randomUUID();
    const historyId = crypto.randomUUID();
    const auditId = crypto.randomUUID();
    statements.push(
      departmentManagerWriteAssertion(
        db,
        confirmedActor,
        confirmedAuthority,
        member,
        scopeName
      ),
      member.action === "granted"
        ? db.insert(departmentManagerAssignment).values({
            createdAt: operationCreatedAt,
            departmentId: member.scopeId,
            id: assignmentId,
            userId: member.targetUserId,
          })
        : db
            .delete(departmentManagerAssignment)
            .where(
              and(
                eq(departmentManagerAssignment.id, member.expectedAssignmentId),
                eq(departmentManagerAssignment.departmentId, member.scopeId),
                eq(departmentManagerAssignment.userId, member.targetUserId)
              )
            ),
      db.insert(roleAssignmentHistory).values({
        action: member.action,
        actorUserId: actor.userId,
        createdAt: operationCreatedAt,
        id: historyId,
        role: "department_manager",
        scopeId: member.scopeId,
        scopeName,
        targetUserId: member.targetUserId,
      }),
      db.insert(auditEvent).values({
        action:
          member.action === "granted"
            ? "department_manager_granted"
            : "department_manager_withdrawn",
        actorUserId: actor.userId,
        createdAt: operationCreatedAt,
        id: auditId,
        targetUserId: member.targetUserId,
      })
    );
    requiredWrites.push(
      requiredDepartmentManagerWrites(
        db,
        actor.userId,
        member,
        assignmentId,
        historyId,
        auditId,
        operationId,
        aggregateResult,
        scopeName,
        requestHash
      )
    );
  }
  statements.push(...requiredWrites);
  try {
    await db.batch([operationWrite, ...statements]);
  } catch (error) {
    const committed = await findScopedRoleReceipt(
      headers,
      actor.userId,
      input.operationKey
    );
    if (committed) {
      if (
        committed.requestHash !== requestHash &&
        !(committed.legacy && committed.requestHash === legacyHash)
      ) {
        throw conflict();
      }
      return { created: false, receipt: committed.receipt };
    }
    await Promise.all(
      members.map((member, index) => {
        const entry = prepared[index];
        if (!entry) {
          throw error;
        }
        return entry.programChange
          ? entry.programChange.revalidate()
          : revalidateDepartmentManagerChangeAfterFailure(
              headers,
              actor.userId,
              member,
              entry.scopeName
            );
      })
    );
    throw error;
  }
  const committed = await findScopedRoleReceipt(
    headers,
    actor.userId,
    input.operationKey
  );
  if (!committed) {
    throw new Error("Committed scoped role changes have no receipt");
  }
  return { created: true, receipt: committed.receipt };
};

export const reconcileScopedDepartmentManagers = async (
  headers: Headers,
  operationKey: string
): Promise<ScopedRoleChangeReceipt | null> => {
  const actor = await requireDepartmentManagerReceiptAuthority(headers);
  const row = await findRoleChangeOperation(
    getDb(),
    actor.userId,
    operationKey
  );
  if (!row || row.commandFamily !== "person_scoped") {
    return null;
  }
  const result = await findScopedRoleReceipt(
    headers,
    actor.userId,
    operationKey
  );
  return result?.receipt ?? null;
};

export const parseScopedDepartmentManagers = async (request: Request) => {
  const parsed = scopedRoleChangeSchema.safeParse(
    await readBoundedJson(request)
  );
  if (!parsed.success) {
    throw new BusinessApiError(
      400,
      "validation_error",
      "請檢查所選部門及職務。"
    );
  }
  return parsed.data;
};

export const getScopedDepartmentManagerBaseline = async (
  headers: Headers,
  targetUserId: string,
  requestedPage: string | undefined
) => {
  const authority = await requireDepartmentManagerReadAuthority(headers);
  const person =
    (await getDepartmentManagerPerson(headers, targetUserId, "1")) ??
    (await getProgramLeaderPerson(headers, targetUserId, "1"));
  if (!person) {
    return null;
  }
  const db = getDb();
  const page = normalizedStaffAccountPage(requestedPage);
  const rows = await db
    .select({
      assignmentId: departmentManagerAssignment.id,
      scopeId: department.id,
      scopeName: department.name,
    })
    .from(department)
    .leftJoin(
      departmentManagerAssignment,
      and(
        eq(departmentManagerAssignment.departmentId, department.id),
        eq(departmentManagerAssignment.userId, targetUserId)
      )
    )
    .where(
      and(
        exists(currentDepartmentManagerReadSession(db, authority)),
        authority.authorityAssignmentId === null
          ? exists(
              db
                .select({ present: sql`1` })
                .from(user)
                .where(eq(user.id, targetUserId))
            )
          : roleAssignerDepartmentManagerMemberTarget(
              db,
              authority.actor.userId,
              targetUserId
            )
      )
    )
    .orderBy(asc(department.name), asc(department.id))
    .limit(STAFF_ACCOUNT_PAGE_SIZE + 1)
    .offset((page - 1) * STAFF_ACCOUNT_PAGE_SIZE);
  await assertCurrentDepartmentManagerReadAuthority(headers, authority);
  if (
    authority.authorityAssignmentId !== null &&
    !(await currentRoleAssignerDepartmentManagerTarget(
      authority.actor.userId,
      targetUserId
    ))
  ) {
    throw denied();
  }
  return {
    actorKind:
      authority.authorityAssignmentId === null
        ? ("admin" as const)
        : ("role-assigner" as const),
    actorUserId: authority.actor.userId,
    authorityAssignmentId: authority.authorityAssignmentId,
    changeLimit: SCOPED_ROLE_CHANGE_LIMIT as typeof SCOPED_ROLE_CHANGE_LIMIT,
    departments: rows.slice(0, STAFF_ACCOUNT_PAGE_SIZE),
    eligibleForGrant: person.eligibleForGrant,
    hasNextPage: rows.length > STAFF_ACCOUNT_PAGE_SIZE,
    mixedChangeLimit:
      MIXED_SCOPED_ROLE_CHANGE_LIMIT as typeof MIXED_SCOPED_ROLE_CHANGE_LIMIT,
    page,
  };
};

export const getScopedProgramLeaderBaseline = async (
  headers: Headers,
  targetUserId: string,
  departmentId: string | undefined,
  requestedPage: string | undefined,
  programId: string | undefined
) => {
  if (
    !departmentId ||
    departmentId.trim() !== departmentId ||
    departmentId.length > 128 ||
    (programId !== undefined &&
      (!programId || programId.trim() !== programId || programId.length > 128))
  ) {
    throw new BusinessApiError(
      400,
      "validation_error",
      "請選擇有效的部門及聚會。"
    );
  }
  const authority = await requireDepartmentManagerReadAuthority(headers);
  const person =
    (await getProgramLeaderPerson(headers, targetUserId, "1")) ??
    (await getDepartmentManagerPerson(headers, targetUserId, "1"));
  if (!person) {
    return null;
  }
  const db = getDb();
  const selectedDepartment = await db
    .select({ name: department.name })
    .from(department)
    .where(
      and(
        eq(department.id, departmentId),
        exists(currentDepartmentManagerReadSession(db, authority)),
        authority.authorityAssignmentId === null
          ? exists(
              db
                .select({ present: sql`1` })
                .from(user)
                .where(eq(user.id, targetUserId))
            )
          : roleAssignerDepartmentManagerMemberTarget(
              db,
              authority.actor.userId,
              targetUserId
            )
      )
    )
    .limit(1)
    .get();
  const page = normalizedStaffAccountPage(requestedPage);
  const rows = await db
    .select({
      assignmentId: programLeaderAssignment.id,
      scopeId: program.id,
      scopeName: program.name,
    })
    .from(program)
    .leftJoin(
      programLeaderAssignment,
      and(
        eq(programLeaderAssignment.programId, program.id),
        eq(programLeaderAssignment.userId, targetUserId)
      )
    )
    .where(
      and(
        eq(program.departmentId, departmentId),
        programId === undefined ? undefined : eq(program.id, programId),
        exists(currentDepartmentManagerReadSession(db, authority)),
        authority.authorityAssignmentId === null
          ? exists(
              db
                .select({ present: sql`1` })
                .from(user)
                .where(eq(user.id, targetUserId))
            )
          : roleAssignerDepartmentManagerMemberTarget(
              db,
              authority.actor.userId,
              targetUserId
            )
      )
    )
    .orderBy(asc(program.name), asc(program.id))
    .limit(STAFF_ACCOUNT_PAGE_SIZE + 1)
    .offset((page - 1) * STAFF_ACCOUNT_PAGE_SIZE);
  await assertCurrentDepartmentManagerReadAuthority(headers, authority);
  if (
    authority.authorityAssignmentId !== null &&
    !(await currentRoleAssignerDepartmentManagerTarget(
      authority.actor.userId,
      targetUserId
    ))
  ) {
    throw denied();
  }
  if (!selectedDepartment) {
    return null;
  }
  return {
    actorKind:
      authority.authorityAssignmentId === null
        ? ("admin" as const)
        : ("role-assigner" as const),
    actorUserId: authority.actor.userId,
    authorityAssignmentId: authority.authorityAssignmentId,
    departmentId,
    departmentName: selectedDepartment.name,
    eligibleForGrant: person.eligibleForGrant,
    hasNextPage: rows.length > STAFF_ACCOUNT_PAGE_SIZE,
    page,
    programs: rows.slice(0, STAFF_ACCOUNT_PAGE_SIZE),
  };
};
