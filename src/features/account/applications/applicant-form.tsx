"use client";

import { formOptions, useSelector } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ClientResponse, InferRequestType } from "hono/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import * as z from "zod";

import { TaskHeader } from "@/components/page-frame";
import { useAppForm, withForm } from "@/components/ui/app-form";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { UnsavedChangesLink } from "@/components/unsaved-changes-link";
import {
  applicantActionResponseSchema,
  ownApplicationResponseSchema,
} from "@/features/account/applications/application-contract";
import { identityFieldSchemas } from "@/features/account/identity-validation";
import { businessRpc } from "@/shared/business-rpc";

import { originalIdentityValues } from "../identity-changes/identity-contract";
import { operationErrorSchema } from "../operation-error";
import {
  AccountOperationDetails,
  AccountOperationOutcome,
  AccountOperationSummary,
} from "../operation-presentation";
import { readTransientReconciliation } from "../reconciliation-query";
import { StaleDataRefresh } from "../stale-data-refresh";
import { useApplicantOperationLifetime } from "./applicant-operation";
import type { OwnApplication } from "./applications";

const storageKey = "efcc.applicant.operation.v1";
const actionSchema = z.enum([
  "application_corrected",
  "application_withdrawn",
  "application_resubmitted",
]);
const operationSchema = z.strictObject({
  action: actionSchema,
  actorUserId: z.string().min(1).max(128),
  applicationId: z.uuid(),
  key: z.uuid(),
});
type Operation = z.infer<typeof operationSchema>;
type ApplicantActionRequest = InferRequestType<
  typeof businessRpc.api.v2.applications.actions.$post
>["json"];
type ApplicantReconciliationRequest = InferRequestType<
  typeof businessRpc.api.v2.applications.actions.reconcile.$post
>["json"];
type ApplicantActionResponse = ClientResponse<unknown>;
type ApplicantReceipt = z.infer<
  typeof applicantActionResponseSchema
>["data"]["receipt"];
const matchesOperation = (
  receipt: NonNullable<ApplicantReceipt>,
  operation: Operation
) =>
  receipt.action === operation.action &&
  (operation.action === "application_resubmitted"
    ? receipt.applicationId !== operation.applicationId
    : receipt.applicationId === operation.applicationId);

/** Never cached or replayed: a lost response stays UNKNOWN until reconciliation. */
const applicantRequestInit: RequestInit = {
  cache: "no-store",
  credentials: "same-origin",
};

const submitApplicantAction = (
  request: ApplicantActionRequest,
  expectedActorId: string
) =>
  businessRpc.api.v2.applications.actions.$post(
    { json: request },
    {
      headers: { "x-efcc-expected-actor-id": expectedActorId },
      init: applicantRequestInit,
    }
  );

const requestApplicantReconciliation = (
  request: ApplicantReconciliationRequest,
  expectedActorId: string,
  signal: AbortSignal
) =>
  businessRpc.api.v2.applications.actions.reconcile.$post(
    { json: request },
    {
      headers: { "x-efcc-expected-actor-id": expectedActorId },
      init: { ...applicantRequestInit, signal },
    }
  );

type Flow =
  | "restoring"
  | "ready"
  | "submitting"
  | "checking"
  | "unknown"
  | "retry"
  | "confirmed"
  | "denied"
  | "rate-limited"
  | "storage-error";
type BusyFlow = Extract<Flow, "restoring" | "submitting" | "checking">;
type OperationFlow = Extract<
  Flow,
  "unknown" | "retry" | "confirmed" | "denied" | "rate-limited"
>;
type TaskView =
  | "overview"
  | "edit"
  | "edit-review"
  | "withdraw-review"
  | "resubmit-review";
interface ApplicantDraft {
  email: string;
  fullName: string;
  phone: string;
}
interface ReviewBase {
  actorUserId: string;
  applicationId: string;
  status: OwnApplication["status"];
}
type ReviewContext = ReviewBase &
  (
    | { action: "application_corrected"; draft: ApplicantDraft }
    | { action: "application_withdrawn" | "application_resubmitted" }
  );
type PanelMode =
  | { kind: "busy"; flow: BusyFlow }
  | { kind: "storage-error" }
  | { kind: "operation"; flow: OperationFlow }
  | { kind: "retry-edit" }
  | { kind: "task"; view: TaskView };

const draftFromApplication = (application: OwnApplication): ApplicantDraft => ({
  email: application.email,
  fullName: application.fullName,
  phone: application.phone ?? "",
});
const hasDraftChanges = (draft: ApplicantDraft, application: OwnApplication) =>
  draft.email !== application.email ||
  draft.fullName !== application.fullName ||
  draft.phone !== (application.phone ?? "");
const readOperation = () => {
  const raw = localStorage.getItem(storageKey);
  return raw ? operationSchema.parse(JSON.parse(raw)) : null;
};
const labels: Record<Operation["action"], string> = {
  application_corrected: "修正申請資料",
  application_resubmitted: "重新提交申請",
  application_withdrawn: "撤回申請",
};
const statusLabels: Record<OwnApplication["status"], string> = {
  approved: "已批准",
  pending: "待批",
  rejected: "已拒絕",
  withdrawn: "已撤回",
};
const outcomes: Record<
  Exclude<Flow, "ready">,
  { title: string; tone: "danger" | "info" | "success" | "warning" }
> = {
  checking: { title: "正在查核操作", tone: "info" },
  confirmed: { title: "操作已確認完成", tone: "success" },
  denied: { title: "權限檢查未允許", tone: "danger" },
  "rate-limited": { title: "請稍後再試", tone: "warning" },
  restoring: { title: "正在查核操作", tone: "info" },
  retry: { title: "未找到操作紀錄", tone: "warning" },
  "storage-error": { title: "本機操作記錄無法使用", tone: "danger" },
  submitting: { title: "正在提交操作", tone: "info" },
  unknown: { title: "操作結果未確認", tone: "warning" },
};

