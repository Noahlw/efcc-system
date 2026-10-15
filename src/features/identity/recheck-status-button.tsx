"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

/**
 * Recheck performs a new authoritative server request: the refresh re-enters
 * the worker, revalidates the session and reads current D1 state. There is no
 * polling and no cached authorisation.
 */
export const RecheckStatusButton = () => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);

  return (
    <Button
      variant={pending ? "primary" : "secondary"}
      type="button"
      disabled={!hydrated || pending}
      onClick={() => startTransition(() => router.refresh())}
    >
      {pending ? "正在重新檢查…" : "重新檢查狀態"}
    </Button>
  );
};
