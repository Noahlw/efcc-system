import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import {
  PageFrame,
  PageLoading,
  RootFrame,
  TaskHeader,
} from "@/components/page-frame";
import { PrimaryNavigation } from "@/components/primary-navigation";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { UnavailableView } from "@/components/unavailable-view";
import { requireStaff } from "@/features/account/account-actors";
import { StaffAccountsForm } from "@/features/account/assisted-accounts/staff-accounts-form";
import { BusinessApiError } from "@/features/account/business-request";
import { StaffAccountDeletion } from "@/features/account/deletion/deletion-form";
import { StaffIdentityCorrections } from "@/features/account/identity-changes/identity-form";
import {
  getStaffAccountDetail,
  getStaffAccountPage,
} from "@/features/account/managed-accounts";
import type { ManagedAccount } from "@/features/account/managed-accounts";
import { AccountTargetCard } from "@/features/account/operation-presentation";
import { StaffRestrictions } from "@/features/account/restrictions/restrictions-form";
import { getAccountSecurityState } from "@/features/account/security/security";
import { staffAccountIdentifier } from "@/features/account/staff-account-identifier";
import {
  normalizedStaffAccountPage,
  parseStaffSearch,
} from "@/features/account/staff-search-contract";
import { StaffAccessDenied } from "@/features/account/staff-workspace/staff-access-denied";
import {
  StaffManagementMenu,
  StaffPeopleWorkspace,
} from "@/features/account/staff-workspace/staff-management-workspace";
import { staffPeopleHref } from "@/features/account/staff-workspace/staff-people-href";
import type {
  StaffAccountsTaskContext,
  StaffPersonTask,
  StaffPersonTaskContext,
  StaffTaskActorContext,
  StaffTaskName,
} from "@/features/account/staff-workspace/staff-task-contract";
import { RestoredPageRevalidator } from "@/features/auth/restored-page-revalidator";
import { getPersonIdentity } from "@/features/identity/queries";
import { hasProgramLeaderManagement } from "@/features/roles/program-leaders";
import { getDb } from "@/server/db/client";
import { roleAssignerAssignment } from "@/server/db/schema/roles";
import { protectedRetrySearchParams } from "@/shared/protected-pages";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;
type IdentityContext = NonNullable<StaffTaskActorContext["identity"]>;

const firstSearchParamValue = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const hasAdminRole = (role: string | undefined) => role === "admin";

const isStaffTask = (value: string | undefined): value is StaffTaskName =>
  value === "create" ||
  value === "recovery" ||
  value === "identity" ||
  value === "restrictions" ||
  value === "deletion";

const loadAccounts = async (
  requestHeaders: Headers,
  requestedPage: string | undefined,
  query: string,
  showDirectory: boolean
) => {
  try {
    if (showDirectory) {
      return await getStaffAccountPage(requestHeaders, requestedPage, query);
    }
    await requireStaff(requestHeaders);
    parseStaffSearch(query);
    return {
      accounts: [],
      hasNextPage: false,
      page: normalizedStaffAccountPage(requestedPage),
    };
  } catch (error) {
    if (error instanceof BusinessApiError && error.status === 401) {
      redirect("/sign-in");
    }
    if (
      error instanceof BusinessApiError &&
      error.status === 400 &&
      error.code === "validation_error"
    ) {
      return {
        accounts: [],
        hasNextPage: false,
        page: normalizedStaffAccountPage(requestedPage),
        queryError: error.message,
      };
    }
    return {
      error:
        error instanceof BusinessApiError && error.status === 403
          ? "forbidden"
          : "unavailable",
    } as const;
  }
};

const loadAccountDetail = async (requestHeaders: Headers, personId: string) => {
  try {
    return {
      account: await getStaffAccountDetail(requestHeaders, personId),
    } as const;
  } catch (error) {
    if (error instanceof BusinessApiError && error.status === 401) {
      redirect("/sign-in");
    }
    return {
      error:
        error instanceof BusinessApiError && error.status === 403
          ? "forbidden"
          : "unavailable",
    } as const;
  }
};

