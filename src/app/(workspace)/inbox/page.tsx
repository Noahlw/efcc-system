import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { RootFrame } from "@/components/page-frame";
import { PrimaryNavigation } from "@/components/primary-navigation";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { UnavailableView } from "@/components/unavailable-view";
import { BusinessApiError } from "@/features/account/business-request";
import type { ApplicantDecisionInbox } from "@/features/account/decisions/decisions";
import { getDecisionInbox } from "@/features/account/decisions/decisions";
import { RestoredPageRevalidator } from "@/features/auth/restored-page-revalidator";
import { getPersonIdentity } from "@/features/identity/queries";
import { getDb } from "@/server/db/client";
import {
  formatChurchDate,
  formatChurchTimestamp,
} from "@/shared/time/church-time";

export const dynamic = "force-dynamic";

const InboxPagination = ({
  page,
}: {
  page: ApplicantDecisionInbox["page"];
}) => (
  <nav
    aria-label="收件匣分頁"
    className="mt-4 flex items-center justify-between gap-3"
  >
    {page.hasPrevious ? (
      <Button
        nativeButton={false}
        render={
          <Link
            href={
              page.number === 2 ? "/inbox" : `/inbox?page=${page.number - 1}`
            }
            prefetch={false}
          />
        }
        variant="secondary"
      >
        上一頁
      </Button>
    ) : (
      <span />
    )}
    <span aria-current="page" className="text-meta text-muted-foreground">
      第 {page.number} 頁
    </span>
    {page.hasNext ? (
      <Button
        nativeButton={false}
        render={
          <Link href={`/inbox?page=${page.number + 1}`} prefetch={false} />
        }
        variant="secondary"
      >
        下一頁
      </Button>
    ) : (
      <span />
    )}
  </nav>
);

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const requestHeaders = await headers();
  const { page: requestedPage } = await searchParams;
  const userId = requestHeaders.get("x-efcc-user-id");
  if (!userId) {
    redirect("/sign-in");
  }
  let inbox: Awaited<ReturnType<typeof getDecisionInbox>>;
  let identity;
  try {
    [inbox, identity] = await Promise.all([
      getDecisionInbox(requestHeaders, requestedPage),
      getPersonIdentity(getDb(), userId),
    ]);
  } catch (error) {
    if (error instanceof BusinessApiError && error.status === 401) {
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
  const canonicalPage =
    inbox.page.number === 1 ? undefined : String(inbox.page.number);
  const isCanonicalPage =
    canonicalPage === undefined
      ? requestedPage === undefined
      : requestedPage === canonicalPage;
  if (!isCanonicalPage) {
    redirect(canonicalPage ? `/inbox?page=${canonicalPage}` : "/inbox");
  }
  const { decisions } = inbox;
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
          signedInAs={
            identity
              ? {
                  displayName: identity.displayName,
                  subtitle:
                    identity.accountRole === "staff" ||
                    identity.accountRole === "admin"
                      ? "職員 · 個人帳戶"
                      : (identity.username ?? undefined),
                }
              : undefined
          }
        />
      }
    >
      <main className="mx-auto flex w-full max-w-[40rem] flex-col">
        <h1 className="text-root">收件匣</h1>
        <p className="text-muted-foreground mt-2">
          你的會籍審批決定，保留在這裏。
        </p>
        {decisions.length === 0 ? (
          <section
            className="mt-6 rounded-xl border border-dashed border-[#cbd6d0] bg-[#fcfdfc] px-4 py-6 text-center"
            role="status"
          >
            <span className="mx-auto mb-[14px] flex size-8 items-center justify-center">
              <Icon className="size-8 opacity-[0.77]" name="mail" />
            </span>
            <h2 className="text-section">目前沒有審批決定</h2>
            <p className="text-muted-foreground mt-2">
              當你的申請完成審批，決定會顯示在這裏。
            </p>
          </section>
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
                  <h2 className="text-section mt-4">
                    {decision.outcome === "approved"
                      ? "會籍申請已獲批准"
                      : "會籍申請已被拒絕"}
                  </h2>
                  <p className="text-meta text-muted-foreground mt-2">
                    <time dateTime={when.toISOString()}>
                      {formatChurchTimestamp(when)}（香港）
                    </time>
                  </p>
                  <p className="text-body mt-4 break-words whitespace-pre-wrap">
                    {decision.visibleReason ||
                      (decision.outcome === "approved"
                        ? "歡迎你！你可以查看帳戶狀態，了解目前可用功能。"
                        : "這份決定沒有附加可見原因。")}
                  </p>
                  {decision.outcome === "rejected" ? (
                    <Button
                      className="mt-6 w-full"
                      nativeButton={false}
                      render={<Link href="/application" prefetch={false} />}
                      variant="secondary"
                    >
                      查看我的申請
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
        {decisions.length > 0 ? <InboxPagination page={inbox.page} /> : null}
        <p className="text-meta text-muted-foreground mt-6">
          決定紀錄不代表帳戶目前的使用權限；會籍及保安限制以帳戶狀態為準。
        </p>
        <Button
          className="mt-4 w-full"
          nativeButton={false}
          render={<Link href="/status" prefetch={false} />}
          variant="secondary"
        >
          重新檢查帳戶狀態
        </Button>
        <RestoredPageRevalidator />
      </main>
    </RootFrame>
  );
}
