import type { Metadata } from "next";

import { ChurchBrand } from "@/components/page-frame";
import { SignInForm } from "@/features/auth/sign-in-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "登入 · 顯恩堂系統",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string | string[] }>;
}) {
  const { reason } = await searchParams;
  return (
    <main className="my-auto flex flex-col">
      <ChurchBrand />
      <h1 className="text-root font-semibold">登入</h1>
      <p className="text-muted-foreground mt-2">回到你的教會生活。</p>
      {reason === "authentication-required" ? (
        <div
          className="border-border bg-muted mt-4 rounded-md border p-3"
          role="status"
        >
          <p className="font-semibold">請重新登入</p>
          <p className="mt-1">為保障你的帳戶，請重新登入後繼續。</p>
        </div>
      ) : null}
      <SignInForm />
    </main>
  );
}
