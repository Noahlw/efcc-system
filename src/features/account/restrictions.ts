import { env } from "cloudflare:workers";
import * as z from "zod";

import {
  findAccountChange,
  fingerprintAccountChange,
  matchingAccountChange,
  recordAccountChange,
  sensitiveStaffAssertion,
} from "./account-changes";
import type { AccountChangeReceipt } from "./account-changes";
import { ApplicationRequestError, readBoundedJson } from "./applications";
import { requireManagedAccount, requireSensitiveStaff } from "./staff-accounts";

const schema = z.strictObject({
  action: z.enum([
    "account_banned",
    "account_unbanned",
    "membership_deactivated",
    "membership_reactivated",
  ]),
  operationKey: z.uuid().transform((value) => value.toLowerCase()),
  targetUserId: z.string().min(1).max(128),
});
type Input = z.infer<typeof schema>;
const conflict = () =>
  new ApplicationRequestError(
    409,
    "conflict",
    "帳戶限制狀態已改變，請重新查核。"
  );
export const parseRestrictionRequest = async (request: Request) => {
  const parsed = schema.safeParse(await readBoundedJson(request));
  if (!parsed.success) {
    throw new ApplicationRequestError(
      400,
      "validation_error",
      "帳戶限制操作格式不正確。"
    );
  }
  return parsed.data;
};
const eligible = (
  action: Input["action"],
  target: Awaited<ReturnType<typeof requireManagedAccount>>
) => {
  if (action === "account_banned") {
    return target.banned === null;
  }
  if (action === "account_unbanned") {
    return target.banned !== null;
  }
  if (action === "membership_deactivated") {
    return target.membershipStatus === "active";
  }
  return target.membershipStatus === "deactivated";
};
export const effectiveAdminSql = `SELECT 1 FROM person_profile p INNER JOIN account a ON a.user_id=p.user_id AND a.account_id=p.user_id AND a.provider_id='credential'
 WHERE p.user_id<>? AND p.account_role='admin' AND p.membership_status='active' AND p.banned_at IS NULL AND a.password IS NOT NULL AND a.temporary_password_expires_at IS NULL`;
export const lastAdminError = () =>
  new ApplicationRequestError(
    409,
    "last_effective_admin",
    "不能移除最後一個可用管理員，請先保留另一個可管理系統的管理員。"
  );
export const changeAccountRestriction = async (
  headers: Headers,
  input: Input
) => {
  const actor = await requireSensitiveStaff(headers);
  const hash = await fingerprintAccountChange(
    actor.userId,
    input.action,
    input
  );
  const existing = await findAccountChange(actor.userId, input.operationKey);
  if (existing) {
    return { created: false, receipt: matchingAccountChange(existing, hash) };
  }
  const target = await requireManagedAccount(actor, input.targetUserId);
  if (!eligible(input.action, target)) {
    const committed = await findAccountChange(actor.userId, input.operationKey);
    if (committed) {
      return {
        created: false,
        receipt: matchingAccountChange(committed, hash),
      };
    }
    throw conflict();
  }
  const receipt: AccountChangeReceipt = {
    action: input.action,
    createdAt: Math.floor(Date.now() / 1000),
    id: crypto.randomUUID(),
    targetUserId: target.userId,
  };
  let membership = target.membershipStatus;
  let ban = target.banned;
  if (input.action === "account_banned") {
    ban = receipt.createdAt;
  }
  if (input.action === "account_unbanned") {
    ban = null;
  }
  if (input.action === "membership_deactivated") {
    membership = "deactivated";
  }
  if (input.action === "membership_reactivated") {
    membership = "active";
  }
  try {
    await env.DB.batch([
      sensitiveStaffAssertion(actor, target.userId),
      env.DB.prepare(
        `SELECT json(CASE WHEN EXISTS(SELECT 1 FROM person_profile WHERE user_id=? AND membership_status=? AND banned_at IS ?) THEN 'null' ELSE 'Restriction state changed' END)`
      ).bind(target.userId, target.membershipStatus, target.banned),
      env.DB.prepare(
        `UPDATE person_profile SET membership_status=?,banned_at=?,updated_at=? WHERE user_id=?`
      ).bind(membership, ban, receipt.createdAt, target.userId),
      ...recordAccountChange(
        receipt,
        actor.userId,
        input.operationKey,
        hash,
        null
      ),
      env.DB.prepare(
        `SELECT json(CASE WHEN EXISTS(SELECT 1 FROM person_profile WHERE user_id=? AND membership_status=? AND banned_at IS ?) THEN 'null' ELSE 'Incomplete restriction change' END)`
      ).bind(target.userId, membership, ban),
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
    if (
      current.membershipStatus !== target.membershipStatus ||
      current.banned !== target.banned
    ) {
      throw conflict();
    }
    if (
      target.role === "admin" &&
      ["account_banned", "membership_deactivated"].includes(input.action)
    ) {
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
