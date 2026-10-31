import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { RootFrame, TaskHeader } from "@/components/page-frame";
import { PrimaryNavigation } from "@/components/primary-navigation";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { BusinessApiError } from "@/features/account/business-request";
import { RestoredPageRevalidator } from "@/features/auth/restored-page-revalidator";
import { getPersonIdentity } from "@/features/identity/queries";
import { requireRolePeopleReadAuthority } from "@/features/roles/role-people";
import { RolePersonWorkspace } from "@/features/roles/ui/role-person-workspace";
import { getDb } from "@/server/db/client";

export const dynamic = "force-dynamic";

export default async function RolePeoplePage() {
  const requestHeaders = await headers();
  let authority: Awaited<ReturnType<typeof requireRolePeopleReadAuthority>>;
  try {
    authority = await requireRolePeopleReadAuthority(requestHeaders);
  } catch (error) {
    if (error instanceof BusinessApiError && error.status === 401) {
      redirect("/sign-in");
    }
    if (error instanceof BusinessApiError && error.status === 403) {
      redirect("/");
    }
    throw error;
  }

  const identity = await getPersonIdentity(
    getDb(),
    authority.actor.userId
  ).catch(() => null);
  if (!identity) {
    redirect("/status");
  }

  const isAdmin = authority.actorKind === "admin";
  return (
    <RootFrame
      navigation={
        <PrimaryNavigation
          accessAllowed
          canManageAccounts={isAdmin}
          currentPath="/roles/people"
          manageHref="/roles/people"
          signedInAs={{
            displayName: identity.displayName,
            subtitle: isAdmin ? "管理員 · 個人帳戶" : "職員 · Role Assigner",
          }}
        />
      }
    >
      <main className="mx-auto w-full max-w-[72rem]">
        <TaskHeader
          singleRow
          returnControl={
            <Link
              aria-label="返回管理"
              className="text-primary inline-flex size-11 shrink-0 items-center justify-center rounded-lg focus-visible:outline-2"
              href="/staff/accounts"
              prefetch={false}
            >
              <Icon className="size-5" name="arrow-left" />
            </Link>
          }
          title="人員權責"
        />
        <p className="text-body text-muted-foreground -mt-2 mb-6">
          先搜尋一位人士，查閱其部門及聚會職務。
        </p>
        <div className="mb-6">
          <Button
            nativeButton={false}
            render={
              <Link
                href={`/roles/program-leaders?authority=${authority.actorKind}`}
                prefetch={false}
              />
            }
            variant="secondary"
          >
            按聚會指派負責人
          </Button>
        </div>
        <RolePersonWorkspace
          initialActorKind={authority.actorKind}
          initialAuthorityAssignmentId={authority.authorityAssignmentId}
          initialActorUserId={authority.actor.userId}
          key={`${authority.actor.userId}:${authority.actorKind}:${authority.authorityAssignmentId ?? ""}`}
        />
      </main>
      <RestoredPageRevalidator />
    </RootFrame>
  );
}
