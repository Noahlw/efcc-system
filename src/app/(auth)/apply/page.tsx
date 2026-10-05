import type { Metadata } from "next";

import { ApplicationForm } from "@/features/account/application-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "申請加入 · 顯恩堂系統",
};

export default function ApplyPage() {
  return (
    <main className="flex flex-col">
      <ApplicationForm />
    </main>
  );
}
