"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import * as z from "zod";

import { Button } from "@/components/ui/button";
import { membershipStatusLabel } from "@/features/identity/labels";

import { postAccountOperation } from "./post-operation";
import type { ManagedAccount } from "./staff-accounts";

const storageKey = "efcc.restriction.operation.v1";
const actionSchema = z.enum([
  "account_banned",
  "account_unbanned",
  "membership_deactivated",
  "membership_reactivated",
]);
const opaqueId = z.string().min(1).max(128);
const operationSchema = z.strictObject({
  action: actionSchema,
  actorUserId: opaqueId,
  key: z.uuid(),
  rejected: z.literal(true).optional(),
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
const conflictSchema = z.object({
  error: z.object({ code: z.enum(["conflict", "last_effective_admin"]) }),
});
type Flow =
  | "restoring"
  | "ready"
  | "submitting"
  | "checking"
  | "retry"
  | "unknown"
  | "rejected"
  | "confirmed";
const labels = {
  account_banned: "封鎖帳戶",
  account_unbanned: "解除封鎖",
  membership_deactivated: "停用會籍",
  membership_reactivated: "重新啟用會籍",
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
export const RestrictionChangeForm = ({
  actorUserId,
  account,
}: {
  actorUserId: string;
  account: ManagedAccount;
}) => {
  const router = useRouter();
  const [flow, setFlow] = useState<Flow>("restoring");
  const [message, setMessage] = useState("正在查核未確認操作。");
  const [operation, setOperation] = useState<Operation | null>(null);
  const busyRef = useRef(false);
  const busy =
    flow === "restoring" || flow === "submitting" || flow === "checking";
  const reconcile = useCallback(
    async (saved: Operation) => {
      setOperation(saved);
      if (saved.actorUserId !== actorUserId) {
        setFlow("unknown");
        setMessage(
          "此瀏覽器保留了另一帳戶未確認的操作。請以原帳戶登入查核，操作代碼不會被清除。"
        );
        return;
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
        } else if (saved.rejected) {
          setFlow("rejected");
          setMessage(
            "伺服器已拒絕此操作，操作未完成。請按最新帳戶狀態開始另一項操作。"
          );
        } else {
          setFlow("retry");
          setMessage(
            "尚未找到完成紀錄，不能當作成功。請填寫同一份資料重試原操作。"
          );
        }
        router.refresh();
      } catch {
        setFlow("unknown");
        setMessage("暫時未能查核，結果仍未確認。操作代碼已保留，請再次查核。");
      }
    },
    [actorUserId, router]
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
    operation.targetUserId === account.userId;
  const disabled = busy || (flow !== "ready" && !retryHere);
  const permitted = (action: Operation["action"]) => {
    if (action === "account_banned") {
      return account.banned === null;
    }
    if (action === "account_unbanned") {
      return account.banned !== null;
    }
    if (action === "membership_deactivated") {
      return account.membershipStatus === "active";
    }
    return account.membershipStatus === "deactivated";
  };
  const submit = async (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busyRef.current || disabled) {
      return;
    }
    const fields = new FormData(
      event.currentTarget,
      event.nativeEvent.submitter
    );
    const parsed = actionSchema.safeParse(fields.get("action"));
    if (!parsed.success) {
      return;
    }
    const action = parsed.data;
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
        setFlow("submitting");
        setMessage("正在提交，請勿重複按下提交。");
        const body = {
          action: next.action,
          operationKey: next.key,
          targetUserId: next.targetUserId,
        };
        try {
          const response = await postAccountOperation(
            actorUserId,
            "/api/v2/staff/accounts/restrictions",
            body
          );
          const responseBody: unknown = await response.json();
          const result = resultSchema.safeParse(responseBody);
          if (
            response.ok &&
            result.success &&
            result.data.data.receipt &&
            matching(result.data.data.receipt, next)
          ) {
            setFlow("confirmed");
            setMessage(
              `伺服器已確認「${labels[action]}」完成；對象帳戶：${next.targetUserId}。`
            );
            router.refresh();
          } else if (!saved && response.status === 400) {
            localStorage.removeItem(storageKey);
            setOperation(null);
            setFlow("ready");
            setMessage("資料格式不正確，請檢查欄位。");
          } else if (
            response.status === 409 &&
            conflictSchema.safeParse(responseBody).success
          ) {
            const rejected: Operation = { ...next, rejected: true };
            localStorage.setItem(storageKey, JSON.stringify(rejected));
            await reconcile(rejected);
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
  const finish = async () => {
    if (
      busyRef.current ||
      (flow !== "confirmed" && flow !== "rejected") ||
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
        setFlow("ready");
        setMessage("");
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
      aria-label="會籍與安全限制"
      className="border-border mt-6 rounded-lg border p-5"
    >
      <h2 className="text-xl font-semibold">會籍與安全限制</h2>
      <p className="mt-3">
        {account.fullName}：會籍
        {membershipStatusLabel(account.membershipStatus)}，安全限制
        {account.banned === null ? "未封鎖" : "已封鎖"}。
      </p>
      <p className="mt-3">
        先在帳戶安全確認目前密碼。封鎖與會籍停用各自獨立；解除其中一項不會解除另一項。
      </p>
      <p role="status" aria-live="polite" className="mt-3">
        {message}
      </p>
      {flow === "unknown" || flow === "retry" ? (
        <Button type="button" onClick={check} disabled={busy} className="mt-3">
          查核之前的操作
        </Button>
      ) : null}
      {(flow === "confirmed" || flow === "rejected") &&
      operation?.actorUserId === actorUserId ? (
        <Button type="button" onClick={finish} className="mt-3">
          {flow === "rejected"
            ? "操作未完成，開始另一項操作"
            : "完成，開始另一項操作"}
        </Button>
      ) : null}
      <form onSubmit={submit} className="mt-5 flex flex-col gap-3">
        {actionSchema.options.map((action) => (
          <Button
            key={action}
            type="submit"
            name="action"
            value={action}
            disabled={
              disabled ||
              (flow === "retry"
                ? operation?.action !== action
                : !permitted(action))
            }
          >
            {labels[action]}
          </Button>
        ))}
      </form>
    </section>
  );
};
export const StaffRestrictions = ({
  actorUserId,
  accounts,
  targetUserId,
}: {
  actorUserId: string;
  accounts: ManagedAccount[];
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
          <label htmlFor="restriction-target">選擇處理限制的帳戶</label>
          <select
            id="restriction-target"
            value={targetId}
            disabled={!ready}
            onChange={(event) => setTargetId(event.target.value)}
            className="border-border bg-surface mt-3 min-h-11 w-full rounded-md border px-3 text-base"
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
        <RestrictionChangeForm
          key={target.userId}
          actorUserId={actorUserId}
          account={target}
        />
      ) : null}
    </section>
  );
};
