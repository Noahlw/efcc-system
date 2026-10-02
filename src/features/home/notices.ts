import { and, desc, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";
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

export interface HomeNotice {
  id: string;
  title: string;
  body: string;
  scope: NoticeScope;
  /** Human name of the scope: the church, the Department or the Program. */
  scopeLabel: string;
  publishedAt: Date | null;
}

/**
 * The person's currently eligible notices. Visibility is derived from the
 * request's own identity: church-wide notices reach everyone, Department
 * notices reach current Department members and assigned managers, and Program
 * notices reach enrolled people plus the members and managers of the owning
 * Department. Publication and expiry are enforced in the same query.
 */
export const getVisibleNotices = async (
  db: Database,
  userId: string,
  now: Date = new Date()
): Promise<HomeNotice[]> => {
  const [memberships, assignments, enrolments] = await Promise.all([
    db
      .select({ departmentId: departmentMembership.departmentId })
      .from(departmentMembership)
      .where(eq(departmentMembership.userId, userId)),
    db
      .select({ departmentId: departmentManagerAssignment.departmentId })
      .from(departmentManagerAssignment)
      .where(eq(departmentManagerAssignment.userId, userId)),
    db
      .select({ programId: enrolment.programId })
      .from(enrolment)
      .where(eq(enrolment.userId, userId)),
  ]);

  const departmentIds = [
    ...new Set([
      ...memberships.map((row) => row.departmentId),
      ...assignments.map((row) => row.departmentId),
    ]),
  ];

  const programsInScope =
    departmentIds.length > 0
      ? await db
          .select({ id: program.id })
          .from(program)
          .where(inArray(program.departmentId, departmentIds))
      : [];

  const programIds = [
    ...new Set([
      ...enrolments.map((row) => row.programId),
      ...programsInScope.map((row) => row.id),
    ]),
  ];

  const scopeClauses: SQL[] = [eq(notice.scopeType, "church")];
  if (departmentIds.length > 0) {
    scopeClauses.push(
      and(
        eq(notice.scopeType, "department"),
        inArray(notice.scopeId, departmentIds)
      ) as SQL
    );
  }
  if (programIds.length > 0) {
    scopeClauses.push(
      and(
        eq(notice.scopeType, "program"),
        inArray(notice.scopeId, programIds)
      ) as SQL
    );
  }

  const rows = await db
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
    .leftJoin(department, eq(department.id, notice.scopeId))
    .leftJoin(program, eq(program.id, notice.scopeId))
    .where(
      and(
        or(...scopeClauses),
        lte(notice.publishedAt, now),
        or(isNull(notice.expiresAt), gt(notice.expiresAt, now))
      )
    )
    .orderBy(desc(notice.publishedAt));

  return rows.map((row) => ({
    body: row.body,
    id: row.id,
    publishedAt: row.publishedAt,
    scope: row.scopeType,
    scopeLabel:
      row.scopeType === "church"
        ? "教會"
        : (row.departmentName ?? row.programName ?? ""),
    title: row.title,
  }));
};
