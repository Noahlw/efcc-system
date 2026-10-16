import {
  and,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNull,
  lte,
  lt,
  or,
  sql,
} from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import type { Database } from "../../server/db/client";
import {
  department,
  enrolment,
  program,
} from "../../server/db/schema/activities";
import {
  departmentManagerAssignment,
  departmentMembership,
  notice,
} from "../../server/db/schema/notices";
import type { NoticeScope } from "../../server/db/schema/notices";

const pageSize = 25;

export interface HomeNotice {
  id: string;
  title: string;
  body: string;
  scope: NoticeScope;
  /** Human name of the scope: the church, the Department or the Program. */
  scopeLabel: string;
  publishedAt: Date | null;
}

export interface HomeNoticePage {
  items: HomeNotice[];
  nextCursor: string | null;
  hasAuthorizedCursor: boolean;
}

interface HomeNoticeCursor {
  id: string;
  publishedAt: Date;
}

/**
 * Only an enrolment still current on Home grants Program-notice scope;
 * rejected, withdrawn and cancelled enrolments must not.
 */
const currentEnrolmentStates = ["approved", "pending", "waitlisted"] as const;

const visibleNoticeCondition = (
  db: Database,
  userId: string,
  now: Date
): SQL => {
  const departmentMember = exists(
    db
      .select({ one: sql`1` })
      .from(departmentMembership)
      .where(
        and(
          eq(departmentMembership.departmentId, notice.scopeId),
          eq(departmentMembership.userId, userId)
        )
      )
  );
  const departmentManager = exists(
    db
      .select({ one: sql`1` })
      .from(departmentManagerAssignment)
      .where(
        and(
          eq(departmentManagerAssignment.departmentId, notice.scopeId),
          eq(departmentManagerAssignment.userId, userId)
        )
      )
  );
  const programEnrollee = exists(
    db
      .select({ one: sql`1` })
      .from(enrolment)
      .where(
        and(
          eq(enrolment.programId, notice.scopeId),
          eq(enrolment.userId, userId),
          inArray(enrolment.status, currentEnrolmentStates)
        )
      )
  );
  const programManager = exists(
    db
      .select({ one: sql`1` })
      .from(program)
      .innerJoin(
        departmentManagerAssignment,
        eq(departmentManagerAssignment.departmentId, program.departmentId)
      )
      .where(
        and(
          eq(program.id, notice.scopeId),
          eq(departmentManagerAssignment.userId, userId)
        )
      )
  );
  const departmentScope = or(departmentMember, departmentManager) as SQL;
  const programScope = or(programEnrollee, programManager) as SQL;
  const scope = or(
    and(eq(notice.scopeType, "church"), isNull(notice.scopeId)),
    and(eq(notice.scopeType, "department"), departmentScope),
    and(eq(notice.scopeType, "program"), programScope)
  ) as SQL;

  return and(
    scope,
    lte(notice.publishedAt, now),
    or(isNull(notice.expiresAt), gt(notice.expiresAt, now))
  ) as SQL;
};

const selectVisibleNotices = (db: Database) =>
  db
    .select({
      body: notice.body,
      departmentName: department.name,
      id: notice.id,
      programName: program.name,
      publishedAt: notice.publishedAt,
      scopeId: notice.scopeId,
      scopeType: notice.scopeType,
      title: notice.title,
    })
    .from(notice)
    .leftJoin(
      department,
      and(eq(notice.scopeType, "department"), eq(department.id, notice.scopeId))
    )
    .leftJoin(
      program,
      and(eq(notice.scopeType, "program"), eq(program.id, notice.scopeId))
    );

/** The bounded statement uses relational scope checks, never a scope-ID list. */
export const buildVisibleNoticeQuery = (
  db: Database,
  userId: string,
  now: Date,
  after: HomeNoticeCursor | null
) => {
  const cursorCondition = after
    ? or(
        lt(notice.publishedAt, after.publishedAt),
        and(eq(notice.publishedAt, after.publishedAt), lt(notice.id, after.id))
      )
    : undefined;

  return selectVisibleNotices(db)
    .where(and(visibleNoticeCondition(db, userId, now), cursorCondition))
    .orderBy(desc(notice.publishedAt), desc(notice.id))
    .limit(pageSize + 1);
};

export const buildAuthorizedNoticeCursorQuery = (
  db: Database,
  userId: string,
  now: Date,
  cursorId: string
) =>
  db
    .select({ id: notice.id, publishedAt: notice.publishedAt })
    .from(notice)
    .where(
      and(visibleNoticeCondition(db, userId, now), eq(notice.id, cursorId))
    )
    .limit(1);

const mapNotice = (row: {
  body: string;
  departmentName: string | null;
  id: string;
  programName: string | null;
  publishedAt: Date | null;
  scopeType: NoticeScope;
  title: string;
}): HomeNotice => ({
  body: row.body,
  id: row.id,
  publishedAt: row.publishedAt,
  scope: row.scopeType,
  scopeLabel:
    row.scopeType === "church"
      ? "教會"
      : (row.departmentName ?? row.programName ?? ""),
  title: row.title,
});

/**
 * The person's current, visible Home notices. A cursor is accepted only when
 * it still names a currently visible and published notice for this person.
 */
export const getVisibleNoticePage = async (
  db: Database,
  userId: string,
  now: Date,
  after: string | null
): Promise<HomeNoticePage> => {
  const cursorRows = after
    ? await buildAuthorizedNoticeCursorQuery(db, userId, now, after).all()
    : [];
  const [cursorRow] = cursorRows;
  const authorizedCursor =
    cursorRow?.publishedAt === null || cursorRow?.publishedAt === undefined
      ? null
      : { id: cursorRow.id, publishedAt: cursorRow.publishedAt };

  if (after && !authorizedCursor) {
    return { hasAuthorizedCursor: false, items: [], nextCursor: null };
  }

  const rows = await buildVisibleNoticeQuery(
    db,
    userId,
    now,
    authorizedCursor
  ).all();
  const hasNextPage = rows.length > pageSize;
  const items = rows.slice(0, pageSize);

  return {
    hasAuthorizedCursor: true,
    items: items.map(mapNotice),
    nextCursor: hasNextPage ? (items.at(-1)?.id ?? null) : null,
  };
};
