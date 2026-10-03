import { and, eq, isNotNull } from "drizzle-orm";

import type { Database } from "../../server/db/client";
import { account, user } from "../../server/db/schema/auth";
import { personProfile } from "../../server/db/schema/identity";
import { canonicalNameKey } from "./name-matching";

export type NameResolution =
  | { status: "ok"; username: string }
  | { status: "ambiguous" }
  | { status: "not_found" };

/**
 * Resolves a full Chinese name to exactly one credential-bearing account.
 * Names may legitimately collide, so this never picks a first match: more than
 * one match is reported as ambiguous. Membership/ban state is deliberately not
 * filtered here — those are business-access states, not credential rules.
 */
export const resolveUsernameByFullName = async (
  db: Database,
  fullName: string
): Promise<NameResolution> => {
  const key = canonicalNameKey(fullName);
  if (key.length === 0) {
    return { status: "not_found" };
  }

  const rows = await db
    .selectDistinct({ username: user.username })
    .from(personProfile)
    .innerJoin(user, eq(user.id, personProfile.userId))
    .innerJoin(
      account,
      and(eq(account.userId, user.id), eq(account.providerId, "credential"))
    )
    .where(and(eq(personProfile.nameLookupKey, key), isNotNull(user.username)))
    .limit(2);

  if (rows.length === 0) {
    return { status: "not_found" };
  }
  if (rows.length > 1) {
    return { status: "ambiguous" };
  }
  const username = rows[0]?.username;
  return username ? { status: "ok", username } : { status: "not_found" };
};
