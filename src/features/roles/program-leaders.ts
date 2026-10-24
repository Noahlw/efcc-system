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
import { department, program } from "../../server/db/schema/activities";
import { auditEvent } from "../../server/db/schema/applications";
import { account, session, user } from "../../server/db/schema/auth";
import { personProfile } from "../../server/db/schema/identity";
import {
  departmentManagerAssignment,
  departmentMembership,
  programLeaderAssignment,
} from "../../server/db/schema/notices";
import {
  roleAssignmentHistory,
  roleChangeOperation,
} from "../../server/db/schema/roles";
import {
  requireOwnBusinessAccess,
  requireStaff,
} from "../account/account-actors";
import type { AccountActor } from "../account/account-actors";
import { requireSensitiveStaff as requireStaffPasswordProof } from "../account/account-change-operations";
import { BusinessApiError, readBoundedJson } from "../account/business-request";
import { requireFreshCredentialConfirmation } from "../account/security/security";
import type { ConfirmedCredentialActor } from "../account/security/security";
import {
  normalizedStaffAccountPage,
  parseStaffSearch,
  STAFF_ACCOUNT_PAGE_SIZE,
} from "../account/staff-search-contract";
import { dateToUnixSeconds, sqliteNowSeconds } from "../account/timestamps";
import type {
  ProgramLeaderChangeInput,
  ProgramLeaderReceipt,
} from "./program-leader-contract";
import {
  programLeaderChangeSchema,
  programLeaderReconciliationSchema,
} from "./program-leader-contract";
import { findRoleChangeOperation } from "./role-change-operation";

const denied = () =>
  new BusinessApiError(
    403,
    "business_access_denied",
    "你目前沒有管理 Program Leader 的權限。"
  );

const conflict = () =>
  new BusinessApiError(409, "conflict", "負責人或聚會資料已改變，請重新查核。");

const eligibilityConflict = () =>
  new BusinessApiError(
    409,
    "conflict",
    "此帳戶目前未符合新增 Program Leader 的條件。"
  );

type AdminActor = Awaited<ReturnType<typeof requireStaff>>;
type ConfirmedAdminActor = Awaited<
  ReturnType<typeof requireStaffPasswordProof>
>;

type ProgramLeaderAuthority =
  | { actor: AdminActor; authority: "admin" }
  | {
      actor: AccountActor;
      assignmentId: string;
      authority: "department-manager";
    };

type ConfirmedProgramLeaderAuthority =
  | { actor: ConfirmedAdminActor; authority: "admin" }
  | {
      actor: ConfirmedCredentialActor;
      assignmentId: string;
      authority: "department-manager";
    };

const requireProgramLeaderAdmin = async (
  headers: Headers
): Promise<AdminActor> => {
  const actor = await requireStaff(headers);
  if (actor.role !== "admin") {
    throw denied();
  }
  return actor;
};

const requireConfirmedProgramLeaderAdmin = async (
  headers: Headers
): Promise<ConfirmedAdminActor> => {
  const actor = await requireStaffPasswordProof(headers);
  if (actor.role !== "admin") {
    throw denied();
  }
  return actor;
};

const requireProgramLeaderDepartmentManager = async (
  headers: Headers,
  programId: string
): Promise<
  Extract<ProgramLeaderAuthority, { authority: "department-manager" }>
> => {
  const actor = await requireOwnBusinessAccess(headers);
  const current = await getDb()
    .select({ assignmentId: departmentManagerAssignment.id })
    .from(program)
    .innerJoin(
      departmentManagerAssignment,
      and(
        eq(departmentManagerAssignment.departmentId, program.departmentId),
        eq(departmentManagerAssignment.userId, actor.userId)
      )
    )
    .innerJoin(personProfile, eq(personProfile.userId, actor.userId))
    .where(
      and(
        eq(program.id, programId),
        eq(personProfile.membershipStatus, "active"),
        isNull(personProfile.bannedAt)
      )
    )
    .limit(1)
    .get();
  if (!current) {
    throw denied();
  }
  return {
    actor,
    assignmentId: current.assignmentId,
    authority: "department-manager",
  };
};

const requireProgramLeaderDepartmentManagerForDepartment = async (
  headers: Headers,
  departmentId: string
): Promise<
  Extract<ProgramLeaderAuthority, { authority: "department-manager" }>
