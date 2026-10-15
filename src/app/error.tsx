"use client";

import { usePathname, useSearchParams } from "next/navigation";

import { ChurchBrand, PageFrame } from "@/components/page-frame";
import { SafeStateBody } from "@/components/unavailable-view";

import { Button } from "../components/ui/button";

interface AppErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/** Never expose the internal exception or partially rendered private data. */
export default function AppError(_props: AppErrorProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isAuthRoute =
    pathname === "/sign-in" ||
    pathname === "/apply" ||
    pathname === "/unavailable";

  return (
    <PageFrame variant={isAuthRoute ? "auth" : "task"}>
      {isAuthRoute ? <ChurchBrand /> : null}
      <SafeStateBody
        description="請重試；如持續出現問題，請聯絡同工。"
        title="這頁暫時未能開啟"
      >
        <form action={pathname} method="get">
          {[...searchParams.entries()].map(([name, value], index) => (
            <input
              key={`${name}-${index}`}
              name={name}
              type="hidden"
              value={value}
            />
          ))}
          <Button className="w-full sm:w-auto" type="submit">
            重試
          </Button>
        </form>
        <form action="/account" method="get">
          <Button
            className="w-full sm:w-auto"
            type="submit"
            variant="secondary"
          >
            返回帳戶
          </Button>
        </form>
      </SafeStateBody>
    </PageFrame>
  );
}
