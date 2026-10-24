import { createHash } from "node:crypto";

import { and, desc, eq, exists, gt, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type * as z from "zod";

import { getDb } from "../../../server/db/client";
import type { Database } from "../../../server/db/client";
import { requireDrizzleWrittenReceipt } from "../../../server/db/required-receipt";
import {
  applicationDecision,
  auditEvent,
  membershipApplication,
} from "../../../server/db/schema/applications";
import { session, user } from "../../../server/db/schema/auth";
import { personProfile } from "../../../server/db/schema/identity";
import { roleAssignmentHistory } from "../../../server/db/schema/roles";
import { requireOwnBusinessAccess, requireStaff } from "../account-actors";
import type { AccountActor } from "../account-actors";
import type { OwnApplication } from "../applications/applications";
import { BusinessApiError, readBoundedJson } from "../business-request";
import { dateToUnixSeconds, sqliteNowSeconds } from "../timestamps";
import {
  decisionReconciliationSchema,
  decisionRequestSchema,
} from "./decision-contract";

const actorProfile = alias(personProfile, "actor");
const targetProfile = alias(personProfile, "target");
const latestApplication = alias(membershipApplication, "latest_application");

/** Only the newest application per person is reviewable or decidable. */
const latestApplicationId = (database: Database) =>
  database
    .select({ id: latestApplication.id })
    .from(latestApplication)
    .where(eq(latestApplication.userId, membershipApplication.userId))
    .orderBy(sql`rowid desc`)
    .limit(1);

const REVIEW_APPLICATION_PAGE_SIZE = 25;

/** Active Staff/Admin session re-checked inside every decision statement. */
const staffActorExists = (database: Database, actor: AccountActor) =>
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
  );

export interface PendingApplication extends Omit<
  OwnApplication,
  "canonicalUsername" | "phoneShared"
> {
  userId: string;
  groupNote: string | null;
  intentNote: string | null;
  referralNote: string | null;
}

export interface ReviewApplicationPage {
  applications: PendingApplication[];
  selectedApplication: PendingApplication | null;
  page: { hasNext: boolean; hasPrevious: boolean; number: number };
}

const reviewPageNumber = (value: string | undefined): number => {
  if (!value || !/^\d+$/u.test(value)) {
    return 1;
  }
  const page = Number(value);
  const maximumPage = Math.floor(
    Number.MAX_SAFE_INTEGER / REVIEW_APPLICATION_PAGE_SIZE
  );
  return Number.isSafeInteger(page) && page > 0 && page <= maximumPage
    ? page
    : 1;
};

const reviewApplicationQuery = (
  database: Database,
  actor: AccountActor,
  selectedApplicationId?: string
) =>
  database
    .select({
      createdAt: membershipApplication.createdAt,
      email: user.email,
      fullName: user.name,
      groupNote: membershipApplication.groupNote,
      id: membershipApplication.id,
      intentNote: membershipApplication.intentNote,
      phone: targetProfile.phone,
      referralNote: membershipApplication.referralNote,
      status: membershipApplication.status,
      userId: membershipApplication.userId,
      username: user.displayUsername,
    })
    .from(membershipApplication)
    .innerJoin(user, eq(user.id, membershipApplication.userId))
    .innerJoin(
      targetProfile,
      eq(targetProfile.userId, membershipApplication.userId)
    )
    .innerJoin(actorProfile, eq(actorProfile.userId, actor.userId))
    .innerJoin(
      session,
      and(
        eq(session.userId, actorProfile.userId),
        eq(session.id, actor.sessionId)
      )
    )
    .where(
      and(
        eq(membershipApplication.status, "pending"),
        eq(targetProfile.membershipStatus, "pending"),
        isNull(targetProfile.bannedAt),
        sql`${targetProfile.userId} <> ${actorProfile.userId}`,
        eq(actorProfile.membershipStatus, "active"),
        isNull(actorProfile.bannedAt),
        sql`(${actorProfile.accountRole} = 'admin' OR (${actorProfile.accountRole} = 'staff' AND ${targetProfile.accountRole} = 'member'))`,
        gt(session.expiresAt, new Date()),
        inArray(membershipApplication.id, latestApplicationId(database)),
        selectedApplicationId
          ? eq(membershipApplication.id, selectedApplicationId)
          : undefined
      )
    );

