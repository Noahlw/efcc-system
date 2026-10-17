import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { PrimaryNavigation } from "@/components/primary-navigation";
import { UnavailableView } from "@/components/unavailable-view";
import { accountActor } from "@/features/account/account-actors";
import { BusinessApiError } from "@/features/account/business-request";
import { DecisionReview } from "@/features/account/decisions/decision-review";
import { getReviewApplications } from "@/features/account/decisions/decisions";
import type { ReviewApplicationPage } from "@/features/account/decisions/decisions";
import { StaffAccessDenied } from "@/features/account/staff-workspace/staff-access-denied";
import { RestoredPageRevalidator } from "@/features/auth/restored-page-revalidator";
import { getPersonIdentity } from "@/features/identity/queries";
import { getDb } from "@/server/db/client";
import { protectedRetrySearchParams } from "@/shared/protected-pages";

const firstSearchParamValue = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export const dynamic = "force-dynamic";

export default async function ApplicationsReviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const requestHeaders = await headers();
  const requestedParams = await searchParams;
  let reviewPage: ReviewApplicationPage;
  let actorUserId: string;
  try {
    reviewPage = await getReviewApplications(
      requestHeaders,
      firstSearchParamValue(requestedParams.page),
      firstSearchParamValue(requestedParams.record)
    );
    actorUserId = accountActor(requestHeaders).userId;
  } catch (error) {
    if (error instanceof BusinessApiError && error.status === 401) {
      redirect("/sign-in");
    }
    if (error instanceof BusinessApiError && error.status === 403) {
      return <StaffAccessDenied />;
    }
    return (
      <UnavailableView
        retryHref="/staff/applications"
        retrySearchParams={protectedRetrySearchParams(
          "/staff/applications",
          requestedParams
        )}
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

  const requestedQuery = new URLSearchParams();
  for (const [key, value] of Object.entries(requestedParams)) {
    for (const entry of Array.isArray(value) ? value : [value]) {
      if (typeof entry === "string") {
        requestedQuery.append(key, entry);
      }
    }
  }
  const canonicalQuery = new URLSearchParams(requestedQuery);
  if (reviewPage.page.number === 1) {
    canonicalQuery.delete("page");
  } else {
    canonicalQuery.set("page", String(reviewPage.page.number));
  }
  if (reviewPage.selectedApplication) {
    canonicalQuery.set("record", reviewPage.selectedApplication.id);
  } else {
    canonicalQuery.delete("record");
  }
  const requestedHref = requestedQuery.size
    ? `/staff/applications?${requestedQuery.toString()}`
    : "/staff/applications";
  const canonicalHref = canonicalQuery.size
    ? `/staff/applications?${canonicalQuery.toString()}`
    : "/staff/applications";
  if (requestedHref !== canonicalHref) {
    redirect(canonicalHref);
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
        applications={reviewPage.applications}
        actorUserId={actorUserId}
        page={reviewPage.page}
        queryString={canonicalQuery.toString()}
        selectedApplication={reviewPage.selectedApplication}
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
