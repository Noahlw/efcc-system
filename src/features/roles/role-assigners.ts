import { createHmac } from "node:crypto";

import { and, eq, exists, isNull, ne, not, sql } from "drizzle-orm";

import { getAuth } from "../../server/auth";
import { getDb } from "../../server/db/client";
import type { Database } from "../../server/db/client";
import { auditEvent } from "../../server/db/schema/applications";
import { account, user } from "../../server/db/schema/auth";
import { personProfile } from "../../server/db/schema/identity";
import {
  roleAssignerAssignment,
  roleAssignmentHistory,
  roleChangeOperation,
} from "../../server/db/schema/roles";
import { BusinessApiError, readBoundedJson } from "../account/business-request";
import { dateToUnixSeconds } from "../account/timestamps";
import {
  confirmedGlobalRoleAdminExists,
  requireConfirmedGlobalRoleAdmin,
  requireGlobalRoleAdmin,
} from "./global-roles";
import type {
  RoleAssignerChangeInput,
  RoleAssignerReceipt,
} from "./role-assigner-contract";
import {
  roleAssignerChangeSchema,
  roleAssignerReconciliationSchema,
} from "./role-assigner-contract";
import { findRoleChangeOperation } from "./role-change-operation";

const ROLE_SCOPE_ID = "global";
const ROLE_SCOPE_NAME = "全域角色";

const conflict = () =>
  new BusinessApiError(409, "conflict", "角色或委派資料已更新，請重新查核。");

const eligibilityConflict = () =>
  new BusinessApiError(409, "conflict", "此帳戶目前不符合職務委派條件。");

const currentAssignment = (db: Database, targetUserId: string) =>
  db
    .select({ id: roleAssignerAssignment.id })
    .from(roleAssignerAssignment)
    .where(eq(roleAssignerAssignment.userId, targetUserId))
    .limit(1);

const currentStaffTarget = (db: Database, targetUserId: string) =>
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

const eligibleStaffTarget = (db: Database, targetUserId: string) =>
  exists(
    db
      .select({ present: sql`1` })
      .from(personProfile)
      .innerJoin(account, eq(account.userId, personProfile.userId))
      .where(
        and(
          eq(personProfile.userId, targetUserId),
          eq(personProfile.accountRole, "staff"),
          eq(personProfile.membershipStatus, "active"),
          isNull(personProfile.bannedAt),
          eq(account.accountId, personProfile.userId),
          eq(account.providerId, "credential"),
          isNull(account.temporaryPasswordExpiresAt)
        )
      )
  );

const noRoleAssigner = (db: Database, targetUserId: string) =>
  not(exists(currentAssignment(db, targetUserId)));

const roleAssignerMatches = (db: Database, input: RoleAssignerChangeInput) =>
  input.action === "granted"
    ? noRoleAssigner(db, input.targetUserId)
    : exists(
        db
          .select({ present: sql`1` })
          .from(roleAssignerAssignment)
          .where(
            and(
              eq(roleAssignerAssignment.id, input.expectedAssignmentId),
              eq(roleAssignerAssignment.userId, input.targetUserId)
            )
          )
      );

const roleAssignerWriteAssertion = (
  db: Database,
  actor: Awaited<ReturnType<typeof requireConfirmedGlobalRoleAdmin>>,
  input: RoleAssignerChangeInput
) => {
  const targetCurrent =
    input.action === "granted"
      ? eligibleStaffTarget(db, input.targetUserId)
      : currentStaffTarget(db, input.targetUserId);
  return db
    .select({
      complete: sql`json(CASE WHEN ${and(
        confirmedGlobalRoleAdminExists(db, actor),
        targetCurrent,
        roleAssignerMatches(db, input),
        ne(user.id, actor.userId)
      )} THEN 'null' ELSE 'Role Assigner authority changed' END)`,
    })
    .from(user)
    .where(eq(user.id, input.targetUserId))
    .limit(1);
};