const toPendingApplication = <T extends { createdAt: Date }>(row: T) => ({
  ...row,
  /** Stored as second-resolution Unix time by the application writer. */
  createdAt: dateToUnixSeconds(row.createdAt),
});

export const getReviewApplications = async (
  headers: Headers,
  requestedPage?: string,
  selectedApplicationId?: string
): Promise<ReviewApplicationPage> => {
  const actor = await requireStaff(headers);
  const database = getDb();
  let pageNumber = reviewPageNumber(requestedPage);
  const readPage = (number: number) =>
    reviewApplicationQuery(database, actor)
      .orderBy(membershipApplication.createdAt, membershipApplication.id)
      .limit(REVIEW_APPLICATION_PAGE_SIZE + 1)
      .offset((number - 1) * REVIEW_APPLICATION_PAGE_SIZE)
      .all();
  let rows = await readPage(pageNumber);
  if (pageNumber > 1 && rows.length === 0) {
    pageNumber = 1;
    rows = await readPage(pageNumber);
  }
  const selectedRow = selectedApplicationId
    ? await reviewApplicationQuery(database, actor, selectedApplicationId)
        .limit(1)
        .get()
    : undefined;
  return {
    applications: rows
      .slice(0, REVIEW_APPLICATION_PAGE_SIZE)
      .map(toPendingApplication),
    page: {
      hasNext: rows.length > REVIEW_APPLICATION_PAGE_SIZE,
      hasPrevious: pageNumber > 1,
      number: pageNumber,
    },
    selectedApplication: selectedRow ? toPendingApplication(selectedRow) : null,
  };
};

export interface ApplicantDecision {
  id: string;
  applicationId: string;
  outcome: "approved" | "rejected";
  visibleReason: string | null;
  createdAt: number;
}

export interface ApplicantDecisionInbox {
  decisions: ApplicantDecision[];
  roleChanges: {
    action: "granted" | "withdrawn";
    createdAt: number;
    role: "department_manager" | "program_leader";
    scopeName: string;
  }[];
  page: {
    hasNext: boolean;
    hasPrevious: boolean;
    number: number;
  };
}

const applicantInboxPageSize = 25;

const applicantInboxPageNumber = (
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
  const offset = (page - 1) * applicantInboxPageSize;
  return Number.isSafeInteger(page) && Number.isSafeInteger(offset) ? page : 1;
};

