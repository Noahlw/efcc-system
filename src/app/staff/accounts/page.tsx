import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PageFrame, RootFrame } from "@/components/page-frame";
import { PrimaryNavigation } from "@/components/primary-navigation";
import { UnavailableView } from "@/components/unavailable-view";
import { ApplicationRequestError } from "@/features/account/applications";
import { StaffAccountDeletion } from "@/features/account/deletion-form";
import { StaffIdentityCorrections } from "@/features/account/identity-form";
import { StaffRestrictions } from "@/features/account/restrictions-form";
import { getAccountSecurityState } from "@/features/account/security";
import { getStaffAccounts } from "@/features/account/staff-accounts";
import type { ManagedAccount } from "@/features/account/staff-accounts";
import { StaffAccountsForm } from "@/features/account/staff-accounts-form";
import {
  StaffManagementMenu,
  StaffPeopleWorkspace,
  staffPeopleHref,
} from "@/features/account/staff-management-workspace";
import { StaffTaskFrame } from "@/features/account/staff-task-frame";
import { RestoredPageRevalidator } from "@/features/auth/restored-page-revalidator";
import { SignOutButton } from "@/features/auth/sign-out-button";
import { getPersonIdentity } from "@/features/identity/queries";
import { getDb } from "@/server/db/client";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;
type StaffTask =
  | "create"
  | "recovery"
  | "identity"
  | "restrictions"
  | "deletion";
interface IdentityContext {
  actorName?: string;
  actorUsername: string | null;
  confirmationExpiresAt: number | null;
}

const taskTitle: Record<StaffTask, string> = {
  create: "建立帳戶",
  deletion: "永久刪除帳戶",
  identity: "修正身份資料",
  recovery: "帳戶復原",
  restrictions: "會籍與限制",
};

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const isStaffTask = (value: string | undefined): value is StaffTask =>
  value === "create" ||
  value === "recovery" ||
  value === "identity" ||
  value === "restrictions" ||
  value === "deletion";

const loadAccounts = async (requestHeaders: Headers) => {
  try {
    return { accounts: await getStaffAccounts(requestHeaders) } as const;
  } catch (error) {
    if (error instanceof ApplicationRequestError && error.status === 401) {
      redirect("/sign-in");
    }
    return {
      error:
        error instanceof ApplicationRequestError && error.status === 403
          ? "forbidden"
          : "unavailable",
    } as const;
  }
};

const StaffAccessDenied = ({ requestHeaders }: { requestHeaders: Headers }) => (
  <RootFrame
    navigation={
      <PrimaryNavigation
        accessAllowed={requestHeaders.get("x-efcc-access") === "full"}
        currentPath="/staff/accounts"
        passwordChangeRequired={
          requestHeaders.get("x-efcc-access") === "password-change-required"
        }
      />
    }
  >
    <main className="mx-auto flex w-full max-w-4xl flex-col">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-root font-semibold">無法管理帳戶</h1>
          <p className="text-muted-foreground mt-4" role="status">
            你目前沒有帳戶管理權限。
          </p>
        </div>
        <SignOutButton />
      </header>
      <RestoredPageRevalidator />
    </main>
  </RootFrame>
);

const StaffLoadUnavailable = ({
  requestHeaders,
}: {
  requestHeaders: Headers;
}) => (
  <UnavailableView
    retryHref="/staff/accounts"
    rootNavigation={{
      accessAllowed: requestHeaders.get("x-efcc-access") === "full",
      currentPath: "/staff/accounts",
      passwordChangeRequired:
        requestHeaders.get("x-efcc-access") === "password-change-required",
    }}
    title="暫時未能載入帳戶管理"
  />
);

const StaffTaskHeader = ({
  returnHref,
  returnLabel,
  target,
  title,
}: {
  returnHref?: string;
  returnLabel?: string;
  target?: ManagedAccount;
  title: string;
}) => (
  <header className="mb-6 flex flex-col gap-3">
    {returnHref ? (
      <Link
        className="text-primary inline-flex min-h-11 items-center underline underline-offset-4 focus-visible:outline-2"
        href={returnHref}
        prefetch={false}
      >
        ← {returnLabel ?? "返回帳戶詳情"}
      </Link>
    ) : null}
    <h1 className="text-task font-semibold">{title}</h1>
    {target ? (
      <p className="text-muted-foreground">
        對象：{target.fullName}（{target.username ?? "未設定 Username"}）
      </p>
    ) : null}
  </header>
);

