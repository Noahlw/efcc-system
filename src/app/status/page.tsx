import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SignOutButton } from "@/features/auth/sign-out-button";
import { getPersonIdentity } from "@/features/identity/queries";
import { RecheckStatusButton } from "@/features/identity/recheck-status-button";
import {
  restrictionCopy,
  restrictionOrder,
  restrictionReasons,
} from "@/features/identity/restrictions";
import { getDb } from "@/server/db/client";

export const dynamic = "force-dynamic";

export default async function StatusPage() {
  const requestHeaders = await headers();
  const userId = requestHeaders.get("x-efcc-user-id");
  if (!userId) {
    redirect("/sign-in");
  }

  const identity = await getPersonIdentity(getDb(), userId);
  const reasons = identity
    ? restrictionReasons(identity.membershipStatus, identity.banned)
    : (["profile_missing"] as const);
  const ordered = restrictionOrder.filter((reason) =>
    (reasons as readonly string[]).includes(reason)
  );

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-12">
      <h1 className="text-2xl font-semibold">帳戶狀態</h1>

      {ordered.length === 0 ? (
        <>
          <p className="text-muted-foreground mt-3">
            你的帳戶目前可使用教會功能。
          </p>
          <Link
            className="bg-primary text-primary-foreground mt-6 inline-flex min-h-11 items-center justify-center rounded-md px-4 text-base font-medium"
            href="/"
          >
            前往主頁
          </Link>
        </>
      ) : (
        <>
          <p className="text-muted-foreground mt-3">
            你的帳戶目前無法使用教會功能，原因如下。
          </p>
          <ul className="mt-6 flex flex-col gap-4">
            {ordered.map((reason) => (
              <li
                key={reason}
                className="border-border bg-surface rounded-lg border p-4"
              >
                <h2 className="text-lg font-medium">
                  {restrictionCopy[reason].title}
                </h2>
                <p className="text-muted-foreground mt-1">
                  {restrictionCopy[reason].explanation}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="mt-8 flex flex-col gap-3">
        <RecheckStatusButton />
        <SignOutButton />
      </div>
    </main>
  );
}
