import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { RootFrame } from "@/components/page-frame";
import { PrimaryNavigation } from "@/components/primary-navigation";
import { UnavailableView } from "@/components/unavailable-view";
import { RestoredPageRevalidator } from "@/features/auth/restored-page-revalidator";
import { SignOutButton } from "@/features/auth/sign-out-button";
import { participationCopy } from "@/features/home/labels";
import { getVisibleNotices } from "@/features/home/notices";
import { getHomeView } from "@/features/home/queries";
import { UpcomingEvents } from "@/features/home/upcoming-events";
import { getPersonIdentity } from "@/features/identity/queries";
import { getDb } from "@/server/db/client";
import { formatChurchDate, getChurchDateKey } from "@/shared/time/church-time";

export const dynamic = "force-dynamic";

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
  const approvedWithoutEvents = approvedParticipation.filter(
    (entry) => entry.events.length === 0
  );
  const pending = home.participation.filter(
    (entry) => entry.state === "pending"
  );
  const waitlisted = home.participation.filter(
    (entry) => entry.state === "waitlisted"
  );
  const otherParticipationGroups = [
    {
      description: "尚未獲批核，暫不列入即將聚會。",
      entries: pending,
      title: "待批核",
    },
    {
      description: "候補尚未確認，暫不列入即將聚會。",
      entries: waitlisted,
      title: "候補中",
    },
  ];
  const isEmpty =
    home.participation.length === 0 &&
    home.invitations.length === 0 &&
    notices.length === 0;

  return (
    <RootFrame
      navigation={
        <PrimaryNavigation
          accessAllowed
          canManageAccounts={
            identity.accountRole === "staff" || identity.accountRole === "admin"
          }
          currentPath="/"
        />
      }
    >
      <main className="mx-auto flex w-full max-w-4xl flex-col">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-home font-semibold">我的主頁</h1>
            <p className="text-muted-foreground mt-1">
              歡迎回來，{identity.displayName}。
            </p>
          </div>
          <SignOutButton />
        </header>

        <RestoredPageRevalidator />

        <UpcomingEvents events={upcomingEvents} today={getChurchDateKey(now)} />

        {approvedWithoutEvents.length > 0 ? (
          <section aria-labelledby="approved-without-events" className="mt-8">
            <h2
              className="text-section font-semibold"
              id="approved-without-events"
            >
              已批准，但目前沒有即將舉行的聚會
            </h2>
            <ul className="divide-border mt-3 divide-y">
              {approvedWithoutEvents.map((entry) => (
                <li key={entry.enrolmentId} className="py-4">
                  <h3 className="text-label font-medium">
                    {entry.programName}
                  </h3>
                  <p className="text-meta text-muted-foreground mt-1">
                    {entry.departmentName}
                  </p>
                  <p className="text-meta text-muted-foreground mt-2">
                    目前沒有即將舉行的聚會。
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {pending.length > 0 || waitlisted.length > 0 ? (
          <section aria-labelledby="other-participation" className="mt-8">
            <h2 className="text-section font-semibold" id="other-participation">
              其他報名狀態
            </h2>
            {otherParticipationGroups.map(({ description, entries, title }) =>
              entries.length > 0 ? (
                <div key={title} className="mt-4">
                  <h3 className="text-label font-medium">{title}</h3>
                  <ul className="divide-border mt-2 divide-y">
                    {entries.map((entry) => (
                      <li key={entry.enrolmentId} className="py-3">
                        <p className="text-label font-medium">
                          {entry.programName}
                        </p>
                        <p className="text-meta text-muted-foreground mt-1">
                          {entry.departmentName} ·{" "}
                          {participationCopy[entry.state].label}
                        </p>
                        <p className="text-meta text-muted-foreground mt-1">
                          {description}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null
            )}
          </section>
        ) : null}

        <section
          aria-labelledby="invitations-heading"
          className="border-border bg-surface mt-8 rounded-lg border p-5"
        >
          <h2 className="text-section font-semibold" id="invitations-heading">
            我的邀請
          </h2>
          {home.invitations.length === 0 ? (
            <p className="text-muted-foreground mt-3">目前沒有有效的邀請。</p>
          ) : (
            <ul className="divide-border mt-3 divide-y">
              {home.invitations.map((entry) => (
                <li key={entry.invitationId} className="py-3">
                  <h3 className="text-label font-medium">
                    {entry.programName}
                  </h3>
                  <p className="text-meta text-muted-foreground mt-1">
                    邀請有效至{" "}
                    <time dateTime={entry.expiresAt.toISOString()}>
                      {formatChurchDate(entry.expiresAt)}
                    </time>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section
          aria-labelledby="notices-heading"
          className="border-border bg-surface mt-6 rounded-lg border p-5"
        >
          <h2 className="text-section font-semibold" id="notices-heading">
            通告
          </h2>
          {notices.length === 0 ? (
            <p className="text-muted-foreground mt-3">目前沒有適用的通告。</p>
          ) : (
            <ul className="divide-border mt-3 divide-y">
              {notices.map((entry) => (
                <li key={entry.id} className="py-4">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <h3 className="text-label font-semibold">{entry.title}</h3>
                    <span className="bg-muted text-muted-foreground text-meta rounded-sm px-2 py-1">
                      {entry.scopeLabel}
                    </span>
                  </div>
                  <p className="text-body mt-2 whitespace-pre-line">
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
                </li>
              ))}
            </ul>
          )}
        </section>

        {isEmpty ? (
          <p className="text-muted-foreground mt-6" role="status">
            你目前沒有即將舉行的活動或邀請。
          </p>
        ) : null}
      </main>
    </RootFrame>
  );
}
