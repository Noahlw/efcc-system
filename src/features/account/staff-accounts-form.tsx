"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import * as z from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UnsavedChangesLink } from "@/components/unsaved-changes-link";
import {
  AccountOperationOutcome,
  AccountOperationSummary,
} from "@/features/account/operation-presentation";
import type { AccountOperationSummaryRow } from "@/features/account/operation-presentation";
import { membershipStatusLabel } from "@/features/identity/labels";
import { formatChurchTimestamp } from "@/shared/time/church-time";

import { postAccountOperation } from "./post-operation";
import { AccountSecurityForm } from "./security-form";
import type { ManagedAccount, StaffAccountReceipt } from "./staff-accounts";

const storageKey = "efcc.staff-account.operation.v1";
const paths = {
  assisted_account_created: "/api/v2/staff/accounts",
  staff_password_reset: "/api/v2/staff/accounts/password-reset",
  temporary_password_reissued: "/api/v2/staff/accounts/password-reissue",
};
type Action = keyof typeof paths;
type RecoveryAction = Exclude<Action, "assisted_account_created">;
type IdentityCheck = "face_to_face" | "verified_phone";
interface Operation {
  key: string;
  actorUserId: string;
  action: Action;
  targetUserId: string | null;
  identityCheck?: IdentityCheck;
}
interface RecoveryReview {
  action: RecoveryAction;
  identityCheck: IdentityCheck;
  targetUserId: string;
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
  email: string;
  fullName: string;
  phone: string;
  sharedPhone: boolean;
  username: string;
}
interface HandoverIdentity {
  fullName: string;
  username: string;
}
const handoverIdentityFor = (
  action: Action,
  status: number,
  temporaryPassword: string | null,
  fields: FormData
): HandoverIdentity | null => {
  if (action !== "assisted_account_created") {
    return null;
  }
  if (status !== 201 || !temporaryPassword) {
    return null;
  }
  return {
    fullName: String(fields.get("fullName") ?? ""),
    username: String(fields.get("username") ?? ""),
  };
};
const flowTitles: Record<Flow, string> = {
  checking: "正在查核操作",
  confirmed: "操作已確認完成",
  ready: "操作狀態",
  restoring: "正在查核操作",
  retry: "未找到完成紀錄",
  submitting: "正在提交操作",
  unknown: "操作結果未確認",
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

const actionSchema = z.enum([
  "assisted_account_created",
  "staff_password_reset",
  "temporary_password_reissued",
]);
const identityCheckSchema = z.enum(["face_to_face", "verified_phone"]);
const opaqueId = z.string().min(1).max(128);
const operationSchema = z
  .strictObject({
    action: actionSchema,
    actorUserId: opaqueId,
    identityCheck: identityCheckSchema.optional(),
    key: z.uuid(),
    targetUserId: opaqueId.nullable(),
  })
  .refine((value) =>
    value.action === "assisted_account_created"
      ? value.targetUserId === null
      : value.targetUserId !== null
  );
const receiptSchema = z.object({
  action: actionSchema,
  createdAt: z.number().int(),
  id: z.uuid(),
  targetUserId: opaqueId,
}) satisfies z.ZodType<StaffAccountReceipt>;
const responseSchema = z.object({
  data: z.object({
    receipt: receiptSchema.nullable(),
    temporaryPassword: z
      .string()
      .regex(/^[\w-]{32}$/u)
      .optional(),
  }),
});
const readOperation = (): Operation | null => {
  const saved = localStorage.getItem(storageKey);
  return saved ? operationSchema.parse(JSON.parse(saved)) : null;
};
const resultData = (body: unknown) => {
  const result = responseSchema.safeParse(body);
  return result.success
    ? {
        receipt: result.data.data.receipt,
        temporaryPassword: result.data.data.temporaryPassword ?? null,
      }
    : undefined;
};
const matchesOperation = (value: StaffAccountReceipt, operation: Operation) =>
  value.action === operation.action &&
  (operation.targetUserId === null ||
    value.targetUserId === operation.targetUserId);
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
      ? `${target.fullName}（${target.username ?? "未設定 Username"}）`
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
const creationReviewFromFields = (fields: FormData): CreationReview => ({
  email: String(fields.get("email") ?? ""),
  fullName: String(fields.get("fullName") ?? ""),
  phone: String(fields.get("phone") ?? ""),
  sharedPhone: fields.get("sharedPhone") === "on",
  username: String(fields.get("username") ?? ""),
});
const recoveryReviewFromFields = (
  action: RecoveryAction,
  fields: FormData,
  targetId: string,
  identityCheck: IdentityCheck
): RecoveryReview => ({
  action,
  identityCheck,
  targetUserId: String(fields.get("targetUserId") ?? targetId),
});
const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
const passwordConfirmationError = (status: number, body: unknown) => {
  const result = apiErrorSchema.safeParse(body);
  return status === 403 &&
    result.success &&
    result.data.error.code === "password_confirmation_required"
    ? result.data.error
    : null;
};

const visiblePanels = (
  mode: "all" | "create" | "recovery",
  operation: Operation | null
) => ({
  create:
    mode !== "recovery" || operation?.action === "assisted_account_created",
  recovery:
    mode !== "create" ||
    (operation !== null && operation.action !== "assisted_account_created"),
});

const StaffAccountHandover = ({
  copyPassword,
  finish,
  handoverIdentity,
  reissueLostHandover,
  password,
  receipt,
}: {
  copyPassword: () => void;
  finish: () => Promise<void>;
  handoverIdentity: HandoverIdentity | null;
  reissueLostHandover: () => Promise<void>;
  password: string | null;
  receipt: StaffAccountReceipt;
}) => (
  <section className="border-border rounded-lg border p-5">
    <h2 className="text-lg font-semibold">交接結果</h2>
    <p className="mt-2 break-words">
      交接對象：
      {handoverIdentity
        ? `${handoverIdentity.fullName}（${handoverIdentity.username}）`
        : receipt.targetUserId}
    </p>
    <p className="text-muted-foreground mt-1 text-sm break-words">
      操作查核編號：{receipt.id}
    </p>
    <p className="mt-2">
      發出時間：{formatChurchTimestamp(receipt.createdAt * 1000)}（香港）
    </p>
    {password ? (
      <>
        <p className="mt-3">新臨時密碼（只顯示一次）：</p>
        <output
          className="mt-2 block font-mono break-all"
          aria-label="新臨時密碼"
        >
          {password}
        </output>
        <Button type="button" className="mt-3" onClick={copyPassword}>
          複製臨時密碼
        </Button>
        <p className="mt-3">
          七日後到期，首次登入必須更改。請按已核實的身分／教會原有可靠聯絡途徑，手動透過
          WhatsApp 私下交接；不要使用新提供的聯絡資料作復原憑證。
        </p>
      </>
    ) : (
      <>
        <p className="mt-3">
          原臨時密碼不能再次讀取。請先查核目前仍可管理的目標帳戶，再重新核實當事人；只有完成核實並再次確認後，才可發出新的臨時密碼。
        </p>
        <Button type="button" className="mt-3" onClick={reissueLostHandover}>
          重新核實並發出新臨時密碼
        </Button>
      </>
    )}
    <Button type="button" onClick={() => finish()} className="mt-4">
      完成，開始另一項操作
    </Button>
  </section>
);

const AssistedAccountCreationForm = ({
  disabled,
  formRef,
  hidden,
  onChange,
  onSubmit,
}: {
  disabled: boolean;
  formRef: React.Ref<HTMLFormElement>;
  hidden: boolean;
  onChange: () => void;
  onSubmit: (event: React.SubmitEvent<HTMLFormElement>) => void;
}) => (
  <form
    hidden={hidden}
    ref={formRef}
    onChange={onChange}
    onSubmit={onSubmit}
    className="border-border rounded-lg border p-5"
  >
    <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-3">
      <legend className="text-lg font-semibold">協助建立已批准帳戶</legend>
      <label htmlFor="assisted-name">中文全名</label>
      <Input
        id="assisted-name"
        name="fullName"
        autoComplete="name"
        maxLength={200}
        required
      />
      <label htmlFor="assisted-username">使用者名稱</label>
      <Input
        id="assisted-username"
        name="username"
        autoComplete="off"
        minLength={3}
        maxLength={30}
        pattern="[A-Za-z0-9_.]{3,30}"
        required
      />
      <label htmlFor="assisted-email">電郵（沒有電郵可留空）</label>
      <Input
        id="assisted-email"
        name="email"
        type="email"
        autoComplete="email"
        maxLength={254}
      />
      <label htmlFor="assisted-phone">電話</label>
      <Input
        id="assisted-phone"
        name="phone"
        type="tel"
        autoComplete="tel"
        maxLength={40}
        required
      />
      <label className="flex min-h-11 items-center gap-3">
        <input type="checkbox" name="sharedPhone" className="h-5 w-5" />
        已親身核實共用電話例外
      </label>
      <label className="flex min-h-11 items-center gap-3">
        <input type="checkbox" required className="h-5 w-5" />
        已親身核實此人的身分
      </label>
      <Button type="submit" name="action" value="assisted_account_created">
        檢查帳戶資料
      </Button>
    </fieldset>
  </form>
);

const AssistedAccountCreationReview = ({
  draft,
  onConfirm,
  onEdit,
}: {
  draft: CreationReview;
  onConfirm: () => void;
  onEdit: () => void;
}) => (
  <section className="border-border rounded-lg border p-5">
    <h2 className="text-lg font-semibold">確認帳戶資料</h2>
    <AccountOperationSummary rows={creationReviewRows(draft)} />
    <div className="mt-4 flex flex-col gap-3 sm:flex-row">
      <Button type="button" variant="secondary" onClick={onEdit}>
        返回修改
      </Button>
      <Button type="button" onClick={onConfirm}>
        確認並建立帳戶及發出臨時密碼
      </Button>
    </div>
  </section>
);

const StaffAccountRecoveryReview = ({
  draft,
  onConfirm,
  onEdit,
  target,
}: {
  draft: RecoveryReview;
  onConfirm: () => void;
  onEdit: () => void;
  target: ManagedAccount | undefined;
}) => (
  <section className="border-border rounded-lg border p-5">
    <h2 className="text-lg font-semibold">核對帳戶操作</h2>
    <AccountOperationSummary rows={recoveryReviewRows(draft, target)} />
    <div className="mt-4 flex flex-col gap-3 sm:flex-row">
      <Button type="button" variant="secondary" onClick={onEdit}>
        返回修改
      </Button>
      <Button type="button" onClick={onConfirm}>
        確認並{recoveryActionLabels[draft.action]}
      </Button>
    </div>
  </section>
);

const StaffAccountRecoveryForm = ({
  accounts,
  disabled,
  formRef,
  flow,
  hidden,
  identityCheck,
  onIdentityCheckChange,
  onChange,
  onSubmit,
  onTargetChange,
  recoveryDisabled,
  target,
  targetId,
  targetUserId,
}: {
  accounts: ManagedAccount[];
  disabled: (action: Action) => boolean;
  formRef: React.Ref<HTMLFormElement>;
  flow: Flow;
  hidden: boolean;
  identityCheck: IdentityCheck;
  onIdentityCheckChange: (identityCheck: IdentityCheck) => void;
  onChange: () => void;
  onSubmit: (event: React.SubmitEvent<HTMLFormElement>) => void;
  onTargetChange: (targetId: string) => void;
  recoveryDisabled: boolean;
  target: ManagedAccount | undefined;
  targetId: string;
  targetUserId?: string;
}) => (
  <form
    hidden={hidden}
    ref={formRef}
    onChange={onChange}
    onSubmit={onSubmit}
    className="border-border rounded-lg border p-5"
  >
    <fieldset
      disabled={recoveryDisabled}
      className="flex min-w-0 flex-col gap-3"
    >
      <legend className="text-lg font-semibold">
        協助復原／重新發出臨時密碼
      </legend>
      <p className="font-medium">
        對象帳戶：
        {target
          ? `${target.fullName}（${target.username ?? "未設定 Username"}）`
          : "尚未選擇"}
      </p>
      {targetUserId ? (
        <input type="hidden" name="targetUserId" value={targetUserId} />
      ) : (
        <>
          <label htmlFor="recovery-target">更換對象</label>
          <select
            id="recovery-target"
            value={targetId}
            onChange={(event) => onTargetChange(event.target.value)}
            required
            disabled={flow !== "ready"}
            className="border-input-border min-h-11 rounded-md border px-3 text-base"
          >
            <option value="">請選擇帳戶</option>
            {accounts.map((account) => (
              <option key={account.userId} value={account.userId}>
                {account.fullName}（{account.username ?? "未設定"}）
              </option>
            ))}
          </select>
        </>
      )}
      {target ? (
        <p>
          目前狀態：{membershipStatusLabel(target.membershipStatus)}；
          {target.banned === null ? "沒有保安限制" : "保安限制仍然生效"}
          。原有已核實電話：{target.verifiedRecoveryPhone ?? "沒有"}。
        </p>
      ) : null}
      <label htmlFor="recovery-identity">身分核實方式</label>
      <select
        id="recovery-identity"
        name="identityCheck"
        key={identityCheck}
        value={identityCheck}
        onChange={(event) => {
          onIdentityCheckChange(
            identityCheckSchema.parse(event.currentTarget.value)
          );
        }}
        className="border-input-border min-h-11 rounded-md border px-3 text-base"
      >
        <option value="face_to_face">親身核實</option>
        <option
          value="verified_phone"
          disabled={!target?.verifiedRecoveryPhone}
        >
          職員主動聯絡教會原有已核實電話
        </option>
      </select>
      <label className="flex min-h-11 items-center gap-3">
        <input type="checkbox" required className="h-5 w-5" />
        已按以上方式核實身分，並確認不使用新提供或未核實的聯絡資料作憑證
      </label>
      <Button
        type="submit"
        name="action"
        value="staff_password_reset"
        disabled={disabled("staff_password_reset") || !targetId}
      >
        檢查重設資料
      </Button>
      <Button
        type="submit"
        name="action"
        value="temporary_password_reissued"
        disabled={
          disabled("temporary_password_reissued") ||
          !target?.temporaryPasswordExpiresAt
        }
      >
        檢查重新發出資料
      </Button>
    </fieldset>
  </form>
);

const StaffAccountsFormView = ({
  accounts,
  actorUserId,
  busy,
  check,
  copyPassword,
  disabled,
  dirty,
  finish,
  formRefs,
  flow,
  creationReview,
  handoverIdentity,
  recoveryReview,
  message,
  onCancelCreationReview,
  onCancelRecoveryReview,
  onChange,
  onConfirmCreationReview,
  onConfirmRecoveryReview,
  onIdentityCheckChange,
  identityCheck,
  onDiscard,
  onSubmit,
  onTargetChange,
  operation,
  panels,
  password,
  receipt,
  recoveryDisabled,
  reissueLostHandover,
  target,
  targetId,
  targetUserId,
  returnHref,
  returnLabel,
}: {
  accounts: ManagedAccount[];
  actorUserId: string;
  busy: boolean;
  check: () => void;
  copyPassword: () => void;
  disabled: (action: Action) => boolean;
  dirty: boolean;
  creationReview: CreationReview | null;
  finish: () => Promise<void>;
  formRefs: {
    create: React.Ref<HTMLFormElement>;
    recovery: React.Ref<HTMLFormElement>;
  };
  flow: Flow;
  handoverIdentity: HandoverIdentity | null;
  recoveryReview: RecoveryReview | null;
  message: string;
  onCancelCreationReview: () => void;
  onCancelRecoveryReview: () => void;
  onChange: () => void;
  onConfirmCreationReview: () => void;
  onConfirmRecoveryReview: () => void;
  onIdentityCheckChange: (identityCheck: IdentityCheck) => void;
  identityCheck: IdentityCheck;
  onDiscard: () => void;
  onSubmit: (event: React.SubmitEvent<HTMLFormElement>) => void;
  onTargetChange: (targetId: string) => void;
  operation: Operation | null;
  panels: { create: boolean; recovery: boolean };
  password: string | null;
  receipt: StaffAccountReceipt | null;
  recoveryDisabled: boolean;
  reissueLostHandover: () => Promise<void>;
  target: ManagedAccount | undefined;
  targetId: string;
  targetUserId?: string;
  returnHref?: string;
  returnLabel?: string;
}) => (
  <div className="mt-8 flex flex-col gap-6">
    {returnHref ? (
      <header>
        <UnsavedChangesLink
          description="放棄變更會清除未提交的帳戶資料；已提交操作的查核記錄會保留。"
          href={returnHref}
          isDirty={dirty}
          onDiscard={onDiscard}
        >
          ← {returnLabel ?? "返回帳戶詳情"}
        </UnsavedChangesLink>
      </header>
    ) : null}
    <p>
      重設或重新發出前，請核對對象及身分核實方式。若目前登入需要確認密碼，系統會在此工作內確認，然後返回同一份核對資料。
    </p>
    {message ? (
      <AccountOperationOutcome
        busy={busy}
        message={message}
        title={flowTitles[flow]}
        tone={flowTones[flow]}
      />
    ) : null}
    {flow === "unknown" || flow === "retry" ? (
      <Button type="button" disabled={busy} onClick={check}>
        查核之前的操作
      </Button>
    ) : null}
    {receipt && operation?.actorUserId === actorUserId ? (
      <StaffAccountHandover
        copyPassword={copyPassword}
        finish={finish}
        handoverIdentity={handoverIdentity}
        reissueLostHandover={reissueLostHandover}
        password={password}
        receipt={receipt}
      />
    ) : null}
    {panels.create ? (
      <>
        <AssistedAccountCreationForm
          disabled={disabled("assisted_account_created")}
          formRef={formRefs.create}
          hidden={creationReview !== null}
          onChange={onChange}
          onSubmit={onSubmit}
        />
        {creationReview ? (
          <AssistedAccountCreationReview
            draft={creationReview}
            onConfirm={onConfirmCreationReview}
            onEdit={onCancelCreationReview}
          />
        ) : null}
      </>
    ) : null}
    {panels.recovery ? (
      <>
        <StaffAccountRecoveryForm
          accounts={accounts}
          disabled={disabled}
          formRef={formRefs.recovery}
          flow={flow}
          hidden={recoveryReview !== null}
          identityCheck={
            recoveryReview?.identityCheck ??
            operation?.identityCheck ??
            identityCheck
          }
          onIdentityCheckChange={onIdentityCheckChange}
          onChange={onChange}
          onSubmit={onSubmit}
          onTargetChange={onTargetChange}
          recoveryDisabled={recoveryDisabled}
          target={target}
          targetId={targetId}
          targetUserId={targetUserId}
        />
        {recoveryReview ? (
          <StaffAccountRecoveryReview
            draft={recoveryReview}
            onConfirm={onConfirmRecoveryReview}
            onEdit={onCancelRecoveryReview}
            target={accounts.find(
              (account) => account.userId === recoveryReview.targetUserId
            )}
          />
        ) : null}
      </>
    ) : null}
  </div>
);

export const StaffAccountsForm = ({
  actorName,
  actorUsername,
  actorUserId,
  accounts,
  confirmationExpiresAt = null,
  mode = "all",
  returnHref,
  returnLabel,
  targetUserId,
}: {
  actorName?: string;
  actorUsername?: string | null;
  actorUserId: string;
  accounts: ManagedAccount[];
  confirmationExpiresAt?: number | null;
  mode?: "all" | "create" | "recovery";
  returnHref?: string;
  returnLabel?: string;
  targetUserId?: string;
}) => {
  const router = useRouter();
  const [flow, setFlow] = useState<Flow>("restoring");
  const [message, setMessage] = useState("正在查核未確認的操作。");
  const [operation, setOperation] = useState<Operation | null>(null);
  const [receipt, setReceipt] = useState<StaffAccountReceipt | null>(null);
  const [password, setPassword] = useState<string | null>(null);
  const [handoverIdentity, setHandoverIdentity] =
    useState<HandoverIdentity | null>(null);
  const [creationReview, setCreationReview] = useState<CreationReview | null>(
    null
  );
  const [recoveryReview, setRecoveryReview] = useState<RecoveryReview | null>(
    null
  );
  const [identityCheck, setIdentityCheck] =
    useState<IdentityCheck>("face_to_face");
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [confirmedUntil, setConfirmedUntil] = useState<number | null>(
    confirmationExpiresAt
  );
  const [targetId, setTargetId] = useState(targetUserId ?? "");
  const [dirty, setDirty] = useState(false);
  const busyRef = useRef(false);
  const operationRef = useRef<Operation | null>(null);
  const createFormRef = useRef<HTMLFormElement>(null);
  const recoveryFormRef = useRef<HTMLFormElement>(null);
  const busy =
    flow === "restoring" || flow === "submitting" || flow === "checking";
  const target = accounts.find((account) => account.userId === targetId);
  const confirmationIsFresh =
    confirmedUntil !== null && confirmedUntil > Math.floor(Date.now() / 1000);

  const reconcile = useCallback(
    async (saved: Operation): Promise<"confirmed" | "missing" | "unknown"> => {
      operationRef.current = saved;
      setOperation(saved);
      setPassword(null);
      setReceipt(null);
      setHandoverIdentity(null);
      setCreationReview(null);
      setRecoveryReview(null);
      setTargetId(targetUserId ?? saved.targetUserId ?? "");
      setIdentityCheck(saved.identityCheck ?? "face_to_face");
      if (saved.actorUserId !== actorUserId) {
        setFlow("unknown");
        setMessage(
          "此瀏覽器保留了另一職員未確認的操作，請以原帳戶登入查核；操作代碼不會被覆蓋或清除。"
        );
        return "unknown";
      }
      setFlow("checking");
      setMessage("正在向伺服器查核；暫時不要開始另一項操作。");
      try {
        const response = await postAccountOperation(
          actorUserId,
          "/api/v2/staff/accounts/reconcile",
          {
            operationKey: saved.key,
          }
        );
        const result = resultData(await response.json());
        if (
          !response.ok ||
          !result ||
          (result.receipt && !matchesOperation(result.receipt, saved))
        ) {
          setFlow("unknown");
          setMessage(
            "暫時未能查核或管理權限已失效，結果仍未確認。請以原職員帳戶重新登入後再次查核。"
          );
          return "unknown";
        }
        if (result.receipt) {
          setReceipt(result.receipt);
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
          setRecoveryReview({
            action: saved.action,
            identityCheck: saved.identityCheck ?? "face_to_face",
            targetUserId: saved.targetUserId,
          });
        }
        setFlow("retry");
        setMessage(
          "尚未找到完成紀錄，不能當作已成功。請核對原對象與操作後重試；表格及密碼不會保存在此瀏覽器。"
        );
        return "missing";
      } catch {
        setFlow("unknown");
        setMessage("連線失敗，結果仍未確認；操作代碼已保留，請再次查核。");
        return "unknown";
      }
    },
    [actorUserId, router, targetUserId]
  );
  const check = useCallback(async () => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    try {
      const saved = readOperation();
      if (saved) {
        await reconcile(saved);
      } else {
        operationRef.current = null;
        setOperation(null);
        setCreationReview(null);
        setRecoveryReview(null);
        setFlow("ready");
        setMessage("");
      }
    } catch {
      setFlow("unknown");
      setMessage(
        "無法讀取操作代碼，請恢復瀏覽器儲存後再次查核；未有提交新操作。"
      );
    } finally {
      busyRef.current = false;
    }
  }, [reconcile]);
  useEffect(() => {
    void check();
  }, [check]);
  useEffect(() => {
    const hidePassword = () => {
      if (document.hidden) {
        flushSync(() => setPassword(null));
      }
    };
    document.addEventListener("visibilitychange", hidePassword);
    return () => document.removeEventListener("visibilitychange", hidePassword);
  }, []);

  const pendingChanged = (
    saved: Operation,
    action: Action,
    submittedIdentityCheck: IdentityCheck | undefined
  ) =>
    saved.key !== operationRef.current?.key ||
    saved.action !== action ||
    saved.actorUserId !== actorUserId ||
    (saved.targetUserId !== null && saved.targetUserId !== targetId) ||
    (saved.identityCheck !== undefined &&
      saved.identityCheck !== submittedIdentityCheck);
  const prepareReview = (action: Action, fields: FormData) => {
    if (action === "assisted_account_created" && creationReview === null) {
      setCreationReview(creationReviewFromFields(fields));
      setDirty(true);
      return true;
    }
    if (action !== "assisted_account_created" && recoveryReview === null) {
      const selectedIdentityCheck = identityCheckSchema.safeParse(
        fields.get("identityCheck")
      );
      if (!selectedIdentityCheck.success) {
        setMessage("請重新選擇有效的身分核實方式。");
        return true;
      }
      const draft = recoveryReviewFromFields(
        action,
        fields,
        targetId,
        selectedIdentityCheck.data
      );
      setIdentityCheck(draft.identityCheck);
      setRecoveryReview(draft);
      setDirty(true);
      return true;
    }
    if (!confirmationIsFresh) {
      setMessage(
        "請先確認目前登入密碼；完成後會返回同一份核對資料，再明確提交。"
      );
      setConfirmationOpen(true);
      return true;
    }
    return false;
  };
  const recoverAfterConfirmationRequired = async (
    next: Operation,
    action: Action,
    fields: FormData,
    selectedIdentityCheck: IdentityCheck | undefined,
    errorMessage: string
  ) => {
    if ((await reconcile(next)) !== "missing") {
      return;
    }
    localStorage.removeItem(storageKey);
    operationRef.current = null;
    setOperation(null);
    setFlow("ready");
    setMessage(errorMessage);
    setDirty(true);
    if (action === "assisted_account_created") {
      setCreationReview(creationReviewFromFields(fields));
    } else if (selectedIdentityCheck) {
      setIdentityCheck(selectedIdentityCheck);
      setRecoveryReview(
        recoveryReviewFromFields(
          action,
          fields,
          targetId,
          selectedIdentityCheck
        )
      );
    }
    setConfirmationOpen(true);
  };
  const submit = async (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busyRef.current || (flow !== "ready" && flow !== "retry")) {
      return;
    }
    const form = event.currentTarget;
    const fields = new FormData(form, event.nativeEvent.submitter);
    const parsedAction = actionSchema.safeParse(fields.get("action"));
    if (!parsedAction.success || prepareReview(parsedAction.data, fields)) {
      return;
    }
    const action = parsedAction.data;
    const submittedIdentityCheck =
      action === "assisted_account_created"
        ? undefined
        : identityCheckSchema.safeParse(fields.get("identityCheck"));
    if (
      action !== "assisted_account_created" &&
      !submittedIdentityCheck?.success
    ) {
      setMessage("請重新選擇有效的身分核實方式。");
      return;
    }
    const selectedIdentityCheck = submittedIdentityCheck?.success
      ? submittedIdentityCheck.data
      : undefined;
    setCreationReview(null);
    setRecoveryReview(null);
    setDirty(false);
    busyRef.current = true;
    setPassword(null);
    try {
      await navigator.locks.request(storageKey, async () => {
        const saved = readOperation();
        if (saved && pendingChanged(saved, action, selectedIdentityCheck)) {
          await reconcile(saved);
          return;
        }
        const fresh = saved === null;
        const next: Operation = saved ?? {
          action,
          actorUserId,
          key: crypto.randomUUID(),
          ...(selectedIdentityCheck
            ? { identityCheck: selectedIdentityCheck }
            : {}),
          targetUserId: action === "assisted_account_created" ? null : targetId,
        };
        localStorage.setItem(storageKey, JSON.stringify(next));
        if (readOperation()?.key !== next.key) {
          throw new Error("Operation metadata was not persisted");
        }
        operationRef.current = next;
        setOperation(next);
        setFlow("submitting");
        setMessage("正在提交，請勿重複按下提交。");
        const body =
          action === "assisted_account_created"
            ? {
                email: fields.get("email") || null,
                fullName: fields.get("fullName"),
                identityCheck: "face_to_face",
                operationKey: next.key,
                phone: fields.get("phone"),
                sharedPhone: fields.get("sharedPhone") === "on",
                username: fields.get("username"),
              }
            : {
                identityCheck: selectedIdentityCheck,
                operationKey: next.key,
                targetUserId: next.targetUserId,
              };
        try {
          const response = await postAccountOperation(
            actorUserId,
            paths[action],
            body
          );
          const responseBody: unknown = await response.json();
          const result = resultData(responseBody);
          const confirmationError = passwordConfirmationError(
            response.status,
            responseBody
          );
          if (confirmationError) {
            await recoverAfterConfirmationRequired(
              next,
              action,
              fields,
              selectedIdentityCheck,
              confirmationError.message
            );
            return;
          }
          if (
            response.ok &&
            result?.receipt &&
            matchesOperation(result.receipt, next)
          ) {
            form.reset();
            setDirty(false);
            setReceipt(result.receipt);
            setPassword(
              response.status === 201 ? result.temporaryPassword : null
            );
            setHandoverIdentity(
              handoverIdentityFor(
                action,
                response.status,
                result.temporaryPassword,
                fields
              )
            );
            setFlow("confirmed");
            setMessage(
              "伺服器已確認操作完成；請私下交接新臨時密碼。離開或隱藏此頁後不能再次讀取，遺失時必須明確重新發出。"
            );
          } else if (fresh && response.status === 400) {
            localStorage.removeItem(storageKey);
            operationRef.current = null;
            setOperation(null);
            setDirty(true);
            setFlow("ready");
            setMessage("資料未獲接受，未有完成操作；請檢查欄位及核實方式。");
          } else {
            form.reset();
            await reconcile(next);
          }
        } catch {
          form.reset();
          setDirty(false);
          await reconcile(next);
        }
      });
    } catch {
      setFlow("unknown");
      setMessage(
        "未能安全讀寫操作代碼或取得瀏覽器鎖，未有確認結果；請恢復本機儲存後再次查核。"
      );
    } finally {
      busyRef.current = false;
    }
  };
  const finish = async (destination?: string) => {
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
        localStorage.removeItem(storageKey);
        operationRef.current = null;
        setOperation(null);
        setReceipt(null);
        setPassword(null);
        setHandoverIdentity(null);
        setCreationReview(null);
        setRecoveryReview(null);
        setIdentityCheck("face_to_face");
        setConfirmationOpen(false);
        createFormRef.current?.reset();
        recoveryFormRef.current?.reset();
        setDirty(false);
        setTargetId(targetUserId ?? "");
        setFlow("ready");
        setMessage("");
        if (destination) {
          router.push(destination);
        } else {
          router.refresh();
        }
      });
    } catch {
      setMessage("未能清除操作代碼，請恢復本機儲存後重試。");
    } finally {
      busyRef.current = false;
    }
  };
  const disabled = (action: Action) =>
    busy ||
    (action !== "assisted_account_created" &&
      !target &&
      !(
        flow === "retry" &&
        operation?.targetUserId === targetId &&
        operation.actorUserId === actorUserId
      )) ||
    (flow !== "ready" &&
      !(
        flow === "retry" &&
        operation?.action === action &&
        operation.actorUserId === actorUserId &&
        operation.targetUserId ===
          (action === "assisted_account_created" ? null : targetId)
      ));
  const recoveryDisabled =
    disabled("staff_password_reset") && disabled("temporary_password_reissued");
  const panels = visiblePanels(mode, operation);
  const copyPassword = async () => {
    if (!password) {
      return;
    }
    try {
      await navigator.clipboard.writeText(password);
      setMessage("已複製臨時密碼，請私下交接。離開或隱藏此頁後不會再次顯示。");
    } catch {
      setMessage("未能複製，請手動選取臨時密碼；不要把密碼寫入公開訊息。");
    }
  };
  const reissueLostHandover = async () => {
    if (!receipt || password !== null) {
      return;
    }
    const query = new URLSearchParams({
      person: receipt.targetUserId,
      task: "recovery",
      view: "people",
    });
    await finish(`/staff/accounts?${query.toString()}`);
  };
  const confirmCreationReview = () => {
    const form = createFormRef.current;
    const submitter = form?.querySelector<HTMLButtonElement>(
      'button[name="action"]'
    );
    if (form && submitter) {
      form.requestSubmit(submitter);
    }
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
  const changeTarget = (nextTargetId: string) => {
    setTargetId(nextTargetId);
    if (
      !accounts.find((account) => account.userId === nextTargetId)
        ?.verifiedRecoveryPhone
    ) {
      setIdentityCheck("face_to_face");
    }
  };
  let confirmationContext: AccountOperationSummaryRow[] = [];
  if (creationReview) {
    confirmationContext = [
      { label: "工作", value: "協助建立已批准帳戶" },
      ...creationReviewRows(creationReview),
    ];
  } else if (recoveryReview) {
    confirmationContext = [
      { label: "工作", value: recoveryActionLabels[recoveryReview.action] },
      ...recoveryReviewRows(recoveryReview, target),
    ];
  }
  return (
    <>
      <StaffAccountsFormView
        accounts={accounts}
        actorUserId={actorUserId}
        busy={busy}
        check={check}
        copyPassword={copyPassword}
        disabled={disabled}
        dirty={dirty}
        flow={flow}
        finish={() => finish()}
        formRefs={{ create: createFormRef, recovery: recoveryFormRef }}
        creationReview={creationReview}
        handoverIdentity={handoverIdentity}
        recoveryReview={recoveryReview}
        message={message}
        onCancelCreationReview={() => setCreationReview(null)}
        onCancelRecoveryReview={() => setRecoveryReview(null)}
        onChange={() => setDirty(true)}
        onConfirmCreationReview={confirmCreationReview}
        onConfirmRecoveryReview={confirmRecoveryReview}
        onIdentityCheckChange={setIdentityCheck}
        identityCheck={identityCheck}
        onDiscard={() => {
          createFormRef.current?.reset();
          recoveryFormRef.current?.reset();
          setDirty(false);
          setCreationReview(null);
          setRecoveryReview(null);
          setTargetId(targetUserId ?? operation?.targetUserId ?? "");
          setIdentityCheck(operation?.identityCheck ?? "face_to_face");
        }}
        onSubmit={submit}
        onTargetChange={changeTarget}
        operation={operation}
        panels={panels}
        password={password}
        receipt={receipt}
        returnHref={returnHref}
        returnLabel={returnLabel}
        recoveryDisabled={recoveryDisabled}
        reissueLostHandover={reissueLostHandover}
        target={target}
        targetId={targetId}
        targetUserId={targetUserId}
      />
      {confirmationOpen ? (
        <AccountSecurityForm
          actorName={actorName}
          actorUserId={actorUserId}
          actorUsername={actorUsername}
          confirmationContext={confirmationContext}
          confirmationExpiresAt={confirmedUntil}
          confirmationOnly
          onConfirmationClose={() => setConfirmationOpen(false)}
          onConfirmedInWork={() => {
            setConfirmedUntil(Math.floor(Date.now() / 1000) + 600);
            setConfirmationOpen(false);
            setMessage("");
          }}
          task="confirm"
          temporaryPasswordExpired={false}
          temporaryPasswordExpiresAt={null}
        />
      ) : null}
    </>
  );
};
