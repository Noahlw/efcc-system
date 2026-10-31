import { and, asc, eq, exists, or, sql } from "drizzle-orm";
import type { SQLWrapper } from "drizzle-orm";

import { getDb } from "../../server/db/client";
import type { Database } from "../../server/db/client";
import { department, program } from "../../server/db/schema/activities";
import { account, user } from "../../server/db/schema/auth";
import { personProfile } from "../../server/db/schema/identity";
import {
  departmentManagerAssignment,
  programLeaderAssignment,
} from "../../server/db/schema/notices";
import { roleAssignerAssignment } from "../../server/db/schema/roles";
import type { StaffActor } from "../account/account-actors";
import { BusinessApiError } from "../account/business-request";
import {
  normalizedStaffAccountPage,
  parseStaffSearch,
  STAFF_ACCOUNT_PAGE_SIZE,
} from "../account/staff-search-contract";
import { dateToUnixSeconds } from "../account/timestamps";
import {
  currentDepartmentManagerReadSession,
  eligibleDepartmentManagerTarget,
  hasDepartmentManagerAssignment,
  requireDepartmentManagerReadAuthority,
  roleAssignerDepartmentManagerMemberTarget,
} from "./department-managers";
import { staffTarget } from "./global-roles";
import { hasProgramLeaderAssignment } from "./program-leaders";

/**
 * One person-first read model shared by Admin and Role Assigner entry points.
 * Search and assignment paging stay independent; every query re-establishes
 * the current actor authority before protected data is returned.
 */
const ROLE_PERSON_DUTY_PAGE_SIZE = 6;
const ROLE_PERSON_PROGRAM_PAGE_SIZE = 25;

const authorityChanged = () =>
  new BusinessApiError(
    409,
    "conflict",
    "你的管理權限已改變，請重新整理後再試。"
  );

export interface RolePeopleReadAuthority {
  actor: StaffActor;
  actorKind: "admin" | "role_assigner";
  authorityAssignmentId: string | null;
}

export const requireRolePeopleReadAuthority = async (
  headers: Headers
): Promise<RolePeopleReadAuthority> => {
  const { actor, authorityAssignmentId } =
    await requireDepartmentManagerReadAuthority(headers);
  return {
    actor,
    actorKind: actor.role === "admin" ? "admin" : "role_assigner",
    authorityAssignmentId,
  };
};

const assertCurrentAuthority = async (
  headers: Headers,
  expected: RolePeopleReadAuthority
) => {
  const current = await requireRolePeopleReadAuthority(headers);
  if (
    current.actor.userId !== expected.actor.userId ||
    current.actorKind !== expected.actorKind ||
    current.authorityAssignmentId !== expected.authorityAssignmentId
  ) {
    throw authorityChanged();
  }
};

type TargetRole = "admin" | "member" | "staff";

const permittedTarget = (
  db: Database,
  authority: RolePeopleReadAuthority,
  targetUserId: SQLWrapper | string
) =>
  and(
    authority.actorKind === "admin"
      ? undefined
      : roleAssignerDepartmentManagerMemberTarget(
          db,
          authority.actor.userId,
          targetUserId
        ),
    or(
      eligibleDepartmentManagerTarget(db, targetUserId),
      authority.actorKind === "admin"
        ? staffTarget(db, targetUserId)
        : undefined,
      hasDepartmentManagerAssignment(db, targetUserId),
      hasProgramLeaderAssignment(db, targetUserId)
    )
  );

const currentRead = (db: Database, authority: RolePeopleReadAuthority) =>
  exists(currentDepartmentManagerReadSession(db, authority));

const currentTarget = (
  db: Database,
  authority: RolePeopleReadAuthority,
  targetUserId: string
) =>
  exists(
    db
      .select({ present: sql`1` })
      .from(user)
      .where(
        and(eq(user.id, targetUserId), permittedTarget(db, authority, user.id))
      )
  );

export interface RolePersonCandidate {
  accountRole: TargetRole;
  fullName: string;
  userId: string;
  username: string | null;
}

export interface RolePersonSearchPage {
  actorKind: RolePeopleReadAuthority["actorKind"];
  actorUserId: string;
  authorityAssignmentId: string | null;
  candidates: RolePersonCandidate[];
  hasNextPage: boolean;
  page: number;
}

