import { Dialog } from "@base-ui/react/dialog";
import { useSelector } from "@tanstack/react-form";
import Link from "next/link";
import { useEffect, useState } from "react";

import { TaskHeader } from "@/components/page-frame";
import { useAppForm } from "@/components/ui/app-form";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { UnsavedChangesLink } from "@/components/unsaved-changes-link";
import { formatChurchTimestamp } from "@/shared/time/church-time";

import {
  AccountOperationOutcome,
  AccountOperationSummary,
  AccountTaskLink,
} from "./operation-presentation";
import type { AccountOperationSummaryRow } from "./operation-presentation";
import type { AccountSecurityAction } from "./security-contract";
import type {
  AccountSecurityFlow,
  AccountSecurityOperation,
  AccountSecurityTask,
  SecurityCommandInput,
} from "./security-form";

const flowTitles: Record<AccountSecurityFlow, string> = {
  checking: "正在查核操作",
  confirmed: "操作已確認完成",
  "not-submitted": "這次操作尚未送出",
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
  "not-submitted": "warning",
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
  disabled: (action: AccountSecurityAction) => boolean;
  flow: AccountSecurityFlow;
  message: string;
  onCheck: () => void;
  onFinish: () => void;
  onSubmit: (input: SecurityCommandInput) => Promise<void>;
  operation: AccountSecurityOperation | null;
  task: AccountSecurityTask;
  temporaryPasswordChangeConfirmed: boolean;
  temporaryPasswordExpired: boolean;
  temporaryPasswordExpiresAt: number | null;
}

const submitSecurely = async (
  event: React.SubmitEvent<HTMLFormElement>,
  handleSubmit: () => Promise<void>
) => {
  event.preventDefault();
  event.stopPropagation();
  try {
    await handleSubmit();
  } catch {
    // Field validators surface their own messages; the workflow keeps the
    // explicit submit guard and retry path.
  }
};

/** Keep the page's unsaved-changes guard in step with the live task form. */
const useDirtyReporting = (
  isDirty: boolean,
  onDirtyChange?: (dirty: boolean) => void
) => {
  useEffect(() => {
    onDirtyChange?.(isDirty);
    return () => onDirtyChange?.(false);
  }, [isDirty, onDirtyChange]);
};

/** Drop in-memory secrets when the page's discard action is confirmed. */
const useDiscardReset = (discardToken: number, reset: () => void) => {
  useEffect(() => {
    if (discardToken > 0) {
      reset();
    }
  }, [discardToken, reset]);
};

const SecurityHub = ({
  confirmationExpiresAt,
}: {
  confirmationExpiresAt: number | null;
}) => (
  <>
    <p className="text-label text-muted-foreground">管理你的登入與安全設定。</p>
    {confirmationExpiresAt ? (
      <AccountOperationOutcome
        message={`此登入的目前密碼確認有效至 ${formatChurchTimestamp(confirmationExpiresAt * 1000)}（香港）。敏感操作仍會在伺服器再次查核。`}
        title="目前密碼已確認"
        tone="success"
      />
    ) : (
      <AccountOperationOutcome
        message="有需要時，可在原本工作內完成確認。"
        title="尚未確認目前密碼"
        tone="neutral"
      />
    )}
    <nav aria-label="帳戶安全工作" className="border-border border-t">
      <AccountTaskLink
        description="保留目前登入，登出其他裝置"
        href="/account?task=password"
        icon="key-round"
        label="更改密碼"
      />
      <AccountTaskLink
        description="結束其他登入，保留此裝置"
        href="/account?task=sessions"
        icon="log-out"
        label="登出其他裝置"
      />
      <AccountTaskLink
        description="敏感操作確認，有效十分鐘"
        href="/account?task=confirm"
        icon="shield"
        label="確認目前密碼"
      />
    </nav>
  </>
);

const SessionTask = ({
  disabled,
  onSubmit,
}: {
  disabled: (action: AccountSecurityAction) => boolean;
  onSubmit: (input: SecurityCommandInput) => Promise<void>;
}) => (
  <>
    <AccountOperationOutcome
      message="登出後，其他裝置會在下次請求時需要重新登入；目前這個登入會保留。"
      title="其他裝置需要重新登入"
      tone="neutral"
    />
    <div className="mt-6 flex flex-col gap-3">
      <Button
        className="w-full"
        disabled={disabled("other_sessions_revoked")}
        type="button"
        onClick={() => {
          void onSubmit({ action: "other_sessions_revoked" });
        }}
      >
        登出其他裝置
      </Button>
      <Button
        className="w-full"
        disabled={disabled("other_sessions_revoked")}
        nativeButton={false}
        render={<Link href="/account?task=security" prefetch={false} />}
        variant="secondary"
      >
        取消
      </Button>
    </div>
  </>
);

