import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/** Retained own-application operations; authentication deletion must not erase history. */
export const applicantOperation = sqliteTable(
  "applicant_operation",
  {
    action: text("action", {
      enum: [
        "application_corrected",
        "application_withdrawn",
        "application_resubmitted",
      ],
    }).notNull(),
    applicationId: text("application_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    id: text("id").primaryKey(),
    operationKey: text("operation_key").notNull(),
    requestHash: text("request_hash").notNull(),
    userId: text("user_id").notNull(),
  },
  (table) => [
    uniqueIndex("applicant_operation_key_unique").on(
      table.userId,
      table.operationKey
    ),
    index("applicant_operation_user_idx").on(table.userId),
    check(
      "applicant_operation_action_check",
      sql`action in ('application_corrected','application_withdrawn','application_resubmitted')`
    ),
  ]
);