export const getDecisionInbox = async (
  headers: Headers,
  positions?: readonly string[] | string
): Promise<ApplicantDecisionInbox> => {
  const actor = await requireOwnBusinessAccess(headers);
  const pageNumber = applicantInboxPageNumber(positions);
  const offset = (pageNumber - 1) * applicantInboxPageSize;
  const db = getDb();
  const pageDecisions = db
    .select({
      applicationId: applicationDecision.applicationId,
      createdAt: applicationDecision.createdAt,
      id: applicationDecision.id,
      outcome: applicationDecision.outcome,
      visibleReason: applicationDecision.visibleReason,
    })
    .from(applicationDecision)
    .where(eq(applicationDecision.targetUserId, actor.userId))
    .orderBy(desc(applicationDecision.createdAt), desc(applicationDecision.id))
    .limit(applicantInboxPageSize)
    .offset(offset)
    .as("applicant_inbox_page");
  const nextDecision = db
    .select({ id: applicationDecision.id })
    .from(applicationDecision)
    .where(eq(applicationDecision.targetUserId, actor.userId))
    .orderBy(desc(applicationDecision.createdAt), desc(applicationDecision.id))
    .limit(1)
    .offset(offset + applicantInboxPageSize);
  /**
   * One statement: the current-session predicate and the private projection
   * cannot be split by a revoke between a check and a separate read.
   */
  const rows = await db
    .select({
      applicationId: pageDecisions.applicationId,
      createdAt: pageDecisions.createdAt,
      hasNext: exists(nextDecision),
      id: pageDecisions.id,
      outcome: pageDecisions.outcome,
      visibleReason: pageDecisions.visibleReason,
    })
    .from(session)
    .leftJoin(pageDecisions, sql`1 = 1`)
    .where(
      and(
        eq(session.id, actor.sessionId),
        eq(session.userId, actor.userId),
        gt(session.expiresAt, new Date())
      )
    )
    .orderBy(desc(pageDecisions.createdAt), desc(pageDecisions.id));
  await requireOwnBusinessAccess(headers);
  const [firstRow] = rows;
  if (!firstRow) {
    throw new BusinessApiError(401, "unauthorized", "請重新登入。");
  }

  const decisions = rows.flatMap((row) =>
    row.applicationId === null ||
    row.createdAt === null ||
    row.id === null ||
    row.outcome === null
      ? []
      : [
          {
            applicationId: row.applicationId,
            /** Stored as second-resolution Unix time by the decision writer. */
            createdAt: dateToUnixSeconds(row.createdAt),
            id: row.id,
            outcome: row.outcome,
            visibleReason: row.visibleReason,
          },
        ]
  );
  const roleChanges = await db
    .select({
      action: roleAssignmentHistory.action,
      createdAt: roleAssignmentHistory.createdAt,
      role: roleAssignmentHistory.role,
      scopeName: roleAssignmentHistory.scopeName,
    })
    .from(roleAssignmentHistory)
    .where(eq(roleAssignmentHistory.targetUserId, actor.userId))
    .orderBy(
      desc(roleAssignmentHistory.createdAt),
      desc(roleAssignmentHistory.id)
    )
    .limit(applicantInboxPageSize)
    .all();
  await requireOwnBusinessAccess(headers);
  if (pageNumber > 1 && decisions.length === 0) {
    return getDecisionInbox(headers);
  }
  return {
    decisions,
    page: {
      hasNext: Boolean(firstRow.hasNext),
      hasPrevious: pageNumber > 1,
      number: pageNumber,
    },
    roleChanges: roleChanges.map((change) => ({
      action: change.action,
      createdAt: dateToUnixSeconds(change.createdAt),
      role: change.role,
      scopeName: change.scopeName,
    })),
  };
};

export const parseDecisionRequest = async (request: Request) => {
  const parsed = decisionRequestSchema.safeParse(
    await readBoundedJson(request)
  );
  if (!parsed.success) {
    throw new BusinessApiError(
      400,
      "validation_error",
      "請填妥決定資料；拒絕申請必須填寫申請人可見的原因。"
    );
  }
  return parsed.data;
};

export const parseDecisionReconciliationRequest = async (request: Request) => {
  const parsed = decisionReconciliationSchema.safeParse(
    await readBoundedJson(request)
  );
  if (!parsed.success) {
    throw new BusinessApiError(400, "validation_error", "操作代碼格式不正確。");
  }
  return parsed.data;
};

export interface StaffDecision extends ApplicantDecision {
  actorUserId: string;
  targetUserId: string;
  internalNote: string | null;
}

interface DecisionRecord {
  actorUserId: string;
  applicationId: string;
  createdAt: Date;
  id: string;
  internalNote: string | null;
  outcome: "approved" | "rejected";
  requestHash: string;
  targetUserId: string;
  visibleReason: string | null;
}

const findDecision = async (
  database: Database,
  actor: AccountActor,
  operationKey: string
): Promise<DecisionRecord | null> => {
  const [row] = await database
    .select({
      actorUserId: applicationDecision.actorUserId,
      applicationId: applicationDecision.applicationId,
      createdAt: applicationDecision.createdAt,
      id: applicationDecision.id,
      internalNote: applicationDecision.internalNote,
      outcome: applicationDecision.outcome,
      requestHash: applicationDecision.requestHash,
      targetUserId: applicationDecision.targetUserId,
      visibleReason: applicationDecision.visibleReason,
    })
    .from(applicationDecision)
    .where(
      and(
        eq(applicationDecision.actorUserId, actor.userId),
        eq(applicationDecision.operationKey, operationKey),
        staffActorExists(database, actor)
      )
    )
    .limit(1);
  return row ?? null;
};

