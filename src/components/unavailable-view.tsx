import Link from "next/link";
import type { ReactNode } from "react";

import type { PageFrameVariant } from "@/components/page-frame";
import { ChurchBrand, PageFrame, RootFrame } from "@/components/page-frame";
import { PrimaryNavigation } from "@/components/primary-navigation";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { SignOutButton } from "@/features/auth/sign-out-button";
import type {
  ProtectedPageHref,
  ProtectedPagePath,
} from "@/shared/protected-pages";

/** Presentation only; each owner supplies its frame and permitted actions. */
export const SafeStateBody = ({
  children,
  description,
  icon = "refresh-cw",
  returnControl,
  title,
}: {
  children: ReactNode;
  description: string;
  icon?: "refresh-cw" | "shield";
  returnControl?: ReactNode;
  title: string;
}) => (
  <main className="flex flex-col">
    <header className="flex flex-wrap items-center gap-3">
      {returnControl}
      <h1 className="text-task font-semibold">{title}</h1>
    </header>
    <p className="text-muted-foreground mt-3" role="alert">
      {description}
    </p>
    <div className="bg-warning-surface text-warning mt-6 flex size-14 items-center justify-center rounded-2xl">
      <Icon className="size-7" name={icon} />
    </div>
    <div className="mt-6 flex flex-col gap-3">{children}</div>
  </main>
);

interface UnavailableViewProps {
  backHref?: ProtectedPageHref;
  backLabel?: string;
  embedded?: boolean;
  frame?: PageFrameVariant;
  retryHref: ProtectedPagePath;
  retrySearchParams?: Record<string, string>;
  rootNavigation?: {
    accessAllowed: boolean;
    canManageAccounts?: boolean;
    currentPath: ProtectedPagePath;
    passwordChangeRequired?: boolean;
  };
  title?: string;
}

/** A safe read failure; native form navigation rechecks current server access. */
export const UnavailableView = ({
  backHref,
  backLabel = "← 返回",
  embedded = false,
  frame = "task",
  retryHref,
  retrySearchParams,
  rootNavigation,
  title,
}: UnavailableViewProps) => {
  const content = (
    <>
      {frame === "auth" ? <ChurchBrand /> : null}
      <SafeStateBody
        description="系統暫時無法載入資料，未有顯示部分內容。請稍後重試。"
        returnControl={
          backHref ? (
            <Link
              className="text-primary inline-flex min-h-12 items-center rounded-md px-2 focus-visible:outline-2"
              href={backHref}
              prefetch={false}
            >
              {backLabel}
            </Link>
          ) : null
        }
        title={
          title ??
          (frame === "auth" ? "暫時未能確認登入狀態" : "暫時未能載入資料")
        }
      >
        <form action={retryHref} method="get">
          {Object.entries(retrySearchParams ?? {}).map(([name, value]) => (
            <input key={name} name={name} type="hidden" value={value} />
          ))}
          <Button className="w-full sm:w-auto" type="submit">
            <Icon className="mr-2 size-5" name="refresh-cw" />
            重新載入
          </Button>
        </form>
        <SignOutButton />
      </SafeStateBody>
    </>
  );

  if (rootNavigation) {
    return (
      <RootFrame navigation={<PrimaryNavigation {...rootNavigation} />}>
        {content}
      </RootFrame>
    );
  }

  return embedded ? content : <PageFrame variant={frame}>{content}</PageFrame>;
};
