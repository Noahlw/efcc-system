import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const applicationStatusValues = [
  "pending",
  "approved",
  "rejected",
  "withdrawn",
] as const;

/** Retained account-application history; user ids intentionally have no FK. */
export const membershipApplication = sqliteTable(
  "membership_application",
  {
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    decisionId: text("decision_id"),
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

/** Immutable decisions survive auth/account deletion and form the private inbox. */
export const applicationDecision = sqliteTable(
  "application_decision",
  {
    actorUserId: text("actor_user_id").notNull(),
    applicationId: text("application_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    id: text("id").primaryKey(),
    internalNote: text("internal_note"),
    operationKey: text("operation_key").notNull(),
    outcome: text("outcome", { enum: ["approved", "rejected"] }).notNull(),
    requestHash: text("request_hash").notNull(),
    targetUserId: text("target_user_id").notNull(),
    visibleReason: text("visible_reason"),
  },
  (table) => [
    uniqueIndex("application_decision_application_unique").on(
      table.applicationId
    ),
    uniqueIndex("application_decision_operation_unique").on(
      table.actorUserId,
      table.operationKey
    ),
    index("application_decision_target_idx").on(table.targetUserId),
    check(
      "application_decision_outcome_check",
      sql`"outcome" in ('approved', 'rejected')`
    ),
    check(
      "application_decision_reason_check",
      sql`"outcome" <> 'rejected' or ("visible_reason" is not null and length(trim("visible_reason")) > 0)`
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
