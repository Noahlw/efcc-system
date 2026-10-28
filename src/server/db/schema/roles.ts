import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { accountRoleValues } from "./identity";

export const roleHistoryKinds = [
  "admin",
  "department_manager",
  "program_leader",
  "role_assigner",
  "staff",
] as const;
export type RoleHistoryKind = (typeof roleHistoryKinds)[number];

export type ResultingGlobalRole = (typeof accountRoleValues)[number];

export const roleAssignmentActions = ["granted", "withdrawn"] as const;
export type RoleAssignmentAction = (typeof roleAssignmentActions)[number];

/** Retained role history, also projected as the recipient's Inbox event. */
export const roleAssignmentHistory = sqliteTable(
  "role_assignment_history",
  {
    action: text("action", { enum: roleAssignmentActions }).notNull(),
    actorUserId: text("actor_user_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    id: text("id").primaryKey(),
    resultingGlobalRole: text("resulting_global_role", {
      enum: accountRoleValues,
    }),
    role: text("role", { enum: roleHistoryKinds }).notNull(),
    scopeId: text("scope_id").notNull(),
    scopeName: text("scope_name").notNull(),
    targetUserId: text("target_user_id").notNull(),
  },
  (table) => [
    index("role_assignment_history_recipient_idx").on(
      table.targetUserId,
      table.createdAt,
      table.id
    ),
    index("role_assignment_history_scope_idx").on(
      table.role,
      table.scopeId,
      table.createdAt
    ),
    check(
      "role_assignment_history_action_check",
      sql`${sql.identifier(table.action.name)} in (${sql.raw(
        roleAssignmentActions.map((action) => `'${action}'`).join(", ")
      )})`
    ),
    check(
      "role_assignment_history_role_check",
      sql`${sql.identifier(table.role.name)} in (${sql.raw(
        roleHistoryKinds.map((role) => `'${role}'`).join(", ")
      )})`
    ),
    check(
      "role_assignment_history_global_role_check",
      sql`(${sql.identifier(table.role.name)} in ('staff', 'admin') and ${sql.identifier(table.resultingGlobalRole.name)} is not null and ${sql.identifier(table.resultingGlobalRole.name)} in ('member', 'staff', 'admin')) or (${sql.identifier(table.role.name)} not in ('staff', 'admin') and ${sql.identifier(table.resultingGlobalRole.name)} is null)`
    ),
  ]
);

/** Protected command receipts stay separate from personal Inbox history. */
export const roleChangeOperation = sqliteTable(
  "role_change_operation",
  {
    action: text("action", { enum: roleAssignmentActions }),
    actorUserId: text("actor_user_id").notNull(),
    aggregateResult: text("aggregate_result"),
    commandFamily: text("command_family", {
      enum: ["single", "person_scoped"],
    })
      .notNull()
      .default("single"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    id: text("id").primaryKey(),
    operationKey: text("operation_key").notNull(),
    requestHash: text("request_hash").notNull(),
    resultingGlobalRole: text("resulting_global_role", {
      enum: accountRoleValues,
    }),
    role: text("role", { enum: roleHistoryKinds }),
    scopeId: text("scope_id"),
    scopeName: text("scope_name"),
    targetUserId: text("target_user_id").notNull(),
  },
  (table) => [
    uniqueIndex("role_change_operation_key_unique").on(
      table.actorUserId,
      table.operationKey
    ),
    index("role_change_operation_target_idx").on(table.targetUserId),
    check(
      "role_change_operation_shape_check",
      sql`(
        "command_family" = 'single' and "aggregate_result" is null
        and "action" is not null and "action" in ('granted', 'withdrawn')
        and "role" is not null and "role" in ('admin', 'department_manager', 'program_leader', 'role_assigner', 'staff')
        and "scope_id" is not null and "scope_name" is not null
        and (("role" in ('staff', 'admin') and "resulting_global_role" is not null and "resulting_global_role" in ('member', 'staff', 'admin'))
          or ("role" not in ('staff', 'admin') and "resulting_global_role" is null))
      ) or (
        "command_family" = 'person_scoped' and "aggregate_result" is not null
        and json_valid("aggregate_result")
        and "action" is null and "role" is null
        and "scope_id" is null and "scope_name" is null
        and "resulting_global_role" is null
      )`
    ),
  ]
);

/** Current additive Role Assigner delegation, valid only while the target is Staff. */
export const roleAssignerAssignment = sqliteTable(
  "role_assigner_assignment",
  {
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("role_assigner_assignment_user_unique").on(table.userId),
  ]
);
