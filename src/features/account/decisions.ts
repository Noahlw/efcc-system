import { createHash } from "node:crypto";

import { and, desc, eq, exists, gt, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type * as z from "zod";

import { getDb } from "../../server/db/client";
import type { Database } from "../../server/db/client";
import { requireDrizzleWrittenReceipt } from "../../server/db/required-receipt";
import {
  applicationDecision,
  auditEvent,
  membershipApplication,
} from "../../server/db/schema/applications";
import { account, session, user } from "../../server/db/schema/auth";
import { personProfile } from "../../server/db/schema/identity";
import { ApplicationRequestError, readBoundedJson } from "./applications";
import {
  decisionReconciliationSchema,
  decisionRequestSchema,
} from "./decision-contract";

export interface AccountActor {
  userId: string;
  sessionId: string;
}

export const accountActor = (headers: Headers): AccountActor => {
  const userId = headers.get("x-efcc-user-id");
  const sessionId = headers.get("x-efcc-session-id");
  if (!userId || !sessionId) {
    throw new ApplicationRequestError(401, "unauthorized", "請先登入。");
  }
  const expectedActor = headers.get("x-efcc-expected-actor-id");
  if (expectedActor !== null && expectedActor !== userId) {
    throw new ApplicationRequestError(
      409,
      "actor_changed",
      "登入帳戶已改變，未有執行此請求。請以原帳戶登入查核。"
    );
  }
  return { sessionId, userId };
};

export interface OwnApplication {
  id: string;
  status: "pending" | "approved" | "rejected" | "withdrawn";
  fullName: string;
  username: string | null;
  email: string;
  phone: string | null;
  createdAt: number;
}

export const getOwnApplication = async (
  headers: Headers
): Promise<OwnApplication | null> => {
  const actor = accountActor(headers);
  const database = getDb();
  const row = await database
    .select({
      createdAt: membershipApplication.createdAt,
      email: user.email,
      fullName: user.name,
      id: membershipApplication.id,
      phone: personProfile.phone,
      status: membershipApplication.status,
      username: user.displayUsername,
    })
    .from(session)
    .innerJoin(user, eq(user.id, session.userId))
    .leftJoin(personProfile, eq(personProfile.userId, user.id))
    .leftJoin(
      membershipApplication,
      eq(
        membershipApplication.id,
        database
          .select({ id: membershipApplication.id })
          .from(membershipApplication)
          .where(eq(membershipApplication.userId, user.id))
          .orderBy(desc(sql`rowid`))
          .limit(1)
      )
    )
    .where(
      and(
        eq(session.id, actor.sessionId),
        eq(session.userId, actor.userId),
        gt(session.expiresAt, new Date())
      )
    )
    .get();
  if (!row) {
    throw new ApplicationRequestError(401, "unauthorized", "請重新登入。");
  }
  if (row.id === null || row.status === null || row.createdAt === null) {
    return null;
  }
  return {
    createdAt: Math.floor(row.createdAt.getTime() / 1000),
    email: row.email,
    fullName: row.fullName,
    id: row.id,
    phone: row.phone,
    status: row.status,
    username: row.username,
  };
};

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

export const requireStaff = async (headers: Headers) => {
  const actor = accountActor(headers);
  const [current] = await getDb()
    .select({
      bannedAt: personProfile.bannedAt,
      membershipStatus: personProfile.membershipStatus,
      role: personProfile.accountRole,
    })
    .from(session)
    .leftJoin(personProfile, eq(personProfile.userId, session.userId))
    .innerJoin(
      account,
      and(
        eq(account.userId, session.userId),
        eq(account.accountId, session.userId),
        eq(account.providerId, "credential"),
        isNull(account.temporaryPasswordExpiresAt),
        eq(account.credentialRevision, session.credentialRevision)
      )
    )
    .where(
      and(
        eq(session.id, actor.sessionId),
        eq(session.userId, actor.userId),
        gt(session.expiresAt, new Date())
      )
    )
    .limit(1);
  if (!current) {
    throw new ApplicationRequestError(401, "unauthorized", "請重新登入。");
  }
  if (
    current.membershipStatus !== "active" ||
    current.bannedAt !== null ||
    (current.role !== "staff" && current.role !== "admin")
  ) {
    throw new ApplicationRequestError(
      403,
      "business_access_denied",
      "你沒有帳戶管理權限。"
    );
  }
  return { ...actor, role: current.role };
};

export interface PendingApplication extends OwnApplication {
  userId: string;
  groupNote: string | null;
  intentNote: string | null;
  referralNote: string | null;
}

export const getReviewApplications = async (
  headers: Headers
): Promise<PendingApplication[]> => {
  const actor = await requireStaff(headers);
  const database = getDb();
  const rows = await database
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
        inArray(membershipApplication.id, latestApplicationId(database))
      )
    )
    .orderBy(membershipApplication.createdAt, membershipApplication.id);
  return rows.map((row) => ({
    ...row,
    /** Stored as second-resolution Unix time by the application writer. */
    createdAt: Math.floor(row.createdAt.getTime() / 1000),
  }));
};

export interface ApplicantDecision {
  id: string;
  applicationId: string;
  outcome: "approved" | "rejected";
  visibleReason: string | null;
  createdAt: number;
}

export const getDecisionInbox = async (
  headers: Headers
): Promise<ApplicantDecision[]> => {
  const actor = accountActor(headers);
  const db = getDb();
  const [currentSession] = await db
    .select({ id: session.id })
    .from(session)
    .where(
      and(
        eq(session.id, actor.sessionId),
        eq(session.userId, actor.userId),
        gt(session.expiresAt, new Date())
      )
    )
    .limit(1);
  if (!currentSession) {
    throw new ApplicationRequestError(401, "unauthorized", "請重新登入。");
  }
  const rows = await db
    .select({
      applicationId: applicationDecision.applicationId,
      createdAt: applicationDecision.createdAt,
      id: applicationDecision.id,
      outcome: applicationDecision.outcome,
      visibleReason: applicationDecision.visibleReason,
    })
    .from(applicationDecision)
    .where(eq(applicationDecision.targetUserId, actor.userId))
    .orderBy(desc(applicationDecision.createdAt), desc(applicationDecision.id));
  return rows.map((row) => ({
    applicationId: row.applicationId,
    /** Stored as second-resolution Unix time by the decision writer. */
    createdAt: Math.floor(row.createdAt.getTime() / 1000),
    id: row.id,
    outcome: row.outcome,
    visibleReason: row.visibleReason,
  }));
};

export const parseDecisionRequest = async (request: Request) => {
  const parsed = decisionRequestSchema.safeParse(
    await readBoundedJson(request)
  );
  if (!parsed.success) {
    throw new ApplicationRequestError(
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
    throw new ApplicationRequestError(
      400,
      "validation_error",
      "操作代碼格式不正確。"
    );
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
    createdAt: Math.floor(createdAt.getTime() / 1000),
  };
};

const decisionConflict = () =>
  new ApplicationRequestError(
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
    throw new ApplicationRequestError(
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
                    gt(session.expiresAt, createdAt),
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
