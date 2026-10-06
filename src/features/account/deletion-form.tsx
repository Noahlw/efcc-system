"use client";

import { useSelector } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAppForm } from "@/components/ui/app-form";
import type { AppFormApi } from "@/components/ui/app-form";
import { Button } from "@/components/ui/button";
import { UnsavedChangesLink } from "@/components/unsaved-changes-link";
import { businessRpc } from "@/shared/business-rpc";
import { formatChurchTimestamp } from "@/shared/time/church-time";

import type {
  DeletionReceipt,
  DeletionRequest,
  StoredDeletionOperation,
} from "./deletion-contract";
import {
  deletionConfirmationSchema,
  deletionErrorSchema,
  deletionReceiptResponseSchema,
  storedDeletionOperationSchema,
} from "./deletion-contract";
import {
  AccountOperationOutcome,
  AccountOperationSummary,
} from "./operation-presentation";
import { readTransientReconciliation } from "./reconciliation-query";
import { AccountSecurityForm } from "./security-form";
import { staffAccountIdentifier } from "./staff-account-identifier";
import type { ManagedAccount } from "./staff-accounts";
import type {
  StaffOperationReference,
  StaffPersonTaskContext,
} from "./staff-task-contract";

const storageKey = "efcc.deletion.operation.v1";
type Operation = StoredDeletionOperation & StaffOperationReference;
type Flow =
  | "restoring"
  | "ready"
  | "submitting"
  | "checking"
  | "retry"
  | "unknown"
  | "confirmed";
type Receipt = DeletionReceipt;
const labels = { account_deleted: "永久刪除帳戶" };
const rejectedMessages: Partial<Record<number, string>> = {
  403: "操作未獲授權。請在帳戶安全確認密碼及查核目前權限，再重試原操作。",
  409: "帳戶狀態已改變；尚未找到完成紀錄，請查核對象後重試原操作。",
  429: "操作過於頻密；尚未找到完成紀錄，請稍後查核或重試原操作。",
};
interface DeletionFormValues {
  confirmed: boolean;
}
type DeletionFormApi = AppFormApi<DeletionFormValues>;
const readOperation = () => {
  const raw = localStorage.getItem(storageKey);
  return raw ? storedDeletionOperationSchema.parse(JSON.parse(raw)) : null;
};
const matching = (
  receipt: Receipt,
  operation: Pick<Operation, "action" | "targetUserId">
) =>
  receipt.action === operation.action &&
  receipt.targetUserId === operation.targetUserId;

type DeletionSubmitOutcome =
  | { kind: "confirmed"; receipt: Receipt }
  | { kind: "definitive"; code: string | null; message: string; status: number }
  | { kind: "unknown" };

/** No automatic retry/replay: the write stays UNKNOWN until reconciliation. */
const sendDeletionCommand = async (
  operation: Operation,
  expectedActorUserId: string
): Promise<DeletionSubmitOutcome> => {
  const options = {
    headers: { "x-efcc-expected-actor-id": expectedActorUserId },
    init: { cache: "no-store", credentials: "same-origin" },
  } satisfies Parameters<
    typeof businessRpc.api.v2.staff.accounts.delete.$post
  >[1];
  const body: DeletionRequest = {
    operationKey: operation.key,
    targetUserId: operation.targetUserId,
  };
  const response = await businessRpc.api.v2.staff.accounts.delete.$post(
    { json: body },
    options
  );
  const payload: unknown = await response.json().catch(() => null);
  const result = deletionReceiptResponseSchema.safeParse(payload);
  if (
    (response.status === 200 || response.status === 201) &&
    result.success &&
    result.data.data.receipt &&
    matching(result.data.data.receipt, operation)
  ) {
    return { kind: "confirmed", receipt: result.data.data.receipt };
  }
  if ([400, 401, 403, 409, 429].includes(response.status)) {
    const error = deletionErrorSchema.safeParse(payload);
    return {
      code: error.success ? error.data.error.code : null,
      kind: "definitive",
      message: error.success
        ? error.data.error.message
        : "這次刪除未提交，請再檢查帳戶狀態。",
      status: response.status,
    };
  }
  return { kind: "unknown" };
};

const reconciliationQueryKey = ["deletion-reconciliation"] as const;

