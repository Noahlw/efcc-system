import type { ReactNode } from "react";

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

const shouldShowForm = (
  flow: IdentityChangeFlow,
  operation: IdentityChangeOperation | null
) =>
  flow === "ready" || flow === "retry" || (flow === "rejected" && !operation);

const identityTaskDescription = (
  staffVerified: boolean,
  step: "edit" | "review"
) => {
  if (staffVerified) {
    return step === "review"
      ? "同一個人，同一次更改。"
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
  operation: IdentityChangeOperation | null,
  matchesCurrentView: boolean
) =>
  operation
    ? matchesCurrentView
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

const operationMatchesView = (
  operation: IdentityChangeOperation | null,
  actorUserId: string,
  account: IdentityContact,
  staffVerified: boolean
): operation is IdentityChangeOperation => {
  if (!operation) {
    return false;
  }
  return (
    operation.actorUserId === actorUserId &&
    operation.targetUserId === account.userId &&
    (staffVerified
      ? operation.action !== "own_phone_changed"
      : operation.action === "own_phone_changed")
  );
};

interface IdentityChangeViewProps {
  account: IdentityContact;
  actorName?: string;
  actorUsername?: string | null;
  actorUserId: string;
  busy: boolean;
  confirmationExpiresAt: number | null;
  confirmationIsFresh: boolean;
  confirmationOpen: boolean;
  dirty: boolean;
  disabled: boolean;
  editFields: ReactNode;
  flow: IdentityChangeFlow;
  message: string;
  onCheck: () => void;
  onConfirmCurrentPassword: () => void;
  onConfirmationClose: () => void;
  onConfirmedInWork: () => void;
  onDiscard: () => void;
  onFinish: () => void;
  onSubmit: (event: React.SubmitEvent<HTMLFormElement>) => void;
  onReturnToEdit: () => void;
  operation: IdentityChangeOperation | null;
  reviewDraft: IdentityReviewDraft | null;
  returnHref: string;
  step: "edit" | "review";
  staffVerified: boolean;
}

const IdentityOperationFeedback = ({
  actorUserId,
  account,
  busy,
  flow,
  message,
  onCheck,
  onFinish,
  operation,
  staffVerified,
}: {
  actorUserId: string;
  account: IdentityContact;
  busy: boolean;
  flow: IdentityChangeFlow;
  message: string;
  onCheck: () => void;
  onFinish: () => void;
  operation: IdentityChangeOperation | null;
  staffVerified: boolean;
}) => (
  <>
    {operationMatchesView(operation, actorUserId, account, staffVerified) ? (
      <AccountOperationSummary
        rows={[
          { label: "操作", value: actionLabels[operation.action] },
          { label: "對象", value: account.fullName },
          { label: "Username", value: account.username ?? "未設定" },
        ]}
      />
    ) : null}
    <AccountOperationOutcome
      busy={busy}
      message={message}
      title={staffVerified ? undefined : flowTitles[flow]}
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
    {flow === "confirmed" || (flow === "rejected" && operation) ? (
      <Button type="button" onClick={onFinish}>
        {staffVerified ? "返回帳戶詳情" : "完成，返回帳戶"}
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
  confirmationExpiresAt,
  confirmationIsFresh,
  disabled,
  onConfirmCurrentPassword,
  onReturnToEdit,
  reviewDraft,
  staffVerified,
}: {
  account: IdentityContact;
  confirmationExpiresAt: number | null;
  confirmationIsFresh: boolean;
  disabled: boolean;
  onConfirmCurrentPassword: () => void;
  onReturnToEdit: () => void;
  reviewDraft: IdentityReviewDraft;
  staffVerified: boolean;
}) => (
  <section aria-labelledby="identity-review-title">
    <h2 className="sr-only" id="identity-review-title">
      提交前檢查
    </h2>
    <AccountOperationSummary
      rows={
        staffVerified
          ? staffReviewRows(account, reviewDraft)
          : ownPhoneReviewRows(account, reviewDraft)
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
    {staffVerified && !confirmationIsFresh ? (
      <AccountOperationOutcome
        message="此敏感操作需要目前登入者的密碼確認；確認完成會返回此畫面，不會自動提交修正。"
        title="尚未確認目前密碼"
        tone="warning"
      />
    ) : null}
    {staffVerified && confirmationIsFresh && confirmationExpiresAt ? (
      <p className="text-muted-foreground mt-4">
        目前登入的密碼確認有效至{" "}
        {formatChurchTimestamp(confirmationExpiresAt * 1000)}
        （香港）；伺服器仍會重新查核。
      </p>
    ) : null}
    <div className="mt-4 flex flex-col gap-3">
      {staffVerified && !confirmationIsFresh ? (
        <Button
          type="button"
          variant="secondary"
          onClick={onConfirmCurrentPassword}
        >
          確認目前密碼
        </Button>
      ) : null}
      <Button
        disabled={disabled || (staffVerified && !confirmationIsFresh)}
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
          ...identityChanges(account, reviewDraft)
            .filter((row) => !row.changed)
            .map((row) => ({ label: row.label, value: row.before })),
          { label: "帳戶識別碼", value: account.userId },
        ]}
      />
    ) : null}
  </section>
);