const renderMissingTarget = ({
  accounts,
  actorUserId,
  identityContext,
  personId,
  task,
}: {
  accounts: ManagedAccount[];
  actorUserId: string;
  identityContext?: IdentityContext;
  personId?: string;
  task: Exclude<StaffTask, "create">;
}) => {
  if (task === "deletion" && personId) {
    return (
      <PageFrame variant="task">
        <StaffTaskHeader
          returnHref="/staff/accounts?view=people"
          returnLabel="返回帳戶列表"
          title="查核之前的刪除操作"
        />
        <StaffAccountDeletion
          key={personId}
          actorUserId={actorUserId}
          accounts={accounts}
          targetUserId={personId}
        />
        <RestoredPageRevalidator />
      </PageFrame>
    );
  }
  if (task === "recovery" && personId) {
    return (
      <PageFrame variant="task">
        <StaffTaskHeader title="查核之前的操作" />
        <StaffAccountsForm
          key={`recovery:${personId}`}
          actorName={identityContext?.actorName}
          actorUserId={actorUserId}
          actorUsername={identityContext?.actorUsername}
          accounts={accounts}
          confirmationExpiresAt={identityContext?.confirmationExpiresAt}
          mode="recovery"
          returnHref="/staff/accounts?view=people"
          returnLabel="返回帳戶列表"
          targetUserId={personId}
        />
        <RestoredPageRevalidator />
      </PageFrame>
    );
  }
  return (
    <PageFrame variant="task">
      <StaffTaskHeader
        returnHref="/staff/accounts?view=people"
        returnLabel="返回帳戶列表"
        title="無法查看此帳戶"
      />
      <p className="mt-5" role="status">
        此帳戶目前不在你的管理範圍內，或暫時無法載入。沒有顯示帳戶資料或操作。
      </p>
    </PageFrame>
  );
};

const loadIdentityContext = async (
  requestHeaders: Headers,
  actorUserId: string
): Promise<IdentityContext | null> => {
  try {
    const [securityState, actorIdentity] = await Promise.all([
      getAccountSecurityState(requestHeaders),
      getPersonIdentity(getDb(), actorUserId),
    ]);
    return {
      actorName: actorIdentity?.displayName ?? undefined,
      actorUsername: actorIdentity?.username ?? null,
      confirmationExpiresAt: securityState.passwordConfirmationExpiresAt,
    };
  } catch {
    return null;
  }
};

const StaffTaskContent = ({
  accounts,
  actorUserId,
  deactivationHref,
  identityContext,
  returnHref,
  target,
  task,
}: {
  accounts: ManagedAccount[];
  actorUserId: string;
  deactivationHref: string;
  identityContext?: IdentityContext;
  returnHref: string;
  target: ManagedAccount;
  task: Exclude<StaffTask, "create">;
}) => {
  switch (task) {
    case "recovery": {
      return (
        <StaffAccountsForm
          key={`recovery:${target.userId}`}
          actorName={identityContext?.actorName}
          actorUserId={actorUserId}
          actorUsername={identityContext?.actorUsername}
          accounts={accounts}
          confirmationExpiresAt={identityContext?.confirmationExpiresAt}
          mode="recovery"
          returnHref={returnHref}
          targetUserId={target.userId}
        />
      );
    }
    case "identity": {
      return identityContext ? (
        <StaffIdentityCorrections
          key={`identity:${target.userId}`}
          actorName={identityContext.actorName}
          actorUsername={identityContext.actorUsername}
          actorUserId={actorUserId}
          accounts={accounts}
          confirmationExpiresAt={identityContext.confirmationExpiresAt}
          returnHref={returnHref}
          targetUserId={target.userId}
        />
      ) : (
        <UnavailableView
          retryHref="/staff/accounts"
          title="暫時未能載入目前登入資料"
        />
      );
    }
    case "restrictions": {
      return identityContext ? (
        <StaffRestrictions
          key={`restrictions:${target.userId}`}
          actorName={identityContext.actorName}
          actorUsername={identityContext.actorUsername}
          actorUserId={actorUserId}
          accounts={accounts}
          confirmationExpiresAt={identityContext.confirmationExpiresAt}
          targetUserId={target.userId}
        />
      ) : (
        <UnavailableView
          retryHref="/staff/accounts"
          title="暫時未能載入目前登入資料"
        />
      );
    }
    case "deletion": {
      return (
        <StaffAccountDeletion
          key={`deletion:${target.userId}`}
          actorUserId={actorUserId}
          accounts={accounts}
          deactivationHref={deactivationHref}
          returnHref={returnHref}
          targetUserId={target.userId}
        />
      );
    }
    default: {
      return null;
    }
  }
};