export const searchRolePeople = async (
  headers: Headers,
  requestedQuery: string | undefined,
  requestedPage: string | undefined
): Promise<RolePersonSearchPage> => {
  const authority = await requireRolePeopleReadAuthority(headers);
  const query = parseStaffSearch(requestedQuery);
  const page = normalizedStaffAccountPage(requestedPage);
  if (!query) {
    await assertCurrentAuthority(headers, authority);
    return {
      actorKind: authority.actorKind,
      actorUserId: authority.actor.userId,
      authorityAssignmentId: authority.authorityAssignmentId,
      candidates: [],
      hasNextPage: false,
      page: 1,
    };
  }

  const db = getDb();
  const rows = await db
    .select({
      accountRole: personProfile.accountRole,
      fullName: user.name,
      userId: user.id,
      username: user.displayUsername,
    })
    .from(user)
    .innerJoin(personProfile, eq(personProfile.userId, user.id))
    .where(
      and(
        sql`instr(${personProfile.staffSearchKey}, ${query}) > 0`,
        permittedTarget(db, authority, user.id),
        currentRead(db, authority)
      )
    )
    .orderBy(asc(user.name), asc(user.id))
    .limit(STAFF_ACCOUNT_PAGE_SIZE + 1)
    .offset((page - 1) * STAFF_ACCOUNT_PAGE_SIZE);
  await assertCurrentAuthority(headers, authority);
  return {
    actorKind: authority.actorKind,
    actorUserId: authority.actor.userId,
    authorityAssignmentId: authority.authorityAssignmentId,
    candidates: rows.slice(0, STAFF_ACCOUNT_PAGE_SIZE).map((row) => ({
      accountRole:
        row.accountRole === "admin" || row.accountRole === "staff"
          ? row.accountRole
          : "member",
      fullName: row.fullName,
      userId: row.userId,
      username: row.username,
    })),
    hasNextPage: rows.length > STAFF_ACCOUNT_PAGE_SIZE,
    page,
  };
};

export interface RolePersonDutyProgram {
  assignmentId: string;
  createdAt: number;
  programId: string;
  programName: string;
}

export interface RolePersonDutyGroup {
  departmentId: string;
  departmentName: string;
  manager: { assignmentId: string; createdAt: number } | null;
  programs: RolePersonDutyProgram[];
  programsPage: number;
  hasNextProgramsPage: boolean;
}

export interface RolePersonDuties {
  groupCount: number | null;
  groups: RolePersonDutyGroup[];
  hasNextPage: boolean;
  page: number;
  pageSize: number;
  status: "complete" | "partial";
}

export interface RolePersonGlobalRecord {
  eligibleForAdmin: boolean;
  eligibleForRoleAssigner: boolean;
  eligibleForStaff: boolean;
  permanentCredential: "first-change-required" | "missing" | "usable";
  role: TargetRole;
  roleAssignerAssignment: { assignmentId: string; createdAt: number } | null;
}

export interface RolePersonDetail {
  actorKind: RolePeopleReadAuthority["actorKind"];
  actorUserId: string;
  authorityAssignmentId: string | null;
  capabilities: {
    canGrantAdmin: boolean;
    canManageAccountRole: boolean;
    canManageDuties: boolean;
    canManageRoleAssigner: boolean;
  };
  duties: RolePersonDuties;
  global: RolePersonGlobalRecord | null;
  identity: {
    accountState: "active" | "banned" | "deactivated" | "pending";
    fullName: string;
    role: TargetRole;
    userId: string;
    username: string | null;
  };
  isSelf: boolean;
}