> => {
  const actor = await requireOwnBusinessAccess(headers);
  const current = await getDb()
    .select({ assignmentId: departmentManagerAssignment.id })
    .from(departmentManagerAssignment)
    .innerJoin(
      department,
      eq(department.id, departmentManagerAssignment.departmentId)
    )
    .innerJoin(personProfile, eq(personProfile.userId, actor.userId))
    .where(
      and(
        eq(departmentManagerAssignment.departmentId, departmentId),
        eq(departmentManagerAssignment.userId, actor.userId),
        eq(personProfile.membershipStatus, "active"),
        isNull(personProfile.bannedAt)
      )
    )
    .limit(1)
    .get();
  if (!current) {
    throw denied();
  }
  return {
    actor,
    assignmentId: current.assignmentId,
    authority: "department-manager",
  };
};

const requireProgramLeaderAuthorityForDepartment = async (
  headers: Headers,
  departmentId: string
): Promise<ProgramLeaderAuthority> => {
  try {
    return {
      actor: await requireProgramLeaderAdmin(headers),
      authority: "admin",
    };
  } catch (error) {
    if (
      !(error instanceof BusinessApiError) ||
      error.code !== "business_access_denied"
    ) {
      throw error;
    }
  }
  return requireProgramLeaderDepartmentManagerForDepartment(
    headers,
    departmentId
  );
};

const requireProgramLeaderAuthority = async (
  headers: Headers,
  programId: string
): Promise<ProgramLeaderAuthority> => {
  try {
    return {
      actor: await requireProgramLeaderAdmin(headers),
      authority: "admin",
    };
  } catch (error) {
    if (
      !(error instanceof BusinessApiError) ||
      error.code !== "business_access_denied"
    ) {
      throw error;
    }
  }
  return requireProgramLeaderDepartmentManager(headers, programId);
};

const requireConfirmedProgramLeaderAuthority = async (
  headers: Headers,
  programId: string,
  expectedDepartmentManagerAssignmentId?: string
): Promise<ConfirmedProgramLeaderAuthority> => {
  const current = await requireProgramLeaderAuthority(headers, programId);
  if (current.authority === "admin") {
    return {
      actor: await requireConfirmedProgramLeaderAdmin(headers),
      authority: "admin",
    };
  }
  if (current.assignmentId !== expectedDepartmentManagerAssignmentId) {
    throw conflict();
  }

  return {
    actor: await requireFreshCredentialConfirmation(headers),
    assignmentId: current.assignmentId,
    authority: "department-manager",
  };
};

const requireProgramLeaderCommandAuthority = (
  authority: ProgramLeaderAuthority,
  input: ProgramLeaderChangeInput
) => {
  if (
    authority.authority === "department-manager" &&
    authority.assignmentId !== input.authorityAssignmentId
  ) {
    throw conflict();
  }
  return authority;
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

const currentDepartmentManagerProgram = (
  db: Database,
  actorUserId: string,
  assignmentId: string,
  programId: string
) =>
  exists(
    db
      .select({ present: sql`1` })
      .from(program)
      .innerJoin(
        departmentManagerAssignment,
        and(
          eq(departmentManagerAssignment.id, assignmentId),
          eq(departmentManagerAssignment.departmentId, program.departmentId),
          eq(departmentManagerAssignment.userId, actorUserId)
        )
      )
      .innerJoin(personProfile, eq(personProfile.userId, actorUserId))
      .where(
        and(
          eq(program.id, programId),
          eq(personProfile.membershipStatus, "active"),
          isNull(personProfile.bannedAt)
        )
      )
  );

const hasProgramLeaderAssignment = (
  db: Database,
  targetUserId: SQLWrapper | string
) =>
  exists(
    db
      .select({ present: sql`1` })
      .from(programLeaderAssignment)
      .where(eq(programLeaderAssignment.userId, targetUserId))
  );

const eligibleProgramLeaderTarget = (
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

const eligibleDepartmentProgramLeaderTarget = (
  db: Database,
  actorUserId: string,
  targetUserId: SQLWrapper | string,
  programId: string
) =>
  exists(
    db
      .select({ present: sql`1` })
      .from(program)
      .innerJoin(
        departmentMembership,
        and(
          eq(departmentMembership.departmentId, program.departmentId),
          eq(departmentMembership.userId, targetUserId)
        )
      )
      .innerJoin(personProfile, eq(personProfile.userId, targetUserId))
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
          eq(program.id, programId),
          ne(personProfile.userId, actorUserId),
          eq(personProfile.accountRole, "member"),
          eq(personProfile.membershipStatus, "active"),
          isNull(personProfile.bannedAt),
          isNull(account.temporaryPasswordExpiresAt)
        )
      )
  );

const eligibleProgramLeaderGrantTarget = (
  db: Database,
  authority: {
    actor: { userId: string };
    authority: "admin" | "department-manager";
  },
  targetUserId: string,
  programId: string
) =>
  authority.authority === "admin"
    ? eligibleProgramLeaderTarget(db, targetUserId)
    : eligibleDepartmentProgramLeaderTarget(
        db,
        authority.actor.userId,
        targetUserId,
        programId
      );

