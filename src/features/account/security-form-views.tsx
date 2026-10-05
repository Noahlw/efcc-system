import { Dialog } from "@base-ui/react/dialog";
import Link from "next/link";
import type { Dispatch, SetStateAction } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UnsavedChangesLink } from "@/components/unsaved-changes-link";
import { formatChurchTimestamp } from "@/shared/time/church-time";

import {
  AccountOperationOutcome,
  AccountOperationSummary,
} from "./operation-presentation";
import type { AccountOperationSummaryRow } from "./operation-presentation";
import type { AccountSecurityAction } from "./security";
import type {
  AccountSecurityFlow,
  AccountSecurityOperation,
  AccountSecurityTask,
  PasswordDraft,
} from "./security-form";

const flowTitles: Record<AccountSecurityFlow, string> = {
  checking: "正在查核操作",
  confirmed: "操作已確認完成",
  ready: "",
  restoring: "正在查核操作",
  retry: "未找到完成紀錄",
  submitting: "正在提交操作",
  unknown: "操作結果未確認",
};
const flowTones: Record<
  AccountSecurityFlow,
  "danger" | "info" | "success" | "warning"
> = {
  checking: "info",
  confirmed: "success",
  ready: "info",
  restoring: "info",
  retry: "warning",
  submitting: "info",
  unknown: "warning",
};
const labels: Record<AccountSecurityAction, string> = {
  other_sessions_revoked: "登出其他裝置",
  password_changed: "更改密碼",
  password_confirmed: "確認目前密碼",
};
const taskForAction: Record<AccountSecurityAction, AccountSecurityTask> = {
  other_sessions_revoked: "sessions",
  password_changed: "password",
  password_confirmed: "confirm",
};

interface AccountSecurityViewProps {
  actorName?: string;
  actorUserId: string;
  actorUsername?: string | null;
  busy: boolean;
  confirmationExpiresAt: number | null;
  confirmationPassword: string;
  disabled: (action: AccountSecurityAction) => boolean;
  flow: AccountSecurityFlow;
  message: string;
  onCheck: () => void;
  onDiscard: () => void;
  onFinish: () => void;
  onSubmit: (
    event: React.SubmitEvent<HTMLFormElement>,
    action: AccountSecurityAction
  ) => void;
  operation: AccountSecurityOperation | null;
  passwordDraft: PasswordDraft;
  setConfirmationPassword: Dispatch<SetStateAction<string>>;
  setPasswordDraft: Dispatch<SetStateAction<PasswordDraft>>;
  task: AccountSecurityTask;
  temporaryPasswordExpired: boolean;
  temporaryPasswordExpiresAt: number | null;
}

const SecurityHub = ({
  confirmationExpiresAt,
}: {
  confirmationExpiresAt: number | null;
}) => (
  <>
    <p className="text-muted-foreground">
      管理此登入的密碼、其他裝置和敏感操作確認。
    </p>
    {confirmationExpiresAt ? (
      <AccountOperationOutcome
        message={`此登入的目前密碼確認有效至 ${formatChurchTimestamp(confirmationExpiresAt * 1000)}（香港）。敏感操作仍會在伺服器再次查核。`}
        title="目前密碼已確認"
        tone="success"
      />
    ) : null}
    <nav aria-label="帳戶安全工作" className="flex flex-col gap-3">
      <Link
        className="border-border bg-surface inline-flex min-h-14 items-center justify-between gap-4 rounded-lg border px-4 font-medium focus-visible:outline-2"
        href="/account?task=password"
        prefetch={false}
      >
        <span>
          更改密碼
          <span className="text-muted-foreground text-body mt-1 block font-normal">
            保留目前登入，登出其他裝置
          </span>
        </span>
        <span aria-hidden="true">›</span>
      </Link>
      <Link
        className="border-border bg-surface inline-flex min-h-14 items-center justify-between gap-4 rounded-lg border px-4 font-medium focus-visible:outline-2"
        href="/account?task=sessions"
        prefetch={false}
      >
        登出其他裝置
        <span aria-hidden="true">›</span>
      </Link>
      <Link
        className="border-border bg-surface inline-flex min-h-14 items-center justify-between gap-4 rounded-lg border px-4 font-medium focus-visible:outline-2"
        href="/account?task=confirm"
        prefetch={false}
      >
        確認目前密碼
        <span aria-hidden="true">›</span>
      </Link>
    </nav>
  </>
);

