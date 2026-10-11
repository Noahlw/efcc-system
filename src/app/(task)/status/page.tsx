import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PageFrame, TaskHeader } from "@/components/page-frame";
import { PrimaryNavigation } from "@/components/primary-navigation";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { UnavailableView } from "@/components/unavailable-view";
import { RestoredPageRevalidator } from "@/features/auth/restored-page-revalidator";
import { SignOutButton } from "@/features/auth/sign-out-button";
import { getPersonIdentity } from "@/features/identity/queries";
import type { PersonIdentity } from "@/features/identity/queries";
import { RecheckStatusButton } from "@/features/identity/recheck-status-button";
import {
  restrictionCopy,
  restrictionReasons,
} from "@/features/identity/restrictions";
import { getDb } from "@/server/db/client";

export const dynamic = "force-dynamic";

const renderStatusNavigation = (
  actor: PersonIdentity,
  isActive: boolean,
  passwordChangeRequired: boolean
) => {
  const isStaff =
    actor.accountRole === "staff" || actor.accountRole === "admin";
  return (
    <PrimaryNavigation
      accessAllowed={isActive}
      canManageAccounts={isActive && isStaff}
      currentPath="/account"
      mobileHidden
      passwordChangeRequired={passwordChangeRequired}
      signedInAs={{
        displayName: actor.displayName,
        subtitle: isStaff ? "職員 · 個人帳戶" : (actor.username ?? undefined),
      }}
    />
  );
};

const renderStatusCards = (
  isActive: boolean,
  reasons: readonly (keyof typeof restrictionCopy)[]
) => {
  if (isActive) {
    return (
      <article className="border-border bg-background rounded-lg border p-4">
        <h2 className="bg-muted text-primary text-meta inline-flex min-h-8 items-center rounded-full px-3 font-medium">
          帳戶可正常使用
        </h2>
        <p className="text-muted-foreground mt-3">
          你的帳戶目前可使用教會功能。
        </p>
      </article>
    );
  }
  if (reasons.length === 0) {
    return (
      <article className="border-border bg-background rounded-lg border p-4">
        <h2 className="bg-warning-surface text-warning text-meta inline-flex min-h-8 items-center rounded-full px-3 font-medium">
          帳戶使用權限待確認
        </h2>
        <p className="text-muted-foreground mt-3">
          目前未能確認你的帳戶可否使用教會功能，請重新檢查狀態。
        </p>
      </article>
    );
  }
  return (
    <ul className="mt-2 flex flex-col gap-4">
      {reasons.map((reason) => {
        const badgeClass =
          reason === "security_ban"
            ? "bg-danger-surface text-danger"
            : "bg-warning-surface text-warning";
        const explanation =
          reason === "membership_pending"
            ? "你的會籍仍在批核中。你可以查看或修正申請，並留意收件匣的審批決定。"
            : restrictionCopy[reason].explanation;
        return (
          <li key={reason}>
            <article className="border-border bg-background rounded-lg border p-4">
              <h2
                className={`${badgeClass} text-meta inline-flex min-h-8 items-center rounded-full px-3 font-medium`}
              >
                {restrictionCopy[reason].title}
              </h2>
              <p className="text-muted-foreground mt-3">{explanation}</p>
            </article>
          </li>
        );
      })}
    </ul>
  );
};

export default async function StatusPage() {
  const requestHeaders = await headers();
  const userId = requestHeaders.get("x-efcc-user-id");
  const access = requestHeaders.get("x-efcc-access");
  if (!userId) {
    redirect("/sign-in");
  }

  let identity: PersonIdentity | null;
  try {
    identity = await getPersonIdentity(getDb(), userId);
  } catch {
    return <UnavailableView retryHref="/status" title="暫時未能載入帳戶狀態" />;
  }
  const reasons = identity
    ? restrictionReasons(identity.membershipStatus, identity.banned)
    : (["profile_missing"] as const);
  const knownActor = reasons.includes("profile_missing") ? null : identity;
  const accessKnown =
    access === "full" ||
    access === "restricted" ||
    access === "password-change-required";
  const canShowActor = knownActor !== null && accessKnown;
  const isActive =
    knownActor !== null && reasons.length === 0 && access === "full";
  const hasOwnedApplicationExit =
    knownActor !== null &&
    (access === "full" || access === "restricted") &&
    !isActive;
  const navigation = canShowActor
    ? renderStatusNavigation(
        knownActor,
        isActive,
        access === "password-change-required"
      )
    : undefined;

  return (
    <PageFrame navigation={navigation} variant="task">
      <main className="flex flex-col">
        <TaskHeader
          returnControl={
            canShowActor ? (
              <Link
                aria-label="返回帳戶"
                className="text-primary inline-flex min-h-12 min-w-12 items-center justify-center rounded-md px-2 focus-visible:outline-2"
                href="/account"
                prefetch={false}
              >
                <Icon className="h-5 w-5" name="arrow-left" />
              </Link>
            ) : undefined
          }
          title="帳戶狀態"
        >
          {canShowActor ? (
            <p className="text-body text-muted-foreground w-full basis-full break-words">
              {knownActor.displayName}
              {knownActor.username ? ` · ${knownActor.username}` : ""}
            </p>
          ) : null}
        </TaskHeader>

        {renderStatusCards(isActive, reasons)}

        <div className="mt-8 flex flex-col gap-3">
          <RecheckStatusButton />
          {isActive ? (
            <Button
              className="w-full sm:w-auto"
              nativeButton={false}
              render={<Link href="/" prefetch={false} />}
            >
              前往主頁
            </Button>
          ) : null}
          {hasOwnedApplicationExit ? (
            <Button
              className="w-full sm:w-auto"
              nativeButton={false}
              render={<Link href="/application" prefetch={false} />}
              variant="secondary"
            >
              查看我的申請
            </Button>
          ) : null}
          <SignOutButton variant="quiet" />
        </div>
        <RestoredPageRevalidator />
      </main>
    </PageFrame>
  );
}
