/**
 * Synthetic local fixtures for the Worker/D1/browser acceptance harness.
 * These are disposable local records created through Better Auth's trusted
 * server API; they never represent real members.
 */
export type SeedMembershipStatus = "pending" | "active" | "deactivated";

export interface SyntheticAccount {
  username: string;
  password: string;
  fullName: string;
  email: string;
  membershipStatus: SeedMembershipStatus;
  banned?: boolean;
}

export const approvedAccounts: SyntheticAccount[] = [
  {
    email: "wong.tai.ming@example.invalid",
    fullName: "黃大明",
    membershipStatus: "active",
    password: "Synthetic!Pass1",
    username: "wong.tai.ming",
  },
  {
    email: "Chan.Siu.Fong@example.invalid",
    fullName: "陳小芳",
    membershipStatus: "active",
    password: "Synthetic!Pass2",
    username: "Chan.Siu.Fong",
  },
  {
    // Shares 黃大明 exactly: name sign-in must report ambiguity, not pick one.
    email: "wong.tai.ming.two@example.invalid",
    fullName: "黃大明",
    membershipStatus: "active",
    password: "Synthetic!Pass5",
    username: "wong.tai.ming.two",
  },
  {
    // Simplified 陈 stays distinct from Traditional 陳.
    email: "chen.simplified@example.invalid",
    fullName: "陈小芳",
    membershipStatus: "active",
    password: "Synthetic!Pass6",
    username: "chen.simplified",
  },
  {
    // Latin letters exercise trim, full-width mapping and case-insensitivity.
    email: "ng.wing.yan@example.invalid",
    fullName: "Ng Wing Yan 吳詠恩",
    membershipStatus: "active",
    password: "Synthetic!Pass7",
    username: "ng.wing.yan",
  },
];

export const restrictedAccounts: SyntheticAccount[] = [
  {
    email: "law.pending@example.invalid",
    fullName: "羅待批",
    membershipStatus: "pending",
    password: "Synthetic!Pass3",
    username: "law.pending",
  },
  {
    banned: true,
    email: "lee.banned@example.invalid",
    fullName: "李停用",
    membershipStatus: "deactivated",
    password: "Synthetic!Pass4",
    username: "lee.banned",
  },
];

export const allAccounts: SyntheticAccount[] = [
  ...approvedAccounts,
  ...restrictedAccounts,
];

/** Fails loudly instead of returning undefined when a fixture name drifts. */
export const findAccount = (
  accounts: SyntheticAccount[],
  username: string
): SyntheticAccount => {
  const found = accounts.find((account) => account.username === username);
  if (!found) {
    throw new Error(`Missing synthetic account ${username}`);
  }
  return found;
};
