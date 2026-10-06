import type { ReactNode } from "react";

export interface AccountOperationSummaryRow {
  label: string;
  value: ReactNode;
}

export const AccountOperationSummary = ({
  rows,
}: {
  rows: readonly AccountOperationSummaryRow[];
}) => (
  <dl className="divide-border mt-4 grid divide-y">
    {rows.map(({ label, value }) => (
      <div
        className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))] gap-3 py-3"
        key={label}
      >
        <dt className="text-muted-foreground min-w-0 break-words">{label}</dt>
        <dd className="min-w-0 text-right font-medium break-words">{value}</dd>
      </div>
    ))}
  </dl>
);

export const AccountOperationOutcome = ({
  busy = false,
  message,
  title,
  tone,
}: {
  busy?: boolean;
  message: string;
  title: string;
  tone: "danger" | "info" | "success" | "warning";
}) => {
  const toneClass = {
    danger: "border-danger bg-danger-surface text-danger",
    info: "border-border bg-muted",
    success: "border-success bg-success/10",
    warning: "border-primary bg-muted",
  }[tone];
  const role = tone === "danger" ? "alert" : "status";

  return (
    <section
      aria-busy={busy || undefined}
      aria-labelledby="account-operation-outcome"
      className={`${toneClass} mt-4 rounded-lg border p-4`}
    >
      <h2 className="text-task font-semibold" id="account-operation-outcome">
        {title}
      </h2>
      <p
        aria-live={tone === "danger" ? "assertive" : "polite"}
        className="mt-2"
        role={role}
      >
        {message}
      </p>
    </section>
  );
};