const DeletionStatus = ({
  actorUserId,
  flow,
  message,
  operation,
  receipt,
  onCheck,
  onFinish,
}: {
  actorUserId: string;
  flow: Flow;
  message: string;
  operation: Operation | null;
  receipt: Receipt | null;
  onCheck: () => void;
  onFinish: () => void;
}) => {
  if (flow === "confirmed" && receipt) {
    const when = new Date(receipt.createdAt * 1000);
    return (
      <>
        <AccountOperationOutcome
          message={message}
          title="已確認永久刪除帳戶"
          tone="success"
        />
        <AccountOperationSummary
          rows={[
            { label: "操作識別碼", value: receipt.id },
            { label: "對象帳戶識別碼", value: receipt.targetUserId },
            {
              label: "記錄時間（香港）",
              value: (
                <time dateTime={when.toISOString()}>
                  {formatChurchTimestamp(when)}（香港）
                </time>
              ),
            },
          ]}
        />
        {operation?.actorUserId === actorUserId ? (
          <Button type="button" onClick={onFinish} className="mt-3">
            完成，開始另一項操作
          </Button>
        ) : null}
      </>
    );
  }
  return (
    <>
      <p role="status" aria-live="polite" className="mt-3">
        {message}
      </p>
      {flow === "unknown" || flow === "retry" ? (
        <Button type="button" onClick={onCheck} className="mt-3">
          查核之前的操作
        </Button>
      ) : null}
    </>
  );
};

const DeletionWork = ({
  account,
  busy,
  disabled,
  flow,
  form,
  historyBlocked,
  operation,
  retryHere,
  step,
  onEdit,
  onPrepareReview,
  onSubmit,
}: {
  account: Pick<ManagedAccount, "userId" | "fullName" | "username">;
  busy: boolean;
  disabled: boolean;
  flow: Flow;
  form: DeletionFormApi;
  historyBlocked: boolean;
  operation: Operation | null;
  retryHere: boolean;
  step: "edit" | "review";
  onEdit: () => void;
  onPrepareReview: (event: React.SubmitEvent<HTMLFormElement>) => void;
  onSubmit: () => void;
}) => {
  if (flow === "confirmed") {
    return null;
  }
  if (step === "edit") {
    return (
      <form onSubmit={onPrepareReview} className="mt-5">
        <fieldset disabled={disabled} className="flex flex-col gap-3">
          <form.AppField
            name="confirmed"
            validators={{ onSubmit: deletionConfirmationSchema }}
          >
            {(field) => (
              <field.CheckboxField
                id="deletion-confirmed"
                label="我理解帳戶將永久刪除，歷史紀錄及使用者名稱不會刪除或釋放"
              />
            )}
          </form.AppField>
          <Button type="submit">檢查刪除資料</Button>
        </fieldset>
      </form>
    );
  }

  return (
    <section
      aria-labelledby="deletion-review-heading"
      className="border-border bg-surface mt-5 rounded-lg border p-5"
    >
      <h3 className="text-section font-semibold" id="deletion-review-heading">
        檢查永久刪除
      </h3>
      <p className="text-muted-foreground mt-2">
        核對帳戶及保留紀錄；此畫面尚未提交刪除。
      </p>
      <AccountOperationSummary
        rows={[
          {
            label: "對象",
            value: `${account.fullName}（${staffAccountIdentifier(account)}）`,
          },
          { label: "帳戶識別碼", value: account.userId },
          { label: "操作", value: labels.account_deleted },
          { label: "確認", value: "已確認永久刪除及保留使用者名稱" },
          {
            label: "保留紀錄",
            value: "會籍決定、安全及帳戶操作紀錄、操作收據及 Username",
          },
          {
            label: "刪除資格",
            value: historyBlocked
              ? "有教會業務紀錄，請改用會籍停用"
              : "最後提交時會由伺服器再次核實",
          },
          ...(operation
            ? [{ label: "原操作識別碼", value: operation.key }]
            : []),
        ]}
      />
      <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button
          className="w-full sm:w-auto"
          type="button"
          variant="secondary"
          disabled={busy || historyBlocked || (flow !== "ready" && !retryHere)}
          onClick={onEdit}
        >
          返回修改
        </Button>
        <Button
          className="w-full sm:w-auto"
          type="button"
          disabled={disabled}
          onClick={onSubmit}
        >
          {retryHere ? "重試同一刪除操作" : "確認並永久刪除"}
        </Button>
      </div>
    </section>
  );
};

interface DeletionViewProps {
  account: Pick<ManagedAccount, "userId" | "fullName" | "username">;
  actorName?: string;
  actorUserId: string;
  actorUsername: string | null;
  busy: boolean;
  confirmationExpiresAt: number | null;
  confirmationOpen: boolean;
  deactivationHref?: string;
  dirty: boolean;
  disabled: boolean;
  flow: Flow;
  form: DeletionFormApi;
  historyBlocked: boolean;
  message: string;
  onCheck: () => void;
  onConfirmationClose: () => void;
  onConfirmedInWork: () => void;
  onDiscard: () => void;
  onEdit: () => void;
  onFinish: () => void;
  onPrepareReview: (event: React.SubmitEvent<HTMLFormElement>) => void;
  onSubmit: () => void;
  operation: Operation | null;
  receipt: Receipt | null;
  retryHere: boolean;
  returnHref?: string;
  step: "edit" | "review";
}

