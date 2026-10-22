"use client";

import { formOptions, useSelector } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { useAppForm, withForm } from "@/components/ui/app-form";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { UnsavedChangesLink } from "@/components/unsaved-changes-link";
import {
  AccountOperationDetails,
  AccountOperationOutcome,
  AccountOperationSummary,
  AccountTargetCard,
  AccountTargetSwitch,
} from "@/features/account/operation-presentation";
import type { AccountOperationSummaryRow } from "@/features/account/operation-presentation";
import {
  authContextCookieName,
  prepareAuthContextMarker,
  readAuthContextMarker,
} from "@/features/auth/auth-context-marker";
import { membershipStatusLabel } from "@/features/identity/labels";
import { businessRpc } from "@/shared/business-rpc";
import { formatChurchTimestamp } from "@/shared/time/church-time";

import type { ManagedAccount } from "../managed-accounts";
import { readTransientReconciliation } from "../reconciliation-query";
import { AccountSecurityForm } from "../security/security-form";
import { settleSessionDraft } from "../session-draft";
import { useSessionDraftRecovery } from "../session-draft-recovery";
import { staffAccountIdentifier } from "../staff-account-identifier";
import type { StaffAccountsTaskContext } from "../staff-workspace/staff-task-contract";
import {
  staffAccountActionSchema,
  staffAccountErrorSchema,
  staffAccountResponseSchema,
  staffCreationFieldSchemas,
  staffCreationFormSchema,
  staffRecoveryFieldSchemas,
  staffRecoveryFormSchema,
  staffReceiptMatchesOperation,
  storedStaffAccountOperationSchema,
} from "./staff-account-contract";
import type {
  StaffAccountReceipt,
  StaffCreationValues,
  StaffCreationInput,
  StaffIdentityCheck,
  StaffRecoveryValues,
  StoredStaffAccountOperation,
} from "./staff-account-contract";
import { staffAccountHandoverFromOperation } from "./staff-account-handover";
import type {
  StaffAccountHandover,
  StaffHandoverIdentity,
  StaffIssuance,
} from "./staff-account-handover";

const storageKey = "efcc.staff-account.operation.v1";
type Action = StoredStaffAccountOperation["action"];
type RecoveryAction = Exclude<Action, "assisted_account_created">;
type IdentityCheck = StaffIdentityCheck;
type Operation = StoredStaffAccountOperation;
const actionTasks: Record<Action, StaffAccountsTaskContext["task"]> = {
  assisted_account_created: "create",
  staff_password_reset: "recovery",
  temporary_password_reissued: "recovery",
};
interface RecoveryReview {
  readonly action: RecoveryAction;
  readonly identityCheck: IdentityCheck;
  readonly targetUserId: string;
}
type Flow =
  | "restoring"
  | "ready"
  | "submitting"
  | "checking"
  | "unknown"
  | "retry"
  | "confirmed";
interface CreationReview {
  readonly email: string;
  readonly fullName: string;
  readonly phone: string;
  readonly sharedPhone: boolean;
  readonly username: string;
}
const flowTitles: Record<Flow, string> = {
  checking: "正在查核操作",
  confirmed: "操作已確認完成",
  ready: "操作狀態",
  restoring: "正在查核操作",
  retry: "未找到完成紀錄",
  submitting: "正在提交操作",
  unknown: "操作結果未確認",
};
const resultTitles: Record<Action, string> = {
  assisted_account_created: "確認建立帳戶結果",
  staff_password_reset: "確認重設密碼結果",
  temporary_password_reissued: "確認重發結果",
};
const handoverTitles: Record<Action, string> = {
  assisted_account_created: "帳戶已建立",
  staff_password_reset: "密碼已重設",
  temporary_password_reissued: "臨時密碼已重新發出",
};
const flowTones: Record<Flow, "danger" | "info" | "success" | "warning"> = {
  checking: "info",
  confirmed: "success",
  ready: "info",
  restoring: "info",
  retry: "warning",
  submitting: "info",
  unknown: "warning",
};

const readOperation = (): Operation | null => {
  const saved = localStorage.getItem(storageKey);
  return saved
    ? storedStaffAccountOperationSchema.parse(JSON.parse(saved))
    : null;
};
const recoveryActionLabels: Record<RecoveryAction, string> = {
  staff_password_reset: "重設密碼及登出全部裝置",
  temporary_password_reissued: "重新發出臨時密碼",
};
const identityCheckLabels: Record<IdentityCheck, string> = {
  face_to_face: "親身核實",
  verified_phone: "職員主動聯絡教會原有已核實電話",
};
const creationReviewRows = (
  draft: CreationReview
): AccountOperationSummaryRow[] => [
  { label: "中文全名", value: draft.fullName },
  { label: "使用者名稱", value: draft.username },
  { label: "電郵", value: draft.email || "未提供" },
  { label: "電話", value: draft.phone },
  { label: "共用電話例外", value: draft.sharedPhone ? "已核實" : "否" },
  { label: "身分核實", value: "已親身核實" },
  { label: "建立後狀態", value: "已批准" },
  { label: "臨時密碼", value: "七日後到期；首次登入必須更改" },
];
const recoveryReviewRows = (
  draft: RecoveryReview,
  target: ManagedAccount | undefined
): AccountOperationSummaryRow[] => [
  {
    label: "對象帳戶",
    value: target
      ? `${target.fullName}（${staffAccountIdentifier(target)}）`
      : draft.targetUserId,
  },
  { label: "操作", value: recoveryActionLabels[draft.action] },
  { label: "身分核實", value: identityCheckLabels[draft.identityCheck] },
  ...(draft.identityCheck === "verified_phone"
    ? [
        {
          label: "已核實電話",
          value: target?.verifiedRecoveryPhone ?? "目前不可用",
        },
      ]
    : []),
  {
    label: "完成後",
    value: "發出七日有效的臨時密碼並登出對象的其他裝置；首次登入必須更改密碼",
  },
];
const creationReviewFromInput = (
  input: StaffCreationInput
): CreationReview => ({
  email: input.email ?? "",
  fullName: input.fullName,
  phone: input.phone,
  sharedPhone: input.sharedPhone,
  username: input.username,
});
const passwordConfirmationError = (status: number, body: unknown) => {
  const result = staffAccountErrorSchema.safeParse(body);
  return status === 403 &&
    result.success &&
    result.data.error.code === "password_confirmation_required"
    ? result.data.error
    : null;
};

const staffReconciliationQueryKey = ["staff-account-reconciliation"] as const;
type StaffReconciliationOutcome =
  | { kind: "confirmed"; receipt: StaffAccountReceipt }
  | { kind: "not-found" }
  | { kind: "unverified" };
const recoveryCommandRpc = {
  staff_password_reset: businessRpc.api.v2.staff.accounts["password-reset"],
  temporary_password_reissued:
    businessRpc.api.v2.staff.accounts["password-reissue"],
} as const;

interface StaffCommand {
  action: Action;
  actorUserId: string;
  body: object;
}
type StaffSubmitOutcome =
  | {
      kind: "confirmed";
      receipt: StaffAccountReceipt;
      status: number;
      issuance: StaffIssuance | null;
      authContextMarker: string;
    }
  | { kind: "invalid" }
  | { kind: "confirmation-required"; message: string }
  | { kind: "unknown" };

/** Typed business commands; plaintext never leaves the live response. */
const currentAuthSessionMatchesActor = async (
  expectedActorUserId: string
): Promise<boolean> => {
  try {
    const response = await fetch("/api/auth/get-session", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      return false;
    }
    const session: unknown = await response.json();
    if (
      session === null ||
      typeof session !== "object" ||
      !("user" in session)
    ) {
      return false;
    }
    const { user } = session;
    return (
      user !== null &&
      typeof user === "object" &&
      "id" in user &&
      user.id === expectedActorUserId
    );
  } catch {
    return false;
  }
};

