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
import { staffAccountIdentifier } from "@/features/account/staff-account-identifier";
import { getStaffAccounts } from "@/features/account/staff-accounts";
import type { ManagedAccount } from "@/features/account/staff-accounts";
import { StaffAccountsForm } from "@/features/account/staff-accounts-form";
import {
  StaffManagementMenu,
  StaffPeopleWorkspace,
  staffPeopleHref,
} from "@/features/account/staff-management-workspace";
import type {
  StaffAccountsTaskContext,
  StaffPersonTask,
  StaffPersonTaskContext,
  StaffTaskActorContext,
  StaffTaskName,
} from "@/features/account/staff-task-contract";
import { StaffTaskFrame } from "@/features/account/staff-task-frame";
import { RestoredPageRevalidator } from "@/features/auth/restored-page-revalidator";
import { SignOutButton } from "@/features/auth/sign-out-button";
import { getPersonIdentity } from "@/features/identity/queries";
import { getDb } from "@/server/db/client";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;
type IdentityContext = NonNullable<StaffTaskActorContext["identity"]>;

const taskTitle: Record<StaffTaskName, string> = {
  create: "建立帳戶",
  deletion: "永久刪除帳戶",
  identity: "修正身份資料",
  recovery: "帳戶復原",
  restrictions: "會籍與限制",
};

const firstSearchParamValue = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const isStaffTask = (value: string | undefined): value is StaffTaskName =>
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
        對象：{target.fullName}（{staffAccountIdentifier(target)}）
      </p>
    ) : null}
  </header>
);

const renderMissingTarget = ({
  accounts,
  actor,
  personId,
  task,
}: {
  accounts: ManagedAccount[];
  actor: StaffTaskActorContext;
  personId?: string;
  task: StaffPersonTask;
}) => {
  if (task === "deletion" && personId) {
    const context: StaffPersonTaskContext = {
      actor,
      returnTo: {
        href: "/staff/accounts?view=people",
        label: "返回帳戶列表",
      },
      targetUserId: personId,
      task: "deletion",
    };
    return (
      <PageFrame variant="task">
        <StaffTaskHeader title="查核之前的刪除操作" />
        <StaffAccountDeletion
          key={personId}
          accounts={accounts}
          context={context}
        />
        <RestoredPageRevalidator />
      </PageFrame>
    );
  }
  if (task === "recovery" && personId) {
    const context: StaffAccountsTaskContext = {
      actor,
      returnTo: {
        href: "/staff/accounts?view=people",
        label: "返回帳戶列表",
      },
      targetUserId: personId,
      task: "recovery",
    };
    return (
      <PageFrame variant="task">
        <StaffTaskHeader title="查核之前的操作" />
        <StaffAccountsForm
          key={`recovery:${personId}`}
          accounts={accounts}
          context={context}
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
  context,
  deactivationHref,
  retrySearchParams,
}: {
  accounts: ManagedAccount[];
  context: StaffPersonTaskContext;
  deactivationHref: string;
  retrySearchParams: Record<string, string>;
}) => {
  switch (context.task) {
    case "recovery": {
      const recoveryContext: StaffAccountsTaskContext = {
        actor: context.actor,
        returnTo: context.returnTo,
        targetUserId: context.targetUserId,
        task: "recovery",
      };
      return (
        <StaffAccountsForm
          key={`recovery:${recoveryContext.targetUserId}`}
          accounts={accounts}
          context={recoveryContext}
        />
      );
    }
    case "identity": {
      return context.actor.identity ? (
        <StaffIdentityCorrections
          key={`identity:${context.targetUserId}`}
          accounts={accounts}
          context={context}
        />
      ) : (
        <UnavailableView
          backHref={context.returnTo.href}
          backLabel={`← ${context.returnTo.label}`}
          embedded
          retryHref="/staff/accounts"
          retrySearchParams={retrySearchParams}
          title="暫時未能載入目前登入資料"
        />
      );
    }
    case "restrictions": {
      return context.actor.identity ? (
        <StaffRestrictions
          key={`restrictions:${context.targetUserId}`}
          accounts={accounts}
          context={context}
        />
      ) : (
        <UnavailableView
          backHref={context.returnTo.href}
          backLabel={`← ${context.returnTo.label}`}
          embedded
          retryHref="/staff/accounts"
          retrySearchParams={retrySearchParams}
          title="暫時未能載入目前登入資料"
        />
      );
    }
    case "deletion": {
      return (
        <StaffAccountDeletion
          key={`deletion:${context.targetUserId}`}
          accounts={accounts}
          context={context}
          deactivationHref={deactivationHref}
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
  task: StaffTaskName;
}) => {
  const identityContext =
    task === "create" ||
    task === "identity" ||
    task === "recovery" ||
    task === "restrictions" ||
    task === "deletion"
      ? await loadIdentityContext(requestHeaders, actorUserId)
      : undefined;
  const actor: StaffTaskActorContext = {
    userId: actorUserId,
    ...(identityContext ? { identity: identityContext } : {}),
  };
  if (task === "create") {
    const context: StaffAccountsTaskContext = {
      actor,
      returnTo: { href: "/staff/accounts", label: "返回管理" },
      targetUserId: null,
      task: "create",
    };
    return (
      <PageFrame variant="task">
        <StaffAccountsForm accounts={accounts} context={context} />
        <RestoredPageRevalidator />
      </PageFrame>
    );
  }

  const target = accounts.find((account) => account.userId === personId);
  if (!target) {
    return renderMissingTarget({ accounts, actor, personId, task });
  }

  const context: StaffPersonTaskContext = {
    actor,
    returnTo: {
      href: staffPeopleHref(query, target.userId),
      label: "返回帳戶詳情",
    },
    targetUserId: target.userId,
    task,
  };
  const retrySearchParams = {
    person: context.targetUserId,
    ...(query ? { q: query } : {}),
    task: context.task,
    view: "people",
  };
  return (
    <PageFrame variant="task">
      <StaffTaskFrame
        returnHref={
          context.task === "restrictions" ? context.returnTo.href : undefined
        }
        returnLabel={context.returnTo.label}
        target={{
          fullName: target.fullName,
          userId: target.userId,
          username: target.username,
        }}
        title={
          context.task === "restrictions" ? taskTitle[context.task] : undefined
        }
      >
        <StaffTaskContent
          accounts={accounts}
          context={context}
          deactivationHref={staffPeopleHref(
            query,
            context.targetUserId,
            "restrictions"
          )}
          retrySearchParams={retrySearchParams}
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
  const view = firstSearchParamValue(params.view);
  const personId = firstSearchParamValue(params.person);
  const query = firstSearchParamValue(params.q)?.trim().slice(0, 128) ?? "";
  const requestedTask = firstSearchParamValue(params.task);
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
