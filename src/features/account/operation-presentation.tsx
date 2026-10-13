import Link from "next/link";
import { useId } from "react";
import type { ComponentProps, ReactNode } from "react";

import { Icon } from "@/components/ui/icon";
import { UnsavedChangesLink } from "@/components/unsaved-changes-link";

import { staffPeopleHref } from "./staff-people-href";

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
  description: ReactNode;
  href: string;
  icon: ComponentProps<typeof Icon>["name"];
  label: string;
}) => (
  <Link
    className="border-border hover:bg-background flex min-w-0 items-center gap-[16px] border-b py-4 text-inherit focus-visible:outline-2"
    href={href}
    prefetch={false}
  >
    <span className="bg-background flex size-[43px] shrink-0 items-center justify-center rounded-xl">
      <Icon className="size-[23px] opacity-[0.77]" name={icon} />
    </span>
    <span className="min-w-0 flex-1">
      <strong className="text-body block leading-[1.4] font-semibold">
        {label}
      </strong>
      <small className="text-meta text-muted-foreground mt-1 block">
        {description}
      </small>
    </span>
    <Icon
      className="size-[18px] shrink-0 opacity-[0.77]"
      name="chevron-right"
    />
  </Link>
);

export const AccountOperationSummary = ({
  className = "mt-4",
  rows,
}: {
  className?: string;
  rows: readonly AccountOperationSummaryRow[];
}) => (
  <dl
    className={`divide-border border-border grid divide-y border-b ${className}`}
  >
    {rows.map(({ label, value }) => (
      <div
        className="flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-1 py-4 lg:grid lg:grid-cols-[minmax(140px,0.65fr)_minmax(0,1.35fr)] lg:gap-x-4"
        key={label}
      >
        <dt className="text-meta text-muted-foreground max-w-[42%] min-w-0 break-words lg:max-w-none">
          {label}
        </dt>
        <dd className="text-body m-0 min-w-0 flex-1 text-right font-medium break-words lg:text-left">
          {value}
        </dd>
      </div>
    ))}
  </dl>
);

export const AccountTargetCard = ({
  className = "my-5 mb-6",
  children,
  identifier,
  name,
  changeTarget,
}: {
  children?: ReactNode;
  className?: string;
  identifier: string;
  name: string;
  changeTarget?: ReactNode;
}) => (
  <section
    aria-label="操作對象"
    className={`flex w-full min-w-0 basis-full items-center justify-between gap-3 rounded-xl border border-[#dce7e0] bg-[#f1f6f3] p-4 ${className}`}
  >
    <div className="min-w-0">
      <strong className="text-body block break-words">{name}</strong>
      <small className="text-meta text-muted-foreground block break-words">
        {identifier}
      </small>
      {children}
    </div>
    {changeTarget}
  </section>
);

const outcomePresentation = {
  danger: "bg-danger-surface text-[#853d35] [&_h2]:text-[#92392f]",
  info: "bg-muted text-[#214a43] [&_h2]:text-primary-hover",
  neutral: "bg-background text-muted-foreground [&_h2]:text-primary-hover",
  success: "bg-muted text-[#214a43] [&_h2]:text-primary-hover",
  warning: "bg-warning-surface text-[#77551e] [&_h2]:text-[#79531a]",
} as const;

export const AccountOperationOutcome = ({
  busy = false,
  className = "my-6",
  message,
  title,
  tone,
}: {
  busy?: boolean;
  className?: string;
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
          <h2 className="text-label" id={titleId}>
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
      className={`${toneClass} rounded-xl p-4 ${className}`}
    >
      <div className="flex items-start gap-3">
        {tone === "success" ? (
          <Icon className="mt-0.5 size-7 shrink-0" name="circle-check" />
        ) : null}
        <div className="min-w-0">
          {title ? (
            <h2
              className="text-label leading-[1.6] font-bold tracking-normal"
              id={titleId}
            >
              {title}
            </h2>
          ) : null}
          <p
            aria-live={tone === "danger" ? "assertive" : "polite"}
            className={title ? "text-body mt-[6px]" : "text-body"}
            role={role}
          >
            {message}
          </p>
        </div>
      </div>
    </section>
  );
};

/** Read-only presentation; the original flow owner still owns every snapshot. */
export const AccountOperationDetails = ({
  children,
  rows,
  title = "操作詳情",
}: {
  children?: ReactNode;
  rows?: readonly AccountOperationSummaryRow[];
  title?: string;
}) => (
  <details aria-label={title} className="border-border mt-6 border-t pt-2">
    <summary className="text-label text-muted-foreground flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 py-3 focus-visible:outline-2 [&::-webkit-details-marker]:hidden">
      {title}
      <Icon className="size-[18px] shrink-0" name="chevron-right" />
    </summary>
    {rows?.length ? (
      <AccountOperationSummary className="mt-0" rows={rows} />
    ) : null}
    {children}
  </details>
);

export const AccountTargetSwitch = ({
  disabled,
  isDirty,
  onDiscard,
  returnHref,
}: {
  disabled: boolean;
  isDirty: boolean;
  onDiscard: () => void;
  returnHref: string;
}) =>
  disabled ? (
    <span
      className="text-meta text-muted-foreground shrink-0"
      aria-disabled="true"
    >
      更換對象
      <span className="sr-only">：請先完成或查核原操作</span>
    </span>
  ) : (
    <UnsavedChangesLink
      className="text-primary text-meta inline-flex min-h-11 shrink-0 items-center focus-visible:outline-2"
      description="放棄未提交的資料及核對，返回有權管理的帳戶列表。"
      href={staffPeopleHref(
        new URLSearchParams(returnHref.split("?")[1]).get("q") ?? undefined
      )}
      isDirty={isDirty}
      onDiscard={onDiscard}
    >
      更換對象
    </UnsavedChangesLink>
  );