const sendStaffCommand = async (
  command: StaffCommand,
  rememberAuthContextMarker: (marker: string) => void
): Promise<StaffSubmitOutcome> => {
  const authContextMarker = prepareAuthContextMarker();
  rememberAuthContextMarker(authContextMarker);
  const options = {
    headers: { "x-efcc-expected-actor-id": command.actorUserId },
    init: { cache: "no-store", credentials: "same-origin" },
  } satisfies Parameters<typeof businessRpc.api.v2.staff.accounts.$post>[1];
  const response =
    command.action === "assisted_account_created"
      ? await businessRpc.api.v2.staff.accounts.$post(
          { json: command.body },
          options
        )
      : await recoveryCommandRpc[command.action].$post(
          { json: command.body },
          options
        );
  if (response.status !== 200 && response.status !== 201) {
    const body: unknown = await response.json();
    const confirmationError = passwordConfirmationError(response.status, body);
    if (confirmationError) {
      return {
        kind: "confirmation-required",
        message: confirmationError.message,
      };
    }
    return { kind: response.status === 400 ? "invalid" : "unknown" };
  }
  const body: unknown = await response.json();
  const result = staffAccountResponseSchema.safeParse(body);
  if (!result.success || result.data.data.receipt === null) {
    return { kind: "unknown" };
  }
  const outcome: StaffSubmitOutcome = {
    authContextMarker,
    issuance:
      "temporaryPassword" in result.data.data
        ? {
            temporaryPassword: result.data.data.temporaryPassword,
            temporaryPasswordExpiresAt:
              result.data.data.temporaryPasswordExpiresAt,
          }
        : null,
    kind: "confirmed",
    receipt: result.data.data.receipt,
    status: response.status,
  };
  if (
    command.action === "assisted_account_created" &&
    outcome.kind === "confirmed" &&
    outcome.status === 201 &&
    outcome.issuance !== null &&
    (!(await currentAuthSessionMatchesActor(command.actorUserId)) ||
      readAuthContextMarker() !== authContextMarker)
  ) {
    return { kind: "unknown" };
  }
  return outcome;
};

const StaffAccountHandoverView = ({
  actorUserId,
  completionFailed,
  copyPassword,
  finish,
  handover,
  message,
  preserveDraft,
  reissueLostHandover,
  returnHref,
}: {
  actorUserId: string;
  completionFailed: boolean;
  copyPassword: () => Promise<"copied" | "failed" | undefined>;
  finish: (destination?: string) => Promise<void>;
  handover: StaffAccountHandover;
  message: string;
  preserveDraft: boolean;
  reissueLostHandover: () => Promise<void>;
  returnHref: string;
}) => {
  const { identity, receipt } = handover;
  const { issuance } = handover;
  const [acknowledged, setAcknowledged] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<
    "copied" | "failed" | undefined
  >();
  const completionLabel =
    receipt.action === "assisted_account_created"
      ? "完成，返回帳戶管理"
      : "完成，開始另一項操作";
  return (
    <section className="min-w-0">
      {receipt.action === "assisted_account_created" ? (
        <p className="mb-3">
          會籍已批准，無需再提交申請；首次登入仍須更改臨時密碼。
        </p>
      ) : null}
      <p className="text-muted-foreground">臨時密碼只會在這次成功回應顯示。</p>
      <AccountTargetCard
        name={identity?.fullName ?? "原操作的帳戶"}
        identifier={identity?.username ?? "帳戶編號見操作詳情"}
      />
      {issuance ? (
        <>
          <section className="bg-background rounded-xl p-[25px] lg:p-7">
            <h2 className="text-section">一次性顯示</h2>
            <p className="mt-2">新臨時密碼（只顯示一次）：</p>
            <output
              className="border-border bg-surface text-section my-3 block rounded-[7px] border p-[14px] font-mono tracking-[0.05em] break-all select-text"
              aria-label="新臨時密碼"
            >
              {issuance.temporaryPassword}
            </output>
            <p className="text-meta text-muted-foreground">
              到期時間（香港）：
              {formatChurchTimestamp(
                issuance.temporaryPasswordExpiresAt * 1000
              )}
            </p>
            <Button
              className="mt-4 w-full"
              type="button"
              variant="secondary"
              onClick={async () => setCopyFeedback(await copyPassword())}
            >
              複製臨時密碼
            </Button>
            {copyFeedback ? (
              <p className="text-meta mt-3" role="status" aria-live="polite">
                {copyFeedback === "failed"
                  ? "未能複製，請手動選取臨時密碼；不要把密碼寫入公開訊息。"
                  : "已複製臨時密碼，請私下交接。"}
              </p>
            ) : null}
          </section>
          <AccountOperationOutcome
            message="請按已核實的身分／教會原有可靠聯絡途徑私下交接；不要使用新提供的聯絡資料作復原憑證。離開或隱藏此頁後不能再次讀取，亦不要截圖轉發。"
            title="首次登入需更改密碼"
            tone="warning"
          />
          <label className="flex min-h-11 items-start gap-3">
            <input
              checked={acknowledged}
              className="mt-1 h-5 w-5 shrink-0"
              onChange={(event) => setAcknowledged(event.target.checked)}
              type="checkbox"
            />
            已私下交接臨時密碼，並提醒首次登入必須更改
          </label>
        </>
      ) : (
        <>
          <AccountOperationOutcome
            message="原臨時密碼不能再次讀取；到期資料亦不會由收據重建。請先查核目前仍可管理的目標帳戶，再重新核實當事人；只有完成核實並再次確認後，才可發出新的臨時密碼。"
            title="臨時密碼不能再次顯示"
            tone="warning"
          />
          {preserveDraft ? null : (
            <Button
              className="w-full"
              type="button"
              variant="secondary"
              onClick={reissueLostHandover}
            >
              重新核實並發出新臨時密碼
            </Button>
          )}
        </>
      )}
      {preserveDraft ? (
        <p className="text-muted-foreground mt-3">
          這項操作已完成，但本頁帳戶資料尚未提交。繼續核對會保留草稿。
        </p>
      ) : null}
      {completionFailed ? (
        <p className="text-danger mt-4" role="alert">
          {message}
        </p>
      ) : null}
      <Button
        className="mt-6 w-full"
        disabled={issuance !== null && !acknowledged}
        type="button"
        onClick={() =>
          finish(
            receipt.action === "assisted_account_created"
              ? returnHref
              : undefined
          )
        }
      >
        {preserveDraft ? "保留草稿，繼續核對" : completionLabel}
      </Button>
      {receipt.action === "assisted_account_created" && !preserveDraft ? (
        <Button
          className="mt-3 w-full"
          disabled={issuance !== null && !acknowledged}
          type="button"
          variant="secondary"
          onClick={() => finish()}
        >
          建立下一位會友
        </Button>
      ) : null}
      <AccountOperationDetails
        rows={[
          { label: "登入職員帳戶識別碼", value: actorUserId },
          { label: "對象帳戶識別碼", value: receipt.targetUserId },
          {
            label: "發出時間（香港）",
            value: formatChurchTimestamp(receipt.createdAt * 1000),
          },
          { label: "操作查核編號", value: receipt.id },
        ]}
      >
        <p className="text-meta text-muted-foreground mt-4" role="status">
          {message}
        </p>
      </AccountOperationDetails>
    </section>
  );
};

/** One live Form owns the creation task values; review confirmation re-submits it. */
const emptyCreationDraft: StaffCreationValues = {
  email: "",
  fullName: "",
  phone: "",
  sharedPhone: false,
  username: "",
  verified: false,
};

const creationFormOptions = formOptions({ defaultValues: emptyCreationDraft });

const AssistedAccountCreationFields = withForm({
  ...creationFormOptions,
  props: {} as {
    disabled: boolean;
    hidden: boolean;
  },
  render: ({ disabled, form, hidden }) => (
    <fieldset
      aria-label="帳戶資料"
      className="flex min-w-0 flex-col gap-4"
      disabled={disabled}
      hidden={hidden}
    >
      <form.AppField
        name="fullName"
        validators={{ onChange: staffCreationFieldSchemas.fullName }}
      >
        {(field) => (
          <field.TextField
            autoComplete="name"
            id="assisted-name"
            label="中文全名"
            maxLength={200}
            required
          />
        )}
      </form.AppField>
      <form.AppField
        name="username"
        validators={{ onChange: staffCreationFieldSchemas.username }}
      >
        {(field) => (
          <field.TextField
            autoComplete="off"
            id="assisted-username"
            label="使用者名稱"
            maxLength={30}
            required
          />
        )}
      </form.AppField>
      <form.AppField
        name="email"
        validators={{ onChange: staffCreationFieldSchemas.email }}
      >
        {(field) => (
          <field.TextField
            autoComplete="email"
            id="assisted-email"
            label="電郵（沒有電郵可留空）"
            maxLength={254}
            type="email"
          />
        )}
      </form.AppField>
      <form.AppField
        name="phone"
        validators={{ onChange: staffCreationFieldSchemas.phone }}
      >
        {(field) => (
          <field.TextField
            autoComplete="tel"
            id="assisted-phone"
            label="電話"
            maxLength={40}
            required
            type="tel"
          />
        )}
      </form.AppField>
      <form.AppField name="sharedPhone">
        {(field) => (
          <field.CheckboxField
            id="assisted-shared-phone"
            label="已親身核實共用電話例外"
          />
        )}
      </form.AppField>
      <form.AppField
        name="verified"
        validators={{ onChange: staffCreationFieldSchemas.verified }}
      >
        {(field) => (
          <field.CheckboxField
            id="assisted-verified"
            label="已親身核實此人的身分"
          />
        )}
      </form.AppField>
      <form.SubmitButton
        disabled={disabled}
        label="檢查帳戶資料"
        pendingLabel="檢查帳戶資料"
      />
    </fieldset>
  ),
});

