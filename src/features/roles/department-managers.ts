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

import { getAuth } from "../../server/auth";
import { getDb } from "../../server/db/client";
import type { Database } from "../../server/db/client";
import { accountSecurityOperation } from "../../server/db/schema/account-security";
import { department } from "../../server/db/schema/activities";
import { auditEvent } from "../../server/db/schema/applications";
import { account, session, user } from "../../server/db/schema/auth";
import { personProfile } from "../../server/db/schema/identity";
import { departmentManagerAssignment } from "../../server/db/schema/notices";
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
import { findRoleChangeOperation } from "./role-change-operation";

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

interface DepartmentManagerReadAuthority {
  actor: AdminActor;
  authorityAssignmentId: string | null;
}

const requireDepartmentManagerReadAuthority = async (
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

const currentDepartmentManagerReadSession = (
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

const hasDepartmentManagerAssignment = (
  db: Database,
  targetUserId: SQLWrapper | string
) =>
  exists(
    db
      .select({ present: sql`1` })
      .from(departmentManagerAssignment)
      .where(eq(departmentManagerAssignment.userId, targetUserId))
  );

const eligibleDepartmentManagerTarget = (
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

const roleAssignerDepartmentManagerMemberTarget = (
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
    .from(user)
    .limit(1);
};

const requiredDepartmentManagerWrites = (
  db: Database,
  actorUserId: string,
  input: DepartmentManagerChangeInput,
  assignmentId: string,
  historyId: string,
  auditId: string,
  operationId: string
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
                eq(departmentManagerAssignment.departmentId, input.scopeId)
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
          eq(roleAssignmentHistory.role, "department_manager")
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
          )
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
          eq(roleChangeOperation.scopeId, input.scopeId),
          eq(roleChangeOperation.action, input.action),
          eq(roleChangeOperation.role, "department_manager")
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
    .from(user)
    .limit(1);
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
