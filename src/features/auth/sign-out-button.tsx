"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

type SignOutState = "idle" | "pending" | "unconfirmed";

/** Never leave the old private document visible while leaving the page. */
const goToSignIn = () => {
  document.documentElement.style.visibility = "hidden";
  window.location.replace("/sign-in");
};

/**
 * Confirmed sign-out. The browser only reports success after the native
 * endpoint confirms it; a missing or lost response stays unconfirmed. The
 * retry settles the truth authoritatively: if the session is already gone,
 * that is reported as signed out rather than as an unknown state.
 */
export const SignOutButton = () => {
  const [state, setState] = useState<SignOutState>("idle");

  const signOut = async () => {
    setState("pending");
    let response: Response | null = null;
    try {
      response = await fetch("/api/auth/sign-out", {
        body: JSON.stringify({}),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
    } catch {
      response = null;
    }

    if (response?.ok) {
      goToSignIn();
      return;
    }

    // Unknown outcome: ask the server whether the session still exists.
    try {
      const session = await fetch("/api/auth/get-session", {
        headers: { accept: "application/json" },
      });
      if (session.ok && (await session.json()) === null) {
        goToSignIn();
        return;
      }
    } catch {
      // Fall through to the unconfirmed state below.
    }

    setState("unconfirmed");
  };

  return (
    <div className="flex flex-col gap-3">
      <Button
        variant="secondary"
        type="button"
        className="w-full sm:w-auto"
        disabled={state === "pending"}
        aria-busy={state === "pending"}
        onClick={signOut}
      >
        {state === "pending" ? "登出中…" : "登出"}
      </Button>
      {state === "unconfirmed" ? (
        <div
          className="border-input-border bg-muted rounded-md border p-4 text-sm"
          role="alert"
        >
          <p>未能確認登出結果，你仍然可能已登入。</p>
          <Button
            variant="secondary"
            type="button"
            className="mt-3 w-full sm:w-auto"
            onClick={signOut}
          >
            重新確認登出
          </Button>
        </div>
      ) : null}
    </div>
  );
};