const PasswordTask = ({
  disabled,
  discardToken,
  onDirtyChange,
  onSubmit,
  submitting,
  temporaryPassword,
}: {
  disabled: (action: AccountSecurityAction) => boolean;
  discardToken: number;
  onDirtyChange: (dirty: boolean) => void;
  onSubmit: (input: SecurityCommandInput) => Promise<void>;
  submitting: boolean;
  temporaryPassword: boolean;
}) => {
  const form = useAppForm({
    defaultValues: {
      confirmPassword: "",
      currentPassword: "",
      newPassword: "",
    },
    onSubmit: async ({ formApi, value }) => {
      formApi.reset();
      await onSubmit({
        action: "password_changed",
        currentPassword: value.currentPassword,
        newPassword: value.newPassword,
      });
    },
  });
  const dirty = useSelector(form.store, (state) => state.isDirty);
  useDirtyReporting(dirty, onDirtyChange);
  useDiscardReset(discardToken, form.reset);
  return (
    <>
      {temporaryPassword ? null : (
        <p className="text-label text-muted-foreground mb-6">
          保留目前登入，其他裝置會在下次請求時登出。
        </p>
      )}
      <form.AppForm>
        <form
          className="flex flex-col gap-5"
          noValidate
          onSubmit={(event) => submitSecurely(event, form.handleSubmit)}
        >
          <fieldset
            aria-busy={submitting || undefined}
            className={`flex min-w-0 flex-col ${temporaryPassword ? "gap-5" : "gap-6"}`}
            disabled={disabled("password_changed")}
          >
            <form.AppField
              name="currentPassword"
              validators={{
                onChange: ({ value }) =>
                  value.length === 0 ? "請輸入目前密碼。" : undefined,
              }}
            >
              {(field) => (
                <field.PasswordField
                  autoComplete="current-password"
                  id="current-password"
                  label={temporaryPassword ? "臨時密碼" : "目前密碼"}
                  maxLength={128}
                  required
                  textClassName="text-base"
                />
              )}
            </form.AppField>
            <form.AppField
              name="newPassword"
              validators={{
                onChange: ({ value }) => {
                  if (value.length < 8) {
                    return "新密碼最少需要 8 個字元。";
                  }
                  return value.length > 128
                    ? "新密碼不可多於 128 個字元。"
                    : undefined;
                },
              }}
            >
              {(field) => (
                <field.PasswordField
                  autoComplete="new-password"
                  description="8–128 個字元。"
                  id="new-password"
                  label="新密碼"
                  maxLength={128}
                  minLength={8}
                  required
                  textClassName="text-base"
                />
              )}
            </form.AppField>
            <form.AppField
              name="confirmPassword"
              validators={{
                onChange: ({ fieldApi, value }) => {
                  if (value.length === 0) {
                    return "請再次輸入新密碼。";
                  }
                  return value === fieldApi.form.state.values.newPassword
                    ? undefined
                    : "兩次輸入的新密碼不相同。";
                },
                onChangeListenTo: ["newPassword"],
              }}
            >
              {(field) => (
                <field.PasswordField
                  autoComplete="new-password"
                  id="confirm-password"
                  label="再次輸入新密碼"
                  maxLength={128}
                  minLength={8}
                  required
                  textClassName="text-base"
                />
              )}
            </form.AppField>
            <form.SubmitButton
              disabled={disabled("password_changed")}
              label={submitting ? "正在處理…" : "更改密碼"}
              pendingLabel="正在處理…"
            />
          </fieldset>
        </form>
      </form.AppForm>
    </>
  );
};

