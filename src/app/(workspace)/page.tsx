import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { PageLoading, RootFrame } from "@/components/page-frame";
import { PrimaryNavigation } from "@/components/primary-navigation";
import { Icon } from "@/components/ui/icon";
import { UnavailableView } from "@/components/unavailable-view";
import { RestoredPageRevalidator } from "@/features/auth/restored-page-revalidator";
import { participationCopy } from "@/features/home/labels";
import { getVisibleNotices } from "@/features/home/notices";
import { getHomeView } from "@/features/home/queries";
import type { HomeParticipation } from "@/features/home/queries";
import { UpcomingEvents } from "@/features/home/upcoming-events";
import { getPersonIdentity } from "@/features/identity/queries";
import { getDb } from "@/server/db/client";
import { formatChurchDate, getChurchDateKey } from "@/shared/time/church-time";

export const dynamic = "force-dynamic";

const participationTone = {
  approved: "bg-muted text-primary",
  pending: "bg-warning-surface text-warning",
  waitlisted: "bg-background text-muted-foreground",
};
const participationMessage = (entry: HomeParticipation) => {
  if (entry.state === "approved") {
    return entry.events.length === 0
      ? "目前沒有即將舉行的聚會。"
      : "聚會安排見「即將參與」。";
  }
  return entry.state === "pending"
    ? "尚未獲批核，暫不列入即將聚會。"
    : "候補尚未確認，暫不列入即將聚會。";
};

