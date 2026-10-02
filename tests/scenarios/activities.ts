/**
 * Synthetic Program/Event/enrolment/invitation fixtures for the acceptance
 * harness. Times are derived from the current day so ordering and past/upcoming
 * behaviour stay meaningful however long after writing the test it runs.
 */
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export interface ActivityFixtures {
  departments: { id: string; name: string }[];
  programs: { id: string; departmentId: string; name: string }[];
  events: { id: string; programId: string; title: string; startsAt: string }[];
  enrolments: {
    id: string;
    programId: string;
    username: string;
    status:
      | "approved"
      | "cancelled"
      | "pending"
      | "rejected"
      | "waitlisted"
      | "withdrawn";
  }[];
  invitations: {
    id: string;
    programId: string;
    username: string;
    state: "revoked" | "valid";
    expiresAt: string;
  }[];
}

/** 02:30 UTC is 10:30 in Hong Kong; 12:00 UTC is 20:00. */
export const buildActivityFixtures = (
  now: Date = new Date()
): ActivityFixtures => {
  const midnightUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  );
  const at = (days: number, hours: number): string =>
    new Date(midnightUtc + days * DAY_MS + hours * HOUR_MS).toISOString();

  return {
    departments: [
      { id: "dept-worship", name: "敬拜部" },
      { id: "dept-care", name: "關顧部" },
    ],
    enrolments: [
      // Approved participation with two upcoming, ordered occurrences.
      {
        id: "enr-sunday-wong",
        programId: "prog-sunday-service",
        status: "approved",
        username: "wong.tai.ming",
      },
      // Pending participation: shown with its state and no confirmed events.
      {
        id: "enr-youth-wong",
        programId: "prog-youth-group",
        status: "pending",
        username: "wong.tai.ming",
      },
      // Approved participation whose only occurrence is in the past.
      {
        id: "enr-care-wong",
        programId: "prog-care-visit",
        status: "approved",
        username: "wong.tai.ming",
      },
      // Excluded states: rejected, withdrawn and cancelled never show on Home.
      {
        id: "enr-rejected-wong",
        programId: "prog-prayer-night",
        status: "rejected",
        username: "wong.tai.ming",
      },
      {
        id: "enr-withdrawn-wong",
        programId: "prog-missions",
        status: "withdrawn",
        username: "wong.tai.ming",
      },
      {
        id: "enr-cancelled-wong",
        programId: "prog-choir",
        status: "cancelled",
        username: "wong.tai.ming",
      },
      // A second person with their own approved participation.
      {
        id: "enr-prayer-chan",
        programId: "prog-prayer-night",
        status: "approved",
        username: "Chan.Siu.Fong",
      },
      // Waitlisted participation is labelled without confirmed attendance.
      {
        id: "enr-choir-chan",
        programId: "prog-choir",
        status: "waitlisted",
        username: "Chan.Siu.Fong",
      },
    ],
    events: [
      {
        id: "evt-sunday-soon",
        programId: "prog-sunday-service",
        startsAt: at(2, 2.5),
        title: "主日崇拜",
      },
      {
        id: "evt-sunday-later",
        programId: "prog-sunday-service",
        startsAt: at(9, 2.5),
        title: "主日崇拜",
      },
      {
        id: "evt-prayer-chan",
        programId: "prog-prayer-night",
        startsAt: at(1, 12),
        title: "週三祈禱會",
      },
      {
        id: "evt-care-past",
        programId: "prog-care-visit",
        startsAt: at(-3, 6),
        title: "探訪服侍",
      },
      {
        id: "evt-youth-pending",
        programId: "prog-youth-group",
        startsAt: at(2, 11),
        title: "青年小組",
      },
    ],
    invitations: [
      {
        expiresAt: at(10, 12),
        id: "inv-care-chan",
        programId: "prog-care-visit",
        state: "valid",
        username: "Chan.Siu.Fong",
      },
      {
        expiresAt: at(-1, 12),
        id: "inv-sunday-chan",
        programId: "prog-sunday-service",
        state: "valid",
        username: "Chan.Siu.Fong",
      },
      {
        expiresAt: at(10, 12),
        id: "inv-youth-chan",
        programId: "prog-youth-group",
        state: "revoked",
        username: "Chan.Siu.Fong",
      },
    ],
    programs: [
      {
        departmentId: "dept-worship",
        id: "prog-sunday-service",
        name: "主日崇拜",
      },
      {
        departmentId: "dept-worship",
        id: "prog-prayer-night",
        name: "週三祈禱會",
      },
      { departmentId: "dept-care", id: "prog-care-visit", name: "探訪服侍" },
      {
        departmentId: "dept-worship",
        id: "prog-youth-group",
        name: "青年小組",
      },
      { departmentId: "dept-worship", id: "prog-choir", name: "詩班" },
      { departmentId: "dept-care", id: "prog-missions", name: "差傳關懷" },
    ],
  };
};
