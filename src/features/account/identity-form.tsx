"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import * as z from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { IdentityChangeView } from "./identity-form-views";
import { postAccountOperation } from "./post-operation";
import type { ManagedAccount } from "./staff-accounts";

const storageKey = "efcc.identity-change.operation.v1";
const actionSchema = z.enum([
  "own_phone_changed",
  "staff_identity_corrected",
  "staff_shared_phone_corrected",
]);
const opaqueId = z.string().min(1).max(128);
const operationSchema = z.strictObject({
  action: actionSchema,
  actorUserId: opaqueId,
  key: z.uuid(),
  targetUserId: opaqueId,
});
type Operation = z.infer<typeof operationSchema>;
const receiptSchema = z.object({
  action: actionSchema,
  createdAt: z.number().int(),
  id: z.uuid(),
  targetUserId: opaqueId,
});
const resultSchema = z.object({
  data: z.object({ receipt: receiptSchema.nullable() }),
});
const errorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
type Flow =
  | "restoring"
  | "ready"
  | "submitting"
  | "checking"
  | "retry"
  | "unknown"
  | "confirmed"
  | "denied"
  | "rejected"
  | "revalidating";
export type IdentityChangeFlow = Flow;
export type IdentityChangeOperation = Operation;
const labels = {
  own_phone_changed: "更改電話",
  staff_identity_corrected: "職員核實修正身分資料",
  staff_shared_phone_corrected: "職員核實共用電話例外",
};
const readOperation = () => {
  const raw = localStorage.getItem(storageKey);
  return raw ? operationSchema.parse(JSON.parse(raw)) : null;
};
const clearOperation = (expected: Operation) => {
  const saved = readOperation();
  if (
    saved &&
    (saved.actorUserId !== expected.actorUserId ||
      saved.key !== expected.key ||
      saved.targetUserId !== expected.targetUserId ||
      saved.action !== expected.action)
  ) {
    throw new Error("Operation metadata changed.");
  }
  localStorage.removeItem(storageKey);
  if (readOperation() !== null) {
    throw new Error("Operation metadata remains stored.");
  }
};
const matching = (
  receipt: z.infer<typeof receiptSchema>,
  operation: Operation
) =>
  receipt.action === operation.action &&
  receipt.targetUserId === operation.targetUserId;
const identityAction = (
  fields: FormData,
  staffVerified: boolean
): Operation["action"] => {
  if (!staffVerified) {
    return "own_phone_changed";
  }
  return fields.get("sharedPhone") === "on"
    ? "staff_shared_phone_corrected"
    : "staff_identity_corrected";
};
const identityRequest = (
  fields: FormData,
  operation: Operation,
  staffVerified: boolean
) => ({
  body: staffVerified
    ? {
        email: fields.get("email") || null,
        fullName: fields.get("fullName"),
        identityCheck: fields.get("identityCheck"),
        operationKey: operation.key,
        phone: fields.get("phone"),
        sharedPhone: fields.get("sharedPhone") === "on",
        targetUserId: operation.targetUserId,
        username: fields.get("username"),
      }
    : { operationKey: operation.key, phone: fields.get("phone") },
  path: staffVerified
    ? "/api/v2/staff/accounts/identity"
    : "/api/v2/account/phone",
});
const identitySnapshot = (account: IdentityContact) =>
  JSON.stringify([
    account.userId,
    account.fullName,
    account.username,
    account.email,
    account.phone,
    account.phoneShared,
    account.verifiedRecoveryPhone,
    account.credentialRevision,
    account.role,
    account.membershipStatus,
    account.banned,
  ]);
const draftFromFields = (
  fields: FormData,
  account: IdentityContact
): IdentityReviewDraft => ({
  email: String(fields.get("email") ?? ""),
  fullName: String(fields.get("fullName") ?? account.fullName),
  identityCheck: String(fields.get("identityCheck") ?? "face_to_face"),
  identityVerified: fields.get("identityVerified") === "true",
  phone: String(fields.get("phone") ?? ""),
  sharedPhone: fields.get("sharedPhone") === "on",
  username: String(fields.get("username") ?? account.username ?? ""),
});
const fieldsFromDraft = (draft: IdentityReviewDraft) => {
  const fields = new FormData();
  fields.set("email", draft.email);
  fields.set("fullName", draft.fullName);
  fields.set("identityCheck", draft.identityCheck);
  fields.set("identityVerified", draft.identityVerified ? "true" : "");
  fields.set("phone", draft.phone);
  if (draft.sharedPhone) {
    fields.set("sharedPhone", "on");
  }
  fields.set("username", draft.username);
  return fields;
};
export interface IdentityContact {
  userId: string;
  fullName: string;
  username: string | null;
  email: string;
  phone: string | null;
  phoneShared: number;
  verifiedRecoveryPhone?: string | null;
  credentialRevision?: number;
  role?: string;
  membershipStatus?: string;
  banned?: number | null;
}
export interface IdentityReviewDraft {
  email: string;
  fullName: string;
  identityCheck: string;
  identityVerified: boolean;
  phone: string;
  sharedPhone: boolean;
  username: string;
}
const selectedVerificationMethod = (
  account: IdentityContact,
  draft?: IdentityReviewDraft
) =>
  draft?.identityCheck === "verified_phone" &&
  account.verifiedRecoveryPhone === null
    ? ""
    : (draft?.identityCheck ?? "face_to_face");

