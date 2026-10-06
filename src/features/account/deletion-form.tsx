"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import * as z from "zod";

import { Button } from "@/components/ui/button";
import { UnsavedChangesLink } from "@/components/unsaved-changes-link";
import { formatChurchTimestamp } from "@/shared/time/church-time";

import {
  AccountOperationOutcome,
  AccountOperationSummary,
} from "./operation-presentation";
import { postAccountOperation } from "./post-operation";
import { staffAccountIdentifier } from "./staff-account-identifier";
import type { ManagedAccount } from "./staff-accounts";

const storageKey = "efcc.deletion.operation.v1";
const actionSchema = z.enum(["account_deleted"]);
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
type Flow =
  | "restoring"
  | "ready"
  | "submitting"
  | "checking"
  | "retry"
  | "unknown"
  | "confirmed";
type Receipt = z.infer<typeof receiptSchema>;
const labels = { account_deleted: "永久刪除帳戶" };
const rejectedMessages: Partial<Record<number, string>> = {
  403: "操作未獲授權。請在帳戶安全確認密碼及查核目前權限，再重試原操作。",
  409: "帳戶狀態已改變；尚未找到完成紀錄，請查核對象後重試原操作。",
  429: "操作過於頻密；尚未找到完成紀錄，請稍後查核或重試原操作。",
};
const readOperation = () => {
  const raw = localStorage.getItem(storageKey);
  return raw ? operationSchema.parse(JSON.parse(raw)) : null;
};
const matching = (
  receipt: z.infer<typeof receiptSchema>,
  operation: Operation
) =>
  receipt.action === operation.action &&
  receipt.targetUserId === operation.targetUserId;
