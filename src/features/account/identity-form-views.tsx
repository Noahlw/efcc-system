import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { UnsavedChangesLink } from "@/components/unsaved-changes-link";
import { formatChurchTimestamp } from "@/shared/time/church-time";

import type {
  IdentityChangeFlow,
  IdentityChangeOperation,
  IdentityContact,
  IdentityReviewDraft,
} from "./identity-form";
import {
  AccountOperationOutcome,
  AccountOperationSummary,
} from "./operation-presentation";
import { AccountSecurityForm } from "./security-form";

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
    {operation?.actorUserId === actorUserId ? (
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
    {flow === "confirmed" || (flow === "rejected" && operation) ? (
      <Button type="button" onClick={onFinish}>
        {staffVerified ? "返回帳戶詳情" : "完成，返回帳戶"}
      </Button>
    ) : null}
  </>
);

const staffReviewRows = (
  account: IdentityContact,
  draft: IdentityReviewDraft
) => [
  { label: "對象", value: account.fullName },
  { label: "目前 Username", value: account.username ?? "未設定" },
  { label: "修正後中文名", value: draft.fullName },
  { label: "修正後 Username", value: draft.username },
  { label: "原電郵", value: account.email },
  { label: "修正後電郵", value: draft.email || "清除電郵" },
  { label: "原電話", value: account.phone ?? "未設定" },
  { label: "修正後電話", value: draft.phone },
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
    <h2 className="text-section font-semibold" id="identity-review-title">
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
          ? "確認對象、核實方式和新資料無誤。完成密碼確認後，仍須由你明確提交修正。"
          : "確認新電話無誤後再儲存；這不會自動將電話驗證為復原憑證。"
      }
      title={staffVerified ? "確認身分修正" : "確認新電話"}
      tone="info"
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
      <Button type="button" variant="secondary" onClick={onReturnToEdit}>
        返回修改
      </Button>
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
        type="submit"
      >
        {staffVerified ? "確認並提交修正" : "確認並儲存電話"}
      </Button>
    </div>
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
  const headline = staffVerified ? "職員核實修正身分資料" : "更新聯絡電話";
  const description = staffVerified
    ? "原有 Username 會永久保留；電郵變更後未經驗證，不會啟用電郵登入或復原。"
    : "姓名及 Username 維持不變。新電話須未被其他帳戶使用；不會自動成為已核實復原電話。";

  return (
    <section className="flex flex-col gap-5" aria-label={label}>
      {staffVerified ? (
        <header className="flex flex-wrap items-center gap-3">
          <UnsavedChangesLink
            description="放棄變更會清除未提交的身份資料；已提交操作的查核記錄會保留。"
            href={returnHref}
            isDirty={dirty && draftCanLeave(flow)}
            onDiscard={onDiscard}
          >
            ← 返回帳戶詳情
          </UnsavedChangesLink>
          <div>
            <h2 className="text-section font-semibold">{headline}</h2>
            <p className="text-muted-foreground mt-2">{description}</p>
          </div>
        </header>
      ) : (
        <header className="flex flex-wrap items-center gap-3">
          <UnsavedChangesLink
            description="放棄變更會清除未提交的電話資料；已提交操作的查核記錄會保留。"
            href={returnHref}
            isDirty={dirty && draftCanLeave(flow)}
            onDiscard={onDiscard}
          >
            ← 返回帳戶
          </UnsavedChangesLink>
          <h1 className="text-task font-semibold">{headline}</h1>
        </header>
      )}

      {!staffVerified && step === "edit" ? (
        <AccountOperationSummary
          rows={[
            { label: "帳戶", value: account.fullName },
            { label: "Username", value: account.username ?? "未設定" },
            { label: "目前電話", value: account.phone ?? "未設定" },
          ]}
        />
      ) : null}
      <p className="text-muted-foreground">{description}</p>

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
        <form onSubmit={onSubmit}>
          <fieldset disabled={disabled} className="flex flex-col gap-5">
            <div hidden={step !== "edit"}>{editFields}</div>
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
            { label: "登入者", value: actorName ?? "目前登入帳戶" },
            { label: "Username", value: actorUsername ?? "未設定" },
            { label: "工作", value: "核實修正帳戶身分" },
            {
              label: "對象",
              value: `${account.fullName}（${account.username ?? "未設定"}）`,
            },
          ]}
          onConfirmationClose={onConfirmationClose}
          onConfirmedInWork={onConfirmedInWork}
        />
      ) : null}
    </>
  );
};
