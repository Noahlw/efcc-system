import type { PageFrameVariant } from "@/components/page-frame";
import { PageFrame } from "@/components/page-frame";
import { Button } from "@/components/ui/button";
import { SignOutButton } from "@/features/auth/sign-out-button";
import type { ProtectedPagePath } from "@/shared/protected-pages";

interface UnavailableViewProps {
  frame?: PageFrameVariant;
  retryHref: ProtectedPagePath;
  title?: string;
}

/** A safe read failure; native form navigation rechecks current server access. */
export const UnavailableView = ({
  frame = "task",
  retryHref,
  title = "暫時未能載入資料",
}: UnavailableViewProps) => (
  <PageFrame variant={frame}>
    <main className="flex flex-col">
      <h1 className="text-task font-semibold">{title}</h1>
      <p className="text-muted-foreground mt-3" role="alert">
        系統暫時無法載入資料，未有顯示部分內容。請稍後重試。
      </p>
      <form action={retryHref} method="get" className="mt-6">
        <Button className="w-full sm:w-auto" type="submit">
          重試
        </Button>
      </form>
      <div className="mt-3">
        <SignOutButton />
      </div>
    </main>
  </PageFrame>
);
