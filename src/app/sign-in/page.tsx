import type { Metadata } from "next";

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
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-12">
      <h1 className="text-2xl font-semibold">登入</h1>
      <p className="text-muted-foreground mt-2">
        請使用你的使用者名稱或中文全名登入，查看你的個人資料。
      </p>
      {reason === "authentication-required" ? (
        <p
          className="border-input-border bg-muted mt-4 rounded-md border p-3"
          role="status"
        >
          未能確認登入狀態，請重新登入後繼續。
        </p>
      ) : null}
      <SignInForm />
    </main>
  );
}
