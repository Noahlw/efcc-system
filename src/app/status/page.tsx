import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { SignOutButton } from "@/features/auth/sign-out-button";

export const dynamic = "force-dynamic";

/**
 * Fail-closed surface for authenticated people without business access.
 * #11 replaces this with the full Pending/ban/deactivation presentation.
 */
export default async function StatusPage() {
  const requestHeaders = await headers();
  const userId = requestHeaders.get("x-efcc-user-id");
  if (!userId) {
    redirect("/sign-in");
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-12">
      <h1 className="text-2xl font-semibold">帳戶狀態</h1>
      <p className="text-muted-foreground mt-3">
        你的帳戶目前無法使用教會功能。如需要協助，請聯絡教會同工。
      </p>
      <div className="mt-8">
        <SignOutButton />
      </div>
    </main>
  );
}
