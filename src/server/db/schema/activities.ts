import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/sqlite-core";

import { user } from "./auth";

export const enrolmentStatusValues = [
  "pending",
  "waitlisted",
  "approved",
  "rejected",
  "withdrawn",
  "cancelled",
] as const;
export type EnrolmentStatus = (typeof enrolmentStatusValues)[number];

export const invitationStateValues = ["valid", "revoked"] as const;
export type InvitationState = (typeof invitationStateValues)[number];

/** A church organisational unit containing Programs. */
export const department = sqliteTable("department", {
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  id: text("id").primaryKey(),
  name: text("name").notNull(),
});

/** A church activity belonging to one Department; it owns enrolment and Events. */
export const program = sqliteTable(
  "program",
  {
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    departmentId: text("department_id")
      .notNull()
      .references(() => department.id, { onDelete: "cascade" }),
    id: text("id").primaryKey(),
    name: text("name").notNull(),
  },
  (table) => [index("program_department_id_idx").on(table.departmentId)]
);

/** A dated occurrence within a Program. */
export const programEvent = sqliteTable(
  "program_event",
  {
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    endsAt: integer("ends_at", { mode: "timestamp" }),
    id: text("id").primaryKey(),
    programId: text("program_id")
      .notNull()
      .references(() => program.id, { onDelete: "cascade" }),
    startsAt: integer("starts_at", { mode: "timestamp" }).notNull(),
    title: text("title").notNull(),
  },
  (table) => [
    index("program_event_program_id_idx").on(table.programId),
    index("program_event_starts_at_idx").on(table.startsAt),
  ]
);

/** A person's participation state in a Program. */
export const enrolment = sqliteTable(
  "enrolment",
  {
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    id: text("id").primaryKey(),
    programId: text("program_id")
      .notNull()
      .references(() => program.id, { onDelete: "cascade" }),
    status: text("status", { enum: enrolmentStatusValues }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("enrolment_user_id_idx").on(table.userId),
    check(
      "enrolment_status_check",
      sql`${sql.identifier(table.status.name)} in (${sql.raw(enrolmentStatusValues.map((status) => `'${status}'`).join(", "))})`
    ),
    uniqueIndex("enrolment_program_user_unique").on(
      table.programId,
      table.userId
    ),
  ]
);

/** An invitation for a person to a Program; validity also depends on expiry. */
export const invitation = sqliteTable(
  "invitation",
  {
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    id: text("id").primaryKey(),
    programId: text("program_id")
      .notNull()
      .references(() => program.id, { onDelete: "cascade" }),
    state: text("state", { enum: invitationStateValues }).notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("invitation_user_id_idx").on(table.userId),
    check(
      "invitation_state_check",
      sql`${sql.identifier(table.state.name)} in (${sql.raw(invitationStateValues.map((state) => `'${state}'`).join(", "))})`
    ),
    uniqueIndex("invitation_program_user_unique").on(
      table.programId,
      table.userId
    ),
  ]
);
