import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { RootFrame } from "@/components/page-frame";
import { PrimaryNavigation } from "@/components/primary-navigation";
import { requireOwnBusinessAccess } from "@/features/account/account-actors";
import type { AccountActor } from "@/features/account/account-actors";
import { BusinessApiError } from "@/features/account/business-request";
import { RestoredPageRevalidator } from "@/features/auth/restored-page-revalidator";
import { getPersonIdentity } from "@/features/identity/queries";
import { getProgramLeaderDepartments } from "@/features/roles/program-leaders";
import { DepartmentProgramLeaderWorkspace } from "@/features/roles/ui/department-program-leader-workspace";
import { getDb } from "@/server/db/client";
import { programLeaderWorkspaceContext } from "@/shared/protected-pages";

export const dynamic = "force-dynamic";

const accountSubtitle = (role: string, username: string | null) => {
  if (role === "admin") {
    return "管理員 · 個人帳戶";
  }
  return role === "staff" ? "職員 · 個人帳戶" : (username ?? undefined);
};

export default async function DepartmentProgramLeadersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const initialContext = programLeaderWorkspaceContext(await searchParams);
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

  return (
    <RootFrame
      navigation={
        <PrimaryNavigation
          accessAllowed
          canManageProgramLeaders
          currentPath="/roles/program-leaders"
          signedInAs={{
            displayName: identity.displayName,
            subtitle: accountSubtitle(identity.accountRole, identity.username),
          }}
        />
      }
    >
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
