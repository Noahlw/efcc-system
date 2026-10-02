import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { SignOutButton } from "@/features/auth/sign-out-button";
import { participationCopy } from "@/features/home/labels";
import { getHomeView } from "@/features/home/queries";
import { membershipStatusLabel } from "@/features/identity/labels";
import { getPersonIdentity } from "@/features/identity/queries";
import { getDb } from "@/server/db/client";
import {
  formatChurchDate,
  formatChurchDateTime,
} from "@/shared/time/church-time";

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

  const db = getDb();
  const [identity, home] = await Promise.all([
    getPersonIdentity(db, userId),
    getHomeView(db, userId),
  ]);
  if (!identity) {
    redirect("/status");
  }

  const isEmpty =
    home.participation.length === 0 && home.invitations.length === 0;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-5 py-10">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">我的主頁</h1>
          <p className="text-muted-foreground mt-1">
            歡迎回來，{identity.displayName}。
          </p>
        </div>
        <SignOutButton />
      </header>

      <section
        aria-labelledby="participation-heading"
        className="border-border bg-surface mt-8 rounded-lg border p-5"
      >
        <h2 className="text-lg font-medium" id="participation-heading">
          我的參與
        </h2>
        {home.participation.length === 0 ? (
          <p className="text-muted-foreground mt-3">目前沒有參與的節目。</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-5">
            {home.participation.map((entry) => {
              const copy = participationCopy[entry.state];
              return (
                <li key={entry.enrolmentId}>
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <h3 className="text-base font-medium">
                      {entry.programName}
                    </h3>
                    <span className="text-muted-foreground text-sm">
                      {entry.departmentName}
                    </span>
                    <span
                      className={
                        copy.unconfirmed
                          ? "border-input-border text-muted-foreground rounded-sm border px-1.5 text-sm"
                          : "bg-muted text-foreground rounded-sm px-1.5 text-sm"
                      }
                    >
                      {copy.label}
                    </span>
                  </div>
                  {copy.unconfirmed ? (
                    <p className="text-muted-foreground mt-1 text-sm">
                      此狀態未代表已確認出席聚會。
                    </p>
                  ) : null}
                  {entry.events.length > 0 ? (
                    <ul className="mt-2 flex flex-col gap-1">
                      {entry.events.map((event) => (
                        <li className="text-base" key={event.id}>
                          <time dateTime={event.startsAt.toISOString()}>
                            {formatChurchDateTime(event.startsAt)}
                          </time>
                          <span className="text-muted-foreground">
                            {" "}
                            · {event.title}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {entry.events.length === 0 && entry.state === "approved" ? (
                    <p className="text-muted-foreground mt-1 text-sm">
                      目前沒有即將舉行的聚會。
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section
        aria-labelledby="invitations-heading"
        className="border-border bg-surface mt-6 rounded-lg border p-5"
      >
        <h2 className="text-lg font-medium" id="invitations-heading">
          我的邀請
        </h2>
        {home.invitations.length === 0 ? (
          <p className="text-muted-foreground mt-3">目前沒有有效的邀請。</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {home.invitations.map((entry) => (
              <li key={entry.invitationId}>
                <h3 className="text-base font-medium">{entry.programName}</h3>
                <p className="text-muted-foreground text-sm">
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

      {isEmpty ? (
        <p className="text-muted-foreground mt-6" role="status">
          你目前沒有即將舉行的活動或邀請。
        </p>
      ) : null}

      <section className="border-border bg-surface mt-6 rounded-lg border p-5">
        <h2 className="text-lg font-medium">我的資料</h2>
        <dl className="mt-4 grid gap-3 text-base">
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-muted-foreground">中文姓名</dt>
            <dd className="font-medium">{identity.displayName}</dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-muted-foreground">使用者名稱</dt>
            <dd className="font-medium">{identity.username ?? "—"}</dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-muted-foreground">會籍狀態</dt>
            <dd className="font-medium">
              {membershipStatusLabel(identity.membershipStatus)}
            </dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