/** One-field current-password confirmation shared by the task page and work dialog. */
const PasswordConfirmationForm = ({
  disabled,
  discardToken = 0,
  formClassName,
  id,
  onDirtyChange,
  onSubmit,
  submitLabel,
}: {
  disabled: (action: AccountSecurityAction) => boolean;
  discardToken?: number;
  formClassName: string;
  id: string;
  onDirtyChange?: (dirty: boolean) => void;
  onSubmit: (input: SecurityCommandInput) => Promise<void>;
  submitLabel: string;
}) => {
  const form = useAppForm({
    defaultValues: { password: "" },
    onSubmit: async ({ formApi, value }) => {
      formApi.reset();
      await onSubmit({
        action: "password_confirmed",
        password: value.password,
      });
    },
  });
  const dirty = useSelector(form.store, (state) => state.isDirty);
  useDirtyReporting(dirty, onDirtyChange);
  useDiscardReset(discardToken, form.reset);
  return (
    <form.AppForm>
      <form
        className={formClassName}
        noValidate
        onSubmit={(event) => submitSecurely(event, form.handleSubmit)}
      >
        <form.AppField
          name="password"
          validators={{
            onChange: ({ value }) =>
              value.length === 0 ? "請輸入目前密碼。" : undefined,
          }}
        >
          {(field) => (
            <field.PasswordField
              autoComplete="current-password"
              id={id}
              label="目前密碼"
              maxLength={128}
              required
              textClassName="text-base"
            />
          )}
        </form.AppField>
        <form.SubmitButton
          disabled={disabled("password_confirmed")}
          label={submitLabel}
          pendingLabel={submitLabel}
        />
      </form>
    </form.AppForm>
  );
};

const ConfirmationTask = ({
  actorName,
  actorUsername,
  confirmationExpiresAt,
  disabled,
  discardToken,
  onDirtyChange,
  onSubmit,
}: {
  actorName?: string;
  actorUsername?: string | null;
  confirmationExpiresAt: number | null;
  disabled: (action: AccountSecurityAction) => boolean;
  discardToken: number;
  onDirtyChange: (dirty: boolean) => void;
  onSubmit: (input: SecurityCommandInput) => Promise<void>;
}) => (
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
    <PasswordConfirmationForm
      disabled={disabled}
      discardToken={discardToken}
      formClassName="flex flex-col gap-5"
      id="confirmation-password"
      onDirtyChange={onDirtyChange}
      onSubmit={onSubmit}
      submitLabel="再次確認目前密碼"
    />
  </>
);