const AssistedAccountCreationReview = withForm({
  ...creationFormOptions,
  props: {} as {
    disabled: boolean;
    draft: CreationReview;
    onEdit: () => void;
  },
  render: ({ disabled, draft, form, onEdit }) => (
    <section className="min-w-0">
      <AccountOperationSummary
        rows={creationReviewRows(draft).filter((row) =>
          ["中文全名", "使用者名稱", "電郵", "電話"].includes(row.label)
        )}
      />
      <p className="text-meta text-muted-foreground mt-4">
        身分核實：<span>已親身核實</span>；共用電話例外：
        <span>{draft.sharedPhone ? "已核實" : "否"}</span>；建立後會籍：
        <span>已批准</span>。
      </p>
      <div className="mt-6">
        <AccountOperationOutcome
          message="確認提交會同時批准會籍、建立帳戶及發出七日有效的臨時密碼。請準備安全交給本人；密碼只顯示一次，首次登入必須更改。"
          title="下一步會產生臨時密碼"
          tone="warning"
        />
      </div>
      <div className="mt-6 flex flex-col-reverse gap-3">
        <Button type="button" variant="secondary" onClick={onEdit}>
          返回修改
        </Button>
        <form.SubmitButton
          disabled={disabled}
          label="確認並建立帳戶及發出臨時密碼"
          pendingLabel="確認並建立帳戶及發出臨時密碼"
        />
      </div>
    </section>
  ),
});

const AssistedAccountCreationForm = withForm({
  ...creationFormOptions,
  props: {} as {
    disabled: boolean;
    onEdit: () => void;
    review: CreationReview | null;
  },
  render: ({ disabled, form, onEdit, review }) => (
    <form.AppForm>
      <form
        className="contents"
        noValidate
        onSubmit={async (event) => {
          event.preventDefault();
          event.stopPropagation();
          await form.handleSubmit();
        }}
      >
        <AssistedAccountCreationFields
          disabled={disabled}
          form={form}
          hidden={review !== null}
        />
        {review ? (
          <AssistedAccountCreationReview
            disabled={disabled}
            draft={review}
            form={form}
            onEdit={onEdit}
          />
        ) : null}
      </form>
    </form.AppForm>
  ),
});

const StaffAccountRecoveryReview = ({
  changeTarget,
  draft,
  onConfirm,
  onEdit,
  target,
}: {
  changeTarget: React.ReactNode;
  draft: RecoveryReview;
  onConfirm: () => void;
  onEdit: () => void;
  target: ManagedAccount | undefined;
}) => (
  <section className="min-w-0">
    <AccountTargetCard
      name={target?.fullName ?? "原操作的帳戶"}
      identifier={target ? staffAccountIdentifier(target) : draft.targetUserId}
      changeTarget={changeTarget}
    />
    <AccountOperationSummary rows={recoveryReviewRows(draft, target)} />
    <div className="mt-6">
      <AccountOperationOutcome
        message="這次操作會產生新臨時密碼。本人需要使用新密碼登入並更改。"
        title="請準備安全交收"
        tone="warning"
      />
    </div>
    <div className="mt-6 flex flex-col-reverse gap-3">
      <Button type="button" variant="secondary" onClick={onEdit}>
        返回修改
      </Button>
      <Button type="button" onClick={onConfirm}>
        確認並{recoveryActionLabels[draft.action]}
      </Button>
    </div>
  </section>
);

const emptyRecoveryDraft: StaffRecoveryValues = {
  identityCheck: "face_to_face",
  targetUserId: "",
  verified: false,
};
const recoveryFormOptions = formOptions({ defaultValues: emptyRecoveryDraft });

const usableVerifiedRecoveryPhone = (account: ManagedAccount | undefined) => {
  const phone = account?.verifiedRecoveryPhone?.trim();
  return phone || null;
};

const StaffAccountRecoveryForm = withForm({
  ...recoveryFormOptions,
  props: {} as {
    accounts: ManagedAccount[];
    changeTarget: React.ReactNode;
    action: RecoveryAction;
    canChangeTarget: boolean;
    fixedTargetUserId: string | null;
    formRef: React.Ref<HTMLFormElement>;
    hidden: boolean;
    onActionChange: (action: RecoveryAction) => void;
    onSubmit: (event: React.SubmitEvent<HTMLFormElement>) => void;
    recoveryDisabled: boolean;
    reissueDisabled: boolean;
    resetDisabled: boolean;
    target: ManagedAccount | undefined;
    targetId: string;
  },
  render: ({
    accounts,
    changeTarget,
    action,
    canChangeTarget,
    fixedTargetUserId,
    form,
    formRef,
    hidden,
    onActionChange,
    onSubmit,
    recoveryDisabled,
    reissueDisabled,
    resetDisabled,
    target,
    targetId,
  }) => (
    <form.AppForm>
      <form
        className="min-w-0"
        hidden={hidden}
        ref={formRef}
        onSubmit={onSubmit}
      >
        <fieldset
          className="flex min-w-0 flex-col gap-3"
          disabled={recoveryDisabled}
        >
          <legend className="sr-only">協助復原／重新發出臨時密碼</legend>
          {target ? (
            <AccountTargetCard
              changeTarget={changeTarget}
              identifier={staffAccountIdentifier(target)}
              name={target.fullName}
            />
          ) : (
            <p>對象帳戶：尚未選擇</p>
          )}
          {fixedTargetUserId ? (
            <form.AppField
              name="targetUserId"
              validators={{ onChange: staffRecoveryFieldSchemas.targetUserId }}
            >
              {(field) => (
                <input
                  name="targetUserId"
                  type="hidden"
                  value={field.state.value}
                />
              )}
            </form.AppField>
          ) : (
            <>
              <label htmlFor="recovery-target">更換對象</label>
              <form.AppField
                name="targetUserId"
                validators={{
                  onChange: staffRecoveryFieldSchemas.targetUserId,
                }}
              >
                {(field) => (
                  <select
                    className="border-input-border min-h-[52px] rounded-[10px] border px-[14px] py-3 text-base leading-[1.5]"
                    disabled={!canChangeTarget}
                    id="recovery-target"
                    onBlur={field.handleBlur}
                    onChange={(event) => {
                      const nextTargetId = event.target.value;
                      field.handleChange(nextTargetId);
                      form.setFieldValue("verified", false);
                      onActionChange("staff_password_reset");
                      if (
                        !usableVerifiedRecoveryPhone(
                          accounts.find(
                            (account) => account.userId === nextTargetId
                          )
                        )
                      ) {
                        form.setFieldValue("identityCheck", "face_to_face");
                      }
                    }}
                    required
                    value={field.state.value}
                  >
                    <option value="">請選擇帳戶</option>
                    {accounts.map((account) => (
                      <option key={account.userId} value={account.userId}>
                        {account.fullName}（{account.username ?? "未設定"}）
                      </option>
                    ))}
                  </select>
                )}
              </form.AppField>
            </>
          )}
          {target ? (
            <AccountOperationSummary
              rows={[
                {
                  label: "會籍",
                  value: membershipStatusLabel(target.membershipStatus),
                },
                {
                  label: "保安暫停",
                  value: target.banned === null ? "沒有" : "仍然生效",
                },
                {
                  label: "已核實復原電話",
                  value: usableVerifiedRecoveryPhone(target) ?? "未有紀錄",
                },
              ]}
            />
          ) : null}
          <form.AppField
            name="identityCheck"
            listeners={{
              onChange: () => form.setFieldValue("verified", false),
            }}
            validators={{ onChange: staffRecoveryFieldSchemas.identityCheck }}
          >
            {(field) =>
              usableVerifiedRecoveryPhone(target) ? (
                <field.RadioCardField
                  id="recovery-identity"
                  label="身分核實方式"
                  options={[
                    { label: "親身核實", value: "face_to_face" },
                    {
                      label: "職員主動聯絡教會原有已核實電話",
                      value: "verified_phone",
                    },
                  ]}
                />
              ) : (
                <fieldset className="flex min-w-0 flex-col gap-1">
                  <legend className="text-foreground text-label font-semibold">
                    身分核實方式
                  </legend>
                  <p className="text-label">
                    {field.state.value === "face_to_face"
                      ? "親身核實"
                      : "職員主動聯絡教會原有已核實電話"}
                  </p>
                  <p className="text-meta text-muted-foreground">
                    {field.state.value === "face_to_face"
                      ? "沒有可用的已核實復原電話；請親身核實帳戶持有人身分，再勾選下方確認。"
                      : "目前沒有可用的已核實復原電話；原操作的核實方式會保留，不會自動改用親身核實。"}
                  </p>
                  <input
                    name={field.name}
                    type="hidden"
                    value={field.state.value}
                  />
                </fieldset>
              )
            }
          </form.AppField>
          <form.AppField
            name="verified"
            validators={{ onChange: staffRecoveryFieldSchemas.verified }}
          >
            {(field) => (
              <label className="flex min-h-11 items-center gap-3">
                <input
                  checked={field.state.value}
                  className="h-5 w-5"
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.checked)}
                  required
                  type="checkbox"
                />
                已按以上方式核實身分，並確認不使用新提供或未核實的聯絡資料作憑證
              </label>
            )}
          </form.AppField>
          <fieldset className="flex min-w-0 flex-col gap-3">
            <legend className="text-label font-semibold">帳戶操作</legend>
            <label className="border-border text-label has-[:checked]:border-primary flex min-h-11 items-start gap-[11px] rounded-[9px] border p-[15px] font-bold has-[:checked]:bg-[#f3f8f5]">
              <input
                checked={action === "staff_password_reset"}
                className="accent-primary mt-[6px] size-[18px] shrink-0"
                disabled={resetDisabled}
                name="recovery-action"
                onChange={() => onActionChange("staff_password_reset")}
                type="radio"
                value="staff_password_reset"
              />
              <span>重設密碼，並使原有登入失效</span>
            </label>
            <label className="border-border text-label has-[:checked]:border-primary flex min-h-11 items-start gap-[11px] rounded-[9px] border p-[15px] font-bold has-[:checked]:bg-[#f3f8f5]">
              <input
                aria-describedby="reissue-eligibility"
                checked={action === "temporary_password_reissued"}
                className="accent-primary mt-[6px] size-[18px] shrink-0"
                disabled={
                  reissueDisabled || !target?.temporaryPasswordExpiresAt
                }
                name="recovery-action"
                onChange={() => onActionChange("temporary_password_reissued")}
                type="radio"
                value="temporary_password_reissued"
              />
              <span>
                重新發出臨時密碼
                <span
                  className="text-meta text-muted-foreground block font-normal"
                  id="reissue-eligibility"
                >
                  {target?.temporaryPasswordExpiresAt
                    ? "舊臨時密碼會立即失效；新密碼須私下交接。"
                    : "此帳戶沒有臨時密碼，不能重新發出。"}
                </span>
              </span>
            </label>
          </fieldset>
          <Button
            disabled={
              !targetId ||
              (action === "staff_password_reset"
                ? resetDisabled
                : reissueDisabled || !target?.temporaryPasswordExpiresAt)
            }
            name="action"
            type="submit"
            value={action}
          >
            檢查資料
          </Button>
        </fieldset>
      </form>
    </form.AppForm>
  ),
});

