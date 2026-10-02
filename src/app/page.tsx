import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { SignOutButton } from "@/features/auth/sign-out-button";
import { membershipStatusLabel } from "@/features/identity/labels";
import { getPersonIdentity } from "@/features/identity/queries";
import { getDb } from "@/server/db/client";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const requestHeaders = await headers();
  const userId = requestHeaders.get("x-efcc-user-id");
  const access = requestHeaders.get("x-efcc-access");

  if (!userId) {
    redirect("/sign-in");
  }
  if (access !== "full") {
    redirect("/status");
  }

  const identity = await getPersonIdentity(getDb(), userId);
  if (!identity) {
    redirect("/status");
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-5 py-10">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">我的主頁</h1>
          <p className="text-muted-foreground mt-1">
            歡迎回來，{identity.displayName}。
          </p>
        </div>
        <SignOutButton />
      </header>

      <section className="border-border bg-surface mt-8 rounded-lg border p-5">
        <h2 className="text-lg font-medium">我的資料</h2>
        <dl className="mt-4 grid gap-3 text-base">
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-muted-foreground">中文姓名</dt>
            <dd className="font-medium">{identity.displayName}</dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-muted-foreground">使用者名稱</dt>
            <dd className="font-medium">{identity.username ?? "—"}</dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-muted-foreground">會籍狀態</dt>
            <dd className="font-medium">
              {membershipStatusLabel(identity.membershipStatus)}
            </dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
