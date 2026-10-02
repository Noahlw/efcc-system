import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { department } from "./activities";
import { user } from "./auth";

export const noticeScopeValues = ["church", "department", "program"] as const;
export type NoticeScope = (typeof noticeScopeValues)[number];

/**
 * A church notice with an explicit publication/expiry window and a scope.
 * `scopeId` references a Department or Program row depending on `scopeType`
 * (null for church-wide): the polymorphic target is validated by the write
 * path that owns notice authoring, not by a foreign key.
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
  (table) => [index("notice_scope_idx").on(table.scopeType, table.scopeId)]
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
