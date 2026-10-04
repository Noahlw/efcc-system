import type { MembershipStatus } from "@/server/db/schema/identity";

const labels: Record<MembershipStatus, string> = {
  active: "已批准",
  deactivated: "已停用",
  pending: "待批核",
};

export const membershipStatusLabel = (status: MembershipStatus): string =>
  labels[status];
