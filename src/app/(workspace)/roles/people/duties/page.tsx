import { headers } from "next/headers";
import { redirect } from "next/navigation";
import * as z from "zod";

import { PrimaryNavigation } from "@/components/primary-navigation";
import { BusinessApiError } from "@/features/account/business-request";
import { RestoredPageRevalidator } from "@/features/auth/restored-page-revalidator";
import { getPersonIdentity } from "@/features/identity/queries";
import type {
  ProgramLeaderAssigneeBaseline,
  ProgramLeaderRoster,
} from "@/features/roles/program-leader-contract";
import {
  getProgramLeaderAssigneeBaseline,
  getProgramLeaderRoster,
} from "@/features/roles/program-leaders";
import {
  getRolePersonDetail,
  requireRolePeopleReadAuthority,
} from "@/features/roles/role-people";
import type { RolePeopleReadAuthority } from "@/features/roles/role-people";
import type { RolePersonDetail } from "@/features/roles/ui/role-person-api";
import { ScopedRoleTask } from "@/features/roles/ui/scoped-role-task";
import { getDb } from "@/server/db/client";
import {
  rolePeopleReturnHref,
  programLeaderReturnHref,
  programLeaderWorkspaceContext,
  programLeaderWorkspaceHref,
} from "@/shared/protected-pages";

export const dynamic = "force-dynamic";

const readActorLabels = async (userId: string) => {
  const identity = await getPersonIdentity(getDb(), userId).catch(() => null);
  return {
    actorName: identity?.displayName,
    actorUsername: identity?.username,
  };
};

