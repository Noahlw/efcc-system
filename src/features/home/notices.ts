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
 * Only an enrolment still current on Home grants Program-notice scope;
 * rejected, withdrawn and cancelled enrolments must not.
 */
const currentEnrolmentStates = ["approved", "pending", "waitlisted"] as const;

/**
 * The person's currently eligible notices. Visibility is derived from the
 * request's own identity: church-wide notices reach everyone, Department
 * notices reach current Department members and assigned managers, and Program
 * notices reach people with a current enrolment plus the assigned managers
 * of the owning Department. Ordinary Department membership is not enrolment.
 * Publication and expiry are enforced in the same
 * query.
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
      .where(
        and(
          eq(enrolment.userId, userId),
          inArray(enrolment.status, currentEnrolmentStates)
        )
      ),
  ]);

  const departmentIds = [
    ...new Set([
      ...memberships.map((row) => row.departmentId),
      ...assignments.map((row) => row.departmentId),
    ]),
  ];

  const managedDepartmentIds = assignments.map((row) => row.departmentId);
  const programsInScope =
    managedDepartmentIds.length > 0
      ? await db
          .select({ id: program.id })
          .from(program)
          .where(inArray(program.departmentId, managedDepartmentIds))
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
    .leftJoin(
      department,
      and(eq(notice.scopeType, "department"), eq(department.id, notice.scopeId))
    )
    .leftJoin(
      program,
      and(eq(notice.scopeType, "program"), eq(program.id, notice.scopeId))
    )
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
