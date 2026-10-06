import { env } from "cloudflare:workers";

import { requireStaff } from "./decisions";

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
