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
  departmentMembership,
  programLeaderAssignment,
} from "../../server/db/schema/notices";
import {
  roleAssignerAssignment,
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
import {
  programLeaderGrantBatchEligibilitySchema,
  programLeaderGrantBatchReceiptSchema,
  programLeaderGrantBatchReconciliationSchema,
  programLeaderGrantBatchSchema,
} from "./program-leader-grant-batch-contract";
import type {
  ProgramLeaderAuthorityKind,
  ProgramLeaderGrantBatchEligibilityInput,
  ProgramLeaderGrantBatchInput,
} from "./program-leader-grant-batch-contract";
import { findRoleChangeOperation } from "./role-change-operation";

// 0019 hashed this exact JSON property order; formatters may sort object keys.
const LEGACY_PROGRAM_GRANT_FINGERPRINT_KEYS = [
  "authorityAssignmentId",
  "expectedDepartmentId",
  "scopeId",
  "targetUserIds",
  "operationKey",
];

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
    }
  | {
      actor: AccountActor;
      assignmentId: string;
      authority: "role-assigner";
    };

type ConfirmedProgramLeaderAuthority =
  | { actor: ConfirmedAdminActor; authority: "admin" }
  | {
      actor: ConfirmedCredentialActor;
      assignmentId: string;
      authority: "department-manager";
    }
  | {
      actor: ConfirmedCredentialActor;
      assignmentId: string;
      authority: "role-assigner";
    };

type DepartmentManagerProgramLeaderAuthority = Extract<
  ProgramLeaderAuthority,
  { authority: "admin" | "department-manager" }
>;

type GlobalProgramLeaderAuthority = Extract<
  ProgramLeaderAuthority,
  { authority: "admin" | "role-assigner" }
>;

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

const findProgramLeaderRoleAssignerAuthority = async (
  headers: Headers,
  expectedAssignmentId?: string
): Promise<Extract<
  ProgramLeaderAuthority,
  { authority: "role-assigner" }
> | null> => {
  const actor = await requireOwnBusinessAccess(headers);
  const current = await getDb()
    .select({ assignmentId: roleAssignerAssignment.id })
    .from(roleAssignerAssignment)
    .innerJoin(personProfile, eq(personProfile.userId, actor.userId))
    .where(
      and(
        eq(roleAssignerAssignment.userId, actor.userId),
        expectedAssignmentId
          ? eq(roleAssignerAssignment.id, expectedAssignmentId)
          : undefined,
        eq(personProfile.accountRole, "staff"),
        eq(personProfile.membershipStatus, "active"),
        isNull(personProfile.bannedAt)
      )
    )
    .limit(1)
    .get();
  return current
    ? {
        actor,
        assignmentId: current.assignmentId,
        authority: "role-assigner",
      }
    : null;
};

const requireGlobalProgramLeaderAuthority = async (
  headers: Headers
): Promise<GlobalProgramLeaderAuthority> => {
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

  const roleAssigner = await findProgramLeaderRoleAssignerAuthority(headers);
  if (!roleAssigner) {
    throw denied();
  }
  return roleAssigner;
};

