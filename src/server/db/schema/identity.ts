import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

import { user } from "./auth";

export const membershipStatusValues = [
  "pending",
  "active",
  "deactivated",
] as const;
export type MembershipStatus = (typeof membershipStatusValues)[number];

/**
 * EFCC business access state for an account.
 * Authentication (Better Auth) and business access (this table) are separate:
 * a pending or banned person may sign in but must not reach business data.
 */
export const personProfile = sqliteTable(
  "person_profile",
  {
    /** Set while a security ban applies; clearing it must not change membership. */
    bannedAt: integer("banned_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    membershipStatus: text("membership_status", {
      enum: membershipStatusValues,
    }).notNull(),
    /**
     * Canonical matching key for the person's full Chinese name (trim,
     * full-width→half-width, Latin case). Deliberately non-unique: several
     * accounts may legitimately share a name. The display form stays in
     * Better Auth's user record.
     */
    nameLookupKey: text("name_lookup_key"),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("person_profile_membership_status_idx").on(table.membershipStatus),
    index("person_profile_name_lookup_key_idx").on(table.nameLookupKey),
  ]
);
