import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const accountChangeActions = [
  "own_phone_changed",
  "staff_identity_corrected",
  "staff_shared_phone_corrected",
  "account_banned",
  "account_unbanned",
  "membership_deactivated",
  "membership_reactivated",
  "account_deleted",
] as const;
/** Retained account changes contain identifiers and fingerprints, never credential material. */
export const accountChangeOperation = sqliteTable(
  "account_change_operation",
  {
    action: text("action", { enum: accountChangeActions }).notNull(),
    actorUserId: text("actor_user_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    id: text("id").primaryKey(),
    identityCheck: text("identity_check", {
      enum: ["face_to_face", "verified_phone"],
    }),
    operationKey: text("operation_key").notNull(),
    requestHash: text("request_hash").notNull(),
    targetUserId: text("target_user_id").notNull(),
  },
  (table) => [
    uniqueIndex("account_change_operation_key_unique").on(
      table.actorUserId,
      table.operationKey
    ),
    index("account_change_operation_target_idx").on(table.targetUserId),
    check(
      "account_change_operation_action_check",
      sql`action in (${sql.raw(accountChangeActions.map((action) => `'${action}'`).join(", "))})`
    ),
  ]
);