const assertCurrentGlobalProgramLeaderAuthority = async (
  headers: Headers,
  expected: GlobalProgramLeaderAuthority
) => {
  if (expected.authority === "admin") {
    const current = await requireProgramLeaderAdmin(headers);
    if (
      current.userId !== expected.actor.userId ||
      current.sessionId !== expected.actor.sessionId
    ) {
      throw conflict();
    }
    return;
  }

  const current = await findProgramLeaderRoleAssignerAuthority(
    headers,
    expected.assignmentId
  );
  if (
    !current ||
    current.actor.userId !== expected.actor.userId ||
    current.actor.sessionId !== expected.actor.sessionId
  ) {
    throw conflict();
  }
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
): Promise<DepartmentManagerProgramLeaderAuthority> => {
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
  programId: string,
  expectedAssignmentId?: string,
  authorityKind?: "department_manager"
): Promise<ProgramLeaderAuthority> => {
  if (authorityKind === "department_manager") {
    const current = await requireProgramLeaderDepartmentManager(
      headers,
      programId
    );
    if (expectedAssignmentId && current.assignmentId !== expectedAssignmentId) {
      throw conflict();
    }
    return current;
  }
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

  const actor = await requireOwnBusinessAccess(headers);
  if (expectedAssignmentId) {
    const db = getDb();
    const manager = await db
      .select({ assignmentId: departmentManagerAssignment.id })
      .from(program)
      .innerJoin(
        departmentManagerAssignment,
        and(
          eq(departmentManagerAssignment.departmentId, program.departmentId),
          eq(departmentManagerAssignment.userId, actor.userId),
          eq(departmentManagerAssignment.id, expectedAssignmentId)
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
    const roleAssigner = await findProgramLeaderRoleAssignerAuthority(
      headers,
      expectedAssignmentId
    );
    if (manager && roleAssigner) {
      throw conflict();
    }
    if (manager) {
      return {
        actor,
        assignmentId: manager.assignmentId,
        authority: "department-manager",
      };
    }
    if (roleAssigner) {
      return roleAssigner;
    }
    if (await findProgramLeaderRoleAssignerAuthority(headers)) {
      throw conflict();
    }
    // Keep the original witness stale when another current authority exists,
    // while denying actors who no longer have authority for this Program.
    await requireProgramLeaderDepartmentManager(headers, programId);
    throw conflict();
  }

  const roleAssigner = await findProgramLeaderRoleAssignerAuthority(headers);
  if (roleAssigner) {
    return roleAssigner;
  }
  return requireProgramLeaderDepartmentManager(headers, programId);
};
const batchAuthorityKind = (
  authority: ProgramLeaderAuthority
): ProgramLeaderAuthorityKind => {
  if (authority.authority === "department-manager") {
    return "department_manager";
  }
  if (authority.authority === "role-assigner") {
    return "role_assigner";
  }
  return "admin";
};

const batchAuthorityWitness = (authority: ProgramLeaderAuthority) =>
  authority.authority === "admin" ? null : authority.assignmentId;

const parseBatchAuthorityKind = (
  value?: string
): ProgramLeaderAuthorityKind => {
  if (value === undefined || value === "department_manager") {
    return "department_manager";
  }
  if (value === "admin" || value === "role_assigner") {
    return value;
  }
  throw new BusinessApiError(400, "validation_error", "請重新選擇管理權限。");
};

const requireBatchAuthority = async (
  headers: Headers,
  programId: string,
  kind: ProgramLeaderAuthorityKind,
  expectedWitness?: string | null
): Promise<ProgramLeaderAuthority> => {
  let authority: ProgramLeaderAuthority;
  if (kind === "admin") {
    authority = {
      actor: await requireProgramLeaderAdmin(headers),
      authority: "admin",
    };
  } else if (kind === "department_manager") {
    authority = await requireProgramLeaderDepartmentManager(headers, programId);
  } else {
    const current = await findProgramLeaderRoleAssignerAuthority(headers);
    if (!current) {
      throw denied();
    }
    authority = current;
  }
  if (
    expectedWitness !== undefined &&
    batchAuthorityWitness(authority) !== expectedWitness
  ) {
    throw conflict();
  }
  return authority;
};

const assertSameBatchAuthority = (
  previous: ProgramLeaderAuthority,
  current: ProgramLeaderAuthority
) => {
  if (
    previous.actor.userId !== current.actor.userId ||
    previous.actor.sessionId !== current.actor.sessionId ||
    batchAuthorityKind(previous) !== batchAuthorityKind(current) ||
    batchAuthorityWitness(previous) !== batchAuthorityWitness(current)
  ) {
    throw conflict();
  }
};

const requireConfirmedProgramLeaderAuthority = async (
  headers: Headers,
  programId: string,
  expectedAssignmentId?: string,
  authorityKind?: "department_manager"
): Promise<ConfirmedProgramLeaderAuthority> => {
  const current = await requireProgramLeaderAuthority(
    headers,
    programId,
    expectedAssignmentId,
    authorityKind
  );
  if (current.authority === "admin") {
    return {
      actor: await requireConfirmedProgramLeaderAdmin(headers),
      authority: "admin",
    };
  }
  return {
    actor: await requireFreshCredentialConfirmation(headers),
    assignmentId: current.assignmentId,
    authority: current.authority,
  };
};

const requireProgramLeaderCommandAuthority = (
  authority: ProgramLeaderAuthority,
  input: ProgramLeaderChangeInput
) => {
  if (
    authority.authority !== "admin" &&
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

const currentRoleAssignerProgram = (
  db: Database,
  actorUserId: string,
  assignmentId: string
) =>
  exists(
    db
      .select({ present: sql`1` })
      .from(roleAssignerAssignment)
      .innerJoin(personProfile, eq(personProfile.userId, actorUserId))
      .where(
        and(
          eq(roleAssignerAssignment.id, assignmentId),
          eq(roleAssignerAssignment.userId, actorUserId),
          eq(personProfile.accountRole, "staff"),
          eq(personProfile.membershipStatus, "active"),
          isNull(personProfile.bannedAt)
        )
      )
  );

const currentGlobalProgramLeaderAuthority = (
  db: Database,
  authority: GlobalProgramLeaderAuthority
) =>
  authority.authority === "admin"
    ? exists(currentAdminSession(db, authority.actor))
    : currentRoleAssignerProgram(
        db,
        authority.actor.userId,
        authority.assignmentId
      );
const currentBatchAuthority = (
  db: Database,
  authority: ProgramLeaderAuthority,
  programId: string
) =>
  authority.authority === "department-manager"
    ? currentDepartmentManagerProgram(
        db,
        authority.actor.userId,
        authority.assignmentId,
        programId
      )
    : and(
        currentGlobalProgramLeaderAuthority(db, authority),
        exists(
          db
            .select({ present: sql`1` })
            .from(program)
            .where(eq(program.id, programId))
        )
      );

export const hasProgramLeaderAssignment = (
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

const eligibleRoleAssignerProgramLeaderTarget = (
  db: Database,
  actorUserId: string,
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
    authority: "admin" | "department-manager" | "role-assigner";
  },
  targetUserId: SQLWrapper | string,
  programId: string
) => {
  if (authority.authority === "admin") {
    return eligibleProgramLeaderTarget(db, targetUserId);
  }
  if (authority.authority === "department-manager") {
    return eligibleDepartmentProgramLeaderTarget(
      db,
      authority.actor.userId,
      targetUserId,
      programId
    );
  }
  return eligibleRoleAssignerProgramLeaderTarget(
    db,
    authority.actor.userId,
    targetUserId
  );
};

const isEligibleProgramLeaderGrantTarget = async (
  db: Database,
  authority: {
    actor: { userId: string };
    authority: "admin" | "department-manager" | "role-assigner";
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

const roleAssignerProgramLeaderChangeTargetWhere = (
  actorUserId: string,
  targetUserId: SQLWrapper | string
) =>
  and(
    eq(personProfile.userId, targetUserId),
    ne(personProfile.userId, actorUserId),
    eq(personProfile.accountRole, "member")
  );

const roleAssignerProgramLeaderChangeTarget = (
  db: Database,
  actorUserId: string,
  targetUserId: SQLWrapper | string
) =>
  exists(
    db
      .select({ present: sql`1` })
      .from(personProfile)
      .where(
        roleAssignerProgramLeaderChangeTargetWhere(actorUserId, targetUserId)
      )
  );

const isCurrentRoleAssignerProgramLeaderTarget = async (
  actorUserId: string,
  targetUserId: string
) =>
  Boolean(
    await getDb()
      .select({ userId: personProfile.userId })
      .from(personProfile)
      .where(
        roleAssignerProgramLeaderChangeTargetWhere(actorUserId, targetUserId)
      )
      .limit(1)
      .get()
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

const isCurrentProgramLeaderWithdrawalTarget = async (
  authority: ConfirmedProgramLeaderAuthority,
  targetUserId: string
) => {
  if (authority.authority === "admin") {
    return true;
  }
  if (authority.authority === "department-manager") {
    const eligible = await isCurrentDepartmentManagerProgramLeaderTarget(
      authority.actor.userId,
      targetUserId
    );
    return eligible;
  }
  const eligible = await isCurrentRoleAssignerProgramLeaderTarget(
    authority.actor.userId,
    targetUserId
  );
  return eligible;
};

export interface ProgramLeaderCandidate {
  fullName: string;
  userId: string;
  username: string | null;
}

export interface ProgramLeaderSearchPage {
  actorUserId: string;
  authorityAssignmentId?: string;
  candidates: ProgramLeaderCandidate[];
  hasNextPage: boolean;
  page: number;
}

export const getProgramLeaderSearch = async (
  headers: Headers,
  requestedQuery: string | undefined,
  requestedPage: string | undefined
): Promise<ProgramLeaderSearchPage> => {
  const authority = await requireGlobalProgramLeaderAuthority(headers);
  const { actor } = authority;
  const query = parseStaffSearch(requestedQuery);
  const page = normalizedStaffAccountPage(requestedPage);
  if (!query) {
    await assertCurrentGlobalProgramLeaderAuthority(headers, authority);
    return {
      actorUserId: actor.userId,
      ...(authority.authority === "role-assigner"
        ? { authorityAssignmentId: authority.assignmentId }
        : {}),
      candidates: [],
      hasNextPage: false,
      page: 1,
    };
  }

  const db = getDb();
  const eligible = eligibleProgramLeaderTarget(db, user.id);
  const assigned = hasProgramLeaderAssignment(db, user.id);
  const targetAccess =
    authority.authority === "admin"
      ? or(eligible, assigned)
      : and(
          eq(personProfile.accountRole, "member"),
          or(
            eligibleRoleAssignerProgramLeaderTarget(db, actor.userId, user.id),
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
        targetAccess,
        currentGlobalProgramLeaderAuthority(db, authority)
      )
    )
    .orderBy(asc(user.name), asc(user.id))
    .limit(STAFF_ACCOUNT_PAGE_SIZE + 1)
    .offset((page - 1) * STAFF_ACCOUNT_PAGE_SIZE);
  await assertCurrentGlobalProgramLeaderAuthority(headers, authority);
  return {
    actorUserId: actor.userId,
    ...(authority.authority === "role-assigner"
      ? { authorityAssignmentId: authority.assignmentId }
      : {}),
    candidates: rows.slice(0, STAFF_ACCOUNT_PAGE_SIZE),
    hasNextPage: rows.length > STAFF_ACCOUNT_PAGE_SIZE,
    page,
  };
};

export interface ProgramLeaderProgramPage {
  actorUserId?: string;
  authorityAssignmentId?: string | null;
  authorityKind?: ProgramLeaderAuthorityKind;
  department?: { assignmentId: string; id: string; name: string };
  hasNextPage: boolean;
  page: number;
  programs: {
    departmentId: string;
    departmentName: string;
    id: string;
    name: string;
  }[];
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
  const currentAssignmentQuery = db
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
    .limit(1);
  const currentAssignment = await currentAssignmentQuery.get();
  if (!currentAssignment) {
    throw denied();
  }

  const departmentsQuery = db
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
  const initialRows = await departmentsQuery.all();
  const currentActor = await requireOwnBusinessAccess(headers);
  if (
    currentActor.userId !== actor.userId ||
    currentActor.sessionId !== actor.sessionId
  ) {
    throw conflict();
  }
  const rows = await departmentsQuery.all();
  if (
    initialRows.length !== rows.length ||
    initialRows.some(
      (row, index) =>
        row.assignmentId !== rows[index]?.assignmentId ||
        row.id !== rows[index]?.id ||
        row.name !== rows[index]?.name
    )
  ) {
    throw conflict();
  }
  if (!(await currentAssignmentQuery.get())) {
    throw denied();
  }
  return {
    actorUserId: actor.userId,
    departments: rows.slice(0, STAFF_ACCOUNT_PAGE_SIZE),
    hasNextPage: rows.length > STAFF_ACCOUNT_PAGE_SIZE,
    page,
  };
};
export const hasProgramLeaderManagement = async (requestHeaders: Headers) => {
  try {
    await getProgramLeaderDepartments(requestHeaders, "1");
    return true;
  } catch (error) {
    if (error instanceof BusinessApiError && error.status === 403) {
      return false;
    }
    throw error;
  }
};

const getDepartmentProgramLeaderPrograms = async (
  headers: Headers,
  requestedDepartmentId: string,
  page: number,
  localDepartmentManager: boolean,
  mode: ProgramLeaderAuthorityKind | undefined
): Promise<ProgramLeaderProgramPage> => {
  const authority =
    localDepartmentManager || mode === "department_manager"
      ? await requireProgramLeaderDepartmentManagerForDepartment(
          headers,
          requestedDepartmentId
        )
      : await requireProgramLeaderAuthorityForDepartment(
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
                eq(departmentManagerAssignment.userId, authority.actor.userId),
                eq(personProfile.membershipStatus, "active"),
                isNull(personProfile.bannedAt)
              )
            )
        );
  const selectedDepartment =
    authority.authority === "department-manager"
      ? await db
          .select({ id: department.id, name: department.name })
          .from(department)
          .where(
            and(eq(department.id, requestedDepartmentId), currentAuthority)
          )
          .limit(1)
          .get()
      : undefined;
  const rows = await db
    .select({
      departmentId: department.id,
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
    if (!selectedDepartment) {
      throw conflict();
    }
  }
  return {
    actorUserId: authority.actor.userId,
    authorityKind: batchAuthorityKind(authority),
    ...(authority.authority === "department-manager" && selectedDepartment
      ? {
          authorityAssignmentId: authority.assignmentId,
          department: {
            ...selectedDepartment,
            assignmentId: authority.assignmentId,
          },
        }
      : {}),
    hasNextPage: rows.length > STAFF_ACCOUNT_PAGE_SIZE,
    page,
    programs: rows.slice(0, STAFF_ACCOUNT_PAGE_SIZE),
  };
};

export const getProgramLeaderPrograms = async (
  headers: Headers,
  requestedPage: string | undefined,
  requestedDepartmentId?: string,
  localDepartmentManager = false,
  requestedAuthority?: string
): Promise<ProgramLeaderProgramPage> => {
  if (localDepartmentManager && !requestedDepartmentId) {
    throw new BusinessApiError(400, "validation_error", "請選擇部門。");
  }
  const page = normalizedStaffAccountPage(requestedPage);
  const mode =
    requestedAuthority === undefined
      ? undefined
      : parseBatchAuthorityKind(requestedAuthority);
  if (mode === "department_manager" && !requestedDepartmentId) {
    throw new BusinessApiError(400, "validation_error", "請選擇部門。");
  }
  if (mode && mode !== "department_manager" && requestedDepartmentId) {
    throw new BusinessApiError(400, "validation_error", "請選擇聚會。");
  }
  if (requestedDepartmentId) {
    return getDepartmentProgramLeaderPrograms(
      headers,
      requestedDepartmentId,
      page,
      localDepartmentManager,
      mode
    );
  }

  const authority = mode
    ? await requireBatchAuthority(headers, "", mode)
    : await requireGlobalProgramLeaderAuthority(headers);
  if (authority.authority === "department-manager") {
    throw denied();
  }
  const db = getDb();
  const rows = await db
    .select({
      departmentId: department.id,
      departmentName: department.name,
      id: program.id,
      name: program.name,
    })
    .from(program)
    .innerJoin(department, eq(department.id, program.departmentId))
    .where(currentGlobalProgramLeaderAuthority(db, authority))
    .orderBy(asc(department.name), asc(program.name), asc(program.id))
    .limit(STAFF_ACCOUNT_PAGE_SIZE + 1)
    .offset((page - 1) * STAFF_ACCOUNT_PAGE_SIZE);
  await assertCurrentGlobalProgramLeaderAuthority(headers, authority);
  if (mode && batchAuthorityKind(authority) !== mode) {
    throw conflict();
  }
  return {
    actorUserId: authority.actor.userId,
    authorityAssignmentId: batchAuthorityWitness(authority),
    authorityKind: batchAuthorityKind(authority),
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
  authorityAssignmentId: string | null;
  authorityKind: ProgramLeaderAuthorityKind;
  program: {
    departmentId: string;
    departmentName: string;
    id: string;
    name: string;
  };
  hasNextPage: boolean;
  leaders: ProgramLeaderCurrentLeader[];
  page: number;
}

export const getProgramLeaderRoster = async (
  headers: Headers,
  programId: string,
  requestedPage: string | undefined,
  requestedAuthority?: string
): Promise<ProgramLeaderRosterPage> => {
  const mode = parseBatchAuthorityKind(requestedAuthority);
  const authority = await requireBatchAuthority(headers, programId, mode);
  const page = normalizedStaffAccountPage(requestedPage);
  const db = getDb();
  const selectedProgram = await db
    .select({
      departmentId: department.id,
      departmentName: department.name,
      id: program.id,
      name: program.name,
    })
    .from(program)
    .innerJoin(department, eq(department.id, program.departmentId))
    .where(
      and(
        eq(program.id, programId),
        currentBatchAuthority(db, authority, programId)
      )
    )
    .limit(1)
    .get();
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
        currentBatchAuthority(db, authority, programId),
        authority.authority === "role-assigner"
          ? roleAssignerProgramLeaderChangeTargetWhere(
              authority.actor.userId,
              user.id
            )
          : undefined
      )
    )
    .orderBy(asc(user.name), asc(user.id), asc(programLeaderAssignment.id))
    .limit(STAFF_ACCOUNT_PAGE_SIZE + 1)
    .offset((page - 1) * STAFF_ACCOUNT_PAGE_SIZE);
  const current = await requireBatchAuthority(headers, programId, mode);
  assertSameBatchAuthority(authority, current);
  if (!selectedProgram) {
    throw conflict();
  }
  return {
    actorUserId: authority.actor.userId,
    authorityAssignmentId: batchAuthorityWitness(authority),
    authorityKind: batchAuthorityKind(authority),
    hasNextPage: rows.length > STAFF_ACCOUNT_PAGE_SIZE,
    leaders: rows.slice(0, STAFF_ACCOUNT_PAGE_SIZE).map((row) => ({
      assignmentId: row.assignmentId,
      createdAt: dateToUnixSeconds(row.createdAt),
      eligibleForWithdrawal:
        authority.authority === "admin" ||
        (row.accountRole === "member" && row.userId !== authority.actor.userId),
      fullName: row.fullName,
      userId: row.userId,
      username: row.username,
    })),
    page,
    program: selectedProgram,
  };
};

/** Read only a current in-scope assignee for the local withdrawal task. */
export const getProgramLeaderAssigneeBaseline = async (
  headers: Headers,
  programId: string,
  targetUserId: string
) => {
  const authority = await requireProgramLeaderDepartmentManager(
    headers,
    programId
  );
  const db = getDb();
  const query = db
    .select({
      assignmentId: programLeaderAssignment.id,
      departmentId: department.id,
      departmentName: department.name,
      fullName: user.name,
      programId: program.id,
      programName: program.name,
      userId: user.id,
      username: user.displayUsername,
    })
    .from(programLeaderAssignment)
    .innerJoin(program, eq(program.id, programLeaderAssignment.programId))
    .innerJoin(department, eq(department.id, program.departmentId))
    .innerJoin(user, eq(user.id, programLeaderAssignment.userId))
    .innerJoin(personProfile, eq(personProfile.userId, user.id))
    .where(
      and(
        eq(program.id, programId),
        eq(user.id, targetUserId),
        ne(user.id, authority.actor.userId),
        eq(personProfile.accountRole, "member"),
        currentDepartmentManagerProgram(
          db,
          authority.actor.userId,
          authority.assignmentId,
          programId
        )
      )
    )
    .limit(1);
  const selected = await query.get();
  const current = await requireProgramLeaderDepartmentManager(
    headers,
    programId
  );
  if (
    current.actor.userId !== authority.actor.userId ||
    current.actor.sessionId !== authority.actor.sessionId ||
    current.assignmentId !== authority.assignmentId
  ) {
    throw conflict();
  }
  if (!selected) {
    return null;
  }
  const latest = await query.get();
  if (
    !latest ||
    latest.assignmentId !== selected.assignmentId ||
    latest.departmentId !== selected.departmentId
  ) {
    throw conflict();
  }
  return {
    actorUserId: authority.actor.userId,
    assignmentId: latest.assignmentId,
    authorityAssignmentId: authority.assignmentId,
    departmentId: latest.departmentId,
    departmentName: latest.departmentName,
    person: {
      fullName: latest.fullName,
      userId: latest.userId,
      username: latest.username,
    },
    programId: latest.programId,
    programName: latest.programName,
  };
};

export interface ProgramLeaderCandidatePage {
  actorUserId: string;
  authorityAssignmentId: string | null;
  authorityKind: ProgramLeaderAuthorityKind;
  candidates: ProgramLeaderCandidate[];
  hasNextPage: boolean;
  page: number;
}

export const getProgramLeaderCandidates = async (
  headers: Headers,
  programId: string,
  requestedQuery: string | undefined,
  requestedPage: string | undefined,
  requestedAuthority?: string
): Promise<ProgramLeaderCandidatePage> => {
  const mode = parseBatchAuthorityKind(requestedAuthority);
  const authority = await requireBatchAuthority(headers, programId, mode);
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
            eligibleProgramLeaderGrantTarget(db, authority, user.id, programId),
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
            currentBatchAuthority(db, authority, programId)
          )
        )
        .orderBy(asc(user.name), asc(user.id))
        .limit(STAFF_ACCOUNT_PAGE_SIZE + 1)
        .offset((page - 1) * STAFF_ACCOUNT_PAGE_SIZE)
    : [];
  const current = await requireBatchAuthority(headers, programId, mode);
  assertSameBatchAuthority(authority, current);
  return {
    actorUserId: authority.actor.userId,
    authorityAssignmentId: batchAuthorityWitness(authority),
    authorityKind: batchAuthorityKind(authority),
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
  authorityAssignmentId?: string;
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
  const authority = await requireGlobalProgramLeaderAuthority(headers);
  const { actor } = authority;
  const db = getDb();
  const eligible = eligibleProgramLeaderTarget(db, user.id);
  const assigned = hasProgramLeaderAssignment(db, user.id);
  const targetAccess =
    authority.authority === "admin"
      ? or(eligible, assigned)
      : and(
          ne(user.id, actor.userId),
          eq(personProfile.accountRole, "member"),
          or(
            eligibleRoleAssignerProgramLeaderTarget(db, actor.userId, user.id),
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
        targetAccess,
        currentGlobalProgramLeaderAuthority(db, authority)
      )
    )
    .limit(1)
    .get();
  if (!person) {
    await assertCurrentGlobalProgramLeaderAuthority(headers, authority);
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
        authority.authority === "admin"
          ? currentGlobalProgramLeaderAuthority(db, authority)
          : and(
              ne(programLeaderAssignment.userId, actor.userId),
              exists(
                db
                  .select({ present: sql`1` })
                  .from(personProfile)
                  .where(
                    and(
                      eq(personProfile.userId, programLeaderAssignment.userId),
                      eq(personProfile.accountRole, "member")
                    )
                  )
              ),
              currentGlobalProgramLeaderAuthority(db, authority)
            )
      )
    )
    .orderBy(
      asc(department.name),
      asc(program.name),
      asc(programLeaderAssignment.id)
    )
    .limit(STAFF_ACCOUNT_PAGE_SIZE + 1)
    .offset((assignmentPage - 1) * STAFF_ACCOUNT_PAGE_SIZE);
  await assertCurrentGlobalProgramLeaderAuthority(headers, authority);
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
      (authority.authority === "admin" || person.accountRole === "member") &&
      person.membershipStatus === "active" &&
      person.bannedAt === null &&
      person.temporaryPasswordExpiresAt === null,
    fullName: person.fullName,
    ...(authority.authority === "role-assigner"
      ? { authorityAssignmentId: authority.assignmentId }
      : {}),
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
  operationKey: string,
  authorityKind?: "department_manager"
) => {
  const row = await findRoleChangeOperation(getDb(), actorUserId, operationKey);
  if (!row) {
    return null;
  }
  if (row.commandFamily !== "single") {
    throw conflict();
  }
  const authority =
    authorityKind === "department_manager" ||
    row.authorityKind === "department_manager"
      ? await requireProgramLeaderDepartmentManager(headers, row.scopeId)
      : await requireProgramLeaderAuthority(headers, row.scopeId);
  if (
    row.role === "program_leader" &&
    ((authority.authority === "department-manager" &&
      !(await isCurrentDepartmentManagerProgramLeaderTarget(
        authority.actor.userId,
        row.targetUserId
      ))) ||
      (authority.authority === "role-assigner" &&
        !(await isCurrentRoleAssignerProgramLeaderTarget(
          authority.actor.userId,
          row.targetUserId
        ))))
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
  scopeName: string,
  expectedDepartmentId?: string
) => {
  const { actor } = authority;
  let requiredAccountRole: "admin" | "staff" | undefined;
  if (authority.authority === "admin") {
    requiredAccountRole = "admin";
  } else if (authority.authority === "role-assigner") {
    requiredAccountRole = "staff";
  }
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
          requiredAccountRole
            ? eq(personProfile.accountRole, requiredAccountRole)
            : undefined,
          eq(personProfile.membershipStatus, "active"),
          isNull(personProfile.bannedAt)
        )
      )
  );
  const programCurrent = (() => {
    if (authority.authority === "admin") {
      return exists(
        db
          .select({ present: sql`1` })
          .from(program)
          .where(
            and(eq(program.id, input.scopeId), eq(program.name, scopeName))
          )
      );
    }
    if (authority.authority === "role-assigner") {
      return exists(
        db
          .select({ present: sql`1` })
          .from(program)
          .where(
            and(
              eq(program.id, input.scopeId),
              eq(program.name, scopeName),
              currentRoleAssignerProgram(
                db,
                actor.userId,
                authority.assignmentId
              )
            )
          )
      );
    }
    return exists(
      db
        .select({ present: sql`1` })
        .from(program)
        .innerJoin(
          departmentManagerAssignment,
          and(
            eq(departmentManagerAssignment.id, authority.assignmentId),
            eq(departmentManagerAssignment.departmentId, program.departmentId),
            eq(departmentManagerAssignment.userId, actor.userId)
          )
        )
        .where(and(eq(program.id, input.scopeId), eq(program.name, scopeName)))
    );
  })();
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
    return authority.authority === "department-manager"
      ? departmentManagerProgramLeaderChangeTarget(
          db,
          authority.actor.userId,
          input.targetUserId
        )
      : roleAssignerProgramLeaderChangeTarget(
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
        assignmentCurrent,
        expectedDepartmentId === undefined
          ? undefined
          : exists(
              db
                .select({ present: sql`1` })
                .from(program)
                .where(
                  and(
                    eq(program.id, input.scopeId),
                    eq(program.departmentId, expectedDepartmentId)
                  )
                )
            )
      )} THEN 'null' ELSE 'Program Leader authority changed' END)`,
    })
    .from(sql`(select 1)`);
};

const requiredProgramLeaderWrites = (
  db: Database,
  actorUserId: string,
  input: ProgramLeaderChangeInput,
  assignmentId: string,
  historyId: string,
  auditId: string,
  operationId: string,
  aggregate?: {
    result: string;
    requestHash: string;
    scopeName: string;
  } & (
    | { family: "person_scoped" }
    | { family: "program_grants"; authorityKind: ProgramLeaderAuthorityKind }
  )
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
                eq(programLeaderAssignment.programId, input.scopeId),
                aggregate
                  ? eq(
                      programLeaderAssignment.createdAt,
                      sql`(SELECT created_at FROM role_change_operation WHERE id = ${operationId})`
                    )
                  : undefined
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
          eq(roleAssignmentHistory.role, "program_leader"),
          aggregate
            ? eq(roleAssignmentHistory.scopeName, aggregate.scopeName)
            : undefined,
          aggregate
            ? eq(
                roleAssignmentHistory.createdAt,
                sql`(SELECT created_at FROM role_change_operation WHERE id = ${operationId})`
              )
            : undefined
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
          ),
          aggregate
            ? eq(
                auditEvent.createdAt,
                sql`(SELECT created_at FROM role_change_operation WHERE id = ${operationId})`
              )
            : undefined
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
          aggregate?.family === "program_grants"
            ? isNull(roleChangeOperation.targetUserId)
            : eq(roleChangeOperation.targetUserId, input.targetUserId),
          ...(aggregate
            ? [
                eq(roleChangeOperation.commandFamily, aggregate.family),
                ...(aggregate.family === "program_grants"
                  ? [
                      eq(roleChangeOperation.scopeId, input.scopeId),
                      eq(roleChangeOperation.scopeName, aggregate.scopeName),
                      eq(roleChangeOperation.action, "granted"),
                      eq(roleChangeOperation.role, "program_leader"),
                      eq(
                        roleChangeOperation.authorityKind,
                        aggregate.authorityKind
                      ),
                    ]
                  : []),
                eq(roleChangeOperation.aggregateResult, aggregate.result),
                eq(roleChangeOperation.requestHash, aggregate.requestHash),
              ]
            : [
                eq(roleChangeOperation.scopeId, input.scopeId),
                eq(roleChangeOperation.action, input.action),
                input.authorityKind
                  ? eq(roleChangeOperation.authorityKind, input.authorityKind)
                  : isNull(roleChangeOperation.authorityKind),
                eq(roleChangeOperation.role, "program_leader"),
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
      )} THEN 'null' ELSE 'Incomplete Program Leader change' END)`,
    })
    .from(sql`(select 1)`);
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
      (authority.authority === "department-manager" &&
        !(await isCurrentDepartmentManagerProgramLeaderTarget(
          authority.actor.userId,
          input.targetUserId
        ))) ||
      (authority.authority === "role-assigner" &&
        !(await isCurrentRoleAssignerProgramLeaderTarget(
          authority.actor.userId,
          input.targetUserId
        )))
    ) {
      throw conflict();
    }
  }
  return scopeName;
};