const StaffAccountOperationStatus = ({
  action,
  hidden = false,
  busy,
  check,
  flow,
  foreignOperation,
  manualCheckAvailable,
  message,
  rows,
}: {
  action: StaffAccountReceipt["action"] | undefined;
  busy: boolean;
  check: () => void;
  flow: Flow;
  foreignOperation: boolean;
  hidden?: boolean;
  manualCheckAvailable: boolean;
  message: string;
  rows: AccountOperationSummaryRow[];
}) => {
  if (hidden) {
    return null;
  }
  let title = flowTitles[flow];
  if (flow === "retry" && action === "temporary_password_reissued") {
    title = "上次重發結果未確認";
  }
  if (foreignOperation) {
    title = "請用原職員帳戶繼續";
  }
  const previousResultAction =
    flow === "unknown" && manualCheckAvailable && !foreignOperation ? (
      <div className="flex flex-col gap-2">
        <p className="text-meta">只查結果，不會發出密碼。</p>
        <Button
          className="self-start"
          disabled={busy}
          type="button"
          variant="secondary"
          onClick={check}
        >
          重新查詢
        </Button>
      </div>
    ) : null;
  const outcome = message ? (
    <AccountOperationOutcome
      busy={busy}
      message={message}
      title={title}
      tone={flowTones[flow]}
      className={flow === "retry" ? "my-0 p-3!" : "my-0"}
    >
      {previousResultAction}
    </AccountOperationOutcome>
  ) : (
    previousResultAction
  );
  return (
    <>
      {rows.length > 0 ? (
        <AccountOperationSummary className="mt-0" rows={rows} />
      ) : null}
      {outcome}
    </>
  );
};
const StaffAccountTaskHeading = ({
  dirty,
  handoverAction,
  onDiscard,
  recoveryReview,
  returnTo,
  resultTitle,
  retrying,
  reviewing,
  task,
}: {
  dirty: boolean;
  handoverAction: StaffAccountReceipt["action"] | undefined;
  onDiscard: (() => boolean) | (() => void);
  recoveryReview: RecoveryReview | null;
  returnTo: StaffAccountsTaskContext["returnTo"];
  resultTitle: string | null;
  retrying: boolean;
  reviewing: boolean;
  task: StaffAccountsTaskContext["task"];
}) => {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const showingResult = resultTitle !== null;
  const showIntroduction = !handoverAction && !showingResult;
  useEffect(() => {
    if (showingResult) {
      headingRef.current?.focus();
    }
  }, [showingResult]);
  const recoveryReviewAction = recoveryReview?.action;
  const retryingReissue =
    task === "recovery" &&
    retrying &&
    recoveryReviewAction === "temporary_password_reissued";
  let recoveryIntroduction = recoveryReviewAction
    ? "身份核實已完成。"
    : "本人身份核實後，再選擇需要的操作。";
  let title = task === "create" ? "建立帳戶" : "帳戶復原";
  if (task === "create" && reviewing) {
    title = "檢查新帳戶";
  }
  if (task === "recovery" && recoveryReviewAction) {
    title =
      recoveryReviewAction === "staff_password_reset"
        ? "檢查重設密碼"
        : "檢查重新發出";
  }
  if (retryingReissue) {
    title = "重試重發臨時密碼";
    recoveryIntroduction = "";
  }
  if (handoverAction) {
    title = handoverTitles[handoverAction];
  }
  if (resultTitle) {
    title = resultTitle;
  }
  let introduction = recoveryIntroduction;
  if (task === "create") {
    introduction = reviewing
      ? "核對資料並確認批准會籍後才建立。"
      : "協助已核實身份的人開始使用。";
  }
  return (
    <>
      <header className="flex flex-wrap items-center gap-3">
        <UnsavedChangesLink
          className="text-primary inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg focus-visible:outline-2"
          description="放棄變更會清除未提交的帳戶資料；已提交操作的查核記錄會保留。"
          href={returnTo.href}
          isDirty={dirty}
          onDiscard={onDiscard}
        >
          <Icon className="size-5" name="arrow-left" />
          <span className="sr-only">{returnTo.label}</span>
        </UnsavedChangesLink>
        <h1
          className="text-task"
          ref={headingRef}
          tabIndex={showingResult ? -1 : undefined}
        >
          {title}
        </h1>
      </header>
      {showIntroduction ? <p hidden={!introduction}>{introduction}</p> : null}
    </>
  );
};