const OperationFeedback = ({
  actorName,
  actorUserId,
  actorUsername,
  busy,
  flow,
  outcomeTitle = flowTitles[flow],
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
> & { finishLabel?: string; outcomeTitle?: string | null }) => (
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
      title={outcomeTitle ?? undefined}
      tone={flowTones[flow]}
    />
    {flow === "not-submitted" || flow === "unknown" || flow === "retry" ? (
      <Button
        disabled={busy}
        type="button"
        variant="secondary"
        onClick={onCheck}
      >
        {flow === "not-submitted" ? "重新檢查本機操作記錄" : "查核之前的操作"}
      </Button>
    ) : null}
    {flow === "confirmed" ? (
      <Button type="button" onClick={onFinish}>
        {finishLabel}
      </Button>
    ) : null}
  </>
);

const TemporaryPasswordNotice = ({
  expired,
  expiresAt,
}: {
  expired: boolean;
  expiresAt: number;
}) => {
  const message = expired
    ? "請聯絡職員重新發出；目前不能更改密碼或使用其他功能。"
    : `臨時密碼有效至 ${formatChurchTimestamp(expiresAt * 1000)}（香港）。`;
  if (expired) {
    return (
      <>
        <p className="text-muted-foreground">{message}</p>
        <div className="bg-warning-surface text-warning flex size-14 items-center justify-center rounded-2xl">
          <Icon className="size-7" name="key-round" />
        </div>
      </>
    );
  }
  return (
    <AccountOperationOutcome
      message={message}
      title="請先更改臨時密碼"
      tone="warning"
    />
  );
};

const taskHeaderSpacing: Record<AccountSecurityTask, string> = {
  confirm: "mb-6",
  password: "mb-2",
  security: "mb-2",
  sessions: "mb-6",
};

const titleByTask: Record<AccountSecurityTask, string> = {
  confirm: "確認目前密碼",
  password: "更改密碼",
  security: "帳戶安全",
  sessions: "登出其他裝置",
};

const renderTemporaryPasswordHeader = (
  props: AccountSecurityViewProps,
  expiresAt: number,
  retryCurrentTask: boolean
) => {
  let title = "設定你的新密碼";
  if (props.temporaryPasswordExpired) {
    title = "臨時密碼已到期";
  }
  if (props.flow !== "ready" && props.flow !== "submitting") {
    title = flowTitles[props.flow];
  }
  if (props.temporaryPasswordChangeConfirmed) {
    title = "密碼已更改";
  }
  return (
    <>
      {props.temporaryPasswordChangeConfirmed ? (
        <div className="bg-success/10 text-success flex size-14 items-center justify-center rounded-2xl">
          <Icon className="size-7" name="circle-check" />
        </div>
      ) : null}
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-task">{title}</h1>
      </header>
      {props.temporaryPasswordChangeConfirmed ? (
        <p className="text-muted-foreground">
          目前登入已保留，其他裝置將在下次請求時登出。原有會籍及保安限制維持不變。
        </p>
      ) : null}
      {!props.temporaryPasswordExpired &&
      !props.temporaryPasswordChangeConfirmed &&
      (props.flow === "ready" ||
        props.flow === "submitting" ||
        retryCurrentTask) ? (
        <p className="text-muted-foreground">
          完成後，便可按目前會籍狀態繼續使用。
        </p>
      ) : null}
      {props.temporaryPasswordChangeConfirmed ? null : (
        <TemporaryPasswordNotice
          expired={props.temporaryPasswordExpired}
          expiresAt={expiresAt}
        />
      )}
      {props.flow === "ready" && props.message ? (
        <AccountOperationOutcome message={props.message} tone="danger" />
      ) : null}
    </>
  );
};

const SecurityTaskPanel = ({
  feedback,
  flow,
  retryCurrentTask,
  showTaskWhileSubmitting,
  taskBody,
}: {
  feedback: React.ReactNode;
  flow: AccountSecurityFlow;
  retryCurrentTask: boolean;
  showTaskWhileSubmitting: boolean;
  taskBody: React.ReactNode;
}) => {
  if (flow === "ready" || (flow === "submitting" && showTaskWhileSubmitting)) {
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

export const AccountSecurityTaskPage = (props: AccountSecurityViewProps) => {
  const {
    actorName,
    actorUserId,
    actorUsername,
    busy,
    confirmationExpiresAt,
    disabled,
    flow,
    message,
    onCheck,
    onFinish,
    onSubmit,
    operation,
    task,
    temporaryPasswordChangeConfirmed,
    temporaryPasswordExpired,
    temporaryPasswordExpiresAt,
  } = props;
  const [passwordDirty, setPasswordDirty] = useState(false);
  const [confirmationDirty, setConfirmationDirty] = useState(false);
  const [discardToken, setDiscardToken] = useState(0);
  const isTemporaryPassword = temporaryPasswordExpiresAt !== null;
  const effectiveTask: AccountSecurityTask = isTemporaryPassword
    ? "password"
    : task;
  const dirty =
    effectiveTask === "password"
      ? passwordDirty
      : effectiveTask === "confirm" && confirmationDirty;
  const operationTask = operation ? taskForAction[operation.action] : null;
  const retryCurrentTask = flow === "retry" && operationTask === effectiveTask;
  const backHref =
    effectiveTask === "security" ? "/account" : "/account?task=security";
  const feedback = (
    <OperationFeedback
      actorName={actorName}
      actorUserId={actorUserId}
      actorUsername={actorUsername}
      busy={busy}
      flow={flow}
      finishLabel={
        temporaryPasswordChangeConfirmed ? "查看帳戶狀態" : undefined
      }
      message={message}
      onCheck={onCheck}
      onFinish={onFinish}
      operation={operation}
      outcomeTitle={isTemporaryPassword ? null : undefined}
    />
  );
  let taskBody: React.ReactNode = null;
  if (effectiveTask === "security") {
    taskBody = <SecurityHub confirmationExpiresAt={confirmationExpiresAt} />;
  } else if (effectiveTask === "sessions") {
    taskBody = <SessionTask disabled={disabled} onSubmit={onSubmit} />;
  } else if (effectiveTask === "password") {
    taskBody = temporaryPasswordExpired ? null : (
      <PasswordTask
        disabled={disabled}
        discardToken={discardToken}
        onDirtyChange={setPasswordDirty}
        onSubmit={onSubmit}
        submitting={flow === "submitting"}
        temporaryPassword={isTemporaryPassword}
      />
    );
  } else {
    taskBody = (
      <ConfirmationTask
        actorName={actorName}
        actorUsername={actorUsername}
        confirmationExpiresAt={confirmationExpiresAt}
        disabled={disabled}
        discardToken={discardToken}
        onDirtyChange={setConfirmationDirty}
        onSubmit={onSubmit}
      />
    );
  }

  return (
    <main
      className={isTemporaryPassword ? "flex flex-col gap-5" : "flex flex-col"}
      aria-label="帳戶安全操作"
    >
      {temporaryPasswordExpiresAt === null ? (
        <TaskHeader
          className={taskHeaderSpacing[effectiveTask]}
          returnControl={
            <UnsavedChangesLink
              className="text-primary flex min-h-11 min-w-11 items-center justify-center rounded-lg focus-visible:outline-2"
              description="離開後會清除未提交的密碼內容；已提交操作的查核記錄會保留。"
              href={backHref}
              isDirty={dirty}
              onDiscard={() => setDiscardToken((token) => token + 1)}
            >
              <Icon className="size-5" name="arrow-left" />
              <span className="sr-only">
                {effectiveTask === "security" ? "返回帳戶" : "返回帳戶安全"}
              </span>
            </UnsavedChangesLink>
          }
          title={titleByTask[effectiveTask]}
        />
      ) : (
        renderTemporaryPasswordHeader(
          props,
          temporaryPasswordExpiresAt,
          retryCurrentTask
        )
      )}
      <SecurityTaskPanel
        feedback={feedback}
        flow={flow}
        retryCurrentTask={retryCurrentTask}
        showTaskWhileSubmitting={isTemporaryPassword}
        taskBody={taskBody}
      />
      {flow === "retry" &&
      !retryCurrentTask &&
      operationTask !== null &&
      !isTemporaryPassword ? (
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
  disabled,
  flow,
  message,
  onCheck,
  onClose,
  onFinish,
  onSubmit,
  operation,
  rows,
}: {
  actorName?: string;
  actorUserId: string;
  actorUsername?: string | null;
  busy: boolean;
  disabled: (action: AccountSecurityAction) => boolean;
  flow: AccountSecurityFlow;
  message: string;
  onCheck: () => void;
  onClose: () => void;
  onFinish: () => void;
  onSubmit: (input: SecurityCommandInput) => Promise<void>;
  operation: AccountSecurityOperation | null;
  rows: readonly AccountOperationSummaryRow[];
}) => (
  <Dialog.Root
    open
    onOpenChange={(open) => {
      if (!open) {
        onClose();
      }
    }}
  >
    <Dialog.Portal>
      <Dialog.Backdrop className="fixed inset-0 z-50 bg-[#13302c59]" />
      <Dialog.Viewport className="fixed inset-0 z-50 grid items-end overflow-y-auto px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] sm:place-items-center">
        <Dialog.Popup className="border-border bg-surface max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-2rem)] w-full max-w-[28rem] overflow-y-auto overscroll-contain rounded-2xl border p-6 shadow-xl outline-none">
          <Dialog.Title className="text-task font-[650] tracking-[-0.015em]">
            確認目前密碼
          </Dialog.Title>
          <Dialog.Description className="text-muted-foreground mt-2">
            確認目前登入者的身分。完成後會返回同一項工作，再由你檢查並明確提交。
          </Dialog.Description>
          <section
            aria-label="目前登入者"
            className="border-border bg-background mt-4 rounded-xl border p-4"
          >
            <p className="text-meta text-muted-foreground">目前登入者</p>
            <strong className="text-body mt-1 block break-words">
              {actorName ?? "目前登入帳戶"}
            </strong>
            <p className="text-meta text-muted-foreground mt-1 break-words">
              {actorUsername ?? actorUserId}
            </p>
          </section>
          <AccountOperationSummary rows={rows} />
          {flow === "ready" ? (
            <>
              <p className="text-muted-foreground mt-4">
                此確認只套用於目前登入，有效十分鐘；敏感操作會在伺服器再次查核。
              </p>
              {message ? (
                <AccountOperationOutcome message={message} tone="danger" />
              ) : null}
            </>
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
            <PasswordConfirmationForm
              disabled={disabled}
              formClassName="mt-4 flex flex-col gap-4"
              id="work-confirmation-password"
              onSubmit={onSubmit}
              submitLabel="確認並返回檢查"
            />
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