const isEligibleProgramLeaderGrantTarget = async (
  db: Database,
  authority: {
    actor: { userId: string };
    authority: "admin" | "department-manager";
  },
  targetUserId: string,
  programId: string
) => {
  const row = await db
    .select({
      eligible: eligibleProgramLeaderGrantTarget(
        db,
        authority,
        targetUserId,
        programId
      ),
    })
    .from(user)
    .where(eq(user.id, targetUserId))
    .limit(1)
    .get();
  return Boolean(row?.eligible);
};

const departmentManagerProgramLeaderChangeTargetWhere = (
  actorUserId: string,
  targetUserId: SQLWrapper | string
) =>
  and(
    eq(personProfile.userId, targetUserId),
    eq(personProfile.accountRole, "member"),
    ne(personProfile.userId, actorUserId)
  );

const departmentManagerProgramLeaderChangeTarget = (
  db: Database,
  actorUserId: string,
  targetUserId: SQLWrapper | string
) =>
  exists(
    db
      .select({ present: sql`1` })
      .from(personProfile)
      .where(
        departmentManagerProgramLeaderChangeTargetWhere(
          actorUserId,
          targetUserId
        )
      )
  );

const isCurrentDepartmentManagerProgramLeaderTarget = async (
  actorUserId: string,
  targetUserId: string
) =>
  Boolean(
    await getDb()
      .select({ userId: personProfile.userId })
      .from(personProfile)
      .where(
        departmentManagerProgramLeaderChangeTargetWhere(
          actorUserId,
          targetUserId
        )
      )
      .limit(1)
      .get()
  );

export interface ProgramLeaderCandidate {
  fullName: string;
  userId: string;
  username: string | null;
}

export interface ProgramLeaderSearchPage {
  actorUserId: string;
  candidates: ProgramLeaderCandidate[];
  hasNextPage: boolean;
  page: number;
}

export const getProgramLeaderSearch = async (
  headers: Headers,
  requestedQuery: string | undefined,
  requestedPage: string | undefined
): Promise<ProgramLeaderSearchPage> => {
  const actor = await requireProgramLeaderAdmin(headers);
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
  const eligible = eligibleProgramLeaderTarget(db, user.id);
  const assigned = hasProgramLeaderAssignment(db, user.id);
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
        or(eligible, assigned),
        exists(currentAdminSession(db, actor))
      )
    )
    .orderBy(asc(user.name), asc(user.id))
    .limit(STAFF_ACCOUNT_PAGE_SIZE + 1)
    .offset((page - 1) * STAFF_ACCOUNT_PAGE_SIZE);
  await requireProgramLeaderAdmin(headers);
  return {
    actorUserId: actor.userId,
    candidates: rows.slice(0, STAFF_ACCOUNT_PAGE_SIZE),
    hasNextPage: rows.length > STAFF_ACCOUNT_PAGE_SIZE,
    page,
  };
};

export interface ProgramLeaderProgramPage {
  actorUserId?: string;
  authorityAssignmentId?: string;
  hasNextPage: boolean;
  page: number;
  programs: { departmentName: string; id: string; name: string }[];
}

export interface ProgramLeaderDepartmentPage {
  actorUserId: string;
  departments: { assignmentId: string; id: string; name: string }[];
  hasNextPage: boolean;
  page: number;
}

export const getProgramLeaderDepartments = async (
  headers: Headers,
  requestedPage: string | undefined
): Promise<ProgramLeaderDepartmentPage> => {
  const actor = await requireOwnBusinessAccess(headers);
  const page = normalizedStaffAccountPage(requestedPage);
  const db = getDb();
  const currentAssignment = await db
    .select({ assignmentId: departmentManagerAssignment.id })
    .from(departmentManagerAssignment)
    .innerJoin(
      personProfile,
      eq(personProfile.userId, departmentManagerAssignment.userId)
    )
    .where(
      and(
        eq(departmentManagerAssignment.userId, actor.userId),
        eq(personProfile.membershipStatus, "active"),
        isNull(personProfile.bannedAt)
      )
    )
    .limit(1)
    .get();
  if (!currentAssignment) {
    throw denied();
  }

  const rows = await db
    .select({
      assignmentId: departmentManagerAssignment.id,
      id: department.id,
      name: department.name,
    })
    .from(departmentManagerAssignment)
    .innerJoin(
      department,
      eq(department.id, departmentManagerAssignment.departmentId)
    )
    .innerJoin(
      personProfile,
      eq(personProfile.userId, departmentManagerAssignment.userId)
    )
    .where(
      and(
        eq(departmentManagerAssignment.userId, actor.userId),
        eq(personProfile.membershipStatus, "active"),
        isNull(personProfile.bannedAt)
      )
    )
    .orderBy(asc(department.name), asc(department.id))
    .limit(STAFF_ACCOUNT_PAGE_SIZE + 1)
    .offset((page - 1) * STAFF_ACCOUNT_PAGE_SIZE);
  await requireOwnBusinessAccess(headers);
  return {
    actorUserId: actor.userId,
    departments: rows.slice(0, STAFF_ACCOUNT_PAGE_SIZE),
    hasNextPage: rows.length > STAFF_ACCOUNT_PAGE_SIZE,
    page,
  };
};