const StaffAccountConfirmationPhase = ({
  actorName,
  actorUserId,
  actorUsername,
  confirmationContext,
  confirmationExpiresAt,
  onClose,
  onConfirmed,
  visible,
}: {
  actorName: string | undefined;
  actorUserId: string;
  actorUsername: string | null | undefined;
  confirmationContext: AccountOperationSummaryRow[];
  confirmationExpiresAt: number | null;
  onClose: () => void;
  onConfirmed: (expiresAt: number | null) => void;
  visible: boolean;
}) =>
  visible ? (
    <AccountSecurityForm
      actorName={actorName}
      actorUserId={actorUserId}
      actorUsername={actorUsername}
      confirmationContext={confirmationContext}
      confirmationExpiresAt={confirmationExpiresAt}
      confirmationOnly
      onConfirmationClose={onClose}
      onConfirmedInWork={onConfirmed}
      task="confirm"
      temporaryPasswordExpired={false}
      temporaryPasswordExpiresAt={null}
    />
  ) : null;

const staffAccountConfirmationContext = (
  creationReview: CreationReview | null,
  recoveryReview: RecoveryReview | null,
  target: ManagedAccount | undefined
): AccountOperationSummaryRow[] => {
  if (creationReview) {
    return [
      { label: "工作", value: "協助建立已批准帳戶" },
      {
        label: "對象",
        value: `${creationReview.fullName}（${creationReview.username}）`,
      },
    ];
  }
  if (recoveryReview) {
    return [
      { label: "工作", value: recoveryActionLabels[recoveryReview.action] },
      {
        label: "對象",
        value: target
          ? `${target.fullName}（${staffAccountIdentifier(target)}）`
          : recoveryReview.targetUserId,
      },
    ];
  }
  return [];
};

const StaffAccountOriginalDetails = ({
  actorUserId,
  hidden,
  operation,
}: {
  actorUserId: string;
  hidden: boolean;
  operation: Operation | null;
}) => {
  if (hidden || !operation || operation.actorUserId !== actorUserId) {
    return null;
  }
  return (
    <AccountOperationDetails
      rows={[
        { label: "原操作編號", value: operation.key },
        { label: "原登入職員", value: operation.actorUserId },
        { label: "原對象帳戶", value: operation.targetUserId ?? "建立新帳戶" },
        { label: "原操作", value: operation.action },
      ]}
    />
  );
};

const StaffRecoveryTargetSwitch = ({
  context,
  dirty,
  flow,
  onDiscard,
  operation,
  target,
}: {
  context: StaffAccountsTaskContext;
  dirty: boolean;
  flow: Flow;
  onDiscard: () => void;
  operation: Operation | null;
  target: ManagedAccount | undefined;
}) => {
  if (!target || context.task !== "recovery") {
    return null;
  }
  return (
    <AccountTargetSwitch
      disabled={flow !== "ready" || operation !== null}
      isDirty={dirty}
      returnHref={context.returnTo.href}
      onDiscard={onDiscard}
    />
  );
};

const useStaffAccountHandover = (actorUserId: string) => {
  const [handoverState, setHandoverState] =
    useState<StaffAccountHandover | null>(null);
  const handoverGenerationRef = useRef(0);
  const authContextMarkerRef = useRef<string | null>(null);
  const authContextListenerReadyRef = useRef(false);
  const handoverStateRef = useRef(handoverState);
  handoverStateRef.current = handoverState;

  const discardIssuedCredential = useCallback(() => {
    handoverGenerationRef.current += 1;
    flushSync(() =>
      setHandoverState((current) => {
        if (!current || current.issuance === null) {
          return current;
        }
        return { ...current, issuance: null };
      })
    );
  }, []);

  const syncAuthContextMarker = useCallback(
    (marker: string | null) => {
      const previousMarker = authContextMarkerRef.current;
      if (previousMarker === marker) {
        return;
      }
      authContextMarkerRef.current = marker;
      if (previousMarker !== null || handoverStateRef.current?.issuance) {
        discardIssuedCredential();
      }
    },
    [discardIssuedCredential]
  );

  useEffect(() => {
    if (handoverState && handoverState.actorUserId !== actorUserId) {
      handoverGenerationRef.current += 1;
      setHandoverState(null);
    }
  }, [actorUserId, handoverState]);

  useEffect(() => {
    syncAuthContextMarker(readAuthContextMarker());
    const candidate = Reflect.get(window, "cookieStore");
    const cookieStore =
      candidate !== null &&
      typeof candidate === "object" &&
      "addEventListener" in candidate &&
      typeof candidate.addEventListener === "function" &&
      "removeEventListener" in candidate &&
      typeof candidate.removeEventListener === "function"
        ? (candidate as EventTarget)
        : null;
    if (!cookieStore) {
      return;
    }
    const authContextChanged = (event: Event) => {
      const cookieEvent = event as Event & {
        changed?: { name?: string }[];
        deleted?: { name?: string }[];
      };
      if (
        !cookieEvent.changed?.some(
          (cookie) => cookie.name === authContextCookieName
        ) &&
        !cookieEvent.deleted?.some(
          (cookie) => cookie.name === authContextCookieName
        )
      ) {
        return;
      }
      syncAuthContextMarker(readAuthContextMarker());
    };
    cookieStore.addEventListener("change", authContextChanged);
    // Close the read/listener race without polling or treating same-generation events as transitions.
    syncAuthContextMarker(readAuthContextMarker());
    authContextListenerReadyRef.current = true;
    return () => {
      authContextListenerReadyRef.current = false;
      cookieStore.removeEventListener("change", authContextChanged);
    };
  }, [syncAuthContextMarker]);

  const hidePassword = useCallback(() => {
    if (document.hidden) {
      discardIssuedCredential();
    }
  }, [discardIssuedCredential]);

  useEffect(() => {
    document.addEventListener("visibilitychange", hidePassword);
    return () => {
      handoverGenerationRef.current += 1;
      document.removeEventListener("visibilitychange", hidePassword);
    };
  }, [hidePassword]);

  return {
    authContextListenerReadyRef,
    authContextMarkerRef,
    discardIssuedCredential,
    handoverGenerationRef,
    handoverState,
    setHandoverState,
    syncAuthContextMarker,
  };
};

const currentStaffAccountHandover = (
  handoverState: StaffAccountHandover | null,
  operation: Operation | null,
  actorUserId: string
) => {
  const handover =
    handoverState?.actorUserId === actorUserId &&
    operation?.actorUserId === actorUserId
      ? handoverState
      : null;
  return {
    handover,
    issuance: handover?.issuance ?? null,
    receipt: handover?.receipt ?? null,
  };
};

const staffAccountResultPresentation = (
  showingResult: boolean,
  operation: Operation | null,
  actorUserId: string,
  accounts: ManagedAccount[]
) => {
  const foreignOperation =
    operation !== null && operation.actorUserId !== actorUserId;
  const action = foreignOperation ? undefined : operation?.action;
  let title: string | null = null;
  const rows: AccountOperationSummaryRow[] = [];
  if (showingResult) {
    title = action ? resultTitles[action] : "確認帳戶操作結果";
    if (action) {
      rows.push({
        label: "操作",
        value:
          action === "assisted_account_created"
            ? "建立帳戶及發出臨時密碼"
            : recoveryActionLabels[action],
      });
      if (action === "assisted_account_created") {
        rows.push({
          label: "對象",
          value: "新帳戶（操作紀錄不保留姓名及聯絡資料）",
        });
      } else {
        const target = accounts.find(
          (account) => account.userId === operation?.targetUserId
        );
        rows.push({
          label: "對象",
          value: target
            ? `${target.fullName}（${staffAccountIdentifier(target)}）`
            : "原操作的帳戶",
        });
      }
    }
  }
  return { foreignOperation, rows, title };
};

