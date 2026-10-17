"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ComponentProps } from "react";

import { TaskHeader } from "@/components/page-frame";
import { useAppForm } from "@/components/ui/app-form";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { UnsavedChangesLink } from "@/components/unsaved-changes-link";
import { applicationFieldSchemas } from "@/features/account/applications/application-contract";

import {
  AccountOperationOutcome,
  AccountOperationSummary,
} from "../operation-presentation";
import { useAnonymousApplication } from "./application-operation";
import type {
  ApplicationDraft,
  AnonymousApplicationFlow as Flow,
} from "./application-operation";

const phaseTitles: Record<Flow["kind"], string> = {
  "check-limited": "暫時未能查核",
  checking: "正在查核申請狀態",
  conflict: "申請資料需要查核",
  denied: "未能提交申請",
  form: "申請帳戶",
  loading: "正在讀取申請狀態",
  pending: "已收到你的申請",
  "storage-error": "未能確認原申請記錄",
  submitting: "申請帳戶",
  unknown: "申請結果尚未確認",
};

const applicationOperationSummaryRows = [
  { label: "操作", value: "提交會籍申請" },
] as const;

const applicationPhaseTitle = (flow: Flow) => {
  if (flow.kind === "storage-error" && flow.showForm) {
    return "未能保存查核資料";
  }
  return phaseTitles[flow.kind];
};

type ApplicationFieldName = keyof ApplicationDraft;

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
  | { control: "password"; input: Omit<ApplicationInputAttributes, "type"> }
  | { control: "textarea"; maxLength: number; rows: number }
);

interface ApplicationFieldSection {
  id: string;
  summary?: string;
  fields: readonly ApplicationFieldDescriptor[];
}

