import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { RootFrame } from "@/components/page-frame";
import { PrimaryNavigation } from "@/components/primary-navigation";
import { requireOwnBusinessAccess } from "@/features/account/account-actors";
import type { AccountActor } from "@/features/account/account-actors";
import { BusinessApiError } from "@/features/account/business-request";
import { RestoredPageRevalidator } from "@/features/auth/restored-page-revalidator";
import { getPersonIdentity } from "@/features/identity/queries";
import {
  getProgramLeaderDepartments,
  getProgramLeaderRoster,
} from "@/features/roles/program-leaders";
import { DepartmentProgramLeaderWorkspace } from "@/features/roles/ui/department-program-leader-workspace";
import { ProgramLeaderCandidatePicker } from "@/features/roles/ui/program-leader-candidate-picker";
import { getDb } from "@/server/db/client";
import {
  programLeaderWorkspaceContext,
  programLeaderWorkspaceHref,
} from "@/shared/protected-pages";
import type { ProgramLeaderWorkspaceContext } from "@/shared/protected-pages";

export const dynamic = "force-dynamic";

const accountSubtitle = (role: string, username: string | null) => {
  if (role === "admin") {
    return "管理員 · 個人帳戶";
  }
  return role === "staff" ? "職員 · 個人帳戶" : (username ?? undefined);
};

const ProgramGrantTaskPage = async ({
  context,
  requestHeaders,
  navigation,
}: {
  context: ProgramLeaderWorkspaceContext;
  requestHeaders: Headers;
  navigation: ReactNode;
}) => {
  if (!context.program) {
    redirect("/roles/program-leaders");
  }
  try {
    const baseline = await getProgramLeaderRoster(
      requestHeaders,
      context.program,
      "1"
    );
    if (
      context.department &&
      context.department !== baseline.program.departmentId
    ) {
      redirect("/roles/program-leaders");
    }
    const returnHref = programLeaderWorkspaceHref({
      ...context,
      department: baseline.program.departmentId,
    });
    return (
      <>
        <ProgramLeaderCandidatePicker
          actor={baseline.actorUserId}
          authorityAssignmentId={baseline.authorityAssignmentId}
          departmentId={baseline.program.departmentId}
          key={`${baseline.actorUserId}:${baseline.authorityAssignmentId}:${baseline.program.id}`}
          initialQuery={context.q}
          navigation={navigation}
          programId={baseline.program.id}
          returnHref={returnHref}
        />
        <RestoredPageRevalidator />
      </>
    );
  } catch (error) {
    if (error instanceof BusinessApiError && error.status === 401) {
      redirect("/sign-in");
    }
    if (
      error instanceof BusinessApiError &&
      [403, 404, 409].includes(error.status)
    ) {
      redirect("/roles/program-leaders");
    }
    throw error;
  }
};

export default async function DepartmentProgramLeadersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const initialContext = programLeaderWorkspaceContext(params);
  const requestHeaders = await headers();
  let actor: AccountActor;
  try {
    actor = await requireOwnBusinessAccess(requestHeaders);
  } catch (error) {
    if (error instanceof BusinessApiError && error.status === 401) {
      redirect("/sign-in");
    }
    if (error instanceof BusinessApiError && error.status === 403) {
      redirect("/status");
    }
    throw error;
  }

  const identity = await getPersonIdentity(getDb(), actor.userId).catch(
    () => null
  );
  if (!identity) {
    redirect("/status");
  }

  try {
    await getProgramLeaderDepartments(requestHeaders, "1");
  } catch (error) {
    if (error instanceof BusinessApiError && error.status === 401) {
      redirect("/sign-in");
    }
    if (error instanceof BusinessApiError && error.status === 403) {
      redirect("/");
    }
    throw error;
  }

  const navigation = (
    <PrimaryNavigation
      accessAllowed
      canManageProgramLeaders
      currentPath="/roles/program-leaders"
      signedInAs={{
        displayName: identity.displayName,
        subtitle: accountSubtitle(identity.accountRole, identity.username),
      }}
    />
  );
  if (params.picker === "grant") {
    return (
      <ProgramGrantTaskPage
        context={initialContext}
        requestHeaders={requestHeaders}
        navigation={navigation}
      />
    );
  }

  return (
    <RootFrame navigation={navigation}>
      <main className="mx-auto w-full max-w-[56rem]">
        <DepartmentProgramLeaderWorkspace
          initialActorUserId={actor.userId}
          initialContext={initialContext}
          key={actor.userId}
        />
      </main>
      <RestoredPageRevalidator />
    </RootFrame>
  );
}