export const getProgramLeaderPrograms = async (
  headers: Headers,
  requestedPage: string | undefined,
  requestedDepartmentId?: string
): Promise<ProgramLeaderProgramPage> => {
  const page = normalizedStaffAccountPage(requestedPage);
  if (requestedDepartmentId) {
    const authority = await requireProgramLeaderAuthorityForDepartment(
      headers,
      requestedDepartmentId
    );
    const db = getDb();
    const currentAuthority =
      authority.authority === "admin"
        ? exists(currentAdminSession(db, authority.actor))
        : exists(
            db
              .select({ present: sql`1` })
              .from(departmentManagerAssignment)
              .innerJoin(
                personProfile,
                eq(personProfile.userId, departmentManagerAssignment.userId)
              )
              .where(
                and(
                  eq(departmentManagerAssignment.id, authority.assignmentId),
                  eq(
                    departmentManagerAssignment.departmentId,
                    requestedDepartmentId
                  ),
                  eq(
                    departmentManagerAssignment.userId,
                    authority.actor.userId
                  ),
                  eq(personProfile.membershipStatus, "active"),
                  isNull(personProfile.bannedAt)
                )
              )
          );
    const rows = await db
      .select({
        departmentName: department.name,
        id: program.id,
        name: program.name,
      })
      .from(program)
      .innerJoin(department, eq(department.id, program.departmentId))
      .where(
        and(eq(program.departmentId, requestedDepartmentId), currentAuthority)
      )
      .orderBy(asc(department.name), asc(program.name), asc(program.id))
      .limit(STAFF_ACCOUNT_PAGE_SIZE + 1)
      .offset((page - 1) * STAFF_ACCOUNT_PAGE_SIZE);
    if (authority.authority === "admin") {
      await requireProgramLeaderAdmin(headers);
    } else {
      const current = await requireProgramLeaderDepartmentManagerForDepartment(
        headers,
        requestedDepartmentId
      );
      if (current.assignmentId !== authority.assignmentId) {
        throw conflict();
      }
    }
    return {
      actorUserId: authority.actor.userId,
      ...(authority.authority === "department-manager"
        ? { authorityAssignmentId: authority.assignmentId }
        : {}),
      hasNextPage: rows.length > STAFF_ACCOUNT_PAGE_SIZE,
      page,
      programs: rows.slice(0, STAFF_ACCOUNT_PAGE_SIZE),
    };
  }

  const actor = await requireProgramLeaderAdmin(headers);
  const rows = await getDb()
    .select({
      departmentName: department.name,
      id: program.id,
      name: program.name,
    })
    .from(program)
    .innerJoin(department, eq(department.id, program.departmentId))
    .where(exists(currentAdminSession(getDb(), actor)))
    .orderBy(asc(department.name), asc(program.name), asc(program.id))
    .limit(STAFF_ACCOUNT_PAGE_SIZE + 1)
    .offset((page - 1) * STAFF_ACCOUNT_PAGE_SIZE);
  await requireProgramLeaderAdmin(headers);
  return {
    hasNextPage: rows.length > STAFF_ACCOUNT_PAGE_SIZE,
    page,
    programs: rows.slice(0, STAFF_ACCOUNT_PAGE_SIZE),
  };
};

export interface ProgramLeaderCurrentLeader {
  assignmentId: string;
  createdAt: number;
  eligibleForWithdrawal: boolean;
  fullName: string;
  userId: string;
  username: string | null;
}

export interface ProgramLeaderRosterPage {
  actorUserId: string;
  authorityAssignmentId: string;
  hasNextPage: boolean;
  leaders: ProgramLeaderCurrentLeader[];
  page: number;
}

