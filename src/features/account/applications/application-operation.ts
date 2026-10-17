"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { InferRequestType, InferResponseType } from "hono/client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { z } from "zod";

import { businessRpc } from "@/shared/business-rpc";

import { readTransientReconciliation } from "../reconciliation-query";
import {
  applicationCreatedResponseSchema,
  applicationFormSchema,
  applicationReconciliationResponseSchema,
  storedApplicationOperationKeySchema,
} from "./application-contract";

export type ApplicationDraft = z.input<typeof applicationFormSchema>;

const operationKeyStorage = "efcc.account-application.operationKey.v1";
const unreadableOperationKeyMessage =
  "此裝置上的申請編號無法辨認，申請結果仍未確認。請重新檢查本機儲存；未核實前，不要開始另一份申請。";

const createOperationKey = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  );
};

const prepareOperationKey = (previousKey: string | null) => {
  const saved = localStorage.getItem(operationKeyStorage);
  if (!previousKey && saved !== null) {
    if (!storedApplicationOperationKeySchema.safeParse(saved).success) {
      throw new Error("Stored application capability is invalid.");
    }
    return { key: saved, restore: true };
  }
  if (previousKey && saved !== null && saved !== previousKey) {
    throw new Error("A different application capability is stored.");
  }
  const key = previousKey ?? createOperationKey();
  if (saved !== key) {
    localStorage.setItem(operationKeyStorage, key);
  }
  if (localStorage.getItem(operationKeyStorage) !== key) {
    throw new Error("Application capability was not persisted.");
  }
  return { key, restore: false };
};

type ReconcileReason = "restore" | "after-submit" | "conflict" | "retry";
interface FormNotice {
  tone: "danger" | "info" | "warning";
  message: string;
}
interface CurrentCreationPresentation {
  fullName: string;
  username: string;
}
export type AnonymousApplicationFlow =
  | { kind: "loading" }
  | { kind: "form"; notice?: FormNotice }
  | { kind: "storage-error"; message: string; showForm: boolean }
  | { kind: "submitting" }
  | { kind: "checking"; message: string }
  | { kind: "unknown"; message: string }
  | { kind: "conflict"; message: string }
  | { kind: "check-limited"; message: string }
  | { kind: "denied"; message: string }
  | { kind: "pending"; createdIdentity?: CurrentCreationPresentation };
type ApplicationRequest = InferRequestType<
  typeof businessRpc.api.v2.applications.$post
>["json"];
type ApplicationSubmissionResponse = InferResponseType<
  typeof businessRpc.api.v2.applications.$post,
  200 | 201
>;
type ApplicationReconciliationResponse = InferResponseType<
  typeof businessRpc.api.v2.applications.reconcile.$post,
  200
>;
type ReconciliationOutcome =
  | "pending"
  | "not_found"
  | "rate-limited"
  | "denied"
  | "unknown";
const applicationReconciliationQueryKey = [
  "public-application-reconciliation",
] as const;

type SubmissionOutcome =
  | "pending"
  | "validation"
  | "denied"
  | "conflict"
  | "rate-limited"
  | "unknown";
interface SubmissionResult {
  outcome: SubmissionOutcome;
  createdIdentity?: CurrentCreationPresentation;
}

const submitApplicationRequest = async (
  request: ApplicationRequest
): Promise<SubmissionResult> => {
  const response = await businessRpc.api.v2.applications.$post(
    { json: request },
    { init: { cache: "no-store", credentials: "omit" } }
  );
  if (response.status === 400) {
    return { outcome: "validation" };
  }
  if (response.status === 403) {
    return { outcome: "denied" };
  }
  if (response.status === 409) {
    return { outcome: "conflict" };
  }
  if (response.status === 429) {
    return { outcome: "rate-limited" };
  }
  if (response.status !== 200 && response.status !== 201) {
    return { outcome: "unknown" };
  }
  const body: unknown = await response.json();
  const parsed = applicationCreatedResponseSchema.safeParse(body);
  if (!parsed.success) {
    return { outcome: "unknown" };
  }
  const outcome: ApplicationSubmissionResponse["data"]["outcome"] =
    parsed.data.data.outcome;
  return {
    outcome,
    ...(response.status === 201 && outcome === "pending"
      ? {
          createdIdentity: {
            fullName: request.fullName,
            username: request.username,
          },
        }
      : {}),
  };
};

