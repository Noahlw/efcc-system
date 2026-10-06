"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { businessRpc } from "@/shared/business-rpc";

import type { AccountOperationSummaryRow } from "./operation-presentation";
import { readTransientReconciliation } from "./reconciliation-query";
import {
  securityReceiptResponseSchema,
  storedSecurityOperationSchema,
} from "./security-contract";
import type {
  AccountSecurityAction,
  AccountSecurityReceipt,
} from "./security-contract";
import {
  AccountSecurityConfirmationDialog,
  AccountSecurityTaskPage,
} from "./security-form-views";

const storageKey = "efcc.account-security.operation.v1";
const labels: Record<AccountSecurityAction, string> = {
  other_sessions_revoked: "登出其他裝置",
  password_changed: "更改密碼",
  password_confirmed: "確認目前密碼",
};

export interface AccountSecurityOperation {
  key: string;
  actorUserId: string;
  action: AccountSecurityAction;
}
type Operation = AccountSecurityOperation;
export type AccountSecurityFlow =
  | "restoring"
  | "ready"
  | "submitting"
  | "checking"
  | "unknown"
  | "retry"
  | "confirmed";
type Flow = AccountSecurityFlow;
export type AccountSecurityTask =
  | "security"
  | "password"
  | "sessions"
  | "confirm";

/** Feature-owned sensitive command; the password only lives inside the request. */
export type SecurityCommandInput =
  | { action: "password_changed"; currentPassword: string; newPassword: string }
  | { action: "password_confirmed"; password: string }
  | { action: "other_sessions_revoked" };

type SecurityCommand = SecurityCommandInput & {
  actorUserId: string;
  operationKey: string;
};

type SecuritySubmitOutcome =
  | { kind: "confirmed"; receipt: AccountSecurityReceipt }
  | { kind: "invalid" }
  | { kind: "unknown" };

const sendSecurityCommand = async (
  command: SecurityCommand
): Promise<SecuritySubmitOutcome> => {
  const options = {
    headers: { "x-efcc-expected-actor-id": command.actorUserId },
    init: { cache: "no-store", credentials: "same-origin" },
  } satisfies Parameters<typeof businessRpc.api.v2.account.password.$post>[1];
  const { operationKey } = command;
  let response: { json: () => Promise<unknown>; status: number };
  if (command.action === "password_changed") {
    response = await businessRpc.api.v2.account.password.$post(
      {
        json: {
          currentPassword: command.currentPassword,
          newPassword: command.newPassword,
          operationKey,
        },
      },
      options
    );
  } else if (command.action === "other_sessions_revoked") {
    response = await businessRpc.api.v2.account.sessions["revoke-others"].$post(
      { json: { operationKey } },
      options
    );
  } else {
    response = await businessRpc.api.v2.account["password-confirmation"].$post(
      { json: { operationKey, password: command.password } },
      options
    );
  }
  // Every response body is read, including typed failures such as the stale
  // page's 409 `actor_changed`: an unread body leaves the response stream
  // incomplete for the browser and any other reader.
  const body: unknown = await response.json().catch(() => null);
  if (response.status !== 200 && response.status !== 201) {
    return { kind: response.status === 400 ? "invalid" : "unknown" };
  }
  const parsed = securityReceiptResponseSchema.safeParse(body);
  if (!parsed.success || parsed.data.data.receipt?.action !== command.action) {
    return { kind: "unknown" };
  }
  return { kind: "confirmed", receipt: parsed.data.data.receipt };
};

type ReconciliationOutcome =
  | { kind: "confirmed"; receipt: AccountSecurityReceipt }
  | { kind: "not_found" }
  | { kind: "unverified" };

const reconciliationQueryKey = ["account-security-reconciliation"] as const;

const readOperation = (): Operation | null => {
  const saved = localStorage.getItem(storageKey);
  if (!saved) {
    return null;
  }
  const parsed = storedSecurityOperationSchema.safeParse(JSON.parse(saved));
  if (!parsed.success) {
    throw new Error("Invalid security operation metadata");
  }
  return parsed.data;
};