/** One live Form owns the applicant edit values for this task. */
// Composition infers the existing value shape; the owning form supplies the
// real current application values through draftFromApplication below.
const applicantFormOptions = formOptions({
  defaultValues: {} as ApplicantDraft,
});

const panelMode = (
  flow: Flow,
  view: TaskView,
  operation: Operation | null,
  actorUserId: string,
  applicationId: string
): PanelMode => {
  if (flow === "restoring" || flow === "checking" || flow === "submitting") {
    return { flow, kind: "busy" };
  }
  if (flow === "storage-error") {
    return { kind: "storage-error" };
  }
  if (flow === "ready") {
    return { kind: "task", view };
  }
  if (
    flow === "retry" &&
    operation?.action === "application_corrected" &&
    operation.actorUserId === actorUserId &&
    operation.applicationId === applicationId &&
    (view === "edit" || view === "edit-review")
  ) {
    return { kind: "retry-edit" };
  }
  return { flow, kind: "operation" };
};

const viewTitle = (view: TaskView): string => {
  switch (view) {
    case "overview": {
      return "我的申請";
    }
    case "edit": {
      return "修正申請資料";
    }
    case "edit-review": {
      return "檢查申請更改";
    }
    case "withdraw-review": {
      return "撤回這份申請？";
    }
    case "resubmit-review": {
      return "重新提交申請";
    }
    default: {
      return "我的申請";
    }
  }
};

const applicantTaskTitle = (
  flow: Flow,
  view: TaskView,
  operation: Operation | null
) => {
  if (flow === "unknown" && operation?.action === "application_withdrawn") {
    return "撤回申請結果未確認";
  }
  return flow !== "ready" && !(flow === "retry" && view !== "overview")
    ? "申請操作結果"
    : viewTitle(view);
};

