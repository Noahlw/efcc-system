import { TaskHeader } from "@/components/page-frame";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { UnsavedChangesLink } from "@/components/unsaved-changes-link";
import { formatChurchTimestamp } from "@/shared/time/church-time";

import {
  AccountOperationDetails,
  AccountOperationOutcome,
  AccountOperationSummary,
  AccountTargetCard,
  AccountTargetSwitch,
} from "../operation-presentation";
import { AccountSecurityForm } from "../security/security-form";
import { staffAccountIdentifier } from "../staff-account-identifier";
import type {
  IdentityChangeFlow,
  IdentityChangeOperation,
  IdentityChangeReviewTask,
  IdentityChangeViewTask,
  IdentityContact,
  IdentityReviewDraft,
} from "./identity-form";

const flowTitles: Record<IdentityChangeFlow, string> = {
  checking: "正在查核操作",
  confirmed: "操作已確認完成",
  denied: "目前帳戶或管理權限已改變",
  ready: "",
  rejected: "修正未提交",
  restoring: "正在查核操作",
  retry: "未找到完成紀錄",
  revalidating: "正在重新查核帳戶資料",
  submitting: "正在提交操作",
  unknown: "操作結果未確認",
};

const flowTones: Record<
  IdentityChangeFlow,
  "danger" | "info" | "success" | "warning"
> = {
  checking: "info",
  confirmed: "success",
  denied: "danger",
  ready: "info",
  rejected: "danger",
  restoring: "info",
  retry: "warning",
  revalidating: "info",
  submitting: "info",
  unknown: "warning",
};

const actionLabels: Record<IdentityChangeOperation["action"], string> = {
  own_phone_changed: "更改電話",
  staff_identity_corrected: "職員核實修正身分資料",
  staff_shared_phone_corrected: "職員核實共用電話例外",
};

const draftCanLeave = (flow: IdentityChangeFlow) =>
  flow === "ready" ||
  flow === "retry" ||
  flow === "rejected" ||
  flow === "revalidating";

const shouldShowForm = (flow: IdentityChangeFlow, hasOperation: boolean) =>
  flow === "ready" ||
  flow === "retry" ||
  (flow === "rejected" && !hasOperation);

const identityTaskDescription = (
  staffVerified: boolean,
  step: "edit" | "review"
) => {
  if (staffVerified) {
    return step === "review"
      ? "請核對此帳戶資料；按「確認並提交修正」才會送交伺服器。"
      : "原有 Username 會永久保留；電郵變更後未經驗證，不會啟用電郵登入或復原。";
  }
  return "姓名及 Username 維持不變。新電話須未被其他帳戶使用；不會自動成為已核實復原電話。";
};

const identityTaskTitle = (
  flow: IdentityChangeFlow,
  step: "edit" | "review",
  staffVerified: boolean,
  matchesCurrentView: boolean
) => {
  if (!staffVerified) {
    if (flow === "ready") {
      return step === "review" ? "檢查新電話" : "更新聯絡電話";
    }
    return flow === "confirmed" && matchesCurrentView
      ? "電話已更新"
      : flowTitles[flow];
  }
  if (flow === "ready") {
    return step === "review" ? "檢查身份修正" : "修正身份資料";
  }
  if (flow === "confirmed" && matchesCurrentView) {
    return "身份資料已更新";
  }
  return flowTitles[flow];
};

const shouldShowCurrentTarget = (
  flow: IdentityChangeFlow,
  hasOperation: boolean,
  hasMatchingOperation: boolean
) =>
  hasOperation
    ? hasMatchingOperation
    : flow === "ready" || flow === "rejected" || flow === "revalidating";

const reviewVerificationMethod = (
  account: IdentityContact,
  draft: IdentityReviewDraft
) => {
  if (draft.identityCheck !== "verified_phone") {
    return "親身核實";
  }
  if (account.verifiedRecoveryPhone === null) {
    return "目前已核實電話不可用；請重新選擇";
  }
  return "透過原有已核實電話主動聯絡";
};

interface IdentityChangeViewProps {
  account: IdentityContact;
  busy: boolean;
  currentOperation: Pick<IdentityChangeOperation, "action"> | null;
  dirty: boolean;
  disabled: boolean;
  flow: IdentityChangeFlow;
  hasOperation: boolean;
  message: string;
  onCheck: () => void;
  onDiscard: () => void;
  onFinish: () => void;
  onSubmit: (event: React.SubmitEvent<HTMLFormElement>) => void;
  returnHref: string;
  task: IdentityChangeViewTask;
}