export const getProgramLeaderRoster = async (
  headers: Headers,
  programId: string,
  requestedPage: string | undefined
): Promise<ProgramLeaderRosterPage> => {
  const authority = await requireProgramLeaderDepartmentManager(
    headers,
    programId
  );
  const page = normalizedStaffAccountPage(requestedPage);
  const db = getDb();
  const rows = await db
    .select({
      accountRole: personProfile.accountRole,
      assignmentId: programLeaderAssignment.id,
      createdAt: programLeaderAssignment.createdAt,
      fullName: user.name,
      userId: user.id,
      username: user.displayUsername,
    })
    .from(programLeaderAssignment)
    .innerJoin(program, eq(program.id, programLeaderAssignment.programId))
    .innerJoin(user, eq(user.id, programLeaderAssignment.userId))
    .innerJoin(personProfile, eq(personProfile.userId, user.id))
    .where(
      and(
        eq(programLeaderAssignment.programId, programId),
        currentDepartmentManagerProgram(
          db,
          authority.actor.userId,
          authority.assignmentId,
          programId
        )
      )
    )
    .orderBy(asc(user.name), asc(user.id), asc(programLeaderAssignment.id))
    .limit(STAFF_ACCOUNT_PAGE_SIZE + 1)
    .offset((page - 1) * STAFF_ACCOUNT_PAGE_SIZE);
  const current = await requireProgramLeaderDepartmentManager(
    headers,
    programId
  );
  if (
    current.actor.userId !== authority.actor.userId ||
    current.assignmentId !== authority.assignmentId
  ) {
    throw conflict();
  }
  return {
    actorUserId: authority.actor.userId,
    authorityAssignmentId: authority.assignmentId,
    hasNextPage: rows.length > STAFF_ACCOUNT_PAGE_SIZE,
    leaders: rows.slice(0, STAFF_ACCOUNT_PAGE_SIZE).map((row) => ({
      assignmentId: row.assignmentId,
      createdAt: dateToUnixSeconds(row.createdAt),
      eligibleForWithdrawal:
        row.accountRole === "member" && row.userId !== authority.actor.userId,
      fullName: row.fullName,
      userId: row.userId,
      username: row.username,
    })),
    page,
  };
};

export interface ProgramLeaderCandidatePage {
  actorUserId: string;
  authorityAssignmentId: string;
  candidates: ProgramLeaderCandidate[];
  hasNextPage: boolean;
  page: number;
}

export const getProgramLeaderCandidates = async (
  headers: Headers,
  programId: string,
  requestedQuery: string | undefined,
  requestedPage: string | undefined
): Promise<ProgramLeaderCandidatePage> => {
  const authority = await requireProgramLeaderDepartmentManager(
    headers,
    programId
  );
  const query = parseStaffSearch(requestedQuery);
  const page = normalizedStaffAccountPage(requestedPage);
  const db = getDb();
  const rows = query
    ? await db
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
            eligibleDepartmentProgramLeaderTarget(
              db,
              authority.actor.userId,
              user.id,
              programId
            ),
            not(
              exists(
                db
                  .select({ present: sql`1` })
                  .from(programLeaderAssignment)
                  .where(
                    and(
                      eq(programLeaderAssignment.userId, user.id),
                      eq(programLeaderAssignment.programId, programId)
                    )
                  )
              )
            ),
            currentDepartmentManagerProgram(
              db,
              authority.actor.userId,
              authority.assignmentId,
              programId
            )
          )
        )
        .orderBy(asc(user.name), asc(user.id))
        .limit(STAFF_ACCOUNT_PAGE_SIZE + 1)
        .offset((page - 1) * STAFF_ACCOUNT_PAGE_SIZE)
    : [];
  const current = await requireProgramLeaderDepartmentManager(
    headers,
    programId
  );
  if (
    current.actor.userId !== authority.actor.userId ||
    current.assignmentId !== authority.assignmentId
  ) {
    throw conflict();
  }
  return {
    actorUserId: authority.actor.userId,
    authorityAssignmentId: authority.assignmentId,
    candidates: rows.slice(0, STAFF_ACCOUNT_PAGE_SIZE),
    hasNextPage: rows.length > STAFF_ACCOUNT_PAGE_SIZE,
    page,
  };
};

export interface ProgramLeaderAssignmentSummary {
  assignmentId: string;
  createdAt: number;
  departmentName: string;
  scopeId: string;
  scopeName: string;
}

export interface ProgramLeaderPerson {
  eligibleForGrant: boolean;
  fullName: string;
  userId: string;
  username: string | null;
  assignments: ProgramLeaderAssignmentSummary[];
  assignmentPage: { hasNextPage: boolean; number: number };
}

