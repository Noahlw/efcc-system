import { Icon } from "@/components/ui/icon";
import { TaskDepartureLink } from "@/components/unsaved-changes-link";
import type { ProtectedPagePath } from "@/shared/protected-pages";

import { ChurchBrand } from "./page-frame";

/** Only delivered destinations that the current access decision permits. */
export const PrimaryNavigation = ({
  accessAllowed,
  canManageAccounts = false,
  canManageProgramLeaders = false,
  currentPath,
  fullPageNavigation = false,
  manageHref,
  mobileHidden = false,
  passwordChangeRequired = false,
  signedInAs,
}: {
  accessAllowed: boolean;
  canManageAccounts?: boolean;
  canManageProgramLeaders?: boolean;
  currentPath: ProtectedPagePath;
  fullPageNavigation?: boolean;
  manageHref?: ProtectedPagePath;
  mobileHidden?: boolean;
  passwordChangeRequired?: boolean;
  signedInAs?: { displayName: string; subtitle?: string };
}) => {
  const links: {
    href: ProtectedPagePath;
    icon: "house" | "mail" | "settings" | "user";
    label: string;
  }[] = passwordChangeRequired
    ? [{ href: "/account", icon: "user", label: "帳戶" }]
    : [
        ...(accessAllowed
          ? [{ href: "/" as const, icon: "house" as const, label: "主頁" }]
          : []),
        { href: "/inbox", icon: "mail", label: "收件匣" },
        ...(canManageAccounts || canManageProgramLeaders || manageHref
          ? [
              {
                href:
                  manageHref ??
                  (canManageAccounts
                    ? ("/staff/accounts" as const)
                    : ("/roles/program-leaders" as const)),
                icon: "settings" as const,
                label: "管理",
              },
            ]
          : []),
        { href: "/account", icon: "user", label: "帳戶" },
      ];

  return (
    <nav
      aria-label="主要導覽"
      className={`${mobileHidden ? "hidden lg:flex " : ""}border-border bg-surface lg:bg-background sticky bottom-0 z-50 flex min-h-[4.5rem] w-full items-stretch justify-center border-t pb-[env(safe-area-inset-bottom)] lg:fixed lg:inset-y-0 lg:right-auto lg:left-0 lg:w-[var(--sidebar-width)] lg:flex-col lg:justify-start lg:overflow-y-auto lg:border-t-0 lg:border-r lg:px-6 lg:py-8`}
    >
      <div className="hidden lg:block">
        <ChurchBrand />
      </div>
      <div className="mx-auto flex w-full max-w-[36rem] items-stretch justify-center lg:mx-0 lg:mt-2 lg:max-w-none lg:flex-col lg:gap-2">
        {links.map((link) => {
          const isCurrent =
            currentPath === link.href ||
            (link.label === "管理" &&
              (currentPath.startsWith("/staff/") ||
                currentPath === "/roles/people" ||
                currentPath.startsWith("/roles/people/") ||
                currentPath === "/roles/program-leaders" ||
                currentPath.startsWith("/roles/program-leaders/")));
          const className = `${
            isCurrent
              ? "bg-muted text-primary-hover lg:font-[650]"
              : "text-muted-foreground lg:text-foreground hover:bg-muted hover:text-foreground"
          } text-meta inline-flex min-h-[3.25rem] max-w-[9rem] min-w-[44px] flex-1 flex-col items-center justify-center gap-1 lg:rounded-[12px] px-2 py-2 text-center leading-tight font-medium transition-colors focus-visible:outline-2 lg:min-h-12 lg:w-full lg:max-w-none lg:flex-none lg:flex-row lg:justify-start lg:gap-3 lg:px-3 lg:py-3 lg:text-base`;
          const contents = (
            <>
              <Icon
                className="h-6 w-6 shrink-0 opacity-[0.77]"
                name={link.icon}
              />
              <span>{link.label}</span>
            </>
          );
          return (
            <TaskDepartureLink
              aria-current={isCurrent ? "page" : undefined}
              className={className}
              fullPageNavigation={fullPageNavigation}
              href={link.href}
              key={link.href}
              prefetch={false}
            >
              {contents}
            </TaskDepartureLink>
          );
        })}
      </div>
      {signedInAs?.displayName ? (
        <div className="text-meta text-muted-foreground mt-auto hidden px-3 pt-6 lg:block">
          <strong className="text-foreground text-label block">
            {signedInAs.displayName}
          </strong>
          {signedInAs.subtitle ? <span>{signedInAs.subtitle}</span> : null}
        </div>
      ) : null}
    </nav>
  );
};
