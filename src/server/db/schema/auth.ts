import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * Native Better Auth tables for the enabled Username credential engine.
 * Column keys follow Better Auth's default field names; SQL names stay
 * snake_case. Regenerate with the Better Auth CLI when plugins change.
 */
export const user = sqliteTable(
  "user",
  {
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    displayUsername: text("display_username"),
    email: text("email").notNull().unique(),
    emailVerified: integer("email_verified", { mode: "boolean" })
      .notNull()
      .default(false),
    id: text("id").primaryKey(),
    image: text("image"),
    name: text("name").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
    username: text("username").unique(),
  },
  (table) => [
    uniqueIndex("user_email_canonical_unique_idx").on(
      sql`lower(trim(${table.email}))`
    ),
  ]
);

export const session = sqliteTable(
  "session",
  {
    confirmationOperationId: text("confirmation_operation_id"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    credentialRevision: integer("credential_revision").notNull().default(0),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    id: text("id").primaryKey(),
    ipAddress: text("ip_address"),
    passwordConfirmedAt: integer("password_confirmed_at", {
      mode: "timestamp",
    }),
    token: text("token").notNull().unique(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_user_id_idx").on(table.userId)]
);

export const account = sqliteTable(
  "account",
  {
    accessToken: text("access_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", {
      mode: "timestamp",
    }),
    accountId: text("account_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    credentialRevision: integer("credential_revision").notNull().default(0),
    id: text("id").primaryKey(),
    idToken: text("id_token"),
    password: text("password"),
    providerId: text("provider_id").notNull(),
    refreshToken: text("refresh_token"),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", {
      mode: "timestamp",
    }),
    scope: text("scope"),
    temporaryPasswordExpiresAt: integer("temporary_password_expires_at", {
      mode: "timestamp",
    }),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("account_user_id_idx").on(table.userId)]
);

export const verification = sqliteTable(
  "verification",
  {
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
    value: text("value").notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)]
);

/** Database-backed sign-in rate limiter storage (`rateLimit.storage: "database"`). */
export const rateLimit = sqliteTable("rate_limit", {
  count: integer("count").notNull(),
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  lastRequest: integer("last_request", { mode: "number" }).notNull(),
});
