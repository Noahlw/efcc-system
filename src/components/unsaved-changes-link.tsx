"use client";

import { Dialog } from "@base-ui/react/dialog";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

export const UnsavedChangesLink = ({
  children,
  description,
  href,
  isDirty,
  onDiscard,
}: {
  children: React.ReactNode;
  description: string;
  href: string;
  isDirty: boolean;
  onDiscard: () => void;
}) => {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!isDirty) {
      return;
    }
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [isDirty]);

  const requestNavigation = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (
      !isDirty ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    setOpen(true);
  };

  const discardAndNavigate = () => {
    onDiscard();
    setOpen(false);
    router.push(href);
  };

  return (
    <>
      <Link
        className="text-primary inline-flex min-h-12 items-center underline underline-offset-4 focus-visible:outline-2"
        href={href}
        onClick={requestNavigation}
        prefetch={false}
      >
        {children}
      </Link>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40" />
          <Dialog.Viewport className="fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4">
            <Dialog.Popup className="border-border bg-surface w-full max-w-md rounded-lg border p-5 shadow-xl outline-none">
              <Dialog.Title className="text-task font-semibold">
                放棄未提交的更改？
              </Dialog.Title>
              <Dialog.Description className="text-muted-foreground mt-2">
                {description}
              </Dialog.Description>
              <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <Dialog.Close
                  render={<Button type="button" variant="secondary" />}
                >
                  繼續編輯
                </Dialog.Close>
                <Button type="button" onClick={discardAndNavigate}>
                  放棄變更
                </Button>
              </div>
            </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
};
