import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ChurchBrand, PageFrame, RootFrame } from "@/components/page-frame";
import { PrimaryNavigation } from "@/components/primary-navigation";
import { Button } from "@/components/ui/button";
import { SafeStateBody, UnavailableView } from "@/components/unavailable-view";
import { getOwnAccountIdentity } from "@/features/account/account-changes";
import { ApplicationRequestError } from "@/features/account/applications";
import { IdentityChangeForm } from "@/features/account/identity-form";
import {
  AccountOperationOutcome,
  AccountOperationSummary,
  AccountTaskLink,
} from "@/features/account/operation-presentation";
import { getAccountSecurityState } from "@/features/account/security";
import { AccountSecurityForm } from "@/features/account/security-form";
import type { AccountSecurityTask } from "@/features/account/security-form";
import { RestoredPageRevalidator } from "@/features/auth/restored-page-revalidator";
import { SignOutButton } from "@/features/auth/sign-out-button";
import { membershipStatusLabel } from "@/features/identity/labels";
import { getPersonIdentity } from "@/features/identity/queries";
import type { PersonIdentity } from "@/features/identity/queries";
import { getDb } from "@/server/db/client";

export const dynamic = "force-dynamic";

const accountTaskValues = [
  "phone",
  "security",
  "password",
  "sessions",
  "confirm",
] as const;
type AccountTask = (typeof accountTaskValues)[number];
type AccountSecurityState = Awaited<ReturnType<typeof getAccountSecurityState>>;
const isAccountTask = (value: unknown): value is AccountTask =>
  typeof value === "string" &&
  (accountTaskValues as readonly string[]).includes(value);

const loadSecurityState = async (requestHeaders: Headers) => {
  try {
    return await getAccountSecurityState(requestHeaders);
  } catch (error) {
    if (error instanceof ApplicationRequestError && error.status === 401) {
      redirect("/sign-in");
    }
    return null;
  }
};

const loadOverview = async (requestHeaders: Headers, userId: string) => {
  try {
    const [identity, contact] = await Promise.all([
      getPersonIdentity(getDb(), userId),
      getOwnAccountIdentity(requestHeaders),
    ]);
    return identity && contact ? { contact, identity } : null;
  } catch (error) {
    if (error instanceof ApplicationRequestError && error.status === 401) {
      redirect("/sign-in");
    }
    return null;
  }
};

const accountTaskNavigation = ({
  fullPageNavigation,
  identity,
  requestHeaders,
  state,
}: {
  fullPageNavigation: boolean;
  identity: PersonIdentity | null;
  requestHeaders: Headers;
  state: AccountSecurityState;
}) => {
  if (!identity) {
    return null;
  }
  const accessAllowed = requestHeaders.get("x-efcc-access") === "full";
  return (
    <PrimaryNavigation
      accessAllowed={accessAllowed}
      canManageAccounts={
        accessAllowed &&
        (identity.accountRole === "staff" || identity.accountRole === "admin")
      }
      currentPath="/account"
      fullPageNavigation={fullPageNavigation}
      mobileHidden
      passwordChangeRequired={state.temporaryPasswordExpiresAt !== null}
      signedInAs={{
        displayName: identity.displayName,
        subtitle:
          identity.accountRole === "staff" || identity.accountRole === "admin"
            ? "職員 · 個人帳戶"
            : (identity.username ?? undefined),
      }}
    />
  );
};

const TemporaryPasswordTask = ({
  identity,
  requestHeaders,
  state,
  userId,
}: {
  identity: PersonIdentity | null;
  requestHeaders: Headers;
  state: AccountSecurityState;
  userId: string;
}) => (
  <PageFrame
    navigation={accountTaskNavigation({
      fullPageNavigation: false,
      identity,
      requestHeaders,
      state,
    })}
    variant="task"
  >
    <AccountSecurityForm
      actorUserId={userId}
      actorName={identity?.displayName}
      actorUsername={identity?.username}
      confirmationExpiresAt={state.passwordConfirmationExpiresAt}
      temporaryPasswordExpiresAt={state.temporaryPasswordExpiresAt}
      temporaryPasswordExpired={state.temporaryPasswordExpired}
      task="password"
    />
    <div
      className={
        state.temporaryPasswordExpired ? "mt-6 [&>button]:w-full" : "mt-6"
      }
    >
      <SignOutButton
        variant={state.temporaryPasswordExpired ? "secondary" : "quiet"}
      />
    </div>
    <RestoredPageRevalidator />
  </PageFrame>
);