const renderStaffTask = async ({
  accounts,
  actorUserId,
  personId,
  query,
  requestHeaders,
  task,
}: {
  accounts: ManagedAccount[];
  actorUserId: string;
  personId?: string;
  query: string;
  requestHeaders: Headers;
  task: StaffTask;
}) => {
  const identityContext =
    task === "create" ||
    task === "identity" ||
    task === "recovery" ||
    task === "restrictions"
      ? await loadIdentityContext(requestHeaders, actorUserId)
      : undefined;
  if (task === "create") {
    return (
      <PageFrame variant="task">
        <StaffTaskHeader title={taskTitle.create} />
        <StaffAccountsForm
          actorName={identityContext?.actorName}
          actorUserId={actorUserId}
          actorUsername={identityContext?.actorUsername}
          accounts={accounts}
          confirmationExpiresAt={identityContext?.confirmationExpiresAt}
          mode="create"
          returnHref="/staff/accounts"
          returnLabel="返回管理"
        />
        <RestoredPageRevalidator />
      </PageFrame>
    );
  }

  const target = accounts.find((account) => account.userId === personId);
  if (!target) {
    return renderMissingTarget({
      accounts,
      actorUserId,
      identityContext: identityContext ?? undefined,
      personId,
      task,
    });
  }

  const returnHref = staffPeopleHref(query, target.userId);
  return (
    <PageFrame variant="task">
      <StaffTaskFrame
        returnHref={
          task === "identity" || task === "recovery" || task === "deletion"
            ? undefined
            : returnHref
        }
        target={{ fullName: target.fullName, username: target.username }}
        title={taskTitle[task]}
      >
        <StaffTaskContent
          accounts={accounts}
          actorUserId={actorUserId}
          deactivationHref={staffPeopleHref(
            query,
            target.userId,
            "restrictions"
          )}
          identityContext={identityContext ?? undefined}
          returnHref={returnHref}
          target={target}
          task={task}
        />
      </StaffTaskFrame>
      <RestoredPageRevalidator />
    </PageFrame>
  );
};

export default async function StaffAccountsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const view = first(params.view);
  const personId = first(params.person);
  const query = first(params.q)?.trim().slice(0, 128) ?? "";
  const requestedTask = first(params.task);
  const task = isStaffTask(requestedTask) ? requestedTask : undefined;
  const requestHeaders = await headers();
  const result = await loadAccounts(requestHeaders);
  if ("error" in result) {
    return result.error === "forbidden" ? (
      <StaffAccessDenied requestHeaders={requestHeaders} />
    ) : (
      <StaffLoadUnavailable requestHeaders={requestHeaders} />
    );
  }

  const actorUserId = requestHeaders.get("x-efcc-user-id");
  if (!actorUserId) {
    redirect("/sign-in");
  }
  if (task) {
    return renderStaffTask({
      accounts: result.accounts,
      actorUserId,
      personId,
      query,
      requestHeaders,
      task,
    });
  }
  if (view === "people" || personId) {
    const personSelected = result.accounts.some(
      (account) => account.userId === personId
    );
    return (
      <RootFrame
        navigation={
          <PrimaryNavigation
            accessAllowed
            canManageAccounts
            currentPath="/staff/accounts"
            mobileHidden={personSelected}
          />
        }
        showMobileNavigation={!personSelected}
      >
        <StaffPeopleWorkspace
          accounts={result.accounts}
          personId={personId}
          query={query}
        />
        <RestoredPageRevalidator />
      </RootFrame>
    );
  }
  return (
    <RootFrame
      navigation={
        <PrimaryNavigation
          accessAllowed
          canManageAccounts
          currentPath="/staff/accounts"
        />
      }
    >
      <div className="mb-6 flex justify-end">
        <SignOutButton />
      </div>
      <StaffManagementMenu />
      <RestoredPageRevalidator />
    </RootFrame>
  );
}
