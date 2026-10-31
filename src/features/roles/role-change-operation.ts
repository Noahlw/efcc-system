import { and, eq } from "drizzle-orm";
import * as z from "zod";

import type { Database } from "../../server/db/client";
import { roleChangeOperation } from "../../server/db/schema/roles";

const commonOperation = {
  actorUserId: z.string(),
  createdAt: z.date(),
  id: z.string(),
  operationKey: z.string(),
  requestHash: z.string(),
};

const operationSchema = z.discriminatedUnion("commandFamily", [
  z.strictObject({
    ...commonOperation,
    action: z.enum(["granted", "withdrawn"]),
    aggregateResult: z.null(),
    authorityKind: z.literal("department_manager").nullable(),
    commandFamily: z.literal("single"),
    resultingGlobalRole: z.enum(["member", "staff", "admin"]).nullable(),
    role: z.enum([
      "admin",
      "department_manager",
      "program_leader",
      "role_assigner",
      "staff",
    ]),
    scopeId: z.string(),
    scopeName: z.string(),
    targetUserId: z.string(),
  }),
  z.strictObject({
    ...commonOperation,
    action: z.null(),
    aggregateResult: z.string(),
    authorityKind: z.null(),
    commandFamily: z.literal("person_scoped"),
    resultingGlobalRole: z.null(),
    role: z.null(),
    scopeId: z.null(),
    scopeName: z.null(),
    targetUserId: z.string(),
  }),
  z.strictObject({
    ...commonOperation,
    action: z.literal("granted"),
    aggregateResult: z.string(),
    authorityKind: z.enum(["admin", "role_assigner", "department_manager"]),
    commandFamily: z.literal("program_grants"),
    resultingGlobalRole: z.null(),
    role: z.literal("program_leader"),
    scopeId: z.string(),
    scopeName: z.string(),
    targetUserId: z.null(),
  }),
]);

/** Resolve the actor-wide idempotency key before a role-specific fingerprint. */
export const findRoleChangeOperation = async (
  db: Database,
  actorUserId: string,
  operationKey: string
) => {
  const row = await db
    .select({
      action: roleChangeOperation.action,
      actorUserId: roleChangeOperation.actorUserId,
      aggregateResult: roleChangeOperation.aggregateResult,
      authorityKind: roleChangeOperation.authorityKind,
      commandFamily: roleChangeOperation.commandFamily,
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
  return row ? operationSchema.parse(row) : null;
};
