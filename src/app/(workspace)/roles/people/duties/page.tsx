import { headers } from "next/headers";
import { redirect } from "next/navigation";
import * as z from "zod";

import { PrimaryNavigation } from "@/components/primary-navigation";
import { BusinessApiError } from "@/features/account/business-request";
import { RestoredPageRevalidator } from "@/features/auth/restored-page-revalidator";
import {
  getRolePersonDetail,
  requireRolePeopleReadAuthority,
} from "@/features/roles/role-people";
import type { RolePeopleReadAuthority } from "@/features/roles/role-people";
import type { RolePersonDetail } from "@/features/roles/ui/role-person-api";
import { ScopedRoleTask } from "@/features/roles/ui/scoped-role-task";
import { rolePeopleReturnHref } from "@/shared/protected-pages";

export const dynamic = "force-dynamic";

export default async function DutiesTaskPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const target = z.string().trim().min(1).max(128).safeParse(params.person);
  const restriction = z
    .object({
      departmentId: z.string().trim().min(1).max(128),
      programId: z.string().trim().min(1).max(128),
    })
    .safeParse({ departmentId: params.department, programId: params.program });
  const programRestriction = restriction.success ? restriction.data : null;
  if (
    (params.department !== undefined || params.program !== undefined) &&
    !restriction.success
  ) {
    redirect("/roles/people");
  }
  const requestHeaders = await headers();
  let authority: RolePeopleReadAuthority;
  let person: RolePersonDetail | null;
  try {
    authority = await requireRolePeopleReadAuthority(requestHeaders);
    person = target.success
      ? await getRolePersonDetail(
          requestHeaders,
          target.data,
          "1",
          undefined,
          "1"
        )
      : null;
  } catch (error) {
    if (error instanceof BusinessApiError && error.status === 401) {
      redirect("/sign-in");
    }
    if (error instanceof BusinessApiError && error.status === 403) {
      redirect("/");
    }
    throw error;
  }
  if (!target.success) {
    redirect("/roles/people");
  }
  const returnHref =
    rolePeopleReturnHref(params.returnTo) ??
    `/roles/people?person=${encodeURIComponent(target.data)}`;
  return (
    <>
      <ScopedRoleTask
        key={`${authority.actor.userId}:${target.data}:${authority.authorityAssignmentId ?? "admin"}:${programRestriction?.departmentId ?? ""}:${programRestriction?.programId ?? ""}`}
        actorUserId={authority.actor.userId}
        actorKind={authority.actorKind}
        authorityAssignmentId={authority.authorityAssignmentId}
        initialPerson={
          person?.capabilities.canManageDuties ? person.identity : null
        }
        targetUserId={target.data}
        programRestriction={programRestriction}
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
