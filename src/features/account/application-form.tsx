"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { InferRequestType, InferResponseType } from "hono/client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ComponentProps } from "react";

import { useAppForm } from "@/components/ui/app-form";
import { Button } from "@/components/ui/button";
import { UnsavedChangesLink } from "@/components/unsaved-changes-link";
import {
  applicationCreatedResponseSchema,
  applicationFieldSchemas,
  applicationFormSchema,
  applicationReconciliationResponseSchema,
  storedApplicationOperationKeySchema,
} from "@/features/account/application-contract";
import { businessRpc } from "@/shared/business-rpc";

import { readTransientReconciliation } from "./reconciliation-query";

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
  kind: "alert" | "status";
  message: string;
}
type Flow =
  | { kind: "loading" }
  | { kind: "form"; notice?: FormNotice }
  | { kind: "storage-error"; message: string; showForm: boolean }
  | { kind: "submitting" }
  | { kind: "checking"; message: string }
  | { kind: "unknown"; message: string }
  | { kind: "conflict"; message: string }
  | { kind: "check-limited"; message: string }
  | { kind: "denied"; message: string }
  | { kind: "pending" };

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
const submitApplicationRequest = async (
  request: ApplicationRequest
): Promise<SubmissionOutcome> => {
  const response = await businessRpc.api.v2.applications.$post(
    { json: request },
    { init: { cache: "no-store", credentials: "omit" } }
  );
  if (response.status === 400) {
    return "validation";
  }
  if (response.status === 403) {
    return "denied";
  }
  if (response.status === 409) {
    return "conflict";
  }
  if (response.status === 429) {
    return "rate-limited";
  }
  if (response.status !== 200 && response.status !== 201) {
    return "unknown";
  }
  const body: unknown = await response.json();
  const parsed = applicationCreatedResponseSchema.safeParse(body);
  if (!parsed.success) {
    return "unknown";
  }
  const outcome: ApplicationSubmissionResponse["data"]["outcome"] =
    parsed.data.data.outcome;
  return outcome;
};

type ApplicationFieldName = Exclude<keyof ApplicationRequest, "operationKey">;

type ApplicationInputAttributes = Pick<
  ComponentProps<"input">,
  | "autoCapitalize"
  | "autoComplete"
  | "autoFocus"
  | "inputMode"
  | "maxLength"
  | "minLength"
  | "required"
  | "spellCheck"
  | "type"
>;

type ApplicationFieldDescriptor = {
  name: ApplicationFieldName;
  id: string;
  label: string;
  description?: string;
} & (
  | { control: "input"; input: ApplicationInputAttributes }
  | { control: "textarea"; maxLength: number; rows: number }
);

interface ApplicationFieldSection {
  id: string;
  legend?: string;
  fields: readonly ApplicationFieldDescriptor[];
}

const applicationFieldSections: readonly ApplicationFieldSection[] = [
  {
    fields: [
      {
        control: "input",
        description:
          "香港本地電話須以 2–9 開頭，也可輸入國際格式；空格、點號、括號及連字號會自動整理。",
        id: "application-phone",
        input: {
          autoComplete: "tel",
          autoFocus: true,
          inputMode: "tel",
          maxLength: 24,
          required: true,
          type: "tel",
        },
        label: "電話號碼",
        name: "phone",
      },
      {
        control: "input",
        description: "系統會保留你填寫的顯示姓名；姓名相同不代表同一帳戶。",
        id: "application-full-name",
        input: {
          autoComplete: "name",
          maxLength: 200,
          required: true,
          type: "text",
        },
        label: "中文全名",
        name: "fullName",
      },
      {
        control: "input",
        description: "3–30 個英文字母、數字、底線或點；大小寫視為相同。",
        id: "application-username",
        input: {
          autoCapitalize: "none",
          autoComplete: "username",
          maxLength: 30,
          required: true,
          spellCheck: false,
          type: "text",
        },
        label: "使用者名稱",
        name: "username",
      },
      {
        control: "input",
        description: "電郵只作聯絡資料；目前未開放電郵確認或密碼重設。",
        id: "application-email",
        input: {
          autoCapitalize: "none",
          autoComplete: "email",
          maxLength: 254,
          required: true,
          type: "email",
        },
        label: "電郵地址",
        name: "email",
      },
      {
        control: "input",
        description: "最少 8 個字元；請使用密碼管理工具保存。",
        id: "application-password",
        input: {
          autoComplete: "new-password",
          maxLength: 128,
          minLength: 8,
          required: true,
          type: "password",
        },
        label: "設定密碼",
        name: "password",
      },
    ],
    id: "required-fields",
  },
  {
    fields: [
      {
        control: "input",
        id: "application-referral",
        input: { autoComplete: "off", maxLength: 500, type: "text" },
        label: "介紹人",
        name: "referral",
      },
      {
        control: "input",
        id: "application-group",
        input: { autoComplete: "off", maxLength: 500, type: "text" },
        label: "小組（如適用）",
        name: "group",
      },
      {
        control: "textarea",
        id: "application-intent",
        label: "申請原因或補充資料",
        maxLength: 500,
        name: "intent",
        rows: 3,
      },
    ],
    id: "optional-notes",
    legend: "其他資料（選填）",
  },
];

