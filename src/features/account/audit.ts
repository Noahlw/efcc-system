import { and, desc, eq, exists, gt, inArray, isNull, sql } from "drizzle-orm";

import { getDb } from "../../server/db/client";
import {
  applicationDecision,
  auditEvent,
} from "../../server/db/schema/applications";
import { session } from "../../server/db/schema/auth";
import { personProfile } from "../../server/db/schema/identity";
import { requireStaff } from "./decisions";

export interface AccountAudit {
  id: string;
  actorUserId: string;
  targetUserId: string;
  action: string;
  createdAt: number;
  internalNote: string | null;
}

export const getAccountAudit = async (
  headers: Headers
): Promise<AccountAudit[]> => {
  const actor = await requireStaff(headers);
  const database = getDb();
  const rows = await database
    .select({
      action: auditEvent.action,
      actorUserId: auditEvent.actorUserId,
      createdAt: auditEvent.createdAt,
      id: auditEvent.id,
      internalNote: applicationDecision.internalNote,
      targetUserId: auditEvent.targetUserId,
    })
    .from(auditEvent)
    .leftJoin(applicationDecision, eq(applicationDecision.id, auditEvent.id))
    .where(
      exists(
        database
          .select({ one: sql`1` })
          .from(session)
          .innerJoin(personProfile, eq(personProfile.userId, session.userId))
          .where(
            and(
              eq(session.id, actor.sessionId),
              eq(session.userId, actor.userId),
              gt(session.expiresAt, new Date()),
              eq(personProfile.membershipStatus, "active"),
              isNull(personProfile.bannedAt),
              inArray(personProfile.accountRole, ["staff", "admin"])
            )
          )
      )
    )
    .orderBy(desc(auditEvent.createdAt), desc(auditEvent.id));
  return rows.map((row) => ({
    ...row,
    /** Stored as second-resolution Unix time by the audit writers. */
    createdAt: Math.floor(row.createdAt.getTime() / 1000),
  }));
};
