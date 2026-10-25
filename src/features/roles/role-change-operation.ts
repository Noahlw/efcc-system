import { and, eq } from "drizzle-orm";

import type { Database } from "../../server/db/client";
import { roleChangeOperation } from "../../server/db/schema/roles";

/** Resolve the actor-wide idempotency key before a role-specific fingerprint. */
export const findRoleChangeOperation = (
  db: Database,
  actorUserId: string,
  operationKey: string
) =>
  db
    .select({
      action: roleChangeOperation.action,
      actorUserId: roleChangeOperation.actorUserId,
      createdAt: roleChangeOperation.createdAt,
      id: roleChangeOperation.id,
      operationKey: roleChangeOperation.operationKey,
      requestHash: roleChangeOperation.requestHash,
      resultingGlobalRole: roleChangeOperation.resultingGlobalRole,
      role: roleChangeOperation.role,
      scopeId: roleChangeOperation.scopeId,
      scopeName: roleChangeOperation.scopeName,
      targetUserId: roleChangeOperation.targetUserId,
    })
    .from(roleChangeOperation)
    .where(
      and(
        eq(roleChangeOperation.actorUserId, actorUserId),
        eq(roleChangeOperation.operationKey, operationKey)
      )
    )
    .limit(1)
    .get();
