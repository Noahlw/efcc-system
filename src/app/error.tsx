"use client";

import { PageFrame } from "@/components/page-frame";

import { Button } from "../components/ui/button";

interface AppErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/** Never expose the internal exception or partially rendered private data. */
export default function AppError({ reset }: AppErrorProps) {
  return (
    <PageFrame variant="task">
      <main className="flex flex-col">
        <h1 className="text-task font-semibold">暫時未能載入資料</h1>
        <p className="text-muted-foreground mt-3" role="alert">
          系統暫時無法完成請求，資料未能載入。請稍後重試。
        </p>
        <Button className="mt-6 w-full sm:w-auto" type="button" onClick={reset}>
          重試
        </Button>
      </main>
    </PageFrame>
  );
}
