"use client";

import { useSelector } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { useAppForm } from "@/components/ui/app-form";
import type { AppFormApi } from "@/components/ui/app-form";
import { Button } from "@/components/ui/button";
import { businessRpc } from "@/shared/business-rpc";

import {
  identityCheckSchema,
  identityErrorSchema,
  identityReceiptResponseSchema,
  ownPhoneRequestSchema,
  staffIdentityRequestSchema,
  storedIdentityOperationSchema,
} from "./identity-contract";
import type {
  IdentityChangeAction,
  IdentityChangeReceipt,
  IdentityCheck,
  OwnPhoneRequest,
  StaffIdentityRequest,
  StoredIdentityOperation,
} from "./identity-contract";
import { IdentityChangeView } from "./identity-form-views";
import type { ManagedAccount } from "./staff-accounts";
import type {
  StaffOperationReference,
  StaffPersonTaskContext,
} from "./staff-task-contract";

const storageKey = "efcc.identity-change.operation.v1";
type Operation = StoredIdentityOperation & StaffOperationReference;
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
const labels: Record<IdentityChangeAction, string> = {
  own_phone_changed: "更改電話",
  staff_identity_corrected: "職員核實修正身分資料",
  staff_shared_phone_corrected: "職員核實共用電話例外",
};
const readOperation = (): Operation | null => {
  const raw = localStorage.getItem(storageKey);
  if (!raw) {
    return null;
  }
  const parsed = storedIdentityOperationSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error("Invalid identity operation metadata");
  }
  return parsed.data;
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
  receipt: IdentityChangeReceipt,
  operation: Pick<Operation, "action" | "targetUserId">
) =>
  receipt.action === operation.action &&
  receipt.targetUserId === operation.targetUserId;
