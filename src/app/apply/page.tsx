import type { Metadata } from "next";

import { ApplicationForm } from "@/features/account/application-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "申請加入 · 顯恩堂系統",
};

export default function ApplyPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-12">
      <h1 className="text-2xl font-semibold">申請加入顯恩堂系統</h1>
      <ApplicationForm />
    </main>
  );
}