const LocalProgramTask = async ({
  params,
  requestHeaders,
}: {
  params: Record<string, string | string[] | undefined>;
  requestHeaders: Headers;
}) => {
  const id = z.string().trim().min(1).max(128);
  const input = z
    .object({
      assignment: id,
      authority: id,
      department: id,
      person: id,
      program: id,
    })
    .safeParse(params);
  if (!input.success) {
    redirect("/roles/program-leaders");
  }
  const { data: target } = input;
  let roster: ProgramLeaderRoster;
  let person: ProgramLeaderAssigneeBaseline["person"] | null = null;
  try {
    // Recovery requires current Program authority, not continued assignment of
    // the target: the original withdrawal may already have committed.
    roster = await getProgramLeaderRoster(requestHeaders, target.program, "1");
    if (
      roster.authorityAssignmentId !== target.authority ||
      roster.program.departmentId !== target.department
    ) {
      redirect("/roles/program-leaders");
    }
    try {
      const current = await getProgramLeaderAssigneeBaseline(
        requestHeaders,
        target.program,
        target.person
      );
      if (
        current &&
        current.assignmentId === target.assignment &&
        current.authorityAssignmentId === target.authority
      ) {
        ({ person } = current);
      }
    } catch (error) {
      if (
        !(
          error instanceof BusinessApiError && [403, 404].includes(error.status)
        )
      ) {
        throw error;
      }
    }
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
  const fallback = programLeaderWorkspaceHref(
    programLeaderWorkspaceContext({
      department: target.department,
      program: target.program,
    })
  );
  const supplied = programLeaderReturnHref(params.returnTo);
  const context = supplied
    ? programLeaderWorkspaceContext(
        Object.fromEntries(
          new URL(supplied, "https://return.invalid").searchParams
        )
      )
    : null;
  const returnHref =
    context?.department === target.department &&
    context.program === target.program
      ? (supplied ?? fallback)
      : fallback;
  const actorLabels = await readActorLabels(roster.actorUserId);
  return (
    <>
      <ScopedRoleTask
        key={`${roster.actorUserId}:${target.person}:${target.authority}:${target.program}`}
        actorUserId={roster.actorUserId}
        {...actorLabels}
        actorKind="department_manager"
        authorityAssignmentId={target.authority}
        initialPerson={person}
        targetUserId={target.person}
        programRestriction={{
          departmentId: target.department,
          programId: target.program,
        }}
        returnHref={returnHref}
        navigation={
          <PrimaryNavigation
            accessAllowed
            canManageProgramLeaders
            currentPath="/roles/program-leaders"
          />
        }
      />
      <RestoredPageRevalidator />
    </>
  );
};

const readProgramRestriction = (
  params: Record<string, string | string[] | undefined>
) => {
  const restriction = z
    .object({
      departmentId: z.string().trim().min(1).max(128),
      programId: z.string().trim().min(1).max(128),
    })
    .safeParse({ departmentId: params.department, programId: params.program });
  if (
    (params.department !== undefined || params.program !== undefined) &&
    !restriction.success
  ) {
    redirect("/roles/people");
  }
  return restriction.success ? restriction.data : null;
};

const dutiesReturnHref = async (
  returnTo: string | string[] | undefined,
  targetUserId: string | null,
  restriction: ReturnType<typeof readProgramRestriction>,
  authority: RolePeopleReadAuthority,
  requestHeaders: Headers
) => {
  const personHref =
    rolePeopleReturnHref(returnTo) ??
    (targetUserId
      ? `/roles/people?person=${encodeURIComponent(targetUserId)}`
      : "/roles/people");
  const programHref = programLeaderReturnHref(returnTo);
  if (!targetUserId || !restriction || !programHref) {
    return personHref;
  }
  const context = programLeaderWorkspaceContext(
    Object.fromEntries(
      new URL(programHref, "https://return.invalid").searchParams
    )
  );
  if (
    context.authority !== authority.actorKind ||
    context.program !== restriction.programId ||
    context.department !== restriction.departmentId
  ) {
    return personHref;
  }
  const current = await getProgramLeaderRoster(
    requestHeaders,
    restriction.programId,
    "1",
    authority.actorKind
  );
  if (
    current.actorUserId !== authority.actor.userId ||
    current.authorityKind !== authority.actorKind ||
    current.authorityAssignmentId !== authority.authorityAssignmentId ||
    current.program.departmentId !== restriction.departmentId
  ) {
    return personHref;
  }
  return programHref;
};

export default async function DutiesTaskPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  if (params.origin === "program") {
    return (
      <LocalProgramTask params={params} requestHeaders={await headers()} />
    );
  }
  const target = z.string().trim().min(1).max(128).safeParse(params.person);
  const targetUserId = target.success ? target.data : null;
  const programRestriction = readProgramRestriction(params);
  const requestHeaders = await headers();
  let authority: RolePeopleReadAuthority;
  let person: RolePersonDetail | null;
  let returnHref: string;
  try {
    authority = await requireRolePeopleReadAuthority(requestHeaders);
    person = targetUserId
      ? await getRolePersonDetail(
          requestHeaders,
          targetUserId,
          "1",
          undefined,
          "1"
        )
      : null;
    returnHref = await dutiesReturnHref(
      params.returnTo,
      targetUserId,
      programRestriction,
      authority,
      requestHeaders
    );
  } catch (error) {
    if (error instanceof BusinessApiError && error.status === 401) {
      redirect("/sign-in");
    }
    if (error instanceof BusinessApiError && error.status === 403) {
      redirect("/");
    }
    throw error;
  }
  if (params.person !== undefined && !target.success) {
    redirect("/roles/people");
  }
  const actorLabels = await readActorLabels(authority.actor.userId);
  return (
    <>
      <ScopedRoleTask
        key={`${authority.actor.userId}:${targetUserId ?? "original"}:${authority.authorityAssignmentId ?? "admin"}:${programRestriction?.departmentId ?? ""}:${programRestriction?.programId ?? ""}`}
        actorUserId={authority.actor.userId}
        {...actorLabels}
        actorKind={authority.actorKind}
        authorityAssignmentId={authority.authorityAssignmentId}
        initialPerson={
          person?.capabilities.canManageDuties ? person.identity : null
        }
        targetUserId={targetUserId}
        programRestriction={targetUserId ? programRestriction : null}
        returnHref={returnHref}
        navigation={
          <PrimaryNavigation
            accessAllowed
            canManageAccounts={authority.actorKind === "admin"}
            currentPath="/roles/people"
            manageHref="/roles/people"
          />
        }
      />
      <RestoredPageRevalidator />
    </>
  );
}
