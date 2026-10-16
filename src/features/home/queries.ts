import {
  and,
  asc,
  count,
  eq,
  exists,
  gt,
  gte,
  inArray,
  lt,
  or,
  sql,
} from "drizzle-orm";

import type { Database } from "../../server/db/client";
import {
  department,
  enrolment,
  invitation,
  program,
  programEvent,
} from "../../server/db/schema/activities";

export type ParticipationState = "approved" | "pending" | "waitlisted";

/** Pending and waitlisted enrolments are shown with their state, never as confirmed. */
const visibleStates: ParticipationState[] = [
  "approved",
  "pending",
  "waitlisted",
];

export const HOME_PAGE_SIZE = 25;
export const HOME_EVENT_PAGE_SIZE = HOME_PAGE_SIZE;
export const HOME_PARTICIPATION_PAGE_SIZE = HOME_PAGE_SIZE;
export const HOME_INVITATION_PAGE_SIZE = HOME_PAGE_SIZE;

export interface HomeEvent {
  id: string;
  title: string;
  startsAt: Date;
  programName: string;
  departmentName: string;
}

export interface HomeEventPage {
  items: HomeEvent[];
  nextCursor: string | null;
}

export interface HomeParticipation {
  enrolmentId: string;
  programName: string;
  departmentName: string;
  state: ParticipationState;
  hasUpcomingEvents: boolean;
}

export interface HomeParticipationPage {
  items: HomeParticipation[];
  nextCursor: string | null;
}

export interface HomeInvitation {
  invitationId: string;
  programName: string;
  expiresAt: Date;
}

export interface HomeInvitationPage {
  items: HomeInvitation[];
  nextCursor: string | null;
}

export interface HomeView {
  eventCountsByDate: Record<string, number>;
  eventPage: HomeEventPage;
  hasApprovedParticipation: boolean;
  hasAuthorizedEventCursor: boolean;
  invitations: HomeInvitationPage;
  hasAuthorizedParticipationCursor: boolean;
  hasAuthorizedInvitationCursor: boolean;
  participation: HomeParticipationPage;
}

export interface HomeEventCursor {
  id: string;
  startsAt: Date;
}

export interface HomeParticipationCursor {
  id: string;
  programName: string;
}

export interface HomeInvitationCursor {
  id: string;
  expiresAt: Date;
}

export interface HomeViewOptions {
  selectedDate: string | null;
  after: string | null;
  participationAfter: string | null;
  invitationAfter: string | null;
  weekStartDateKey: string;
}

const millisecondsPerDay = 24 * 60 * 60 * 1000;
const hongKongUtcOffset = 8 * 60 * 60 * 1000;

/** UTC instant corresponding to midnight on a Hong Kong calendar date. */
export const getHomeDateStart = (dateKey: string): Date => {
  const [year = 0, month = 1, day = 1] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day) - hongKongUtcOffset);
};

const authorizedEventEnrolment = (userId: string) =>
  and(
    eq(enrolment.programId, programEvent.programId),
    eq(enrolment.userId, userId),
    eq(enrolment.status, "approved")
  );

const eventDateFilter = (selectedDate: string | null) => {
  if (!selectedDate) {
    return;
  }
  const start = getHomeDateStart(selectedDate);
  const end = new Date(start.getTime() + millisecondsPerDay);
  return and(gte(programEvent.startsAt, start), lt(programEvent.startsAt, end));
};

const eventCursorFilter = (cursor: HomeEventCursor | null) =>
  cursor
    ? or(
        gt(programEvent.startsAt, cursor.startsAt),
        and(
          eq(programEvent.startsAt, cursor.startsAt),
          gt(programEvent.id, cursor.id)
        )
      )
    : undefined;

const participationCursorFilter = (cursor: HomeParticipationCursor | null) =>
  cursor
    ? or(
        gt(program.name, cursor.programName),
        and(eq(program.name, cursor.programName), gt(enrolment.id, cursor.id))
      )
    : undefined;

const invitationCursorFilter = (cursor: HomeInvitationCursor | null) =>
  cursor
    ? or(
        gt(invitation.expiresAt, cursor.expiresAt),
        and(
          eq(invitation.expiresAt, cursor.expiresAt),
          gt(invitation.id, cursor.id)
        )
      )
    : undefined;

