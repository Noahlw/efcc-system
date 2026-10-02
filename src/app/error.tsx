"use client";

import { Button } from "../components/ui/button";

interface AppErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/** Never expose the internal exception or partially rendered private data. */
export default function AppError({ reset }: AppErrorProps) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-12">
      <h1 className="text-2xl font-semibold">暫時未能載入資料</h1>
      <p className="text-muted-foreground mt-3" role="alert">
        系統暫時無法完成請求，資料未能載入。請稍後重試。
      </p>
      <Button className="mt-6" type="button" onClick={reset}>
        重試
      </Button>
    </main>
  );
}
