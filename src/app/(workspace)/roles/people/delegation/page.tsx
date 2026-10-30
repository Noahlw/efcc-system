import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { PrimaryNavigation } from "@/components/primary-navigation";
import { BusinessApiError } from "@/features/account/business-request";
import { RestoredPageRevalidator } from "@/features/auth/restored-page-revalidator";
import { getPersonIdentity } from "@/features/identity/queries";
import {
  getGlobalRolePerson,
  requireGlobalRoleAdmin,
} from "@/features/roles/global-roles";
import type {
  GlobalRoleAdminActor,
  GlobalRolePerson,
} from "@/features/roles/global-roles";
import { RoleAssignerTask } from "@/features/roles/ui/role-assigner-task";
import { getDb } from "@/server/db/client";
import { rolePeopleReturnHref } from "@/shared/protected-pages";

export const dynamic = "force-dynamic";

export default async function DelegationTaskPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const targetUserId = params.person;
  if (
    typeof targetUserId !== "string" ||
    !targetUserId ||
    targetUserId.length > 128
  ) {
    redirect("/roles/people");
  }
  const requestHeaders = await headers();
  let actor: GlobalRoleAdminActor;
  let person: GlobalRolePerson | null;
  try {
    actor = await requireGlobalRoleAdmin(requestHeaders);
    const current = await getGlobalRolePerson(requestHeaders, targetUserId);
    person = current?.role === "staff" ? current : null;
  } catch (error) {
    if (error instanceof BusinessApiError && error.status === 401) {
      redirect("/sign-in");
    }
    if (error instanceof BusinessApiError && error.status === 403) {
      redirect("/");
    }
    throw error;
  }
  const identity = await getPersonIdentity(getDb(), actor.userId).catch(
    () => null
  );
  const returnHref =
    rolePeopleReturnHref(params.returnTo) ??
    `/roles/people?person=${encodeURIComponent(targetUserId)}`;
  return (
    <>
      <RoleAssignerTask
        key={`${actor.userId}:${targetUserId}`}
        actorUserId={actor.userId}
        actorName={identity?.displayName}
        actorUsername={identity?.username}
        initialPerson={person}
        targetUserId={targetUserId}
        returnHref={returnHref}
        navigation={
          <PrimaryNavigation
            accessAllowed
            canManageAccounts
            currentPath="/roles/people"
            manageHref="/roles/people"
          />
        }
      />
      <RestoredPageRevalidator />
    </>
  );
}