const decisionProjection = (record: DecisionRecord): StaffDecision => {
  const { requestHash: _requestHash, createdAt, ...decision } = record;
  return {
    ...decision,
    /** Stored as second-resolution Unix time; API consumers read seconds. */
    createdAt: dateToUnixSeconds(createdAt),
  };
};

const decisionConflict = () =>
  new BusinessApiError(
    409,
    "conflict",
    "申請狀態已改變，或操作代碼已用於另一份決定。請重新查核。"
  );

const matchingDecision = (record: DecisionRecord, requestHash: string) => {
  if (record.requestHash !== requestHash) {
    throw decisionConflict();
  }
  return decisionProjection(record);
};

const assertDecisionTarget = async (
  database: Database,
  actor: AccountActor & { role: "staff" | "admin" },
  applicationId: string
) => {
  const [target] = await database
    .select({
      bannedAt: targetProfile.bannedAt,
      membership: targetProfile.membershipStatus,
      role: targetProfile.accountRole,
      status: membershipApplication.status,
      userId: membershipApplication.userId,
    })
    .from(membershipApplication)
    .innerJoin(
      targetProfile,
      eq(targetProfile.userId, membershipApplication.userId)
    )
    .where(
      and(
        eq(membershipApplication.id, applicationId),
        inArray(membershipApplication.id, latestApplicationId(database))
      )
    )
    .limit(1);
  if (!target) {
    throw decisionConflict();
  }
  if (
    target.userId === actor.userId ||
    (actor.role === "staff" && target.role !== "member")
  ) {
    throw new BusinessApiError(
      403,
      "business_access_denied",
      "你不能對自己、其他職員或管理員作出這項決定。"
    );
  }
  if (
    target.status !== "pending" ||
    target.membership !== "pending" ||
    target.bannedAt !== null
  ) {
    throw decisionConflict();
  }
};