const PasswordTask = ({
  disabled,
  onSubmit,
  passwordDraft,
  setPasswordDraft,
}: Pick<
  AccountSecurityViewProps,
  "disabled" | "onSubmit" | "passwordDraft" | "setPasswordDraft"
>) => (
  <>
    <p className="text-muted-foreground">
      保留目前登入，其他裝置會在下次請求時登出。新密碼為 8 至 128 個字元。
    </p>
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => onSubmit(event, "password_changed")}
    >
      <label
        className="flex flex-col gap-2 font-medium"
        htmlFor="current-password"
      >
        目前密碼
        <Input
          autoComplete="current-password"
          id="current-password"
          maxLength={128}
          name="currentPassword"
          required
          type="password"
          value={passwordDraft.currentPassword}
          onChange={(event) => {
            const currentPassword = event.currentTarget.value;
            setPasswordDraft((current) => ({
              ...current,
              currentPassword,
            }));
          }}
        />
      </label>
      <label className="flex flex-col gap-2 font-medium" htmlFor="new-password">
        新密碼
        <Input
          autoComplete="new-password"
          id="new-password"
          maxLength={128}
          minLength={8}
          name="newPassword"
          required
          type="password"
          value={passwordDraft.newPassword}
          onChange={(event) => {
            const newPassword = event.currentTarget.value;
            setPasswordDraft((current) => ({
              ...current,
              newPassword,
            }));
          }}
        />
      </label>
      <label
        className="flex flex-col gap-2 font-medium"
        htmlFor="confirm-password"
      >
        再次輸入新密碼
        <Input
          autoComplete="new-password"
          id="confirm-password"
          maxLength={128}
          minLength={8}
          name="confirmPassword"
          required
          type="password"
          value={passwordDraft.confirmPassword}
          onChange={(event) => {
            const confirmPassword = event.currentTarget.value;
            setPasswordDraft((current) => ({
              ...current,
              confirmPassword,
            }));
          }}
        />
      </label>
      <Button disabled={disabled("password_changed")} type="submit">
        更改密碼
      </Button>
    </form>
  </>
);

const SessionTask = ({
  disabled,
  onSubmit,
}: Pick<AccountSecurityViewProps, "disabled" | "onSubmit">) => (
  <>
    <AccountOperationOutcome
      message="登出後，其他裝置會在下次請求時需要重新登入；目前這個登入會保留。"
      title="其他裝置需要重新登入"
      tone="warning"
    />
    <form onSubmit={(event) => onSubmit(event, "other_sessions_revoked")}>
      <Button disabled={disabled("other_sessions_revoked")} type="submit">
        登出其他裝置
      </Button>
    </form>
  </>
);

const ConfirmationTask = ({
  actorName,
  actorUsername,
  confirmationExpiresAt,
  confirmationPassword,
  disabled,
  onSubmit,
  setConfirmationPassword,
}: Pick<
  AccountSecurityViewProps,
  | "actorName"
  | "actorUsername"
  | "confirmationExpiresAt"
  | "confirmationPassword"
  | "disabled"
  | "onSubmit"
  | "setConfirmationPassword"
>) => (
  <>
    <AccountOperationSummary
      rows={[
        { label: "目前登入", value: actorName ?? "目前登入帳戶" },
        { label: "Username", value: actorUsername ?? "未設定" },
        { label: "有效期", value: "十分鐘；伺服器每次都會重新查核" },
      ]}
    />
    <AccountOperationOutcome
      message={
        confirmationExpiresAt
          ? `此登入已確認至 ${formatChurchTimestamp(confirmationExpiresAt * 1000)}（香港）。需要時，敏感工作仍會要求重新確認。`
          : "確認只套用於目前登入，有效十分鐘；敏感工作會在伺服器再次查核。"
      }
      title={confirmationExpiresAt ? "目前密碼已確認" : "確認目前密碼"}
      tone={confirmationExpiresAt ? "success" : "info"}
    />
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => onSubmit(event, "password_confirmed")}
    >
      <label
        className="flex flex-col gap-2 font-medium"
        htmlFor="confirmation-password"
      >
        目前密碼
        <Input
          autoComplete="current-password"
          id="confirmation-password"
          maxLength={128}
          name="password"
          required
          type="password"
          value={confirmationPassword}
          onChange={(event) =>
            setConfirmationPassword(event.currentTarget.value)
          }
        />
      </label>
      <Button disabled={disabled("password_confirmed")} type="submit">
        再次確認目前密碼
      </Button>
    </form>
  </>
);