const AccountTaskPage = async ({
  identity,
  requestHeaders,
  state,
  task,
  userId,
}: {
  identity: PersonIdentity | null;
  requestHeaders: Headers;
  state: AccountSecurityState;
  task: AccountTask;
  userId: string;
}) => {
  if (task === "phone") {
    let contact;
    try {
      contact = await getOwnAccountIdentity(requestHeaders);
    } catch (error) {
      if (error instanceof ApplicationRequestError && error.status === 401) {
        redirect("/sign-in");
      }
      return (
        <PageFrame variant="task">
          <UnavailableView
            backHref="/account"
            backLabel="← 返回帳戶"
            embedded
            retryHref="/account"
            retrySearchParams={{ task: "phone" }}
            title="暫時未能載入電話資料"
          />
        </PageFrame>
      );
    }
    if (!contact) {
      return (
        <PageFrame variant="task">
          <UnavailableView
            backHref="/account"
            backLabel="← 返回帳戶"
            embedded
            retryHref="/account"
            retrySearchParams={{ task: "phone" }}
            title="暫時未能載入電話資料"
          />
        </PageFrame>
      );
    }
    return (
      <PageFrame
        navigation={accountTaskNavigation({
          fullPageNavigation: contact.phoneEditable,
          identity,
          requestHeaders,
          state,
        })}
        variant="task"
      >
        {contact.phoneEditable ? (
          <IdentityChangeForm
            actorUserId={userId}
            actorName={identity?.displayName}
            actorUsername={identity?.username}
            account={{ ...contact, userId }}
            staffVerified={false}
          />
        ) : (
          <main className="flex flex-col">
            <header className="flex flex-wrap items-center gap-3">
              <Link
                className="text-primary inline-flex min-h-12 items-center rounded-md px-2 focus-visible:outline-2"
                href="/account"
                prefetch={false}
              >
                ← 返回帳戶
              </Link>
              <h1 className="text-task">更新聯絡電話</h1>
            </header>
            <p className="text-muted-foreground mt-3" role="status">
              此帳戶目前不能更新聯絡電話。
            </p>
          </main>
        )}
        <RestoredPageRevalidator />
      </PageFrame>
    );
  }

  return (
    <PageFrame
      navigation={accountTaskNavigation({
        fullPageNavigation: true,
        identity,
        requestHeaders,
        state,
      })}
      variant="task"
    >
      <AccountSecurityForm
        actorUserId={userId}
        actorName={identity?.displayName}
        actorUsername={identity?.username}
        confirmationExpiresAt={state.passwordConfirmationExpiresAt}
        temporaryPasswordExpiresAt={state.temporaryPasswordExpiresAt}
        temporaryPasswordExpired={state.temporaryPasswordExpired}
        task={task as AccountSecurityTask}
      />
      <RestoredPageRevalidator />
    </PageFrame>
  );
};

const IncompleteAccountView = ({
  requestHeaders,
}: {
  requestHeaders: Headers;
}) => (
  <RootFrame
    navigation={
      <PrimaryNavigation
        accessAllowed={requestHeaders.get("x-efcc-access") === "full"}
        currentPath="/account"
      />
    }
  >
    <ChurchBrand />
    <SafeStateBody
      description="部分帳戶資料暫時未能載入；你仍可管理登入安全設定。"
      title="暫時未能載入帳戶資料"
    >
      <form action="/account" method="get">
        <Button className="w-full sm:w-auto" type="submit">
          重新載入
        </Button>
      </form>
      <Link
        className="bg-surface border-border text-foreground inline-flex min-h-14 items-center justify-between gap-4 rounded-lg border px-4 font-medium focus-visible:outline-2"
        href="/account?task=security"
        prefetch={false}
      >
        帳戶安全
        <span aria-hidden="true">›</span>
      </Link>
      <SignOutButton />
    </SafeStateBody>
    <RestoredPageRevalidator />
  </RootFrame>
);

