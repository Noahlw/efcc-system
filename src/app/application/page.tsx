import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { PrimaryNavigation } from "@/components/primary-navigation";
import { UnavailableView } from "@/components/unavailable-view";
import { getApplicantState } from "@/features/account/applicant-actions";
import { ApplicantForm } from "@/features/account/applicant-form";
import { ApplicationRequestError } from "@/features/account/applications";
import { RestoredPageRevalidator } from "@/features/auth/restored-page-revalidator";
import { SignOutButton } from "@/features/auth/sign-out-button";
import { RecheckStatusButton } from "@/features/identity/recheck-status-button";
import { formatChurchTimestamp } from "@/shared/time/church-time";

export const dynamic = "force-dynamic";

const statusLabels = {
  approved: "已批准",
  pending: "待批",
  rejected: "已拒絕",
  withdrawn: "已撤回",
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
      <UnavailableView retryHref="/application" title="暫時未能載入申請" />
    );
  }
  const { application } = state;
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-5 py-10">
      <h1 className="text-2xl font-semibold">我的申請</h1>
      <PrimaryNavigation
        accessAllowed={requestHeaders.get("x-efcc-access") === "full"}
        currentPath="/application"
      />
      {application ? (
        <section
          className="border-border bg-surface mt-8 rounded-lg border p-5"
          aria-labelledby="application-status"
        >
          <h2 className="text-xl font-semibold" id="application-status">
            {statusLabels[application.status]}
          </h2>
          <dl className="mt-5 grid gap-4">
            <div>
              <dt className="text-muted-foreground">姓名</dt>
              <dd>{application.fullName}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">使用者名稱</dt>
              <dd className="break-words">
                {application.username ?? "未設定"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">電郵</dt>
              <dd className="break-words">{application.email}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">電話</dt>
              <dd>{application.phone ?? "未設定"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">提交時間（香港）</dt>
              <dd>
                <time
                  dateTime={new Date(
                    application.createdAt * 1000
                  ).toISOString()}
                >
                  {formatChurchTimestamp(application.createdAt * 1000)}
                </time>
              </dd>
            </div>
          </dl>
          <p className="text-muted-foreground mt-5">
            審批決定及申請人可見的原因會記錄在收件匣；目前可用功能請查看帳戶狀態。
          </p>
        </section>
      ) : (
        <p className="text-muted-foreground mt-8">
          此帳戶沒有會籍申請紀錄。已獲批准的會員停用後，不會自動變成待批申請人。
        </p>
      )}
      {application ? (
        <ApplicantForm
          actorUserId={state.actorUserId}
          application={application}
          eligible={state.eligible}
        />
      ) : null}
      <div className="mt-8 flex flex-col gap-3">
        <RecheckStatusButton />
        <SignOutButton />
      </div>
      <RestoredPageRevalidator />
    </main>
  );
}
