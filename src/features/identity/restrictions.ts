import type { MembershipStatus } from "../../server/db/schema/identity";

export type RestrictionReason =
  | "membership_pending"
  | "membership_deactivated"
  | "security_ban"
  | "profile_missing";

/**
 * Current applicable EFCC restrictions for a person. Membership status and the
 * security ban are independent: unbanning never reactivates membership, and a
 * pending membership can coexist with a ban.
 *
 * Persisted membership state crosses a trust boundary and may be malformed
 * or written around the database CHECK, so only the exact `active`
 * value may leave this function without a restriction.
 */
export const restrictionReasons = (
  membershipStatus: MembershipStatus,
  banned: boolean
): RestrictionReason[] => {
  const reasons: RestrictionReason[] = [];
  switch (membershipStatus) {
    case "active": {
      break;
    }
    case "deactivated": {
      reasons.push("membership_deactivated");
      break;
    }
    case "pending": {
      reasons.push("membership_pending");
      break;
    }
    default: {
      // Unknown persisted values present as an unconfirmed status.
      reasons.push("profile_missing");
    }
  }
  if (banned) {
    reasons.push("security_ban");
  }
  return reasons;
};

interface RestrictionCopy {
  title: string;
  explanation: string;
}

export const restrictionCopy: Record<RestrictionReason, RestrictionCopy> = {
  membership_deactivated: {
    explanation: "你的會籍已停用，因此未能使用教會功能。",
    title: "會籍已停用",
  },
  membership_pending: {
    explanation: "你的會籍仍在批核中，批核後便會顯示你的個人資料。",
    title: "會籍待批核",
  },
  profile_missing: {
    explanation: "我們未能確認你的會籍狀態，請聯絡教會同工。",
    title: "會籍狀態待確認",
  },
  security_ban: {
    explanation: "你的帳戶已被暫停使用；解除暫停不會自動恢復會籍。",
    title: "帳戶已暫停使用",
  },
};

/** Stable order so combined restrictions always read the same way. */
export const restrictionOrder: RestrictionReason[] = [
  "membership_pending",
  "membership_deactivated",
  "security_ban",
  "profile_missing",
];