/** Prepare one Program member for the existing person-scoped D1 batch. */
export const preparePersonScopedProgramChange = async (
  headers: Headers,
  input: ProgramLeaderChangeInput,
  expectedDepartmentId: string
) => {
  const authority = await requireConfirmedProgramLeaderAuthority(
    headers,
    input.scopeId,
    input.authorityAssignmentId
  );
  requireProgramLeaderCommandAuthority(authority, input);
  const db = getDb();
  const scopeName = await requireProgramLeaderChangePreflight(input, authority);
  const owner = await db
    .select({ id: program.id })
    .from(program)
    .where(
      and(
        eq(program.id, input.scopeId),
        eq(program.departmentId, expectedDepartmentId)
      )
    )
    .limit(1)
    .get();
  if (!owner) {
    throw conflict();
  }
  const build = (operationId: string, result: string, requestHash: string) => {
    const assignmentId = crypto.randomUUID();
    const historyId = crypto.randomUUID();
    const auditId = crypto.randomUUID();
    const createdAt = sql`(SELECT created_at FROM role_change_operation WHERE id = ${operationId})`;
    return {
      required: requiredProgramLeaderWrites(
        db,
        authority.actor.userId,
        input,
        assignmentId,
        historyId,
        auditId,
        operationId,
        { family: "person_scoped", requestHash, result, scopeName }
      ),
      writes: [
        programLeaderWriteAssertion(
          db,
          authority,
          input,
          scopeName,
          expectedDepartmentId
        ),
        input.action === "granted"
          ? db.insert(programLeaderAssignment).values({
              createdAt,
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
          actorUserId: authority.actor.userId,
          createdAt,
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
          actorUserId: authority.actor.userId,
          createdAt,
          id: auditId,
          targetUserId: input.targetUserId,
        }),
      ],
    };
  };
  const revalidate = async () => {
    const current = await requireConfirmedProgramLeaderAuthority(
      headers,
      input.scopeId,
      input.authorityAssignmentId
    );
    requireProgramLeaderCommandAuthority(current, input);
    const currentName = await requireProgramLeaderChangePreflight(
      input,
      current
    );
    const currentOwner = await db
      .select({ id: program.id })
      .from(program)
      .where(
        and(
          eq(program.id, input.scopeId),
          eq(program.departmentId, expectedDepartmentId)
        )
      )
      .limit(1)
      .get();
    if (!currentOwner || currentName !== scopeName) {
      throw conflict();
    }
  };
  return { build, revalidate, scopeName };
};

