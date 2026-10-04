import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const staffAccountActionValues = [
  "assisted_account_created",
  "staff_password_reset",
  "temporary_password_reissued",
] as const;

/** Retained credential handover/reissue outcomes contain no recoverable password. */
export const staffAccountOperation = sqliteTable(
  "staff_account_operation",
  {
    action: text("action", { enum: staffAccountActionValues }).notNull(),
    actorCredentialRevision: integer("actor_credential_revision").notNull(),
    actorSessionId: text("actor_session_id").notNull(),
    actorUserId: text("actor_user_id").notNull(),
    confirmationOperationId: text("confirmation_operation_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    id: text("id").primaryKey(),
    identityCheck: text("identity_check", {
      enum: ["face_to_face", "verified_phone"],
    }).notNull(),
    operationKey: text("operation_key").notNull(),
    requestHash: text("request_hash").notNull(),
    targetCredentialRevision: integer("target_credential_revision").notNull(),
    targetUserId: text("target_user_id").notNull(),
  },
  (table) => [
    uniqueIndex("staff_account_operation_key_unique").on(
      table.actorUserId,
      table.operationKey
    ),
    index("staff_account_operation_target_idx").on(table.targetUserId),
    check(
      "staff_account_operation_action_check",
      sql`"action" in ('assisted_account_created','staff_password_reset','temporary_password_reissued')`
    ),
    check(
      "staff_account_operation_identity_check",
      sql`"identity_check" in ('face_to_face','verified_phone')`
    ),
  ]
);
