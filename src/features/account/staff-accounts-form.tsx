"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import * as z from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { membershipStatusLabel } from "@/features/identity/labels";
import { formatChurchTimestamp } from "@/shared/time/church-time";

import type { ManagedAccount, StaffAccountReceipt } from "./staff-accounts";

const storageKey = "efcc.staff-account.operation.v1";
const paths = {
  assisted_account_created: "/api/v2/staff/accounts",
  staff_password_reset: "/api/v2/staff/accounts/password-reset",
  temporary_password_reissued: "/api/v2/staff/accounts/password-reissue",
};
type Action = keyof typeof paths;
interface Operation {
  key: string;
  actorUserId: string;
  action: Action;
  targetUserId: string | null;
}
type Flow =
  | "restoring"
  | "ready"
  | "submitting"
  | "checking"
  | "unknown"
  | "retry"
  | "confirmed";

const actionSchema = z.enum([
  "assisted_account_created",
  "staff_password_reset",
  "temporary_password_reissued",
]);
const opaqueId = z.string().min(1).max(128);
const operationSchema = z
  .strictObject({
    action: actionSchema,
    actorUserId: opaqueId,
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
const post = (path: string, body: object) =>
  fetch(path, {
    body: JSON.stringify(body),
    cache: "no-store",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    method: "POST",
  });

export const StaffAccountsForm = ({
  actorUserId,
  accounts,
}: {
  actorUserId: string;
  accounts: ManagedAccount[];
}) => {
  const router = useRouter();
  const [flow, setFlow] = useState<Flow>("restoring");
  const [message, setMessage] = useState("正在查核未確認的操作。");
  const [operation, setOperation] = useState<Operation | null>(null);
  const [receipt, setReceipt] = useState<StaffAccountReceipt | null>(null);
  const [password, setPassword] = useState<string | null>(null);
  const [targetId, setTargetId] = useState("");
  const busyRef = useRef(false);
  const operationRef = useRef<Operation | null>(null);
  const busy =
    flow === "restoring" || flow === "submitting" || flow === "checking";
  const target = accounts.find((account) => account.userId === targetId);

  const reconcile = useCallback(
    async (saved: Operation) => {
      operationRef.current = saved;
      setOperation(saved);
      setPassword(null);
      setReceipt(null);
      setTargetId(saved.targetUserId ?? "");
      if (saved.actorUserId !== actorUserId) {
        setFlow("unknown");
        setMessage(
          "此瀏覽器保留了另一職員未確認的操作，請以原帳戶登入查核；操作代碼不會被覆蓋或清除。"
        );
        return;
      }
      setFlow("checking");
      setMessage("正在向伺服器查核；暫時不要開始另一項操作。");
      try {
        const response = await post("/api/v2/staff/accounts/reconcile", {
          operationKey: saved.key,
        });
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
        } else if (result.receipt) {
          setReceipt(result.receipt);
          setFlow("confirmed");
          setMessage(
            "伺服器已確認操作完成。原臨時密碼不能再次讀取；未完成交接時，請完成此操作後明確重新發出另一個臨時密碼。"
          );
          router.refresh();
        } else {
          setFlow("retry");
          setMessage(
            "尚未找到完成紀錄，不能當作已成功。請填寫原來的資料重試同一操作；表格及密碼不會保存在此瀏覽器。"
          );
        }
      } catch {
        setFlow("unknown");
        setMessage("連線失敗，結果仍未確認；操作代碼已保留，請再次查核。");
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
      const saved = readOperation();
      if (saved) {
        await reconcile(saved);
      } else {
        operationRef.current = null;
        setOperation(null);
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

  const pendingChanged = (saved: Operation, action: Action) =>
    saved.key !== operationRef.current?.key ||
    saved.action !== action ||
    saved.actorUserId !== actorUserId ||
    (saved.targetUserId !== null && saved.targetUserId !== targetId);
  const submit = async (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busyRef.current || (flow !== "ready" && flow !== "retry")) {
      return;
    }
    const form = event.currentTarget;
    const fields = new FormData(form, event.nativeEvent.submitter);
    const parsedAction = actionSchema.safeParse(fields.get("action"));
    if (!parsedAction.success) {
      return;
    }
    const action = parsedAction.data;
    busyRef.current = true;
    setPassword(null);
    try {
      await navigator.locks.request(storageKey, async () => {
        const saved = readOperation();
        if (saved && pendingChanged(saved, action)) {
          await reconcile(saved);
          return;
        }
        const fresh = saved === null;
        const next = saved ?? {
          action,
          actorUserId,
          key: crypto.randomUUID(),
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
                identityCheck: fields.get("identityCheck"),
                operationKey: next.key,
                targetUserId: next.targetUserId,
              };
        try {
          const response = await post(paths[action], body);
          const result = resultData(await response.json());
          if (
            response.ok &&
            result?.receipt &&
            matchesOperation(result.receipt, next)
          ) {
            form.reset();
            setReceipt(result.receipt);
            setPassword(
              response.status === 201 ? result.temporaryPassword : null
            );
            setFlow("confirmed");
            setMessage(
              "伺服器已確認操作完成；請私下交接新臨時密碼。離開或隱藏此頁後不能再次讀取，遺失時必須明確重新發出。"
            );
          } else if (fresh && response.status === 400) {
            localStorage.removeItem(storageKey);
            operationRef.current = null;
            setOperation(null);
            setFlow("ready");
            setMessage("資料未獲接受，未有完成操作；請檢查欄位及核實方式。");
          } else {
            form.reset();
            await reconcile(next);
          }
        } catch {
          form.reset();
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
  const finish = async () => {
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
        setFlow("ready");
        setMessage("");
        router.refresh();
      });
    } catch {
      setMessage("未能清除操作代碼，請恢復本機儲存後重試。");
    } finally {
      busyRef.current = false;
    }
  };
  const disabled = (action: Action) =>
    busy ||
    (flow !== "ready" &&
      !(
        flow === "retry" &&
        operation?.action === action &&
        operation.actorUserId === actorUserId
      ));
  const recoveryDisabled =
    disabled("staff_password_reset") && disabled("temporary_password_reissued");
  return (
    <div className="mt-8 flex flex-col gap-6">
      <p>
        敏感操作前，請在「帳戶安全」確認目前密碼，確認只在此登入內有效十分鐘。一般職員只可管理其他一般會員；不能管理自己、職員或管理員。
      </p>
      <p role="status" aria-live="polite">
        {message}
      </p>
      {flow === "unknown" || flow === "retry" ? (
        <Button type="button" disabled={busy} onClick={check}>
          查核之前的操作
        </Button>
      ) : null}
      {receipt && operation?.actorUserId === actorUserId ? (
        <section className="border-border rounded-lg border p-5">
          <h2 className="text-lg font-semibold">交接結果</h2>
          <p className="mt-2 break-words">對象帳戶：{receipt.targetUserId}</p>
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
              <Button
                type="button"
                className="mt-3"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(password);
                    setMessage(
                      "已複製臨時密碼，請私下交接。離開或隱藏此頁後不會再次顯示。"
                    );
                  } catch {
                    setMessage(
                      "未能複製，請手動選取臨時密碼；不要把密碼寫入公開訊息。"
                    );
                  }
                }}
              >
                複製臨時密碼
              </Button>
              <p className="mt-3">
                七日後到期，首次登入必須更改。請按已核實的身分／教會原有可靠聯絡途徑，手動透過
                WhatsApp 私下交接；不要使用新提供的聯絡資料作復原憑證。
              </p>
            </>
          ) : (
            <p className="mt-3">
              沒有可再次讀取的密碼。未完成交接時，請明確重新發出。
            </p>
          )}
          <Button type="button" onClick={finish} className="mt-4">
            完成，開始另一項操作
          </Button>
        </section>
      ) : null}
      <form onSubmit={submit} className="border-border rounded-lg border p-5">
        <fieldset
          disabled={disabled("assisted_account_created")}
          className="flex min-w-0 flex-col gap-3"
        >
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
            建立帳戶及發出臨時密碼
          </Button>
        </fieldset>
      </form>
      <form onSubmit={submit} className="border-border rounded-lg border p-5">
        <fieldset
          disabled={recoveryDisabled}
          className="flex min-w-0 flex-col gap-3"
        >
          <legend className="text-lg font-semibold">
            協助復原／重新發出臨時密碼
          </legend>
          <label htmlFor="recovery-target">對象帳戶</label>
          <select
            id="recovery-target"
            value={targetId}
            onChange={(event) => setTargetId(event.target.value)}
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
            重設密碼及登出全部裝置
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
            重新發出臨時密碼
          </Button>
        </fieldset>
      </form>
    </div>
  );
};
