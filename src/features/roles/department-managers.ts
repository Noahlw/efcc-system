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

const denied = () =>
  new BusinessApiError(
    403,
    "business_access_denied",
    "只有目前有效的管理員可以管理部門負責人。"
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

const requireDepartmentManagerAdmin = async (
  headers: Headers
): Promise<AdminActor> => {
  const actor = await requireStaff(headers);
  if (actor.role !== "admin") {
    throw denied();
  }
  return actor;
};

const requireConfirmedDepartmentManagerAdmin = async (
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

export interface DepartmentManagerCandidate {
  fullName: string;
  userId: string;
  username: string | null;
}

export interface DepartmentManagerSearchPage {
  actorUserId: string;
  candidates: DepartmentManagerCandidate[];
  hasNextPage: boolean;
  page: number;
}

export const getDepartmentManagerSearch = async (
  headers: Headers,
  requestedQuery: string | undefined,
  requestedPage: string | undefined
): Promise<DepartmentManagerSearchPage> => {
  const actor = await requireDepartmentManagerAdmin(headers);
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
  const eligible = eligibleDepartmentManagerTarget(db, user.id);
  const assigned = hasDepartmentManagerAssignment(db, user.id);
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
  await requireDepartmentManagerAdmin(headers);
  return {
    actorUserId: actor.userId,
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
  const actor = await requireDepartmentManagerAdmin(headers);
  const db = getDb();
  const eligible = eligibleDepartmentManagerTarget(db, user.id);
  const assigned = hasDepartmentManagerAssignment(db, user.id);
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
    await requireDepartmentManagerAdmin(headers);
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
        exists(currentAdminSession(db, actor))
      )
    )
    .orderBy(asc(department.name), asc(department.id))
    .limit(STAFF_ACCOUNT_PAGE_SIZE + 1)
    .offset((assignmentPage - 1) * STAFF_ACCOUNT_PAGE_SIZE);
  await requireDepartmentManagerAdmin(headers);
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
  const actor = await requireDepartmentManagerAdmin(headers);
  const page = normalizedStaffAccountPage(requestedPage);
  const rows = await getDb()
    .select({ id: department.id, name: department.name })
    .from(department)
    .where(exists(currentAdminSession(getDb(), actor)))
    .orderBy(asc(department.name), asc(department.id))
    .limit(STAFF_ACCOUNT_PAGE_SIZE + 1)
    .offset((page - 1) * STAFF_ACCOUNT_PAGE_SIZE);
  await requireDepartmentManagerAdmin(headers);
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
  const row = await getDb()
    .select({
      action: roleChangeOperation.action,
      createdAt: roleChangeOperation.createdAt,
      id: roleChangeOperation.id,
      requestHash: roleChangeOperation.requestHash,
      scopeId: roleChangeOperation.scopeId,
      scopeName: roleChangeOperation.scopeName,
      targetUserId: roleChangeOperation.targetUserId,
    })
    .from(roleChangeOperation)
    .where(
      and(
        eq(roleChangeOperation.actorUserId, actorUserId),
        eq(roleChangeOperation.operationKey, operationKey),
        eq(roleChangeOperation.role, "department_manager")
      )
    )
    .limit(1)
    .get();
  if (!row) {
    return null;
  }
  await requireDepartmentManagerAdmin(headers);
  return {
    ...row,
    createdAt: dateToUnixSeconds(row.createdAt),
  };
};

const matchingDepartmentManagerChange = (
  row: NonNullable<Awaited<ReturnType<typeof findDepartmentManagerChange>>>,
  requestHash: string
): DepartmentManagerReceipt => {
  if (row.requestHash !== requestHash) {
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

const departmentManagerWriteAssertion = (
  db: Database,
  actor: ConfirmedAdminActor,
  input: DepartmentManagerChangeInput,
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
  const departmentCurrent = exists(
    db
      .select({ present: sql`1` })
      .from(department)
      .where(
        and(eq(department.id, input.scopeId), eq(department.name, scopeName))
      )
  );
  const targetCurrent =
    input.action === "granted"
      ? eligibleDepartmentManagerTarget(db, input.targetUserId)
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
  const actor = await requireDepartmentManagerAdmin(headers);
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

  const confirmedActor = await requireConfirmedDepartmentManagerAdmin(headers);
  const scopeName = await departmentNameNow(input.scopeId);
  if (!scopeName) {
    throw conflict();
  }
  if (input.action === "granted") {
    if (!(await eligibleTargetNow(input.targetUserId))) {
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
      departmentManagerWriteAssertion(db, confirmedActor, input, scopeName),
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
    await requireConfirmedDepartmentManagerAdmin(headers);
    const currentAssignment = await assignmentNow(input);
    if (
      (await departmentNameNow(input.scopeId)) !== scopeName ||
      (input.action === "granted" &&
        (!(await eligibleTargetNow(input.targetUserId)) ||
          currentAssignment)) ||
      (input.action === "withdrawn" &&
        currentAssignment?.id !== input.expectedAssignmentId)
    ) {
      throw conflict();
    }
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
  const actor = await requireDepartmentManagerAdmin(headers);
  const row = await findDepartmentManagerChange(
    headers,
    actor.userId,
    operationKey
  );
  return row
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
