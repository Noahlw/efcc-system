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
import { programLeaderAssignment } from "../../server/db/schema/notices";
import {
  roleAssignmentHistory,
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
    "只有目前有效的管理員可以管理 Program Leader。"
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
  hasNextPage: boolean;
  page: number;
  programs: { departmentName: string; id: string; name: string }[];
}

export const getProgramLeaderPrograms = async (
  headers: Headers,
  requestedPage: string | undefined
): Promise<ProgramLeaderProgramPage> => {
  const actor = await requireProgramLeaderAdmin(headers);
  const page = normalizedStaffAccountPage(requestedPage);
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
  await requireProgramLeaderAdmin(headers);
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
  actor: ConfirmedAdminActor,
  input: ProgramLeaderChangeInput,
  scopeName: string
) => {
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
          eq(personProfile.accountRole, "admin"),
          eq(personProfile.membershipStatus, "active"),
          isNull(personProfile.bannedAt)
        )
      )
  );
  const programCurrent = exists(
    db
      .select({ present: sql`1` })
      .from(program)
      .where(and(eq(program.id, input.scopeId), eq(program.name, scopeName)))
  );
  const targetCurrent =
    input.action === "granted"
      ? eligibleProgramLeaderTarget(db, input.targetUserId)
      : exists(
          db
            .select({ present: sql`1` })
            .from(user)
            .where(eq(user.id, input.targetUserId))
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

export const changeProgramLeader = async (
  headers: Headers,
  input: ProgramLeaderChangeInput
) => {
  const actor = await requireProgramLeaderAdmin(headers);
  const requestHash = await fingerprintProgramLeaderChange(actor.userId, input);
  const existing = await findProgramLeaderChange(
    headers,
    actor.userId,
    input.operationKey
  );
  if (existing) {
    return {
      created: false,
      receipt: matchingProgramLeaderChange(existing, requestHash),
    };
  }

  const confirmedActor = await requireConfirmedProgramLeaderAdmin(headers);
  const scopeName = await programNameNow(input.scopeId);
  if (!scopeName) {
    throw conflict();
  }
  if (input.action === "granted") {
    if (!(await eligibleProgramLeaderTarget(getDb(), input.targetUserId))) {
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
  }

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
      programLeaderWriteAssertion(db, confirmedActor, input, scopeName),
      db.insert(roleChangeOperation).values({
        action: input.action,
        actorUserId: actor.userId,
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
        actorUserId: actor.userId,
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
        actorUserId: actor.userId,
        createdAt: operationCreatedAt,
        id: auditId,
        targetUserId: input.targetUserId,
      }),
      requiredProgramLeaderWrites(
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
    const committed = await findProgramLeaderChange(
      headers,
      actor.userId,
      input.operationKey
    );
    if (committed) {
      return {
        created: false,
        receipt: matchingProgramLeaderChange(committed, requestHash),
      };
    }
    await requireConfirmedProgramLeaderAdmin(headers);
    const currentAssignment = await assignmentNow(input);
    if (
      (await programNameNow(input.scopeId)) !== scopeName ||
      (input.action === "granted" &&
        (!(await eligibleProgramLeaderTarget(getDb(), input.targetUserId)) ||
          currentAssignment)) ||
      (input.action === "withdrawn" &&
        currentAssignment?.id !== input.expectedAssignmentId)
    ) {
      throw conflict();
    }
    throw error;
  }
  const committed = await findProgramLeaderChange(
    headers,
    actor.userId,
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
  const actor = await requireProgramLeaderAdmin(headers);
  const row = await findProgramLeaderChange(
    headers,
    actor.userId,
    operationKey
  );
  return row?.role === "program_leader"
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