const readDutyGroups = async (
  db: Database,
  authority: RolePeopleReadAuthority,
  targetUserId: string,
  requestedPage: string | undefined,
  programDepartment: string | undefined,
  requestedProgramPage: string | undefined
): Promise<RolePersonDuties> => {
  const page = normalizedStaffAccountPage(requestedPage);
  const departments = await db
    .select({
      id: department.id,
      name: department.name,
    })
    .from(department)
    .where(
      and(
        currentRead(db, authority),
        currentTarget(db, authority, targetUserId),
        or(
          exists(
            db
              .select({ present: sql`1` })
              .from(departmentManagerAssignment)
              .where(
                and(
                  eq(departmentManagerAssignment.departmentId, department.id),
                  eq(departmentManagerAssignment.userId, targetUserId)
                )
              )
          ),
          exists(
            db
              .select({ present: sql`1` })
              .from(programLeaderAssignment)
              .innerJoin(
                program,
                eq(program.id, programLeaderAssignment.programId)
              )
              .where(
                and(
                  eq(program.departmentId, department.id),
                  eq(programLeaderAssignment.userId, targetUserId)
                )
              )
          )
        )
      )
    )
    .orderBy(asc(department.name), asc(department.id))
    .limit(ROLE_PERSON_DUTY_PAGE_SIZE + 1)
    .offset((page - 1) * ROLE_PERSON_DUTY_PAGE_SIZE);
  const groups = await Promise.all(
    departments.slice(0, ROLE_PERSON_DUTY_PAGE_SIZE).map(async (item) => {
      const programsPage =
        item.id === programDepartment
          ? normalizedStaffAccountPage(requestedProgramPage)
          : 1;
      const [manager, programs] = await Promise.all([
        db
          .select({
            assignmentId: departmentManagerAssignment.id,
            createdAt: departmentManagerAssignment.createdAt,
          })
          .from(departmentManagerAssignment)
          .where(
            and(
              eq(departmentManagerAssignment.departmentId, item.id),
              eq(departmentManagerAssignment.userId, targetUserId),
              currentRead(db, authority),
              currentTarget(db, authority, targetUserId)
            )
          )
          .limit(1)
          .get(),
        db
          .select({
            assignmentId: programLeaderAssignment.id,
            createdAt: programLeaderAssignment.createdAt,
            programId: program.id,
            programName: program.name,
          })
          .from(programLeaderAssignment)
          .innerJoin(program, eq(program.id, programLeaderAssignment.programId))
          .where(
            and(
              eq(program.departmentId, item.id),
              eq(programLeaderAssignment.userId, targetUserId),
              currentRead(db, authority),
              currentTarget(db, authority, targetUserId)
            )
          )
          .orderBy(asc(program.name), asc(program.id))
          .limit(ROLE_PERSON_PROGRAM_PAGE_SIZE + 1)
          .offset((programsPage - 1) * ROLE_PERSON_PROGRAM_PAGE_SIZE),
      ]);
      return {
        departmentId: item.id,
        departmentName: item.name,
        hasNextProgramsPage: programs.length > ROLE_PERSON_PROGRAM_PAGE_SIZE,
        manager: manager
          ? {
              assignmentId: manager.assignmentId,
              createdAt: dateToUnixSeconds(manager.createdAt),
            }
          : null,
        programs: programs
          .slice(0, ROLE_PERSON_PROGRAM_PAGE_SIZE)
          .map((row) => ({
            ...row,
            createdAt: dateToUnixSeconds(row.createdAt),
          })),
        programsPage,
      };
    })
  );
  return {
    groupCount: null,
    // A first-page assignment read can confirm a group vanished after selection.
    // Later Program pages are partial, so empty continuation is not absence.
    groups: groups.filter(
      (group) =>
        group.manager !== null ||
        group.programs.length > 0 ||
        group.programsPage > 1
    ),
    hasNextPage: departments.length > ROLE_PERSON_DUTY_PAGE_SIZE,
    page,
    pageSize: ROLE_PERSON_DUTY_PAGE_SIZE,
    status:
      page > 1 ||
      departments.length > ROLE_PERSON_DUTY_PAGE_SIZE ||
      groups.some(
        (group) => group.programsPage > 1 || group.hasNextProgramsPage
      )
        ? "partial"
        : "complete",
  };
};

const normalizeRole = (role: string): TargetRole => {
  if (role === "admin" || role === "staff") {
    return role;
  }
  return "member";
};

const readPermanentCredential = (
  hasPermanentPassword: boolean,
  temporaryPasswordExpiresAt: Date | null
): RolePersonGlobalRecord["permanentCredential"] => {
  if (temporaryPasswordExpiresAt !== null) {
    return "first-change-required";
  }
  return hasPermanentPassword ? "usable" : "missing";
};

const readAccountState = (
  bannedAt: Date | null,
  membershipStatus: string
): RolePersonDetail["identity"]["accountState"] => {
  if (bannedAt !== null) {
    return "banned";
  }
  if (membershipStatus === "deactivated") {
    return "deactivated";
  }
  if (membershipStatus === "pending") {
    return "pending";
  }
  return "active";
};

