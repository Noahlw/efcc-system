import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { PrimaryNavigation } from "@/app/primary-navigation";
import { UnavailableView } from "@/components/unavailable-view";
import { ApplicationRequestError } from "@/features/account/applications";
import { StaffIdentityCorrections } from "@/features/account/identity-form";
import { getStaffAccounts } from "@/features/account/staff-accounts";
import { StaffAccountsForm } from "@/features/account/staff-accounts-form";
import { RestoredPageRevalidator } from "@/features/auth/restored-page-revalidator";
import { SignOutButton } from "@/features/auth/sign-out-button";

export const dynamic = "force-dynamic";

export default async function StaffAccountsPage() {
  const requestHeaders = await headers();
  let accounts;
  try {
    accounts = await getStaffAccounts(requestHeaders);
  } catch (error) {
    if (error instanceof ApplicationRequestError && error.status === 401) {
      redirect("/sign-in");
    }
    if (error instanceof ApplicationRequestError && error.status === 403) {
      return (
        <main className="mx-auto flex min-h-dvh max-w-xl flex-col px-5 py-10">
          <h1 className="text-2xl font-semibold">無法管理帳戶</h1>
          <p className="mt-4" role="status">
            你目前沒有帳戶管理權限。
          </p>
          <PrimaryNavigation
            accessAllowed={requestHeaders.get("x-efcc-access") === "full"}
            currentPath="/staff/accounts"
          />
          <SignOutButton />
          <RestoredPageRevalidator />
        </main>
      );
    }
    return (
      <UnavailableView
        retryHref="/staff/accounts"
        title="暫時未能載入帳戶管理"
      />
    );
  }
  const actorUserId = requestHeaders.get("x-efcc-user-id");
  if (!actorUserId) {
    redirect("/sign-in");
  }
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-5 py-10">
      <header className="flex items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold">管理帳戶</h1>
        <SignOutButton />
      </header>
      <PrimaryNavigation
        accessAllowed
        canManageAccounts
        currentPath="/staff/accounts"
      />
      <StaffAccountsForm actorUserId={actorUserId} accounts={accounts} />
      <StaffIdentityCorrections actorUserId={actorUserId} accounts={accounts} />
      <RestoredPageRevalidator />
    </main>
  );
}