const IdentityChangeContent = ({
  account,
  actorUserId,
  busy,
  confirmationExpiresAt,
  confirmationIsFresh,
  dirty,
  disabled,
  editFields,
  flow,
  message,
  onCheck,
  onConfirmCurrentPassword,
  onDiscard,
  onFinish,
  onSubmit,
  onReturnToEdit,
  operation,
  reviewDraft,
  returnHref,
  step,
  staffVerified,
}: IdentityChangeViewProps) => {
  const label = staffVerified ? "職員核實修正身分資料" : "更改自己的電話";
  const description = identityTaskDescription(staffVerified, step);
  const matchesCurrentView = operationMatchesView(
    operation,
    actorUserId,
    account,
    staffVerified
  );
  const taskTitle = identityTaskTitle(
    flow,
    step,
    staffVerified,
    matchesCurrentView
  );
  const showCurrentTarget = shouldShowCurrentTarget(
    flow,
    operation,
    matchesCurrentView
  );

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
        hidden={!shouldShowForm(flow, operation)}
      >
        {description}
      </p>
      {staffVerified && showCurrentTarget ? (
        <AccountTargetCard
          identifier={staffAccountIdentifier(account)}
          name={account.fullName}
          changeTarget={
            <AccountTargetSwitch
              disabled={flow !== "ready" || operation !== null}
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
          actorUserId={actorUserId}
          account={account}
          busy={busy}
          flow={flow}
          message={message}
          onCheck={onCheck}
          onFinish={onFinish}
          operation={operation}
          staffVerified={staffVerified}
        />
      )}

      {shouldShowForm(flow, operation) ? (
        <form className="mt-6" onSubmit={onSubmit}>
          <fieldset disabled={disabled} className="flex flex-col gap-5">
            <div
              className={step === "edit" ? "flex flex-col gap-6" : "hidden"}
              hidden={step !== "edit"}
            >
              {editFields}
            </div>
            {step === "review" && reviewDraft ? (
              <IdentityReview
                account={account}
                confirmationExpiresAt={confirmationExpiresAt}
                confirmationIsFresh={confirmationIsFresh}
                disabled={disabled}
                onConfirmCurrentPassword={onConfirmCurrentPassword}
                onReturnToEdit={onReturnToEdit}
                reviewDraft={reviewDraft}
                staffVerified={staffVerified}
              />
            ) : null}
          </fieldset>
        </form>
      ) : null}
    </section>
  );
};

export const IdentityChangeView = (props: IdentityChangeViewProps) => {
  const {
    account,
    actorName,
    actorUserId,
    actorUsername,
    confirmationExpiresAt,
    confirmationOpen,
    onConfirmationClose,
    onConfirmedInWork,
    staffVerified,
  } = props;
  const section = <IdentityChangeContent {...props} />;

  return (
    <>
      {staffVerified ? (
        section
      ) : (
        <main className="flex flex-col">{section}</main>
      )}
      {confirmationOpen ? (
        <AccountSecurityForm
          actorUserId={actorUserId}
          actorName={actorName}
          actorUsername={actorUsername}
          confirmationExpiresAt={confirmationExpiresAt}
          temporaryPasswordExpiresAt={null}
          temporaryPasswordExpired={false}
          task="confirm"
          confirmationOnly
          confirmationContext={[
            { label: "工作", value: "核實修正帳戶身分" },
            {
              label: "對象",
              value: `${account.fullName}（${staffAccountIdentifier(account)}）`,
            },
          ]}
          onConfirmationClose={onConfirmationClose}
          onConfirmedInWork={onConfirmedInWork}
        />
      ) : null}
    </>
  );
};