const readCapabilities = ({
  actorKind,
  isSelf,
  role,
  eligibleForAdmin,
}: {
  actorKind: RolePeopleReadAuthority["actorKind"];
  eligibleForAdmin: boolean;
  isSelf: boolean;
  role: TargetRole;
}): RolePersonDetail["capabilities"] => {
  const admin = actorKind === "admin";
  const ordinaryGlobalTarget =
    admin && !isSelf && (role === "member" || role === "staff");
  return {
    canGrantAdmin: ordinaryGlobalTarget && eligibleForAdmin,
    canManageAccountRole: ordinaryGlobalTarget,
    canManageDuties:
      admin || (actorKind === "role_assigner" && role === "member" && !isSelf),
    canManageRoleAssigner: admin && role === "staff" && !isSelf,
  };
};

const readGlobalRecord = ({
  active,
  actorKind,
  assignment,
  permanentCredential,
  role,
}: {
  active: boolean;
  actorKind: RolePeopleReadAuthority["actorKind"];
  assignment: { assignmentId: string; createdAt: number } | null;
  permanentCredential: RolePersonGlobalRecord["permanentCredential"];
  role: TargetRole;
}): RolePersonGlobalRecord | null => {
  if (actorKind !== "admin") {
    return null;
  }
  return {
    eligibleForAdmin: active && permanentCredential === "usable",
    eligibleForRoleAssigner: role === "staff" && active,
    eligibleForStaff: role === "member" && active,
    permanentCredential,
    role,
    roleAssignerAssignment: assignment,
  };
};

export const getRolePersonDetail = async (
  headers: Headers,
  targetUserId: string,
  requestedDutyPage: string | undefined,
  programDepartment: string | undefined,
  requestedProgramPage: string | undefined
): Promise<RolePersonDetail | null> => {
  const authority = await requireRolePeopleReadAuthority(headers);
  const db = getDb();
  const row = await db
    .select({
      accountRole: personProfile.accountRole,
      assignmentCreatedAt: roleAssignerAssignment.createdAt,
      assignmentId: roleAssignerAssignment.id,
      bannedAt: personProfile.bannedAt,
      fullName: user.name,
      hasPermanentPassword: sql<boolean>`COALESCE(
        ${account.password} IS NOT NULL AND ${account.password} <> '',
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
        permittedTarget(db, authority, user.id),
        currentRead(db, authority)
      )
    )
    .limit(1)
    .get();
  if (!row) {
    await assertCurrentAuthority(headers, authority);
    return null;
  }

  const duties = await readDutyGroups(
    db,
    authority,
    targetUserId,
    requestedDutyPage,
    programDepartment,
    requestedProgramPage
  );
  await assertCurrentAuthority(headers, authority);
  const stillPermitted = await db
    .select({ role: personProfile.accountRole })
    .from(user)
    .innerJoin(personProfile, eq(personProfile.userId, user.id))
    .where(
      and(
        eq(user.id, targetUserId),
        eq(personProfile.accountRole, row.accountRole),
        permittedTarget(db, authority, user.id),
        currentRead(db, authority)
      )
    )
    .limit(1)
    .get();
  if (!stillPermitted) {
    await assertCurrentAuthority(headers, authority);
    return null;
  }
  await assertCurrentAuthority(headers, authority);

  const role = normalizeRole(row.accountRole);
  const isSelf = authority.actor.userId === row.userId;
  const active =
    row.membershipStatus === "active" &&
    row.bannedAt === null &&
    row.temporaryPasswordExpiresAt === null;
  const permanentCredential = readPermanentCredential(
    row.hasPermanentPassword,
    row.temporaryPasswordExpiresAt
  );
  const global = readGlobalRecord({
    active,
    actorKind: authority.actorKind,
    assignment:
      row.assignmentId && row.assignmentCreatedAt
        ? {
            assignmentId: row.assignmentId,
            createdAt: dateToUnixSeconds(row.assignmentCreatedAt),
          }
        : null,
    permanentCredential,
    role,
  });

  return {
    actorKind: authority.actorKind,
    actorUserId: authority.actor.userId,
    authorityAssignmentId: authority.authorityAssignmentId,
    capabilities: readCapabilities({
      actorKind: authority.actorKind,
      eligibleForAdmin: global?.eligibleForAdmin ?? false,
      isSelf,
      role,
    }),
    duties,
    global,
    identity: {
      accountState: readAccountState(row.bannedAt, row.membershipStatus),
      fullName: row.fullName,
      role,
      userId: row.userId,
      username: row.username,
    },
    isSelf,
  };
};
