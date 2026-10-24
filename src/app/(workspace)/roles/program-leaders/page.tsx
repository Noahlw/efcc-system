import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { RootFrame, TaskHeader } from "@/components/page-frame";
import { PrimaryNavigation } from "@/components/primary-navigation";
import { requireOwnBusinessAccess } from "@/features/account/account-actors";
import { BusinessApiError } from "@/features/account/business-request";
import { RestoredPageRevalidator } from "@/features/auth/restored-page-revalidator";
import { getPersonIdentity } from "@/features/identity/queries";
import { getProgramLeaderDepartments } from "@/features/roles/program-leaders";
import { DepartmentProgramLeaderWorkspace } from "@/features/roles/ui/department-program-leader-workspace";
import { getDb } from "@/server/db/client";

export const dynamic = "force-dynamic";

export default async function DepartmentProgramLeadersPage() {
  const requestHeaders = await headers();
  let actor: Awaited<ReturnType<typeof requireOwnBusinessAccess>>;
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
            subtitle:
              identity.accountRole === "member"
                ? (identity.username ?? undefined)
                : "職員 · 個人帳戶",
          }}
        />
      }
    >
      <main className="mx-auto w-full max-w-[56rem]">
        <TaskHeader
          returnControl={
            <Link
              className="text-primary inline-flex min-h-11 items-center focus-visible:outline-2"
              href="/"
              prefetch={false}
            >
              返回主頁
            </Link>
          }
          title="Program Leader 管理"
        />
        <p className="text-body text-muted-foreground -mt-2 mb-6">
          先選擇負責部門及聚會，查閱現任職務，再搜尋同部門 Member。
        </p>
        <DepartmentProgramLeaderWorkspace
          initialActorUserId={actor.userId}
          key={actor.userId}
        />
      </main>
      <RestoredPageRevalidator />
    </RootFrame>
  );
}
