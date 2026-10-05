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
      <UnavailableView retryHref="/account" title="暫時未能載入帳戶安全設定" />
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
          currentPath="/account"
          passwordChangeRequired={state.temporaryPasswordExpiresAt !== null}
          variant="root"
        />
      }
    >
      <main className="mx-auto flex w-full max-w-4xl flex-col">
        <h1 className="text-root font-semibold">帳戶安全</h1>
        <nav aria-label="帳戶工作" className="mt-4 flex flex-wrap gap-2">
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
        <AccountSecurityForm
          actorUserId={userId}
          confirmationExpiresAt={state.passwordConfirmationExpiresAt}
          temporaryPasswordExpiresAt={state.temporaryPasswordExpiresAt}
          temporaryPasswordExpired={state.temporaryPasswordExpired}
        />
        {contact?.phoneEditable ? (
          <IdentityChangeForm
            actorUserId={userId}
            account={{ ...contact, userId }}
            staffVerified={false}
          />
        ) : null}
        <div className="mt-8">
          <SignOutButton />
        </div>
        <RestoredPageRevalidator />
      </main>
    </RootFrame>
  );
}
