import { Button } from "@/components/ui/button";

interface UnavailableViewProps {
  retryHref: "/" | "/status";
  title?: string;
}

/** A safe read failure; native form navigation rechecks current server access. */
export const UnavailableView = ({
  retryHref,
  title = "暫時未能載入資料",
}: UnavailableViewProps) => (
  <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-12">
    <h1 className="text-2xl font-semibold">{title}</h1>
    <p className="text-muted-foreground mt-3" role="alert">
      系統暫時無法載入資料，未有顯示部分內容。請稍後重試。
    </p>
    <form action={retryHref} method="get" className="mt-6">
      <Button type="submit">重試</Button>
    </form>
  </main>
);