const StaffLoadUnavailable = ({
  requestHeaders,
  retrySearchParams,
}: {
  requestHeaders: Headers;
  retrySearchParams: Record<string, string>;
}) => (
  <UnavailableView
    retryHref="/staff/accounts"
    retrySearchParams={retrySearchParams}
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
  <TaskHeader
    returnControl={
      returnHref ? (
        <Link
          className="text-primary inline-flex min-h-11 items-center gap-2 focus-visible:outline-2"
          href={returnHref}
          prefetch={false}
        >
          <Icon className="size-5 shrink-0" name="arrow-left" />
          {returnLabel ?? "返回帳戶詳情"}
        </Link>
      ) : undefined
    }
    title={title}
  >
    {target ? (
      <AccountTargetCard
        identifier={staffAccountIdentifier(target)}
        name={target.fullName}
      />
    ) : null}
  </TaskHeader>
);

const staffTaskNavigation = (
  identity: StaffTaskActorContext["identity"],
  fullPageNavigation: boolean
) =>
  identity?.actorName ? (
    <PrimaryNavigation
      accessAllowed
      canManageAccounts
      currentPath="/staff/accounts"
      fullPageNavigation={fullPageNavigation}
      mobileHidden
      signedInAs={{
        displayName: identity.actorName,
        subtitle: "職員 · 個人帳戶",
      }}
    />
  ) : undefined;

const StaffPersonUnavailable = ({ returnHref }: { returnHref: string }) => (
  <PageFrame variant="task">
    <StaffTaskHeader
      returnHref={returnHref}
      returnLabel="返回帳戶列表"
      title="無法查看此帳戶"
    />
    <p className="mt-5" role="status">
      此帳戶目前不在你的管理範圍內，或暫時無法載入。沒有顯示帳戶資料或操作。
    </p>
  </PageFrame>
);

const resolveStaffAccountSelection = async ({
  personId,
  requestHeaders,
  retrySearchParams,
  task,
}: {
  personId: string | undefined;
  requestHeaders: Headers;
  retrySearchParams: Record<string, string>;
  task: StaffTaskName | undefined;
}) => {
  if (!personId || task === "create") {
    return { account: undefined } as const;
  }
  const selected = await loadAccountDetail(requestHeaders, personId);
  if ("error" in selected) {
    return {
      response:
        selected.error === "forbidden" ? (
          <StaffAccessDenied />
        ) : (
          <StaffLoadUnavailable
            requestHeaders={requestHeaders}
            retrySearchParams={retrySearchParams}
          />
        ),
    } as const;
  }
  return { account: selected.account } as const;
};

