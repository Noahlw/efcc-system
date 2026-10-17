import { and, eq, exists, isNull, sql } from "drizzle-orm";

import { getDb } from "../../server/db/client";
import type { Database } from "../../server/db/client";
import { user } from "../../server/db/schema/auth";
import { personProfile } from "../../server/db/schema/identity";
import { staffSearchKey } from "./staff-search-contract";

/** Runs inside the identity owner's existing native atomic batch. */
export const staffSearchWrittenAssertion = (
  database: Database,
  userId: string,
  fullName: string,
  username: string | null
) =>
  database
    .select({
      complete: sql`json(CASE WHEN ${exists(
        database
          .select({ id: personProfile.userId })
          .from(personProfile)
          .innerJoin(user, eq(user.id, personProfile.userId))
          .where(
            and(
              eq(personProfile.userId, userId),
              eq(user.name, fullName),
              sql`${user.displayUsername} IS ${username}`,
              eq(
                personProfile.staffSearchKey,
                staffSearchKey(fullName, username)
              )
            )
          )
      )} THEN 'null' ELSE 'Incomplete Staff search projection' END)`,
    })
    .from(user)
    .limit(1);

export const staffSearchBackfillUpdate = (
  database: Database,
  {
    fullName,
    userId,
    username,
  }: { fullName: string; userId: string; username: string | null }
) =>
  database
    .update(personProfile)
    .set({ staffSearchKey: staffSearchKey(fullName, username) })
    .where(
      and(
        eq(personProfile.userId, userId),
        isNull(personProfile.staffSearchKey),
        exists(
          database
            .select({ id: user.id })
            .from(user)
            .where(
              and(
                eq(user.id, userId),
                eq(user.name, fullName),
                sql`${user.displayUsername} IS ${username}`
              )
            )
        )
      )
    );

/** Bounded, restartable maintenance on the app-bound D1; no auth-key changes. */
export const backfillStaffSearchProjectionBatch = async (): Promise<{
  attempted: number;
  complete: boolean;
}> => {
  const database = getDb();
  const rows = await database
    .select({
      fullName: user.name,
      userId: user.id,
      username: user.displayUsername,
    })
    .from(user)
    .innerJoin(personProfile, eq(personProfile.userId, user.id))
    .where(isNull(personProfile.staffSearchKey))
    .orderBy(user.id)
    .limit(20)
    .all();
  const statements = rows.map((row) =>
    staffSearchBackfillUpdate(database, row)
  );
  const [firstStatement, ...remainingStatements] = statements;
  if (firstStatement) {
    await database.batch([firstStatement, ...remainingStatements]);
  }
  const remaining = await database
    .select({ id: personProfile.userId })
    .from(personProfile)
    .where(isNull(personProfile.staffSearchKey))
    .limit(1)
    .get();
  return { attempted: rows.length, complete: remaining === undefined };
};
