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
  let actor: GlobalRoleAdminActor;
  let person: GlobalRolePerson | null;
  try {
    actor = await requireGlobalRoleAdmin(requestHeaders);
    person =
      typeof params.person === "string"
        ? await getGlobalRolePerson(requestHeaders, params.person)
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
  if (!person) {
    redirect("/roles/people");
  }
  const returnHref =
    rolePeopleReturnHref(params.returnTo) ??
    `/roles/people?person=${encodeURIComponent(person.userId)}`;
  return (
    <>
      <AccountIdentityTask
        key={`${actor.userId}:${person.userId}`}
        actorUserId={actor.userId}
        initialPerson={person}
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
