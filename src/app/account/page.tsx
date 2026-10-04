import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { PrimaryNavigation } from "@/app/primary-navigation";
import { UnavailableView } from "@/components/unavailable-view";
import { ApplicationRequestError } from "@/features/account/applications";
import { getAccountSecurityState } from "@/features/account/security";
import { AccountSecurityForm } from "@/features/account/security-form";
import { RestoredPageRevalidator } from "@/features/auth/restored-page-revalidator";
import { SignOutButton } from "@/features/auth/sign-out-button";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const requestHeaders = await headers();
  const userId = requestHeaders.get("x-efcc-user-id");
  if (!userId) {
    redirect("/sign-in");
  }
  let state;
  try {
    state = await getAccountSecurityState(requestHeaders);
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
        currentPath="/account"
      />
      <AccountSecurityForm
        actorUserId={userId}
        confirmationExpiresAt={state.passwordConfirmationExpiresAt}
      />
      <div className="mt-8">
        <SignOutButton />
      </div>
      <RestoredPageRevalidator />
    </main>
  );
}
