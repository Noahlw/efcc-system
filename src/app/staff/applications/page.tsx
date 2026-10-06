import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { PageFrame, RootFrame } from "@/components/page-frame";
import { PrimaryNavigation } from "@/components/primary-navigation";
import { UnavailableView } from "@/components/unavailable-view";
import { ApplicationRequestError } from "@/features/account/applications";
import { DecisionReview } from "@/features/account/decision-review";
import {
  accountActor,
  getReviewApplications,
} from "@/features/account/decisions";
import { StaffTaskFrame } from "@/features/account/staff-task-frame";
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
        <RootFrame
          navigation={
            <PrimaryNavigation
              accessAllowed={requestHeaders.get("x-efcc-access") === "full"}
              currentPath="/staff/applications"
              passwordChangeRequired={
                requestHeaders.get("x-efcc-access") ===
                "password-change-required"
              }
            />
          }
        >
          <main className="mx-auto flex w-full max-w-4xl flex-col">
            <header className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-root font-semibold">你沒有帳戶管理權限</h1>
                <p className="text-muted-foreground mt-4">
                  只有目前具有效會籍、未被停用的職員或管理員可審批申請。
                </p>
              </div>
              <SignOutButton />
            </header>
            <RestoredPageRevalidator />
          </main>
        </RootFrame>
      );
    }
    return (
      <UnavailableView
        retryHref="/staff/applications"
        rootNavigation={{
          accessAllowed: requestHeaders.get("x-efcc-access") === "full",
          currentPath: "/staff/applications",
          passwordChangeRequired:
            requestHeaders.get("x-efcc-access") === "password-change-required",
        }}
        title="暫時未能載入待批申請"
      />
    );
  }
  return (
    <PageFrame variant="task">
      <StaffTaskFrame
        actions={<SignOutButton />}
        returnHref="/staff/accounts"
        returnLabel="返回管理"
        title="審批會籍申請"
      >
        <p className="text-muted-foreground">
          只會列出目前仍待批而且你有權處理的申請。例行審批無需再次確認密碼。
        </p>
        <DecisionReview applications={applications} actorUserId={actorUserId} />
      </StaffTaskFrame>
      <RestoredPageRevalidator />
    </PageFrame>
  );
}