export const getProgramLeaderPerson = async (
  headers: Headers,
  targetUserId: string,
  requestedAssignmentPage: string | undefined
): Promise<ProgramLeaderPerson | null> => {
  const actor = await requireProgramLeaderAdmin(headers);
  const db = getDb();
  const eligible = eligibleProgramLeaderTarget(db, user.id);
  const assigned = hasProgramLeaderAssignment(db, user.id);
  const person = await db
    .select({
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
        or(eligible, assigned),
        exists(currentAdminSession(db, actor))
      )
    )
    .limit(1)
    .get();
  if (!person) {
    await requireProgramLeaderAdmin(headers);
    return null;
  }

  const assignmentPage = normalizedStaffAccountPage(requestedAssignmentPage);
  const rows = await db
    .select({
      assignmentId: programLeaderAssignment.id,
      createdAt: programLeaderAssignment.createdAt,
      departmentName: department.name,
      scopeId: program.id,
      scopeName: program.name,
    })
    .from(programLeaderAssignment)
    .innerJoin(program, eq(program.id, programLeaderAssignment.programId))
    .innerJoin(department, eq(department.id, program.departmentId))
    .where(
      and(
        eq(programLeaderAssignment.userId, targetUserId),
        exists(currentAdminSession(db, actor))
      )
    )
    .orderBy(
      asc(department.name),
      asc(program.name),
      asc(programLeaderAssignment.id)
    )
    .limit(STAFF_ACCOUNT_PAGE_SIZE + 1)
    .offset((assignmentPage - 1) * STAFF_ACCOUNT_PAGE_SIZE);
  await requireProgramLeaderAdmin(headers);
  return {
    assignmentPage: {
      hasNextPage: rows.length > STAFF_ACCOUNT_PAGE_SIZE,
      number: assignmentPage,
    },
    assignments: rows.slice(0, STAFF_ACCOUNT_PAGE_SIZE).map((row) => ({
      assignmentId: row.assignmentId,
      createdAt: dateToUnixSeconds(row.createdAt),
      departmentName: row.departmentName,
      scopeId: row.scopeId,
      scopeName: row.scopeName,
    })),
    eligibleForGrant:
      person.membershipStatus === "active" &&
      person.bannedAt === null &&
      person.temporaryPasswordExpiresAt === null,
    fullName: person.fullName,
    userId: person.userId,
    username: person.username,
  };
};

const fingerprintProgramLeaderChange = async (
  actorUserId: string,
  input: ProgramLeaderChangeInput
) => {
  const context = await getAuth().$context;
  return createHmac("sha256", context.secret)
    .update(JSON.stringify([actorUserId, "program_leader", input]))
    .digest("hex");
};

