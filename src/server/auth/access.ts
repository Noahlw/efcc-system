import { eq } from "drizzle-orm";

import { getDb } from "../db/client";
import type { MembershipStatus } from "../db/schema/identity";
import { personProfile } from "../db/schema/identity";
import { getAuth } from "./index";

export type RestrictionReason =
  | "membership_pending"
  | "membership_deactivated"
  | "security_ban"
  | "profile_missing";

export type AccessLevel = "anonymous" | "full" | "restricted";

export interface AccessDecision {
  level: AccessLevel;
  userId: string | null;
  sessionId: string | null;
  reasons: RestrictionReason[];
}

export interface AccessResolution {
  decision: AccessDecision;
  /** Raw Better Auth Set-Cookie values that must reach the browser unchanged. */
  setCookies: string[];
}

export const ANONYMOUS_ACCESS: AccessDecision = {
  level: "anonymous",
  reasons: [],
  sessionId: null,
  userId: null,
};

const restrictionReasons = (
  membershipStatus: MembershipStatus,
  banned: boolean
): RestrictionReason[] => {
  const reasons: RestrictionReason[] = [];
  if (membershipStatus === "pending") {
    reasons.push("membership_pending");
  }
  if (membershipStatus === "deactivated") {
    reasons.push("membership_deactivated");
  }
  if (banned) {
    reasons.push("security_ban");
  }
  return reasons;
};

const readSetCookies = (headers: Headers): string[] => {
  const { getSetCookie } = headers as Headers & {
    getSetCookie?: () => string[];
  };
  if (typeof getSetCookie === "function") {
    return getSetCookie.call(headers);
  }
  const single = headers.get("set-cookie");
  return single ? [single] : [];
};

const decide = (
  profile:
    | { bannedAt: Date | null; membershipStatus: MembershipStatus }
    | undefined,
  userId: string,
  sessionId: string
): AccessDecision => {
  if (!profile) {
    return {
      level: "restricted",
      reasons: ["profile_missing"],
      sessionId,
      userId,
    };
  }
  const reasons = restrictionReasons(
    profile.membershipStatus,
    profile.bannedAt !== null
  );
  return {
    level: reasons.length === 0 ? "full" : "restricted",
    reasons,
    sessionId,
    userId,
  };
};

/**
 * Authoritative per-request check: validates the native session (renewing the
 * 90-day idle window) and reads current EFCC membership/ban state from D1.
 * Fail closed: unknown profile state is restricted, never full access.
 */
export const resolveAccess = async (
  request: Request
): Promise<AccessResolution> => {
  const { headers, response } = await getAuth().api.getSession({
    headers: request.headers,
    returnHeaders: true,
  });
  const setCookies = readSetCookies(headers);
  if (!response) {
    return { decision: ANONYMOUS_ACCESS, setCookies };
  }

  const [profile] = await getDb()
    .select({
      bannedAt: personProfile.bannedAt,
      membershipStatus: personProfile.membershipStatus,
    })
    .from(personProfile)
    .where(eq(personProfile.userId, response.user.id))
    .limit(1);

  return {
    decision: decide(profile, response.user.id, response.session.id),
    setCookies,
  };
};