const renderMissingTarget = ({
  accounts,
  actor,
  personId,
  task,
  query,
  page,
}: {
  query: string;
  page: number;
  accounts: ManagedAccount[];
  actor: StaffTaskActorContext;
  personId?: string;
  task: StaffPersonTask;
}) => {
  if (task === "deletion" && personId) {
    const context: StaffPersonTaskContext = {
      actor,
      returnTo: {
        href: staffPeopleHref(query, undefined, undefined, page),
        label: "返回帳戶列表",
      },
      targetUserId: personId,
      task: "deletion",
    };
    return (
      <PageFrame
        navigation={staffTaskNavigation(actor.identity, true)}
        variant="task"
      >
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
        href: staffPeopleHref(query, undefined, undefined, page),
        label: "返回帳戶列表",
      },
      targetUserId: personId,
      task: "recovery",
    };
    return (
      <PageFrame
        navigation={staffTaskNavigation(actor.identity, true)}
        variant="task"
      >
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
    <StaffPersonUnavailable
      returnHref={staffPeopleHref(query, undefined, undefined, page)}
    />
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
  const actorUnavailable = (
    <UnavailableView
      backHref={context.returnTo.href}
      backLabel={`← ${context.returnTo.label}`}
      embedded
      retryHref="/staff/accounts"
      retrySearchParams={retrySearchParams}
      title="暫時未能載入目前登入資料"
    />
  );
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
        actorUnavailable
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
        actorUnavailable
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
  page,
  requestHeaders,
  selectedAccount,
  task,
}: {
  accounts: ManagedAccount[];
  actorUserId: string;
  page: number;
  personId?: string;
  query: string;
  requestHeaders: Headers;
  selectedAccount: ManagedAccount | undefined;
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
      <PageFrame
        navigation={staffTaskNavigation(actor.identity, true)}
        variant="task"
      >
        <StaffAccountsForm accounts={accounts} context={context} />
        <RestoredPageRevalidator />
      </PageFrame>
    );
  }

  const target = selectedAccount;
  if (!target || target.role === "admin") {
    return renderMissingTarget({
      accounts,
      actor,
      page,
      personId,
      query,
      task,
    });
  }

  const context: StaffPersonTaskContext = {
    actor,
    returnTo: {
      href: staffPeopleHref(query, target.userId, undefined, page),
      label: "返回帳戶詳情",
    },
    targetUserId: target.userId,
    task,
  };
  const retrySearchParams = {
    person: context.targetUserId,
    ...(page > 1 ? { page: String(page) } : {}),
    ...(query ? { q: query } : {}),
    task: context.task,
    view: "people",
  };
  return (
    <PageFrame
      navigation={staffTaskNavigation(actor.identity, true)}
      variant="task"
    >
      <StaffTaskContent
        accounts={selectedAccount ? [selectedAccount] : accounts}
        context={context}
        deactivationHref={staffPeopleHref(
          query,
          context.targetUserId,
          "restrictions",
          page
        )}
        retrySearchParams={retrySearchParams}
      />
      <RestoredPageRevalidator />
    </PageFrame>
  );
};

const StaffTaskQueryCorrection = ({
  message,
  page,
  personId,
  query,
  task,
}: {
  message?: string;
  page: number;
  personId?: string;
  query: string;
  task: StaffTaskName;
}) =>
  message ? (
    <form
      action="/staff/accounts"
      className="mx-auto w-full max-w-[600px] p-4"
      role="search"
    >
      <input type="hidden" name="view" value="people" />
      <input type="hidden" name="task" value={task} />
      {personId ? <input type="hidden" name="person" value={personId} /> : null}
      {page > 1 ? <input type="hidden" name="page" value={page} /> : null}
      <label htmlFor="staff-task-query">搜尋帳戶</label>
      <Input
        id="staff-task-query"
        name="q"
        type="search"
        defaultValue={query}
        aria-invalid
        aria-describedby="staff-task-query-error"
      />
      <p id="staff-task-query-error" role="alert">
        {message}
      </p>
      <Button type="submit">修正搜尋</Button>
    </form>
  ) : null;

const shouldLoadDirectory = (
  view: string | undefined,
  task: StaffTaskName | undefined,
  selectedPerson: boolean,
  selectedAccount: ManagedAccount | undefined,
  personId: string | undefined
) =>
  !task &&
  (!selectedPerson || !selectedAccount) &&
  (view === "people" || Boolean(personId));

