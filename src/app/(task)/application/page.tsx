import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PageFrame, TaskHeader } from "@/components/page-frame";
import { PrimaryNavigation } from "@/components/primary-navigation";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { UnavailableView } from "@/components/unavailable-view";
import { getApplicantState } from "@/features/account/applicant-actions";
import { ApplicantForm } from "@/features/account/applicant-form";
import { ApplicationRequestError } from "@/features/account/applications";
import { AccountOperationSummary } from "@/features/account/operation-presentation";
import { RestoredPageRevalidator } from "@/features/auth/restored-page-revalidator";
import { getPersonIdentity } from "@/features/identity/queries";
import { getDb } from "@/server/db/client";
import { formatChurchTimestamp } from "@/shared/time/church-time";

export const dynamic = "force-dynamic";

const statusLabels = {
  approved: "已批准",
  pending: "待批核",
  rejected: "已拒絕",
  withdrawn: "已撤回",
};
const statusTone = {
  approved: "bg-muted text-primary",
  pending: "bg-warning-surface text-warning",
  rejected: "bg-danger-surface text-danger",
  withdrawn: "bg-background text-muted-foreground",
};

export default async function ApplicationPage() {
  const requestHeaders = await headers();
  let state;
  try {
    state = await getApplicantState(requestHeaders);
  } catch (error) {
    if (error instanceof ApplicationRequestError && error.status === 401) {
      redirect("/sign-in");
    }
    return (
      <UnavailableView
        backHref="/account"
        backLabel="← 返回帳戶"
        retryHref="/application"
        title="暫時未能載入申請"
      />
    );
  }
  const { application } = state;

  const identity = await getPersonIdentity(getDb(), state.actorUserId).catch(
    () => null
  );
  const accessAllowed = requestHeaders.get("x-efcc-access") === "full";
  const navigation = identity ? (
    <PrimaryNavigation
      accessAllowed={accessAllowed}
      canManageAccounts={
        accessAllowed &&
        (identity.accountRole === "staff" || identity.accountRole === "admin")
      }
      currentPath="/account"
      fullPageNavigation={application !== null}
      mobileHidden
      passwordChangeRequired={
        requestHeaders.get("x-efcc-access") === "password-change-required"
      }
      signedInAs={{
        displayName: identity.displayName,
        subtitle:
          identity.accountRole === "staff" || identity.accountRole === "admin"
            ? "職員 · 個人帳戶"
            : (identity.username ?? undefined),
      }}
    />
  ) : undefined;
  return (
    <PageFrame navigation={navigation} variant="task">
      <main className="flex flex-col">
        {application ? (
          <ApplicantForm
            actorUserId={state.actorUserId}
            application={application}
            eligible={state.eligible}
          >
            <section aria-labelledby="application-status" className="mt-2">
              <h2 className="sr-only" id="application-status">
                申請狀態
              </h2>
              <span
                className={`text-meta inline-flex rounded-full px-3 py-1 font-medium ${statusTone[application.status]}`}
              >
                {statusLabels[application.status]}
              </span>
              <AccountOperationSummary
                rows={[
                  { label: "姓名", value: application.fullName },
                  {
                    label: "Username",
                    value: application.username ?? "未設定",
                  },
                  { label: "電郵", value: application.email },
                  { label: "電話", value: application.phone ?? "未設定" },
                  {
                    label: "提交時間（香港）",
                    value: (
                      <time
                        dateTime={new Date(
                          application.createdAt * 1000
                        ).toISOString()}
                      >
                        {formatChurchTimestamp(application.createdAt * 1000)}
                      </time>
                    ),
                  },
                ]}
              />
              <p className="text-muted-foreground mt-4">
                申請審批與會籍及帳戶保安狀態分開；審批決定和申請人可見原因會記錄在收件匣。
              </p>
            </section>
          </ApplicantForm>
        ) : (
          <>
            <TaskHeader
              returnControl={
                <Link
                  aria-label="返回帳戶"
                  className="text-primary flex min-h-11 min-w-11 items-center justify-center rounded-lg focus-visible:outline-2"
                  href="/account"
                  prefetch={false}
                >
                  <Icon className="size-5" name="arrow-left" />
                </Link>
              }
              title="我的申請"
            />
            <section className="bg-background mt-2 rounded-xl px-5 py-8 text-center">
              <span className="bg-muted text-primary mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl">
                <Icon className="size-7" name="file-text" />
              </span>
              <h2 className="text-section font-semibold">目前沒有申請紀錄</h2>
              <p className="text-muted-foreground mt-2">
                此帳戶沒有會籍申請紀錄。已獲批准的會員停用後，不會自動變成待批申請人。
              </p>
              <Button
                className="mt-6 w-full"
                nativeButton={false}
                render={<Link href="/status" prefetch={false} />}
                variant="secondary"
              >
                帳戶狀態
              </Button>
            </section>
          </>
        )}
        <RestoredPageRevalidator />
      </main>
    </PageFrame>
  );
}