const ApplicantOverview = ({
  application,
  children,
  eligible,
  onEdit,
  onResubmit,
  onWithdraw,
}: {
  application: OwnApplication;
  children: ReactNode;
  eligible: boolean;
  onEdit: () => void;
  onResubmit: () => void;
  onWithdraw: () => void;
}) => (
  <>
    <p className="text-muted-foreground mb-4">申請資料與最新審批進度。</p>
    {children}
    <section aria-labelledby="applicant-actions-title" className="mt-2">
      <h2 className="sr-only" id="applicant-actions-title">
        處理自己的申請
      </h2>
      {eligible ? (
        <div className="mt-4 flex flex-col gap-3">
          <Button
            className="border-border w-full justify-start rounded-none border-b py-4 text-left"
            type="button"
            variant="quiet"
            onClick={onEdit}
          >
            <span className="bg-background flex size-11 shrink-0 items-center justify-center rounded-xl">
              <Icon name="file-text" />
            </span>
            <span className="min-w-0 flex-1">
              <strong className="text-body block font-semibold">
                修正申請資料
              </strong>
              <small className="text-meta text-muted-foreground mt-1 block">
                姓名、電郵及電話；Username 不變
              </small>
            </span>
            <Icon className="size-5 shrink-0" name="chevron-right" />
          </Button>
          {application.status === "pending" ? (
            <Button type="button" variant="secondary" onClick={onWithdraw}>
              撤回申請
            </Button>
          ) : null}
          {application.status === "rejected" ||
          application.status === "withdrawn" ? (
            <Button className="w-full" type="button" onClick={onResubmit}>
              重新提交申請
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="text-muted-foreground mt-3">
          此帳戶目前不能以申請人身分修正或重新提交。已完成操作仍可查核。
        </p>
      )}
    </section>
    <div className="text-meta mt-6 flex flex-wrap gap-x-6 gap-y-2">
      <Link
        className="text-primary inline-flex min-h-11 items-center rounded-md focus-visible:outline-2"
        href="/status"
        prefetch={false}
      >
        查看帳戶狀態
      </Link>
      <Link
        className="text-primary inline-flex min-h-11 items-center rounded-md focus-visible:outline-2"
        href="/inbox"
        prefetch={false}
      >
        查看審批決定
      </Link>
    </div>
  </>
);

const ApplicantEditForm = withForm({
  ...applicantFormOptions,
  props: {} as {
    changed: boolean;
    operationRetry?: boolean;
    username: string | null;
  },
  render: ({ changed, form, username, operationRetry = false }) => (
    <>
      {operationRetry ? (
        <AccountOperationOutcome
          message="伺服器未找到完成紀錄，操作仍未確認。只有本頁仍保留完整原送出資料，才可確認後重試；否則請繼續查核，原操作代碼會保留。"
          title="未找到操作紀錄"
          tone="warning"
        />
      ) : null}
      <form
        className="mt-2 flex flex-col gap-6"
        onSubmit={async (event) => {
          event.preventDefault();
          await form.handleSubmit();
        }}
      >
        <p className="text-muted-foreground">
          Username 維持 {username ?? "未設定"}。
        </p>
        <form.AppField
          name="fullName"
          validators={{ onChange: identityFieldSchemas.fullName }}
        >
          {(field) => (
            <field.TextField
              autoComplete="name"
              id="applicant-name"
              label="中文全名"
              maxLength={200}
              required
            />
          )}
        </form.AppField>
        <form.AppField
          name="email"
          validators={{ onChange: identityFieldSchemas.email }}
        >
          {(field) => (
            <field.TextField
              autoComplete="email"
              description="電郵變更後仍未經驗證，不會啟用電郵復原。"
              id="applicant-email"
              label="電郵地址"
              maxLength={254}
              required
              type="email"
            />
          )}
        </form.AppField>
        <form.AppField
          name="phone"
          validators={{ onChange: identityFieldSchemas.phone }}
        >
          {(field) => (
            <field.TextField
              autoComplete="tel"
              id="applicant-phone"
              label="電話"
              maxLength={40}
              required
              type="tel"
            />
          )}
        </form.AppField>
        <Button disabled={!changed} type="submit">
          檢查更改
        </Button>
      </form>
    </>
  ),
});

const ApplicantEditReview = ({
  application,
  canSubmit,
  draft,
  onConfirm,
  onReturn,
}: {
  application: OwnApplication;
  canSubmit: boolean;
  draft: ApplicantDraft;
  onConfirm: () => void;
  onReturn: () => void;
}) => (
  <section aria-labelledby="applicant-edit-review" className="mt-2">
    <h2 className="sr-only" id="applicant-edit-review">
      提交前檢查
    </h2>
    <AccountOperationSummary
      rows={[
        {
          after: draft.fullName,
          before: application.fullName,
          label: "中文全名",
        },
        { after: draft.email, before: application.email, label: "電郵" },
        {
          after: draft.phone,
          before: application.phone ?? "未設定",
          label: "電話",
        },
      ]
        .filter((row) => row.before !== row.after)
        .map((row) => ({
          label: row.label,
          value: (
            <span>
              {row.before}
              <span className="text-muted-foreground mx-2" aria-label="改為">
                →
              </span>
              {row.after}
            </span>
          ),
        }))}
    />
    <AccountOperationOutcome
      message="確認資料無誤後才提交。電郵仍需另行驗證；本次修正不會改動 Username。"
      title="確認申請更改"
      tone="info"
    />
    <div className="mt-4 flex flex-col gap-3">
      <Button
        className="w-full"
        disabled={!canSubmit}
        type="button"
        onClick={onConfirm}
      >
        確認並提交更改
      </Button>
      <Button
        className="w-full"
        type="button"
        variant="secondary"
        onClick={onReturn}
      >
        返回修改
      </Button>
    </div>
    <AccountOperationDetails
      title="未改動資料"
      rows={[
        ...[
          {
            after: draft.fullName,
            before: application.fullName,
            label: "中文全名",
          },
          { after: draft.email, before: application.email, label: "電郵" },
          {
            after: draft.phone,
            before: application.phone ?? "未設定",
            label: "電話",
          },
        ]
          .filter((row) => row.before === row.after)
          .map((row) => ({ label: row.label, value: row.before })),
        { label: "Username", value: application.username ?? "未設定" },
      ]}
    />
  </section>
);

const ApplicantDecisionReview = ({
  action,
  application,
  canSubmit,
  onCancel,
  onConfirm,
}: {
  action: "application_withdrawn" | "application_resubmitted";
  application: OwnApplication;
  canSubmit: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) => {
  const withdrawing = action === "application_withdrawn";
  const title = withdrawing ? "確認撤回" : "確認重新提交";
  const message = withdrawing
    ? "這不會刪除你的帳戶。撤回後申請會移出待批名單，之後仍可重新提交。"
    : "提交後會再次等待同工審批；重新提交不代表帳戶已獲批准。";

  return (
    <section aria-labelledby="applicant-decision-review" className="mt-2">
      <h2 className="sr-only" id="applicant-decision-review">
        {title}
      </h2>
      <p className="text-muted-foreground mt-2">請先核對以下資料。</p>
      <AccountOperationSummary
        rows={[
          { label: "申請人", value: application.fullName },
          { label: "Username", value: application.username ?? "未設定" },
          { label: "目前狀態", value: statusLabels[application.status] },
        ]}
      />
      <AccountOperationOutcome
        message={message}
        title={withdrawing ? "這不會刪除你的帳戶" : "提交後需等候審批"}
        tone="warning"
      />
      <div className="mt-4 flex flex-col gap-3">
        <Button
          className="w-full"
          disabled={!canSubmit}
          type="button"
          variant={withdrawing ? "danger" : "primary"}
          onClick={onConfirm}
        >
          {withdrawing ? "確認撤回" : "確認重新提交"}
        </Button>
        <Button
          className="w-full"
          type="button"
          variant="secondary"
          onClick={onCancel}
        >
          {withdrawing ? "返回我的申請" : "取消重新提交"}
        </Button>
      </div>
    </section>
  );
};

const ApplicantBusyView = ({
  flow,
  message,
}: {
  flow: BusyFlow;
  message: string;
}) => {
  const { title, tone } = outcomes[flow];
  return (
    <AccountOperationOutcome busy message={message} title={title} tone={tone} />
  );
};

const ApplicantStorageErrorView = ({
  message,
  onCheck,
}: {
  message: string;
  onCheck: () => void;
}) => (
  <>
    <AccountOperationOutcome
      message={message}
      title={outcomes["storage-error"].title}
      tone={outcomes["storage-error"].tone}
    />
    <Button
      className="mt-2"
      type="button"
      variant="secondary"
      onClick={onCheck}
    >
      重新檢查本機儲存
    </Button>
  </>
);

const ApplicantOperationAction = ({
  canRetry,
  flow,
  hasUnsavedDraft,
  onCheck,
  onFinish,
  onRetry,
  onReenter,
  operation,
}: {
  canRetry: boolean;
  flow: OperationFlow;
  hasUnsavedDraft: boolean;
  onCheck: () => void;
  onFinish: () => void;
  onRetry: (action: Operation["action"]) => void;
  onReenter: () => void;
  operation: Operation | null;
}) => {
  if (flow === "confirmed") {
    return (
      <Button className="mt-2" type="button" onClick={onFinish}>
        {hasUnsavedDraft ? "保留草稿，繼續核對" : "完成，開始另一項操作"}
      </Button>
    );
  }
  if (flow === "retry" && canRetry && operation) {
    if (operation.action === "application_corrected") {
      return (
        <Button className="mt-2" type="button" onClick={onReenter}>
          重新輸入修正資料
        </Button>
      );
    }
    return (
      <Button
        className="mt-2"
        type="button"
        onClick={() => onRetry(operation.action)}
      >
        以同一操作重試
      </Button>
    );
  }
  return (
    <Button className="mt-2" type="button" onClick={onCheck}>
      查核之前的操作
    </Button>
  );
};

const ApplicantOperationView = ({
  actorUserId,
  application,
  flow,
  hasUnsavedDraft,
  message,
  operation,
  onCheck,
  onFinish,
  onRetry,
  onReenter,
}: {
  actorUserId: string;
  application: OwnApplication;
  flow: OperationFlow;
  hasUnsavedDraft: boolean;
  message: string;
  operation: Operation | null;
  onCheck: () => void;
  onFinish: () => void;
  onRetry: (action: Operation["action"]) => void;
  onReenter: () => void;
}) => {
  const ownOperation = operation?.actorUserId === actorUserId;
  const canRetry = ownOperation && operation?.applicationId === application.id;
  const { title, tone } = outcomes[flow];

  return (
    <>
      {ownOperation && operation ? (
        <AccountOperationSummary
          rows={[
            { label: "操作", value: labels[operation.action] },
            { label: "申請人", value: application.fullName },
            { label: "Username", value: application.username ?? "未設定" },
            { label: "目前狀態", value: statusLabels[application.status] },
          ]}
        />
      ) : null}
      <AccountOperationOutcome
        message={message}
        title={
          flow === "unknown" && operation?.action === "application_withdrawn"
            ? "撤回申請結果未確認"
            : title
        }
        tone={tone}
      />
      {flow === "confirmed" && hasUnsavedDraft ? (
        <p className="text-muted-foreground mt-2">
          這項操作已完成，但本頁草稿尚未提交。繼續核對會保留草稿；只有確認放棄並成功載入最新資料後，才會替換內容。
        </p>
      ) : null}
      <ApplicantOperationAction
        canRetry={canRetry}
        flow={flow}
        hasUnsavedDraft={hasUnsavedDraft}
        onCheck={onCheck}
        onFinish={onFinish}
        onRetry={onRetry}
        onReenter={onReenter}
        operation={operation}
      />
      {ownOperation && operation ? (
        <AccountOperationDetails
          rows={[
            { label: "原操作編號", value: operation.key },
            { label: "原申請編號", value: operation.applicationId },
            { label: "原登入帳戶", value: operation.actorUserId },
          ]}
        />
      ) : null}
    </>
  );
};

const ApplicantTaskPanel = withForm({
  ...applicantFormOptions,
  props: {} as {
    application: OwnApplication;
    children: ReactNode;
    canSubmit: (action: Operation["action"]) => boolean;
    changed: boolean;
    eligible: boolean;
    flow: Flow;
    onConfirm: (action: Operation["action"]) => void;
    onEdit: () => void;
    onReviewResubmit: () => void;
    onReviewWithdraw: () => void;
    onReturnEdit: () => void;
    onCancelAction: () => void;
    reviewDraft: ApplicantDraft;
    view: TaskView;
  },
  render: ({
    application,
    children,
    canSubmit,
    changed,
    form,
    eligible,
    flow,
    onConfirm,
    onEdit,
    onReviewResubmit,
    onReviewWithdraw,
    onReturnEdit,
    onCancelAction,
    reviewDraft,
    view,
  }) => {
    if (view === "overview") {
      return (
        <ApplicantOverview
          application={application}
          eligible={eligible}
          onEdit={onEdit}
          onResubmit={onReviewResubmit}
          onWithdraw={onReviewWithdraw}
        >
          {children}
        </ApplicantOverview>
      );
    }
    if (view === "edit") {
      return (
        <ApplicantEditForm
          changed={changed}
          form={form}
          username={application.username}
          operationRetry={flow === "retry"}
        />
      );
    }
    if (view === "edit-review") {
      return (
        <ApplicantEditReview
          application={application}
          canSubmit={canSubmit("application_corrected")}
          draft={reviewDraft}
          onConfirm={() => onConfirm("application_corrected")}
          onReturn={onReturnEdit}
        />
      );
    }
    if (view === "withdraw-review") {
      return (
        <ApplicantDecisionReview
          action="application_withdrawn"
          application={application}
          canSubmit={canSubmit("application_withdrawn")}
          onCancel={onCancelAction}
          onConfirm={() => onConfirm("application_withdrawn")}
        />
      );
    }
    return (
      <ApplicantDecisionReview
        action="application_resubmitted"
        application={application}
        canSubmit={canSubmit("application_resubmitted")}
        onCancel={onCancelAction}
        onConfirm={() => onConfirm("application_resubmitted")}
      />
    );
  },
});

const ApplicantPanel = withForm({
  ...applicantFormOptions,
  props: {} as {
    actorUserId: string;
    application: OwnApplication;
    canSubmit: (action: Operation["action"]) => boolean;
    changed: boolean;
    children: ReactNode;
    eligible: boolean;
    flow: Flow;
    hasUnsavedDraft: boolean;
    mode: PanelMode;
    message: string;
    onCheck: () => void;
    onConfirm: (action: Operation["action"]) => void;
    onEdit: () => void;
    onFinish: () => void;
    onReviewResubmit: () => void;
    onReviewWithdraw: () => void;
    onReturnEdit: () => void;
    onCancelAction: () => void;
    onRetry: (action: Operation["action"]) => void;
    onReenter: () => void;
    operation: Operation | null;
    reviewDraft: ApplicantDraft;
    view: TaskView;
  },
  render: ({
    actorUserId,
    application,
    canSubmit,
    changed,
    children,
    eligible,
    flow,
    hasUnsavedDraft,
    form,
    mode,
    message,
    onCheck,
    onConfirm,
    onEdit,
    onFinish,
    onReviewResubmit,
    onReviewWithdraw,
    onReturnEdit,
    onCancelAction,
    onRetry,
    onReenter,
    operation,
    reviewDraft,
    view,
  }) => {
    if (mode.kind === "busy") {
      return <ApplicantBusyView flow={mode.flow} message={message} />;
    }
    if (mode.kind === "storage-error") {
      return <ApplicantStorageErrorView message={message} onCheck={onCheck} />;
    }
    if (mode.kind === "operation") {
      return (
        <ApplicantOperationView
          actorUserId={actorUserId}
          application={application}
          flow={mode.flow}
          hasUnsavedDraft={hasUnsavedDraft}
          message={message}
          operation={operation}
          onCheck={onCheck}
          onFinish={onFinish}
          onRetry={onRetry}
          onReenter={onReenter}
        />
      );
    }
    return (
      <ApplicantTaskPanel
        application={application}
        canSubmit={canSubmit}
        changed={changed}
        children={children}
        eligible={eligible}
        flow={flow}
        form={form}
        onCancelAction={onCancelAction}
        onConfirm={onConfirm}
        onEdit={onEdit}
        onReviewResubmit={onReviewResubmit}
        onReviewWithdraw={onReviewWithdraw}
        onReturnEdit={onReturnEdit}
        reviewDraft={reviewDraft}
        view={mode.kind === "retry-edit" ? view : mode.view}
      />
    );
  },
});

const reviewIsCurrent = (
  review: ReviewContext | null,
  actorUserId: string,
  application: OwnApplication
) =>
  !review ||
  (review.actorUserId === actorUserId &&
    review.applicationId === application.id &&
    review.status === application.status);

const reviewDraftOf = (
  review: ReviewContext | null,
  fallback: ApplicantDraft
) => (review?.action === "application_corrected" ? review.draft : fallback);

const applicantActionRequest = (
  operation: Operation,
  corrected: ApplicantDraft | undefined,
  application: OwnApplication
): ApplicantActionRequest => {
  if (operation.action === "application_corrected") {
    if (!corrected) {
      throw new Error("A correction payload is required.");
    }
    return {
      action: "application_corrected",
      applicationId: operation.applicationId,
      email: corrected.email,
      fullName: corrected.fullName,
      operationKey: operation.key,
      original: originalIdentityValues(application),
      phone: corrected.phone,
    };
  }
  return {
    action: operation.action,
    applicationId: operation.applicationId,
    operationKey: operation.key,
  };
};

const applicationSnapshot = (application: OwnApplication) =>
  JSON.stringify([
    application.id,
    application.status,
    application.canonicalUsername,
    application.username,
    application.fullName,
    application.email,
    application.phone,
    application.phoneShared,
  ]);
interface FrozenApplicantRequest {
  key: string;
  request: ApplicantActionRequest;
}
const canUseApplicantRequest = (
  saved: Operation | null,
  frozen: FrozenApplicantRequest | null,
  request: ApplicantActionRequest
) =>
  !saved ||
  request.action !== "application_corrected" ||
  (frozen !== null &&
    frozen.key === saved.key &&
    JSON.stringify(frozen.request) === JSON.stringify(request));

const isConfirmedApplicantDraft = (
  flow: Flow,
  operation: Operation | null,
  frozen: FrozenApplicantRequest | null,
  draft: ApplicantDraft
) =>
  flow === "confirmed" &&
  frozen !== null &&
  frozen.key === operation?.key &&
  frozen.request.action === "application_corrected" &&
  frozen.request.fullName === draft.fullName &&
  frozen.request.email === draft.email &&
  frozen.request.phone === draft.phone;

interface ApplicantFormProps {
  actorUserId: string;
  application: OwnApplication;
  children: ReactNode;
  eligible: boolean;
}

const ApplicantTask = ({
  actorUserId,
  application: currentApplication,
  children,
  eligible,
}: ApplicantFormProps) => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [application, setApplication] = useState(currentApplication);
  const sourceSnapshot = useRef(applicationSnapshot(currentApplication));
  const frozenRequest = useRef<FrozenApplicantRequest | null>(null);
  const [stale, setStale] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [flow, setFlow] = useState<Flow>("restoring");
  const [message, setMessage] = useState("正在查核未確認操作。");
  const [operation, setOperation] = useState<Operation | null>(null);
  const [view, setView] = useState<TaskView>("overview");
  const [reviewContext, setReviewContext] = useState<ReviewContext | null>(
    null
  );
  const [rejection, setRejection] = useState<string | null>(null);
  const busyRef = useRef(false);
  const onReviewEdit = (values: ApplicantDraft) => {
    if (!hasDraftChanges(values, application)) {
      setRejection("沒有資料更改，請先修改欄位。");
      return;
    }
    setReviewContext({
      action: "application_corrected",
      actorUserId,
      applicationId: application.id,
      draft: { ...values },
      status: application.status,
    });
    setRejection(null);
    setView("edit-review");
  };
  const form = useAppForm({
    ...applicantFormOptions,
    defaultValues: draftFromApplication(application),
    onSubmit: ({ value }) => onReviewEdit(value),
  });
  const draft = useSelector(form.store, (state) => state.values);
  const busy =
    reloading ||
    flow === "restoring" ||
    flow === "checking" ||
    flow === "submitting";
  const draftChanged = hasDraftChanges(draft, application);
  const confirmedDraft = isConfirmedApplicantDraft(
    flow,
    operation,
    frozenRequest.current,
    draft
  );
  const unsaved =
    ((view === "edit" || view === "edit-review") &&
      draftChanged &&
      !confirmedDraft) ||
    (flow !== "confirmed" &&
      (view === "withdraw-review" || view === "resubmit-review"));

  const submissionMutation = useMutation({
    gcTime: 0,
    mutationFn: ({
      expectedActorId,
      request,
    }: {
      expectedActorId: string;
      request: ApplicantActionRequest;
    }) => submitApplicantAction(request, expectedActorId),
    networkMode: "always",
    retry: false,
  });

  const lifetime = useApplicantOperationLifetime(
    actorUserId,
    application.id,
    submissionMutation.reset
  );

  useEffect(() => {
    busyRef.current = false;
    frozenRequest.current = null;
  }, [lifetime]);

  const currentSnapshot = applicationSnapshot(currentApplication);
  const sourceChanged =
    sourceSnapshot.current !== currentSnapshot &&
    applicationSnapshot(application) !== currentSnapshot;
  useEffect(() => {
    if (sourceSnapshot.current === currentSnapshot) {
      return;
    }
    sourceSnapshot.current = currentSnapshot;
    if (
      (flow === "confirmed" && !unsaved) ||
      (!unsaved && flow === "ready" && operation === null)
    ) {
      setApplication(currentApplication);
      form.reset(draftFromApplication(currentApplication));
      setStale(false);
    } else if (applicationSnapshot(application) !== currentSnapshot) {
      setStale(true);
    }
  }, [
    application,
    currentApplication,
    currentSnapshot,
    flow,
    form,
    operation,
    unsaved,
  ]);

  const reconcile = useCallback(
    async (saved: Operation) => {
      const isCurrent = lifetime.capture();
      if (!isCurrent()) {
        return;
      }
      setOperation(saved);
      if (saved.actorUserId !== actorUserId) {
        setFlow("unknown");
        setMessage(
          "此瀏覽器保留了另一帳戶未確認的操作。請以原帳戶登入查核；操作代碼不會被清除。"
        );
        return;
      }
      setFlow("checking");
      setMessage("正在向伺服器查核結果。");
      try {
        const response = await readTransientReconciliation(
          queryClient,
          lifetime.queryKey,
          ({ signal }) =>
            requestApplicantReconciliation(
              { operationKey: saved.key },
              actorUserId,
              signal
            )
        );
        if (!isCurrent()) {
          return;
        }
        if (response.status === 401) {
          setFlow("unknown");
          setMessage(
            "目前未能確認登入身份。請以原帳戶登入後查核；操作代碼仍保留。"
          );
          return;
        }
        if (response.status === 403) {
          setFlow("denied");
          setMessage(
            "目前沒有權限查核這項操作。操作代碼仍保留；權限恢復後請再次查核。"
          );
          return;
        }
        if (response.status === 429) {
          setFlow("rate-limited");
          setMessage("查核次數較多，請稍後再查核。原操作代碼仍保留。");
          return;
        }
        const parsed = applicantActionResponseSchema.safeParse(
          await response.json()
        );
        if (!isCurrent()) {
          return;
        }
        if (
          !response.ok ||
          !parsed.success ||
          (parsed.data.data.receipt &&
            !matchesOperation(parsed.data.data.receipt, saved))
        ) {
          throw new Error("Receipt unavailable");
        }
        if (parsed.data.data.receipt) {
          setFlow("confirmed");
          setMessage(`伺服器已確認「${labels[saved.action]}」完成。`);
        } else {
          setFlow("retry");
          setMessage(
            saved.action === "application_corrected" &&
              frozenRequest.current === null
              ? "伺服器未找到完成紀錄，亦未能還原原操作資料；請繼續查核原結果。操作代碼會保留，不會猜測資料重試。"
              : "伺服器未找到完成紀錄，操作尚未確認。只可用完全相同的原操作資料重試。"
          );
        }
        router.refresh();
      } catch {
        if (!isCurrent()) {
          return;
        }
        setFlow("unknown");
        setMessage(
          "暫時未能查核，結果仍未確認。請再次查核；未確認前不要開始另一項操作。"
        );
      }
    },
    [actorUserId, lifetime, queryClient, router]
  );

  const check = useCallback(async () => {
    const isCurrent = lifetime.capture();
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    try {
      await navigator.locks.request(storageKey, async () => {
        if (!isCurrent()) {
          return;
        }
        const saved = readOperation();
        if (saved) {
          await reconcile(saved);
          return;
        }
        setOperation(null);
        setFlow("ready");
        setMessage("");
        setRejection(null);
      });
    } catch {
      if (!isCurrent()) {
        return;
      }
      setFlow("storage-error");
      setMessage(
        "未能安全讀取操作代碼或取得瀏覽器鎖。操作結果尚未確認；請恢復本機儲存後再查核。"
      );
    } finally {
      if (isCurrent()) {
        busyRef.current = false;
      }
    }
  }, [lifetime, reconcile]);

  useEffect(() => {
    void check();
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === storageKey) {
        void check();
      }
    };
    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, [check]);

  const canSubmit = (action: Operation["action"]) => {
    if (!eligible || busy || stale || sourceChanged) {
      return false;
    }
    if (flow === "ready") {
      return reviewContext?.action === action;
    }
    return (
      flow === "retry" &&
      (action !== "application_corrected" || frozenRequest.current !== null) &&
      operation?.action === action &&
      operation.actorUserId === actorUserId &&
      operation.applicationId === application.id
    );
  };

  const handleResponse = async (
    response: ApplicantActionResponse,
    saved: Operation | null,
    next: Operation
  ) => {
    const isCurrent = lifetime.capture();
    const body: unknown = await response.json();
    const result = applicantActionResponseSchema.safeParse(body);
    const error = operationErrorSchema.safeParse(body);
    const staleFailure =
      response.status === 409 &&
      error.success &&
      error.data.error.code === "stale_identity";
    if (!isCurrent()) {
      return;
    }
    if (
      response.ok &&
      result.success &&
      result.data.data.receipt &&
      matchesOperation(result.data.data.receipt, next)
    ) {
      setFlow("confirmed");
      setMessage(`伺服器已確認「${labels[next.action]}」完成。`);
      setReviewContext(null);
      router.refresh();
      return;
    }
    if (staleFailure) {
      setStale(true);
    }
    if (!saved && (response.status === 400 || staleFailure)) {
      try {
        localStorage.removeItem(storageKey);
        if (readOperation() !== null) {
          throw new Error("Operation metadata remains stored.");
        }
      } catch {
        setFlow("storage-error");
        setMessage(
          "資料格式未能通過檢查，但本機仍無法安全清除操作代碼。請恢復儲存後重新查核。"
        );
        return;
      }
      setOperation(null);
      frozenRequest.current = null;
      setFlow("ready");
      if (staleFailure) {
        setRejection(
          "資料已更新，這次修正未提交；原草稿已保留，請重新載入最新資料後再核對。"
        );
        return;
      }
      setView(next.action === "application_corrected" ? "edit" : "overview");
      setReviewContext(null);
      setRejection("資料格式不正確，請檢查欄位後再提交。");
      return;
    }
    if (response.status === 401) {
      setFlow("unknown");
      setMessage(
        "目前未能確認登入身份。操作代碼仍保留，請以原帳戶登入後查核。"
      );
      return;
    }
    if (response.status === 403) {
      setFlow("denied");
      setMessage(
        "安全檢查未允許這次操作。原操作代碼仍保留，請恢復權限後重新查核。"
      );
      return;
    }
    if (response.status === 429) {
      setFlow("rate-limited");
      setMessage("操作次數較多，請稍後再查核。原操作代碼仍保留。");
      return;
    }
    await reconcile(next);
  };

  const submitAction = async (
    action: Operation["action"],
    corrected?: ApplicantDraft
  ) => {
    const isCurrent = lifetime.capture();
    if (!isCurrent() || !eligible || busyRef.current || !canSubmit(action)) {
      return;
    }
    if (!reviewIsCurrent(reviewContext, actorUserId, currentApplication)) {
      setStale(true);
      setRejection("資料已更新，原草稿已保留；請重新載入最新資料後再核對。");
      return;
    }
    if (action === "application_corrected" && !corrected) {
      return;
    }

    busyRef.current = true;
    let requestStarted = false;
    try {
      await navigator.locks.request(storageKey, async () => {
        if (!isCurrent()) {
          return;
        }
        const saved = readOperation();
        if (
          saved &&
          (saved.actorUserId !== actorUserId ||
            saved.key !== operation?.key ||
            saved.action !== action ||
            saved.applicationId !== application.id)
        ) {
          await reconcile(saved);
          return;
        }
        if (flow === "retry" && !saved) {
          setFlow("storage-error");
          setMessage(
            "找不到原操作代碼，因此沒有建立新操作。請恢復本機記錄後再查核。"
          );
          return;
        }
        const next = saved ?? {
          action,
          actorUserId,
          applicationId: application.id,
          key: crypto.randomUUID(),
        };
        localStorage.setItem(storageKey, JSON.stringify(next));
        if (readOperation()?.key !== next.key) {
          throw new Error("Metadata unavailable");
        }
        setOperation(next);
        setFlow("submitting");
        setMessage("正在提交，請勿重複按下提交。");
        const request = applicantActionRequest(next, corrected, application);
        if (!canUseApplicantRequest(saved, frozenRequest.current, request)) {
          setFlow("unknown");
          setMessage(
            "未能還原與原操作完全相同的資料，操作代碼已保留；請繼續查核原結果，不會重新套用最新資料重試。"
          );
          return;
        }
        frozenRequest.current = { key: next.key, request };
        requestStarted = true;
        try {
          const response = await submissionMutation.mutateAsync({
            expectedActorId: actorUserId,
            request,
          });
          if (!isCurrent()) {
            return;
          }
          await handleResponse(response, saved, next);
        } catch {
          if (!isCurrent()) {
            return;
          }
          await reconcile(next);
        }
      });
    } catch {
      if (!isCurrent()) {
        return;
      }
      setFlow("storage-error");
      setMessage(
        requestStarted
          ? "未能安全查核操作代碼。結果仍未確認；請恢復本機儲存後查核。"
          : "未能安全保存操作代碼，操作尚未提交。請恢復本機儲存後再試。"
      );
    } finally {
      if (isCurrent()) {
        busyRef.current = false;
      }
    }
  };

  const finish = async () => {
    const isCurrent = lifetime.capture();
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
        if (!isCurrent()) {
          return;
        }
        const saved = readOperation();
        if (
          saved &&
          (saved.key !== operation.key || saved.actorUserId !== actorUserId)
        ) {
          await reconcile(saved);
          return;
        }
        if (saved) {
          localStorage.removeItem(storageKey);
          if (readOperation() !== null) {
            throw new Error("Operation metadata remains stored.");
          }
        }
        frozenRequest.current = null;
        if (unsaved) {
          // A foreign completed operation does not certify this page's draft.
          setOperation(null);
          setFlow("ready");
          setMessage("");
          return;
        }
        // Acknowledged completion starts the next task from a fresh Server read,
        // before another action can reuse the completed task's original values.
        window.location.assign("/application");
      });
    } catch {
      if (!isCurrent()) {
        return;
      }
      setFlow("storage-error");
      setMessage(
        "操作已確認完成，但未能安全清除本機操作代碼。請恢復儲存後再次查核；原記錄仍保留。"
      );
    } finally {
      if (isCurrent()) {
        busyRef.current = false;
      }
    }
  };

  const onDiscardUnsentWork = () => {
    form.reset(draftFromApplication(application));
    setReviewContext(null);
    setRejection(null);
    setView("overview");
  };
  const onReviewWithdraw = () => {
    setReviewContext({
      action: "application_withdrawn",
      actorUserId,
      applicationId: application.id,
      status: application.status,
    });
    setRejection(null);
    setView("withdraw-review");
  };
  const onReviewResubmit = () => {
    setReviewContext({
      action: "application_resubmitted",
      actorUserId,
      applicationId: application.id,
      status: application.status,
    });
    setRejection(null);
    setView("resubmit-review");
  };
  const refreshApplication = async () => {
    const isCurrent = lifetime.capture();
    if (!isCurrent() || busyRef.current) {
      return;
    }
    busyRef.current = true;
    setReloading(true);
    try {
      await navigator.locks.request(storageKey, async () => {
        const saved = readOperation();
        if (saved) {
          await reconcile(saved);
          return;
        }
        const result = await readTransientReconciliation(
          queryClient,
          lifetime.queryKey,
          async ({ signal }) => {
            const response = await businessRpc.api.v2.applications.mine.$get(
              {},
              {
                headers: { "x-efcc-expected-actor-id": actorUserId },
                init: { cache: "no-store", credentials: "same-origin", signal },
              }
            );
            const body: unknown = await response.json();
            return {
              parsed: ownApplicationResponseSchema.safeParse(body),
              status: response.status,
            };
          }
        );
        if (!isCurrent()) {
          return;
        }
        if (
          result.status === 401 ||
          result.status === 403 ||
          result.status === 409
        ) {
          setFlow("denied");
          setMessage(
            "目前已不能載入此申請，正在重新查核可用頁面；原操作代碼會保留。"
          );
          router.refresh();
          return;
        }
        if (result.status !== 200 || !result.parsed.success) {
          throw new Error("Current application unavailable");
        }
        const latest = result.parsed.data.data.application;
        if (!latest || latest.id !== application.id) {
          setFlow("denied");
          setMessage("目前申請已改變，請返回重新查核。");
          router.refresh();
          return;
        }
        setApplication(latest);
        form.reset(draftFromApplication(latest));
        setReviewContext(null);
        setRejection(null);
        setStale(false);
        setFlow("ready");
        setView(latest.status === "approved" ? "overview" : "edit");
        setMessage("已載入最新資料，請重新檢查修改後再提交。");
        router.refresh();
      });
    } catch {
      if (isCurrent()) {
        setRejection("未能載入最新資料，原草稿已保留；請稍後再次重新載入。");
      }
    } finally {
      if (isCurrent()) {
        busyRef.current = false;
        setReloading(false);
      }
    }
  };
  const title = applicantTaskTitle(flow, view, operation);
  const mode = panelMode(flow, view, operation, actorUserId, application.id);

  return (
    <section className="flex flex-col">
      <TaskHeader
        returnControl={
          view !== "overview" && !unsaved ? (
            <button
              aria-label="返回我的申請"
              className="text-primary flex min-h-11 min-w-11 items-center justify-center rounded-lg focus-visible:outline-2"
              onClick={onDiscardUnsentWork}
              type="button"
            >
              <Icon className="size-5" name="arrow-left" />
            </button>
          ) : (
            <UnsavedChangesLink
              className="text-primary flex min-h-11 min-w-11 items-center justify-center rounded-lg focus-visible:outline-2"
              description="繼續處理會保留目前申請更改；放棄變更會清除未提交的內容並返回上一頁。已提交操作的查核記錄會保留。"
              href={view === "overview" ? "/account" : "/application"}
              isDirty={unsaved}
              onDiscard={onDiscardUnsentWork}
            >
              <Icon className="size-5" name="arrow-left" />
              <span className="sr-only">
                {view === "overview" ? "返回帳戶" : "返回我的申請"}
              </span>
            </UnsavedChangesLink>
          )
        }
        title={title}
      />
      {rejection ? (
        <AccountOperationOutcome
          message={rejection}
          title="申請資料需要檢查"
          tone="danger"
        />
      ) : null}
      {flow !== "denied" && flow !== "confirmed" && (stale || sourceChanged) ? (
        <StaleDataRefresh
          disabled={operation !== null}
          pending={busy}
          onRefresh={refreshApplication}
        />
      ) : null}
      <ApplicantPanel
        actorUserId={actorUserId}
        application={application}
        canSubmit={canSubmit}
        changed={draftChanged}
        children={children}
        eligible={eligible}
        flow={flow}
        hasUnsavedDraft={unsaved}
        form={form}
        message={message}
        mode={mode}
        onCheck={check}
        onConfirm={(action) =>
          submitAction(
            action,
            action === "application_corrected"
              ? reviewDraftOf(reviewContext, draft)
              : undefined
          )
        }
        onEdit={() => {
          if (
            !(flow === "retry" && operation?.action === "application_corrected")
          ) {
            form.reset(draftFromApplication(application));
          }
          setReviewContext(null);
          setRejection(null);
          setView("edit");
        }}
        onFinish={finish}
        onReviewResubmit={onReviewResubmit}
        onReviewWithdraw={onReviewWithdraw}
        onReturnEdit={() => setView("edit")}
        onCancelAction={onDiscardUnsentWork}
        onRetry={submitAction}
        onReenter={() => setView("edit")}
        operation={operation}
        reviewDraft={reviewDraftOf(reviewContext, draft)}
        view={view}
      />
    </section>
  );
};

/** A replacement owner must never inherit another task's draft or review. */
export const ApplicantForm = (props: ApplicantFormProps) => (
  <ApplicantTask
    key={JSON.stringify([props.actorUserId, props.application.id])}
    {...props}
  />
);