const DeletionView = ({
  account,
  actorName,
  actorUserId,
  actorUsername,
  busy,
  confirmationExpiresAt,
  confirmationOpen,
  deactivationHref,
  dirty,
  disabled,
  flow,
  form,
  historyBlocked,
  message,
  onCheck,
  onConfirmationClose,
  onConfirmedInWork,
  onDiscard,
  onEdit,
  onFinish,
  onPrepareReview,
  onSubmit,
  operation,
  receipt,
  retryHere,
  returnHref,
  step,
}: DeletionViewProps) => (
  <>
    <section
      aria-label="永久刪除帳戶"
      className={
        returnHref
          ? "flex flex-col"
          : "border-border mt-6 rounded-lg border p-5"
      }
    >
      {returnHref ? (
        <header className="flex flex-wrap items-center gap-3">
          <UnsavedChangesLink
            description="放棄變更會清除未提交的刪除確認；已提交操作的查核記錄會保留。"
            href={returnHref}
            isDirty={dirty && operation === null}
            onDiscard={onDiscard}
          >
            ← 返回帳戶詳情
          </UnsavedChangesLink>
          <h1 className="text-task font-semibold">永久刪除帳戶</h1>
        </header>
      ) : (
        <h2 className="text-section font-semibold">永久刪除帳戶</h2>
      )}
      <p className="text-muted-foreground mt-2 break-all">
        對象：{account.fullName}（{staffAccountIdentifier(account)}）。
      </p>
      <p className="mt-3">
        先在帳戶安全確認目前密碼。此操作移除登入、密碼及工作階段；會籍決定、安全紀錄及所有使用者名稱保留。有教會業務紀錄時必須使用會籍停用。
      </p>
      <DeletionStatus
        actorUserId={actorUserId}
        flow={flow}
        message={message}
        operation={operation}
        receipt={receipt}
        onCheck={onCheck}
        onFinish={onFinish}
      />
      {historyBlocked && deactivationHref ? (
        <UnsavedChangesLink
          description="放棄未提交的刪除確認，前往同一帳戶的會籍停用工作。"
          href={deactivationHref}
          isDirty={dirty && operation === null}
          onDiscard={onDiscard}
        >
          改為停用會籍
        </UnsavedChangesLink>
      ) : null}
      <DeletionWork
        account={account}
        busy={busy}
        disabled={disabled}
        flow={flow}
        form={form}
        historyBlocked={historyBlocked}
        operation={operation}
        retryHere={retryHere}
        step={step}
        onEdit={onEdit}
        onPrepareReview={onPrepareReview}
        onSubmit={onSubmit}
      />
    </section>
    {confirmationOpen ? (
      <AccountSecurityForm
        actorName={actorName}
        actorUserId={actorUserId}
        actorUsername={actorUsername}
        confirmationContext={[
          {
            label: "登入者",
            value: actorName ?? "目前登入帳戶",
          },
          { label: "Username", value: actorUsername ?? "未設定" },
          { label: "工作", value: "永久刪除帳戶" },
          {
            label: "對象",
            value: `${account.fullName}（${staffAccountIdentifier(account)}）`,
          },
        ]}
        confirmationExpiresAt={confirmationExpiresAt}
        confirmationOnly
        onConfirmationClose={onConfirmationClose}
        onConfirmedInWork={onConfirmedInWork}
        task="confirm"
        temporaryPasswordExpired={false}
        temporaryPasswordExpiresAt={null}
      />
    ) : null}
  </>
);