const findProgramLeaderChange = async (
  headers: Headers,
  actorUserId: string,
  operationKey: string
) => {
  const row = await findRoleChangeOperation(getDb(), actorUserId, operationKey);
  if (!row) {
    return null;
  }
  const authority = await requireProgramLeaderAuthority(headers, row.scopeId);
  if (
    row.role === "program_leader" &&
    authority.authority === "department-manager" &&
    !(await isCurrentDepartmentManagerProgramLeaderTarget(
      authority.actor.userId,
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

const matchingProgramLeaderChange = (
  row: NonNullable<Awaited<ReturnType<typeof findProgramLeaderChange>>>,
  requestHash: string
): ProgramLeaderReceipt => {
  if (row.role !== "program_leader" || row.requestHash !== requestHash) {
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

const programNameNow = async (scopeId: string) => {
  const row = await getDb()
    .select({ name: program.name })
    .from(program)
    .where(eq(program.id, scopeId))
    .limit(1)
    .get();
  return row?.name ?? null;
};

const assignmentNow = (input: ProgramLeaderChangeInput) =>
  getDb()
    .select({ id: programLeaderAssignment.id })
    .from(programLeaderAssignment)
    .where(
      and(
        eq(programLeaderAssignment.userId, input.targetUserId),
        eq(programLeaderAssignment.programId, input.scopeId)
      )
    )
    .limit(1)
    .get();

const programLeaderWriteAssertion = (
  db: Database,
  authority: ConfirmedProgramLeaderAuthority,
  input: ProgramLeaderChangeInput,
  scopeName: string
) => {
  const { actor } = authority;
  const confirmedActor = exists(
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
          authority.authority === "admin"
            ? eq(personProfile.accountRole, "admin")
            : undefined,
          eq(personProfile.membershipStatus, "active"),
          isNull(personProfile.bannedAt)
        )
      )
  );
  const programCurrent =
    authority.authority === "admin"
      ? exists(
          db
            .select({ present: sql`1` })
            .from(program)
            .where(
              and(eq(program.id, input.scopeId), eq(program.name, scopeName))
            )
        )
      : exists(
          db
            .select({ present: sql`1` })
            .from(program)
            .innerJoin(
              departmentManagerAssignment,
              and(
                eq(departmentManagerAssignment.id, authority.assignmentId),
                eq(
                  departmentManagerAssignment.departmentId,
                  program.departmentId
                ),
                eq(departmentManagerAssignment.userId, actor.userId)
              )
            )
            .where(
              and(eq(program.id, input.scopeId), eq(program.name, scopeName))
            )
        );
  const targetCurrent = (() => {
    if (input.action === "granted") {
      return eligibleProgramLeaderGrantTarget(
        db,
        authority,
        input.targetUserId,
        input.scopeId
      );
    }
    if (authority.authority === "admin") {
      return exists(
        db
          .select({ present: sql`1` })
          .from(user)
          .where(eq(user.id, input.targetUserId))
      );
    }
    return departmentManagerProgramLeaderChangeTarget(
      db,
      authority.actor.userId,
      input.targetUserId
    );
  })();
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
                  SELECT 1 FROM program_leader_assignment
                  WHERE user_id = ${input.targetUserId}
                    AND program_id = ${input.scopeId}
                )`
              )
            )
        )
      : exists(
          db
            .select({ present: sql`1` })
            .from(programLeaderAssignment)
            .where(
              and(
                eq(programLeaderAssignment.id, input.expectedAssignmentId),
                eq(programLeaderAssignment.userId, input.targetUserId),
                eq(programLeaderAssignment.programId, input.scopeId)
              )
            )
        );
  return db
    .select({
      complete: sql`json(CASE WHEN ${and(
        confirmedActor,
        programCurrent,
        targetCurrent,
        assignmentCurrent
      )} THEN 'null' ELSE 'Program Leader authority changed' END)`,
    })
    .from(user)
    .limit(1);
};

const requiredProgramLeaderWrites = (
  db: Database,
  actorUserId: string,
  input: ProgramLeaderChangeInput,
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
            .from(programLeaderAssignment)
            .where(
              and(
                eq(programLeaderAssignment.id, assignmentId),
                eq(programLeaderAssignment.userId, input.targetUserId),
                eq(programLeaderAssignment.programId, input.scopeId)
              )
            )
        )
      : not(
          exists(
            db
              .select({ present: sql`1` })
              .from(programLeaderAssignment)
              .where(
                and(
                  eq(programLeaderAssignment.userId, input.targetUserId),
                  eq(programLeaderAssignment.programId, input.scopeId)
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
          eq(roleAssignmentHistory.role, "program_leader")
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
              ? "program_leader_granted"
              : "program_leader_withdrawn"
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
          eq(roleChangeOperation.role, "program_leader")
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
      )} THEN 'null' ELSE 'Incomplete Program Leader change' END)`,
    })
    .from(user)
    .limit(1);
};

const requireProgramLeaderChangePreflight = async (
  input: ProgramLeaderChangeInput,
  authority: ConfirmedProgramLeaderAuthority
) => {
  const scopeName = await programNameNow(input.scopeId);
  if (!scopeName) {
    throw conflict();
  }
  if (input.action === "granted") {
    if (
      !(await isEligibleProgramLeaderGrantTarget(
        getDb(),
        authority,
        input.targetUserId,
        input.scopeId
      ))
    ) {
      throw eligibilityConflict();
    }
    if (await assignmentNow(input)) {
      throw conflict();
    }
  } else {
    const assignment = await assignmentNow(input);
    if (!assignment || assignment.id !== input.expectedAssignmentId) {
      throw conflict();
    }
    if (
      authority.authority === "department-manager" &&
      !(await isCurrentDepartmentManagerProgramLeaderTarget(
        authority.actor.userId,
        input.targetUserId
      ))
    ) {
      throw conflict();
    }
  }
  return scopeName;
};

export const changeProgramLeader = async (
  headers: Headers,
  input: ProgramLeaderChangeInput
) => {
  const authority = requireProgramLeaderCommandAuthority(
    await requireProgramLeaderAuthority(headers, input.scopeId),
    input
  );
  const actorUserId = authority.actor.userId;
  const requestHash = await fingerprintProgramLeaderChange(actorUserId, input);
  const existing = await findProgramLeaderChange(
    headers,
    actorUserId,
    input.operationKey
  );
  if (existing) {
    return {
      created: false,
      receipt: matchingProgramLeaderChange(existing, requestHash),
    };
  }

  const confirmedAuthority = await requireConfirmedProgramLeaderAuthority(
    headers,
    input.scopeId,
    authority.authority === "department-manager"
      ? authority.assignmentId
      : undefined
  );
  const scopeName = await requireProgramLeaderChangePreflight(
    input,
    confirmedAuthority
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
      programLeaderWriteAssertion(db, confirmedAuthority, input, scopeName),
      db.insert(roleChangeOperation).values({
        action: input.action,
        actorUserId,
        createdAt: sql`unixepoch()`,
        id: operationId,
        operationKey: input.operationKey,
        requestHash,
        role: "program_leader",
        scopeId: input.scopeId,
        scopeName,
        targetUserId: input.targetUserId,
      }),
      input.action === "granted"
        ? db.insert(programLeaderAssignment).values({
            createdAt: operationCreatedAt,
            id: assignmentId,
            programId: input.scopeId,
            userId: input.targetUserId,
          })
        : db
            .delete(programLeaderAssignment)
            .where(
              and(
                eq(programLeaderAssignment.id, input.expectedAssignmentId),
                eq(programLeaderAssignment.programId, input.scopeId),
                eq(programLeaderAssignment.userId, input.targetUserId)
              )
            ),
      db.insert(roleAssignmentHistory).values({
        action: input.action,
        actorUserId,
        createdAt: operationCreatedAt,
        id: historyId,
        role: "program_leader",
        scopeId: input.scopeId,
        scopeName,
        targetUserId: input.targetUserId,
      }),
      db.insert(auditEvent).values({
        action:
          input.action === "granted"
            ? "program_leader_granted"
            : "program_leader_withdrawn",
        actorUserId,
        createdAt: operationCreatedAt,
        id: auditId,
        targetUserId: input.targetUserId,
      }),
      requiredProgramLeaderWrites(
        db,
        actorUserId,
        input,
        assignmentId,
        historyId,
        auditId,
        operationId
      ),
    ]);
  } catch (error) {
    const committed = await findProgramLeaderChange(
      headers,
      actorUserId,
      input.operationKey
    );
    if (committed) {
      return {
        created: false,
        receipt: matchingProgramLeaderChange(committed, requestHash),
      };
    }
    const currentAuthority = await requireConfirmedProgramLeaderAuthority(
      headers,
      input.scopeId,
      authority.authority === "department-manager"
        ? authority.assignmentId
        : undefined
    );
    const currentAssignment = await assignmentNow(input);
    const currentWithdrawalTarget =
      input.action !== "withdrawn" ||
      currentAuthority.authority === "admin" ||
      (await isCurrentDepartmentManagerProgramLeaderTarget(
        currentAuthority.actor.userId,
        input.targetUserId
      ));
    if (
      (await programNameNow(input.scopeId)) !== scopeName ||
      (input.action === "granted" &&
        (!(await isEligibleProgramLeaderGrantTarget(
          getDb(),
          currentAuthority,
          input.targetUserId,
          input.scopeId
        )) ||
          currentAssignment)) ||
      (input.action === "withdrawn" &&
        (currentAssignment?.id !== input.expectedAssignmentId ||
          !currentWithdrawalTarget))
    ) {
      throw conflict();
    }
    throw error;
  }
  const committed = await findProgramLeaderChange(
    headers,
    actorUserId,
    input.operationKey
  );
  if (!committed) {
    throw new Error("Committed Program Leader change has no receipt");
  }
  return {
    created: true,
    receipt: matchingProgramLeaderChange(committed, requestHash),
  };
};