const HomeContent = async ({ userId }: { userId: string }) => {
  const now = new Date();
  const db = getDb();
  const loaded = await Promise.all([
    getPersonIdentity(db, userId),
    getHomeView(db, userId, now),
    getVisibleNotices(db, userId),
  ]).catch(() => null);
  if (!loaded) {
    return (
      <UnavailableView
        retryHref="/"
        rootNavigation={{ accessAllowed: true, currentPath: "/" }}
        title="暫時未能載入主頁"
      />
    );
  }
  const [identity, home, notices] = loaded;
  if (!identity) {
    redirect("/status");
  }

  const approvedParticipation = home.participation.filter(
    (entry) => entry.state === "approved"
  );
  const upcomingEvents = approvedParticipation
    .flatMap((entry) =>
      entry.events.map((event) => ({
        departmentName: entry.departmentName,
        id: event.id,
        programName: entry.programName,
        startsAt: event.startsAt.toISOString(),
        title: event.title,
      }))
    )
    .toSorted((a, b) => a.startsAt.localeCompare(b.startsAt));

  return (
    <RootFrame
      navigation={
        <PrimaryNavigation
          accessAllowed
          canManageAccounts={
            identity.accountRole === "staff" || identity.accountRole === "admin"
          }
          currentPath="/"
          signedInAs={{
            displayName: identity.displayName,
            subtitle:
              identity.accountRole === "staff" ||
              identity.accountRole === "admin"
                ? "職員 · 個人帳戶"
                : (identity.username ?? undefined),
          }}
        />
      }
    >
      <main className="mx-auto flex w-full flex-col">
        <div className="mb-5 flex items-center justify-between gap-4 lg:hidden">
          <span className="text-primary text-task font-extrabold tracking-[0.1em]">
            顯恩堂
          </span>
          <Link
            aria-label="前往帳戶"
            className="text-primary flex min-h-11 min-w-11 items-center justify-center rounded-lg focus-visible:outline-2"
            href="/account"
            prefetch={false}
          >
            <Icon name="user" />
          </Link>
        </div>
        <header>
          <h1 className="text-home font-semibold">我的主頁</h1>
          <p className="text-muted-foreground mt-1">
            歡迎回來，{identity.displayName}。
          </p>
        </header>
        <RestoredPageRevalidator />
        <div className="grid min-w-0 gap-x-10 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            <UpcomingEvents
              events={upcomingEvents}
              hasApprovedParticipation={approvedParticipation.length > 0}
              today={getChurchDateKey(now)}
            />
            {home.participation.length > 0 ? (
              <a
                className="text-primary mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-md focus-visible:outline-2"
                href="#participation"
              >
                查看參與狀態
              </a>
            ) : null}
          </div>
          <div className="min-w-0">
            <section
              aria-labelledby="participation-heading"
              className="mt-8"
              id="participation"
            >
              <h2
                className="text-section font-semibold"
                id="participation-heading"
              >
                參與狀態
              </h2>
              {home.participation.length === 0 ? (
                <p className="text-muted-foreground mt-3">目前未有參與紀錄。</p>
              ) : (
                <ul className="divide-border mt-3 divide-y">
                  {home.participation.map((entry) => (
                    <li className="py-4" key={entry.enrolmentId}>
                      <h3 className="text-body font-semibold">
                        {entry.programName}
                      </h3>
                      <p className="text-meta text-muted-foreground mt-1">
                        {entry.departmentName}
                      </p>
                      <span
                        className={`text-meta mt-2 inline-flex rounded-full px-3 py-1 font-medium ${participationTone[entry.state]}`}
                      >
                        {participationCopy[entry.state].label}
                      </span>
                      <p className="text-meta text-muted-foreground mt-2">
                        {participationMessage(entry)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section aria-labelledby="invitations-heading" className="mt-8">
              <h2
                className="text-section font-semibold"
                id="invitations-heading"
              >
                有效邀請
              </h2>
              {home.invitations.length === 0 ? (
                <p className="text-muted-foreground mt-3">
                  目前沒有有效的邀請。
                </p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {home.invitations.map((entry) => (
                    <li
                      className="bg-background border-border rounded-xl border p-4"
                      key={entry.invitationId}
                    >
                      <h3 className="text-body font-semibold">
                        {entry.programName}
                      </h3>
                      <p className="text-meta text-muted-foreground mt-1">
                        邀請有效至{" "}
                        <time dateTime={entry.expiresAt.toISOString()}>
                          {formatChurchDate(entry.expiresAt)}
                        </time>
                      </p>
                      <p className="text-meta text-muted-foreground mt-2">
                        邀請並不代表報名已批准。
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section aria-labelledby="notices-heading" className="mt-8">
              <h2 className="text-section font-semibold" id="notices-heading">
                教會消息
              </h2>
              {notices.length === 0 ? (
                <p className="text-muted-foreground mt-3">
                  目前沒有適用的通告。
                </p>
              ) : (
                <div className="divide-border mt-3 divide-y">
                  {notices.map((entry) => (
                    <details className="py-4" key={entry.id}>
                      <summary className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md focus-visible:outline-2">
                        <Icon
                          className="shrink-0 opacity-75"
                          name="file-text"
                        />
                        <span className="min-w-0 flex-1 font-semibold">
                          {entry.title}
                        </span>
                        <Icon
                          className="size-5 shrink-0 opacity-75"
                          name="chevron-right"
                        />
                      </summary>
                      <span className="bg-background text-muted-foreground text-meta mt-3 inline-block rounded px-2 py-1">
                        {entry.scopeLabel}
                      </span>
                      <p className="text-body mt-3 whitespace-pre-line">
                        {entry.body}
                      </p>
                      {entry.publishedAt ? (
                        <p className="text-meta text-muted-foreground mt-2">
                          發佈於{" "}
                          <time dateTime={entry.publishedAt.toISOString()}>
                            {formatChurchDate(entry.publishedAt)}
                          </time>
                        </p>
                      ) : null}
                    </details>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </main>
    </RootFrame>
  );
};
export default async function HomePage() {
  const requestHeaders = await headers();
  const userId = requestHeaders.get("x-efcc-user-id");
  const access = requestHeaders.get("x-efcc-access");

  if (!userId) {
    redirect("/sign-in");
  }
  if (access !== "full") {
    redirect("/status");
  }

  return (
    <Suspense
      fallback={
        <RootFrame
          navigation={<PrimaryNavigation accessAllowed currentPath="/" />}
        >
          <PageLoading title="我的主頁" />
        </RootFrame>
      }
    >
      <HomeContent userId={userId} />
    </Suspense>
  );
}