const IdentityOperationFeedback = ({
  account,
  busy,
  currentOperation,
  flow,
  hasOperation,
  message,
  onCheck,
  onFinish,
  taskKind,
}: {
  account: IdentityContact;
  busy: boolean;
  currentOperation: Pick<IdentityChangeOperation, "action"> | null;
  flow: IdentityChangeFlow;
  hasOperation: boolean;
  message: string;
  onCheck: () => void;
  onFinish: () => void;
  taskKind: IdentityChangeViewTask["kind"];
}) => (
  <>
    {currentOperation ? (
      <AccountOperationSummary
        rows={[
          { label: "操作", value: actionLabels[currentOperation.action] },
          { label: "對象", value: account.fullName },
          { label: "Username", value: account.username ?? "未設定" },
        ]}
      />
    ) : null}
    <AccountOperationOutcome
      busy={busy}
      message={message}
      title={taskKind === "staff-identity" ? undefined : flowTitles[flow]}
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
    {flow === "confirmed" || (flow === "rejected" && hasOperation) ? (
      <Button type="button" onClick={onFinish}>
        {taskKind === "staff-identity" ? "返回帳戶詳情" : "完成，返回帳戶"}
      </Button>
    ) : null}
  </>
);

const identityChanges = (
  account: IdentityContact,
  draft: IdentityReviewDraft
) => [
  {
    after: draft.fullName,
    before: account.fullName,
    changed: account.fullName !== draft.fullName,
    label: "中文全名",
  },
  {
    after: draft.username,
    before: account.username ?? "未設定",
    changed: (account.username ?? "") !== draft.username,
    label: "Username",
  },
  {
    after: draft.email || "清除電郵",
    before: account.email || "未設定",
    changed: (account.email ?? "") !== draft.email,
    label: "電郵",
  },
  {
    after: draft.phone,
    before: account.phone ?? "未設定",
    changed: (account.phone ?? "") !== draft.phone,
    label: "電話",
  },
];

const staffReviewRows = (
  account: IdentityContact,
  draft: IdentityReviewDraft
) => [
  ...identityChanges(account, draft)
    .filter((row) => row.changed)
    .map((row) => ({
      label: row.label,
      value: (
        <span>
          <span>{row.before}</span>
          <span className="text-muted-foreground mx-2" aria-label="改為">
            →
          </span>
          <span>{row.after}</span>
        </span>
      ),
    })),
  { label: "共用電話例外", value: draft.sharedPhone ? "已核實共用" : "否" },
  { label: "核實方式", value: reviewVerificationMethod(account, draft) },
  { label: "本人已核實", value: draft.identityVerified ? "已核實" : "未核實" },
];

const ownPhoneReviewRows = (
  account: IdentityContact,
  draft: IdentityReviewDraft
) => [
  { label: "中文全名", value: account.fullName },
  { label: "Username", value: account.username ?? "未設定" },
  { label: "目前電話", value: account.phone ?? "未設定" },
  { label: "新電話", value: draft.phone },
];

const IdentityReview = ({
  account,
  disabled,
  task,
}: {
  account: IdentityContact;
  disabled: boolean;
  task: IdentityChangeReviewTask;
}) => {
  const staffVerified = task.kind === "staff-identity";
  const { draft, onReturnToEdit } = task.phase;
  const confirmation =
    task.kind === "staff-identity" ? task.phase.confirmation : null;

  return (
    <section aria-labelledby="identity-review-title">
      <h2 className="sr-only" id="identity-review-title">
        提交前檢查
      </h2>
      <AccountOperationSummary
        rows={
          staffVerified
            ? staffReviewRows(account, draft)
            : ownPhoneReviewRows(account, draft)
        }
      />
      <AccountOperationOutcome
        message={
          staffVerified
            ? "電郵仍未經驗證；新電話沒有用來核實這次身份。"
            : "確認新電話無誤後再儲存；這不會自動將電話驗證為復原憑證。"
        }
        title={staffVerified ? "聯絡資料不會成為復原憑證" : "確認新電話"}
        tone={staffVerified ? "neutral" : "info"}
      />
      {confirmation && !confirmation.isFresh ? (
        <AccountOperationOutcome
          message="此敏感操作需要目前登入者的密碼確認；確認完成會返回此畫面，不會自動提交修正。"
          title="尚未確認目前密碼"
          tone="warning"
        />
      ) : null}
      {confirmation?.isFresh && confirmation.expiresAt ? (
        <p className="text-muted-foreground mt-4">
          目前登入的密碼確認有效至{" "}
          {formatChurchTimestamp(confirmation.expiresAt * 1000)}
          （香港）；伺服器仍會重新查核。
        </p>
      ) : null}
      <div className="mt-4 flex flex-col gap-3">
        {confirmation && !confirmation.isFresh ? (
          <Button
            type="button"
            variant="secondary"
            onClick={confirmation.onConfirmCurrentPassword}
          >
            確認目前密碼
          </Button>
        ) : null}
        <Button
          disabled={disabled || Boolean(confirmation && !confirmation.isFresh)}
          className="w-full"
          type="submit"
        >
          {staffVerified ? "確認並提交修正" : "確認並儲存電話"}
        </Button>
        <Button
          className="w-full"
          type="button"
          variant="secondary"
          onClick={onReturnToEdit}
        >
          返回修改
        </Button>
      </div>
      {staffVerified ? (
        <AccountOperationDetails
          title="未改動資料及操作詳情"
          rows={[
            ...identityChanges(account, draft)
              .filter((row) => !row.changed)
              .map((row) => ({ label: row.label, value: row.before })),
            { label: "帳戶識別碼", value: account.userId },
          ]}
        />
      ) : null}
    </section>
  );
};

