import { createHash } from "node:crypto";

import { env } from "cloudflare:workers";
import * as z from "zod";

import { requireWrittenReceipt } from "../../server/db/required-receipt";
import { ApplicationRequestError, readBoundedJson } from "./applications";

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
  const row = await env.DB.prepare(
    `SELECT a.id, a.status, a.created_at AS createdAt,
       u.name AS fullName, u.display_username AS username, u.email, p.phone
     FROM session s
     INNER JOIN user u ON u.id = s.user_id
     LEFT JOIN person_profile p ON p.user_id = u.id
     LEFT JOIN membership_application a ON a.id = (
       SELECT id FROM membership_application
       WHERE user_id = u.id ORDER BY rowid DESC LIMIT 1
     )
     WHERE s.id = ? AND s.user_id = ?
       AND s.expires_at > CAST(strftime('%s', 'now') AS INTEGER)`
  )
    .bind(actor.sessionId, actor.userId)
    .first<OwnApplication>();
  if (!row) {
    throw new ApplicationRequestError(401, "unauthorized", "請重新登入。");
  }
  return row.id ? row : null;
};

export const requireStaff = async (headers: Headers) => {
  const actor = accountActor(headers);
  const current = await env.DB.prepare(
    `SELECT p.account_role AS role, p.membership_status AS membership, p.banned_at AS banned
     FROM session s LEFT JOIN person_profile p ON p.user_id = s.user_id
     INNER JOIN account a ON a.user_id=s.user_id AND a.account_id=s.user_id AND a.provider_id='credential'
       AND a.temporary_password_expires_at IS NULL AND a.credential_revision=s.credential_revision
     WHERE s.id = ? AND s.user_id = ?
       AND s.expires_at > CAST(strftime('%s', 'now') AS INTEGER)`
  )
    .bind(actor.sessionId, actor.userId)
    .first<{
      role: "member" | "staff" | "admin" | null;
      membership: string | null;
      banned: number | null;
    }>();
  if (!current) {
    throw new ApplicationRequestError(401, "unauthorized", "請重新登入。");
  }
  if (
    current.membership !== "active" ||
    current.banned !== null ||
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
  const rows = await env.DB.prepare(
    `SELECT a.id, a.user_id AS userId, a.status, a.created_at AS createdAt,
       u.name AS fullName, u.display_username AS username, u.email, target.phone,
       a.group_note AS groupNote, a.intent_note AS intentNote, a.referral_note AS referralNote
     FROM membership_application a
     INNER JOIN user u ON u.id = a.user_id
     INNER JOIN person_profile target ON target.user_id = a.user_id
     INNER JOIN person_profile actor ON actor.user_id = ?
     INNER JOIN session s ON s.user_id = actor.user_id AND s.id = ?
     WHERE a.status = 'pending' AND target.membership_status = 'pending'
       AND target.banned_at IS NULL AND target.user_id <> actor.user_id
       AND actor.membership_status = 'active' AND actor.banned_at IS NULL
       AND (actor.account_role = 'admin' OR
         (actor.account_role = 'staff' AND target.account_role = 'member'))
       AND s.expires_at > CAST(strftime('%s', 'now') AS INTEGER)
       AND a.id = (SELECT id FROM membership_application WHERE user_id = a.user_id
         ORDER BY rowid DESC LIMIT 1)
     ORDER BY a.created_at, a.id`
  )
    .bind(actor.userId, actor.sessionId)
    .all<PendingApplication>();
  return rows.results;
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
  const rows = await env.DB.prepare(
    `SELECT d.id, d.application_id AS applicationId, d.outcome,
       d.visible_reason AS visibleReason, d.created_at AS createdAt
     FROM session s LEFT JOIN application_decision d ON d.target_user_id = s.user_id
     WHERE s.id = ? AND s.user_id = ?
       AND s.expires_at > CAST(strftime('%s', 'now') AS INTEGER)
     ORDER BY d.created_at DESC, d.id DESC`
  )
    .bind(actor.sessionId, actor.userId)
    .all<ApplicantDecision>();
  if (rows.results.length === 0) {
    throw new ApplicationRequestError(401, "unauthorized", "請重新登入。");
  }
  return rows.results.filter((row) => row.id !== null);
};

export interface AccountAudit {
  id: string;
  actorUserId: string;
  targetUserId: string;
  action: string;
  createdAt: number;
  internalNote: string | null;
}

export const getAccountAudit = async (
  headers: Headers
): Promise<AccountAudit[]> => {
  const actor = await requireStaff(headers);
  const rows = await env.DB.prepare(
    `SELECT e.id, e.actor_user_id AS actorUserId, e.target_user_id AS targetUserId,
       e.action, e.created_at AS createdAt, d.internal_note AS internalNote
     FROM audit_event e LEFT JOIN application_decision d ON d.id = e.id
     WHERE EXISTS (SELECT 1 FROM session s INNER JOIN person_profile p ON p.user_id = s.user_id
       WHERE s.id = ? AND s.user_id = ?
         AND s.expires_at > CAST(strftime('%s', 'now') AS INTEGER)
         AND p.membership_status = 'active' AND p.banned_at IS NULL
         AND p.account_role IN ('staff', 'admin'))
     ORDER BY e.created_at DESC, e.id DESC`
  )
    .bind(actor.sessionId, actor.userId)
    .all<AccountAudit>();
  return rows.results;
};

const decisionNote = z
  .string()
  .trim()
  .max(1000)
  .refine((value) => [...value].length <= 500)
  .optional()
  .transform((value) => value || null);
const decisionSchema = z
  .strictObject({
    applicationId: z.uuid(),
    internalNote: decisionNote,
    operationKey: z.uuid().transform((value) => value.toLowerCase()),
    outcome: z.enum(["approved", "rejected"]),
    visibleReason: decisionNote,
  })
  .refine(
    (input) => input.outcome !== "rejected" || input.visibleReason !== null
  );
const decisionReconciliationSchema = z.strictObject({
  applicationId: z.uuid().optional(),
  operationKey: z.uuid().transform((value) => value.toLowerCase()),
});

export const parseDecisionRequest = async (request: Request) => {
  const parsed = decisionSchema.safeParse(await readBoundedJson(request));
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

const findDecision = (actor: AccountActor, operationKey: string) =>
  env.DB.prepare(
    `SELECT d.id, d.application_id AS applicationId, d.outcome,
       d.visible_reason AS visibleReason, d.created_at AS createdAt,
       d.actor_user_id AS actorUserId, d.target_user_id AS targetUserId,
       d.internal_note AS internalNote, d.request_hash AS requestHash
     FROM application_decision d WHERE d.actor_user_id = ? AND d.operation_key = ?
       AND EXISTS (SELECT 1 FROM session s INNER JOIN person_profile p ON p.user_id = s.user_id
         WHERE s.id = ? AND s.user_id = ?
           AND s.expires_at > CAST(strftime('%s', 'now') AS INTEGER)
           AND p.membership_status = 'active' AND p.banned_at IS NULL
           AND p.account_role IN ('staff', 'admin'))`
  )
    .bind(actor.userId, operationKey, actor.sessionId, actor.userId)
    .first<StaffDecision & { requestHash: string }>();

const decisionProjection = (
  row: StaffDecision & { requestHash: string }
): StaffDecision => {
  const { requestHash: _requestHash, ...decision } = row;
  return decision;
};

const decisionConflict = () =>
  new ApplicationRequestError(
    409,
    "conflict",
    "申請狀態已改變，或操作代碼已用於另一份決定。請重新查核。"
  );

const matchingDecision = (
  row: StaffDecision & { requestHash: string },
  requestHash: string
) => {
  if (row.requestHash !== requestHash) {
    throw decisionConflict();
  }
  return decisionProjection(row);
};

const assertDecisionTarget = async (
  actor: AccountActor & { role: "staff" | "admin" },
  applicationId: string
) => {
  const target = await env.DB.prepare(
    `SELECT a.user_id AS userId, a.status, p.account_role AS role,
       p.membership_status AS membership, p.banned_at AS banned
     FROM membership_application a INNER JOIN person_profile p ON p.user_id = a.user_id
     WHERE a.id = ? AND a.id = (SELECT id FROM membership_application
       WHERE user_id = a.user_id ORDER BY rowid DESC LIMIT 1)`
  )
    .bind(applicationId)
    .first<{
      userId: string;
      status: string;
      role: string;
      membership: string;
      banned: number | null;
    }>();
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
    target.banned !== null
  ) {
    throw decisionConflict();
  }
};

export const createApplicationDecision = async (
  headers: Headers,
  input: z.infer<typeof decisionSchema>
): Promise<{ decision: StaffDecision; created: boolean }> => {
  const actor = await requireStaff(headers);
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
  const existing = await findDecision(actor, input.operationKey);
  if (existing) {
    return {
      created: false,
      decision: matchingDecision(existing, requestHash),
    };
  }
  // This read supplies useful errors only; the conditional UPDATE owns authority.
  await assertDecisionTarget(actor, input.applicationId);
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  try {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE membership_application SET status = ?, decision_id = ?
         WHERE id = ? AND status = 'pending'
           AND id = (SELECT id FROM membership_application a
             WHERE a.user_id = membership_application.user_id ORDER BY rowid DESC LIMIT 1)
           AND EXISTS (SELECT 1 FROM session s
             INNER JOIN person_profile actor ON actor.user_id = s.user_id
             INNER JOIN person_profile target ON target.user_id = membership_application.user_id
             WHERE s.id = ? AND s.user_id = ?
               AND s.expires_at > CAST(strftime('%s', 'now') AS INTEGER)
               AND actor.membership_status = 'active' AND actor.banned_at IS NULL
               AND target.membership_status = 'pending' AND target.banned_at IS NULL
               AND target.user_id <> actor.user_id
               AND (actor.account_role = 'admin' OR
                 (actor.account_role = 'staff' AND target.account_role = 'member')))`
      ).bind(
        input.outcome,
        id,
        input.applicationId,
        actor.sessionId,
        actor.userId
      ),
      env.DB.prepare(
        `UPDATE person_profile SET membership_status = ?, updated_at = ?
         WHERE user_id = (SELECT user_id FROM membership_application WHERE id = ? AND decision_id = ?)`
      ).bind(
        input.outcome === "approved" ? "active" : "pending",
        now,
        input.applicationId,
        id
      ),
      env.DB.prepare(
        `INSERT INTO audit_event (action, actor_user_id, created_at, id, target_user_id)
         SELECT ?, ?, ?, ?, user_id FROM membership_application WHERE id = ? AND decision_id = ?`
      ).bind(
        `application_${input.outcome}`,
        actor.userId,
        now,
        id,
        input.applicationId,
        id
      ),
      env.DB.prepare(
        `INSERT INTO application_decision
           (actor_user_id, application_id, created_at, id, internal_note,
            operation_key, outcome, request_hash, target_user_id, visible_reason)
         SELECT ?, id, ?, ?, ?, ?, ?, ?, user_id, ? FROM membership_application
         WHERE id = ? AND decision_id = ?`
      ).bind(
        actor.userId,
        now,
        id,
        input.internalNote,
        input.operationKey,
        input.outcome,
        requestHash,
        input.visibleReason,
        input.applicationId,
        id
      ),
      requireWrittenReceipt("application_decision", id),
    ]);
  } catch (error) {
    const committed = await findDecision(actor, input.operationKey);
    if (committed) {
      return {
        created: false,
        decision: matchingDecision(committed, requestHash),
      };
    }
    await assertDecisionTarget(
      await requireStaff(headers),
      input.applicationId
    );
    throw error;
  }
  const committed = await findDecision(actor, input.operationKey);
  if (!committed) {
    const currentActor = await requireStaff(headers);
    await assertDecisionTarget(currentActor, input.applicationId);
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
  const committed = await findDecision(actor, operationKey);
  if (committed && applicationId && committed.applicationId !== applicationId) {
    throw decisionConflict();
  }
  let applicationStatus: OwnApplication["status"] | null | undefined;
  if (applicationId) {
    const application = await env.DB.prepare(
      `SELECT a.status FROM membership_application a WHERE a.id = ?
       AND EXISTS (SELECT 1 FROM session s INNER JOIN person_profile p ON p.user_id = s.user_id
         WHERE s.id = ? AND s.user_id = ?
           AND s.expires_at > CAST(strftime('%s', 'now') AS INTEGER)
           AND p.membership_status = 'active' AND p.banned_at IS NULL
           AND p.account_role IN ('staff', 'admin'))`
    )
      .bind(applicationId, actor.sessionId, actor.userId)
      .first<{ status: OwnApplication["status"] }>();
    applicationStatus = application?.status ?? null;
  }
  await requireStaff(headers);
  return {
    applicationStatus,
    decision: committed ? decisionProjection(committed) : null,
  };
};
