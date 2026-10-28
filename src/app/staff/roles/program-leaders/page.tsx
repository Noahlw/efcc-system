import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { BusinessApiError } from "@/features/account/business-request";
import { requireRolePeopleReadAuthority } from "@/features/roles/role-people";
import {
  programLeaderWorkspaceContext,
  programLeaderWorkspaceHref,
  rolePeopleReturnHref,
} from "@/shared/protected-pages";

export const dynamic = "force-dynamic";

export default async function ProgramLeadersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  try {
    await requireRolePeopleReadAuthority(await headers());
  } catch (error) {
    if (error instanceof BusinessApiError && error.status === 401) {
      redirect("/sign-in");
    }
    if (error instanceof BusinessApiError && error.status === 403) {
      // The local owner independently checks actual current DM authority;
      // Staff identity alone neither grants nor limits this route.
      redirect(
        programLeaderWorkspaceHref(programLeaderWorkspaceContext(params))
      );
    }
    throw error;
  }
  redirect(rolePeopleReturnHref(params.returnTo) ?? "/roles/people");
}
