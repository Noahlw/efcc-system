import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { RootFrame, TaskHeader } from "@/components/page-frame";
import { PrimaryNavigation } from "@/components/primary-navigation";
import { Icon } from "@/components/ui/icon";
import { RestoredPageRevalidator } from "@/features/auth/restored-page-revalidator";
import { getPersonIdentity } from "@/features/identity/queries";
import { GlobalRoleClient } from "@/features/roles/ui/global-role-client";
import { getDb } from "@/server/db/client";
import { rolePeopleReturnHref } from "@/shared/protected-pages";

export const dynamic = "force-dynamic";

export default async function GlobalRolesPage({
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
          currentPath="/staff/roles/global-roles"
          signedInAs={{
            displayName: identity.displayName,
            subtitle: "管理員 · 個人帳戶",
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
          title="全域角色管理"
        />
        <p className="text-body text-muted-foreground -mt-2 mb-6">
          先搜尋一位人士，查閱現時全域身份及 Role Assigner 委派。
        </p>
        <GlobalRoleClient initialActorUserId={actorUserId} key={actorUserId} />
      </main>
      <RestoredPageRevalidator />
    </RootFrame>
  );
}
