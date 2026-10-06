import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { RootFrame } from "@/components/page-frame";
import { PrimaryNavigation } from "@/components/primary-navigation";
import { UnavailableView } from "@/components/unavailable-view";
import { ApplicationRequestError } from "@/features/account/applications";
import { getDecisionInbox } from "@/features/account/decisions";
import { RestoredPageRevalidator } from "@/features/auth/restored-page-revalidator";
import { SignOutButton } from "@/features/auth/sign-out-button";
import { getPersonIdentity } from "@/features/identity/queries";
import { RecheckStatusButton } from "@/features/identity/recheck-status-button";
import { getDb } from "@/server/db/client";
import {
  formatChurchDate,
  formatChurchTimestamp,
} from "@/shared/time/church-time";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const requestHeaders = await headers();
  const userId = requestHeaders.get("x-efcc-user-id");
  if (!userId) {
    redirect("/sign-in");
  }
  let decisions;
  let identity;
  try {
    [decisions, identity] = await Promise.all([
      getDecisionInbox(requestHeaders),
      getPersonIdentity(getDb(), userId),
    ]);
  } catch (error) {
    if (error instanceof ApplicationRequestError && error.status === 401) {
      redirect("/sign-in");
    }
    return (
      <UnavailableView
        retryHref="/inbox"
        rootNavigation={{
          accessAllowed: requestHeaders.get("x-efcc-access") === "full",
          currentPath: "/inbox",
          passwordChangeRequired:
            requestHeaders.get("x-efcc-access") === "password-change-required",
        }}
        title="暫時未能載入收件匣"
      />
    );
  }
  return (
    <RootFrame
      navigation={
        <PrimaryNavigation
          accessAllowed={requestHeaders.get("x-efcc-access") === "full"}
          canManageAccounts={
            requestHeaders.get("x-efcc-access") === "full" &&
            (identity?.accountRole === "staff" ||
              identity?.accountRole === "admin")
          }
          currentPath="/inbox"
        />
      }
    >
      <main className="mx-auto flex w-full max-w-4xl flex-col">
        <h1 className="text-root font-semibold">收件匣</h1>
        <p className="text-muted-foreground mt-6">
          你的會籍審批決定會保留在這裏。決定紀錄不代表帳戶目前可使用教會功能；請查看帳戶狀態。
        </p>
        {decisions.length === 0 ? (
          <p className="text-muted-foreground mt-6" role="status">
            暫時沒有會籍審批決定。
          </p>
        ) : (
          <ol className="mt-6 flex flex-col gap-4">
            {decisions.map((decision) => {
              const when = new Date(decision.createdAt * 1000);
              return (
                <li
                  key={decision.id}
                  className="border-border bg-surface rounded-xl border p-5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span
                      className={
                        decision.outcome === "approved"
                          ? "bg-muted text-primary text-meta inline-flex min-h-8 items-center rounded-full px-3 font-medium"
                          : "bg-danger-surface text-danger text-meta inline-flex min-h-8 items-center rounded-full px-3 font-medium"
                      }
                    >
                      {decision.outcome === "approved"
                        ? "會籍已批准"
                        : "會籍申請已被拒絕"}
                    </span>
                    <time
                      className="text-meta text-muted-foreground"
                      dateTime={when.toISOString()}
                    >
                      {formatChurchDate(when)}
                    </time>
                  </div>
                  <h2 className="text-section mt-4 font-semibold">
                    {decision.outcome === "approved"
                      ? "會籍申請已獲批准"
                      : "會籍申請已被拒絕"}
                  </h2>
                  <p className="text-meta text-muted-foreground mt-2">
                    <time dateTime={when.toISOString()}>
                      {formatChurchTimestamp(when)}（香港）
                    </time>
                  </p>
                  {decision.visibleReason ? (
                    <p className="text-body mt-4 break-words whitespace-pre-wrap">
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
    </RootFrame>
  );
}