const StaffIdentityFields = ({
  account,
  draft,
  onChange,
}: {
  account: IdentityContact;
  draft?: IdentityReviewDraft;
  onChange: () => void;
}) => (
  <>
    <label htmlFor="identity-name">中文全名</label>
    <Input
      id="identity-name"
      name="fullName"
      autoComplete="name"
      defaultValue={draft?.fullName ?? account.fullName}
      maxLength={200}
      required
      onChange={onChange}
    />
    <label htmlFor="identity-username">使用者名稱</label>
    <Input
      id="identity-username"
      name="username"
      autoComplete="off"
      defaultValue={draft?.username ?? account.username ?? ""}
      minLength={3}
      maxLength={30}
      pattern="[A-Za-z0-9_.]{3,30}"
      required
      onChange={onChange}
    />
    <label htmlFor="identity-email">電郵（沒有電郵可留空）</label>
    <Input
      id="identity-email"
      name="email"
      type="email"
      autoComplete="email"
      defaultValue={
        draft?.email ??
        (account.email.endsWith(".invalid") ? "" : account.email)
      }
      maxLength={254}
      onChange={onChange}
    />
    <label className="flex min-h-11 items-center gap-3">
      <input
        type="checkbox"
        name="sharedPhone"
        defaultChecked={draft?.sharedPhone ?? !!account.phoneShared}
        onChange={onChange}
      />
      已核實共用電話例外
    </label>
    <label htmlFor="identity-check">身分核實方式</label>
    <select
      id="identity-check"
      name="identityCheck"
      className="border-input-border bg-surface min-h-[52px] rounded-md border px-3 py-3 text-base"
      defaultValue={selectedVerificationMethod(account, draft)}
      onChange={onChange}
      required
    >
      <option disabled value="">
        請重新選擇核實方式
      </option>
      <option value="face_to_face">親身核實</option>
      {account.verifiedRecoveryPhone === null ? null : (
        <option value="verified_phone">
          透過教會原有已核實電話主動聯絡（必須已有核實紀錄）
        </option>
      )}
    </select>
    <label className="flex min-h-11 items-center gap-3">
      <input
        name="identityVerified"
        type="checkbox"
        value="true"
        defaultChecked={draft?.identityVerified ?? false}
        required
        onChange={onChange}
      />
      已按以上方式核實本人，新聯絡資料沒有用作復原憑證
    </label>
  </>
);

const IdentityFields = ({
  account,
  draft,
  onChange,
  staffVerified,
  submitLabel,
}: {
  account: IdentityContact;
  draft?: IdentityReviewDraft;
  onChange: () => void;
  staffVerified: boolean;
  submitLabel: string;
}) => (
  <>
    <legend className="font-semibold">{account.fullName}</legend>
    {staffVerified ? (
      <StaffIdentityFields
        account={account}
        draft={draft}
        onChange={onChange}
      />
    ) : null}
    <label htmlFor="identity-phone">
      {staffVerified ? "修正電話" : "新電話"}
    </label>
    <Input
      id="identity-phone"
      name="phone"
      type="tel"
      autoComplete="tel"
      defaultValue={draft?.phone ?? account.phone ?? ""}
      maxLength={40}
      required
      onChange={onChange}
    />
    <Button type="submit">{submitLabel}</Button>
  </>
);

interface PendingReviewSubmission {
  action: Operation["action"];
  actorUserId: string;
  baseline: string;
  draft: IdentityReviewDraft;
}

