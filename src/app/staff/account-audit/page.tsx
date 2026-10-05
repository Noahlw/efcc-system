import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { PrimaryNavigation } from "@/components/primary-navigation";
import { UnavailableView } from "@/components/unavailable-view";
import { ApplicationRequestError } from "@/features/account/applications";
import { getAccountAudit } from "@/features/account/decisions";
import { RestoredPageRevalidator } from "@/features/auth/restored-page-revalidator";
import { SignOutButton } from "@/features/auth/sign-out-button";
import { formatChurchTimestamp } from "@/shared/time/church-time";

export const dynamic = "force-dynamic";

const actions: Record<string, string> = {
  account_banned: "封鎖帳戶",
  account_deleted: "永久刪除帳戶",
  account_unbanned: "解除帳戶封鎖",
  application_approved: "批准會籍申請",
  application_corrected: "申請人修正資料",
  application_rejected: "拒絕會籍申請",
  application_resubmitted: "申請人重新提交申請",
  application_withdrawn: "申請人撤回申請",
  assisted_account_created: "協助建立已批准帳戶",
  membership_deactivated: "停用會籍",
  membership_reactivated: "重新啟用會籍",
  other_sessions_revoked: "登出其他裝置",
  own_phone_changed: "更改自己的電話",
  password_changed: "更改密碼",
  password_confirmed: "確認目前密碼",
  self_application_created: "自行提交會籍申請",
  staff_identity_corrected: "職員核實修正身分資料",
  staff_password_reset: "職員協助重設密碼",
  staff_shared_phone_corrected: "職員核實共用電話例外",
  temporary_password_reissued: "重新發出臨時密碼",
};

export default async function AccountAuditPage() {
  const requestHeaders = await headers();
  let events;
  try {
    events = await getAccountAudit(requestHeaders);
  } catch (error) {
    if (error instanceof ApplicationRequestError && error.status === 401) {
      redirect("/sign-in");
    }
    if (error instanceof ApplicationRequestError && error.status === 403) {
      return (
        <main className="mx-auto min-h-dvh max-w-xl px-5 py-10">
          <h1 className="text-2xl font-semibold">你沒有帳戶管理權限</h1>
          <PrimaryNavigation
            accessAllowed={requestHeaders.get("x-efcc-access") === "full"}
            currentPath="/staff/account-audit"
          />
          <SignOutButton />
          <RestoredPageRevalidator />
        </main>
      );
    }
    return (
      <UnavailableView
        retryHref="/staff/account-audit"
        title="暫時未能載入帳戶紀錄"
      />
    );
  }
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-5 py-10">
      <header className="flex items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold">帳戶紀錄</h1>
        <SignOutButton />
      </header>
      <PrimaryNavigation
        accessAllowed
        canManageAccounts
        currentPath="/staff/account-audit"
      />
      <p className="text-muted-foreground mt-6">
        此紀錄只供查閱，不可修改或刪除。操作者及對象的帳戶識別碼會永久保留，即使帳戶之後已被刪除。
      </p>
      {events.length === 0 ? (
        <p className="text-muted-foreground mt-6">目前沒有帳戶紀錄。</p>
      ) : (
        <ol className="mt-6 flex flex-col gap-4">
          {events.map((event) => {
            const when = new Date(event.createdAt * 1000);
            return (
              <li
                key={event.id}
                className="border-border bg-surface rounded-lg border p-5"
              >
                <h2 className="text-xl font-semibold">
                  {actions[event.action] ?? event.action}
                </h2>
                <p className="text-muted-foreground mt-2">
                  <time dateTime={when.toISOString()}>
                    {formatChurchTimestamp(when)}
                    （香港）
                  </time>
                </p>
                <dl className="mt-4 grid gap-3">
                  <div>
                    <dt className="text-muted-foreground">操作者帳戶</dt>
                    <dd className="break-words">{event.actorUserId}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">對象帳戶</dt>
                    <dd className="break-words">{event.targetUserId}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">紀錄識別碼</dt>
                    <dd className="break-words">{event.id}</dd>
                  </div>
                </dl>
                {event.internalNote ? (
                  <div className="mt-4">
                    <h3 className="font-medium">內部備註（申請人不可見）</h3>
                    <p className="mt-2 break-words whitespace-pre-wrap">
                      {event.internalNote}
                    </p>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      <RestoredPageRevalidator />
    </main>
  );
}
