import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const accountSecurityActionValues = [
  "password_changed",
  "other_sessions_revoked",
  "password_confirmed",
] as const;

/** Immutable own-account operation receipts; historical ids have no auth FK. */
export const accountSecurityOperation = sqliteTable(
  "account_security_operation",
  {
    action: text("action", { enum: accountSecurityActionValues }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    credentialRevision: integer("credential_revision").notNull(),
    id: text("id").primaryKey(),
    operationKey: text("operation_key").notNull(),
    requestHash: text("request_hash").notNull(),
    sessionId: text("session_id").notNull(),
    userId: text("user_id").notNull(),
  },
  (table) => [
    uniqueIndex("account_security_operation_key_unique").on(
      table.userId,
      table.operationKey
    ),
    index("account_security_operation_user_idx").on(table.userId),
    check(
      "account_security_operation_action_check",
      sql`"action" in ('password_changed', 'other_sessions_revoked', 'password_confirmed')`
    ),
  ]
);