export const ApplicationForm = () => {
  const [flow, setFlow] = useState<Flow>({ kind: "loading" });
  const operationKeyRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);

  const queryClient = useQueryClient();
  const submissionMutation = useMutation({
    gcTime: 0,
    mutationFn: submitApplicationRequest,
    networkMode: "always",
    retry: false,
  });

  const reconcile = useCallback(
    async (operationKey: string, reason: ReconcileReason) => {
      if (inFlightRef.current) {
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

        if (outcome === "pending") {
          setFlow({ kind: "pending" });
          return;
        }
        if (outcome === "not_found") {
          setFlow({
            kind: "form",
            notice: {
              kind: "status",
              message:
                reason === "restore"
                  ? "尚未找到已完成的申請。請重新輸入資料再提交，系統會沿用同一申請編號。"
                  : "查核後未找到已完成的申請；你可以修正資料後再提交，系統會沿用同一申請編號。",
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

  const form = useAppForm({
    defaultValues: {
      email: "",
      fullName: "",
      group: "",
      intent: "",
      password: "",
      phone: "",
      referral: "",
      username: "",
    },
    onSubmit: async ({ value }) => {
      if (inFlightRef.current) {
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
      let outcome: SubmissionOutcome;
      try {
        outcome = await submissionMutation.mutateAsync(request);
      } catch {
        outcome = "unknown";
      } finally {
        submissionMutation.reset();
        inFlightRef.current = false;
      }
      switch (outcome) {
        case "pending": {
          setFlow({ kind: "pending" });
          return;
        }
        case "validation": {
          setFlow({
            kind: "form",
            notice: {
              kind: "alert",
              message:
                "申請資料未能通過伺服器檢查。請核對姓名、使用者名稱、電郵、電話及密碼資料後再提交。",
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
              "申請資料與現有記錄或先前申請編號不相符。系統不會把衝突當成成功；請先查核申請結果。",
          });
          return;
        }
        case "rate-limited": {
          setFlow({
            kind: "form",
            notice: {
              kind: "alert",
              message: "提交次數較多，請稍後再試；重試會沿用同一申請編號。",
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
    },
  });

  useEffect(() => {
    if (flow.kind === "pending") {
      form.reset();
    }
  }, [flow.kind, form.reset]);

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
      form.reset();
      setFlow({
        kind: "form",
        notice: {
          kind: "status",
          message: "已清除此裝置上的申請編號，可以開始另一份申請。",
        },
      });
    } catch {
      setFlow({
        kind: "storage-error",
        message: "未能安全清除此申請記錄，尚未開始新申請。請稍後重試。",
        showForm: false,
      });
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

  const showForm =
    flow.kind === "form" || (flow.kind === "storage-error" && flow.showForm);
  const fieldSections = applicationFieldSections.map((section) => {
    const controls = section.fields.map((descriptor) => (
      <form.AppField
        key={descriptor.name}
        name={descriptor.name}
        validators={{ onChange: applicationFieldSchemas[descriptor.name] }}
      >
        {(field) =>
          descriptor.control === "input" ? (
            <field.TextField
              {...descriptor.input}
              description={descriptor.description}
              id={descriptor.id}
              label={descriptor.label}
              textClassName="text-base"
            />
          ) : (
            <field.TextareaField
              description={descriptor.description}
              id={descriptor.id}
              label={descriptor.label}
              maxLength={descriptor.maxLength}
              rows={descriptor.rows}
              textClassName="text-base"
            />
          )
        }
      </form.AppField>
    ));

    return section.legend ? (
      <fieldset
        key={section.id}
        className="border-border flex flex-col gap-5 rounded-md border p-4"
      >
        <legend className="px-1 text-base font-medium">{section.legend}</legend>
        {controls}
      </fieldset>
    ) : (
      <div key={section.id} className="flex flex-col gap-5">
        {controls}
      </div>
    );
  });

  return (
    <div className="flex flex-col">
      {showForm ? (
        <header className="mb-6">
          <div className="flex flex-wrap items-center gap-3">
            <form.Subscribe selector={(state) => state.isDirty}>
              {(isDirty) => (
                <UnsavedChangesLink
                  description="繼續填寫會保留目前申請資料；放棄變更會清除未提交的申請資料，並返回登入頁。"
                  href="/sign-in"
                  isDirty={isDirty}
                  onDiscard={() => {
                    form.reset();
                    setFlow({ kind: "form" });
                  }}
                >
                  ← 返回登入
                </UnsavedChangesLink>
              )}
            </form.Subscribe>
            <h1 className="text-root font-semibold">申請帳戶</h1>
          </div>
          <p className="text-body text-muted-foreground mt-2">
            填寫資料，讓教會同工認識你。提交後會進入待審核狀態，此頁不會替你登入。
          </p>
        </header>
      ) : (
        <h1 className="text-root font-semibold">
          {flow.kind === "pending" ? "申請進度" : "申請狀態"}
        </h1>
      )}

      {flow.kind === "loading" ? (
        <p className="text-base" role="status" aria-live="polite">
          正在讀取申請狀態…
        </p>
      ) : null}

      {flow.kind === "submitting" ? (
        <p
          className="text-base"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          正在提交申請…
        </p>
      ) : null}

      {flow.kind === "checking" ? (
        <section aria-busy="true" aria-labelledby="application-checking-title">
          <h2 id="application-checking-title" className="text-xl font-semibold">
            正在查核申請狀態
          </h2>
          <p
            className="text-muted-foreground mt-2"
            role="status"
            aria-live="polite"
          >
            {flow.message}
          </p>
        </section>
      ) : null}

      {flow.kind === "unknown" ||
      flow.kind === "conflict" ||
      flow.kind === "check-limited" ? (
        <section aria-labelledby="application-check-title">
          <h2 id="application-check-title" className="text-xl font-semibold">
            {flow.kind === "conflict" ? "申請資料需要查核" : "申請結果尚未確認"}
          </h2>
          <p
            className="border-danger bg-danger-surface text-danger mt-3 rounded-md border p-3 text-base"
            role="alert"
          >
            {flow.message}
          </p>
          <Button
            className="mt-5"
            type="button"
            onClick={() => {
              const operationKey = operationKeyRef.current;
              if (operationKey) {
                void reconcile(
                  operationKey,
                  flow.kind === "conflict" ? "conflict" : "retry"
                );
              } else {
                checkStorage();
              }
            }}
          >
            重新查核申請結果
          </Button>
        </section>
      ) : null}

      {flow.kind === "denied" ? (
        <section aria-labelledby="application-denied-title">
          <h2 id="application-denied-title" className="text-xl font-semibold">
            未能提交申請
          </h2>
          <p
            className="border-danger bg-danger-surface text-danger mt-3 rounded-md border p-3 text-base"
            role="alert"
          >
            {flow.message}
          </p>
        </section>
      ) : null}

      {flow.kind === "pending" ? (
        <section aria-labelledby="application-pending-title">
          <h2
            id="application-pending-title"
            className="text-section font-semibold"
          >
            申請已收到
          </h2>
          <p
            className="text-muted-foreground mt-2"
            role="status"
            aria-live="polite"
          >
            申請已提交，提交時為待審核。請用原申請的使用者名稱或中文全名及密碼登入，查看最新狀態；本頁不會替你登入。
          </p>
          <div className="mt-5 flex flex-col gap-3">
            <Button
              nativeButton={false}
              render={
                <Link href="/sign-in" onClick={forgetCompletedApplication} />
              }
            >
              前往登入
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={resetForAnotherApplication}
            >
              清除此裝置的申請記錄，開始另一份申請
            </Button>
          </div>
        </section>
      ) : null}

      {flow.kind === "storage-error" ? (
        <div className="mb-5">
          <p
            className="border-danger bg-danger-surface text-danger rounded-md border p-3 text-base"
            role="alert"
          >
            {flow.message}
          </p>
          <Button
            className="mt-3"
            type="button"
            variant="secondary"
            onClick={checkStorage}
          >
            重新檢查本機儲存
          </Button>
        </div>
      ) : null}

      {showForm ? (
        <>
          {flow.kind === "form" && flow.notice ? (
            <p
              className={
                flow.notice.kind === "alert"
                  ? "border-danger bg-danger-surface text-danger mb-5 rounded-md border p-3 text-base"
                  : "border-border bg-muted mb-5 rounded-md border p-3 text-base"
              }
              role={flow.notice.kind}
              aria-live={flow.notice.kind === "status" ? "polite" : undefined}
            >
              {flow.notice.message}
            </p>
          ) : null}
          <form.AppForm>
            <form
              className="flex flex-col gap-5"
              noValidate
              onSubmit={async (event) => {
                event.preventDefault();
                event.stopPropagation();
                try {
                  await form.handleSubmit();
                } catch {
                  setFlow({
                    kind: "form",
                    notice: {
                      kind: "alert",
                      message: "系統暫時未能處理申請，請先查核申請結果再重試。",
                    },
                  });
                }
              }}
            >
              {fieldSections}
              <form.SubmitButton
                disabled={flow.kind === "storage-error"}
                label="提交申請"
                pendingLabel="提交申請"
              />
            </form>
          </form.AppForm>
        </>
      ) : null}
    </div>
  );
};
