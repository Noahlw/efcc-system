import { createHash } from "node:crypto";

import { env } from "cloudflare:workers";
import * as z from "zod";

import { canonicalNameKey } from "../identity/name-matching";
import {
  ApplicationRequestError,
  accountIdentitySchema,
  readBoundedJson,
} from "./applications";
import { getOwnApplication } from "./decisions";
import { getCredentialActor } from "./security";

const operationSchema = z.strictObject({
  operationKey: z.uuid().transform((value) => value.toLowerCase()),
});
const actionSchema = z.discriminatedUnion("action", [
  operationSchema.extend({
    action: z.literal("application_corrected"),
    applicationId: z.uuid(),
    ...accountIdentitySchema.pick({ email: true, fullName: true, phone: true })
      .shape,
  }),
  operationSchema.extend({
    action: z.literal("application_withdrawn"),
    applicationId: z.uuid(),
  }),
  operationSchema.extend({
    action: z.literal("application_resubmitted"),
    applicationId: z.uuid(),
  }),
]);
type Input = z.infer<typeof actionSchema>;
export interface ApplicantReceipt {
  id: string;
  action: Input["action"];
  applicationId: string;
  createdAt: number;
}
interface ReceiptRow extends ApplicantReceipt {
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
export const parseApplicantAction = async (request: Request) => {
  const input = actionSchema.safeParse(await readBoundedJson(request));
  if (!input.success) {
    throw new ApplicationRequestError(
      400,
      "validation_error",
      "申請操作資料格式不正確。"
    );
  }
  return input.data;
};
export const parseApplicantReconciliation = async (request: Request) => {
  const input = operationSchema.safeParse(await readBoundedJson(request));
  if (!input.success) {
    throw new ApplicationRequestError(
      400,
      "validation_error",
      "操作代碼格式不正確。"
    );
  }
  return input.data;
};

// Both the initial read and the batch assertion use durable approval history.
const eligibleSql = `SELECT 1 FROM person_profile p INNER JOIN session s ON s.user_id=p.user_id
 INNER JOIN account c ON c.user_id=p.user_id AND c.account_id=p.user_id AND c.provider_id='credential'
 WHERE p.user_id=? AND s.id=? AND s.expires_at>CAST(strftime('%s','now') AS INTEGER)
 AND c.credential_revision=s.credential_revision AND c.temporary_password_expires_at IS NULL
 AND p.account_role='member' AND p.membership_status='pending'
 AND NOT EXISTS(SELECT 1 FROM membership_application WHERE user_id=p.user_id AND status='approved')
 AND NOT EXISTS(SELECT 1 FROM application_decision WHERE target_user_id=p.user_id AND outcome='approved')
 AND NOT EXISTS(SELECT 1 FROM staff_account_operation WHERE target_user_id=p.user_id AND action='assisted_account_created')`;
export const getApplicantState = async (headers: Headers) => {
  const actor = await getCredentialActor(headers);
  const eligible = await env.DB.prepare(eligibleSql)
    .bind(actor.userId, actor.sessionId)
    .first();
  const application = await getOwnApplication(headers);
  return {
    actorUserId: actor.userId,
    application,
    eligible: !!eligible && !!application && application.status !== "approved",
  };
};
const findReceipt = (userId: string, key: string) =>
  env.DB.prepare(
    `SELECT id,action,application_id AS applicationId,created_at AS createdAt,request_hash AS requestHash FROM applicant_operation WHERE user_id=? AND operation_key=?`
  )
    .bind(userId, key)
    .first<ReceiptRow>();
const project = ({
  id,
  action,
  applicationId,
  createdAt,
}: ReceiptRow): ApplicantReceipt => ({ action, applicationId, createdAt, id });
const matching = (row: ReceiptRow, hash: string) => {
  if (row.requestHash !== hash) {
    throw conflict();
  }
  return project(row);
};
export const createApplicantAction = async (headers: Headers, input: Input) => {
  const actor = await getCredentialActor(headers);
  const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const state = await getApplicantState(headers);
  const existing = await findReceipt(actor.userId, input.operationKey);
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
  const statements = [
    env.DB.prepare(
      `SELECT json(CASE WHEN EXISTS(${eligibleSql}) AND EXISTS(SELECT 1 FROM membership_application WHERE id=? AND user_id=? AND status=? AND id=(SELECT id FROM membership_application WHERE user_id=? ORDER BY rowid DESC LIMIT 1)) THEN 'null' ELSE 'Applicant state changed' END)`
    ).bind(
      actor.userId,
      actor.sessionId,
      previous.id,
      actor.userId,
      previous.status,
      actor.userId
    ),
  ];
  if (input.action === "application_corrected") {
    statements.push(
      env.DB.prepare(
        `UPDATE user SET name=?,email=?,email_verified=CASE WHEN email<>? THEN 0 ELSE email_verified END,updated_at=? WHERE id=?`
      ).bind(input.fullName, input.email, input.email, now, actor.userId),
      env.DB.prepare(
        `UPDATE person_profile SET name_lookup_key=?,phone=?,phone_shared=0,updated_at=? WHERE user_id=?`
      ).bind(canonicalNameKey(input.fullName), input.phone, now, actor.userId)
    );
  } else if (input.action === "application_withdrawn") {
    statements.push(
      env.DB.prepare(
        `UPDATE membership_application SET status='withdrawn' WHERE id=? AND status='pending'`
      ).bind(previous.id)
    );
  } else {
    statements.push(
      env.DB.prepare(
        `INSERT INTO membership_application (id,user_id,status,created_at,operation_key_hash,request_hash,referral_note,group_note,intent_note) SELECT ?,user_id,'pending',?, ?,?,referral_note,group_note,intent_note FROM membership_application WHERE id=?`
      ).bind(
        applicationId,
        now,
        createHash("sha256").update(input.operationKey).digest("hex"),
        hash,
        previous.id
      )
    );
  }
  statements.push(
    env.DB.prepare(
      `INSERT INTO audit_event (id,actor_user_id,target_user_id,action,created_at) VALUES(?,?,?,?,?)`
    ).bind(id, actor.userId, actor.userId, input.action, now),
    env.DB.prepare(
      `INSERT INTO applicant_operation (id,user_id,operation_key,request_hash,action,application_id,created_at) VALUES(?,?,?,?,?,?,?)`
    ).bind(
      id,
      actor.userId,
      input.operationKey,
      hash,
      input.action,
      applicationId,
      now
    )
  );
  const expectedStatus = {
    application_corrected: previous.status,
    application_resubmitted: "pending",
    application_withdrawn: "withdrawn",
  }[input.action];
  statements.push(
    env.DB.prepare(
      `SELECT json(CASE WHEN EXISTS(SELECT 1 FROM applicant_operation WHERE id=?) AND EXISTS(SELECT 1 FROM audit_event WHERE id=? AND action=? AND actor_user_id=? AND target_user_id=?) AND EXISTS(SELECT 1 FROM membership_application WHERE id=? AND user_id=? AND status=?) THEN 'null' ELSE 'Incomplete applicant operation' END)`
    ).bind(
      id,
      id,
      input.action,
      actor.userId,
      actor.userId,
      applicationId,
      actor.userId,
      expectedStatus
    )
  );
  if (input.action === "application_corrected") {
    statements.push(
      env.DB.prepare(
        `SELECT json(CASE WHEN EXISTS(SELECT 1 FROM user u INNER JOIN person_profile p ON p.user_id=u.id WHERE u.id=? AND u.name=? AND u.email=? AND p.phone=? AND p.phone_shared=0 AND p.name_lookup_key=? AND (u.email=? OR u.email_verified=0)) THEN 'null' ELSE 'Incomplete applicant correction' END)`
      ).bind(
        actor.userId,
        input.fullName,
        input.email,
        input.phone,
        canonicalNameKey(input.fullName),
        previous.email
      )
    );
  }
  try {
    await env.DB.batch(statements);
  } catch (error) {
    const committed = await findReceipt(actor.userId, input.operationKey);
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
    if (input.action === "application_corrected") {
      const duplicate = await env.DB.prepare(
        `SELECT 1 FROM user u WHERE u.id<>? AND lower(trim(u.email))=? UNION ALL SELECT 1 FROM person_profile WHERE user_id<>? AND phone=? LIMIT 1`
      )
        .bind(actor.userId, input.email, actor.userId, input.phone)
        .first();
      if (duplicate) {
        throw conflict();
      }
    }
    throw error;
  }
  await getCredentialActor(headers);
  const committed = await findReceipt(actor.userId, input.operationKey);
  if (!committed) {
    throw new Error("Missing applicant receipt");
  }
  return { created: true, receipt: matching(committed, hash) };
};
export const reconcileApplicantAction = async (
  headers: Headers,
  key: string
) => {
  const actor = await getCredentialActor(headers);
  const receipt = await findReceipt(actor.userId, key);
  await getCredentialActor(headers);
  return receipt ? project(receipt) : null;
};
