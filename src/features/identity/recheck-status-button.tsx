"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";

/**
 * Recheck performs a new authoritative server request: the refresh re-enters
 * the worker, revalidates the session and reads current D1 state. There is no
 * polling and no cached authorisation.
 */
export const RecheckStatusButton = () => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="secondary"
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => router.refresh())}
    >
      {pending ? "檢查中…" : "重新檢查狀態"}
    </Button>
  );
};
