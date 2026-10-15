import { randomBytes } from "node:crypto";

import type { APIRequestContext } from "@playwright/test";

import { expect } from "../../support/fixtures";
import type { NativeApp } from "../../support/fixtures";

interface ApplicationInput {
  email: string;
  fullName: string;
  operationKey: string;
  password: string;
  phone: string;
  username: string;
}

const applicationInput = (): ApplicationInput => {
  const suffix = randomBytes(6).toString("hex");
  return {
    email: `decision.${suffix}@example.test`,
    fullName: `陳決定${suffix}`,
    operationKey: randomBytes(32).toString("hex"),
    password: "Synthetic-decision-password!",
    phone: String(60_000_000 + (Number.parseInt(suffix, 16) % 10_000_000)),
    username: `decision.${suffix}`,
  };
};

interface ApplicationIdentity {
  applicationId: string;
  userId: string;
}

const submitApplication = async (
  request: APIRequestContext,
  input: ApplicationInput
) => {
  const response = await request.post("/api/v2/applications", { data: input });
  expect(response.status()).toBe(201);
};

const applicationIdentity = async (
  app: NativeApp,
  username: string
): Promise<ApplicationIdentity> => {
  const row = await app.db
    .prepare(
      `select a.id as applicationId, a.user_id as userId
       from membership_application a
       join user u on u.id = a.user_id
       where u.username = ?`
    )
    .bind(username)
    .first<ApplicationIdentity>();
  if (!row) {
    throw new Error("Submitted synthetic application is missing from app D1");
  }
  return row;
};

interface ApplicationState {
  applicationId: string;
  decisionId: string | null;
  membershipStatus: string | null;
  status: string;
  targetRole: string | null;
  targetUserId: string;
}

interface DecisionRow {
  actorUserId: string;
  applicationId: string;
  createdAt: number;
  id: string;
  internalNote: string | null;
  operationKey: string;
  outcome: "approved" | "rejected";
  requestHash: string;
  targetUserId: string;
  visibleReason: string | null;
}

interface AuditRow {
  action: string;
  actorUserId: string;
  createdAt: number;
  id: string;
  targetUserId: string;
}

const decisionSnapshot = async (app: NativeApp, applicationId: string) => {
  const application = await app.db
    .prepare(
      `select a.id as applicationId, a.decision_id as decisionId, a.status,
              p.account_role as targetRole,
              p.membership_status as membershipStatus,
              a.user_id as targetUserId
       from membership_application a
       left join person_profile p on p.user_id = a.user_id
       where a.id = ?`
    )
    .bind(applicationId)
    .first<ApplicationState>();
  if (!application) {
    throw new Error("Synthetic application is missing from app D1");
  }
  const decisionRows = await app.db
    .prepare(
      `select actor_user_id as actorUserId,
                application_id as applicationId,
                created_at as createdAt, id,
                internal_note as internalNote,
                operation_key as operationKey, outcome,
                request_hash as requestHash,
                target_user_id as targetUserId,
                visible_reason as visibleReason
         from application_decision
         where application_id = ?`
    )
    .bind(applicationId)
    .all<DecisionRow>();
  const decisions = decisionRows.results;
  const auditRows = await app.db
    .prepare(
      `select action, actor_user_id as actorUserId,
                created_at as createdAt, id,
                target_user_id as targetUserId
         from audit_event
         where target_user_id = (
           select user_id from membership_application where id = ?
         )
           and action in ('application_approved', 'application_rejected')`
    )
    .bind(applicationId)
    .all<AuditRow>();
  const auditEvents = auditRows.results;
  return { application, auditEvents, decisions };
};

interface DecisionExpectation {
  actorUserId: string;
  applicationId: string;
  createdAt: number;
  decisionId: string;
  internalNote: string | null;
  operationKey: string;
  outcome: "approved" | "rejected";
  targetUserId: string;
  visibleReason: string | null;
}

const expectDecisionEffects = async (
  app: NativeApp,
  expected: DecisionExpectation
) => {
  const { actorUserId, applicationId, decisionId, outcome, targetUserId } =
    expected;
  const snapshot = await decisionSnapshot(app, applicationId);
  expect(snapshot.application).toEqual({
    applicationId,
    decisionId,
    membershipStatus: outcome === "approved" ? "active" : "pending",
    status: outcome,
    targetRole: "member",
    targetUserId,
  });
  expect(snapshot.decisions).toEqual([
    {
      actorUserId,
      applicationId,
      createdAt: expected.createdAt,
      id: decisionId,
      internalNote: expected.internalNote,
      operationKey: expected.operationKey,
      outcome,
      requestHash: expect.stringMatching(/^[\da-f]{64}$/u),
      targetUserId,
      visibleReason: expected.visibleReason,
    },
  ]);
  expect(snapshot.auditEvents).toEqual([
    {
      action: `application_${outcome}`,
      actorUserId,
      createdAt: expected.createdAt,
      id: decisionId,
      targetUserId,
    },
  ]);
  return snapshot;
};

export {
  type ApplicationInput,
  applicationInput,
  type ApplicationIdentity,
  submitApplication,
  applicationIdentity,
  type ApplicationState,
  type DecisionRow,
  type AuditRow,
  decisionSnapshot,
  type DecisionExpectation,
  expectDecisionEffects,
};