const getReviewTask = (
  task: IdentityChangeViewTask
): IdentityChangeReviewTask | null => {
  if (task.phase.kind !== "review") {
    return null;
  }
  if (task.kind === "staff-identity") {
    return { kind: task.kind, phase: task.phase };
  }
  return { kind: task.kind, phase: task.phase };
};

const IdentityChangeContent = ({
  account,
  busy,
  currentOperation,
  dirty,
  disabled,
  flow,
  hasOperation,
  message,
  onCheck,
  onDiscard,
  onFinish,
  onSubmit,
  returnHref,
  task,
}: IdentityChangeViewProps) => {
  const staffVerified = task.kind === "staff-identity";
  const step = task.phase.kind;
  const label = staffVerified ? "職員核實修正身分資料" : "更改自己的電話";
  const description = identityTaskDescription(staffVerified, step);
  const matchesCurrentView = currentOperation !== null;
  const taskTitle = identityTaskTitle(
    flow,
    step,
    staffVerified,
    matchesCurrentView
  );
  const showCurrentTarget = shouldShowCurrentTarget(
    flow,
    hasOperation,
    matchesCurrentView
  );
  const review = getReviewTask(task);

  return (
    <section className="flex flex-col" aria-label={label}>
      <TaskHeader
        returnControl={
          <UnsavedChangesLink
            className="text-primary flex min-h-11 min-w-11 items-center justify-center rounded-lg focus-visible:outline-2"
            description={
              staffVerified
                ? "放棄變更會清除未提交的身份資料；已提交操作的查核記錄會保留。"
                : "放棄變更會清除未提交的電話資料；已提交操作的查核記錄會保留。"
            }
            href={returnHref}
            isDirty={dirty && draftCanLeave(flow)}
            onDiscard={onDiscard}
          >
            <Icon className="size-5" name="arrow-left" />
            <span className="sr-only">
              {staffVerified ? "返回帳戶詳情" : "返回帳戶"}
            </span>
          </UnsavedChangesLink>
        }
        title={taskTitle}
      />

      <p
        className="text-muted-foreground mb-2"
        hidden={!shouldShowForm(flow, hasOperation)}
      >
        {description}
      </p>
      {staffVerified && showCurrentTarget ? (
        <AccountTargetCard
          identifier={staffAccountIdentifier(account)}
          name={account.fullName}
          changeTarget={
            <AccountTargetSwitch
              disabled={flow !== "ready" || hasOperation}
              isDirty={dirty}
              onDiscard={onDiscard}
              returnHref={returnHref}
            />
          }
        />
      ) : null}
      {!staffVerified && step === "edit" ? (
        <AccountOperationSummary
          rows={[
            { label: "帳戶", value: account.fullName },
            { label: "Username", value: account.username ?? "未設定" },
            { label: "目前電話", value: account.phone ?? "未設定" },
          ]}
        />
      ) : null}

      {flow === "ready" && message ? (
        <AccountOperationOutcome
          message={message}
          title="請檢查資料"
          tone="danger"
        />
      ) : null}
      {flow === "ready" ? null : (
        <IdentityOperationFeedback
          account={account}
          busy={busy}
          currentOperation={currentOperation}
          flow={flow}
          hasOperation={hasOperation}
          message={message}
          onCheck={onCheck}
          onFinish={onFinish}
          taskKind={task.kind}
        />
      )}

      {shouldShowForm(flow, hasOperation) ? (
        <form className="mt-6" onSubmit={onSubmit}>
          <fieldset disabled={disabled} className="flex flex-col gap-5">
            <div
              className={step === "edit" ? "flex flex-col gap-6" : "hidden"}
              hidden={step !== "edit"}
            >
              {task.editFields}
            </div>
            {review ? (
              <IdentityReview
                account={account}
                disabled={disabled}
                task={review}
              />
            ) : null}
          </fieldset>
        </form>
      ) : null}
    </section>
  );
};

export const IdentityChangeView = (props: IdentityChangeViewProps) => {
  const staffTask = props.task.kind === "staff-identity" ? props.task : null;
  const section = <IdentityChangeContent {...props} />;

  return (
    <>
      {staffTask ? section : <main className="flex flex-col">{section}</main>}
      {staffTask?.confirmationDialog.open ? (
        <AccountSecurityForm
          actorUserId={staffTask.actor.userId}
          actorName={staffTask.actor.name}
          actorUsername={staffTask.actor.username}
          confirmationExpiresAt={staffTask.confirmationDialog.expiresAt}
          temporaryPasswordExpiresAt={null}
          temporaryPasswordExpired={false}
          task="confirm"
          confirmationOnly
          confirmationContext={[
            { label: "工作", value: "核實修正帳戶身分" },
            {
              label: "對象",
              value: `${props.account.fullName}（${staffAccountIdentifier(props.account)}）`,
            },
          ]}
          onConfirmationClose={staffTask.confirmationDialog.onClose}
          onConfirmedInWork={staffTask.confirmationDialog.onConfirmedInWork}
        />
      ) : null}
    </>
  );
};
