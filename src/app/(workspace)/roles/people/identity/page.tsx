import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { PrimaryNavigation } from "@/components/primary-navigation";
import { BusinessApiError } from "@/features/account/business-request";
import { RestoredPageRevalidator } from "@/features/auth/restored-page-revalidator";
import {
  getGlobalRolePerson,
  requireGlobalRoleAdmin,
} from "@/features/roles/global-roles";
import type {
  GlobalRoleAdminActor,
  GlobalRolePerson,
} from "@/features/roles/global-roles";
import { AccountIdentityTask } from "@/features/roles/ui/account-identity-task";
import { rolePeopleReturnHref } from "@/shared/protected-pages";

export const dynamic = "force-dynamic";

export default async function IdentityTaskPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const requestHeaders = await headers();
  const targetUserId = typeof params.person === "string" ? params.person : null;
  if (!targetUserId) {
    redirect("/roles/people");
  }
  let actor: GlobalRoleAdminActor;
  let person: GlobalRolePerson | null;
  try {
    actor = await requireGlobalRoleAdmin(requestHeaders);
    person = await getGlobalRolePerson(requestHeaders, targetUserId);
  } catch (error) {
    if (error instanceof BusinessApiError && error.status === 401) {
      redirect("/sign-in");
    }
    if (error instanceof BusinessApiError && error.status === 403) {
      redirect("/");
    }
    throw error;
  }
  // A committed Admin grant leaves the editable-person projection. Keep the
  // actor-authorized task mount so its original opaque operation can settle;
  // a null person never supplies an editable baseline or protected labels.
  const returnHref =
    rolePeopleReturnHref(params.returnTo) ??
    `/roles/people?person=${encodeURIComponent(targetUserId)}`;
  return (
    <>
      <AccountIdentityTask
        key={`${actor.userId}:${targetUserId}`}
        actorUserId={actor.userId}
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
