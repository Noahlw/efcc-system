import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { RootFrame, TaskHeader } from "@/components/page-frame";
import { PrimaryNavigation } from "@/components/primary-navigation";
import { requireStaff } from "@/features/account/account-actors";
import { RestoredPageRevalidator } from "@/features/auth/restored-page-revalidator";
import { getPersonIdentity } from "@/features/identity/queries";
import { DepartmentManagerClient } from "@/features/roles/ui/department-manager-client";
import { getDb } from "@/server/db/client";
import { roleAssignerAssignment } from "@/server/db/schema/roles";

export const dynamic = "force-dynamic";

export default async function DepartmentManagersPage() {
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
          returnControl={
            <Link
              className="text-primary inline-flex min-h-11 items-center focus-visible:outline-2"
              href="/staff/accounts"
              prefetch={false}
            >
              返回管理
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
