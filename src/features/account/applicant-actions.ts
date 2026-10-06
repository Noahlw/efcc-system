import { createHash } from "node:crypto";

import {
  and,
  desc,
  eq,
  exists,
  gt,
  isNull,
  ne,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type * as z from "zod";

import { getDb, schema } from "../../server/db/client";
import type { Database } from "../../server/db/client";
import { canonicalNameKey } from "../identity/name-matching";
import type { applicantActionSchema } from "./application-contract";
import { ApplicationRequestError } from "./applications";
import { getOwnApplication } from "./decisions";
import type { AccountActor, OwnApplication } from "./decisions";
import { getCredentialActor } from "./security";

type Input = z.infer<typeof applicantActionSchema>;

export interface ApplicantReceipt {
  id: string;
  action: Input["action"];
  applicationId: string;
  createdAt: number;
}

interface StoredReceipt {
  action: Input["action"];
  applicationId: string;
  createdAt: Date;
  id: string;
  requestHash: string;
}

const denied = () =>
  new ApplicationRequestError(
    403,
    "applicant_access_denied",
    "只有從未獲批准的申請人可處理自己的申請。"
  );
const conflict = () =>
  new ApplicationRequestError(
    409,
    "conflict",
    "申請狀態或聯絡資料已改變，請重新查核。"
  );

/**
 * Durable approval history and credential currency for the actor. This one
 * expression backs both the initial read and the in-batch authority predicate.
 */
const eligibleApplicant = (database: Database, actor: AccountActor) =>
  database
    .select({ ok: sql`1` })
    .from(schema.personProfile)
    .innerJoin(
      schema.session,
      eq(schema.session.userId, schema.personProfile.userId)
    )
    .innerJoin(
      schema.account,
      and(
        eq(schema.account.userId, schema.personProfile.userId),
        eq(schema.account.accountId, schema.personProfile.userId),
        eq(schema.account.providerId, "credential")
      )
    )
    .where(
      and(
        eq(schema.personProfile.userId, actor.userId),
        eq(schema.session.id, actor.sessionId),
        gt(schema.session.expiresAt, new Date()),
        eq(
          schema.account.credentialRevision,
          schema.session.credentialRevision
        ),
        isNull(schema.account.temporaryPasswordExpiresAt),
        eq(schema.personProfile.accountRole, "member"),
        eq(schema.personProfile.membershipStatus, "pending"),
        notExists(
          database
            .select({ ok: sql`1` })
            .from(schema.membershipApplication)
            .where(
              and(
                eq(
                  schema.membershipApplication.userId,
                  schema.personProfile.userId
                ),
                eq(schema.membershipApplication.status, "approved")
              )
            )
        ),
        notExists(
          database
            .select({ ok: sql`1` })
            .from(schema.applicationDecision)
            .where(
              and(
                eq(
                  schema.applicationDecision.targetUserId,
                  schema.personProfile.userId
                ),
                eq(schema.applicationDecision.outcome, "approved")
              )
            )
        ),
        notExists(
          database
            .select({ ok: sql`1` })
            .from(schema.staffAccountOperation)
            .where(
              and(
                eq(
                  schema.staffAccountOperation.targetUserId,
                  schema.personProfile.userId
                ),
                eq(
                  schema.staffAccountOperation.action,
                  "assisted_account_created"
                )
              )
            )
        )
      )
    );

/** Target ownership and the read-time state must still hold at write time. */
const ownedApplication = (
  database: Database,
  actor: AccountActor,
  previous: Pick<OwnApplication, "id" | "status">
) =>
  database
    .select({ ok: sql`1` })
    .from(schema.membershipApplication)
    .where(
      and(
        eq(schema.membershipApplication.id, previous.id),
        eq(schema.membershipApplication.userId, actor.userId),
        eq(schema.membershipApplication.status, previous.status),
        eq(
          schema.membershipApplication.id,
          database
            .select({ id: schema.membershipApplication.id })
            .from(schema.membershipApplication)
            .where(eq(schema.membershipApplication.userId, actor.userId))
            .orderBy(desc(sql`rowid`))
            .limit(1)
        )
      )
    );

export const getApplicantState = async (headers: Headers) => {
  const database = getDb();
  const actor = await getCredentialActor(headers);
  const eligible = await eligibleApplicant(database, actor).limit(1).get();
  const application = await getOwnApplication(headers);
  return {
    actorUserId: actor.userId,
    application,
    eligible: !!eligible && !!application && application.status !== "approved",
  };
};

/**
 * Server-only re-check after a failed batch: the corrected email or phone
 * already belongs to another account. The batch predicates stay the authority.
 */
const hasContactConflict = async (
  database: Database,
  actor: AccountActor,
  contact: { email: string; phone: string }
) => {
  const emailRow = await database
    .select({ ok: sql`1` })
    .from(schema.user)
    .where(
      and(
        ne(schema.user.id, actor.userId),
        eq(sql`lower(trim(${schema.user.email}))`, contact.email)
      )
    )
    .limit(1)
    .get();
  if (emailRow) {
    return true;
  }
  const phoneRow = await database
    .select({ ok: sql`1` })
    .from(schema.personProfile)
    .where(
      and(
        ne(schema.personProfile.userId, actor.userId),
        eq(schema.personProfile.phone, contact.phone)
      )
    )
    .limit(1)
    .get();
  return !!phoneRow;
};

const findReceipt = (database: Database, userId: string, key: string) =>
  database
    .select({
      action: schema.applicantOperation.action,
      applicationId: schema.applicantOperation.applicationId,
      createdAt: schema.applicantOperation.createdAt,
      id: schema.applicantOperation.id,
      requestHash: schema.applicantOperation.requestHash,
    })
    .from(schema.applicantOperation)
    .where(
      and(
        eq(schema.applicantOperation.userId, userId),
        eq(schema.applicantOperation.operationKey, key)
      )
    )
    .get();

const project = ({
  action,
  applicationId,
  createdAt,
  id,
}: StoredReceipt): ApplicantReceipt => ({
  action,
  applicationId,
  createdAt: Math.floor(createdAt.getTime() / 1000),
  id,
});
const matching = (row: StoredReceipt, hash: string) => {
  if (row.requestHash !== hash) {
    throw conflict();
  }
  return project(row);
};

export const createApplicantAction = async (headers: Headers, input: Input) => {
  const database = getDb();
  const actor = await getCredentialActor(headers);
  const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const state = await getApplicantState(headers);
  const existing = await findReceipt(
    database,
    actor.userId,
    input.operationKey
  );
  if (existing) {
    return { created: false, receipt: matching(existing, hash) };
  }
  if (!state.eligible) {
    throw denied();
  }
  const previous = state.application;
  if (!previous || previous.id !== input.applicationId) {
    throw conflict();
  }
  const statuses: Record<Input["action"], readonly string[]> = {
    application_corrected: ["pending", "rejected", "withdrawn"],
    application_resubmitted: ["rejected", "withdrawn"],
    application_withdrawn: ["pending"],
  };
  const allowed = statuses[input.action];
  if (!allowed.includes(previous.status)) {
    throw conflict();
  }
  const id = crypto.randomUUID();
  const applicationId =
    input.action === "application_resubmitted"
      ? crypto.randomUUID()
      : previous.id;
  const now = Math.floor(Date.now() / 1000);
  const createdAt = new Date(now * 1000);
  const statements: [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]] = [
    database
      .select({
        guard: sql`json(CASE WHEN ${exists(eligibleApplicant(database, actor))} AND ${exists(ownedApplication(database, actor, previous))} THEN 'null' ELSE 'Applicant state changed' END)`,
      })
      .from(schema.user)
      .limit(1),
  ];
  if (input.action === "application_corrected") {
    statements.push(
      database
        .update(schema.user)
        .set({
          email: input.email,
          emailVerified: sql`CASE WHEN ${schema.user.email} <> ${input.email} THEN 0 ELSE ${schema.user.emailVerified} END`,
          name: input.fullName,
          updatedAt: createdAt,
        })
        .where(eq(schema.user.id, actor.userId)),
      database
        .update(schema.personProfile)
        .set({
          nameLookupKey: canonicalNameKey(input.fullName),
          phone: input.phone,
          phoneShared: false,
          updatedAt: createdAt,
        })
        .where(eq(schema.personProfile.userId, actor.userId))
    );
  } else if (input.action === "application_withdrawn") {
    statements.push(
      database
        .update(schema.membershipApplication)
        .set({ status: "withdrawn" })
        .where(
          and(
            eq(schema.membershipApplication.id, previous.id),
            eq(schema.membershipApplication.status, "pending")
          )
        )
    );
  } else {
    statements.push(
      database.insert(schema.membershipApplication).select(
        database
          .select({
            createdAt: sql<Date>`${now}`.as("created_at"),
            decisionId: sql<string | null>`NULL`.as("decision_id"),
            groupNote: schema.membershipApplication.groupNote,
            id: sql<string>`${applicationId}`.as("id"),
            intentNote: schema.membershipApplication.intentNote,
            operationKeyHash:
              sql<string>`${createHash("sha256").update(input.operationKey).digest("hex")}`.as(
                "operation_key_hash"
              ),
            referralNote: schema.membershipApplication.referralNote,
            requestHash: sql<string>`${hash}`.as("request_hash"),
            status: sql<string>`'pending'`.as("status"),
            userId: schema.membershipApplication.userId,
          })
          .from(schema.membershipApplication)
          .where(eq(schema.membershipApplication.id, previous.id))
      )
    );
  }
  statements.push(
    database.insert(schema.auditEvent).values({
      action: input.action,
      actorUserId: actor.userId,
      createdAt,
      id,
      targetUserId: actor.userId,
    }),
    database.insert(schema.applicantOperation).values({
      action: input.action,
      applicationId,
      createdAt,
      id,
      operationKey: input.operationKey,
      requestHash: hash,
      userId: actor.userId,
    })
  );
  const expectedStatuses: Record<Input["action"], OwnApplication["status"]> = {
    application_corrected: previous.status,
    application_resubmitted: "pending",
    application_withdrawn: "withdrawn",
  };
  const expectedStatus = expectedStatuses[input.action];
  statements.push(
    database
      .select({
        guard: sql`json(CASE WHEN ${exists(
          database
            .select({ ok: sql`1` })
            .from(schema.applicantOperation)
            .where(eq(schema.applicantOperation.id, id))
        )} AND ${exists(
          database
            .select({ ok: sql`1` })
            .from(schema.auditEvent)
            .where(
              and(
                eq(schema.auditEvent.id, id),
                eq(schema.auditEvent.action, input.action),
                eq(schema.auditEvent.actorUserId, actor.userId),
                eq(schema.auditEvent.targetUserId, actor.userId)
              )
            )
        )} AND ${exists(
          database
            .select({ ok: sql`1` })
            .from(schema.membershipApplication)
            .where(
              and(
                eq(schema.membershipApplication.id, applicationId),
                eq(schema.membershipApplication.userId, actor.userId),
                eq(schema.membershipApplication.status, expectedStatus)
              )
            )
        )} THEN 'null' ELSE 'Incomplete applicant operation' END)`,
      })
      .from(schema.user)
      .limit(1)
  );
  if (input.action === "application_corrected") {
    statements.push(
      database
        .select({
          guard: sql`json(CASE WHEN ${exists(
            database
              .select({ ok: sql`1` })
              .from(schema.user)
              .innerJoin(
                schema.personProfile,
                eq(schema.personProfile.userId, schema.user.id)
              )
              .where(
                and(
                  eq(schema.user.id, actor.userId),
                  eq(schema.user.name, input.fullName),
                  eq(schema.user.email, input.email),
                  eq(schema.personProfile.phone, input.phone),
                  eq(schema.personProfile.phoneShared, false),
                  eq(
                    schema.personProfile.nameLookupKey,
                    canonicalNameKey(input.fullName)
                  ),
                  or(
                    eq(schema.user.email, previous.email),
                    eq(schema.user.emailVerified, false)
                  )
                )
              )
          )} THEN 'null' ELSE 'Incomplete applicant correction' END)`,
        })
        .from(schema.user)
        .limit(1)
    );
  }
  try {
    await database.batch(statements);
  } catch (error) {
    const committed = await findReceipt(
      database,
      actor.userId,
      input.operationKey
    );
    if (committed) {
      return { created: false, receipt: matching(committed, hash) };
    }
    const current = await getApplicantState(headers);
    if (!current.eligible) {
      throw denied();
    }
    if (
      current.application?.id !== previous.id ||
      current.application.status !== previous.status
    ) {
      throw conflict();
    }
    if (
      input.action === "application_corrected" &&
      (await hasContactConflict(database, actor, input))
    ) {
      throw conflict();
    }
    throw error;
  }
  await getCredentialActor(headers);
  const committed = await findReceipt(
    database,
    actor.userId,
    input.operationKey
  );
  if (!committed) {
    throw new Error("Missing applicant receipt");
  }
  return { created: true, receipt: matching(committed, hash) };
};

export const reconcileApplicantAction = async (
  headers: Headers,
  key: string
) => {
  const database = getDb();
  const actor = await getCredentialActor(headers);
  const receipt = await findReceipt(database, actor.userId, key);
  await getCredentialActor(headers);
  return receipt ? project(receipt) : null;
};
