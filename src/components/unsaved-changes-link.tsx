"use client";

import { Dialog } from "@base-ui/react/dialog";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import type { ButtonVariant } from "@/components/ui/button";

export const UnsavedChangesConfirmation = ({
  description,
  onDiscard,
  onOpenChange,
  open,
}: {
  description: string;
  onDiscard: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) => (
  <Dialog.Root onOpenChange={onOpenChange} open={open}>
    <Dialog.Portal>
      <Dialog.Backdrop className="fixed inset-0 z-50 bg-[#13302c59]" />
      <Dialog.Viewport className="fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4">
        <Dialog.Popup className="border-border bg-surface max-h-[calc(100dvh-2rem)] w-full max-w-[28rem] overflow-y-auto rounded-2xl border p-6 shadow-xl outline-none">
          <Dialog.Title className="text-task font-[650] tracking-[-0.015em]">
            放棄未提交的更改？
          </Dialog.Title>
          <Dialog.Description className="text-label text-muted-foreground mt-2">
            {description}
          </Dialog.Description>
          <div className="mt-6 flex flex-col gap-3">
            <Dialog.Close render={<Button type="button" variant="primary" />}>
              繼續編輯
            </Dialog.Close>
            <Button type="button" variant="secondary" onClick={onDiscard}>
              放棄變更
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Viewport>
    </Dialog.Portal>
  </Dialog.Root>
);

export interface TaskDepartureConfig {
  description: string;
  isDirty: boolean;
  onDiscard: (() => boolean) | (() => void);
}

interface Departure {
  href: string;
  fullPageNavigation: boolean;
}
const TaskDepartureContext = createContext<{
  request: (
    event: React.MouseEvent<HTMLAnchorElement>,
    departure: Departure
  ) => void;
} | null>(null);

export const TaskDepartureProvider = ({
  children,
  config,
}: {
  children: React.ReactNode;
  config: TaskDepartureConfig | null;
}) => {
  const router = useRouter();
  const [pending, setPending] = useState<Departure | null>(null);
  const approved = useRef(false);

  useLayoutEffect(() => {
    if (!config?.isDirty) {
      setPending(null);
      return;
    }
    const warn = (event: BeforeUnloadEvent) => {
      if (!approved.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [config?.isDirty]);

  const request = (
    event: React.MouseEvent<HTMLAnchorElement>,
    departure: Departure
  ) => {
    const anchor = event.currentTarget;
    if (
      !config?.isDirty ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      (anchor.target && anchor.target !== "_self") ||
      anchor.hasAttribute("download") ||
      anchor.origin !== window.location.origin
    ) {
      return;
    }
    event.preventDefault();
    setPending(departure);
  };

  const discard = () => {
    if (!pending || config?.onDiscard() === false) {
      return;
    }
    approved.current = true;
    setPending(null);
    if (pending.fullPageNavigation) {
      window.location.assign(pending.href);
    } else {
      router.push(pending.href);
    }
  };

  return (
    <TaskDepartureContext.Provider value={{ request }}>
      {children}
      <UnsavedChangesConfirmation
        description={config?.description ?? ""}
        onDiscard={discard}
        onOpenChange={(open) => {
          if (!open) {
            setPending(null);
          }
        }}
        open={pending !== null && Boolean(config?.isDirty)}
      />
    </TaskDepartureContext.Provider>
  );
};

export type TaskDepartureLinkProps = Omit<
  React.ComponentProps<typeof Link>,
  "href" | "onClick"
> & {
  href: string;
  variant?: ButtonVariant;
  fullPageNavigation?: boolean;
};

export const TaskDepartureLink = ({
  children,
  fullPageNavigation = false,
  href,
  prefetch,
  variant,
  ...props
}: TaskDepartureLinkProps) => {
  const context = useContext(TaskDepartureContext);
  const onClick = (event: React.MouseEvent<HTMLAnchorElement>) =>
    context?.request(event, { fullPageNavigation, href });
  const link = fullPageNavigation ? (
    <a {...props} href={href} onClick={onClick}>
      {children}
    </a>
  ) : (
    <Link {...props} href={href} onClick={onClick} prefetch={prefetch}>
      {children}
    </Link>
  );
  return variant ? (
    <Button nativeButton={false} role="link" render={link} variant={variant} />
  ) : (
    link
  );
};

export const UnsavedChangesLink = ({
  children,
  className = "text-primary inline-flex min-h-12 items-center underline underline-offset-4 focus-visible:outline-2",
  description,
  href,
  isDirty,
  onDiscard,
  variant,
}: {
  children: React.ReactNode;
  className?: string;
  description: string;
  href: string;
  isDirty: boolean;
  onDiscard: (() => boolean) | (() => void);
  variant?: ButtonVariant;
}) => {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // Navigation can start as soon as the dirty link is removed from the DOM.
  useLayoutEffect(() => {
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
    const discarded = onDiscard();
    setOpen(false);
    if (discarded === false) {
      return;
    }
    router.push(href);
  };

  return (
    <>
      {variant ? (
        <Button
          className={className}
          nativeButton={false}
          role="link"
          render={
            <Link href={href} onClick={requestNavigation} prefetch={false} />
          }
          variant={variant}
        >
          {children}
        </Button>
      ) : (
        <Link
          className={className}
          href={href}
          onClick={requestNavigation}
          prefetch={false}
        >
          {children}
        </Link>
      )}
      <UnsavedChangesConfirmation
        description={description}
        onDiscard={discardAndNavigate}
        onOpenChange={setOpen}
        open={open}
      />
    </>
  );
};
