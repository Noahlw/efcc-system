import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { RootFrame, TaskHeader } from "@/components/page-frame";
import { PrimaryNavigation } from "@/components/primary-navigation";
import { Icon } from "@/components/ui/icon";
import { requireStaff } from "@/features/account/account-actors";
import { RestoredPageRevalidator } from "@/features/auth/restored-page-revalidator";
import { getPersonIdentity } from "@/features/identity/queries";
import { DepartmentManagerClient } from "@/features/roles/ui/department-manager-client";
import { getDb } from "@/server/db/client";
import { roleAssignerAssignment } from "@/server/db/schema/roles";
import { rolePeopleReturnHref } from "@/shared/protected-pages";

export const dynamic = "force-dynamic";

export default async function DepartmentManagersPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const params = await searchParams;
  const returnHref = rolePeopleReturnHref(params.returnTo);
  const requestHeaders = await headers();
  const actorUserId = requestHeaders.get("x-efcc-user-id");
  if (!actorUserId) {
    redirect("/sign-in");
  }
  const actor = await requireStaff(requestHeaders).catch(() => null);
  if (!actor || actor.userId !== actorUserId) {
    redirect("/staff/accounts");
  }

  const identity = await getPersonIdentity(getDb(), actorUserId).catch(
    () => null
  );
  const roleAssigner =
    actor.role === "staff"
      ? await getDb()
          .select({ id: roleAssignerAssignment.id })
          .from(roleAssignerAssignment)
          .where(eq(roleAssignerAssignment.userId, actorUserId))
          .limit(1)
          .get()
      : null;
  if (
    !identity ||
    identity.accountRole !== actor.role ||
    (actor.role === "staff" && !roleAssigner)
  ) {
    redirect("/staff/accounts");
  }

  return (
    <RootFrame
      navigation={
        <PrimaryNavigation
          accessAllowed
          canManageAccounts
          currentPath="/staff/roles/department-managers"
          signedInAs={{
            displayName: identity.displayName,
            subtitle:
              actor.role === "admin"
                ? "管理員 · 個人帳戶"
                : "職員 · Role Assigner",
          }}
        />
      }
    >
      <main className="mx-auto w-full max-w-[56rem]">
        <TaskHeader
          singleRow
          returnControl={
            <Link
              aria-label={returnHref ? "返回人員權責" : "返回管理"}
              className="text-primary inline-flex size-11 shrink-0 items-center justify-center rounded-lg focus-visible:outline-2"
              href={returnHref ?? "/staff/accounts"}
              prefetch={false}
            >
              <Icon className="size-5" name="arrow-left" />
            </Link>
          }
          title="部門主管管理"
        />
        <p className="text-body text-muted-foreground -mt-2 mb-6">
          先搜尋一位人士，查閱現有職務，再選擇部門及操作。
        </p>
        <DepartmentManagerClient
          initialActorUserId={actorUserId}
          key={actorUserId}
        />
      </main>
      <RestoredPageRevalidator />
    </RootFrame>
  );
}
