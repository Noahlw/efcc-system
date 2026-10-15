"use client";

import { Dialog } from "@base-ui/react/dialog";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { ChurchBrand, PageFrame } from "@/components/page-frame";
import { Button } from "@/components/ui/button";

import { createNativeAuthClient } from "./client";

type SignOutState = "idle" | "pending" | "unconfirmed";

/**
 * Confirmed sign-out. The browser only reports success after the native
 * endpoint confirms it; a missing or lost response stays unconfirmed. The
 * retry settles the truth authoritatively: if the session is already gone,
 * that is reported as signed out rather than as an unknown state.
 */
export const SignOutButton = ({
  variant = "secondary",
}: {
  variant?: "secondary" | "quiet";
}) => {
  const queryClient = useQueryClient();
  const [authClient] = useState(createNativeAuthClient);
  const [state, setState] = useState<SignOutState>("idle");
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  const goToSignIn = () => {
    queryClient.clear();
    document.documentElement.style.visibility = "hidden";
    window.location.replace("/sign-in");
  };

  const signOut = async () => {
    setState("pending");
    let confirmed = false;
    try {
      const result = await authClient.signOut({});
      confirmed = !result.error;
    } catch {
      // Transport failure cannot establish whether the write committed.
    }

    if (confirmed) {
      goToSignIn();
      return;
    }

    // Unknown outcome: ask the server whether the session still exists.
    try {
      const signedOut = await queryClient.query({
        queryFn: async ({ signal }) => {
          const session = await fetch("/api/auth/get-session", {
            cache: "no-store",
            credentials: "same-origin",
            headers: { accept: "application/json" },
            signal,
          });
          if (!session.ok) {
            throw new Error("Session status unavailable");
          }
          // Retain only the verdict, never session or account data.
          return (await session.json()) === null;
        },
        queryKey: ["auth", "signed-out"],
      });
      if (signedOut) {
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
        variant={variant}
        type="button"
        className={variant === "secondary" ? "w-full sm:w-auto" : "min-h-12"}
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
            <Dialog.Popup className="auth-layout flex min-h-dvh w-full flex-col justify-center outline-none lg:px-8 lg:py-12">
              <PageFrame variant="auth">
                <div className="my-auto flex flex-col">
                  <ChurchBrand />
                  <div className="flex flex-col gap-4">
                    <Dialog.Title className="text-root font-bold tracking-[-0.025em]">
                      {state === "pending" ? "正在登出" : "未能確認登出"}
                    </Dialog.Title>
                    <Dialog.Description
                      aria-busy={state === "pending" || undefined}
                      className="text-muted-foreground"
                      role={state === "unconfirmed" ? "alert" : "status"}
                    >
                      {state === "pending"
                        ? "正在結束這個登入，請稍候。"
                        : "目前不能確認登入是否已結束。請重試。"}
                    </Dialog.Description>
                    {state === "pending" ? (
                      <div aria-hidden="true" className="flex flex-col gap-3">
                        <div className="h-[1.125rem] rounded bg-[#edf1ee]" />
                        <div className="h-24 rounded bg-[#edf1ee]" />
                        <div className="h-[1.125rem] rounded bg-[#edf1ee]" />
                      </div>
                    ) : (
                      <div className="flex flex-col gap-3">
                        <Button type="button" onClick={signOut}>
                          重試登出
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => window.location.reload()}
                        >
                          返回並重新檢查登入狀態
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </PageFrame>
            </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
};