export const AccountSecurityForm = ({
  actorUserId,
  actorName,
  actorUsername,
  confirmationExpiresAt,
  temporaryPasswordExpiresAt,
  temporaryPasswordExpired,
  task,
  confirmationOnly = false,
  confirmationContext = [],
  onConfirmationClose,
  onConfirmedInWork,
}: {
  actorUserId: string;
  actorName?: string;
  actorUsername?: string | null;
  confirmationExpiresAt: number | null;
  temporaryPasswordExpiresAt: number | null;
  temporaryPasswordExpired: boolean;
  task: AccountSecurityTask;
  confirmationOnly?: boolean;
  confirmationContext?: readonly AccountOperationSummaryRow[];
  onConfirmationClose?: () => void;
  onConfirmedInWork?: () => void;
}) => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [flow, setFlow] = useState<Flow>("restoring");
  const [message, setMessage] = useState("正在查核未確認的操作。");
  const [operation, setOperation] = useState<Operation | null>(null);
  const operationRef = useRef<Operation | null>(null);
  const busyRef = useRef(false);
  const busy =
    flow === "restoring" || flow === "checking" || flow === "submitting";

  const submission = useMutation({
    gcTime: 0,
    mutationFn: sendSecurityCommand,
    networkMode: "always",
    retry: false,
  });

  const reconcile = useCallback(
    async (saved: Operation) => {
      operationRef.current = saved;
      setOperation(saved);
      if (saved.actorUserId !== actorUserId) {
        setFlow("unknown");
        setMessage(
          "此瀏覽器保留了另一帳戶未確認的操作。請以原帳戶登入查核；操作代碼不會被覆蓋或清除。"
        );
        return;
      }
      setFlow("checking");
      setMessage("正在向伺服器查核結果。");
      let outcome: ReconciliationOutcome;
      try {
        outcome = await readTransientReconciliation(
          queryClient,
          reconciliationQueryKey,
          async ({ signal }): Promise<ReconciliationOutcome> => {
            const response =
              await businessRpc.api.v2.account.security.reconcile.$post(
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
              return { kind: "unverified" };
            }
            const parsed = securityReceiptResponseSchema.safeParse(body);
            if (!parsed.success) {
              return { kind: "unverified" };
            }
            const { receipt } = parsed.data.data;
            if (receipt === null) {
              return { kind: "not_found" };
            }
            return receipt.action === saved.action
              ? { kind: "confirmed", receipt }
              : { kind: "unverified" };
          }
        );
      } catch {
        setFlow("unknown");
        setMessage("連線失敗，結果仍未確認。操作代碼已保留，請再次查核。");
        return;
      }
      if (outcome.kind === "confirmed") {
        setFlow("confirmed");
        setMessage(
          `伺服器已確認「${labels[outcome.receipt.action]}」完成。這是操作紀錄，目前密碼確認狀態以最新查核為準。`
        );
      } else if (outcome.kind === "not_found") {
        setFlow("retry");
        setMessage(
          "尚未找到完成紀錄，不能當作已成功。請填寫同一份密碼資料重試原操作；密碼不會保存在此瀏覽器。"
        );
      } else {
        setFlow("unknown");
        setMessage(
          "暫時未能查核結果，請稍後再查核或以原帳戶重新登入。未確認前不要開始另一項操作。"
        );
      }
    },
    [actorUserId, queryClient]
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
        "無法讀取本機操作代碼，請恢復瀏覽器儲存後再次查核；未有提交新操作。"
      );
    } finally {
      busyRef.current = false;
    }
  }, [reconcile]);

  useEffect(() => {
    void check();
  }, [check]);

  const submit = async (input: SecurityCommandInput) => {
    const { action } = input;
    if (busyRef.current || (flow !== "ready" && flow !== "retry")) {
      return;
    }
    busyRef.current = true;
    try {
      await navigator.locks.request(storageKey, async () => {
        const saved = readOperation();
        if (
          saved &&
          (saved.key !== operationRef.current?.key ||
            saved.action !== action ||
            saved.actorUserId !== actorUserId)
        ) {
          await reconcile(saved);
          return;
        }
        const fresh = saved === null;
        const next = saved ?? { action, actorUserId, key: crypto.randomUUID() };
        localStorage.setItem(storageKey, JSON.stringify(next));
        if (readOperation()?.key !== next.key) {
          throw new Error("Operation metadata was not persisted");
        }
        operationRef.current = next;
        setOperation(next);
        setFlow("submitting");
        setMessage("正在提交，請勿重複按下提交。");
        let outcome: SecuritySubmitOutcome;
        try {
          outcome = await submission.mutateAsync({
            ...input,
            actorUserId,
            operationKey: next.key,
          });
        } catch {
          outcome = { kind: "unknown" };
        } finally {
          submission.reset();
        }
        if (outcome.kind === "confirmed") {
          setFlow("confirmed");
          setMessage(`伺服器已確認「${labels[outcome.receipt.action]}」完成。`);
        } else if (fresh && outcome.kind === "invalid") {
          localStorage.removeItem(storageKey);
          operationRef.current = null;
          setOperation(null);
          setFlow("ready");
          setMessage(
            "資料未獲接受，未有完成操作。請檢查目前密碼及新密碼規則。"
          );
        } else {
          await reconcile(next);
        }
      });
    } catch {
      setFlow("unknown");
      setMessage(
        "未能安全讀寫操作代碼或取得瀏覽器鎖，未有確認結果。請恢復本機儲存後再次查核。"
      );
    } finally {
      busyRef.current = false;
    }
  };

  const finish = async () => {
    if (flow !== "confirmed" || busyRef.current) {
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
        if (readOperation() !== null) {
          throw new Error("Operation metadata remains stored.");
        }
        operationRef.current = null;
        setOperation(null);
        setFlow("ready");
        setMessage("");
        if (confirmationOnly) {
          if (operation?.action === "password_confirmed") {
            router.refresh();
            onConfirmedInWork?.();
          } else {
            onConfirmationClose?.();
          }
          return;
        }
        if (temporaryPasswordExpiresAt !== null) {
          router.replace("/account");
        } else if (task !== "security") {
          router.replace("/account?task=security");
        }
        router.refresh();
      });
    } catch {
      setMessage("未能清除本機操作代碼，請檢查儲存設定後重試。");
    } finally {
      busyRef.current = false;
    }
  };
  const disabled = (action: AccountSecurityAction) =>
    (temporaryPasswordExpiresAt !== null &&
      (action !== "password_changed" || temporaryPasswordExpired)) ||
    busy ||
    (flow !== "ready" &&
      !(
        flow === "retry" &&
        operation?.action === action &&
        operation.actorUserId === actorUserId
      ));
  if (confirmationOnly) {
    return (
      <AccountSecurityConfirmationDialog
        actorName={actorName}
        actorUserId={actorUserId}
        actorUsername={actorUsername}
        busy={busy}
        disabled={disabled}
        flow={flow}
        message={message}
        onCheck={check}
        onClose={() => onConfirmationClose?.()}
        onFinish={finish}
        onSubmit={submit}
        operation={operation}
        rows={confirmationContext}
      />
    );
  }

  return (
    <AccountSecurityTaskPage
      actorName={actorName}
      actorUserId={actorUserId}
      actorUsername={actorUsername}
      busy={busy}
      confirmationExpiresAt={confirmationExpiresAt}
      disabled={disabled}
      flow={flow}
      message={message}
      onCheck={check}
      onFinish={finish}
      onSubmit={submit}
      operation={operation}
      task={task}
      temporaryPasswordExpired={temporaryPasswordExpired}
      temporaryPasswordExpiresAt={temporaryPasswordExpiresAt}
    />
  );
};
