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