export const AccountDeletionForm = ({
  actorName,
  actorUserId,
  actorUsername = null,
  account,
  available,
  confirmationExpiresAt = null,
  deactivationHref,
  onFinished,
  returnHref,
}: {
  actorName?: string;
  actorUserId: string;
  actorUsername?: string | null;
  account: Pick<ManagedAccount, "userId" | "fullName" | "username">;
  available: boolean;
  confirmationExpiresAt?: number | null;
  deactivationHref?: string;
  onFinished: () => void;
  returnHref?: string;
}) => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [flow, setFlow] = useState<Flow>("restoring");
  const [step, setStep] = useState<"edit" | "review">("edit");
  const [message, setMessage] = useState("正在查核未確認操作。");
  const [operation, setOperation] = useState<Operation | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [historyBlocked, setHistoryBlocked] = useState(false);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [confirmedUntil, setConfirmedUntil] = useState<number | null>(
    confirmationExpiresAt
  );
  const busyRef = useRef(false);
  const form = useAppForm({
    defaultValues: { confirmed: false },
    onSubmit: () => {
      setMessage("");
      setHistoryBlocked(false);
      setStep("review");
    },
  });
  const dirty = useSelector(form.store, (state) => state.isDirty);
  const busy =
    flow === "restoring" || flow === "submitting" || flow === "checking";
  const confirmationIsFresh =
    confirmedUntil !== null && confirmedUntil > Math.floor(Date.now() / 1000);
  const submission = useMutation({
    gcTime: 0,
    mutationFn: ({
      expectedActorUserId,
      operation: saved,
    }: {
      expectedActorUserId: string;
      operation: Operation;
    }) => sendDeletionCommand(saved, expectedActorUserId),
    networkMode: "always",
    retry: false,
  });
  const reconcile = useCallback(
    async (saved: Operation): Promise<"confirmed" | "missing" | "unknown"> => {
      setOperation(saved);
      setReceipt(null);
      if (saved.actorUserId !== actorUserId) {
        setFlow("unknown");
        setMessage(
          "此瀏覽器保留了另一帳戶未確認的操作。請以原帳戶登入查核，操作代碼不會被清除。"
        );
        return "unknown";
      }
      if (saved.targetUserId === account.userId) {
        setStep("review");
      }
      setFlow("checking");
      setMessage("正在向伺服器查核結果。");
      type Reconcile =
        | { kind: "confirmed"; receipt: Receipt }
        | { kind: "missing" }
        | { kind: "unknown" };
      let outcome: Reconcile;
      try {
        outcome = await readTransientReconciliation(
          queryClient,
          reconciliationQueryKey,
          async ({ signal }): Promise<Reconcile> => {
            const response =
              await businessRpc.api.v2.account.changes.reconcile.$post(
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
            if (response.status !== 200) {
              return { kind: "unknown" };
            }
            const parsed = deletionReceiptResponseSchema.safeParse(
              await response.json().catch(() => null)
            );
            if (!parsed.success) {
              return { kind: "unknown" };
            }
            const { receipt: found } = parsed.data.data;
            if (found === null) {
              return { kind: "missing" };
            }
            return matching(found, saved)
              ? { kind: "confirmed", receipt: found }
              : { kind: "unknown" };
          }
        );
      } catch {
        setFlow("unknown");
        setMessage("暫時未能查核，結果仍未確認。操作代碼已保留，請再次查核。");
        return "unknown";
      }
      if (outcome.kind === "confirmed") {
        setReceipt(outcome.receipt);
        setFlow("confirmed");
        setMessage(
          `伺服器已確認「${labels[saved.action]}」完成；對象帳戶：${saved.targetUserId}。`
        );
      } else if (outcome.kind === "missing") {
        setFlow("retry");
        setMessage(
          "尚未找到完成紀錄，不能當作成功。請填寫同一份資料重試原操作。"
        );
      } else {
        setFlow("unknown");
        setMessage("暫時未能查核，結果仍未確認。操作代碼已保留，請再次查核。");
      }
      return outcome.kind;
    },
    [account.userId, actorUserId, queryClient]
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
          setReceipt(null);
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
    operation.targetUserId === account.userId;
  const disabled =
    busy ||
    historyBlocked ||
    (!available && !retryHere) ||
    (flow !== "ready" && !retryHere);
  const prepareReview = (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busyRef.current || disabled || step !== "edit") {
      return;
    }
    void form.handleSubmit();
  };
  const handleDefinitive = async (
    next: Operation,
    outcome: { code: string | null; message: string; status: number },
    fresh: boolean
  ) => {
    if (fresh && outcome.status === 400) {
      localStorage.removeItem(storageKey);
      setOperation(null);
      setStep("edit");
      setFlow("ready");
      setMessage("資料格式不正確，請檢查欄位。");
      return;
    }
    const result = await reconcile(next);
    if (result !== "missing") {
      return;
    }
    if (outcome.status === 409 && outcome.code === "church_history_retained") {
      localStorage.removeItem(storageKey);
      setOperation(null);
      setHistoryBlocked(true);
      setFlow("ready");
      setMessage("此帳戶有教會業務紀錄，不能永久刪除；請使用會籍停用。");
      return;
    }
    if (
      outcome.status === 403 &&
      outcome.code === "password_confirmation_required"
    ) {
      localStorage.removeItem(storageKey);
      setOperation(null);
      setFlow("ready");
      setMessage(outcome.message);
      setConfirmationOpen(true);
      return;
    }
    const rejection = rejectedMessages[outcome.status];
    if (rejection) {
      setMessage(rejection);
    }
  };
  const submit = async () => {
    if (busyRef.current || disabled || step !== "review") {
      return;
    }
    if (!confirmationIsFresh) {
      setMessage(
        "請先確認目前登入密碼；完成後會返回同一份核對資料，再由你明確提交。"
      );
      setConfirmationOpen(true);
      return;
    }
    busyRef.current = true;
    try {
      await navigator.locks.request(storageKey, async () => {
        const saved = readOperation();
        if (
          saved &&
          (saved.actorUserId !== actorUserId ||
            saved.key !== operation?.key ||
            saved.targetUserId !== account.userId ||
            saved.action !== "account_deleted")
        ) {
          await reconcile(saved);
          return;
        }
        const next: Operation = saved ?? {
          action: "account_deleted",
          actorUserId,
          key: crypto.randomUUID(),
          targetUserId: account.userId,
        };
        localStorage.setItem(storageKey, JSON.stringify(next));
        if (readOperation()?.key !== next.key) {
          throw new Error("Metadata unavailable");
        }
        setOperation(next);
        setReceipt(null);
        setHistoryBlocked(false);
        setFlow("submitting");
        setMessage("正在提交，請勿重複按下提交。");
        let outcome: DeletionSubmitOutcome;
        try {
          outcome = await submission.mutateAsync({
            expectedActorUserId: actorUserId,
            operation: next,
          });
        } catch {
          outcome = { kind: "unknown" };
        } finally {
          submission.reset();
        }
        if (outcome.kind === "confirmed") {
          setReceipt(outcome.receipt);
          setFlow("confirmed");
          setMessage(
            `伺服器已確認「${labels[next.action]}」完成；對象帳戶：${next.targetUserId}。`
          );
        } else if (outcome.kind === "definitive") {
          await handleDefinitive(next, outcome, !saved);
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
  const finish = async () => {
    if (
      busyRef.current ||
      flow !== "confirmed" ||
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
        setOperation(null);
        setReceipt(null);
        setStep("edit");
        setHistoryBlocked(false);
        form.reset();
        setFlow("ready");
        setMessage("");
        onFinished();
        router.refresh();
      });
    } catch {
      setMessage("未能清除操作代碼，請恢復本機儲存後再試。");
    } finally {
      busyRef.current = false;
    }
  };
  return (
    <DeletionView
      account={account}
      actorName={actorName}
      actorUserId={actorUserId}
      actorUsername={actorUsername}
      busy={busy}
      confirmationExpiresAt={confirmedUntil}
      confirmationOpen={confirmationOpen}
      deactivationHref={deactivationHref}
      dirty={dirty}
      disabled={disabled}
      flow={flow}
      form={form}
      historyBlocked={historyBlocked}
      message={message}
      onCheck={check}
      onConfirmationClose={() => setConfirmationOpen(false)}
      onConfirmedInWork={() => {
        setConfirmedUntil(Math.floor(Date.now() / 1000) + 600);
        setConfirmationOpen(false);
        setMessage("");
      }}
      onDiscard={() => form.reset()}
      onEdit={() => setStep("edit")}
      onFinish={finish}
      onPrepareReview={prepareReview}
      onSubmit={submit}
      operation={operation}
      receipt={receipt}
      retryHere={retryHere}
      returnHref={returnHref}
      step={step}
    />
  );
};
export const StaffAccountDeletion = ({
  accounts,
  context,
  deactivationHref,
}: {
  accounts: ManagedAccount[];
  context: StaffPersonTaskContext;
  deactivationHref?: string;
}) => {
  const actorUserId = context.actor.userId;
  const { targetUserId } = context;
  const [targetId, setTargetId] = useState(targetUserId);
  const target = accounts.find((account) => account.userId === targetId);
  const recovery = targetId
    ? { fullName: "之前操作的帳戶", userId: targetId, username: null }
    : null;
  const selected = target ?? recovery;
  return (
    <section className="mt-8">
      {selected ? (
        <AccountDeletionForm
          key={targetId}
          actorName={context.actor.identity?.actorName}
          actorUserId={actorUserId}
          actorUsername={context.actor.identity?.actorUsername ?? null}
          account={selected}
          available={Boolean(target)}
          confirmationExpiresAt={
            context.actor.identity?.confirmationExpiresAt ?? null
          }
          deactivationHref={deactivationHref}
          onFinished={() => setTargetId(targetUserId)}
          returnHref={context.returnTo.href}
        />
      ) : null}
    </section>
  );
};
