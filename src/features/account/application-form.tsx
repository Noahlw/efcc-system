"use client";

import { useForm } from "@tanstack/react-form";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  FieldControl,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldRoot,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { UnsavedChangesLink } from "@/components/unsaved-changes-link";
import { canonicalNameKey } from "@/features/identity/name-matching";

const operationKeyStorage = "efcc.account-application.operationKey.v1";
const operationKeyPattern = /^[0-9a-f]{64}$/u;
const unreadableOperationKeyMessage =
  "此裝置上的申請編號無法辨認，申請結果仍未確認。請重新檢查本機儲存；未核實前，不要開始另一份申請。";
const usernamePattern = /^[A-Za-z0-9_.]{3,30}$/u;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const phonePattern = /^\+[1-9]\d{7,14}$/u;

const createOperationKey = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  );
};

const canonicalPhone = (value: string): string => {
  const compact = value.trim().replaceAll(/[ ().-]/gu, "");
  if (/^[2-9]\d{7}$/u.test(compact)) {
    return `+852${compact}`;
  }
  if (/^852[2-9]\d{7}$/u.test(compact)) {
    return `+${compact}`;
  }
  return compact;
};

const readOutcome = async (
  response: Response
): Promise<"pending" | "not_found" | null> => {
  try {
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null || !("data" in body)) {
      return null;
    }
    const { data } = body;
    if (typeof data !== "object" || data === null || !("outcome" in data)) {
      return null;
    }
    return data.outcome === "pending" || data.outcome === "not_found"
      ? data.outcome
      : null;
  } catch {
    return null;
  }
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

interface ApplicationRequest {
  operationKey: string;
  fullName: string;
  username: string;
  email: string;
  phone: string;
  password: string;
  referral?: string;
  group?: string;
  intent?: string;
}

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
  try {
    const response = await fetch("/api/v2/applications", {
      body: JSON.stringify(request),
      cache: "no-store",
      credentials: "omit",
      headers: { "content-type": "application/json" },
      method: "POST",
    });
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
    return (response.status === 200 || response.status === 201) &&
      (await readOutcome(response)) === "pending"
      ? "pending"
      : "unknown";
  } catch {
    return "unknown";
  }
};

type ApplicationFieldName = Exclude<keyof ApplicationRequest, "operationKey">;

type ApplicationInputAttributes = Pick<
  React.ComponentProps<typeof Input>,
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

const validatePhone = (value: string): string | undefined => {
  const compact = value.trim().replaceAll(/[ ().-]/gu, "");
  if (!compact) {
    return "請輸入電話號碼。";
  }
  const invalidHongKongPrefix =
    /^(?:\+?852)\d{8}$/u.test(compact) && !/^\+?852[2-9]\d{7}$/u.test(compact);
  const valid =
    /^[2-9]\d{7}$/u.test(compact) ||
    /^\+?852[2-9]\d{7}$/u.test(compact) ||
    (compact.startsWith("+") && phonePattern.test(compact));
  return valid && !invalidHongKongPrefix
    ? undefined
    : "請輸入有效的香港電話號碼，或 E.164 國際格式（+ 國家碼及 8 至 15 位數字）。";
};

const validateEmail = (value: string): string | undefined => {
  const email = value.trim().toLowerCase();
  if (!email) {
    return "請輸入電郵地址。";
  }
  const domain = email.slice(email.lastIndexOf("@") + 1);
  return email.length <= 254 &&
    emailPattern.test(email) &&
    !domain.endsWith(".invalid")
    ? undefined
    : "請輸入有效的電郵地址；不可使用 .invalid 網域。";
};