/** The exact bounded Event statement executed by the Home list read. */
export const buildHomeEventPageQuery = (
  db: Database,
  userId: string,
  now: Date,
  selectedDate: string | null,
  cursor: HomeEventCursor | null
) =>
  db
    .select({
      departmentName: department.name,
      id: programEvent.id,
      programName: program.name,
      startsAt: programEvent.startsAt,
      title: programEvent.title,
    })
    .from(programEvent)
    .innerJoin(enrolment, authorizedEventEnrolment(userId))
    .innerJoin(program, eq(program.id, programEvent.programId))
    .innerJoin(department, eq(department.id, program.departmentId))
    .where(
      and(
        gte(programEvent.startsAt, now),
        eventDateFilter(selectedDate),
        eventCursorFilter(cursor)
      )
    )
    .orderBy(asc(programEvent.startsAt), asc(programEvent.id))
    .limit(HOME_EVENT_PAGE_SIZE + 1);

/** The exact bounded participation statement executed by the Home read. */
export const buildHomeParticipationPageQuery = (
  db: Database,
  userId: string,
  now: Date,
  cursor: HomeParticipationCursor | null
) =>
  db
    .select({
      departmentName: department.name,
      enrolmentId: enrolment.id,
      hasUpcomingEvents: exists(
        db
          .select({ one: sql`1` })
          .from(programEvent)
          .where(
            and(
              eq(programEvent.programId, enrolment.programId),
              gte(programEvent.startsAt, now)
            )
          )
      ),
      programName: program.name,
      state: enrolment.status,
    })
    .from(enrolment)
    .innerJoin(program, eq(program.id, enrolment.programId))
    .innerJoin(department, eq(department.id, program.departmentId))
    .where(
      and(
        eq(enrolment.userId, userId),
        inArray(enrolment.status, visibleStates),
        participationCursorFilter(cursor)
      )
    )
    .orderBy(asc(program.name), asc(enrolment.id))
    .limit(HOME_PARTICIPATION_PAGE_SIZE + 1);

/** The exact bounded valid-invitation statement executed by the Home read. */
export const buildHomeInvitationPageQuery = (
  db: Database,
  userId: string,
  now: Date,
  cursor: HomeInvitationCursor | null
) =>
  db
    .select({
      expiresAt: invitation.expiresAt,
      invitationId: invitation.id,
      programName: program.name,
    })
    .from(invitation)
    .innerJoin(program, eq(program.id, invitation.programId))
    .where(
      and(
        eq(invitation.userId, userId),
        eq(invitation.state, "valid"),
        gt(invitation.expiresAt, now),
        invitationCursorFilter(cursor)
      )
    )
    .orderBy(asc(invitation.expiresAt), asc(invitation.id))
    .limit(HOME_INVITATION_PAGE_SIZE + 1);

/** At most seven rows: complete event counts for the visible HK week. */
export const buildHomeEventCalendarQuery = (
  db: Database,
  userId: string,
  now: Date,
  weekStartDateKey: string
) => {
  const weekStart = getHomeDateStart(weekStartDateKey);
  const weekEnd = new Date(weekStart.getTime() + 7 * millisecondsPerDay);
  const churchDateKey = sql<string>`date(${programEvent.startsAt}, 'unixepoch', '+8 hours')`;

  return db
    .select({ count: count(), dateKey: churchDateKey })
    .from(programEvent)
    .innerJoin(enrolment, authorizedEventEnrolment(userId))
    .where(
      and(
        gte(programEvent.startsAt, now),
        gte(programEvent.startsAt, weekStart),
        lt(programEvent.startsAt, weekEnd)
      )
    )
    .groupBy(churchDateKey)
    .orderBy(asc(churchDateKey));
};

const authorizedCursorQuery = (
  db: Database,
  userId: string,
  now: Date,
  selectedDate: string | null,
  cursorId: string
) =>
  db
    .select({ id: programEvent.id, startsAt: programEvent.startsAt })
    .from(programEvent)
    .innerJoin(enrolment, authorizedEventEnrolment(userId))
    .where(
      and(
        eq(programEvent.id, cursorId),
        gte(programEvent.startsAt, now),
        eventDateFilter(selectedDate)
      )
    )
    .limit(1);

const authorizedParticipationCursorQuery = (
  db: Database,
  userId: string,
  cursorId: string
) =>
  db
    .select({ id: enrolment.id, programName: program.name })
    .from(enrolment)
    .innerJoin(program, eq(program.id, enrolment.programId))
    .innerJoin(department, eq(department.id, program.departmentId))
    .where(
      and(
        eq(enrolment.id, cursorId),
        eq(enrolment.userId, userId),
        inArray(enrolment.status, visibleStates)
      )
    )
    .limit(1);