const requiredRoleAssignerWrites = (
  db: Database,
  actorUserId: string,
  input: RoleAssignerChangeInput,
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
            .from(roleAssignerAssignment)
            .where(
              and(
                eq(roleAssignerAssignment.id, assignmentId),
                eq(roleAssignerAssignment.userId, input.targetUserId)
              )
            )
        )
      : noRoleAssigner(db, input.targetUserId);
  const historyWritten = exists(
    db
      .select({ present: sql`1` })
      .from(roleAssignmentHistory)
      .where(
        and(
          eq(roleAssignmentHistory.id, historyId),
          eq(roleAssignmentHistory.actorUserId, actorUserId),
          eq(roleAssignmentHistory.targetUserId, input.targetUserId),
          eq(roleAssignmentHistory.action, input.action),
          eq(roleAssignmentHistory.role, "role_assigner"),
          isNull(roleAssignmentHistory.resultingGlobalRole),
          eq(roleAssignmentHistory.scopeId, ROLE_SCOPE_ID),
          eq(roleAssignmentHistory.scopeName, ROLE_SCOPE_NAME)
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
              ? "role_assigner_granted"
              : "role_assigner_withdrawn"
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
          eq(roleChangeOperation.action, input.action),
          eq(roleChangeOperation.role, "role_assigner"),
          isNull(roleChangeOperation.resultingGlobalRole),
          eq(roleChangeOperation.scopeId, ROLE_SCOPE_ID),
          eq(roleChangeOperation.scopeName, ROLE_SCOPE_NAME)
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
      )} THEN 'null' ELSE 'Incomplete Role Assigner change' END)`,
    })
    .from(user)
    .where(eq(user.id, input.targetUserId))
    .limit(1);
};

const fingerprint = async (
  actorUserId: string,
  input: RoleAssignerChangeInput
) => {
  const context = await getAuth().$context;
  return createHmac("sha256", context.secret)
    .update(JSON.stringify([actorUserId, "role_assigner", input]))
    .digest("hex");
};

const findRoleAssignerChange = async (
  headers: Headers,
  actorUserId: string,
  operationKey: string
) => {
  const row = await findRoleChangeOperation(getDb(), actorUserId, operationKey);
  if (!row) {
    return null;
  }
  await requireGlobalRoleAdmin(headers);
  if (row.commandFamily !== "single") {
    throw conflict();
  }
  return { ...row, createdAt: dateToUnixSeconds(row.createdAt) };
};

const matchingRoleAssignerChange = (
  row: NonNullable<Awaited<ReturnType<typeof findRoleAssignerChange>>>,
  requestHash: string
): RoleAssignerReceipt => {
  if (
    row.role !== "role_assigner" ||
    row.resultingGlobalRole !== null ||
    row.requestHash !== requestHash
  ) {
    throw conflict();
  }
  return {
    action: row.action,
    createdAt: row.createdAt,
    id: row.id,
    role: "role_assigner",
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

const eligibleStaffNow = async (targetUserId: string) =>
  Boolean(
    await getDb()
      .select({ present: sql`1` })
      .from(user)
      .where(
        and(
          eq(user.id, targetUserId),
          eligibleStaffTarget(getDb(), targetUserId)
        )
      )
      .limit(1)
      .get()
  );

const assertRoleAssignerTarget = async (
  db: Database,
  input: RoleAssignerChangeInput
) => {
  const current = await currentAssignment(db, input.targetUserId).get();
  const targetRole = await targetRoleNow(input.targetUserId);
  if (targetRole !== "staff") {
    throw conflict();
  }
  if (input.action === "granted") {
    if (!(await eligibleStaffNow(input.targetUserId))) {
      throw eligibilityConflict();
    }
    if (current) {
      throw conflict();
    }
    return;
  }
  if (current?.id !== input.expectedAssignmentId) {
    throw conflict();
  }
};

const revalidateRoleAssignerAfterFailure = async (
  headers: Headers,
  db: Database,
  input: RoleAssignerChangeInput
) => {
  await requireConfirmedGlobalRoleAdmin(headers);
  if ((await targetRoleNow(input.targetUserId)) !== "staff") {
    throw conflict();
  }
  if (input.action === "granted") {
    if (
      !(await eligibleStaffNow(input.targetUserId)) ||
      (await currentAssignment(db, input.targetUserId).get())
    ) {
      throw conflict();
    }
    return;
  }
  const current = await currentAssignment(db, input.targetUserId).get();
  if (current?.id !== input.expectedAssignmentId) {
    throw conflict();
  }
};

export const changeRoleAssigner = async (
  headers: Headers,
  input: RoleAssignerChangeInput
) => {
  const actor = await requireGlobalRoleAdmin(headers);
  if (actor.userId === input.targetUserId) {
    throw conflict();
  }
  const requestHash = await fingerprint(actor.userId, input);
  const existing = await findRoleAssignerChange(
    headers,
    actor.userId,
    input.operationKey
  );
  if (existing) {
    return {
      created: false,
      receipt: matchingRoleAssignerChange(existing, requestHash),
    };
  }

  const confirmedActor = await requireConfirmedGlobalRoleAdmin(headers);
  const db = getDb();
  await assertRoleAssignerTarget(db, input);

  const assignmentId =
    input.action === "granted"
      ? crypto.randomUUID()
      : input.expectedAssignmentId;
  const historyId = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const operationId = crypto.randomUUID();
  const operationCreatedAt = sql`(
    SELECT created_at FROM role_change_operation WHERE id = ${operationId}
  )`;
  try {
    await db.batch([
      roleAssignerWriteAssertion(db, confirmedActor, input),
      db.insert(roleChangeOperation).values({
        action: input.action,
        actorUserId: actor.userId,
        createdAt: sql`unixepoch()`,
        id: operationId,
        operationKey: input.operationKey,
        requestHash,
        role: "role_assigner",
        scopeId: ROLE_SCOPE_ID,
        scopeName: ROLE_SCOPE_NAME,
        targetUserId: input.targetUserId,
      }),
      ...(input.action === "granted"
        ? [
            db.insert(roleAssignerAssignment).values({
              createdAt: operationCreatedAt,
              id: assignmentId,
              userId: input.targetUserId,
            }),
          ]
        : [
            db
              .delete(roleAssignerAssignment)
              .where(
                and(
                  eq(roleAssignerAssignment.id, assignmentId),
                  eq(roleAssignerAssignment.userId, input.targetUserId)
                )
              ),
          ]),
      db.insert(roleAssignmentHistory).values({
        action: input.action,
        actorUserId: actor.userId,
        createdAt: operationCreatedAt,
        id: historyId,
        role: "role_assigner",
        scopeId: ROLE_SCOPE_ID,
        scopeName: ROLE_SCOPE_NAME,
        targetUserId: input.targetUserId,
      }),
      db.insert(auditEvent).values({
        action:
          input.action === "granted"
            ? "role_assigner_granted"
            : "role_assigner_withdrawn",
        actorUserId: actor.userId,
        createdAt: operationCreatedAt,
        id: auditId,
        targetUserId: input.targetUserId,
      }),
      requiredRoleAssignerWrites(
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
    const committed = await findRoleAssignerChange(
      headers,
      actor.userId,
      input.operationKey
    );
    if (committed) {
      return {
        created: false,
        receipt: matchingRoleAssignerChange(committed, requestHash),
      };
    }
    await revalidateRoleAssignerAfterFailure(headers, db, input);
    throw error;
  }

  const committed = await findRoleAssignerChange(
    headers,
    actor.userId,
    input.operationKey
  );
  if (!committed) {
    throw new Error("Committed Role Assigner change has no receipt");
  }
  return {
    created: true,
    receipt: matchingRoleAssignerChange(committed, requestHash),
  };
};

export const reconcileRoleAssignerChange = async (
  headers: Headers,
  operationKey: string
): Promise<RoleAssignerReceipt | null> => {
  const actor = await requireGlobalRoleAdmin(headers);
  const row = await findRoleAssignerChange(headers, actor.userId, operationKey);
  return row?.role === "role_assigner" && row.resultingGlobalRole === null
    ? matchingRoleAssignerChange(row, row.requestHash)
    : null;
};

export const parseRoleAssignerChange = async (request: Request) => {
  const parsed = roleAssignerChangeSchema.safeParse(
    await readBoundedJson(request)
  );
  if (!parsed.success) {
    throw new BusinessApiError(
      400,
      "validation_error",
      "角色委派資料格式不正確。"
    );
  }
  return parsed.data;
};

export const parseRoleAssignerReconciliation = async (request: Request) => {
  const parsed = roleAssignerReconciliationSchema.safeParse(
    await readBoundedJson(request)
  );
  if (!parsed.success) {
    throw new BusinessApiError(400, "validation_error", "操作代碼格式不正確。");
  }
  return parsed.data;
};
