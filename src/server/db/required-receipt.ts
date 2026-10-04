import { env } from "cloudflare:workers";

/** A SELECT cannot be skipped by an INSERT trigger's RAISE(IGNORE).
 * Invalid JSON deliberately fails inside the D1 batch, rolling it all back. */
export const requireWrittenReceipt = (
  table:
    | "membership_application"
    | "application_decision"
    | "account_security_operation"
    | "staff_account_operation",
  id: string
) =>
  env.DB.prepare(`SELECT json(CASE WHEN EXISTS(SELECT 1 FROM ${table} WHERE id=?)
 THEN 'null' ELSE 'Missing required receipt' END) AS complete`).bind(id);
