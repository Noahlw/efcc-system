import Link from "next/link";

import type { ProtectedPagePath } from "@/shared/protected-pages";

/** Only delivered destinations that the current access decision permits. */
export const PrimaryNavigation = ({
  accessAllowed,
  canManageAccounts = false,
  currentPath,
}: {
  accessAllowed: boolean;
  canManageAccounts?: boolean;
  currentPath: ProtectedPagePath;
}) => {
  const links = [
    ...(accessAllowed ? [{ href: "/", label: "主頁" }] : []),
    { href: "/status", label: "帳戶狀態" },
    { href: "/application", label: "我的申請" },
    { href: "/inbox", label: "收件匣" },
    ...(canManageAccounts
      ? [
          { href: "/staff/applications", label: "審批申請" },
          { href: "/staff/account-audit", label: "帳戶紀錄" },
        ]
      : []),
  ];
  return (
    <nav aria-label="主要導覽" className="mt-6 flex flex-wrap gap-2">
      {links.map((link) => (
        <Link
          key={link.href}
          aria-current={currentPath === link.href ? "page" : undefined}
          className="bg-muted text-foreground inline-flex min-h-11 min-w-11 items-center justify-center rounded-md px-4 text-base font-medium"
          href={link.href}
          prefetch={false}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
};