const OperationFeedback = ({
  actorName,
  actorUserId,
  actorUsername,
  busy,
  flow,
  message,
  onCheck,
  onFinish,
  finishLabel = "完成，返回帳戶安全",
  operation,
}: Pick<
  AccountSecurityViewProps,
  | "actorName"
  | "actorUserId"
  | "actorUsername"
  | "busy"
  | "flow"
  | "message"
  | "onCheck"
  | "onFinish"
  | "operation"
> & { finishLabel?: string }) => (
  <>
    {operation?.actorUserId === actorUserId ? (
      <AccountOperationSummary
        rows={[
          { label: "操作", value: labels[operation.action] },
          { label: "帳戶", value: actorName ?? "目前登入帳戶" },
          { label: "Username", value: actorUsername ?? "未設定" },
        ]}
      />
    ) : null}
    <AccountOperationOutcome
      busy={busy}
      message={message}
      title={flowTitles[flow]}
      tone={flowTones[flow]}
    />
    {flow === "unknown" || flow === "retry" ? (
      <Button
        disabled={busy}
        type="button"
        variant="secondary"
        onClick={onCheck}
      >
        查核之前的操作
      </Button>
    ) : null}
    {flow === "confirmed" ? (
      <Button type="button" onClick={onFinish}>
        {finishLabel}
      </Button>
    ) : null}
  </>
);

const AccountSecurityTaskBody = ({
  actorName,
  actorUsername,
  confirmationExpiresAt,
  confirmationPassword,
  disabled,
  onSubmit,
  passwordDraft,
  setConfirmationPassword,
  setPasswordDraft,
  task,
  temporaryPasswordExpired,
}: Pick<
  AccountSecurityViewProps,
  | "actorName"
  | "actorUsername"
  | "confirmationExpiresAt"
  | "confirmationPassword"
  | "disabled"
  | "onSubmit"
  | "passwordDraft"
  | "setConfirmationPassword"
  | "setPasswordDraft"
  | "task"
  | "temporaryPasswordExpired"
>) => {
  if (task === "security") {
    return <SecurityHub confirmationExpiresAt={confirmationExpiresAt} />;
  }
  if (task === "password") {
    return temporaryPasswordExpired ? null : (
      <PasswordTask
        disabled={disabled}
        onSubmit={onSubmit}
        passwordDraft={passwordDraft}
        setPasswordDraft={setPasswordDraft}
      />
    );
  }
  if (task === "sessions") {
    return <SessionTask disabled={disabled} onSubmit={onSubmit} />;
  }
  return (
    <ConfirmationTask
      actorName={actorName}
      actorUsername={actorUsername}
      confirmationExpiresAt={confirmationExpiresAt}
      confirmationPassword={confirmationPassword}
      disabled={disabled}
      onSubmit={onSubmit}
      setConfirmationPassword={setConfirmationPassword}
    />
  );
};

