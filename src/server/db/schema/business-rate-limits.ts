import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** EFCC request quotas; kept separate from Better Auth's native limiter rows. */
export const businessRateLimit = sqliteTable("business_rate_limit", {
  count: integer("count").notNull(),
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  lastRequest: integer("last_request", { mode: "number" }).notNull(),
});
