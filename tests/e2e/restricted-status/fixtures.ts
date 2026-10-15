import type { ProvisionAccount } from "../../worker/provision";

type StatusAccount = ProvisionAccount & { userId: string };

const statusTitles = {
  membership_deactivated: "會籍已停用",
  membership_pending: "會籍待批核",
  security_ban: "帳戶已暫停使用",
} as const;

export { type StatusAccount, statusTitles };