const AccountOverview = ({
  contact,
  identity,
  requestHeaders,
  state,
}: {
  contact: NonNullable<Awaited<ReturnType<typeof getOwnAccountIdentity>>>;
  identity: PersonIdentity;
  requestHeaders: Headers;
  state: AccountSecurityState;
}) => (
  <RootFrame
    navigation={
      <PrimaryNavigation
        accessAllowed={requestHeaders.get("x-efcc-access") === "full"}
        canManageAccounts={
          requestHeaders.get("x-efcc-access") === "full" &&
          (identity.accountRole === "staff" || identity.accountRole === "admin")
        }
        currentPath="/account"
        passwordChangeRequired={state.temporaryPasswordExpiresAt !== null}
        signedInAs={{
          displayName: identity.displayName,
          subtitle:
            identity.accountRole === "staff" || identity.accountRole === "admin"
              ? "職員 · 個人帳戶"
              : (identity.username ?? undefined),
        }}
      />
    }
  >
    <main className="mx-auto flex w-full flex-col">
      <header>
        <h1 className="text-root">帳戶</h1>
        <p className="text-muted-foreground mt-2">你的資料與帳戶設定。</p>
      </header>

      <section
        aria-labelledby="account-summary-heading"
        className="mt-6 flex items-center gap-4"
      >
        <span
          aria-hidden="true"
          className="bg-muted text-primary text-section flex size-[58px] shrink-0 items-center justify-center rounded-full font-[650]"
        >
          {contact.fullName.slice(0, 1)}
        </span>
        <div className="min-w-0">
          <h2 className="text-section break-words" id="account-summary-heading">
            {contact.fullName}
          </h2>
          <p className="text-meta text-muted-foreground mt-1 break-all">
            {contact.username ?? "未設定使用者名稱"}
          </p>
          <span
            className={`text-meta mt-2 inline-flex rounded-full px-3 py-1 font-medium ${identity.membershipStatus === "active" ? "bg-muted text-primary" : "bg-warning-surface text-warning"}`}
          >
            會籍{membershipStatusLabel(identity.membershipStatus)}
          </span>
        </div>
      </section>
      {identity.banned ? (
        <AccountOperationOutcome
          title="帳戶已暫停使用"
          message="保安限制與會籍狀態分開處理。"
          tone="danger"
        />
      ) : null}
      <div className="grid min-w-0 gap-x-10 lg:grid-cols-2">
        <section aria-labelledby="personal-details-heading" className="mt-8">
          <h2 className="text-section" id="personal-details-heading">
            個人資料
          </h2>
          <AccountOperationSummary
            rows={[
              { label: "中文全名", value: contact.fullName },
              { label: "Username", value: contact.username ?? "—" },
              { label: "電郵", value: contact.email },
              { label: "聯絡電話", value: contact.phone ?? "—" },
            ]}
          />
          {contact.phoneEditable ? (
            <AccountTaskLink
              description="需要改姓名或電郵？請聯絡教會同工。"
              href="/account?task=phone"
              icon="smartphone"
              label="更新聯絡電話"
            />
          ) : null}
        </section>
        <section aria-labelledby="account-work-heading" className="mt-8">
          <h2 className="text-section" id="account-work-heading">
            我的帳戶
          </h2>
          <nav aria-label="帳戶工作" className="border-border mt-4 border-t">
            <AccountTaskLink
              description="查看目前會籍及限制"
              href="/status"
              icon="user"
              label="帳戶狀態"
            />
            <AccountTaskLink
              description="查看申請資料及審批狀態"
              href="/application"
              icon="file-text"
              label="我的申請"
            />
            <AccountTaskLink
              description="密碼、裝置登入及敏感操作確認"
              href="/account?task=security"
              icon="shield"
              label="帳戶安全"
            />
          </nav>
          <div className="mt-6 [&>button]:w-full">
            <SignOutButton variant="secondary" />
          </div>
        </section>
      </div>
      <RestoredPageRevalidator />
    </main>
  </RootFrame>
);
export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const requestedTask = isAccountTask(params.task) ? params.task : null;
  const requestHeaders = await headers();
  const userId = requestHeaders.get("x-efcc-user-id");
  if (!userId) {
    redirect("/sign-in");
  }

  const state = await loadSecurityState(requestHeaders);
  if (!state) {
    return requestedTask ? (
      <UnavailableView
        backHref="/account"
        backLabel="← 返回帳戶"
        retryHref="/account"
        retrySearchParams={{ task: requestedTask }}
        title="暫時未能載入帳戶安全狀態"
      />
    ) : (
      <UnavailableView
        retryHref="/account"
        rootNavigation={{
          accessAllowed: requestHeaders.get("x-efcc-access") === "full",
          currentPath: "/account",
          passwordChangeRequired:
            requestHeaders.get("x-efcc-access") === "password-change-required",
        }}
        title="暫時未能載入帳戶安全狀態"
      />
    );
  }
  const taskIdentity =
    requestedTask || state.temporaryPasswordExpiresAt !== null
      ? await getPersonIdentity(getDb(), userId).catch(() => null)
      : null;
  if (state.temporaryPasswordExpiresAt !== null) {
    return (
      <TemporaryPasswordTask
        identity={taskIdentity}
        requestHeaders={requestHeaders}
        state={state}
        userId={userId}
      />
    );
  }
  if (requestedTask) {
    return (
      <AccountTaskPage
        identity={taskIdentity}
        requestHeaders={requestHeaders}
        state={state}
        task={requestedTask}
        userId={userId}
      />
    );
  }

  const overview = await loadOverview(requestHeaders, userId);
  if (!overview) {
    return <IncompleteAccountView requestHeaders={requestHeaders} />;
  }
  return (
    <AccountOverview
      contact={overview.contact}
      identity={overview.identity}
      requestHeaders={requestHeaders}
      state={state}
    />
  );
}