const StaffAccountsContent = async ({ params }: { params: SearchParams }) => {
  const retrySearchParams = protectedRetrySearchParams(
    "/staff/accounts",
    params
  );
  const view = firstSearchParamValue(params.view);
  const personId = firstSearchParamValue(params.person);
  const query = firstSearchParamValue(params.q)?.trim() ?? "";
  const requestedTask = firstSearchParamValue(params.task);
  const task = isStaffTask(requestedTask) ? requestedTask : undefined;
  const requestHeaders = await headers();
  const selectedPerson = Boolean(personId && task !== "create");
  const selection = await resolveStaffAccountSelection({
    personId,
    requestHeaders,
    retrySearchParams,
    task,
  });
  if ("response" in selection) {
    return selection.response;
  }
  const selectedAccount = selection.account;
  const showDirectory = shouldLoadDirectory(
    view,
    task,
    selectedPerson,
    selectedAccount,
    personId
  );
  const result = await loadAccounts(
    requestHeaders,
    firstSearchParamValue(params.page),
    query,
    showDirectory
  );
  if ("error" in result) {
    return result.error === "forbidden" ? (
      <StaffAccessDenied />
    ) : (
      <StaffLoadUnavailable
        requestHeaders={requestHeaders}
        retrySearchParams={retrySearchParams}
      />
    );
  }

  const actorUserId = requestHeaders.get("x-efcc-user-id");
  if (!actorUserId) {
    redirect("/sign-in");
  }
  if (task) {
    const content = await renderStaffTask({
      accounts: selectedAccount ? [selectedAccount] : [],
      actorUserId,
      page: result.page,
      personId,
      query,
      requestHeaders,
      selectedAccount,
      task,
    });
    return (
      <>
        <StaffTaskQueryCorrection
          message={"queryError" in result ? result.queryError : undefined}
          page={result.page}
          personId={personId}
          query={query}
          task={task}
        />
        {content}
      </>
    );
  }

  const actorIdentity = await getPersonIdentity(getDb(), actorUserId).catch(
    () => null
  );
  const signedInAs = actorIdentity
    ? {
        displayName: actorIdentity.displayName,
        subtitle: "職員 · 個人帳戶",
      }
    : undefined;
  const renderWorkspace = async () => {
    if (view === "people" || personId) {
      const queryError = "queryError" in result ? result.queryError : undefined;
      const directoryAccounts = selectedAccount
        ? [selectedAccount]
        : result.accounts;
      const personSelected = selectedAccount?.userId === personId;
      return (
        <RootFrame
          navigation={
            <PrimaryNavigation
              accessAllowed
              canManageAccounts
              currentPath="/staff/accounts"
              signedInAs={signedInAs}
              mobileHidden={personSelected}
            />
          }
          showMobileNavigation={!personSelected}
        >
          <StaffPeopleWorkspace
            accounts={queryError ? [] : directoryAccounts}
            initialQueryError={queryError}
            personId={personId}
            page={result.page}
            hasNextPage={result.hasNextPage}
            query={query}
            selectedAccount={selectedAccount}
          />
          <RestoredPageRevalidator />
        </RootFrame>
      );
    }
    const roleAssigner =
      actorIdentity?.accountRole === "staff"
        ? await getDb()
            .select({ id: roleAssignerAssignment.id })
            .from(roleAssignerAssignment)
            .where(eq(roleAssignerAssignment.userId, actorUserId))
            .limit(1)
            .get()
        : null;
    let canManageProgramLeaders: boolean;
    try {
      canManageProgramLeaders =
        await hasProgramLeaderManagement(requestHeaders);
    } catch (error) {
      if (error instanceof BusinessApiError && error.status === 401) {
        redirect("/sign-in");
      }
      return (
        <StaffLoadUnavailable
          requestHeaders={requestHeaders}
          retrySearchParams={retrySearchParams}
        />
      );
    }
    return (
      <RootFrame
        navigation={
          <PrimaryNavigation
            accessAllowed
            canManageAccounts
            currentPath="/staff/accounts"
            signedInAs={signedInAs}
          />
        }
      >
        <StaffManagementMenu
          actorName={actorIdentity?.displayName}
          canManageProgramLeaders={canManageProgramLeaders}
          isAdmin={hasAdminRole(actorIdentity?.accountRole)}
          isRoleAssigner={Boolean(roleAssigner)}
        />
        <RestoredPageRevalidator />
      </RootFrame>
    );
  };
  return renderWorkspace();
};

export default async function StaffAccountsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  if (
    firstSearchParamValue(params.view) === "people" &&
    !firstSearchParamValue(params.person) &&
    !firstSearchParamValue(params.task)
  ) {
    return (
      <Suspense
        fallback={
          <PageFrame variant="task">
            <PageLoading title="帳戶管理" />
          </PageFrame>
        }
      >
        <StaffAccountsContent params={params} />
      </Suspense>
    );
  }
  return <StaffAccountsContent params={params} />;
}
