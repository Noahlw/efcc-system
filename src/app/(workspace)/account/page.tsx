import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { RootFrame } from "@/components/page-frame";
import { PrimaryNavigation } from "@/components/primary-navigation";
import { UnavailableView } from "@/components/unavailable-view";
import { getOwnAccountIdentity } from "@/features/account/account-changes";
import { ApplicationRequestError } from "@/features/account/applications";
import { IdentityChangeForm } from "@/features/account/identity-form";
import { getAccountSecurityState } from "@/features/account/security";
import { AccountSecurityForm } from "@/features/account/security-form";
import { RestoredPageRevalidator } from "@/features/auth/restored-page-revalidator";
import { SignOutButton } from "@/features/auth/sign-out-button";
import { membershipStatusLabel } from "@/features/identity/labels";
import { getPersonIdentity } from "@/features/identity/queries";
import { getDb } from "@/server/db/client";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const requestHeaders = await headers();
  const userId = requestHeaders.get("x-efcc-user-id");
  if (!userId) {
    redirect("/sign-in");
  }
  let state;
  let identity;
  let contact;
  try {
    [state, identity, contact] = await Promise.all([
      getAccountSecurityState(requestHeaders),
      getPersonIdentity(getDb(), userId),
      getOwnAccountIdentity(requestHeaders),
    ]);
  } catch (error) {
    if (error instanceof ApplicationRequestError && error.status === 401) {
      redirect("/sign-in");
    }
    return (
      <UnavailableView retryHref="/account" title="暫時未能載入帳戶資料" />
    );
  }
  if (!identity || !contact) {
    return (
      <UnavailableView retryHref="/account" title="暫時未能載入帳戶資料" />
    );
  }

  return (
    <RootFrame
      navigation={
        <PrimaryNavigation
          accessAllowed={requestHeaders.get("x-efcc-access") === "full"}
          canManageAccounts={
            requestHeaders.get("x-efcc-access") === "full" &&
            (identity.accountRole === "staff" ||
              identity.accountRole === "admin")
          }
          currentPath="/account"
          passwordChangeRequired={state.temporaryPasswordExpiresAt !== null}
          variant="root"
        />
      }
    >
      <main className="mx-auto flex w-full max-w-4xl flex-col">
        <header>
          <h1 className="text-root font-semibold">帳戶</h1>
          <p className="text-muted-foreground mt-2">你的資料與帳戶設定。</p>
        </header>

        <section
          aria-labelledby="account-summary-heading"
          className="bg-surface border-border mt-6 rounded-xl border p-5"
        >
          <div className="flex flex-wrap items-center gap-4">
            <span
              aria-hidden="true"
              className="bg-muted text-primary text-section flex h-14 w-14 shrink-0 items-center justify-center rounded-full font-semibold"
            >
              {contact.fullName.slice(0, 1)}
            </span>
            <div className="min-w-0 flex-1">
              <h2
                className="text-section font-semibold break-words"
                id="account-summary-heading"
              >
                {contact.fullName}
              </h2>
              <p className="text-muted-foreground mt-1 break-all">
                {contact.username ?? "未設定使用者名稱"}
              </p>
              <span className="bg-muted text-primary text-meta mt-2 inline-flex min-h-8 items-center rounded-full px-3 font-medium">
                會籍{membershipStatusLabel(identity.membershipStatus)}
              </span>
            </div>
          </div>
        </section>

        <section aria-labelledby="personal-details-heading" className="mt-8">
          <h2
            className="text-section font-semibold"
            id="personal-details-heading"
          >
            個人資料
          </h2>
          <dl className="divide-border mt-2 divide-y">
            <div className="grid gap-1 py-4 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
              <dt className="text-muted-foreground">中文全名</dt>
              <dd className="font-medium break-words">{contact.fullName}</dd>
            </div>
            <div className="grid gap-1 py-4 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
              <dt className="text-muted-foreground">Username</dt>
              <dd className="font-medium break-all">
                {contact.username ?? "—"}
              </dd>
            </div>
            <div className="grid gap-1 py-4 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
              <dt className="text-muted-foreground">電郵</dt>
              <dd className="font-medium break-all">{contact.email}</dd>
            </div>
            <div className="grid gap-1 py-4 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
              <dt className="text-muted-foreground">聯絡電話</dt>
              <dd className="font-medium break-words">
                {contact.phone ?? "—"}
              </dd>
            </div>
          </dl>
          {contact.phoneEditable ? (
            <a
              className="text-primary focus-visible:outline-primary mt-2 inline-flex min-h-12 items-center rounded-md px-3 font-medium focus-visible:outline-2 focus-visible:outline-offset-2"
              href="#phone-change"
            >
              更新聯絡電話
            </a>
          ) : null}
        </section>

        <nav
          aria-label="帳戶工作"
          className="border-border mt-6 flex flex-wrap gap-2 border-y py-4"
        >
          <Link
            className="bg-muted text-foreground inline-flex min-h-12 min-w-12 items-center justify-center rounded-md px-4 font-medium focus-visible:outline-2"
            href="/status"
            prefetch={false}
          >
            帳戶狀態
          </Link>
          <Link
            className="bg-muted text-foreground inline-flex min-h-12 min-w-12 items-center justify-center rounded-md px-4 font-medium focus-visible:outline-2"
            href="/application"
            prefetch={false}
          >
            我的申請
          </Link>
        </nav>

        <section
          aria-labelledby="security-settings-heading"
          className="mt-8"
          id="security-settings"
        >
          <h2
            className="text-section mb-4 font-semibold"
            id="security-settings-heading"
          >
            帳戶安全
          </h2>
          <AccountSecurityForm
            actorUserId={userId}
            confirmationExpiresAt={state.passwordConfirmationExpiresAt}
            temporaryPasswordExpiresAt={state.temporaryPasswordExpiresAt}
            temporaryPasswordExpired={state.temporaryPasswordExpired}
          />
        </section>
        {contact.phoneEditable ? (
          <div className="mt-8" id="phone-change">
            <IdentityChangeForm
              actorUserId={userId}
              account={{ ...contact, userId }}
              staffVerified={false}
            />
          </div>
        ) : null}
        <div className="mt-8">
          <SignOutButton />
        </div>
        <RestoredPageRevalidator />
      </main>
    </RootFrame>
  );
}
