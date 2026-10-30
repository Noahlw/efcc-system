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
import { programLeaderGlobalProgramsSchema } from "@/features/roles/program-leader-contract";
import { programLeaderAuthorityKindSchema } from "@/features/roles/program-leader-grant-batch-contract";
import type { ProgramLeaderAuthorityKind } from "@/features/roles/program-leader-grant-batch-contract";
import {
  getProgramLeaderDepartments,
  getProgramLeaderRoster,
  getProgramLeaderPrograms,
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
  actorUserId,
  actorName,
  actorUsername,
  authorityKind,
  context,
  requestHeaders,
  navigation,
}: {
  actorUserId: string;
  actorName?: string;
  actorUsername?: string | null;
  authorityKind: ProgramLeaderAuthorityKind;
  context: ProgramLeaderWorkspaceContext;
  requestHeaders: Headers;
  navigation: ReactNode;
}) => {
  const workspaceHref =
    authorityKind === "department_manager"
      ? "/roles/program-leaders"
      : `/roles/program-leaders?authority=${authorityKind}`;
  if (!context.program) {
    return (
      <>
        <ProgramLeaderCandidatePicker
          actor={actorUserId}
          actorName={actorName}
          actorUsername={actorUsername}
          authorityKind={authorityKind}
          authorityAssignmentId={null}
          departmentId={null}
          programId={null}
          initialQuery=""
          navigation={navigation}
          returnHref={workspaceHref}
        />
        <RestoredPageRevalidator />
      </>
    );
  }
  try {
    const baseline = await getProgramLeaderRoster(
      requestHeaders,
      context.program,
      "1",
      authorityKind
    );
    if (
      context.department &&
      context.department !== baseline.program.departmentId
    ) {
      redirect(workspaceHref);
    }
    const returnHref = programLeaderWorkspaceHref({
      ...context,
      department: baseline.program.departmentId,
    });
    return (
      <>
        <ProgramLeaderCandidatePicker
          actor={baseline.actorUserId}
          actorName={actorName}
          actorUsername={actorUsername}
          authorityKind={baseline.authorityKind}
          authorityAssignmentId={baseline.authorityAssignmentId}
          departmentId={baseline.program.departmentId}
          key={`${baseline.actorUserId}:${baseline.authorityKind}:${baseline.authorityAssignmentId}:${baseline.program.id}`}
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
      redirect(workspaceHref);
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
  const requestedAuthority = programLeaderAuthorityKindSchema.safeParse(
    params.authority ?? "department_manager"
  );
  if (!requestedAuthority.success) {
    redirect("/");
  }
  const authorityKind = requestedAuthority.data;
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

  let authorityAssignmentId: string | null = null;
  try {
    if (authorityKind === "department_manager") {
      await getProgramLeaderDepartments(requestHeaders, "1");
    } else {
      ({ authorityAssignmentId } = programLeaderGlobalProgramsSchema.parse(
        await getProgramLeaderPrograms(
          requestHeaders,
          "1",
          undefined,
          false,
          authorityKind
        )
      ));
    }
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
      canManageProgramLeaders={authorityKind === "department_manager"}
      canManageAccounts={authorityKind === "admin"}
      manageHref={
        authorityKind === "department_manager"
          ? "/roles/program-leaders"
          : "/roles/people"
      }
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
        actorUserId={actor.userId}
        actorName={identity.displayName}
        actorUsername={identity.username}
        authorityKind={authorityKind}
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
          initialAuthorityAssignmentId={authorityAssignmentId}
          initialContext={initialContext}
          key={`${actor.userId}:${authorityKind}:${authorityAssignmentId ?? ""}`}
        />
      </main>
      <RestoredPageRevalidator />
    </RootFrame>
  );
}
