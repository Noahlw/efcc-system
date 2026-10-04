import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { PrimaryNavigation } from "@/app/primary-navigation";
import { UnavailableView } from "@/components/unavailable-view";
import { ApplicationRequestError } from "@/features/account/applications";
import { DecisionReview } from "@/features/account/decision-review";
import {
  accountActor,
  getReviewApplications,
} from "@/features/account/decisions";
import { RestoredPageRevalidator } from "@/features/auth/restored-page-revalidator";
import { SignOutButton } from "@/features/auth/sign-out-button";

export const dynamic = "force-dynamic";

export default async function ApplicationsReviewPage() {
  const requestHeaders = await headers();
  let applications;
  let actorUserId: string;
  try {
    applications = await getReviewApplications(requestHeaders);
    actorUserId = accountActor(requestHeaders).userId;
  } catch (error) {
    if (error instanceof ApplicationRequestError && error.status === 401) {
      redirect("/sign-in");
    }
    if (error instanceof ApplicationRequestError && error.status === 403) {
      return (
        <main className="mx-auto min-h-dvh max-w-xl px-5 py-10">
          <h1 className="text-2xl font-semibold">你沒有帳戶管理權限</h1>
          <p className="mt-4">
            只有目前具有效會籍、未被停用的職員或管理員可審批申請。
          </p>
          <PrimaryNavigation
            accessAllowed={requestHeaders.get("x-efcc-access") === "full"}
            currentPath="/staff/applications"
          />
          <SignOutButton />
          <RestoredPageRevalidator />
        </main>
      );
    }
    return (
      <UnavailableView
        retryHref="/staff/applications"
        title="暫時未能載入待批申請"
      />
    );
  }
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-5 py-10">
      <header className="flex items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold">審批會籍申請</h1>
        <SignOutButton />
      </header>
      <PrimaryNavigation
        accessAllowed
        canManageAccounts
        currentPath="/staff/applications"
      />
      <p className="text-muted-foreground mt-6">
        只有目前仍然待批而且你有權管理的申請會列在這裏。職員不能管理自己、其他職員或管理員。一般審批不需要再次確認密碼。
      </p>
      <DecisionReview applications={applications} actorUserId={actorUserId} />
      <RestoredPageRevalidator />
    </main>
  );
}
