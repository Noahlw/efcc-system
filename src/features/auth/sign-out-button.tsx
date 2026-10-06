"use client";

import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useState } from "react";

import { PageFrame } from "@/components/page-frame";
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
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

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
    <>
      <Button
        variant="secondary"
        type="button"
        className="w-full sm:w-auto"
        disabled={!ready || state === "pending"}
        aria-busy={state === "pending"}
        onClick={signOut}
      >
        {state === "pending" ? "登出中…" : "登出"}
      </Button>
      <Dialog.Root
        open={state !== "idle"}
        onOpenChange={(open) => {
          if (!open && state === "unconfirmed") {
            window.location.reload();
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Viewport className="bg-background fixed inset-0 z-[100] overflow-y-auto">
            <Dialog.Popup className="outline-none">
              <PageFrame variant="auth">
                <div className="my-auto flex flex-col gap-5">
                  <Dialog.Title className="text-root font-semibold">
                    {state === "pending" ? "正在登出" : "未能確認登出"}
                  </Dialog.Title>
                  <Dialog.Description
                    className="text-muted-foreground"
                    role={state === "unconfirmed" ? "alert" : "status"}
                  >
                    {state === "pending"
                      ? "正在向伺服器確認登出，請稍候。"
                      : "未能確認登出結果，你仍然可能已登入。"}
                  </Dialog.Description>
                  <Button
                    type="button"
                    disabled={state === "pending"}
                    onClick={signOut}
                  >
                    {state === "pending" ? "登出中…" : "重新確認登出"}
                  </Button>
                  {state === "unconfirmed" ? (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => window.location.reload()}
                    >
                      返回並重新檢查登入狀態
                    </Button>
                  ) : null}
                </div>
              </PageFrame>
            </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
};