const applicationFieldSections: readonly ApplicationFieldSection[] = [
  {
    fields: [
      {
        control: "input",
        description: "香港本地或國際格式，例如 +852 6000 0001。",
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
        description: "請填寫你的完整中文姓名。",
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
        description: "3–30 個英文字母、數字、底線或點。",
        id: "application-username",
        input: {
          autoCapitalize: "none",
          autoComplete: "username",
          maxLength: 30,
          required: true,
          spellCheck: false,
          type: "text",
        },
        label: "Username",
        name: "username",
      },
      {
        control: "input",
        description: "只作聯絡資料，目前未提供電郵確認或密碼重設。",
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
        control: "password",
        description: "8–128 個字元。",
        id: "application-password",
        input: {
          autoComplete: "new-password",
          maxLength: 128,
          minLength: 8,
          required: true,
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
        label: "小組",
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
    summary: "其他資料（選填）",
  },
];

export const ApplicationForm = () => {
  const [optionalFieldsOpen, setOptionalFieldsOpen] = useState(false);
  const {
    checkStorage,
    flow,
    forgetCompletedApplication,
    reportSubmissionFailure,
    resetForAnotherApplication: resetOperation,
    retryReconciliation,
    returnToForm,
    submit,
  } = useAnonymousApplication();

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
    onSubmit: ({ value }) => submit(value),
  });

  useEffect(() => {
    if (flow.kind === "pending") {
      form.reset();
    }
  }, [flow.kind, form.reset]);

  const resetForAnotherApplication = () => {
    if (resetOperation()) {
      form.reset();
      setOptionalFieldsOpen(false);
    }
  };
  const discardDraft = () => {
    form.reset();
    setOptionalFieldsOpen(false);
    returnToForm();
  };

  const showApplicationForm =
    flow.kind === "form" || flow.kind === "submitting";
  const phaseTitle = applicationPhaseTitle(flow);
  const currentCreation =
    flow.kind === "pending" ? flow.createdIdentity : undefined;
  const fieldSections = applicationFieldSections.map((section) => {
    const controls = section.fields.map((descriptor) => (
      <form.AppField
        key={descriptor.name}
        name={descriptor.name}
        validators={{ onChange: applicationFieldSchemas[descriptor.name] }}
      >
        {(field) => {
          if (descriptor.control === "input") {
            return (
              <field.TextField
                {...descriptor.input}
                description={descriptor.description}
                id={descriptor.id}
                label={descriptor.label}
                textClassName="text-base"
              />
            );
          }
          if (descriptor.control === "password") {
            return (
              <field.PasswordField
                {...descriptor.input}
                description={descriptor.description}
                id={descriptor.id}
                label={descriptor.label}
                textClassName="text-base"
              />
            );
          }
          return (
            <field.TextareaField
              description={descriptor.description}
              id={descriptor.id}
              label={descriptor.label}
              maxLength={descriptor.maxLength}
              rows={descriptor.rows}
              textClassName="text-base"
            />
          );
        }}
      </form.AppField>
    ));

    return section.summary ? (
      <form.Subscribe
        key={section.id}
        selector={(state) =>
          Boolean(
            state.fieldMeta.referral?.errors.length ||
            state.fieldMeta.group?.errors.length ||
            state.fieldMeta.intent?.errors.length
          )
        }
      >
        {(hasOptionalErrors) => (
          <details
            className="border-border border-t pt-4"
            onToggle={(event) => {
              const details = event.currentTarget;
              if (hasOptionalErrors && !details.open) {
                details.open = true;
                return;
              }
              setOptionalFieldsOpen(details.open);
            }}
            open={optionalFieldsOpen || hasOptionalErrors}
          >
            <summary className="focus-visible:outline-primary min-h-11 cursor-pointer text-base focus-visible:outline-2 focus-visible:outline-offset-2">
              {section.summary}
            </summary>
            <div className="mt-4 flex flex-col gap-5">{controls}</div>
          </details>
        )}
      </form.Subscribe>
    ) : (
      <div key={section.id} className="flex flex-col gap-5">
        {controls}
      </div>
    );
  });

  return (
    <div className="flex flex-col">
      {showApplicationForm ? (
        <>
          <form.Subscribe selector={(state) => state.isDirty}>
            {(isDirty) => (
              <TaskHeader
                returnControl={
                  <UnsavedChangesLink
                    description="繼續填寫會保留目前申請資料；放棄變更會清除未提交的申請資料，並返回登入頁。"
                    href="/sign-in"
                    isDirty={isDirty && flow.kind !== "submitting"}
                    onDiscard={discardDraft}
                  >
                    <Icon className="size-5" name="arrow-left" />
                    <span className="sr-only">返回登入</span>
                  </UnsavedChangesLink>
                }
                title="申請帳戶"
              />
            )}
          </form.Subscribe>
          <p className="text-muted-foreground mt-2">
            填寫資料，讓教會同工認識你。
          </p>
        </>
      ) : (
        <>
          {flow.kind === "pending" ? (
            <div className="bg-success/10 text-success mb-6 flex size-14 items-center justify-center rounded-2xl">
              <Icon className="size-7" name="circle-check" />
            </div>
          ) : null}
          <h1 className="text-root font-bold tracking-[-0.025em]">
            {phaseTitle}
          </h1>
        </>
      )}

      {flow.kind === "loading" ? (
        <AccountOperationOutcome busy message="正在讀取申請狀態…" tone="info" />
      ) : null}

      {flow.kind === "checking" ? (
        <>
          <AccountOperationSummary rows={applicationOperationSummaryRows} />
          <AccountOperationOutcome busy message={flow.message} tone="info" />
        </>
      ) : null}

      {flow.kind === "unknown" ||
      flow.kind === "conflict" ||
      flow.kind === "check-limited" ? (
        <>
          <p
            aria-live="polite"
            className="text-muted-foreground mt-4"
            role="status"
          >
            {flow.message}
          </p>
          <AccountOperationSummary rows={applicationOperationSummaryRows} />
          <Button
            className="mt-5 w-full"
            type="button"
            onClick={retryReconciliation}
          >
            重新查核申請結果
          </Button>
        </>
      ) : null}

      {flow.kind === "denied" ? (
        <>
          <p
            className="text-muted-foreground"
            role="alert"
            aria-live="assertive"
          >
            {flow.message}
          </p>
          <Button
            className="mt-5 w-full"
            type="button"
            variant="secondary"
            onClick={() => window.location.reload()}
          >
            重新載入
          </Button>
        </>
      ) : null}

      {flow.kind === "pending" ? (
        <>
          <p className="text-muted-foreground" role="status" aria-live="polite">
            教會同工會審閱你的資料。你可以登入查看申請進度。
          </p>
          <Button
            className="mt-5 w-full"
            nativeButton={false}
            render={
              <Link href="/sign-in" onClick={forgetCompletedApplication} />
            }
          >
            前往登入
          </Button>
          <AccountOperationSummary
            rows={[
              ...(currentCreation
                ? [
                    { label: "申請人", value: currentCreation.fullName },
                    { label: "Username", value: currentCreation.username },
                  ]
                : []),
              {
                label: "提交時狀態",
                value: (
                  <span className="bg-warning-surface text-warning text-meta inline-flex min-h-8 items-center rounded-full px-3 font-medium">
                    待批核
                  </span>
                ),
              },
            ]}
          />
          <p className="text-muted-foreground text-meta mt-5">
            提交申請不會自動登入或授予教會功能；請登入查核目前狀態。
          </p>
          <Button
            className="mt-5 w-full"
            type="button"
            variant="secondary"
            onClick={resetForAnotherApplication}
          >
            清除此裝置記錄，開始另一份申請
          </Button>
        </>
      ) : null}

      {flow.kind === "storage-error" ? (
        <>
          <p
            aria-live="polite"
            className="text-muted-foreground mt-4"
            role="status"
          >
            {flow.message}
          </p>
          {flow.showForm ? null : (
            <AccountOperationOutcome
              message="保留此瀏覽器資料，不要清除儲存或重新申請。"
              title="請先恢復原申請查核"
              tone="warning"
            />
          )}
          <Button
            className="mt-5 w-full"
            type="button"
            variant="primary"
            onClick={checkStorage}
          >
            {flow.showForm ? "返回申請表" : "重新查核裝置記錄"}
          </Button>
        </>
      ) : null}

      {showApplicationForm ? (
        <>
          {flow.kind === "form" && flow.notice ? (
            <AccountOperationOutcome
              message={flow.notice.message}
              tone={flow.notice.tone}
            />
          ) : null}
          <form.AppForm>
            <form
              className="mt-5 flex flex-col gap-5"
              noValidate
              onSubmit={async (event) => {
                event.preventDefault();
                event.stopPropagation();
                try {
                  await form.handleSubmit();
                } catch {
                  reportSubmissionFailure();
                }
              }}
            >
              <fieldset
                aria-busy={flow.kind === "submitting" || undefined}
                className="flex min-w-0 flex-col gap-5"
                disabled={flow.kind === "submitting"}
              >
                {fieldSections}
                <form.SubmitButton label="提交申請" pendingLabel="正在處理…" />
              </fieldset>
            </form>
          </form.AppForm>
          <p className="text-muted-foreground text-meta mt-6 text-center">
            已經有帳戶？{" "}
            <form.Subscribe selector={(state) => state.isDirty}>
              {(isDirty) => (
                <UnsavedChangesLink
                  description="繼續填寫會保留目前申請資料；放棄變更會清除未提交的申請資料，並返回登入頁。"
                  href="/sign-in"
                  isDirty={isDirty && flow.kind !== "submitting"}
                  onDiscard={discardDraft}
                >
                  登入
                </UnsavedChangesLink>
              )}
            </form.Subscribe>
          </p>
        </>
      ) : null}
    </div>
  );
};