const authorizedInvitationCursorQuery = (
  db: Database,
  userId: string,
  now: Date,
  cursorId: string
) =>
  db
    .select({ expiresAt: invitation.expiresAt, id: invitation.id })
    .from(invitation)
    .where(
      and(
        eq(invitation.id, cursorId),
        eq(invitation.userId, userId),
        eq(invitation.state, "valid"),
        gt(invitation.expiresAt, now)
      )
    )
    .limit(1);

const getHomeInvitationPage = async (
  db: Database,
  userId: string,
  now: Date,
  cursorId: string | null
) => {
  const [cursorRow] = cursorId
    ? await authorizedInvitationCursorQuery(db, userId, now, cursorId)
    : [];
  const cursor = cursorRow ?? null;
  const rows =
    cursorId && !cursor
      ? []
      : await buildHomeInvitationPageQuery(db, userId, now, cursor).all();
  const items = rows.slice(0, HOME_INVITATION_PAGE_SIZE);
  return {
    hasAuthorizedCursor: !cursorId || cursorRow !== undefined,
    page: {
      items,
      nextCursor:
        rows.length > HOME_INVITATION_PAGE_SIZE
          ? (items.at(-1)?.invitationId ?? null)
          : null,
    },
  };
};

/**
 * The person's own Home projection. Event authority and date filtering stay in
 * bounded relational statements; participation presence is independent of
 * the displayed Event page.
 */
export const getHomeView = async (
  db: Database,
  userId: string,
  now: Date,
  options: HomeViewOptions
): Promise<HomeView> => {
  const [
    participationCursorRows,
    invitationPageResult,
    hasApprovedRows,
    calendarRows,
  ] = await Promise.all([
    options.participationAfter
      ? authorizedParticipationCursorQuery(
          db,
          userId,
          options.participationAfter
        )
      : Promise.resolve([]),
    getHomeInvitationPage(db, userId, now, options.invitationAfter),
    db
      .select({ id: enrolment.id })
      .from(enrolment)
      .where(
        and(eq(enrolment.userId, userId), eq(enrolment.status, "approved"))
      )
      .limit(1),
    buildHomeEventCalendarQuery(
      db,
      userId,
      now,
      options.weekStartDateKey
    ).all(),
  ]);

  const [participationCursorRow] = participationCursorRows;
  const participationCursor = participationCursorRow ?? null;
  const participationRows = await buildHomeParticipationPageQuery(
    db,
    userId,
    now,
    participationCursor
  ).all();
  const hasMoreParticipation =
    participationRows.length > HOME_PARTICIPATION_PAGE_SIZE;
  const participationItems = participationRows
    .slice(0, HOME_PARTICIPATION_PAGE_SIZE)
    .map((row) => ({
      departmentName: row.departmentName,
      enrolmentId: row.enrolmentId,
      hasUpcomingEvents:
        row.state === "approved" && Boolean(row.hasUpcomingEvents),
      programName: row.programName,
      state: row.state as ParticipationState,
    }));

  const [cursorRow] = options.after
    ? await authorizedCursorQuery(
        db,
        userId,
        now,
        options.selectedDate,
        options.after
      )
    : [];
  const cursor = cursorRow ?? null;
  const eventRows = await buildHomeEventPageQuery(
    db,
    userId,
    now,
    options.selectedDate,
    cursor
  ).all();
  const hasNextPage = eventRows.length > HOME_EVENT_PAGE_SIZE;
  const eventItems = eventRows.slice(0, HOME_EVENT_PAGE_SIZE);

  return {
    eventCountsByDate: Object.fromEntries(
      calendarRows.map((row) => [row.dateKey, row.count])
    ),
    eventPage: {
      items: eventItems,
      nextCursor: hasNextPage ? (eventItems.at(-1)?.id ?? null) : null,
    },
    hasApprovedParticipation: hasApprovedRows.length > 0,
    hasAuthorizedEventCursor: !options.after || cursorRow !== undefined,
    hasAuthorizedInvitationCursor: invitationPageResult.hasAuthorizedCursor,
    hasAuthorizedParticipationCursor:
      !options.participationAfter ||
      (participationCursorRow !== undefined && participationItems.length > 0),
    invitations: invitationPageResult.page,
    participation: {
      items: participationItems,
      nextCursor: hasMoreParticipation
        ? (participationItems.at(-1)?.enrolmentId ?? null)
        : null,
    },
  };
};
