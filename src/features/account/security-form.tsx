"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import type { AccountOperationSummaryRow } from "./operation-presentation";
import { postAccountOperation } from "./post-operation";
import type { AccountSecurityAction, AccountSecurityReceipt } from "./security";
import {
  AccountSecurityConfirmationDialog,
  AccountSecurityTaskPage,
} from "./security-form-views";

const storageKey = "efcc.account-security.operation.v1";
const uuidPattern =
  /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/iu;
const paths = {
  other_sessions_revoked: "/api/v2/account/sessions/revoke-others",
  password_changed: "/api/v2/account/password",
  password_confirmed: "/api/v2/account/password-confirmation",
};
const labels = {
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

export interface PasswordDraft {
  confirmPassword: string;
  currentPassword: string;
  newPassword: string;
}

const emptyPasswordDraft: PasswordDraft = {
  confirmPassword: "",
  currentPassword: "",
  newPassword: "",
};

const readOperation = (): Operation | null => {
  const saved = localStorage.getItem(storageKey);
  if (!saved) {
    return null;
  }
  const value: unknown = JSON.parse(saved);
  if (
    typeof value !== "object" ||
    value === null ||
    !("key" in value) ||
    typeof value.key !== "string" ||
    !uuidPattern.test(value.key) ||
    !("actorUserId" in value) ||
    typeof value.actorUserId !== "string" ||
    !value.actorUserId ||
    value.actorUserId.length > 128 ||
    !("action" in value) ||
    (value.action !== "password_changed" &&
      value.action !== "other_sessions_revoked" &&
      value.action !== "password_confirmed")
  ) {
    throw new Error("Invalid security operation metadata");
  }
  return {
    action: value.action,
    actorUserId: value.actorUserId,
    key: value.key,
  };
};

const readReceipt = (
  body: unknown
): AccountSecurityReceipt | null | undefined => {
  if (
    typeof body !== "object" ||
    body === null ||
    !("data" in body) ||
    typeof body.data !== "object" ||
    body.data === null ||
    !("receipt" in body.data)
  ) {
    return undefined;
  }
  const value = body.data.receipt;
  if (value === null) {
    return null;
  }
  if (
    typeof value !== "object" ||
    !("id" in value) ||
    typeof value.id !== "string" ||
    !uuidPattern.test(value.id) ||
    !("createdAt" in value) ||
    typeof value.createdAt !== "number" ||
    !Number.isSafeInteger(value.createdAt) ||
    !("action" in value) ||
    (value.action !== "password_changed" &&
      value.action !== "other_sessions_revoked" &&
      value.action !== "password_confirmed")
  ) {
    return undefined;
  }
  return { action: value.action, createdAt: value.createdAt, id: value.id };
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
  const [flow, setFlow] = useState<Flow>("restoring");
  const [message, setMessage] = useState("正在查核未確認的操作。");
  const [operation, setOperation] = useState<Operation | null>(null);
  const [passwordDraft, setPasswordDraft] = useState(emptyPasswordDraft);
  const [confirmationPassword, setConfirmationPassword] = useState("");
  const operationRef = useRef<Operation | null>(null);
  const busyRef = useRef(false);
  const busy =
    flow === "restoring" || flow === "checking" || flow === "submitting";

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
      try {
        const response = await postAccountOperation(
          actorUserId,
          "/api/v2/account/security/reconcile",
          {
            operationKey: saved.key,
          }
        );
        const receipt = readReceipt(await response.json());
        if (
          !response.ok ||
          receipt === undefined ||
          (receipt && receipt.action !== saved.action)
        ) {
          setFlow("unknown");
          setMessage(
            "暫時未能查核結果，請稍後再查核或以原帳戶重新登入。未確認前不要開始另一項操作。"
          );
        } else if (receipt) {
          setFlow("confirmed");
          setMessage(
            `伺服器已確認「${labels[receipt.action]}」完成。這是操作紀錄，目前密碼確認狀態以最新查核為準。`
          );
        } else {
          setFlow("retry");
          setMessage(
            "尚未找到完成紀錄，不能當作已成功。請填寫同一份密碼資料重試原操作；密碼不會保存在此瀏覽器。"
          );
        }
      } catch {
        setFlow("unknown");
        setMessage("連線失敗，結果仍未確認。操作代碼已保留，請再次查核。");
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
        "無法讀取本機操作代碼，請恢復瀏覽器儲存後再次查核；未有提交新操作。"
      );
    } finally {
      busyRef.current = false;
    }
  }, [reconcile]);

  useEffect(() => {
    void check();
  }, [check]);

  const submit = async (
    event: React.SubmitEvent<HTMLFormElement>,
    action: AccountSecurityAction
  ) => {
    event.preventDefault();
    if (busyRef.current || (flow !== "ready" && flow !== "retry")) {
      return;
    }
    const form = event.currentTarget;
    const fields = new FormData(form);
    if (
      action === "password_changed" &&
      fields.get("newPassword") !== fields.get("confirmPassword")
    ) {
      setMessage("兩次輸入的新密碼不相同。");
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
        let body: object = { operationKey: next.key };
        if (action === "password_changed") {
          body = {
            currentPassword: fields.get("currentPassword"),
            newPassword: fields.get("newPassword"),
            operationKey: next.key,
          };
        } else if (action === "password_confirmed") {
          body = { operationKey: next.key, password: fields.get("password") };
        }
        try {
          const response = await postAccountOperation(
            actorUserId,
            paths[action],
            body
          );
          const receipt = readReceipt(await response.json());
          if (response.ok && receipt?.action === action) {
            setPasswordDraft(emptyPasswordDraft);
            setConfirmationPassword("");
            setFlow("confirmed");
            setMessage(`伺服器已確認「${labels[action]}」完成。`);
          } else if (fresh && response.status === 400) {
            localStorage.removeItem(storageKey);
            operationRef.current = null;
            setOperation(null);
            setFlow("ready");
            setMessage(
              "資料未獲接受，未有完成操作。請檢查目前密碼及新密碼規則。"
            );
          } else {
            setPasswordDraft(emptyPasswordDraft);
            setConfirmationPassword("");
            await reconcile(next);
          }
        } catch {
          setPasswordDraft(emptyPasswordDraft);
          setConfirmationPassword("");
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
        setConfirmationPassword("");
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
        confirmationPassword={confirmationPassword}
        disabled={disabled}
        flow={flow}
        message={message}
        onCheck={check}
        onClose={() => {
          setConfirmationPassword("");
          onConfirmationClose?.();
        }}
        onFinish={finish}
        onSubmit={submit}
        operation={operation}
        rows={confirmationContext}
        setConfirmationPassword={setConfirmationPassword}
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
      confirmationPassword={confirmationPassword}
      disabled={disabled}
      flow={flow}
      message={message}
      onCheck={check}
      onDiscard={() => {
        setPasswordDraft(emptyPasswordDraft);
        setConfirmationPassword("");
      }}
      onFinish={finish}
      onSubmit={submit}
      operation={operation}
      passwordDraft={passwordDraft}
      setConfirmationPassword={setConfirmationPassword}
      setPasswordDraft={setPasswordDraft}
      task={task}
      temporaryPasswordExpired={temporaryPasswordExpired}
      temporaryPasswordExpiresAt={temporaryPasswordExpiresAt}
    />
  );
};
