"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

/**
 * Confirmed sign-out: the browser only reports success after the native
 * endpoint confirms it. A lost response stays unconfirmed with a retry.
 */
export const SignOutButton = () => {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState(false);

  const signOut = async () => {
    setPending(true);
    setUnconfirmed(false);
    try {
      const response = await fetch("/api/auth/sign-out", {
        body: JSON.stringify({}),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        setUnconfirmed(true);
        return;
      }
      router.replace("/sign-in");
      router.refresh();
    } catch {
      setUnconfirmed(true);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <Button
        variant="secondary"
        type="button"
        disabled={pending}
        onClick={signOut}
      >
        {pending ? "登出中…" : "登出"}
      </Button>
      {unconfirmed ? (
        <div
          className="border-input-border bg-muted rounded-md border px-3 py-2 text-sm"
          role="alert"
        >
          <p>未能確認登出結果，你仍然可能已登入。</p>
          <Button
            variant="secondary"
            type="button"
            className="mt-2"
            disabled={pending}
            onClick={signOut}
          >
            重新確認登出
          </Button>
        </div>
      ) : null}
    </div>
  );
};