const prepareOperationKey = (previousKey: string | null) => {
  const saved = localStorage.getItem(operationKeyStorage);
  if (!previousKey && saved && operationKeyPattern.test(saved)) {
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

const validateFullName = (value: string): string | undefined => {
  if (!canonicalNameKey(value)) {
    return "請輸入中文全名。";
  }
  let codePointCount = 0;
  for (const _ of value) {
    codePointCount += 1;
    if (codePointCount > 100) {
      return "中文全名不可多於 100 個字元。";
    }
  }
  return /\p{Cc}/u.test(value) ? "中文全名不可包含控制字元。" : undefined;
};

const validateUsername = (value: string): string | undefined => {
  const username = value.trim();
  if (!username) {
    return "請設定使用者名稱。";
  }
  return usernamePattern.test(username)
    ? undefined
    : "使用者名稱需為 3–30 個英文字母、數字、底線或點。";
};

const validatePassword = (value: string): string | undefined => {
  if (value.length < 8) {
    return "密碼最少需要 8 個字元。";
  }
  return value.length <= 128 ? undefined : "密碼不可多於 128 個字元。";
};

const validateOptionalNote = (value: string): string | undefined =>
  value.length <= 500 ? undefined : "選填資料不可多於 500 個字元。";

const applicationFieldValidators: Record<
  ApplicationFieldName,
  (value: string) => string | undefined
> = {
  email: validateEmail,
  fullName: validateFullName,
  group: validateOptionalNote,
  intent: validateOptionalNote,
  password: validatePassword,
  phone: validatePhone,
  referral: validateOptionalNote,
  username: validateUsername,
};

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
        const response = await fetch("/api/v2/applications/reconcile", {
          body: JSON.stringify({ operationKey }),
          cache: "no-store",
          credentials: "omit",
          headers: { "content-type": "application/json" },
          method: "POST",
        });
        const outcome =
          response.status === 200 ? await readOutcome(response) : null;

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
        if (response.status === 429) {
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
            response.status === 403
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
    []
  );

  const form = useForm({
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

      let operationKey = operationKeyRef.current;
      try {
        const prepared = prepareOperationKey(operationKey);
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

      const { referral } = value;
      const { group } = value;
      const { intent } = value;
      const request: ApplicationRequest = {
        email: value.email.trim().toLowerCase(),
        fullName: value.fullName,
        operationKey,
        password: value.password,
        phone: canonicalPhone(value.phone),
        username: value.username.trim(),
        ...(referral ? { referral } : {}),
        ...(group ? { group } : {}),
        ...(intent ? { intent } : {}),
      };

      setFlow({ kind: "submitting" });
      const outcome = await submitApplicationRequest(request);
      inFlightRef.current = false;
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
    try {
      const saved = localStorage.getItem(operationKeyStorage);
      if (!saved) {
        setFlow({ kind: "form" });
        return;
      }
      if (!operationKeyPattern.test(saved)) {
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
      if (saved && operationKeyPattern.test(saved)) {
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
      <form.Field
        key={descriptor.name}
        name={descriptor.name}
        validators={{
          onChange: ({ value }) =>
            applicationFieldValidators[descriptor.name](value),
        }}
      >
        {(field) => {
          const messages = field.state.meta.errors.filter(
            (error): error is string => typeof error === "string"
          );
          const invalid = field.state.meta.isTouched && messages.length > 0;
          const helpId = `${descriptor.id}-help`;
          const control =
            descriptor.control === "input" ? (
              <Input
                {...descriptor.input}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                aria-describedby={descriptor.description ? helpId : undefined}
              />
            ) : (
              <textarea
                className="border-input-border bg-surface text-foreground focus-visible:border-primary aria-invalid:border-danger min-h-24 w-full resize-y rounded-md border px-3 py-2 text-base outline-none"
                maxLength={descriptor.maxLength}
                rows={descriptor.rows}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                aria-describedby={descriptor.description ? helpId : undefined}
              />
            );

          return (
            <FieldRoot name={descriptor.name} invalid={invalid}>
              <FieldLabel className="text-base" htmlFor={descriptor.id}>
                {descriptor.label}
              </FieldLabel>
              <FieldControl id={descriptor.id} render={control} />
              {descriptor.description ? (
                <FieldDescription id={helpId} className="text-base">
                  {descriptor.description}
                </FieldDescription>
              ) : null}
              <FieldError className="text-base" match={invalid}>
                {messages.join(" ")}
              </FieldError>
            </FieldRoot>
          );
        }}
      </form.Field>
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

            <form.Subscribe selector={(state) => state.canSubmit}>
              {(canSubmit) => (
                <Button
                  type="submit"
                  disabled={!canSubmit || flow.kind === "storage-error"}
                >
                  提交申請
                </Button>
              )}
            </form.Subscribe>
          </form>
        </>
      ) : null}
    </div>
  );
};
