"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import * as z from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
type Flow =
  | "restoring"
  | "ready"
  | "submitting"
  | "checking"
  | "retry"
  | "unknown"
  | "confirmed";
const labels = {
  own_phone_changed: "更改電話",
  staff_identity_corrected: "職員核實修正身分資料",
  staff_shared_phone_corrected: "職員核實共用電話例外",
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
interface IdentityContact {
  userId: string;
  fullName: string;
  username: string | null;
  email: string;
  phone: string | null;
  phoneShared: number;
  verifiedRecoveryPhone?: string | null;
}
const IdentityFields = ({
  account,
  staffVerified,
}: {
  account: IdentityContact;
  staffVerified: boolean;
}) => (
  <>
    <legend className="font-semibold">{account.fullName}</legend>
    {staffVerified ? (
      <>
        <label htmlFor="identity-name">中文全名</label>
        <Input
          id="identity-name"
          name="fullName"
          autoComplete="name"
          defaultValue={account.fullName}
          maxLength={200}
          required
        />
        <label htmlFor="identity-username">使用者名稱</label>
        <Input
          id="identity-username"
          name="username"
          autoComplete="off"
          defaultValue={account.username ?? ""}
          minLength={3}
          maxLength={30}
          pattern="[A-Za-z0-9_.]{3,30}"
          required
        />
        <label htmlFor="identity-email">電郵（沒有電郵可留空）</label>
        <Input
          id="identity-email"
          name="email"
          type="email"
          autoComplete="email"
          defaultValue={account.email.endsWith(".invalid") ? "" : account.email}
          maxLength={254}
        />
      </>
    ) : null}
    <label htmlFor="identity-phone">
      {staffVerified ? "修正電話" : "新電話"}
    </label>
    <Input
      id="identity-phone"
      name="phone"
      type="tel"
      autoComplete="tel"
      defaultValue={account.phone ?? ""}
      maxLength={40}
      required
    />
    {staffVerified ? (
      <>
        <label className="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            name="sharedPhone"
            defaultChecked={!!account.phoneShared}
          />
          已核實共用電話例外
        </label>
        <label htmlFor="identity-check">身分核實方式</label>
        <select
          id="identity-check"
          name="identityCheck"
          className="border-border bg-surface min-h-11 rounded-md border px-3 text-base"
        >
          <option value="face_to_face">親身核實</option>
          {account.verifiedRecoveryPhone === null ? null : (
            <option value="verified_phone">
              透過教會原有已核實電話主動聯絡（必須已有核實紀錄）
            </option>
          )}
        </select>
        <label className="flex min-h-11 items-center gap-3">
          <input type="checkbox" required />
          已按以上方式核實本人，新聯絡資料沒有用作復原憑證
        </label>
      </>
    ) : null}
    <Button type="submit">{staffVerified ? "提交核實修正" : "更改電話"}</Button>
  </>
);
export const IdentityChangeForm = ({
  actorUserId,
  account,
  staffVerified,
}: {
  actorUserId: string;
  account: IdentityContact;
  staffVerified: boolean;
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
    operation.targetUserId === account.userId &&
    (staffVerified
      ? operation.action !== "own_phone_changed"
      : operation.action === "own_phone_changed");
  const disabled = busy || (flow !== "ready" && !retryHere);
  const submit = async (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busyRef.current || disabled) {
      return;
    }
    const fields = new FormData(event.currentTarget);
    let action: Operation["action"] = "own_phone_changed";
    if (staffVerified) {
      action =
        fields.get("sharedPhone") === "on"
          ? "staff_shared_phone_corrected"
          : "staff_identity_corrected";
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
        const body = staffVerified
          ? {
              email: fields.get("email") || null,
              fullName: fields.get("fullName"),
              identityCheck: fields.get("identityCheck"),
              operationKey: next.key,
              phone: fields.get("phone"),
              sharedPhone: fields.get("sharedPhone") === "on",
              targetUserId: next.targetUserId,
              username: fields.get("username"),
            }
          : { operationKey: next.key, phone: fields.get("phone") };
        try {
          const response = await postAccountOperation(
            actorUserId,
            staffVerified
              ? "/api/v2/staff/accounts/identity"
              : "/api/v2/account/phone",
            body
          );
          const result = resultSchema.safeParse(await response.json());
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
      className="border-border mt-6 rounded-lg border p-5"
      aria-label={staffVerified ? "職員核實修正身分資料" : "更改自己的電話"}
    >
      <h2 className="text-xl font-semibold">
        {staffVerified ? "職員核實修正身分資料" : "更改自己的電話"}
      </h2>
      <p className="mt-3">
        {staffVerified
          ? "先確認目前密碼並核實本人身分。原有使用者名稱仍永久保留；電郵變更後未經驗證，不會啟用電郵登入或復原。"
          : "姓名、使用者名稱及電郵須由職員核實修正。新電話須未被其他帳戶使用；不會自動成為已核實復原電話。"}
      </p>
      <p role="status" aria-live="polite" className="mt-3">
        {message}
      </p>
      {flow === "unknown" || flow === "retry" ? (
        <Button type="button" onClick={check} disabled={busy} className="mt-3">
          查核之前的操作
        </Button>
      ) : null}
      {flow === "confirmed" && operation?.actorUserId === actorUserId ? (
        <Button type="button" onClick={finish} className="mt-3">
          完成，開始另一項操作
        </Button>
      ) : null}
      <form onSubmit={submit} className="mt-5">
        <fieldset disabled={disabled} className="flex flex-col gap-3">
          <IdentityFields
            key={JSON.stringify(account)}
            account={account}
            staffVerified={staffVerified}
          />
        </fieldset>
      </form>
    </section>
  );
};
export const StaffIdentityCorrections = ({
  actorUserId,
  accounts,
}: {
  actorUserId: string;
  accounts: ManagedAccount[];
}) => {
  const [targetId, setTargetId] = useState("");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
  }, []);
  const target = accounts.find((account) => account.userId === targetId);
  return (
    <section className="mt-8">
      <label htmlFor="identity-target">選擇修正資料的帳戶</label>
      <select
        id="identity-target"
        className="border-border bg-surface mt-3 min-h-11 w-full rounded-md border px-3 text-base"
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
      {target ? (
        <IdentityChangeForm
          key={target.userId}
          actorUserId={actorUserId}
          account={target}
          staffVerified
        />
      ) : null}
    </section>
  );
};
