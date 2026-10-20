import {
  and,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  isNull,
  ne,
  sql,
} from "drizzle-orm";

import { getDb } from "../../../server/db/client";
import type { Database } from "../../../server/db/client";
import {
  applicationDecision,
  auditEvent,
} from "../../../server/db/schema/applications";
import { account, session } from "../../../server/db/schema/auth";
import { personProfile } from "../../../server/db/schema/identity";
import { requireStaff } from "../account-actors";
import type { AccountActor } from "../account-actors";
import { BusinessApiError } from "../business-request";
import { dateToUnixSeconds } from "../timestamps";

const ACCOUNT_AUDIT_PAGE_SIZE = 25;

export interface AccountAudit {
  id: string;
  actorUserId: string;
  targetUserId: string;
  action: string;
  createdAt: number;
  internalNote: string | null;
}

export interface AccountAuditPage {
  events: (Omit<AccountAudit, "internalNote"> & { hasInternalNote: boolean })[];
  page: { hasNext: boolean; hasPrevious: boolean; number: number };
  selectedEvent: AccountAudit | null;
}

const auditPageNumber = (
  positions: readonly string[] | string | undefined
): number => {
  let position: string | undefined;
  if (typeof positions === "string") {
    position = positions;
  } else if (positions?.length === 1) {
    [position] = positions;
  }
  if (!position || !/^[1-9]\d*$/u.test(position)) {
    return 1;
  }
  const page = Number(position);
  const offset = (page - 1) * ACCOUNT_AUDIT_PAGE_SIZE;
  return Number.isSafeInteger(page) && Number.isSafeInteger(offset) ? page : 1;
};

/** Re-check authority inside each audit read as well as before entering it. */
const activeStaffExists = (database: Database, actor: AccountActor) =>
  exists(
    database
      .select({ one: sql`1` })
      .from(session)
      .innerJoin(
        account,
        and(
          eq(account.userId, session.userId),
          eq(account.accountId, session.userId),
          eq(account.providerId, "credential"),
          isNotNull(account.password),
          ne(account.password, ""),
          isNull(account.temporaryPasswordExpiresAt),
          eq(account.credentialRevision, session.credentialRevision)
        )
      )
      .innerJoin(personProfile, eq(personProfile.userId, session.userId))
      .where(
        and(
          eq(session.id, actor.sessionId),
          eq(session.userId, actor.userId),
          gt(session.expiresAt, sql`unixepoch()`),
          eq(personProfile.membershipStatus, "active"),
          isNull(personProfile.bannedAt),
          inArray(personProfile.accountRole, ["staff", "admin"])
        )
      )
  );

const auditProjection = (database: Database) =>
  database
    .select({
      action: auditEvent.action,
      actorUserId: auditEvent.actorUserId,
      createdAt: auditEvent.createdAt,
      id: auditEvent.id,
      internalNote: applicationDecision.internalNote,
      targetUserId: auditEvent.targetUserId,
    })
    .from(auditEvent)
    .leftJoin(applicationDecision, eq(applicationDecision.id, auditEvent.id));

/** The list never selects the private body; only authorized detail may read it. */
const auditListProjection = (database: Database) =>
  database
    .select({
      action: auditEvent.action,
      actorUserId: auditEvent.actorUserId,
      createdAt: auditEvent.createdAt,
      hasInternalNote:
        sql<boolean>`coalesce(length(${applicationDecision.internalNote}), 0) > 0`
          .mapWith(Boolean)
          .as("has_internal_note"),
      id: auditEvent.id,
      targetUserId: auditEvent.targetUserId,
    })
    .from(auditEvent)
    .leftJoin(applicationDecision, eq(applicationDecision.id, auditEvent.id));

const projectAuditEvent = (
  row: Omit<AccountAudit, "createdAt"> & { createdAt: Date }
) => ({
  ...row,
  /** Stored as second-resolution Unix time by the audit writers. */
  createdAt: dateToUnixSeconds(row.createdAt),
});

export const getAccountAudit = async (
  headers: Headers,
  requestedPage?: readonly string[] | string,
  selectedRecordId?: string
): Promise<AccountAuditPage> => {
  const actor = await requireStaff(headers);
  const database = getDb();
  let pageNumber = auditPageNumber(requestedPage);

  const readPage = async (number: number) => {
    const offset = (number - 1) * ACCOUNT_AUDIT_PAGE_SIZE;
    const pageEvents = auditListProjection(database)
      .where(activeStaffExists(database, actor))
      .orderBy(desc(auditEvent.createdAt), desc(auditEvent.id))
      .limit(ACCOUNT_AUDIT_PAGE_SIZE)
      .offset(offset)
      .as("account_audit_page");
    const nextEvent = database
      .select({ id: auditEvent.id })
      .from(auditEvent)
      .where(activeStaffExists(database, actor))
      .orderBy(desc(auditEvent.createdAt), desc(auditEvent.id))
      .limit(1)
      .offset(offset + ACCOUNT_AUDIT_PAGE_SIZE);
    const rows = await database
      .select({
        action: pageEvents.action,
        actorUserId: pageEvents.actorUserId,
        createdAt: pageEvents.createdAt,
        hasInternalNote: pageEvents.hasInternalNote,
        hasNext: exists(nextEvent),
        id: pageEvents.id,
        targetUserId: pageEvents.targetUserId,
      })
      .from(session)
      .innerJoin(personProfile, eq(personProfile.userId, session.userId))
      .leftJoin(pageEvents, sql`1 = 1`)
      .where(
        and(eq(session.id, actor.sessionId), activeStaffExists(database, actor))
      )
      .orderBy(desc(pageEvents.createdAt), desc(pageEvents.id));
    const [firstRow] = rows;
    if (!firstRow) {
      await requireStaff(headers);
      throw new BusinessApiError(401, "unauthorized", "請重新登入。");
    }
    return {
      events: rows.flatMap((row) =>
        row.action === null ||
        row.actorUserId === null ||
        row.createdAt === null ||
        row.id === null ||
        row.targetUserId === null
          ? []
          : [
              {
                action: row.action,
                actorUserId: row.actorUserId,
                createdAt: dateToUnixSeconds(row.createdAt),
                hasInternalNote: Boolean(row.hasInternalNote),
                id: row.id,
                targetUserId: row.targetUserId,
              },
            ]
      ),
      hasNext: Boolean(firstRow.hasNext),
    };
  };

  let page = await readPage(pageNumber);
  if (pageNumber > 1 && page.events.length === 0) {
    pageNumber = 1;
    page = await readPage(pageNumber);
  }

  const selectedRow = selectedRecordId
    ? await auditProjection(database)
        .where(
          and(
            eq(auditEvent.id, selectedRecordId),
            activeStaffExists(database, actor)
          )
        )
        .limit(1)
        .get()
    : undefined;

  // A missing detail is not a successful read after authority was withdrawn.
  await requireStaff(headers);
  return {
    events: page.events,
    page: {
      hasNext: page.hasNext,
      hasPrevious: pageNumber > 1,
      number: pageNumber,
    },
    selectedEvent: selectedRow ? projectAuditEvent(selectedRow) : null,
  };
};