const AccountSecurityTaskPanel = ({
  effectiveTask,
  retryCurrentTask,
  temporaryPasswordExpired,
  ...props
}: AccountSecurityViewProps & {
  effectiveTask: AccountSecurityTask;
  retryCurrentTask: boolean;
}) => {
  const feedback = (
    <OperationFeedback
      actorName={props.actorName}
      actorUserId={props.actorUserId}
      actorUsername={props.actorUsername}
      busy={props.busy}
      flow={props.flow}
      message={props.message}
      onCheck={props.onCheck}
      onFinish={props.onFinish}
      operation={props.operation}
    />
  );
  const taskBody = (
    <AccountSecurityTaskBody
      actorName={props.actorName}
      actorUsername={props.actorUsername}
      confirmationExpiresAt={props.confirmationExpiresAt}
      confirmationPassword={props.confirmationPassword}
      disabled={props.disabled}
      onSubmit={props.onSubmit}
      passwordDraft={props.passwordDraft}
      setConfirmationPassword={props.setConfirmationPassword}
      setPasswordDraft={props.setPasswordDraft}
      task={effectiveTask}
      temporaryPasswordExpired={temporaryPasswordExpired}
    />
  );

  if (props.flow === "ready") {
    return taskBody;
  }
  if (retryCurrentTask) {
    return (
      <>
        {feedback}
        {taskBody}
      </>
    );
  }
  return feedback;
};

export const AccountSecurityTaskPage = ({
  actorName,
  actorUserId,
  actorUsername,
  busy,
  confirmationExpiresAt,
  confirmationPassword,
  disabled,
  flow,
  message,
  onCheck,
  onDiscard,
  onFinish,
  onSubmit,
  operation,
  passwordDraft,
  setConfirmationPassword,
  setPasswordDraft,
  task,
  temporaryPasswordExpired,
  temporaryPasswordExpiresAt,
}: AccountSecurityViewProps) => {
  const isTemporaryPassword = temporaryPasswordExpiresAt !== null;
  const effectiveTask: AccountSecurityTask = isTemporaryPassword
    ? "password"
    : task;
  const dirty =
    (effectiveTask === "password" &&
      Object.values(passwordDraft).some((value) => value.length > 0)) ||
    (effectiveTask === "confirm" && confirmationPassword.length > 0);
  const titleByTask: Record<AccountSecurityTask, string> = {
    confirm: "確認目前密碼",
    password: isTemporaryPassword ? "更改臨時密碼" : "更改密碼",
    security: "帳戶安全",
    sessions: "登出其他裝置",
  };
  const operationTask = operation ? taskForAction[operation.action] : null;
  const retryCurrentTask = flow === "retry" && operationTask === effectiveTask;
  const backHref =
    effectiveTask === "security" ? "/account" : "/account?task=security";

  return (
    <main className="flex flex-col gap-5" aria-label="帳戶安全操作">
      <header className="flex flex-wrap items-center gap-3">
        {isTemporaryPassword ? null : (
          <UnsavedChangesLink
            description="離開後會清除未提交的密碼內容；已提交操作的查核記錄會保留。"
            href={backHref}
            isDirty={dirty}
            onDiscard={onDiscard}
          >
            {effectiveTask === "security" ? "← 返回帳戶" : "← 返回帳戶安全"}
          </UnsavedChangesLink>
        )}
        <h1 className="text-task font-semibold">
          {titleByTask[effectiveTask]}
        </h1>
      </header>
      {isTemporaryPassword ? (
        <AccountOperationOutcome
          message={
            temporaryPasswordExpired
              ? "臨時密碼已到期，請聯絡職員重新發出；目前不能更改密碼或使用其他功能。"
              : `請先更改職員發出的臨時密碼，才能使用其他功能。臨時密碼有效至 ${formatChurchTimestamp(temporaryPasswordExpiresAt * 1000)}（香港）；更改後仍會保留原有會籍及保安限制。`
          }
          title={
            temporaryPasswordExpired ? "臨時密碼已到期" : "請先更改臨時密碼"
          }
          tone={temporaryPasswordExpired ? "danger" : "info"}
        />
      ) : null}
      <AccountSecurityTaskPanel
        {...{
          actorName,
          actorUserId,
          actorUsername,
          busy,
          confirmationExpiresAt,
          confirmationPassword,
          disabled,
          flow,
          message,
          onCheck,
          onDiscard,
          onFinish,
          onSubmit,
          operation,
          passwordDraft,
          setConfirmationPassword,
          setPasswordDraft,
          task,
          temporaryPasswordExpired,
          temporaryPasswordExpiresAt,
        }}
        effectiveTask={effectiveTask}
        retryCurrentTask={retryCurrentTask}
      />
      {flow === "retry" && !retryCurrentTask && operationTask !== null ? (
        <Link
          className="text-primary inline-flex min-h-12 items-center rounded-md underline underline-offset-4 focus-visible:outline-2"
          href={`/account?task=${operationTask}`}
          prefetch={false}
        >
          返回原工作
        </Link>
      ) : null}
    </main>
  );
};