export const changeProgramLeader = async (
  headers: Headers,
  input: ProgramLeaderChangeInput
) => {
  const authority = requireProgramLeaderCommandAuthority(
    await requireProgramLeaderAuthority(
      headers,
      input.scopeId,
      input.authorityAssignmentId,
      input.authorityKind
    ),
    input
  );
  const actorUserId = authority.actor.userId;
  const expectedAuthorityAssignmentId =
    authority.authority === "admin" ? undefined : authority.assignmentId;
  const requestHash = await fingerprintProgramLeaderChange(actorUserId, input);
  const existing = await findProgramLeaderChange(
    headers,
    actorUserId,
    input.operationKey,
    input.authorityKind
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
    expectedAuthorityAssignmentId,
    input.authorityKind
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
        authorityKind: input.authorityKind ?? null,
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
      input.operationKey,
      input.authorityKind
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
      expectedAuthorityAssignmentId,
      input.authorityKind
    );
    const currentAssignment = await assignmentNow(input);
    const currentWithdrawalTarget =
      input.action !== "withdrawn" ||
      (await isCurrentProgramLeaderWithdrawalTarget(
        currentAuthority,
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
    input.operationKey,
    input.authorityKind
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
  operationKey: string,
  authorityKind?: "department_manager"
): Promise<ProgramLeaderReceipt | null> => {
  const actor = await requireOwnBusinessAccess(headers);
  const row = await findRoleChangeOperation(
    getDb(),
    actor.userId,
    operationKey
  );

  if (row?.commandFamily === "single" && row.role === "program_leader") {
    const current = await findProgramLeaderChange(
      headers,
      actor.userId,
      operationKey,
      authorityKind
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
  if (authorityKind === "department_manager") {
    await getProgramLeaderDepartments(headers, "1");
    return null;
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
    try {
      await getProgramLeaderDepartments(headers, "1");
    } catch (departmentManagerError) {
      if (
        !(departmentManagerError instanceof BusinessApiError) ||
        departmentManagerError.code !== "business_access_denied"
      ) {
        throw departmentManagerError;
      }
      await requireGlobalProgramLeaderAuthority(headers);
    }
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

/** Read all selected targets together under the captured local authority. */
export const validateProgramLeaderGrantBatch = async (
  headers: Headers,
  input: ProgramLeaderGrantBatchEligibilityInput
) => {
  const authority = await requireBatchAuthority(
    headers,
    input.scopeId,
    input.authorityKind,
    input.authorityAssignmentId
  );
  const db = getDb();
  const owner = await db
    .select({ name: program.name })
    .from(program)
    .where(
      and(
        eq(program.id, input.scopeId),
        eq(program.departmentId, input.expectedDepartmentId)
      )
    )
    .limit(1)
    .get();
  if (!owner) {
    throw conflict();
  }
  const rows = await db
    .select({ id: user.id })
    .from(user)
    .where(
      and(
        inArray(user.id, input.targetUserIds),
        eligibleProgramLeaderGrantTarget(db, authority, user.id, input.scopeId),
        not(
          exists(
            db
              .select({ id: programLeaderAssignment.id })
              .from(programLeaderAssignment)
              .where(
                and(
                  eq(programLeaderAssignment.userId, user.id),
                  eq(programLeaderAssignment.programId, input.scopeId)
                )
              )
          )
        )
      )
    );
  const current = await requireBatchAuthority(
    headers,
    input.scopeId,
    input.authorityKind,
    input.authorityAssignmentId
  );
  assertSameBatchAuthority(authority, current);
  const currentOwner = await db
    .select({ name: program.name })
    .from(program)
    .where(
      and(
        eq(program.id, input.scopeId),
        eq(program.departmentId, input.expectedDepartmentId),
        eq(program.name, owner.name)
      )
    )
    .limit(1)
    .get();
  if (
    batchAuthorityWitness(current) !== input.authorityAssignmentId ||
    !currentOwner ||
    rows.length !== input.targetUserIds.length
  ) {
    throw conflict();
  }
  return {
    actorUserId: authority.actor.userId,
    authorityAssignmentId: batchAuthorityWitness(authority),
    authorityKind: batchAuthorityKind(authority),
    eligible: true as const,
    expectedDepartmentId: input.expectedDepartmentId,
    scopeId: input.scopeId,
  };
};

const batchReceipt = (
  row: Extract<
    NonNullable<Awaited<ReturnType<typeof findRoleChangeOperation>>>,
    { commandFamily: "program_grants" }
  >
) =>
  programLeaderGrantBatchReceiptSchema.parse({
    createdAt: dateToUnixSeconds(row.createdAt),
    id: row.id,
    scopeId: row.scopeId,
    scopeName: row.scopeName,
    targetUserIds: JSON.parse(row.aggregateResult),
  });

const findProgramLeaderGrantBatch = async (
  headers: Headers,
  actorUserId: string,
  operationKey: string
) => {
  const row = await findRoleChangeOperation(getDb(), actorUserId, operationKey);
  if (!row) {
    return null;
  }
  if (row.commandFamily !== "program_grants") {
    throw conflict();
  }
  const authority = await requireProgramLeaderAuthority(headers, row.scopeId);
  if ((await programNameNow(row.scopeId)) === null) {
    throw denied();
  }
  if (
    authority.authority === "role-assigner" ||
    (authority.authority === "department-manager" &&
      row.authorityKind !== "department_manager")
  ) {
    const targets = batchReceipt(row).targetUserIds;
    const allowed = await Promise.all(
      targets.map((target) =>
        authority.authority === "role-assigner"
          ? isCurrentRoleAssignerProgramLeaderTarget(actorUserId, target)
          : isCurrentDepartmentManagerProgramLeaderTarget(actorUserId, target)
      )
    );
    if (allowed.some((value) => !value)) {
      throw denied();
    }
  }
  if (authority.actor.userId !== actorUserId) {
    throw conflict();
  }
  const current = await requireProgramLeaderAuthority(headers, row.scopeId);
  assertSameBatchAuthority(authority, current);
  if ((await programNameNow(row.scopeId)) === null) {
    throw denied();
  }
  return row;
};

export const changeProgramLeaderGrantBatch = async (
  headers: Headers,
  input: ProgramLeaderGrantBatchInput
) => {
  const authority = await requireBatchAuthority(
    headers,
    input.scopeId,
    input.authorityKind,
    input.authorityAssignmentId
  );
  const actorUserId = authority.actor.userId;
  const context = await getAuth().$context;
  const requestHash = createHmac("sha256", context.secret)
    .update(
      JSON.stringify(
        [actorUserId, "program_grants", input],
        input.authorityKind === "department_manager"
          ? LEGACY_PROGRAM_GRANT_FINGERPRINT_KEYS
          : undefined
      )
    )
    .digest("hex");
  const matching = (
    row: NonNullable<Awaited<ReturnType<typeof findProgramLeaderGrantBatch>>>
  ) => {
    if (row.requestHash !== requestHash) {
      throw conflict();
    }
    return batchReceipt(row);
  };
  const existing = await findProgramLeaderGrantBatch(
    headers,
    actorUserId,
    input.operationKey
  );
  if (existing) {
    return { created: false, receipt: matching(existing) };
  }
  const confirmed: ConfirmedProgramLeaderAuthority =
    authority.authority === "admin"
      ? {
          actor: await requireConfirmedProgramLeaderAdmin(headers),
          authority: "admin",
        }
      : {
          actor: await requireFreshCredentialConfirmation(headers),
          assignmentId: authority.assignmentId,
          authority: authority.authority,
        };
  const currentAuthority = await requireBatchAuthority(
    headers,
    input.scopeId,
    input.authorityKind,
    input.authorityAssignmentId
  );
  assertSameBatchAuthority(authority, currentAuthority);
  if (
    confirmed.actor.userId !== actorUserId ||
    confirmed.actor.sessionId !== authority.actor.sessionId
  ) {
    throw conflict();
  }
  await validateProgramLeaderGrantBatch(headers, input);
  const db = getDb();
  const scopeName = await programNameNow(input.scopeId);
  if (scopeName === null) {
    throw conflict();
  }
  const operationId = crypto.randomUUID();
  programLeaderGrantBatchReceiptSchema.parse({
    createdAt: 0,
    id: operationId,
    scopeId: input.scopeId,
    scopeName,
    targetUserIds: input.targetUserIds,
  });
  const aggregateResult = JSON.stringify(input.targetUserIds);
  const createdAt = sql`(SELECT created_at FROM role_change_operation WHERE id = ${operationId})`;
  const operation = db.insert(roleChangeOperation).values({
    action: "granted",
    actorUserId,
    aggregateResult,
    authorityKind: input.authorityKind,
    commandFamily: "program_grants",
    createdAt: sql`unixepoch()`,
    id: operationId,
    operationKey: input.operationKey,
    requestHash,
    role: "program_leader",
    scopeId: input.scopeId,
    scopeName,
    targetUserId: null,
  });
  const statements: BatchItem<"sqlite">[] = [];
  const required: BatchItem<"sqlite">[] = [];
  for (const targetUserId of input.targetUserIds) {
    const member: ProgramLeaderChangeInput = {
      action: "granted",
      ...(input.authorityAssignmentId
        ? { authorityAssignmentId: input.authorityAssignmentId }
        : {}),
      ...(input.authorityKind === "department_manager"
        ? { authorityKind: "department_manager" as const }
        : {}),
      operationKey: input.operationKey,
      scopeId: input.scopeId,
      targetUserId,
    };
    const assignmentId = crypto.randomUUID();
    const historyId = crypto.randomUUID();
    const auditId = crypto.randomUUID();
    statements.push(
      programLeaderWriteAssertion(
        db,
        confirmed,
        member,
        scopeName,
        input.expectedDepartmentId
      ),
      db.insert(programLeaderAssignment).values({
        createdAt,
        id: assignmentId,
        programId: input.scopeId,
        userId: targetUserId,
      }),
      db.insert(roleAssignmentHistory).values({
        action: "granted",
        actorUserId,
        createdAt,
        id: historyId,
        role: "program_leader",
        scopeId: input.scopeId,
        scopeName,
        targetUserId,
      }),
      db.insert(auditEvent).values({
        action: "program_leader_granted",
        actorUserId,
        createdAt,
        id: auditId,
        targetUserId,
      })
    );
    required.push(
      requiredProgramLeaderWrites(
        db,
        actorUserId,
        member,
        assignmentId,
        historyId,
        auditId,
        operationId,
        {
          authorityKind: input.authorityKind,
          family: "program_grants",
          requestHash,
          result: aggregateResult,
          scopeName,
        }
      )
    );
  }
  try {
    await db.batch([operation, ...statements, ...required]);
  } catch (error) {
    const committed = await findProgramLeaderGrantBatch(
      headers,
      actorUserId,
      input.operationKey
    );
    if (committed) {
      return { created: false, receipt: matching(committed) };
    }
    const currentAuthorityAfterFailure = await requireBatchAuthority(
      headers,
      input.scopeId,
      input.authorityKind,
      input.authorityAssignmentId
    );
    assertSameBatchAuthority(authority, currentAuthorityAfterFailure);
    await requireFreshCredentialConfirmation(headers);
    await validateProgramLeaderGrantBatch(headers, input);
    if ((await programNameNow(input.scopeId)) !== scopeName) {
      throw conflict();
    }
    throw error;
  }
  const committed = await findProgramLeaderGrantBatch(
    headers,
    actorUserId,
    input.operationKey
  );
  if (!committed) {
    throw new Error("Committed Program Leader grant batch has no receipt");
  }
  return { created: true, receipt: matching(committed) };
};

export const reconcileProgramLeaderGrantBatch = async (
  headers: Headers,
  operationKey: string
) => {
  const actor = await requireOwnBusinessAccess(headers);
  const row = await findRoleChangeOperation(
    getDb(),
    actor.userId,
    operationKey
  );
  if (row?.commandFamily === "program_grants") {
    const authorized = await findProgramLeaderGrantBatch(
      headers,
      actor.userId,
      operationKey
    );
    if (!authorized) {
      throw conflict();
    }
    return { outcome: "committed" as const, receipt: batchReceipt(row) };
  }
  try {
    await getProgramLeaderDepartments(headers, "1");
  } catch (error) {
    if (!(error instanceof BusinessApiError) || error.status !== 403) {
      throw error;
    }
    await requireGlobalProgramLeaderAuthority(headers);
  }
  return { outcome: "unknown" as const, receipt: null };
};

export const parseProgramLeaderGrantBatch = async (request: Request) => {
  const parsed = programLeaderGrantBatchSchema.safeParse(
    await readBoundedJson(request)
  );
  if (!parsed.success) {
    throw new BusinessApiError(
      400,
      "validation_error",
      "請選擇最多七位符合條件的人士。"
    );
  }
  return parsed.data;
};

export const parseProgramLeaderGrantBatchEligibility = async (
  request: Request
) => {
  const parsed = programLeaderGrantBatchEligibilitySchema.safeParse(
    await readBoundedJson(request)
  );
  if (!parsed.success) {
    throw new BusinessApiError(
      400,
      "validation_error",
      "請重新選擇人士並查核。"
    );
  }
  return parsed.data;
};

export const parseProgramLeaderGrantBatchReconciliation = async (
  request: Request
) => {
  const parsed = programLeaderGrantBatchReconciliationSchema.safeParse(
    await readBoundedJson(request)
  );
  if (!parsed.success) {
    throw new BusinessApiError(400, "validation_error", "操作代碼格式不正確。");
  }
  return parsed.data;
};