export const IdentityChangeForm = ({
  actorName,
  actorUsername,
  actorUserId,
  account,
  confirmationExpiresAt = null,
  returnHref = "/account",
  staffVerified,
}: {
  actorName?: string;
  actorUsername?: string | null;
  actorUserId: string;
  account: IdentityContact;
  confirmationExpiresAt?: number | null;
  returnHref?: string;
  staffVerified: boolean;
}) => {
  const router = useRouter();
  const [flow, setFlow] = useState<Flow>("restoring");
  const [message, setMessage] = useState("正在查核未確認操作。");
  const [operation, setOperation] = useState<Operation | null>(null);
  const [step, setStep] = useState<"edit" | "review">("edit");
  const [reviewDraft, setReviewDraft] = useState<IdentityReviewDraft | null>(
    null
  );
  const [reviewBaseline, setReviewBaseline] = useState(() =>
    identitySnapshot(account)
  );
  const [pendingReviewSubmission, setPendingReviewSubmission] =
    useState<PendingReviewSubmission | null>(null);
  const [dirty, setDirty] = useState(false);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [confirmedUntil, setConfirmedUntil] = useState<number | null>(
    confirmationExpiresAt
  );
  const [refreshPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const busyRef = useRef(false);
  const busy =
    refreshPending ||
    flow === "restoring" ||
    flow === "submitting" ||
    flow === "checking" ||
    flow === "revalidating";
  const reconcile = useCallback(
    async (saved: Operation) => {
      setOperation(saved);
      if (saved.actorUserId !== actorUserId) {
        setFlow("unknown");
        setMessage(
          "此瀏覽器保留了另一帳戶未確認的操作。請以原帳戶登入查核，操作代碼不會被清除。"
        );
        return "unknown" as const;
      }
      setFlow("checking");
      setMessage("正在向伺服器查核結果。");
      try {
        const response = await postAccountOperation(
          actorUserId,
          "/api/v2/account/changes/reconcile",
          {
            operationKey: saved.key,
          }
        );
        const parsed = resultSchema.safeParse(await response.json());
        if (
          !response.ok ||
          !parsed.success ||
          (parsed.data.data.receipt &&
            !matching(parsed.data.data.receipt, saved))
        ) {
          throw new Error("Receipt unavailable");
        }
        if (parsed.data.data.receipt) {
          setFlow("confirmed");
          setMessage(
            `伺服器已確認「${labels[saved.action]}」完成；對象帳戶：${saved.targetUserId}。`
          );
          return "confirmed" as const;
        }
        setFlow("retry");
        setMessage(
          "尚未找到完成紀錄，不能當作成功。請填寫同一份資料重試原操作。"
        );
        return "missing" as const;
      } catch {
        setFlow("unknown");
        setMessage("暫時未能查核，結果仍未確認。操作代碼已保留，請再次查核。");
        return "unknown" as const;
      }
    },
    [actorUserId]
  );
  const check = useCallback(async () => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    try {
      await navigator.locks.request(storageKey, async () => {
        const saved = readOperation();
        if (saved) {
          await reconcile(saved);
        } else {
          setOperation(null);
          setFlow("ready");
          setMessage("");
        }
      });
    } catch {
      setFlow("unknown");
      setMessage(
        "未能安全讀寫操作代碼或取得瀏覽器鎖；請恢復本機儲存後再查核。"
      );
    } finally {
      busyRef.current = false;
    }
  }, [reconcile]);
  useEffect(() => {
    void check();
    const changed = (event: StorageEvent) => {
      if (event.key === storageKey) {
        void check();
      }
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [check]);
  const retryHere =
    flow === "retry" &&
    operation?.actorUserId === actorUserId &&
    operation.targetUserId === account.userId &&
    (staffVerified
      ? operation.action !== "own_phone_changed"
      : operation.action === "own_phone_changed");
  const disabled =
    busy || (flow !== "ready" && flow !== "rejected" && !retryHere);
  const handleDefinitiveResponse = async (
    next: Operation,
    response: Response,
    body: unknown
  ) => {
    const error = errorSchema.safeParse(body);
    const code = error.success ? error.data.error.code : null;
    const errorMessage = error.success
      ? error.data.error.message
      : "這次修正未提交，請檢查資料後再試。";
    const outcome = await reconcile(next);
    if (outcome === "unknown") {
      return;
    }
    if (outcome === "confirmed") {
      if (response.status === 409 || response.status === 400) {
        setFlow("rejected");
        setMessage(
          "本次輸入與原操作不同，沒有按這份內容提交；原操作已有完成紀錄。請返回帳戶詳情核對最新資料。"
        );
      }
      return;
    }

    clearOperation(next);
    setOperation(null);
    setDirty(true);
    if (code === "password_confirmation_required") {
      setFlow("ready");
      setMessage(errorMessage);
      setConfirmationOpen(true);
      return;
    }
    if (code === "identity_verification_required") {
      setStep("edit");
      setFlow("rejected");
      setMessage(errorMessage);
      router.refresh();
      return;
    }
    if (response.status === 401 || response.status === 403) {
      setFlow("denied");
      setMessage(
        "登入狀態或管理權限已改變；本次修正未完成，正在重新查核可用工作。"
      );
      router.refresh();
      return;
    }

    setFlow("rejected");
    setMessage(
      response.status === 409
        ? "伺服器資料已改變，這次修正未提交。請檢查更新後的目前資料，再明確確認修正。"
        : errorMessage
    );
    if (response.status === 409) {
      router.refresh();
    }
  };
  const submitOperation = async (
    fields: FormData,
    action: Operation["action"],
    expectedActorUserId = actorUserId
  ) => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    try {
      await navigator.locks.request(storageKey, async () => {
        const saved = readOperation();
        if (
          saved &&
          (saved.actorUserId !== expectedActorUserId ||
            saved.key !== operation?.key ||
            saved.targetUserId !== account.userId ||
            saved.action !== action)
        ) {
          await reconcile(saved);
          return;
        }
        const next = saved ?? {
          action,
          actorUserId: expectedActorUserId,
          key: crypto.randomUUID(),
          targetUserId: account.userId,
        };
        localStorage.setItem(storageKey, JSON.stringify(next));
        if (readOperation()?.key !== next.key) {
          throw new Error("Metadata unavailable");
        }
        setOperation(next);
        setFlow("submitting");
        setMessage("正在提交，請勿重複按下提交。");
        const request = identityRequest(fields, next, staffVerified);
        try {
          const response = await postAccountOperation(
            expectedActorUserId,
            request.path,
            request.body
          );
          const body: unknown = await response.json();
          const result = resultSchema.safeParse(body);
          if (
            response.ok &&
            result.success &&
            result.data.data.receipt &&
            matching(result.data.data.receipt, next)
          ) {
            setFlow("confirmed");
            setDirty(false);
            setMessage(
              `伺服器已確認「${labels[action]}」完成；對象帳戶：${next.targetUserId}。`
            );
          } else if ([400, 401, 403, 409].includes(response.status)) {
            await handleDefinitiveResponse(next, response, body);
          } else {
            await reconcile(next);
          }
        } catch {
          await reconcile(next);
        }
      });
    } catch {
      setFlow("unknown");
      setMessage("未能安全保存操作代碼，結果未確認。請再次查核。");
    } finally {
      busyRef.current = false;
    }
  };

  useEffect(() => {
    if (!pendingReviewSubmission || refreshPending) {
      return;
    }
    setPendingReviewSubmission(null);
    if (pendingReviewSubmission.actorUserId !== actorUserId) {
      setFlow("denied");
      setMessage(
        "登入帳戶已改變；本次修正未提交，請返回管理頁以目前帳戶重新查核。"
      );
      return;
    }
    const currentBaseline = identitySnapshot(account);
    if (currentBaseline !== pendingReviewSubmission.baseline) {
      setReviewBaseline(currentBaseline);
      setReviewDraft(pendingReviewSubmission.draft);
      setStep("review");
      setFlow("rejected");
      setDirty(true);
      setMessage(
        "帳戶資料在檢查後已更新；這次修正未提交。請核對更新後的目前資料，再明確確認修正。"
      );
      return;
    }
    void submitOperation(
      fieldsFromDraft(pendingReviewSubmission.draft),
      pendingReviewSubmission.action,
      pendingReviewSubmission.actorUserId
    );
  }, [
    account,
    actorUserId,
    pendingReviewSubmission,
    refreshPending,
    submitOperation,
  ]);

  const submit = async (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busyRef.current || disabled) {
      return;
    }
    const form = event.currentTarget;
    const fields = new FormData(form);
    const action = identityAction(fields, staffVerified);
    const draft = draftFromFields(fields, account);
    if (step === "edit") {
      setReviewDraft(draft);
      setReviewBaseline(identitySnapshot(account));
      setMessage("");
      setStep("review");
      return;
    }
    if (
      staffVerified &&
      (confirmedUntil === null ||
        confirmedUntil <= Math.floor(Date.now() / 1000))
    ) {
      setConfirmationOpen(true);
      return;
    }
    if (staffVerified) {
      setReviewDraft(draft);
      setFlow("revalidating");
      setMessage("正在重新查核帳戶資料，尚未提交修正。");
      startTransition(() => {
        setPendingReviewSubmission({
          action,
          actorUserId,
          baseline: reviewBaseline,
          draft,
        });
        router.refresh();
      });
      return;
    }
    await submitOperation(fields, action);
  };
  const finish = async () => {
    if (
      busyRef.current ||
      (flow !== "confirmed" && !(flow === "rejected" && operation)) ||
      operation?.actorUserId !== actorUserId
    ) {
      return;
    }
    busyRef.current = true;
    try {
      await navigator.locks.request(storageKey, async () => {
        const saved = readOperation();
        if (saved && saved.key !== operation?.key) {
          await reconcile(saved);
          return;
        }
        localStorage.removeItem(storageKey);
        if (readOperation() !== null) {
          throw new Error("Operation metadata remains stored.");
        }
        setOperation(null);
        setFlow("ready");
        setMessage("");
        setStep("edit");
        setReviewDraft(null);
        setDirty(false);
        router.replace(staffVerified ? returnHref : "/account");
        router.refresh();
      });
    } catch {
      setMessage("未能清除操作代碼，請恢復本機儲存後再試。");
    } finally {
      busyRef.current = false;
    }
  };
  const confirmationIsFresh =
    confirmedUntil !== null && confirmedUntil > Math.floor(Date.now() / 1000);
  const discardUnsent = () => {
    formRef.current?.reset();
    setPendingReviewSubmission(null);
    setStep("edit");
    setReviewDraft(null);
    setReviewBaseline(identitySnapshot(account));
    setDirty(false);
    setMessage("");
  };
  const editFields = (
    <IdentityFields
      key={JSON.stringify([identitySnapshot(account), reviewDraft])}
      account={account}
      draft={reviewDraft ?? undefined}
      onChange={() => {
        setDirty(true);
        if (flow === "rejected") {
          setMessage("");
        }
      }}
      staffVerified={staffVerified}
      submitLabel={staffVerified ? "檢查修正" : "檢查電話"}
    />
  );
  return (
    <IdentityChangeView
      account={account}
      actorName={actorName}
      actorUsername={actorUsername}
      actorUserId={actorUserId}
      busy={busy}
      confirmationExpiresAt={confirmedUntil}
      confirmationIsFresh={confirmationIsFresh}
      confirmationOpen={confirmationOpen}
      dirty={dirty}
      disabled={disabled}
      editFields={editFields}
      flow={flow}
      message={message}
      onCheck={check}
      onConfirmCurrentPassword={() => setConfirmationOpen(true)}
      onConfirmationClose={() => setConfirmationOpen(false)}
      onConfirmedInWork={() => {
        setConfirmedUntil(Math.floor(Date.now() / 1000) + 600);
        setConfirmationOpen(false);
        setMessage("");
      }}
      onDiscard={discardUnsent}
      onFinish={finish}
      onSubmit={submit}
      onReturnToEdit={() => setStep("edit")}
      operation={operation}
      reviewDraft={reviewDraft}
      returnHref={returnHref}
      step={step}
      staffVerified={staffVerified}
    />
  );
};
export const StaffIdentityCorrections = ({
  actorName,
  actorUsername,
  actorUserId,
  accounts,
  confirmationExpiresAt,
  returnHref,
  targetUserId,
}: {
  actorName?: string;
  actorUsername?: string | null;
  actorUserId: string;
  accounts: ManagedAccount[];
  confirmationExpiresAt: number | null;
  returnHref?: string;
  targetUserId?: string;
}) => {
  const [targetId, setTargetId] = useState(targetUserId ?? "");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
  }, []);
  const target = accounts.find((account) => account.userId === targetId);
  return (
    <section className="mt-8">
      {targetUserId ? null : (
        <>
          <label htmlFor="identity-target">選擇修正資料的帳戶</label>
          <select
            id="identity-target"
            className="border-input-border bg-surface mt-3 min-h-[52px] w-full rounded-md border px-3 py-3 text-base"
            value={targetId}
            disabled={!ready}
            onChange={(event) => setTargetId(event.target.value)}
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
        <IdentityChangeForm
          key={target.userId}
          actorUserId={actorUserId}
          account={target}
          actorName={actorName}
          actorUsername={actorUsername}
          confirmationExpiresAt={confirmationExpiresAt}
          returnHref={returnHref}
          staffVerified
        />
      ) : null}
    </section>
  );
};
