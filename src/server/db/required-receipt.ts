import { env } from "cloudflare:workers";
import { sql } from "drizzle-orm";

import type { Database } from "./client";
import { schema } from "./client";

const receiptTables = {
  account_security_operation: schema.accountSecurityOperation,
  application_decision: schema.applicationDecision,
  membership_application: schema.membershipApplication,
  staff_account_operation: schema.staffAccountOperation,
} as const;

export type ReceiptTable = keyof typeof receiptTables;

export interface WrittenReceipt {
  table: ReceiptTable;
  id: string;
}

/** Native D1 batch item retained for callers not yet migrated to Drizzle. */
export const requireWrittenReceipt = (table: ReceiptTable, id: string) =>
  env.DB.prepare(`SELECT json(CASE WHEN EXISTS(SELECT 1 FROM ${table} WHERE id=?)
 THEN 'null' ELSE 'Missing required receipt' END) AS complete`).bind(id);

/**
 * Lazy Drizzle batch item. Invalid JSON deliberately aborts and rolls back the
 * batch when a required receipt insert was ignored.
 */
export const requireDrizzleWrittenReceipt = (
  db: Database,
  { table, id }: WrittenReceipt
) => {
  const receiptTable = receiptTables[table];
  return db
    .select({
      complete: sql`json(CASE WHEN EXISTS(
        SELECT 1 FROM ${receiptTable} WHERE ${receiptTable.id} = ${id}
      ) THEN 'null' ELSE 'Missing required receipt' END)`,
    })
    .from(schema.user)
    .limit(1);
};
