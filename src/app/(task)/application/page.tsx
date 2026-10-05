import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { UnavailableView } from "@/components/unavailable-view";
import { getApplicantState } from "@/features/account/applicant-actions";
import { ApplicantForm } from "@/features/account/applicant-form";
import { ApplicationRequestError } from "@/features/account/applications";
import { RestoredPageRevalidator } from "@/features/auth/restored-page-revalidator";
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
      <UnavailableView
        backHref="/account"
        backLabel="← 返回帳戶"
        embedded
        retryHref="/application"
        title="暫時未能載入申請"
      />
    );
  }
  const { application } = state;
  return (
    <main className="flex flex-col">
      {application ? (
        <ApplicantForm
          actorUserId={state.actorUserId}
          application={application}
          eligible={state.eligible}
        >
          <section
            aria-labelledby="application-status"
            className="border-border bg-surface rounded-lg border p-4"
          >
            <h2 className="text-section font-semibold" id="application-status">
              {statusLabels[application.status]}
            </h2>
            <dl className="divide-border mt-3 grid divide-y">
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3 py-3">
                <dt className="text-muted-foreground">姓名</dt>
                <dd className="text-right font-medium break-words">
                  {application.fullName}
                </dd>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3 py-3">
                <dt className="text-muted-foreground">Username</dt>
                <dd className="text-right font-medium break-all">
                  {application.username ?? "未設定"}
                </dd>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3 py-3">
                <dt className="text-muted-foreground">電郵</dt>
                <dd className="text-right font-medium break-all">
                  {application.email}
                </dd>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3 py-3">
                <dt className="text-muted-foreground">電話</dt>
                <dd className="text-right font-medium break-words">
                  {application.phone ?? "未設定"}
                </dd>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3 py-3">
                <dt className="text-muted-foreground">提交時間（香港）</dt>
                <dd className="text-right font-medium">
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
            <p className="text-muted-foreground mt-4">
              申請審批與會籍及帳戶保安狀態分開；審批決定和申請人可見原因會記錄在收件匣。
            </p>
          </section>
        </ApplicantForm>
      ) : (
        <>
          <header className="mb-6 flex flex-wrap items-center gap-3">
            <Link
              className="text-primary inline-flex min-h-12 items-center rounded-md px-2 focus-visible:outline-2"
              href="/account"
              prefetch={false}
            >
              ← 返回帳戶
            </Link>
            <h1 className="text-task font-semibold">我的申請</h1>
          </header>
          <p className="text-muted-foreground">
            此帳戶沒有會籍申請紀錄。已獲批准的會員停用後，不會自動變成待批申請人。
          </p>
          <div className="mt-6">
            <RecheckStatusButton />
          </div>
        </>
      )}
      <RestoredPageRevalidator />
    </main>
  );
}
