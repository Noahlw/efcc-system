import { sql } from "drizzle-orm";

/**
 * Second-resolution conversions for the account domain's integer timestamps.
 * Drizzle stores these columns as unix seconds, so reads convert to `Date`
 * and writes convert back without changing the stored unit.
 */
export const nowSeconds = (): number => Math.floor(Date.now() / 1000);
export const asTimestamp = (seconds: number): Date => new Date(seconds * 1000);

/**
 * The database's own unix-seconds clock. Atomic writers compare authorization
 * deadlines against this so a value captured in JavaScript before hashing or
 * queueing cannot outlive the batch that actually executes.
 */
export const sqliteNowSeconds = sql`CAST(strftime('%s','now') AS INTEGER)`;