export const createApplicationDecision = async (
  headers: Headers,
  input: z.infer<typeof decisionRequestSchema>
): Promise<{ decision: StaffDecision; created: boolean }> => {
  const actor = await requireStaff(headers);
  const database = getDb();
  const requestHash = createHash("sha256")
    .update(
      JSON.stringify([
        input.applicationId,
        input.outcome,
        input.visibleReason,
        input.internalNote,
      ])
    )
    .digest("hex");
  const existing = await findDecision(database, actor, input.operationKey);
  if (existing) {
    return {
      created: false,
      decision: matchingDecision(existing, requestHash),
    };
  }
  // This read supplies useful errors only; the conditional UPDATE owns authority.
  await assertDecisionTarget(database, actor, input.applicationId);
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const createdAt = new Date(now * 1000);
  try {
    await database.batch([
      database
        .update(membershipApplication)
        .set({ decisionId: id, status: input.outcome })
        .where(
          and(
            eq(membershipApplication.id, input.applicationId),
            eq(membershipApplication.status, "pending"),
            inArray(membershipApplication.id, latestApplicationId(database)),
            exists(
              database
                .select({ one: sql`1` })
                .from(session)
                .innerJoin(
                  actorProfile,
                  eq(actorProfile.userId, session.userId)
                )
                .innerJoin(
                  targetProfile,
                  eq(targetProfile.userId, membershipApplication.userId)
                )
                .where(
                  and(
                    eq(session.id, actor.sessionId),
                    eq(session.userId, actor.userId),
                    gt(session.expiresAt, sqliteNowSeconds),
                    eq(actorProfile.membershipStatus, "active"),
                    isNull(actorProfile.bannedAt),
                    eq(targetProfile.membershipStatus, "pending"),
                    isNull(targetProfile.bannedAt),
                    sql`${targetProfile.userId} <> ${actorProfile.userId}`,
                    sql`(${actorProfile.accountRole} = 'admin' OR (${actorProfile.accountRole} = 'staff' AND ${targetProfile.accountRole} = 'member'))`
                  )
                )
            )
          )
        ),
      database
        .update(personProfile)
        .set({
          membershipStatus: input.outcome === "approved" ? "active" : "pending",
          updatedAt: createdAt,
        })
        .where(
          inArray(
            personProfile.userId,
            database
              .select({ userId: membershipApplication.userId })
              .from(membershipApplication)
              .where(
                and(
                  eq(membershipApplication.id, input.applicationId),
                  eq(membershipApplication.decisionId, id)
                )
              )
          )
        ),
      database.insert(auditEvent).select(
        database
          .select({
            action: sql<string>`${`application_${input.outcome}`}`.as("action"),
            actorUserId: sql<string>`${actor.userId}`.as("actor_user_id"),
            createdAt: sql`${now}`.as("created_at"),
            id: sql<string>`${id}`.as("id"),
            targetUserId: membershipApplication.userId,
          })
          .from(membershipApplication)
          .where(
            and(
              eq(membershipApplication.id, input.applicationId),
              eq(membershipApplication.decisionId, id)
            )
          )
      ),
      database.insert(applicationDecision).select(
        database
          .select({
            actorUserId: sql<string>`${actor.userId}`.as("actor_user_id"),
            applicationId: membershipApplication.id,
            createdAt: sql`${now}`.as("created_at"),
            id: sql<string>`${id}`.as("id"),
            internalNote: sql<string | null>`${input.internalNote}`.as(
              "internal_note"
            ),
            operationKey: sql<string>`${input.operationKey}`.as(
              "operation_key"
            ),
            outcome: sql<string>`${input.outcome}`.as("outcome"),
            requestHash: sql<string>`${requestHash}`.as("request_hash"),
            targetUserId: membershipApplication.userId,
            visibleReason: sql<string | null>`${input.visibleReason}`.as(
              "visible_reason"
            ),
          })
          .from(membershipApplication)
          .where(
            and(
              eq(membershipApplication.id, input.applicationId),
              eq(membershipApplication.decisionId, id)
            )
          )
      ),
      requireDrizzleWrittenReceipt(database, {
        id,
        table: "application_decision",
      }),
    ]);
  } catch (error) {
    const committed = await findDecision(database, actor, input.operationKey);
    if (committed) {
      return {
        created: false,
        decision: matchingDecision(committed, requestHash),
      };
    }
    await assertDecisionTarget(
      database,
      await requireStaff(headers),
      input.applicationId
    );
    throw error;
  }
  const committed = await findDecision(database, actor, input.operationKey);
  if (!committed) {
    const currentActor = await requireStaff(headers);
    await assertDecisionTarget(database, currentActor, input.applicationId);
    throw decisionConflict();
  }
  return {
    created: committed.id === id,
    decision: matchingDecision(committed, requestHash),
  };
};

export const reconcileApplicationDecision = async (
  headers: Headers,
  operationKey: string,
  applicationId?: string
): Promise<{
  decision: StaffDecision | null;
  applicationStatus?: OwnApplication["status"] | null;
}> => {
  const actor = await requireStaff(headers);
  const database = getDb();
  const committed = await findDecision(database, actor, operationKey);
  if (committed && applicationId && committed.applicationId !== applicationId) {
    throw decisionConflict();
  }
  let applicationStatus: OwnApplication["status"] | null | undefined;
  if (applicationId) {
    const [application] = await database
      .select({ status: membershipApplication.status })
      .from(membershipApplication)
      .where(
        and(
          eq(membershipApplication.id, applicationId),
          staffActorExists(database, actor)
        )
      )
      .limit(1);
    applicationStatus = application?.status ?? null;
  }
  await requireStaff(headers);
  return {
    applicationStatus,
    decision: committed ? decisionProjection(committed) : null,
  };
};
