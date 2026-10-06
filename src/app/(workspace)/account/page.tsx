import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PageFrame, RootFrame } from "@/components/page-frame";
import { PrimaryNavigation } from "@/components/primary-navigation";
import { UnavailableView } from "@/components/unavailable-view";
import { getOwnAccountIdentity } from "@/features/account/account-changes";
import { ApplicationRequestError } from "@/features/account/applications";
import { IdentityChangeForm } from "@/features/account/identity-form";
import { getAccountSecurityState } from "@/features/account/security";
import { AccountSecurityForm } from "@/features/account/security-form";
import type { AccountSecurityTask } from "@/features/account/security-form";
import { RestoredPageRevalidator } from "@/features/auth/restored-page-revalidator";
import { SignOutButton } from "@/features/auth/sign-out-button";
import { membershipStatusLabel } from "@/features/identity/labels";
import { getPersonIdentity } from "@/features/identity/queries";
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

const TemporaryPasswordTask = ({
  state,
  userId,
}: {
  state: AccountSecurityState;
  userId: string;
}) => (
  <PageFrame variant="task">
    <AccountSecurityForm
      actorUserId={userId}
      confirmationExpiresAt={state.passwordConfirmationExpiresAt}
      temporaryPasswordExpiresAt={state.temporaryPasswordExpiresAt}
      temporaryPasswordExpired={state.temporaryPasswordExpired}
      task="password"
    />
    <div className="mt-6">
      <SignOutButton />
    </div>
    <RestoredPageRevalidator />
  </PageFrame>
);

const AccountTaskPage = async ({
  requestHeaders,
  state,
  task,
  userId,
}: {
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
            title="暫時未能載入電話資料"
          />
        </PageFrame>
      );
    }
    return (
      <PageFrame variant="task">
        {contact.phoneEditable ? (
          <IdentityChangeForm
            actorUserId={userId}
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
              <h1 className="text-task font-semibold">更新聯絡電話</h1>
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
    <PageFrame variant="task">
      <AccountSecurityForm
        actorUserId={userId}
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
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <header>
        <h1 className="text-root font-semibold">帳戶</h1>
      </header>
      <p className="text-muted-foreground" role="status">
        部分帳戶資料暫時未能載入；你仍可管理登入安全設定。
      </p>
      <Link
        className="bg-surface border-border text-foreground inline-flex min-h-14 items-center justify-between gap-4 rounded-lg border px-4 font-medium focus-visible:outline-2"
        href="/account?task=security"
        prefetch={false}
      >
        帳戶安全
        <span aria-hidden="true">›</span>
      </Link>
      <SignOutButton />
      <RestoredPageRevalidator />
    </main>
  </RootFrame>
);

const AccountOverview = ({
  contact,
  identity,
  requestHeaders,
  state,
}: {
  contact: NonNullable<Awaited<ReturnType<typeof getOwnAccountIdentity>>>;
  identity: NonNullable<Awaited<ReturnType<typeof getPersonIdentity>>>;
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
      />
    }
  >
    <main className="mx-auto flex w-full max-w-4xl flex-col">
      <header>
        <h1 className="text-root font-semibold">帳戶</h1>
        <p className="text-muted-foreground mt-2">你的資料與帳戶設定。</p>
      </header>

      <section
        aria-labelledby="account-summary-heading"
        className="bg-surface border-border mt-6 rounded-xl border p-5"
      >
        <div className="flex flex-wrap items-center gap-4">
          <span
            aria-hidden="true"
            className="bg-muted text-primary text-section flex h-14 w-14 shrink-0 items-center justify-center rounded-full font-semibold"
          >
            {contact.fullName.slice(0, 1)}
          </span>
          <div className="min-w-0 flex-1">
            <h2
              className="text-section font-semibold break-words"
              id="account-summary-heading"
            >
              {contact.fullName}
            </h2>
            <p className="text-muted-foreground mt-1 break-all">
              {contact.username ?? "未設定使用者名稱"}
            </p>
            <span className="bg-muted text-primary text-meta mt-2 inline-flex min-h-8 items-center rounded-full px-3 font-medium">
              會籍{membershipStatusLabel(identity.membershipStatus)}
            </span>
          </div>
        </div>
      </section>

      <section aria-labelledby="personal-details-heading" className="mt-8">
        <h2
          className="text-section font-semibold"
          id="personal-details-heading"
        >
          個人資料
        </h2>
        <dl className="divide-border mt-2 divide-y">
          <div className="grid gap-1 py-4 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
            <dt className="text-muted-foreground">中文全名</dt>
            <dd className="font-medium break-words">{contact.fullName}</dd>
          </div>
          <div className="grid gap-1 py-4 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
            <dt className="text-muted-foreground">Username</dt>
            <dd className="font-medium break-all">{contact.username ?? "—"}</dd>
          </div>
          <div className="grid gap-1 py-4 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
            <dt className="text-muted-foreground">電郵</dt>
            <dd className="font-medium break-all">{contact.email}</dd>
          </div>
          <div className="grid gap-1 py-4 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
            <dt className="text-muted-foreground">聯絡電話</dt>
            <dd className="font-medium break-words">{contact.phone ?? "—"}</dd>
          </div>
        </dl>
        {contact.phoneEditable ? (
          <Link
            className="text-primary inline-flex min-h-12 items-center rounded-md px-3 font-medium focus-visible:outline-2 focus-visible:outline-offset-2"
            href="/account?task=phone"
            prefetch={false}
          >
            更新聯絡電話
          </Link>
        ) : null}
      </section>

      <nav
        aria-label="帳戶工作"
        className="border-border mt-6 flex flex-wrap gap-2 border-y py-4"
      >
        <Link
          className="bg-muted text-foreground inline-flex min-h-12 min-w-12 items-center justify-center rounded-md px-4 font-medium focus-visible:outline-2"
          href="/status"
          prefetch={false}
        >
          帳戶狀態
        </Link>
        <Link
          className="bg-muted text-foreground inline-flex min-h-12 min-w-12 items-center justify-center rounded-md px-4 font-medium focus-visible:outline-2"
          href="/application"
          prefetch={false}
        >
          我的申請
        </Link>
      </nav>

      <section aria-labelledby="security-settings-heading" className="mt-8">
        <h2
          className="text-section mb-4 font-semibold"
          id="security-settings-heading"
        >
          帳戶安全
        </h2>
        <p className="text-muted-foreground">
          管理此登入的密碼、其他裝置和敏感操作確認。
        </p>
        <Link
          className="bg-surface border-border text-foreground mt-4 inline-flex min-h-14 items-center justify-between gap-4 rounded-lg border px-4 font-medium focus-visible:outline-2"
          href="/account?task=security"
          prefetch={false}
        >
          帳戶安全
          <span aria-hidden="true">›</span>
        </Link>
      </section>
      <div className="mt-8">
        <SignOutButton />
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
  if (state.temporaryPasswordExpiresAt !== null) {
    return <TemporaryPasswordTask state={state} userId={userId} />;
  }
  if (requestedTask) {
    return (
      <AccountTaskPage
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
