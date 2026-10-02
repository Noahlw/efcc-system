"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";

/** Generic, recoverable Home read failure; server details stay private. */
export const HomeUnavailable = () => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-12">
      <h1 className="text-2xl font-semibold">暫時未能載入主頁</h1>
      <p className="text-muted-foreground mt-3" role="alert">
        系統暫時無法載入你的資料，未有顯示部分內容。請稍後重試。
      </p>
      <Button
        className="mt-6"
        type="button"
        disabled={pending}
        onClick={() => startTransition(() => router.refresh())}
      >
        {pending ? "重新載入中…" : "重試"}
      </Button>
    </main>
  );
};
