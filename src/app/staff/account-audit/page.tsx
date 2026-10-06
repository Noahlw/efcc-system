import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PageFrame, RootFrame } from "@/components/page-frame";
import { PrimaryNavigation } from "@/components/primary-navigation";
import { ApplicationRequestError } from "@/features/account/applications";
import { getAccountAudit } from "@/features/account/audit";
import { AccountOperationSummary } from "@/features/account/operation-presentation";
import { StaffTaskFrame } from "@/features/account/staff-task-frame";
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

const titleFor = (action: string) => actions[action] ?? action;

const DetailRows = ({
  actorUserId,
  action,
  createdAt,
  id,
  internalNote,
  targetUserId,
}: {
  actorUserId: string;
  action: string;
  createdAt: number;
  id: string;
  internalNote: string | null;
  targetUserId: string;
}) => {
  const when = new Date(createdAt * 1000);
  return (
    <AccountOperationSummary
      rows={[
        { label: "操作", value: titleFor(action) },
        { label: "操作者帳戶識別碼", value: actorUserId },
        { label: "對象帳戶識別碼", value: targetUserId },
        { label: "紀錄識別碼", value: id },
        {
          label: "紀錄時間（香港）",
          value: (
            <time dateTime={when.toISOString()}>
              {formatChurchTimestamp(when)}（香港）
            </time>
          ),
        },
        ...(internalNote
          ? [
              {
                label: "內部備註（申請人不可見）",
                value: (
                  <span className="whitespace-pre-wrap">{internalNote}</span>
                ),
              },
            ]
          : []),
      ]}
    />
  );
};

export default async function AccountAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ record?: string | string[] }>;
}) {
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
        <RootFrame
          navigation={
            <PrimaryNavigation
              accessAllowed={requestHeaders.get("x-efcc-access") === "full"}
              currentPath="/staff/account-audit"
            />
          }
        >
          <main className="mx-auto w-full max-w-4xl">
            <header className="flex items-start justify-between gap-4">
              <h1 className="text-root font-semibold">你沒有帳戶管理權限</h1>
              <SignOutButton />
            </header>
            <RestoredPageRevalidator />
          </main>
        </RootFrame>
      );
    }
    return (
      <RootFrame
        navigation={
          <PrimaryNavigation
            accessAllowed={requestHeaders.get("x-efcc-access") === "full"}
            currentPath="/staff/account-audit"
          />
        }
      >
        <main className="mx-auto w-full max-w-4xl">
          <header className="flex items-start justify-between gap-4">
            <h1 className="text-root font-semibold">暫時未能載入帳戶紀錄</h1>
            <SignOutButton />
          </header>
          <p className="text-muted-foreground mt-4">
            請稍後重試；紀錄未能載入時不會顯示為空清單。
          </p>
          <Link
            className="text-primary mt-4 inline-flex min-h-12 items-center underline underline-offset-4 focus-visible:outline-2"
            href="/staff/account-audit"
            prefetch={false}
          >
            重新載入帳戶紀錄
          </Link>
          <RestoredPageRevalidator />
        </main>
      </RootFrame>
    );
  }

  const params = await searchParams;
  const recordId = typeof params.record === "string" ? params.record : null;
  if (recordId) {
    const event = events.find((item) => item.id === recordId);
    return (
      <PageFrame variant="task">
        <StaffTaskFrame
          actions={<SignOutButton />}
          returnHref="/staff/account-audit"
          returnLabel="返回帳戶紀錄"
          title={event ? titleFor(event.action) : "找不到帳戶紀錄"}
        >
          {event ? (
            <section aria-label="帳戶紀錄詳情">
              <DetailRows {...event} />
            </section>
          ) : (
            <p className="text-muted-foreground">
              這項紀錄目前無法在你的帳戶紀錄中查閱。
            </p>
          )}
        </StaffTaskFrame>
        <RestoredPageRevalidator />
      </PageFrame>
    );
  }

  return (
    <RootFrame
      navigation={
        <PrimaryNavigation
          accessAllowed
          canManageAccounts
          currentPath="/staff/account-audit"
        />
      }
    >
      <main className="mx-auto w-full max-w-4xl">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-root font-semibold">帳戶紀錄</h1>
            <p className="text-muted-foreground mt-2">
              唯讀查閱；操作者、對象及紀錄識別碼會永久保留。
            </p>
          </div>
          <SignOutButton />
        </header>
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
                  <h2 className="text-section font-semibold">
                    {titleFor(event.action)}
                  </h2>
                  <time
                    className="text-muted-foreground mt-2 block"
                    dateTime={when.toISOString()}
                  >
                    {formatChurchTimestamp(when)}（香港）
                  </time>
                  <AccountOperationSummary
                    rows={[
                      { label: "操作者帳戶識別碼", value: event.actorUserId },
                      { label: "對象帳戶識別碼", value: event.targetUserId },
                      { label: "紀錄識別碼", value: event.id },
                      ...(event.internalNote
                        ? [
                            {
                              label: "職員內部備註",
                              value: "有備註，開啟詳情查閱",
                            },
                          ]
                        : []),
                    ]}
                  />
                  <Link
                    className="text-primary mt-4 inline-flex min-h-12 items-center underline underline-offset-4 focus-visible:outline-2"
                    href={`/staff/account-audit?record=${encodeURIComponent(event.id)}`}
                    prefetch={false}
                  >
                    查看詳情
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
        <RestoredPageRevalidator />
      </main>
    </RootFrame>
  );
}
