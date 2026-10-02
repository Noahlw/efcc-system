import { and, asc, eq, gte, inArray } from "drizzle-orm";

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

export interface HomeEvent {
  id: string;
  title: string;
  startsAt: Date;
}

export interface HomeParticipation {
  enrolmentId: string;
  programName: string;
  departmentName: string;
  state: ParticipationState;
  /** Upcoming occurrences; only approved participation has confirmed events. */
  events: HomeEvent[];
}

export interface HomeInvitation {
  invitationId: string;
  programName: string;
  expiresAt: Date;
}

export interface HomeView {
  participation: HomeParticipation[];
  invitations: HomeInvitation[];
}

/**
 * The person's own Home projection. Ownership, current visibility, date
 * ordering and invitation validity are enforced in the database query; the
 * caller supplies the identity from the validated session.
 */
export const getHomeView = async (
  db: Database,
  userId: string,
  now: Date = new Date()
): Promise<HomeView> => {
  const participationRows = await db
    .select({
      departmentName: department.name,
      enrolmentId: enrolment.id,
      programId: program.id,
      programName: program.name,
      state: enrolment.status,
    })
    .from(enrolment)
    .innerJoin(program, eq(program.id, enrolment.programId))
    .innerJoin(department, eq(department.id, program.departmentId))
    .where(
      and(
        eq(enrolment.userId, userId),
        inArray(enrolment.status, visibleStates)
      )
    )
    .orderBy(asc(program.name));

  const approvedProgramIds = participationRows
    .filter((row) => row.state === "approved")
    .map((row) => row.programId);

  const eventRows =
    approvedProgramIds.length > 0
      ? await db
          .select({
            id: programEvent.id,
            programId: programEvent.programId,
            startsAt: programEvent.startsAt,
            title: programEvent.title,
          })
          .from(programEvent)
          .where(
            and(
              inArray(programEvent.programId, approvedProgramIds),
              gte(programEvent.startsAt, now)
            )
          )
          .orderBy(asc(programEvent.startsAt))
      : [];

  const eventsByProgram = new Map<string, HomeEvent[]>();
  for (const event of eventRows) {
    const list = eventsByProgram.get(event.programId) ?? [];
    list.push({
      id: event.id,
      startsAt: event.startsAt,
      title: event.title,
    });
    eventsByProgram.set(event.programId, list);
  }

  const invitationRows = await db
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
        gte(invitation.expiresAt, now)
      )
    )
    .orderBy(asc(invitation.expiresAt));

  return {
    invitations: invitationRows,
    participation: participationRows.map((row) => ({
      departmentName: row.departmentName,
      enrolmentId: row.enrolmentId,
      events: eventsByProgram.get(row.programId) ?? [],
      programName: row.programName,
      state: row.state as ParticipationState,
    })),
  };
};
