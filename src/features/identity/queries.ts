import { eq } from "drizzle-orm";

import type { Database } from "../../server/db/client";
import { user } from "../../server/db/schema/auth";
import type { MembershipStatus } from "../../server/db/schema/identity";
import { personProfile } from "../../server/db/schema/identity";

export interface PersonIdentity {
  userId: string;
  displayName: string;
  username: string | null;
  membershipStatus: MembershipStatus;
  banned: boolean;
}

/**
 * The current person's own persisted identity, derived from a validated
 * session identity. Never accepts a client-supplied account.
 */
export const getPersonIdentity = async (
  db: Database,
  userId: string
): Promise<PersonIdentity | null> => {
  const [row] = await db
    .select({
      bannedAt: personProfile.bannedAt,
      membershipStatus: personProfile.membershipStatus,
      name: user.name,
      userId: user.id,
      username: user.displayUsername,
    })
    .from(user)
    .innerJoin(personProfile, eq(personProfile.userId, user.id))
    .where(eq(user.id, userId))
    .limit(1);

  if (!row) {
    return null;
  }
  return {
    banned: row.bannedAt !== null,
    displayName: row.name,
    membershipStatus: row.membershipStatus,
    userId: row.userId,
    username: row.username,
  };
};
