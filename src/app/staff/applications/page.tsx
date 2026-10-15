import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PageFrame } from "@/components/page-frame";
import { PrimaryNavigation } from "@/components/primary-navigation";
import { Button } from "@/components/ui/button";
import { SafeStateBody, UnavailableView } from "@/components/unavailable-view";
import { accountActor } from "@/features/account/account-actors";
import { BusinessApiError } from "@/features/account/business-request";
import { DecisionReview } from "@/features/account/decisions/decision-review";
import { getReviewApplications } from "@/features/account/decisions/decisions";
import { RestoredPageRevalidator } from "@/features/auth/restored-page-revalidator";
import { getPersonIdentity } from "@/features/identity/queries";
import { getDb } from "@/server/db/client";

export const dynamic = "force-dynamic";

export default async function ApplicationsReviewPage() {
  const requestHeaders = await headers();
  let applications;
  let actorUserId: string;
  try {
    applications = await getReviewApplications(requestHeaders);
    actorUserId = accountActor(requestHeaders).userId;
  } catch (error) {
    if (error instanceof BusinessApiError && error.status === 401) {
      redirect("/sign-in");
    }
    if (error instanceof BusinessApiError && error.status === 403) {
      return (
        <PageFrame variant="task">
          <SafeStateBody
            description="目前無法使用這個管理工作區。"
            icon="shield"
            title="你沒有帳戶管理權限"
          >
            <Button
              className="w-full sm:w-auto"
              nativeButton={false}
              render={<Link href="/" prefetch={false} />}
              role="link"
            >
              返回個人主頁
            </Button>
            <Button
              className="w-full sm:w-auto"
              nativeButton={false}
              render={<Link href="/status" prefetch={false} />}
              role="link"
              variant="secondary"
            >
              查看帳戶狀態
            </Button>
          </SafeStateBody>
          <RestoredPageRevalidator />
        </PageFrame>
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

  const actorIdentity = await getPersonIdentity(getDb(), actorUserId).catch(
    () => null
  );
  const signedInAs = actorIdentity
    ? {
        displayName: actorIdentity.displayName,
        subtitle: "職員 · 個人帳戶",
      }
    : undefined;
  return (
    <>
      <DecisionReview
        applications={applications}
        actorUserId={actorUserId}
        navigation={
          <PrimaryNavigation
            accessAllowed
            canManageAccounts
            currentPath="/staff/applications"
            fullPageNavigation
            signedInAs={signedInAs}
          />
        }
      />
      <RestoredPageRevalidator />
    </>
  );
}