export const useAnonymousApplication = () => {
  const [flow, setFlow] = useState<AnonymousApplicationFlow>({
    kind: "loading",
  });
  const operationKeyRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);
  const activeRef = useRef(true);

  const queryClient = useQueryClient();
  const submissionMutation = useMutation({
    gcTime: 0,
    mutationFn: submitApplicationRequest,
    networkMode: "always",
    retry: false,
  });

  const reconcile = useCallback(
    async (operationKey: string, reason: ReconcileReason) => {
      if (!activeRef.current || inFlightRef.current) {
        return;
      }
      inFlightRef.current = true;
      setFlow({
        kind: "checking",
        message:
          reason === "restore"
            ? "正在查核先前申請的狀態。"
            : "提交後未收到確定回覆，正在查核申請狀態。",
      });

      try {
        const outcome = await readTransientReconciliation(
          queryClient,
          applicationReconciliationQueryKey,
          async ({ signal }): Promise<ReconciliationOutcome> => {
            const response =
              await businessRpc.api.v2.applications.reconcile.$post(
                { json: { operationKey } },
                { init: { cache: "no-store", credentials: "omit", signal } }
              );
            if (response.status === 403) {
              return "denied";
            }
            if (response.status === 429) {
              return "rate-limited";
            }
            if (response.status !== 200) {
              return "unknown";
            }
            const body: unknown = await response.json();
            const parsed =
              applicationReconciliationResponseSchema.safeParse(body);
            if (!parsed.success) {
              return "unknown";
            }
            const result: ApplicationReconciliationResponse["data"]["outcome"] =
              parsed.data.data.outcome;
            return result;
          }
        );

        if (!activeRef.current) {
          return;
        }
        if (outcome === "pending") {
          setFlow({ kind: "pending" });
          return;
        }
        if (outcome === "not_found") {
          setFlow({
            kind: "form",
            notice: {
              message:
                reason === "restore"
                  ? "尚未找到已完成的申請。請重新輸入資料再提交，系統會沿用同一申請編號。"
                  : "查核後未找到已完成的申請；你可以修正資料後再提交，系統會沿用同一申請編號。",
              tone: "warning",
            },
          });
          return;
        }
        if (outcome === "rate-limited") {
          setFlow({
            kind: "check-limited",
            message:
              "查核次數較多，申請結果仍未確認。請稍後再次查核，暫勿開始另一份申請。",
          });
          return;
        }
        setFlow({
          kind: "unknown",
          message:
            outcome === "denied"
              ? "安全檢查未允許查核，申請結果仍未確認。請稍後再次查核。"
              : "仍未能確認申請結果。請再次查核；未確認前，請勿開始另一份申請。",
        });
      } catch {
        if (!activeRef.current) {
          return;
        }
        setFlow({
          kind: "unknown",
          message:
            "仍未能確認申請結果。請再次查核；未確認前，請勿開始另一份申請。",
        });
      } finally {
        inFlightRef.current = false;
      }
    },
    [queryClient]
  );

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      void queryClient.cancelQueries({
        exact: true,
        queryKey: applicationReconciliationQueryKey,
      });
      submissionMutation.reset();
    };
  }, [queryClient, submissionMutation.reset]);

  const submit = async (value: ApplicationDraft) => {
    if (!activeRef.current || inFlightRef.current) {
      return;
    }
    inFlightRef.current = true;
    const normalized = applicationFormSchema.parse(value);

    let operationKey: string;
    try {
      const prepared = prepareOperationKey(operationKeyRef.current);
      operationKey = prepared.key;
      operationKeyRef.current = operationKey;
      if (prepared.restore) {
        inFlightRef.current = false;
        void reconcile(operationKey, "restore");
        return;
      }
    } catch {
      inFlightRef.current = false;
      const hasSavedCapability = operationKeyRef.current !== null;
      setFlow({
        kind: "storage-error",
        message: hasSavedCapability
          ? "未能核實原申請編號是否仍保存在本機，因此沒有再次提交。請重新檢查儲存並查核結果；未核實前不要開始另一份申請。"
          : "無法安全儲存申請編號，系統尚未提交申請。請允許此瀏覽器使用本機儲存後重試。",
        showForm: !hasSavedCapability,
      });
      return;
    }

    const request: ApplicationRequest = { ...normalized, operationKey };
    setFlow({ kind: "submitting" });
    let result: SubmissionResult;
    try {
      result = await submissionMutation.mutateAsync(request);
    } catch {
      result = { outcome: "unknown" };
    } finally {
      submissionMutation.reset();
      inFlightRef.current = false;
    }
    if (!activeRef.current) {
      return;
    }
    switch (result.outcome) {
      case "pending": {
        setFlow({
          createdIdentity: result.createdIdentity,
          kind: "pending",
        });
        return;
      }
      case "validation": {
        setFlow({
          kind: "form",
          notice: {
            message:
              "申請資料未能通過伺服器檢查。請核對姓名、使用者名稱、電郵、電話及密碼資料後再提交。",
            tone: "danger",
          },
        });
        return;
      }
      case "denied": {
        setFlow({
          kind: "denied",
          message:
            "安全檢查未允許這次申請。請由顯恩堂系統的同一網域開啟本頁再試。",
        });
        return;
      }
      case "conflict": {
        setFlow({
          kind: "conflict",
          message:
            "申請資料與現有記錄或先前申請編號不相符。公眾申請不支援共用電話；如需共用電話，請聯絡教會同工。系統不會把衝突當成成功，請先查核申請結果。",
        });
        return;
      }
      case "rate-limited": {
        setFlow({
          kind: "form",
          notice: {
            message: "提交次數較多，請稍後再試；重試會沿用同一申請編號。",
            tone: "warning",
          },
        });
        return;
      }
      default: {
        setFlow({
          kind: "checking",
          message: "提交後未收到確定回覆，正在查核申請狀態。",
        });
        await reconcile(operationKey, "after-submit");
      }
    }
  };

  useEffect(() => {
    try {
      const saved = localStorage.getItem(operationKeyStorage);
      if (!saved) {
        setFlow({ kind: "form" });
        return;
      }
      if (!storedApplicationOperationKeySchema.safeParse(saved).success) {
        setFlow({
          kind: "storage-error",
          message: unreadableOperationKeyMessage,
          showForm: false,
        });
        return;
      }
      operationKeyRef.current = saved;
      void reconcile(saved, "restore");
    } catch {
      setFlow({
        kind: "storage-error",
        message:
          "無法讀取此瀏覽器的申請記錄，申請結果尚未確認。請重新檢查本機儲存後再繼續。",
        showForm: false,
      });
    }
  }, [reconcile]);

  const checkStorage = () => {
    const previousKey = operationKeyRef.current;
    if (previousKey) {
      void reconcile(previousKey, "retry");
      return;
    }
    try {
      const saved = localStorage.getItem(operationKeyStorage);
      if (
        saved &&
        storedApplicationOperationKeySchema.safeParse(saved).success
      ) {
        operationKeyRef.current = saved;
        void reconcile(saved, "retry");
        return;
      }
      if (saved) {
        setFlow({
          kind: "storage-error",
          message: unreadableOperationKeyMessage,
          showForm: false,
        });
        return;
      }
      setFlow({ kind: "form" });
    } catch {
      setFlow({
        kind: "storage-error",
        message:
          "仍無法安全讀取或清除申請編號。請稍後重試；在核實前不要開始另一份申請。",
        showForm: flow.kind === "storage-error" && flow.showForm,
      });
    }
  };

  const resetForAnotherApplication = () => {
    try {
      const operationKey = operationKeyRef.current;
      if (!operationKey) {
        throw new Error("No confirmed application capability is available.");
      }
      const saved = localStorage.getItem(operationKeyStorage);
      if (saved !== null && saved !== operationKey) {
        throw new Error("A different application capability is stored.");
      }
      if (saved === operationKey) {
        localStorage.removeItem(operationKeyStorage);
      }
      if (localStorage.getItem(operationKeyStorage) !== null) {
        throw new Error("Application capability was not cleared.");
      }
      operationKeyRef.current = null;
      setFlow({
        kind: "form",
        notice: {
          message: "已清除此裝置上的申請編號，可以開始另一份申請。",
          tone: "info",
        },
      });
      return true;
    } catch {
      setFlow({
        kind: "storage-error",
        message: "未能安全清除此申請記錄，尚未開始新申請。請稍後重試。",
        showForm: false,
      });
      return false;
    }
  };

  const forgetCompletedApplication = () => {
    const operationKey = operationKeyRef.current;
    if (!operationKey) {
      return;
    }
    try {
      if (localStorage.getItem(operationKeyStorage) === operationKey) {
        localStorage.removeItem(operationKeyStorage);
        if (localStorage.getItem(operationKeyStorage) === null) {
          operationKeyRef.current = null;
        }
      }
    } catch {
      // Navigation remains safe: the next visit still reconciles this capability.
    }
  };

  const retryReconciliation = () => {
    const operationKey = operationKeyRef.current;
    if (operationKey) {
      void reconcile(
        operationKey,
        flow.kind === "conflict" ? "conflict" : "retry"
      );
    } else {
      checkStorage();
    }
  };
  const reportSubmissionFailure = () => {
    if (activeRef.current) {
      setFlow({
        kind: "form",
        notice: {
          message: "系統暫時未能處理申請，請先查核申請結果再重試。",
          tone: "danger",
        },
      });
    }
  };

  return {
    checkStorage,
    flow,
    forgetCompletedApplication,
    reportSubmissionFailure,
    resetForAnotherApplication,
    retryReconciliation,
    returnToForm: () => setFlow({ kind: "form" }),
    submit,
  };
};
