import { env } from "cloudflare:workers";
import * as z from "zod";

import type { AccountChangeReceipt } from "./account-guards";
import {
  findAccountChange,
  fingerprintAccountChange,
  matchingAccountChange,
  nativeRecordAccountChange,
  nativeSensitiveStaffAssertion,
} from "./account-guards";
import { ApplicationRequestError, readBoundedJson } from "./applications";
import { effectiveAdminSql, lastAdminError } from "./restrictions";
import { requireManagedAccount, requireSensitiveStaff } from "./staff-accounts";

const schema = z.strictObject({
  operationKey: z.uuid().transform((value) => value.toLowerCase()),
  targetUserId: z.string().min(1).max(128),
});
export const parseDeletionRequest = async (request: Request) => {
  const parsed = schema.safeParse(await readBoundedJson(request));
  if (!parsed.success) {
    throw new ApplicationRequestError(
      400,
      "validation_error",
      "刪除操作格式不正確。"
    );
  }
  return parsed.data;
};
const historySql = `SELECT 1 FROM enrolment WHERE user_id=? UNION ALL SELECT 1 FROM invitation WHERE user_id=? UNION ALL SELECT 1 FROM department_membership WHERE user_id=? UNION ALL SELECT 1 FROM department_manager_assignment WHERE user_id=? LIMIT 1`;
const historyExists = (id: string) =>
  env.DB.prepare(historySql).bind(id, id, id, id).first();
const historyError = () =>
  new ApplicationRequestError(
    409,
    "church_history_retained",
    "此帳戶有教會業務紀錄，不能永久刪除；請使用會籍停用。"
  );
const conflict = () =>
  new ApplicationRequestError(409, "conflict", "帳戶狀態已改變，請重新查核。");
export const deleteEligibleAccount = async (
  headers: Headers,
  input: z.infer<typeof schema>
) => {
  const actor = await requireSensitiveStaff(headers);
  const hash = await fingerprintAccountChange(
    actor.userId,
    "account_deleted",
    input
  );
  const existing = await findAccountChange(actor.userId, input.operationKey);
  if (existing) {
    return { created: false, receipt: matchingAccountChange(existing, hash) };
  }
  let target;
  try {
    target = await requireManagedAccount(actor, input.targetUserId);
  } catch (error) {
    const committed = await findAccountChange(actor.userId, input.operationKey);
    if (committed) {
      return {
        created: false,
        receipt: matchingAccountChange(committed, hash),
      };
    }
    throw error;
  }
  if (await historyExists(target.userId)) {
    throw historyError();
  }
  const receipt: AccountChangeReceipt = {
    action: "account_deleted",
    createdAt: Math.floor(Date.now() / 1000),
    id: crypto.randomUUID(),
    targetUserId: target.userId,
  };
  try {
    await env.DB.batch([
      nativeSensitiveStaffAssertion(actor, target.userId),
      env.DB.prepare(
        `SELECT json(CASE WHEN NOT EXISTS(${historySql}) AND EXISTS(SELECT 1 FROM person_profile p INNER JOIN account a ON a.user_id=p.user_id AND a.account_id=p.user_id AND a.provider_id='credential' WHERE p.user_id=? AND p.membership_status=? AND p.banned_at IS ? AND a.credential_revision=?) THEN 'null' ELSE 'Deletion eligibility changed' END)`
      ).bind(
        target.userId,
        target.userId,
        target.userId,
        target.userId,
        target.userId,
        target.membershipStatus,
        target.banned,
        target.credentialRevision
      ),
      env.DB.prepare(`DELETE FROM user WHERE id=?`).bind(target.userId),
      ...nativeRecordAccountChange(
        receipt,
        actor.userId,
        input.operationKey,
        hash,
        null
      ),
      env.DB.prepare(
        `SELECT json(CASE WHEN NOT EXISTS(SELECT 1 FROM user WHERE id=?) AND NOT EXISTS(SELECT 1 FROM account WHERE user_id=?) AND NOT EXISTS(SELECT 1 FROM session WHERE user_id=?) AND NOT EXISTS(SELECT 1 FROM person_profile WHERE user_id=?) THEN 'null' ELSE 'Incomplete account deletion' END)`
      ).bind(target.userId, target.userId, target.userId, target.userId),
    ]);
  } catch (error) {
    const committed = await findAccountChange(actor.userId, input.operationKey);
    if (committed) {
      return {
        created: false,
        receipt: matchingAccountChange(committed, hash),
      };
    }
    const currentActor = await requireSensitiveStaff(headers);
    const current = await requireManagedAccount(currentActor, target.userId);
    if (await historyExists(target.userId)) {
      throw historyError();
    }
    if (
      current.membershipStatus !== target.membershipStatus ||
      current.banned !== target.banned ||
      current.credentialRevision !== target.credentialRevision
    ) {
      throw conflict();
    }
    if (target.role === "admin") {
      const other = await env.DB.prepare(effectiveAdminSql)
        .bind(target.userId)
        .first();
      if (!other) {
        throw lastAdminError();
      }
    }
    throw error;
  }
  await requireSensitiveStaff(headers);
  return { created: true, receipt };
};
