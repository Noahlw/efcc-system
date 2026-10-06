import Link from "next/link";

import type { PageFrameVariant } from "@/components/page-frame";
import { PageFrame, RootFrame } from "@/components/page-frame";
import { PrimaryNavigation } from "@/components/primary-navigation";
import { Button } from "@/components/ui/button";
import { SignOutButton } from "@/features/auth/sign-out-button";
import type {
  ProtectedPageHref,
  ProtectedPagePath,
} from "@/shared/protected-pages";

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
  title = "暫時未能載入資料",
}: UnavailableViewProps) => {
  const content = (
    <main
      className={frame === "auth" ? "my-auto flex flex-col" : "flex flex-col"}
    >
      <header className="flex flex-wrap items-center gap-3">
        {backHref ? (
          <Link
            className="text-primary inline-flex min-h-12 items-center rounded-md px-2 focus-visible:outline-2"
            href={backHref}
            prefetch={false}
          >
            {backLabel}
          </Link>
        ) : null}
        <h1
          className={`${rootNavigation ? "text-root" : "text-task"} font-semibold`}
        >
          {title}
        </h1>
      </header>
      <p className="text-muted-foreground mt-3" role="alert">
        系統暫時無法載入資料，未有顯示部分內容。請稍後重試。
      </p>
      <form action={retryHref} method="get" className="mt-6">
        {Object.entries(retrySearchParams ?? {}).map(([name, value]) => (
          <input key={name} name={name} type="hidden" value={value} />
        ))}
        <Button className="w-full sm:w-auto" type="submit">
          重試
        </Button>
      </form>
      <div className="mt-3">
        <SignOutButton />
      </div>
    </main>
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
