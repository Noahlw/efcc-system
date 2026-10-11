import Link from "next/link";
import { useId } from "react";
import type { ComponentProps, ReactNode } from "react";

import { Icon } from "@/components/ui/icon";

export interface AccountOperationSummaryRow {
  label: string;
  value: ReactNode;
}

export const AccountTaskLink = ({
  description,
  href,
  icon,
  label,
}: {
  description: string;
  href: string;
  icon: ComponentProps<typeof Icon>["name"];
  label: string;
}) => (
  <Link
    className="border-border hover:bg-background flex min-w-0 items-center gap-[16px] border-b py-4 text-inherit focus-visible:outline-2"
    href={href}
    prefetch={false}
  >
    <span className="bg-background flex size-[44px] shrink-0 items-center justify-center rounded-xl">
      <Icon className="size-[24px] opacity-75" name={icon} />
    </span>
    <span className="min-w-0 flex-1">
      <strong className="text-body block font-semibold">{label}</strong>
      <small className="text-meta text-muted-foreground mt-1 block">
        {description}
      </small>
    </span>
    <Icon className="size-[20px] shrink-0 opacity-75" name="chevron-right" />
  </Link>
);

export const AccountOperationSummary = ({
  rows,
}: {
  rows: readonly AccountOperationSummaryRow[];
}) => (
  <dl className="divide-border mt-4 grid divide-y">
    {rows.map(({ label, value }) => (
      <div
        className="flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-1 py-4"
        key={label}
      >
        <dt className="text-meta text-muted-foreground max-w-[42%] min-w-0 break-words">
          {label}
        </dt>
        <dd className="text-body m-0 min-w-0 flex-1 text-right font-medium break-words">
          {value}
        </dd>
      </div>
    ))}
  </dl>
);

export const AccountTargetCard = ({
  identifier,
  name,
}: {
  identifier: string;
  name: string;
}) => (
  <section
    aria-label="操作對象"
    className="my-5 mb-6 flex w-full min-w-0 basis-full items-center justify-between gap-3 rounded-xl border border-[#dce7e0] bg-[#f1f6f3] p-4"
  >
    <div className="min-w-0">
      <strong className="text-body block break-words">{name}</strong>
      <small className="text-meta text-muted-foreground block break-words">
        {identifier}
      </small>
    </div>
  </section>
);

const outcomePresentation = {
  danger: "border-danger bg-danger-surface text-danger",
  info: "border-border bg-muted text-foreground",
  neutral: "border-border bg-background text-muted-foreground",
  success: "border-success bg-success/10 text-success",
  warning: "bg-warning-surface text-warning",
} as const;

export const AccountOperationOutcome = ({
  busy = false,
  message,
  title,
  tone,
}: {
  busy?: boolean;
  message: string;
  title?: string;
  tone: "danger" | "info" | "neutral" | "success" | "warning";
}) => {
  const titleId = useId();

  if (busy) {
    return (
      <section
        aria-busy
        aria-labelledby={title ? titleId : undefined}
        className="mt-4 py-3"
      >
        {title ? (
          <h2 className="text-label font-semibold" id={titleId}>
            {title}
          </h2>
        ) : null}
        <p
          aria-live="polite"
          className="text-label text-muted-foreground"
          role="status"
        >
          {message}
        </p>
        <div aria-hidden="true">
          <div className="my-[14px] h-[18px] rounded bg-[#edf1ee]" />
          <div className="my-[14px] h-24 rounded bg-[#edf1ee]" />
          <div className="my-[14px] h-[18px] rounded bg-[#edf1ee]" />
        </div>
      </section>
    );
  }

  const toneClass = outcomePresentation[tone];
  const role = tone === "danger" ? "alert" : "status";
  return (
    <section
      aria-labelledby={title ? titleId : undefined}
      className={`${toneClass} mt-4 rounded-xl p-4 ${tone === "warning" ? "" : "border"}`}
    >
      <div className="flex items-start gap-3">
        {tone === "success" ? (
          <Icon className="mt-0.5 size-7 shrink-0" name="circle-check" />
        ) : null}
        <div className="min-w-0">
          {title ? (
            <h2 className="text-label font-semibold" id={titleId}>
              {title}
            </h2>
          ) : null}
          <p
            aria-live={tone === "danger" ? "assertive" : "polite"}
            className={title ? "text-body mt-1" : "text-body"}
            role={role}
          >
            {message}
          </p>
        </div>
      </div>
    </section>
  );
};