export const reconcileProgramLeaderChange = async (
  headers: Headers,
  operationKey: string
): Promise<ProgramLeaderReceipt | null> => {
  const actor = await requireOwnBusinessAccess(headers);
  const row = await findRoleChangeOperation(
    getDb(),
    actor.userId,
    operationKey
  );

  if (row?.role === "program_leader") {
    const current = await findProgramLeaderChange(
      headers,
      actor.userId,
      operationKey
    );
    return current
      ? {
          action: current.action,
          createdAt: current.createdAt,
          id: current.id,
          scopeId: current.scopeId,
          scopeName: current.scopeName,
          targetUserId: current.targetUserId,
        }
      : null;
  }

  try {
    await requireProgramLeaderAdmin(headers);
  } catch (error) {
    if (
      !(error instanceof BusinessApiError) ||
      error.code !== "business_access_denied"
    ) {
      throw error;
    }
    await getProgramLeaderDepartments(headers, "1");
  }
  return null;
};

export const parseProgramLeaderChange = async (request: Request) => {
  const parsed = programLeaderChangeSchema.safeParse(
    await readBoundedJson(request)
  );
  if (!parsed.success) {
    throw new BusinessApiError(
      400,
      "validation_error",
      "請選擇一位人士及一個聚會，再確認新增或撤回。"
    );
  }
  return parsed.data;
};

export const parseProgramLeaderReconciliation = async (request: Request) => {
  const parsed = programLeaderReconciliationSchema.safeParse(
    await readBoundedJson(request)
  );
  if (!parsed.success) {
    throw new BusinessApiError(400, "validation_error", "操作代碼格式不正確。");
  }
  return parsed.data;
};
