import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { PrimaryNavigation } from "@/app/primary-navigation";
import { UnavailableView } from "@/components/unavailable-view";
import { ApplicationRequestError } from "@/features/account/applications";
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
  try {
    [state, identity] = await Promise.all([
      getAccountSecurityState(requestHeaders),
      getPersonIdentity(getDb(), userId),
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
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-5 py-10">
      <h1 className="text-2xl font-semibold">帳戶安全</h1>
      <PrimaryNavigation
        accessAllowed={requestHeaders.get("x-efcc-access") === "full"}
        canManageAccounts={
          requestHeaders.get("x-efcc-access") === "full" &&
          (identity?.accountRole === "staff" ||
            identity?.accountRole === "admin")
        }
        currentPath="/account"
        passwordChangeRequired={state.temporaryPasswordExpiresAt !== null}
      />
      <AccountSecurityForm
        actorUserId={userId}
        confirmationExpiresAt={state.passwordConfirmationExpiresAt}
        temporaryPasswordExpiresAt={state.temporaryPasswordExpiresAt}
        temporaryPasswordExpired={state.temporaryPasswordExpired}
      />
      <div className="mt-8">
        <SignOutButton />
      </div>
      <RestoredPageRevalidator />
    </main>
  );
}