const identityAction = (
  draft: IdentityReviewDraft,
  staffVerified: boolean
): IdentityChangeAction => {
  if (!staffVerified) {
    return "own_phone_changed";
  }
  return draft.sharedPhone
    ? "staff_shared_phone_corrected"
    : "staff_identity_corrected";
};
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
/** Live Form values: raw strings plus the two verification flags. */
export interface IdentityFormValues {
  email: string;
  fullName: string;
  identityCheck: string;
  identityVerified: boolean;
  phone: string;
  sharedPhone: boolean;
  username: string;
}
/** Immutable review snapshot built from the same existing field defaults. */
export interface IdentityReviewDraft {
  email: string;
  fullName: string;
  identityCheck: IdentityCheck;
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
const formValues = (
  account: IdentityContact,
  draft?: IdentityReviewDraft
): IdentityFormValues => ({
  email:
    draft?.email ?? (account.email.endsWith(".invalid") ? "" : account.email),
  fullName: draft?.fullName ?? account.fullName,
  identityCheck: selectedVerificationMethod(account, draft),
  identityVerified: draft?.identityVerified ?? false,
  phone: draft?.phone ?? account.phone ?? "",
  sharedPhone: draft?.sharedPhone ?? !!account.phoneShared,
  username: draft?.username ?? account.username ?? "",
});

type IdentityFormApi = AppFormApi<IdentityFormValues>;

const StaffIdentityFields = ({
  account,
  form,
}: {
  account: IdentityContact;
  form: IdentityFormApi;
}) => (
  <>
    <form.AppField name="fullName">
      {(field) => (
        <field.TextField
          autoComplete="name"
          id="identity-name"
          label="中文全名"
          maxLength={200}
          required
        />
      )}
    </form.AppField>
    <form.AppField name="username">
      {(field) => (
        <field.TextField
          autoComplete="off"
          id="identity-username"
          label="使用者名稱"
          maxLength={30}
          minLength={3}
          pattern="[A-Za-z0-9_.]{3,30}"
          required
        />
      )}
    </form.AppField>
    <form.AppField name="email">
      {(field) => (
        <field.TextField
          autoComplete="email"
          id="identity-email"
          label="電郵（沒有電郵可留空）"
          maxLength={254}
          type="email"
        />
      )}
    </form.AppField>
    <form.AppField name="sharedPhone">
      {(field) => (
        <label className="flex min-h-11 items-center gap-3">
          <input
            checked={field.state.value}
            onBlur={field.handleBlur}
            onChange={(event) => field.handleChange(event.target.checked)}
            type="checkbox"
          />
          已核實共用電話例外
        </label>
      )}
    </form.AppField>
    <form.AppField name="identityCheck">
      {(field) => (
        <>
          <label htmlFor="identity-check">身分核實方式</label>
          <select
            className="border-input-border bg-surface min-h-[52px] rounded-md border px-3 py-3 text-base"
            id="identity-check"
            onBlur={field.handleBlur}
            onChange={(event) => field.handleChange(event.target.value)}
            required
            value={field.state.value}
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
        </>
      )}
    </form.AppField>
    <form.AppField name="identityVerified">
      {(field) => (
        <label className="flex min-h-11 items-center gap-3">
          <input
            checked={field.state.value}
            onBlur={field.handleBlur}
            onChange={(event) => field.handleChange(event.target.checked)}
            required
            type="checkbox"
          />
          已按以上方式核實本人，新聯絡資料沒有用作復原憑證
        </label>
      )}
    </form.AppField>
  </>
);

const IdentityFields = ({
  account,
  form,
  staffVerified,
  submitLabel,
}: {
  account: IdentityContact;
  form: IdentityFormApi;
  staffVerified: boolean;
  submitLabel: string;
}) => (
  <>
    <legend className="font-semibold">{account.fullName}</legend>
    {staffVerified ? (
      <StaffIdentityFields account={account} form={form} />
    ) : null}
    <form.AppField name="phone">
      {(field) => (
        <field.TextField
          autoComplete="tel"
          id="identity-phone"
          label={staffVerified ? "修正電話" : "新電話"}
          maxLength={40}
          required
          type="tel"
        />
      )}
    </form.AppField>
    <Button type="submit">{submitLabel}</Button>
  </>
);

interface PendingReviewSubmission {
  action: IdentityChangeAction;
  actorUserId: string;
  baseline: string;
  draft: IdentityReviewDraft;
}

type IdentityRequest =
  | { kind: "own"; json: OwnPhoneRequest }
  | { kind: "staff"; json: StaffIdentityRequest };

type IdentitySubmitOutcome =
  | { kind: "confirmed"; receipt: IdentityChangeReceipt }
  | { kind: "definitive"; code: string | null; message: string; status: number }
  | { kind: "unknown" };

/** No automatic retry/replay: sensitive writes stay UNKNOWN until reconciliation. */
const sendIdentityCommand = async (
  request: IdentityRequest,
  operation: Pick<Operation, "action" | "targetUserId">,
  expectedActorUserId: string
): Promise<IdentitySubmitOutcome> => {
  const options = {
    headers: { "x-efcc-expected-actor-id": expectedActorUserId },
    init: { cache: "no-store", credentials: "same-origin" },
  } satisfies Parameters<typeof businessRpc.api.v2.account.phone.$post>[1];
  const response =
    request.kind === "own"
      ? await businessRpc.api.v2.account.phone.$post(
          { json: request.json },
          options
        )
      : await businessRpc.api.v2.staff.accounts.identity.$post(
          { json: request.json },
          options
        );
  const body: unknown = await response.json().catch(() => null);
  const result = identityReceiptResponseSchema.safeParse(body);
  if (
    (response.status === 200 || response.status === 201) &&
    result.success &&
    result.data.data.receipt &&
    matching(result.data.data.receipt, operation)
  ) {
    return { kind: "confirmed", receipt: result.data.data.receipt };
  }
  if ([400, 401, 403, 409].includes(response.status)) {
    const error = identityErrorSchema.safeParse(body);
    return {
      code: error.success ? error.data.error.code : null,
      kind: "definitive",
      message: error.success
        ? error.data.error.message
        : "這次修正未提交，請檢查資料後再試。",
      status: response.status,
    };
  }
  return { kind: "unknown" };
};

const reconciliationQueryKey = ["identity-change-reconciliation"] as const;

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
  const queryClient = useQueryClient();
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
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [confirmedUntil, setConfirmedUntil] = useState<number | null>(
    confirmationExpiresAt
  );
  const [refreshPending, startTransition] = useTransition();
  const busyRef = useRef(false);
  const form = useAppForm({ defaultValues: formValues(account) });
  const dirty = useSelector(form.store, (state) => state.isDirty);
  const busy =
    refreshPending ||
    flow === "restoring" ||
    flow === "submitting" ||
    flow === "checking" ||
    flow === "revalidating";
  const submission = useMutation({
    gcTime: 0,
    mutationFn: ({
      expectedActorUserId,
      request,
      operation: saved,
    }: {
      expectedActorUserId: string;
      request: IdentityRequest;
      operation: Pick<Operation, "action" | "targetUserId">;
    }) => sendIdentityCommand(request, saved, expectedActorUserId),
    networkMode: "always",
    retry: false,
  });
  const reconcile = useCallback(
    async (saved: Operation): Promise<"confirmed" | "missing" | "unknown"> => {
      setOperation(saved);
      if (saved.actorUserId !== actorUserId) {
        setFlow("unknown");
        setMessage(
          "此瀏覽器保留了另一帳戶未確認的操作。請以原帳戶登入查核，操作代碼不會被清除。"
        );
        return "unknown";
      }
      setFlow("checking");
      setMessage("正在向伺服器查核結果。");
      let outcome: "confirmed" | "missing" | "unknown";
      try {
        outcome = await queryClient.query({
          gcTime: 0,
          networkMode: "always",
          queryFn: async (): Promise<"confirmed" | "missing" | "unknown"> => {
            const response =
              await businessRpc.api.v2.account.changes.reconcile.$post(
                { json: { operationKey: saved.key } },
                {
                  headers: { "x-efcc-expected-actor-id": actorUserId },
                  init: { cache: "no-store", credentials: "same-origin" },
                }
              );
            if (response.status !== 200) {
              return "unknown";
            }
            const parsed = identityReceiptResponseSchema.safeParse(
              await response.json().catch(() => null)
            );
            if (!parsed.success) {
              return "unknown";
            }
            const { receipt } = parsed.data.data;
            if (receipt === null) {
              return "missing";
            }
            return matching(receipt, saved) ? "confirmed" : "unknown";
          },
          queryKey: reconciliationQueryKey,
          retry: false,
          staleTime: 0,
        });
      } catch {
        setFlow("unknown");
        setMessage("暫時未能查核，結果仍未確認。操作代碼已保留，請再次查核。");
        return "unknown";
      } finally {
        queryClient.removeQueries({
          exact: true,
          queryKey: reconciliationQueryKey,
        });
      }
      if (outcome === "confirmed") {
        setFlow("confirmed");
        setMessage(
          `伺服器已確認「${labels[saved.action]}」完成；對象帳戶：${saved.targetUserId}。`
        );
      } else if (outcome === "missing") {
        setFlow("retry");
        setMessage(
          "尚未找到完成紀錄，不能當作成功。請填寫同一份資料重試原操作。"
        );
      } else {
        setFlow("unknown");
        setMessage("暫時未能查核，結果仍未確認。操作代碼已保留，請再次查核。");
      }
      return outcome;
    },
    [actorUserId, queryClient]
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
    outcome: { code: string | null; message: string; status: number }
  ) => {
    const reconciled = await reconcile(next);
    if (reconciled === "unknown") {
      return;
    }
    if (reconciled === "confirmed") {
      if (outcome.status === 409 || outcome.status === 400) {
        setFlow("rejected");
        setMessage(
          "本次輸入與原操作不同，沒有按這份內容提交；原操作已有完成紀錄。請返回帳戶詳情核對最新資料。"
        );
      }
      return;
    }

    clearOperation(next);
    setOperation(null);
    if (outcome.code === "password_confirmation_required") {
      setFlow("ready");
      setMessage(outcome.message);
      setConfirmationOpen(true);
      return;
    }
    if (outcome.code === "identity_verification_required") {
      setStep("edit");
      setFlow("rejected");
      setMessage(outcome.message);
      router.refresh();
      return;
    }
    if (outcome.status === 401 || outcome.status === 403) {
      setFlow("denied");
      setMessage(
        "登入狀態或管理權限已改變；本次修正未完成，正在重新查核可用工作。"
      );
      router.refresh();
      return;
    }

    setFlow("rejected");
    setMessage(
      outcome.status === 409
        ? "伺服器資料已改變，這次修正未提交。請檢查更新後的目前資料，再明確確認修正。"
        : outcome.message
    );
    if (outcome.status === 409) {
      router.refresh();
    }
  };
  const submitOperation = async (
    draft: IdentityReviewDraft,
    action: IdentityChangeAction,
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
        const next: Operation = saved ?? {
          action,
          actorUserId: expectedActorUserId,
          key: crypto.randomUUID(),
          targetUserId: account.userId,
        };
        localStorage.setItem(storageKey, JSON.stringify(next));
        if (readOperation()?.key !== next.key) {
          throw new Error("Metadata unavailable");
        }
        const request =
          action === "own_phone_changed"
            ? ownPhoneRequestSchema.safeParse({
                operationKey: next.key,
                phone: draft.phone,
              })
            : staffIdentityRequestSchema.safeParse({
                email: draft.email || null,
                fullName: draft.fullName,
                identityCheck: draft.identityCheck,
                operationKey: next.key,
                phone: draft.phone,
                sharedPhone: draft.sharedPhone,
                targetUserId: next.targetUserId,
                username: draft.username,
              });
        if (!request.success) {
          setStep("edit");
          setFlow("rejected");
          setMessage("請檢查欄位後再提交；沒有未確認的伺服器操作。");
          return;
        }
        setOperation(next);
        setFlow("submitting");
        setMessage("正在提交，請勿重複按下提交。");
        let outcome: IdentitySubmitOutcome;
        try {
          outcome = await submission.mutateAsync({
            expectedActorUserId,
            operation: next,
            request:
              action === "own_phone_changed"
                ? { json: request.data as OwnPhoneRequest, kind: "own" }
                : { json: request.data as StaffIdentityRequest, kind: "staff" },
          });
        } catch {
          outcome = { kind: "unknown" };
        } finally {
          submission.reset();
        }
        if (outcome.kind === "confirmed") {
          setFlow("confirmed");
          setMessage(
            `伺服器已確認「${labels[action]}」完成；對象帳戶：${next.targetUserId}。`
          );
        } else if (outcome.kind === "definitive") {
          await handleDefinitiveResponse(next, outcome);
        } else {
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
      setMessage(
        "帳戶資料在檢查後已更新；這次修正未提交。請核對更新後的目前資料，再明確確認修正。"
      );
      return;
    }
    void submitOperation(
      pendingReviewSubmission.draft,
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
    const values = { ...form.state.values };
    const parsedCheck = identityCheckSchema.safeParse(values.identityCheck);
    if (staffVerified && !parsedCheck.success) {
      setMessage("請重新選擇有效的身分核實方式。");
      return;
    }
    const draft: IdentityReviewDraft = {
      ...values,
      identityCheck: parsedCheck.success ? parsedCheck.data : "face_to_face",
    };
    const action = identityAction(draft, staffVerified);
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
    await submitOperation(draft, action);
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
        form.reset(formValues(account));
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
    form.reset(formValues(account));
    setPendingReviewSubmission(null);
    setStep("edit");
    setReviewDraft(null);
    setReviewBaseline(identitySnapshot(account));
    setMessage("");
  };
  const editFields = (
    <IdentityFields
      account={account}
      form={form}
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
  accounts,
  context,
}: {
  accounts: ManagedAccount[];
  context: StaffPersonTaskContext;
}) => {
  const target = accounts.find(
    (account) => account.userId === context.targetUserId
  );
  return target ? (
    <section className="mt-8">
      <IdentityChangeForm
        key={target.userId}
        actorName={context.actor.identity?.actorName}
        actorUsername={context.actor.identity?.actorUsername}
        actorUserId={context.actor.userId}
        account={target}
        confirmationExpiresAt={
          context.actor.identity?.confirmationExpiresAt ?? null
        }
        returnHref={context.returnTo.href}
        staffVerified
      />
    </section>
  ) : null;
};