export const AccountSecurityConfirmationDialog = ({
  actorName,
  actorUserId,
  actorUsername,
  busy,
  confirmationPassword,
  disabled,
  flow,
  message,
  onCheck,
  onClose,
  onFinish,
  onSubmit,
  operation,
  rows,
  setConfirmationPassword,
}: Pick<
  AccountSecurityViewProps,
  | "actorName"
  | "actorUserId"
  | "actorUsername"
  | "busy"
  | "confirmationPassword"
  | "disabled"
  | "flow"
  | "message"
  | "onCheck"
  | "onFinish"
  | "onSubmit"
  | "operation"
  | "setConfirmationPassword"
> & {
  onClose: () => void;
  rows: readonly AccountOperationSummaryRow[];
}) => (
  <Dialog.Root
    open
    onOpenChange={(open) => {
      if (!open) {
        setConfirmationPassword("");
        onClose();
      }
    }}
  >
    <Dialog.Portal>
      <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40" />
      <Dialog.Viewport className="fixed inset-0 z-50 grid items-end overflow-y-auto p-0 sm:place-items-center sm:p-4">
        <Dialog.Popup className="border-border bg-surface max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom))] w-full max-w-xl overflow-y-auto overscroll-contain rounded-t-2xl border p-5 shadow-xl outline-none sm:rounded-xl">
          <Dialog.Title className="text-task font-semibold">
            確認目前密碼
          </Dialog.Title>
          <Dialog.Description className="text-muted-foreground mt-2">
            確認目前登入者的身分。完成後會返回同一項工作，再由你檢查並明確提交。
          </Dialog.Description>
          <AccountOperationSummary rows={rows} />
          {flow === "ready" ? (
            <p className="text-muted-foreground mt-4">
              此確認只套用於目前登入，有效十分鐘；敏感操作會在伺服器再次查核。
            </p>
          ) : (
            <OperationFeedback
              actorName={actorName}
              actorUserId={actorUserId}
              actorUsername={actorUsername}
              busy={busy}
              flow={flow}
              message={message}
              onCheck={onCheck}
              onFinish={onFinish}
              finishLabel="確認並返回檢查"
              operation={operation}
            />
          )}
          {flow === "ready" || flow === "retry" ? (
            <form
              className="mt-4 flex flex-col gap-4"
              onSubmit={(event) => onSubmit(event, "password_confirmed")}
            >
              <label
                className="flex flex-col gap-2 font-medium"
                htmlFor="work-confirmation-password"
              >
                目前密碼
                <Input
                  autoComplete="current-password"
                  id="work-confirmation-password"
                  maxLength={128}
                  name="password"
                  required
                  type="password"
                  value={confirmationPassword}
                  onChange={(event) =>
                    setConfirmationPassword(event.currentTarget.value)
                  }
                />
              </label>
              <Button disabled={disabled("password_confirmed")} type="submit">
                確認並返回檢查
              </Button>
            </form>
          ) : null}
          <Dialog.Close
            render={
              <Button
                className="mt-3 w-full"
                type="button"
                variant="secondary"
              />
            }
          >
            返回原工作
          </Dialog.Close>
        </Dialog.Popup>
      </Dialog.Viewport>
    </Dialog.Portal>
  </Dialog.Root>
);
