import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const applicationStatusValues = [
  "pending",
  "rejected",
  "withdrawn",
] as const;

/** Retained account-application history; user ids intentionally have no FK. */
export const membershipApplication = sqliteTable(
  "membership_application",
  {
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    groupNote: text("group_note"),
    id: text("id").primaryKey(),
    intentNote: text("intent_note"),
    operationKeyHash: text("operation_key_hash").notNull().unique(),
    referralNote: text("referral_note"),
    requestHash: text("request_hash").notNull(),
    status: text("status", { enum: applicationStatusValues }).notNull(),
    userId: text("user_id").notNull(),
  },
  (table) => [
    index("membership_application_user_id_idx").on(table.userId),
    check(
      "membership_application_status_check",
      sql`${sql.identifier(table.status.name)} in (${sql.raw(
        applicationStatusValues.map((status) => `'${status}'`).join(", ")
      )})`
    ),
  ]
);

/** Audit identity columns are historical values, never auth-table foreign keys. */
export const auditEvent = sqliteTable(
  "audit_event",
  {
    action: text("action").notNull(),
    actorUserId: text("actor_user_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    id: text("id").primaryKey(),
    targetUserId: text("target_user_id").notNull(),
  },
  (table) => [index("audit_event_target_user_id_idx").on(table.targetUserId)]
);

/** Permanent canonical Username claim; user ids intentionally have no FK. */
export const usernameReservation = sqliteTable("username_reservation", {
  reservedAt: integer("reserved_at", { mode: "timestamp" }).notNull(),
  userId: text("user_id").notNull(),
  usernameKey: text("username_key").primaryKey(),
});
