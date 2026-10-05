import Link from "next/link";

import type { ProtectedPagePath } from "@/shared/protected-pages";

/** Only delivered destinations that the current access decision permits. */
export const PrimaryNavigation = ({
  accessAllowed,
  canManageAccounts = false,
  currentPath,
  passwordChangeRequired = false,
  variant = "legacy",
}: {
  accessAllowed: boolean;
  canManageAccounts?: boolean;
  currentPath: ProtectedPagePath;
  passwordChangeRequired?: boolean;
  variant?: "legacy" | "root";
}) => {
  if (variant === "root") {
    const links = passwordChangeRequired
      ? [{ href: "/account", label: "帳戶" as const }]
      : [
          ...(accessAllowed ? [{ href: "/", label: "主頁" as const }] : []),
          { href: "/inbox", label: "收件匣" as const },
          { href: "/account", label: "帳戶" as const },
          ...(canManageAccounts
            ? [{ href: "/staff/accounts", label: "管理" as const }]
            : []),
        ];

    return (
      <nav
        aria-label="主要導覽"
        className="border-border bg-surface/95 fixed inset-x-0 bottom-0 z-50 border-t px-2 pt-2 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:inset-y-0 lg:right-auto lg:w-64 lg:border-t-0 lg:border-r lg:px-4 lg:py-6 lg:backdrop-blur-none"
      >
        <p className="text-section hidden px-3 font-semibold lg:mb-6 lg:block">
          顯恩堂系統
        </p>
        <div className="mx-auto flex w-full max-w-xl items-stretch gap-1 lg:mx-0 lg:max-w-none lg:flex-col lg:gap-2">
          {links.map((link) => (
            <Link
              key={link.href}
              aria-current={currentPath === link.href ? "page" : undefined}
              className={`${
                currentPath === link.href
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              } text-meta inline-flex min-h-12 min-w-0 flex-1 items-center justify-center rounded-lg px-1 text-center leading-tight font-medium transition-colors focus-visible:outline-2 lg:flex-none lg:justify-start lg:px-3 lg:text-base`}
              href={link.href}
              prefetch={false}
            >
              {link.label}
            </Link>
          ))}
        </div>
      </nav>
    );
  }

  const links = passwordChangeRequired
    ? [{ href: "/account", label: "帳戶安全" }]
    : [
        ...(accessAllowed ? [{ href: "/", label: "主頁" }] : []),
        { href: "/status", label: "帳戶狀態" },
        { href: "/account", label: "帳戶安全" },
        { href: "/application", label: "我的申請" },
        { href: "/inbox", label: "收件匣" },
        ...(canManageAccounts
          ? [
              { href: "/staff/accounts", label: "管理帳戶" },
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
          className="bg-muted text-foreground inline-flex min-h-12 min-w-12 items-center justify-center rounded-md px-4 text-base font-medium"
          href={link.href}
          prefetch={false}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
};