const completedReceipt = (
  response: Response,
  payload: unknown,
  operation: Operation
): Receipt | null => {
  const result = resultSchema.safeParse(payload);
  const receipt = result.success ? result.data.data.receipt : null;
  return response.ok && receipt && matching(receipt, operation)
    ? receipt
    : null;
};

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
  historyBlocked,
  operation,
  retryHere,
  step,
  onDirty,
  onEdit,
  onPrepareReview,
  onSubmit,
}: {
  account: Pick<ManagedAccount, "userId" | "fullName" | "username">;
  busy: boolean;
  disabled: boolean;
  flow: Flow;
  historyBlocked: boolean;
  operation: Operation | null;
  retryHere: boolean;
  step: "edit" | "review";
  onDirty: () => void;
  onEdit: () => void;
  onPrepareReview: (event: React.SubmitEvent<HTMLFormElement>) => void;
  onSubmit: () => void;
}) => {
  if (flow === "confirmed") {
    return null;
  }
  if (step === "edit") {
    return (
      <form onChange={onDirty} onSubmit={onPrepareReview} className="mt-5">
        <fieldset disabled={disabled} className="flex flex-col gap-3">
          <label className="flex min-h-11 items-center gap-3">
            <input type="checkbox" required className="h-5 w-5 shrink-0" />
            我理解帳戶將永久刪除，歷史紀錄及使用者名稱不會刪除或釋放
          </label>
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

export const AccountDeletionForm = ({
  actorUserId,
  account,
  available,
  deactivationHref,
  onFinished,
  returnHref,
}: {
  actorUserId: string;
  account: Pick<ManagedAccount, "userId" | "fullName" | "username">;
  available: boolean;
  deactivationHref?: string;
  onFinished: () => void;
  returnHref?: string;
}) => {
  const router = useRouter();
  const [flow, setFlow] = useState<Flow>("restoring");
  const [step, setStep] = useState<"edit" | "review">("edit");
  const [message, setMessage] = useState("正在查核未確認操作。");
  const [operation, setOperation] = useState<Operation | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [historyBlocked, setHistoryBlocked] = useState(false);
  const [dirty, setDirty] = useState(false);
  const busyRef = useRef(false);
  const busy =
    flow === "restoring" || flow === "submitting" || flow === "checking";
  const reconcile = useCallback(
    async (saved: Operation) => {
      setOperation(saved);
      setReceipt(null);
      if (saved.actorUserId !== actorUserId) {
        setFlow("unknown");
        setMessage(
          "此瀏覽器保留了另一帳戶未確認的操作。請以原帳戶登入查核，操作代碼不會被清除。"
        );
        return;
      }
      if (saved.targetUserId === account.userId) {
        setStep("review");
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
          setReceipt(parsed.data.data.receipt);
          setFlow("confirmed");
          setMessage(
            `伺服器已確認「${labels[saved.action]}」完成；對象帳戶：${saved.targetUserId}。`
          );
          return true;
        }
        setFlow("retry");
        setMessage(
          "尚未找到完成紀錄，不能當作成功。請填寫同一份資料重試原操作。"
        );
        return false;
      } catch {
        setFlow("unknown");
        setMessage("暫時未能查核，結果仍未確認。操作代碼已保留，請再次查核。");
      }
    },
    [account.userId, actorUserId]
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
    setMessage("");
    setHistoryBlocked(false);
    setStep("review");
  };
  const submit = async () => {
    if (busyRef.current || disabled || step !== "review") {
      return;
    }
    const action = operation?.action ?? "account_deleted";
    busyRef.current = true;
    try {
      await navigator.locks.request(storageKey, async () => {
        const saved = readOperation();
        if (
          saved &&
          (saved.actorUserId !== actorUserId ||
            saved.key !== operation?.key ||
            saved.targetUserId !== account.userId ||
            saved.action !== action)
        ) {
          await reconcile(saved);
          return;
        }
        const next = saved ?? {
          action,
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
        const body = {
          operationKey: next.key,
          targetUserId: next.targetUserId,
        };
        try {
          const response = await postAccountOperation(
            actorUserId,
            "/api/v2/staff/accounts/delete",
            body
          );
          const payload = await response.json();
          const completed = completedReceipt(response, payload, next);
          if (completed) {
            setReceipt(completed);
            setFlow("confirmed");
            setMessage(
              `伺服器已確認「${labels[action]}」完成；對象帳戶：${next.targetUserId}。`
            );
          } else if (!saved && response.status === 400) {
            localStorage.removeItem(storageKey);
            setOperation(null);
            setFlow("ready");
            setStep("edit");
            setMessage("資料格式不正確，請檢查欄位。");
          } else {
            const found = await reconcile(next);
            const history = z
              .object({
                error: z.object({ code: z.literal("church_history_retained") }),
              })
              .safeParse(payload);
            if (found === false && response.status === 409 && history.success) {
              localStorage.removeItem(storageKey);
              setOperation(null);
              setHistoryBlocked(true);
              setFlow("ready");
              setMessage(
                "此帳戶有教會業務紀錄，不能永久刪除；請使用會籍停用。"
              );
            } else if (found === false) {
              const rejection = rejectedMessages[response.status];
              if (rejection) {
                setMessage(rejection);
              }
            }
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
        setDirty(false);
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
            onDiscard={() => setDirty(false)}
          >
            ← 返回帳戶詳情
          </UnsavedChangesLink>
          <h1 className="text-task font-semibold">永久刪除帳戶</h1>
        </header>
      ) : null}
      {returnHref ? null : (
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
        onCheck={check}
        onFinish={finish}
      />
      {historyBlocked && deactivationHref ? (
        <UnsavedChangesLink
          description="放棄未提交的刪除確認，前往同一帳戶的會籍停用工作。"
          href={deactivationHref}
          isDirty={dirty && operation === null}
          onDiscard={() => setDirty(false)}
        >
          改為停用會籍
        </UnsavedChangesLink>
      ) : null}
      <DeletionWork
        account={account}
        busy={busy}
        disabled={disabled}
        flow={flow}
        historyBlocked={historyBlocked}
        operation={operation}
        retryHere={retryHere}
        step={step}
        onDirty={() => setDirty(true)}
        onEdit={() => setStep("edit")}
        onPrepareReview={prepareReview}
        onSubmit={submit}
      />
    </section>
  );
};
export const StaffAccountDeletion = ({
  actorUserId,
  accounts,
  deactivationHref,
  returnHref,
  targetUserId,
}: {
  actorUserId: string;
  accounts: ManagedAccount[];
  deactivationHref?: string;
  returnHref?: string;
  targetUserId?: string;
}) => {
  const [targetId, setTargetId] = useState(targetUserId ?? "");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      const saved = readOperation();
      if (saved && !targetUserId) {
        setTargetId(saved.targetUserId);
      }
    } catch {
      setTargetId("unconfirmed");
    }
    setReady(true);
  }, [targetUserId]);
  const target = accounts.find((account) => account.userId === targetId);
  const recovery = targetId
    ? { fullName: "之前操作的帳戶", userId: targetId, username: null }
    : null;
  const selected = target ?? recovery;
  return (
    <section className={targetUserId ? "" : "mt-8"}>
      {targetUserId ? null : (
        <>
          <label htmlFor="deletion-target">選擇永久刪除的帳戶</label>
          <select
            id="deletion-target"
            value={targetId}
            disabled={!ready}
            onChange={(event) => setTargetId(event.target.value)}
            className="border-input-border bg-surface mt-3 min-h-[52px] w-full rounded-md border px-3 py-3 text-base"
          >
            <option value="">請選擇帳戶</option>
            {recovery && !target ? (
              <option value={targetId}>查核之前的刪除操作</option>
            ) : null}
            {accounts.map((account) => (
              <option key={account.userId} value={account.userId}>
                {account.fullName}（{staffAccountIdentifier(account)}）
              </option>
            ))}
          </select>
        </>
      )}
      {selected ? (
        <AccountDeletionForm
          key={targetId}
          actorUserId={actorUserId}
          account={selected}
          available={Boolean(target)}
          deactivationHref={deactivationHref}
          onFinished={() => setTargetId(targetUserId ?? "")}
          returnHref={returnHref}
        />
      ) : null}
    </section>
  );
};
