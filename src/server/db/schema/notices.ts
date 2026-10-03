import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/sqlite-core";

import { department } from "./activities";
import { user } from "./auth";

export const noticeScopeValues = ["church", "department", "program"] as const;
export type NoticeScope = (typeof noticeScopeValues)[number];

/**
 * A church notice with an explicit publication/expiry window and a scope.
 * `scopeId` references a Department or Program row depending on `scopeType`
 * (null for church-wide). SQL checks enforce the kind/target shape; existence
 * of the polymorphic target remains owned by the notice writer, not a foreign key.
 */
export const notice = sqliteTable(
  "notice",
  {
    body: text("body").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }),
    id: text("id").primaryKey(),
    publishedAt: integer("published_at", { mode: "timestamp" }),
    scopeId: text("scope_id"),
    scopeType: text("scope_type", { enum: noticeScopeValues }).notNull(),
    title: text("title").notNull(),
  },
  (table) => [
    index("notice_scope_idx").on(table.scopeType, table.scopeId),
    check(
      "notice_scope_type_check",
      sql`${sql.identifier(table.scopeType.name)} in (${sql.raw(noticeScopeValues.map((scope) => `'${scope}'`).join(", "))})`
    ),
    check(
      "notice_scope_target_check",
      sql`(${sql.identifier(table.scopeType.name)} = 'church' and ${sql.identifier(table.scopeId.name)} is null) or (${sql.identifier(table.scopeType.name)} in ('department', 'program') and ${sql.identifier(table.scopeId.name)} is not null and length(${sql.identifier(table.scopeId.name)}) > 0)`
    ),
  ]
);

/** Department membership: separate from Program enrolment and from assignments. */
export const departmentMembership = sqliteTable(
  "department_membership",
  {
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    departmentId: text("department_id")
      .notNull()
      .references(() => department.id, { onDelete: "cascade" }),
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("department_membership_user_id_idx").on(table.userId),
    uniqueIndex("department_membership_unique").on(
      table.departmentId,
      table.userId
    ),
  ]
);

/**
 * A current Department Manager assignment. It grants notice visibility for the
 * department without requiring Department membership.
 */
export const departmentManagerAssignment = sqliteTable(
  "department_manager_assignment",
  {
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    departmentId: text("department_id")
      .notNull()
      .references(() => department.id, { onDelete: "cascade" }),
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("department_manager_assignment_user_id_idx").on(table.userId),
    uniqueIndex("department_manager_assignment_unique").on(
      table.departmentId,
      table.userId
    ),
  ]
);
