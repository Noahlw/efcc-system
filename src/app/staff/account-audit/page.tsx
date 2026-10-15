import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PageFrame, RootFrame, TaskHeader } from "@/components/page-frame";
import { PrimaryNavigation } from "@/components/primary-navigation";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { SafeStateBody, UnavailableView } from "@/components/unavailable-view";
import { BusinessApiError } from "@/features/account/business-request";
import {
  AccountOperationDetails,
  AccountOperationSummary,
  AccountTaskLink,
} from "@/features/account/operation-presentation";
import { getAccountAudit } from "@/features/account/staff-workspace/audit";
import { StaffManagementTabs } from "@/features/account/staff-workspace/staff-management-workspace";
import { RestoredPageRevalidator } from "@/features/auth/restored-page-revalidator";
import { getPersonIdentity } from "@/features/identity/queries";
import { getDb } from "@/server/db/client";
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
  id,
  internalNote,
}: {
  id: string;
  internalNote: string | null;
}) => (
  <AccountOperationSummary
    rows={[
      { label: "紀錄識別碼", value: id },
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
      <>
        <UnavailableView
          retryHref="/staff/account-audit"
          rootNavigation={{
            accessAllowed: requestHeaders.get("x-efcc-access") === "full",
            currentPath: "/staff/account-audit",
            passwordChangeRequired:
              requestHeaders.get("x-efcc-access") ===
              "password-change-required",
          }}
          title="暫時未能載入帳戶紀錄"
        />
        <RestoredPageRevalidator />
      </>
    );
  }

  const actorUserId = requestHeaders.get("x-efcc-user-id");
  const actorIdentity = actorUserId
    ? await getPersonIdentity(getDb(), actorUserId).catch(() => null)
    : null;
  const signedInAs = actorIdentity
    ? {
        displayName: actorIdentity.displayName,
        subtitle: "職員 · 個人帳戶",
      }
    : undefined;

  const params = await searchParams;
  const recordId = typeof params.record === "string" ? params.record : null;
  if (recordId) {
    const event = events.find((item) => item.id === recordId);
    return (
      <PageFrame
        navigation={
          <PrimaryNavigation
            accessAllowed
            canManageAccounts
            currentPath="/staff/account-audit"
            mobileHidden
            signedInAs={signedInAs}
          />
        }
        variant="task"
      >
        <main>
          <TaskHeader
            returnControl={
              <Link
                className="flex min-h-11 min-w-11 items-center justify-center rounded-lg focus-visible:outline-2"
                href="/staff/account-audit"
                prefetch={false}
              >
                <Icon className="size-5" name="arrow-left" />
                <span className="sr-only">返回帳戶紀錄</span>
              </Link>
            }
            title={event ? "操作紀錄" : "找不到帳戶紀錄"}
          >
            {event ? (
              <time
                className="text-meta text-muted-foreground basis-full"
                dateTime={new Date(event.createdAt * 1000).toISOString()}
              >
                {formatChurchTimestamp(new Date(event.createdAt * 1000))}
                （香港）
              </time>
            ) : null}
          </TaskHeader>
          {event ? (
            <section aria-label="帳戶紀錄詳情">
              <div className="bg-background text-primary mb-6 flex size-[44px] items-center justify-center rounded-lg">
                <Icon
                  aria-hidden="true"
                  className="size-[20px]"
                  name="file-text"
                />
              </div>
              <h2 className="text-section">{titleFor(event.action)}</h2>
              <AccountOperationSummary
                rows={[
                  { label: "操作者帳戶", value: event.actorUserId },
                  { label: "對象帳戶", value: event.targetUserId },
                ]}
              />
              <AccountOperationDetails title="紀錄詳情">
                <DetailRows {...event} />
              </AccountOperationDetails>
            </section>
          ) : (
            <p className="text-muted-foreground">
              這項紀錄目前無法在你的帳戶紀錄中查閱。
            </p>
          )}
          {event ? (
            <p className="text-meta text-muted-foreground mt-6">
              唯讀歷史紀錄，不能修改或刪除；識別碼不會因帳戶刪除而消失。
            </p>
          ) : null}
          <RestoredPageRevalidator />
        </main>
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
          signedInAs={signedInAs}
        />
      }
    >
      <main className="mx-auto flex min-h-0 w-full flex-1 flex-col">
        <TaskHeader
          returnControl={
            <Link
              className="flex min-h-11 min-w-11 items-center justify-center rounded-lg focus-visible:outline-2"
              href="/staff/accounts"
              prefetch={false}
            >
              <Icon className="size-5" name="arrow-left" />
              <span className="sr-only">返回管理</span>
            </Link>
          }
          title="帳戶操作紀錄"
        />
        <StaffManagementTabs current="audit" />
        <p className="text-muted-foreground">查看已記錄的帳戶及會籍操作。</p>
        {events.length === 0 ? (
          <p className="text-muted-foreground mt-6">目前沒有帳戶紀錄。</p>
        ) : (
          <>
            <div className="mt-6 mb-4 flex items-center justify-between gap-3">
              <h2 className="text-section">最近紀錄</h2>
              <span className="text-meta text-muted-foreground">香港時間</span>
            </div>
            <ol className="flex min-h-0 flex-col overflow-y-auto">
              {events.map((event) => {
                const when = new Date(event.createdAt * 1000);
                return (
                  <li key={event.id} className="min-w-0">
                    <AccountTaskLink
                      description={
                        <>
                          <time className="block" dateTime={when.toISOString()}>
                            {formatChurchTimestamp(when)}（香港）
                          </time>
                          <span
                            className="mt-1 block"
                            title={event.actorUserId}
                          >
                            操作者：{event.actorUserId.slice(0, 8)}…
                          </span>
                          <span className="block" title={event.targetUserId}>
                            對象：{event.targetUserId.slice(0, 8)}…
                            {event.internalNote ? " · 有職員內部備註" : ""}
                          </span>
                        </>
                      }
                      href={`/staff/account-audit?record=${encodeURIComponent(event.id)}`}
                      icon="file-text"
                      label={titleFor(event.action)}
                    />
                  </li>
                );
              })}
            </ol>
            <p className="text-meta text-muted-foreground mt-6">
              唯讀紀錄。帳戶刪除後，操作者及對象識別碼仍會保留；完整識別碼可在操作紀錄查閱。
            </p>
          </>
        )}
        <RestoredPageRevalidator />
      </main>
    </RootFrame>
  );
}
