import { and, eq, gt, isNotNull, isNull, ne } from "drizzle-orm";

import { getDb } from "../../server/db/client";
import { account, session } from "../../server/db/schema/auth";
import type { AccountRole } from "../../server/db/schema/identity";
import { personProfile } from "../../server/db/schema/identity";
import { BusinessApiError } from "./business-request";

export interface AccountActor {
  userId: string;
  sessionId: string;
}

export const accountActor = (headers: Headers): AccountActor => {
  const userId = headers.get("x-efcc-user-id");
  const sessionId = headers.get("x-efcc-session-id");
  if (!userId || !sessionId) {
    throw new BusinessApiError(401, "unauthorized", "請先登入。");
  }
  const expectedActor = headers.get("x-efcc-expected-actor-id");
  if (expectedActor !== null && expectedActor !== userId) {
    throw new BusinessApiError(
      409,
      "actor_changed",
      "登入帳戶已改變，未有執行此請求。請以原帳戶登入查核。"
    );
  }
  return { sessionId, userId };
};

/** Own business reads and receipt recovery exclude Ban and Deactivated state. */
export const requireOwnBusinessAccess = async (headers: Headers) => {
  const actor = accountActor(headers);
  const current = await getDb()
    .select({
      bannedAt: personProfile.bannedAt,
      membershipStatus: personProfile.membershipStatus,
      temporaryPasswordExpiresAt: account.temporaryPasswordExpiresAt,
    })
    .from(session)
    .innerJoin(
      account,
      and(
        eq(account.userId, session.userId),
        eq(account.accountId, session.userId),
        eq(account.providerId, "credential"),
        isNotNull(account.password),
        ne(account.password, ""),
        eq(session.credentialRevision, account.credentialRevision)
      )
    )
    .leftJoin(personProfile, eq(personProfile.userId, session.userId))
    .where(
      and(
        eq(session.id, actor.sessionId),
        eq(session.userId, actor.userId),
        gt(session.expiresAt, new Date())
      )
    )
    .get();
  if (!current) {
    throw new BusinessApiError(401, "unauthorized", "請重新登入。");
  }
  if (
    current.membershipStatus === null ||
    current.membershipStatus === "deactivated" ||
    current.bannedAt !== null ||
    current.temporaryPasswordExpiresAt !== null
  ) {
    throw new BusinessApiError(
      403,
      "business_access_denied",
      "此帳戶目前不能查看或修改教會資料。"
    );
  }
  return actor;
};

/** Authorized Staff/Admin session actor; business authority is re-checked per request. */
export interface StaffActor extends AccountActor {
  role: Exclude<AccountRole, "member">;
}

export const requireStaff = async (headers: Headers): Promise<StaffActor> => {
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
        isNotNull(account.password),
        ne(account.password, ""),
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
    throw new BusinessApiError(401, "unauthorized", "請重新登入。");
  }
  if (
    current.membershipStatus !== "active" ||
    current.bannedAt !== null ||
    (current.role !== "staff" && current.role !== "admin")
  ) {
    throw new BusinessApiError(
      403,
      "business_access_denied",
      "你沒有帳戶管理權限。"
    );
  }
  return { ...actor, role: current.role };
};