export const StaffAccountsForm = ({
  accounts,
  context,
}: {
  accounts: ManagedAccount[];
  context: StaffAccountsTaskContext;
}) => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const actorUserId = context.actor.userId;
  const actorName = context.actor.identity?.actorName;
  const actorUsername = context.actor.identity?.actorUsername;
  const confirmationExpiresAt =
    context.actor.identity?.confirmationExpiresAt ?? null;
  const { targetUserId } = context;
  const [flow, setFlow] = useState<Flow>("restoring");
  const [message, setMessage] = useState("正在查核未確認的操作。");
  const [operation, setOperation] = useState<Operation | null>(null);
  const [completionFailed, setCompletionFailed] = useState(false);
  const [manualCheckAvailable, setManualCheckAvailable] = useState(false);
  const {
    authContextListenerReadyRef,
    authContextMarkerRef,
    discardIssuedCredential,
    handoverGenerationRef,
    handoverState,
    setHandoverState,
    syncAuthContextMarker,
  } = useStaffAccountHandover(actorUserId);
  const [creationReview, setCreationReview] = useState<CreationReview | null>(
    null
  );
  const [recoveryReview, setRecoveryReview] = useState<RecoveryReview | null>(
    null
  );
  const [recoveryAction, setRecoveryAction] = useState<RecoveryAction>(
    "staff_password_reset"
  );
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [confirmedUntil, setConfirmedUntil] = useState<number | null>(
    confirmationExpiresAt
  );
  const busyRef = useRef(false);
  const operationRef = useRef<Operation | null>(null);
  const recoveryFormRef = useRef<HTMLFormElement>(null);
  const recoveryForm = useAppForm({
    ...recoveryFormOptions,
    defaultValues: {
      ...emptyRecoveryDraft,
      targetUserId: targetUserId ?? "",
    },
  });
  const recoveryTargetId = useSelector(
    recoveryForm.store,
    (state) => state.values.targetUserId
  );
  const recoveryDirty =
    useSelector(recoveryForm.store, (state) => state.isDirty) ||
    recoveryReview !== null;
  const busy =
    flow === "restoring" || flow === "submitting" || flow === "checking";
  const target = accounts.find(
    (account) => account.userId === recoveryTargetId
  );
  const confirmationIsFresh =
    confirmedUntil !== null && confirmedUntil > Math.floor(Date.now() / 1000);
  const { handover, issuance, receipt } = currentStaffAccountHandover(
    handoverState,
    operation,
    actorUserId
  );

  const reconcile = useCallback(
    async (saved: Operation): Promise<"confirmed" | "missing" | "unknown"> => {
      const preserveUnsubmittedRecovery =
        recoveryForm.state.isDirty && operationRef.current?.key !== saved.key;
      operationRef.current = saved;
      setManualCheckAvailable(false);
      setOperation(saved);
      setHandoverState(null);
      setCreationReview(null);
      setRecoveryReview(null);
      if (!preserveUnsubmittedRecovery) {
        recoveryForm.reset({
          identityCheck: saved.identityCheck ?? "face_to_face",
          targetUserId: targetUserId ?? saved.targetUserId ?? "",
          verified: recoveryForm.state.values.verified,
        });
      }
      if (saved.actorUserId !== actorUserId) {
        setFlow("unknown");
        setMessage(
          "此瀏覽器有另一職員尚未確認的操作。請以原職員帳戶登入後繼續；現有操作會保留。"
        );
        return "unknown";
      }
      setFlow("checking");
      setMessage("正在向伺服器查核；暫時不要開始另一項操作。");
      let reconciliation: StaffReconciliationOutcome;
      try {
        reconciliation = await readTransientReconciliation(
          queryClient,
          staffReconciliationQueryKey,
          async ({ signal }) => {
            const response =
              await businessRpc.api.v2.staff.accounts.reconcile.$post(
                { json: { operationKey: saved.key } },
                {
                  headers: { "x-efcc-expected-actor-id": actorUserId },
                  init: {
                    cache: "no-store",
                    credentials: "same-origin",
                    signal,
                  },
                }
              );
            // Read the body for every status so no response is left unread.
            const body: unknown = await response.json().catch(() => null);
            if (response.status !== 200) {
              return { kind: "unverified" } as const;
            }
            const result = staffAccountResponseSchema.safeParse(body);
            if (!result.success) {
              return { kind: "unverified" } as const;
            }
            return result.data.data.receipt
              ? ({
                  kind: "confirmed",
                  receipt: result.data.data.receipt,
                } as const)
              : ({ kind: "not-found" } as const);
          }
        );
      } catch {
        setFlow("unknown");
        setMessage("連線失敗，結果仍未確認。連線恢復後會自動查詢。");
        return "unknown";
      }
      if (
        reconciliation.kind === "unverified" ||
        (reconciliation.kind === "confirmed" &&
          !staffReceiptMatchesOperation(reconciliation.receipt, saved))
      ) {
        setFlow("unknown");
        setManualCheckAvailable(true);
        setMessage(
          "暫時未能查核或管理權限已失效，結果仍未確認。請以原職員帳戶重新登入後再次查核。"
        );
        return "unknown";
      }
      if (reconciliation.kind === "confirmed") {
        settleSessionDraft("creation", saved.key, true);
        setHandoverState(
          staffAccountHandoverFromOperation(
            saved,
            null,
            reconciliation.receipt,
            null,
            null
          )
        );
        setFlow("confirmed");
        setMessage(
          "伺服器已確認操作完成。原臨時密碼不能再次讀取；未完成交接時，請完成此操作後明確重新發出另一個臨時密碼。"
        );
        router.refresh();
        return "confirmed";
      }
      if (
        saved.action !== "assisted_account_created" &&
        saved.targetUserId !== null
      ) {
        setRecoveryAction(saved.action);
      }
      setFlow("retry");
      setMessage(
        saved.action === "temporary_password_reissued"
          ? "你上次要求重發臨時密碼。系統已自動查詢，暫未找到完成紀錄；核對資料後可重試。"
          : "尚未找到完成紀錄，不能當作已成功。請核對原對象與操作後重試；表格及密碼不會保存在此瀏覽器。"
      );
      return "missing";
    },
    [actorUserId, queryClient, recoveryForm, router, targetUserId]
  );
  const check = useCallback(
    async (allowManualFallback = true) => {
      if (busyRef.current) {
        return;
      }
      busyRef.current = true;
      try {
        const saved = readOperation();
        if (saved) {
          const result = await reconcile(saved);
          if (allowManualFallback && result === "unknown") {
            setManualCheckAvailable(true);
          }
        } else {
          operationRef.current = null;
          setOperation(null);
          setCreationReview(null);
          setRecoveryReview(null);
          setFlow("ready");
          setMessage("");
        }
      } catch {
        setManualCheckAvailable(true);
        setFlow("unknown");
        setMessage(
          "無法讀取操作代碼，請恢復瀏覽器儲存後再次查核；未有提交新操作。"
        );
      } finally {
        busyRef.current = false;
      }
    },
    [reconcile]
  );
  useEffect(() => {
    // The first network failure waits for reconnect before offering manual retry.
    void check(false);
  }, [check]);
  useEffect(() => {
    if (flow !== "unknown" || operation?.actorUserId !== actorUserId) {
      return;
    }
    const recheckOnReconnect = () => {
      void check();
    };
    window.addEventListener("online", recheckOnReconnect);
    return () => {
      window.removeEventListener("online", recheckOnReconnect);
    };
  }, [actorUserId, check, flow, operation]);
  const pendingChanged = (
    saved: Operation,
    action: Action,
    submittedIdentityCheck: IdentityCheck | undefined,
    operationTarget: string | null
  ) =>
    saved.key !== operationRef.current?.key ||
    saved.action !== action ||
    saved.actorUserId !== actorUserId ||
    (saved.targetUserId !== null && saved.targetUserId !== operationTarget) ||
    (saved.identityCheck !== undefined &&
      saved.identityCheck !== submittedIdentityCheck);
  const requestedConfirmation = () => {
    setMessage(
      "請先確認目前登入密碼；完成後會返回同一份核對資料，再明確提交。"
    );
    setConfirmationOpen(true);
  };
  const recoverAfterConfirmationRequired = async (
    next: Operation,
    errorMessage: string,
    restoreReview: () => void
  ) => {
    if ((await reconcile(next)) !== "missing") {
      return;
    }
    settleSessionDraft("creation", next.key, false);
    localStorage.removeItem(storageKey);
    operationRef.current = null;
    setOperation(null);
    setFlow("ready");
    setMessage(errorMessage);
    restoreReview();
    setConfirmationOpen(true);
  };
  const reviewInputs = useRef<StaffCreationInput | null>(null);
  const restoreReviewFor = (
    action: Action,
    selectedIdentityCheck: IdentityCheck | undefined
  ) => {
    if (action === "assisted_account_created") {
      if (reviewInputs.current) {
        setCreationReview(creationReviewFromInput(reviewInputs.current));
      }
      return;
    }
    if (selectedIdentityCheck) {
      recoveryForm.setFieldValue("identityCheck", selectedIdentityCheck);
      setRecoveryReview({
        action,
        identityCheck: selectedIdentityCheck,
        targetUserId: recoveryForm.state.values.targetUserId,
      });
    }
  };
  const submission = useMutation({
    gcTime: 0,
    mutationFn: (command: StaffCommand) =>
      sendStaffCommand(command, syncAuthContextMarker),
    networkMode: "always",
    retry: false,
  });
  const stopBeforeSubmission = async (
    saved: Operation | null,
    action: Action,
    submittedIdentityCheck: IdentityCheck | undefined,
    operationTarget: string | null
  ) => {
    if (
      (saved &&
        pendingChanged(
          saved,
          action,
          submittedIdentityCheck,
          operationTarget
        )) ||
      !authContextListenerReadyRef.current
    ) {
      if (saved) {
        await reconcile(saved);
      } else {
        setFlow("ready");
        setMessage(
          "此瀏覽器未能安全監察登入狀態，操作未有送出。請更新瀏覽器後重試。"
        );
      }
      return true;
    }
    return false;
  };

  const runOperation = async (submissionRequest: {
    action: Action;
    handoverIdentity: StaffHandoverIdentity | null;
    operationTarget: string | null;
    request: (pending: Operation) => object;
    resetInputs: () => void;
    submittedIdentityCheck: IdentityCheck | undefined;
  }) => {
    const { action, operationTarget, submittedIdentityCheck } =
      submissionRequest;
    const handoverGeneration = handoverGenerationRef.current;
    setCreationReview(null);
    setRecoveryReview(null);
    busyRef.current = true;
    setHandoverState(null);
    try {
      await navigator.locks.request(storageKey, async () => {
        const saved = readOperation();
        if (
          await stopBeforeSubmission(
            saved,
            action,
            submittedIdentityCheck,
            operationTarget
          )
        ) {
          return;
        }
        const fresh = saved === null;
        const next: Operation = saved ?? {
          action,
          actorUserId,
          key: crypto.randomUUID(),
          ...(submittedIdentityCheck
            ? { identityCheck: submittedIdentityCheck }
            : {}),
          targetUserId: operationTarget,
        };
        localStorage.setItem(storageKey, JSON.stringify(next));
        if (readOperation()?.key !== next.key) {
          throw new Error("Operation metadata was not persisted");
        }
        if (action === "assisted_account_created") {
          // eslint-disable-next-line no-use-before-define -- The form's submit callback reaches this command only after its draft hook is initialized.
          creationDraftRecovery.linkSubmission(next.key);
        }
        operationRef.current = next;
        setOperation(next);
        setFlow("submitting");
        setMessage("正在提交，請勿重複按下提交。");
        let outcome: StaffSubmitOutcome;
        try {
          outcome = await submission.mutateAsync({
            action,
            actorUserId,
            body: submissionRequest.request(next),
          });
        } catch {
          outcome = { kind: "unknown" };
        } finally {
          submission.reset();
        }
        if (outcome.kind === "confirmation-required") {
          await recoverAfterConfirmationRequired(next, outcome.message, () =>
            restoreReviewFor(action, submittedIdentityCheck)
          );
          return;
        }
        if (
          outcome.kind === "confirmed" &&
          staffReceiptMatchesOperation(outcome.receipt, next)
        ) {
          settleSessionDraft("creation", next.key, true);
          submissionRequest.resetInputs();
          const currentAuthContextMarker = readAuthContextMarker();
          syncAuthContextMarker(currentAuthContextMarker);
          const originalIssuance =
            outcome.status === 201 &&
            authContextListenerReadyRef.current &&
            handoverGeneration === handoverGenerationRef.current &&
            outcome.authContextMarker === authContextMarkerRef.current &&
            currentAuthContextMarker === outcome.authContextMarker &&
            !document.hidden
              ? outcome.issuance
              : null;
          setHandoverState(
            staffAccountHandoverFromOperation(
              next,
              originalIssuance ? submissionRequest.handoverIdentity : null,
              outcome.receipt,
              originalIssuance,
              outcome.authContextMarker
            )
          );
          setFlow("confirmed");
          setMessage(
            "伺服器已確認操作完成；請私下交接新臨時密碼。離開或隱藏此頁後不能再次讀取，遺失時必須明確重新發出。"
          );
          return;
        }
        if (fresh && outcome.kind === "invalid") {
          settleSessionDraft("creation", next.key, false);
          localStorage.removeItem(storageKey);
          operationRef.current = null;
          setOperation(null);
          setFlow("ready");
          setMessage("資料未獲接受，未有完成操作；請檢查欄位及核實方式。");
          return;
        }
        submissionRequest.resetInputs();
        await reconcile(next);
      });
    } catch {
      setManualCheckAvailable(true);
      setFlow("unknown");
      setMessage(
        "未能安全讀寫操作代碼或取得瀏覽器鎖，未有確認結果；請恢復本機儲存後再次查核。"
      );
    } finally {
      busyRef.current = false;
    }
  };
  const submitCreation = async (
    draft: StaffCreationValues,
    resetForm: () => void
  ): Promise<void> => {
    if (busyRef.current || (flow !== "ready" && flow !== "retry")) {
      return;
    }
    const parsed = staffCreationFormSchema.safeParse(draft);
    if (!parsed.success) {
      setMessage("請檢查帳戶資料；未通過檢查前不會提交。");
      return;
    }
    if (creationReview === null) {
      reviewInputs.current = parsed.data;
      setCreationReview(creationReviewFromInput(parsed.data));
      return;
    }
    if (!confirmationIsFresh) {
      requestedConfirmation();
      return;
    }
    const reviewedInput = reviewInputs.current;
    if (!reviewedInput) {
      return;
    }
    await runOperation({
      action: "assisted_account_created",
      handoverIdentity: {
        fullName: reviewedInput.fullName,
        username: reviewedInput.username,
      },
      operationTarget: null,
      request: (pending) => ({
        ...reviewedInput,
        identityCheck: "face_to_face",
        operationKey: pending.key,
      }),
      resetInputs: () => {
        resetForm();
        setCreationReview(null);
      },
      submittedIdentityCheck: undefined,
    });
  };
  const submitRecovery = async (
    action: RecoveryAction,
    values: StaffRecoveryValues
  ) => {
    if (busyRef.current || (flow !== "ready" && flow !== "retry")) {
      return;
    }
    const parsed = staffRecoveryFormSchema.safeParse(values);
    if (!parsed.success) {
      setMessage("請重新選擇有效的身分核實方式，並確認已按此方式核實身分。");
      return;
    }
    const {
      identityCheck: submittedIdentityCheck,
      targetUserId: submittedTargetId,
    } = parsed.data;
    if (recoveryReview === null) {
      setRecoveryReview({
        action,
        identityCheck: submittedIdentityCheck,
        targetUserId: submittedTargetId,
      });
      return;
    }
    if (!confirmationIsFresh) {
      requestedConfirmation();
      return;
    }
    const reviewedTarget = accounts.find(
      (account) => account.userId === recoveryReview.targetUserId
    );
    await runOperation({
      action: recoveryReview.action,
      handoverIdentity: reviewedTarget
        ? {
            fullName: reviewedTarget.fullName,
            username: staffAccountIdentifier(reviewedTarget),
          }
        : null,
      operationTarget: recoveryReview.targetUserId,
      request: (pending) => ({
        identityCheck: recoveryReview.identityCheck,
        operationKey: pending.key,
        targetUserId: recoveryReview.targetUserId,
      }),
      resetInputs: () => {
        recoveryForm.reset({
          ...recoveryForm.state.values,
          verified: false,
        });
        setRecoveryReview(null);
      },
      submittedIdentityCheck: recoveryReview.identityCheck,
    });
  };
  const submitRecoveryForm = (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const { submitter } = event.nativeEvent;
    const parsedAction = staffAccountActionSchema.safeParse(
      submitter instanceof HTMLButtonElement ? submitter.value : null
    );
    if (
      !parsedAction.success ||
      parsedAction.data === "assisted_account_created"
    ) {
      return;
    }
    void submitRecovery(parsedAction.data, recoveryForm.state.values);
  };
  const creationForm = useAppForm({
    ...creationFormOptions,
    onSubmit: async ({ formApi, value }) => {
      await submitCreation(value, () => formApi.reset());
    },
  });
  const creationDirty = useSelector(
    creationForm.store,
    (state) => state.isDirty
  );
  const creationDraftRecovery = useSessionDraftRecovery({
    actorUserId,
    baseline: { contact: null, status: null },
    busy,
    denied: false,
    dirty: creationDirty,
    enabled: context.task === "create",
    flow: "creation",
    onAuthorityLost: () => {
      creationForm.reset();
      setCreationReview(null);
      setConfirmedUntil(null);
      router.refresh();
    },
    onRestore: (values) => {
      creationForm.setFieldValue("fullName", values.fullName);
      creationForm.setFieldValue("username", values.username ?? "");
      creationForm.setFieldValue("email", values.email);
      creationForm.setFieldValue("phone", values.phone);
      creationForm.setFieldValue("sharedPhone", values.sharedPhone ?? false);
      creationForm.setFieldValue("verified", false);
      setCreationReview(null);
      setConfirmedUntil(null);
    },
    operation,
    state: flow,
    targetId: "new",
    values: useSelector(creationForm.store, (state) => state.values),
  });

  const preserveDraft =
    (creationDraftRecovery.dirty || recoveryDirty) && issuance === null;
  const finish = async (destination?: string) => {
    setCompletionFailed(false);
    if (
      flow !== "confirmed" ||
      busyRef.current ||
      operationRef.current?.actorUserId !== actorUserId
    ) {
      return;
    }
    busyRef.current = true;
    try {
      await navigator.locks.request(storageKey, async () => {
        const saved = readOperation();
        if (saved && saved.key !== operationRef.current?.key) {
          await reconcile(saved);
          return;
        }
        if (!preserveDraft && !creationDraftRecovery.clear()) {
          setCompletionFailed(true);
          setMessage("未能清除暫存草稿；請恢復瀏覽器儲存後重試。");
          return;
        }
        localStorage.removeItem(storageKey);
        operationRef.current = null;
        setOperation(null);
        setHandoverState(null);
        setCreationReview(null);
        setRecoveryReview(null);
        setConfirmationOpen(false);
        setFlow("ready");
        setMessage("");
        if (preserveDraft) {
          // A completed receipt does not submit this page's unsent draft.
          return;
        }
        creationForm.reset();
        recoveryForm.reset({
          identityCheck: "face_to_face",
          targetUserId: targetUserId ?? "",
          verified: false,
        });
        if (destination) {
          router.push(destination);
        } else {
          router.refresh();
        }
      });
    } catch {
      setCompletionFailed(true);
      setMessage("未能清除操作代碼，請恢復本機儲存後重試。");
    } finally {
      busyRef.current = false;
    }
  };
  const dirty = creationDraftRecovery.dirty || recoveryDirty;
  const disabled = (action: Action) =>
    busy ||
    (action === "assisted_account_created" && creationDraftRecovery.blocked) ||
    (action !== "assisted_account_created" &&
      !target &&
      !(
        flow === "retry" &&
        operation?.targetUserId === recoveryTargetId &&
        operation.actorUserId === actorUserId
      )) ||
    (flow !== "ready" &&
      !(
        flow === "retry" &&
        operation?.action === action &&
        operation.actorUserId === actorUserId &&
        operation.targetUserId ===
          (action === "assisted_account_created" ? null : recoveryTargetId)
      ));
  const resetDisabled = disabled("staff_password_reset");
  const reissueDisabled = disabled("temporary_password_reissued");
  const recoveryDisabled = resetDisabled && reissueDisabled;
  const activeTask = operation ? actionTasks[operation.action] : context.task;
  const showingResult = [
    "restoring",
    "submitting",
    "checking",
    "unknown",
  ].includes(flow);
  const result = staffAccountResultPresentation(
    showingResult,
    operation,
    actorUserId,
    accounts
  );
  const copyPassword = async () => {
    if (!issuance) {
      return;
    }
    const currentMarker = readAuthContextMarker();
    if (
      !authContextListenerReadyRef.current ||
      handover?.authContextMarker === null ||
      handover?.authContextMarker !== currentMarker ||
      authContextMarkerRef.current !== currentMarker
    ) {
      if (authContextMarkerRef.current === currentMarker) {
        discardIssuedCredential();
      } else {
        syncAuthContextMarker(currentMarker);
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(issuance.temporaryPassword);
      return "copied" as const;
    } catch {
      return "failed" as const;
    }
  };
  const reissueLostHandover = async () => {
    if (!receipt || issuance !== null) {
      return;
    }
    const query = new URLSearchParams({
      person: receipt.targetUserId,
      task: "recovery",
      view: "people",
    });
    await finish(`/staff/accounts?${query.toString()}`);
  };
  const confirmRecoveryReview = () => {
    const form = recoveryFormRef.current;
    const action = recoveryReview?.action;
    const submitter = action
      ? form?.querySelector<HTMLButtonElement>(
          `button[name="action"][value="${action}"]`
        )
      : null;
    if (form && submitter) {
      form.requestSubmit(submitter);
    }
  };
  const confirmationContext = staffAccountConfirmationContext(
    creationReview,
    recoveryReview,
    target
  );
  const targetSwitch = (
    <StaffRecoveryTargetSwitch
      context={context}
      dirty={dirty}
      flow={flow}
      operation={operation}
      target={target}
      onDiscard={() => {
        recoveryForm.reset();
        setRecoveryReview(null);
      }}
    />
  );
  let taskContent: React.ReactNode;
  if (handover) {
    taskContent = (
      <StaffAccountHandoverView
        actorUserId={actorUserId}
        completionFailed={completionFailed}
        message={message}
        copyPassword={copyPassword}
        finish={finish}
        handover={handover}
        preserveDraft={preserveDraft}
        reissueLostHandover={reissueLostHandover}
        returnHref={context.returnTo.href}
      />
    );
  } else if (activeTask === "create") {
    taskContent = (
      <AssistedAccountCreationForm
        disabled={disabled("assisted_account_created")}
        form={creationForm}
        onEdit={() => setCreationReview(null)}
        review={creationReview}
      />
    );
  } else {
    taskContent = (
      <>
        <StaffAccountRecoveryForm
          changeTarget={targetSwitch}
          accounts={accounts}
          action={recoveryAction}
          canChangeTarget={flow === "ready"}
          fixedTargetUserId={targetUserId}
          form={recoveryForm}
          formRef={recoveryFormRef}
          hidden={recoveryReview !== null}
          onActionChange={setRecoveryAction}
          onSubmit={submitRecoveryForm}
          recoveryDisabled={recoveryDisabled}
          reissueDisabled={reissueDisabled}
          resetDisabled={resetDisabled}
          target={target}
          targetId={recoveryTargetId}
        />
        {recoveryReview ? (
          <StaffAccountRecoveryReview
            changeTarget={targetSwitch}
            draft={recoveryReview}
            onConfirm={confirmRecoveryReview}
            onEdit={() => setRecoveryReview(null)}
            target={accounts.find(
              (account) => account.userId === recoveryReview.targetUserId
            )}
          />
        ) : null}
      </>
    );
  }
  return (
    <>
      <div className="flex flex-col gap-6">
        <StaffAccountTaskHeading
          dirty={dirty}
          handoverAction={handover?.receipt.action}
          onDiscard={() => {
            if (!creationDraftRecovery.clear()) {
              return false;
            }
            creationForm.reset();
            recoveryForm.reset({
              identityCheck: operation?.identityCheck ?? "face_to_face",
              targetUserId: targetUserId ?? operation?.targetUserId ?? "",
              verified: false,
            });
            setCreationReview(null);
            setRecoveryReview(null);
          }}
          recoveryReview={recoveryReview}
          returnTo={context.returnTo}
          resultTitle={result.title}
          retrying={flow === "retry"}
          reviewing={creationReview !== null}
          task={context.task}
        />
        <StaffAccountOperationStatus
          action={operation?.action}
          hidden={Boolean(handover)}
          busy={busy}
          check={() => {
            void check();
          }}
          flow={flow}
          foreignOperation={result.foreignOperation}
          manualCheckAvailable={manualCheckAvailable}
          message={message}
          rows={result.rows}
        />
        <div className="contents [&[hidden]]:hidden" hidden={showingResult}>
          {creationDraftRecovery.notice}
          {taskContent}
        </div>
        <StaffAccountOriginalDetails
          actorUserId={actorUserId}
          hidden={Boolean(handover)}
          operation={operation}
        />
      </div>
      <StaffAccountConfirmationPhase
        actorName={actorName}
        actorUserId={actorUserId}
        actorUsername={actorUsername}
        confirmationContext={confirmationContext}
        confirmationExpiresAt={confirmedUntil}
        onClose={() => setConfirmationOpen(false)}
        onConfirmed={(expiresAt) => {
          setConfirmedUntil(expiresAt);
          setConfirmationOpen(false);
          setMessage("");
        }}
        visible={confirmationOpen}
      />
    </>
  );
};
