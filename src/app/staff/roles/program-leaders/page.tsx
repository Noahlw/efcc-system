import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { RootFrame, TaskHeader } from "@/components/page-frame";
import { PrimaryNavigation } from "@/components/primary-navigation";
import { RestoredPageRevalidator } from "@/features/auth/restored-page-revalidator";
import { getPersonIdentity } from "@/features/identity/queries";
import { ProgramLeaderClient } from "@/features/roles/ui/program-leader-client";
import { getDb } from "@/server/db/client";

export const dynamic = "force-dynamic";

export default async function ProgramLeadersPage() {
  const requestHeaders = await headers();
  const actorUserId = requestHeaders.get("x-efcc-user-id");
  if (!actorUserId) {
    redirect("/sign-in");
  }

  const identity = await getPersonIdentity(getDb(), actorUserId).catch(
    () => null
  );
  if (!identity || identity.accountRole !== "admin") {
    redirect("/staff/accounts");
  }

  return (
    <RootFrame
      navigation={
        <PrimaryNavigation
          accessAllowed
          canManageAccounts
          currentPath="/staff/roles/program-leaders"
          signedInAs={{
            displayName: identity.displayName,
            subtitle: "管理員 · 個人帳戶",
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
          title="Program Leader 管理"
        />
        <p className="text-body text-muted-foreground -mt-2 mb-6">
          先搜尋一位人士，查閱現有職務，再選擇聚會及操作。
        </p>
        <ProgramLeaderClient
          initialActorUserId={actorUserId}
          key={actorUserId}
        />
      </main>
      <RestoredPageRevalidator />
    </RootFrame>
  );
}
