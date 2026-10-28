import { and, eq, exists, isNull, not, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import type { Database } from "../../server/db/client";
import { auditEvent } from "../../server/db/schema/applications";
import { user } from "../../server/db/schema/auth";
import {
  roleAssignerAssignment,
  roleAssignmentHistory,
} from "../../server/db/schema/roles";

export const ROLE_SCOPE_ID = "global";
export const ROLE_SCOPE_NAME = "全域角色";

export interface StaffExitCleanupPlan {
  assignmentId: string | null;
  auditId: string | null;
  historyId: string | null;
}

export const prepareStaffExitCleanup = async (
  db: Database,
  targetUserId: string
): Promise<StaffExitCleanupPlan> => {
  const assignment = await db
    .select({ id: roleAssignerAssignment.id })
    .from(roleAssignerAssignment)
    .where(eq(roleAssignerAssignment.userId, targetUserId))
    .limit(1)
    .get();
  if (!assignment) {
    return { assignmentId: null, auditId: null, historyId: null };
  }
  return {
    assignmentId: assignment.id,
    auditId: crypto.randomUUID(),
    historyId: crypto.randomUUID(),
  };
};

type StaffExitBatchItem = Parameters<Database["batch"]>[0][number];

/** Add these writes to the caller's Global-role batch; never execute them alone. */
export const staffExitCleanupWrites = (
  db: Database,
  actorUserId: string,
  targetUserId: string,
  plan: StaffExitCleanupPlan,
  createdAt: SQL
): StaffExitBatchItem[] => {
  if (!plan.assignmentId || !plan.auditId || !plan.historyId) {
    return [];
  }
  return [
    db
      .delete(roleAssignerAssignment)
      .where(
        and(
          eq(roleAssignerAssignment.id, plan.assignmentId),
          eq(roleAssignerAssignment.userId, targetUserId)
        )
      ),
    db.insert(roleAssignmentHistory).values({
      action: "withdrawn",
      actorUserId,
      createdAt,
      id: plan.historyId,
      role: "role_assigner",
      scopeId: ROLE_SCOPE_ID,
      scopeName: ROLE_SCOPE_NAME,
      targetUserId,
    }),
    db.insert(auditEvent).values({
      action: "role_assigner_withdrawn",
      actorUserId,
      createdAt,
      id: plan.auditId,
      targetUserId,
    }),
  ];
};

/** Require exact cleanup and its durable records in the same caller batch. */
export const staffExitCleanupWrittenAssertion = (
  db: Database,
  actorUserId: string,
  targetUserId: string,
  plan: StaffExitCleanupPlan
) => {
  const assignmentRemoved = not(
    exists(
      db
        .select({ present: sql`1` })
        .from(roleAssignerAssignment)
        .where(eq(roleAssignerAssignment.userId, targetUserId))
    )
  );
  const recordsWritten =
    plan.assignmentId && plan.auditId && plan.historyId
      ? and(
          exists(
            db
              .select({ present: sql`1` })
              .from(roleAssignmentHistory)
              .where(
                and(
                  eq(roleAssignmentHistory.id, plan.historyId),
                  eq(roleAssignmentHistory.actorUserId, actorUserId),
                  eq(roleAssignmentHistory.targetUserId, targetUserId),
                  eq(roleAssignmentHistory.action, "withdrawn"),
                  eq(roleAssignmentHistory.role, "role_assigner"),
                  isNull(roleAssignmentHistory.resultingGlobalRole),
                  eq(roleAssignmentHistory.scopeId, ROLE_SCOPE_ID)
                )
              )
          ),
          exists(
            db
              .select({ present: sql`1` })
              .from(auditEvent)
              .where(
                and(
                  eq(auditEvent.id, plan.auditId),
                  eq(auditEvent.actorUserId, actorUserId),
                  eq(auditEvent.targetUserId, targetUserId),
                  eq(auditEvent.action, "role_assigner_withdrawn")
                )
              )
          )
        )
      : sql`1`;
  return db
    .select({
      complete: sql`json(CASE WHEN ${and(assignmentRemoved, recordsWritten)} THEN 'null' ELSE 'Incomplete Staff Role Assigner cleanup' END)`,
    })
    .from(user)
    .where(eq(user.id, targetUserId))
    .limit(1);
};
