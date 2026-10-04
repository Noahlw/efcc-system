import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { PrimaryNavigation } from "@/app/primary-navigation";
import { UnavailableView } from "@/components/unavailable-view";
import { ApplicationRequestError } from "@/features/account/applications";
import { getDecisionInbox } from "@/features/account/decisions";
import { RestoredPageRevalidator } from "@/features/auth/restored-page-revalidator";
import { SignOutButton } from "@/features/auth/sign-out-button";
import { RecheckStatusButton } from "@/features/identity/recheck-status-button";
import { formatChurchTimestamp } from "@/shared/time/church-time";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const requestHeaders = await headers();
  let decisions;
  try {
    decisions = await getDecisionInbox(requestHeaders);
  } catch (error) {
    if (error instanceof ApplicationRequestError && error.status === 401) {
      redirect("/sign-in");
    }
    return <UnavailableView retryHref="/inbox" title="暫時未能載入收件匣" />;
  }
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-5 py-10">
      <h1 className="text-2xl font-semibold">收件匣</h1>
      <PrimaryNavigation
        accessAllowed={requestHeaders.get("x-efcc-access") === "full"}
        currentPath="/inbox"
      />
      <p className="text-muted-foreground mt-6">
        這裏保留你的會籍審批決定。決定紀錄不代表帳戶目前可使用教會功能；請查看帳戶狀態。
      </p>
      {decisions.length === 0 ? (
        <p className="text-muted-foreground mt-6">目前沒有審批決定。</p>
      ) : (
        <ol className="mt-6 flex flex-col gap-4">
          {decisions.map((decision) => {
            const when = new Date(decision.createdAt * 1000);
            return (
              <li
                key={decision.id}
                className="border-border bg-surface rounded-lg border p-5"
              >
                <h2 className="text-xl font-semibold">
                  {decision.outcome === "approved"
                    ? "會籍申請已獲批准"
                    : "會籍申請已被拒絕"}
                </h2>
                <p className="text-muted-foreground mt-2">
                  <time dateTime={when.toISOString()}>
                    {formatChurchTimestamp(when)}
                    （香港）
                  </time>
                </p>
                {decision.visibleReason ? (
                  <p className="mt-4 break-words whitespace-pre-wrap">
                    {decision.visibleReason}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      <div className="mt-8 flex flex-col gap-3">
        <RecheckStatusButton />
        <SignOutButton />
      </div>
      <RestoredPageRevalidator />
    </main>
  );
}
