"use client";

import { useSelector } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ClientResponse, InferRequestType } from "hono/client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import * as z from "zod";

import { useAppForm } from "@/components/ui/app-form";
import type { AppFormApi } from "@/components/ui/app-form";
import { Button } from "@/components/ui/button";
import { UnsavedChangesLink } from "@/components/unsaved-changes-link";
import {
  applicantActionResponseSchema,
  applicationFieldSchemas,
} from "@/features/account/application-contract";
import { businessRpc } from "@/shared/business-rpc";

import type { OwnApplication } from "./decisions";
import {
  AccountOperationOutcome,
  AccountOperationSummary,
} from "./operation-presentation";

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
const reconciliationQueryKey = ["applicant-operation-reconciliation"] as const;
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
  expectedActorId: string
) =>
  businessRpc.api.v2.applications.actions.reconcile.$post(
    { json: request },
    {
      headers: { "x-efcc-expected-actor-id": expectedActorId },
      init: applicantRequestInit,
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
type ApplicantEditFormApi = AppFormApi<ApplicantDraft>;

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
    case "edit":
    case "edit-review": {
      return "修正申請資料";
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
    {children}
    <section aria-labelledby="applicant-actions-title" className="mt-2">
      <h2 className="text-section font-semibold" id="applicant-actions-title">
        處理自己的申請
      </h2>
      {eligible ? (
        <div className="mt-4 flex flex-col gap-3">
          <p className="text-muted-foreground">
            可修正姓名、電郵及電話；Username
            維持不變。電郵變更後仍未經驗證，不會啟用電郵復原。
          </p>
          <Button type="button" variant="secondary" onClick={onEdit}>
            修正申請資料
          </Button>
          {application.status === "pending" ? (
            <Button type="button" variant="secondary" onClick={onWithdraw}>
              撤回申請
            </Button>
          ) : null}
          {application.status === "rejected" ||
          application.status === "withdrawn" ? (
            <Button type="button" variant="secondary" onClick={onResubmit}>
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
  </>
);

const ApplicantEditForm = ({
  changed,
  form,
  onReview,
  operationRetry = false,
}: {
  changed: boolean;
  form: ApplicantEditFormApi;
  onReview: (values: ApplicantDraft) => void;
  operationRetry?: boolean;
}) => (
  <>
    {operationRetry ? (
      <AccountOperationOutcome
        message="伺服器未找到完成紀錄。請重新輸入原資料，並沿用同一操作代碼重試。"
        title="未找到操作紀錄"
        tone="warning"
      />
    ) : null}
    <form
      className="mt-2 flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        onReview(form.state.values);
      }}
    >
      <p className="text-muted-foreground">
        Username 維持不變；電郵變更後仍未經驗證，不會啟用電郵復原。
      </p>
      <form.AppField
        name="fullName"
        validators={{ onChange: applicationFieldSchemas.fullName }}
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
        validators={{ onChange: applicationFieldSchemas.email }}
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
        validators={{ onChange: applicationFieldSchemas.phone }}
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
);

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
    <h2 className="text-section font-semibold" id="applicant-edit-review">
      提交前檢查
    </h2>
    <AccountOperationSummary
      rows={[
        { label: "原中文全名", value: application.fullName },
        { label: "修正後中文全名", value: draft.fullName },
        { label: "原電郵", value: application.email },
        { label: "修正後電郵", value: draft.email },
        { label: "原電話", value: application.phone ?? "未設定" },
        { label: "修正後電話", value: draft.phone },
        { label: "Username", value: application.username ?? "未設定" },
      ]}
    />
    <AccountOperationOutcome
      message="確認資料無誤後才提交。電郵仍需另行驗證；本次修正不會改動 Username。"
      title="確認申請更改"
      tone="info"
    />
    <div className="mt-4 flex flex-col gap-3">
      <Button type="button" variant="secondary" onClick={onReturn}>
        返回修改
      </Button>
      <Button disabled={!canSubmit} type="button" onClick={onConfirm}>
        確認並提交更改
      </Button>
    </div>
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
      <h2 className="text-section font-semibold" id="applicant-decision-review">
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
        <Button type="button" variant="secondary" onClick={onCancel}>
          {withdrawing ? "取消撤回" : "取消重新提交"}
        </Button>
        <Button disabled={!canSubmit} type="button" onClick={onConfirm}>
          {withdrawing ? "確認撤回" : "確認重新提交"}
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
  onCheck,
  onFinish,
  onRetry,
  onReenter,
  operation,
}: {
  canRetry: boolean;
  flow: OperationFlow;
  onCheck: () => void;
  onFinish: () => void;
  onRetry: (action: Operation["action"]) => void;
  onReenter: () => void;
  operation: Operation | null;
}) => {
  if (flow === "confirmed") {
    return (
      <Button className="mt-2" type="button" onClick={onFinish}>
        完成，開始另一項操作
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
      <AccountOperationOutcome message={message} title={title} tone={tone} />
      <ApplicantOperationAction
        canRetry={canRetry}
        flow={flow}
        onCheck={onCheck}
        onFinish={onFinish}
        onRetry={onRetry}
        onReenter={onReenter}
        operation={operation}
      />
    </>
  );
};

const ApplicantTaskPanel = ({
  application,
  children,
  canSubmit,
  changed,
  form,
  eligible,
  flow,
  onConfirm,
  onEdit,
  onReviewEdit,
  onReviewResubmit,
  onReviewWithdraw,
  onReturnEdit,
  onCancelAction,
  reviewDraft,
  view,
}: {
  application: OwnApplication;
  children: ReactNode;
  canSubmit: (action: Operation["action"]) => boolean;
  changed: boolean;
  form: ApplicantEditFormApi;
  eligible: boolean;
  flow: Flow;
  onConfirm: (action: Operation["action"]) => void;
  onEdit: () => void;
  onReviewEdit: (values: ApplicantDraft) => void;
  onReviewResubmit: () => void;
  onReviewWithdraw: () => void;
  onReturnEdit: () => void;
  onCancelAction: () => void;
  reviewDraft: ApplicantDraft;
  view: TaskView;
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
        onReview={onReviewEdit}
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
};

const ApplicantPanel = ({
  actorUserId,
  application,
  canSubmit,
  changed,
  children,
  eligible,
  flow,
  form,
  mode,
  message,
  onCheck,
  onConfirm,
  onEdit,
  onFinish,
  onReviewEdit,
  onReviewResubmit,
  onReviewWithdraw,
  onReturnEdit,
  onCancelAction,
  onRetry,
  onReenter,
  operation,
  reviewDraft,
  view,
}: {
  actorUserId: string;
  application: OwnApplication;
  canSubmit: (action: Operation["action"]) => boolean;
  changed: boolean;
  children: ReactNode;
  eligible: boolean;
  flow: Flow;
  form: ApplicantEditFormApi;
  mode: PanelMode;
  message: string;
  onCheck: () => void;
  onConfirm: (action: Operation["action"]) => void;
  onEdit: () => void;
  onFinish: () => void;
  onReviewEdit: (values: ApplicantDraft) => void;
  onReviewResubmit: () => void;
  onReviewWithdraw: () => void;
  onReturnEdit: () => void;
  onCancelAction: () => void;
  onRetry: (action: Operation["action"]) => void;
  onReenter: () => void;
  operation: Operation | null;
  reviewDraft: ApplicantDraft;
  view: TaskView;
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
      onReviewEdit={onReviewEdit}
      onReviewResubmit={onReviewResubmit}
      onReviewWithdraw={onReviewWithdraw}
      onReturnEdit={onReturnEdit}
      reviewDraft={reviewDraft}
      view={mode.kind === "retry-edit" ? view : mode.view}
    />
  );
};

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
  corrected: ApplicantDraft | undefined
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
      phone: corrected.phone,
    };
  }
  return {
    action: operation.action,
    applicationId: operation.applicationId,
    operationKey: operation.key,
  };
};

export const ApplicantForm = ({
  actorUserId,
  application,
  children,
  eligible,
}: {
  actorUserId: string;
  application: OwnApplication;
  children: ReactNode;
  eligible: boolean;
}) => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [flow, setFlow] = useState<Flow>("restoring");
  const [message, setMessage] = useState("正在查核未確認操作。");
  const [operation, setOperation] = useState<Operation | null>(null);
  const [view, setView] = useState<TaskView>("overview");
  const [reviewContext, setReviewContext] = useState<ReviewContext | null>(
    null
  );
  const [rejection, setRejection] = useState<string | null>(null);
  const busyRef = useRef(false);
  const form = useAppForm({
    defaultValues: draftFromApplication(application),
  });
  const draft = useSelector(form.store, (state) => state.values);
  const busy =
    flow === "restoring" || flow === "checking" || flow === "submitting";
  const draftChanged = hasDraftChanges(draft, application);
  const unsaved =
    ((view === "edit" || view === "edit-review") && draftChanged) ||
    view === "withdraw-review" ||
    view === "resubmit-review";

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

  useEffect(() => {
    form.reset(draftFromApplication(application));
  }, [
    form,
    actorUserId,
    application.email,
    application.fullName,
    application.id,
    application.phone,
    application.status,
  ]);

  const reconcile = useCallback(
    async (saved: Operation) => {
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
        const response = await queryClient.query({
          gcTime: 0,
          networkMode: "always",
          queryFn: () =>
            requestApplicantReconciliation(
              { operationKey: saved.key },
              actorUserId
            ),
          queryKey: reconciliationQueryKey,
          retry: false,
          staleTime: 0,
        });
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
            "伺服器未找到完成紀錄，操作尚未確認。請以同一操作重試；修正資料時請重新輸入原資料。"
          );
        }
        router.refresh();
      } catch {
        setFlow("unknown");
        setMessage(
          "暫時未能查核，結果仍未確認。請再次查核；未確認前不要開始另一項操作。"
        );
      } finally {
        queryClient.removeQueries({
          exact: true,
          queryKey: reconciliationQueryKey,
        });
      }
    },
    [actorUserId, queryClient, router]
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
          return;
        }
        setOperation(null);
        setFlow("ready");
        setMessage("");
        setRejection(null);
      });
    } catch {
      setFlow("storage-error");
      setMessage(
        "未能安全讀取操作代碼或取得瀏覽器鎖。操作結果尚未確認；請恢復本機儲存後再查核。"
      );
    } finally {
      busyRef.current = false;
    }
  }, [reconcile]);

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
    if (!eligible || busy) {
      return false;
    }
    if (flow === "ready") {
      return reviewContext?.action === action;
    }
    return (
      flow === "retry" &&
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
    const result = applicantActionResponseSchema.safeParse(
      await response.json()
    );
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
    if (!saved && response.status === 400) {
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
      setFlow("ready");
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
    if (!eligible || busyRef.current || !canSubmit(action)) {
      return;
    }
    if (!reviewIsCurrent(reviewContext, actorUserId, application)) {
      if (operation) {
        setFlow("unknown");
        setMessage(
          "申請狀態或登入身份已改變。原操作代碼仍保留，請先查核操作結果。"
        );
      } else {
        setFlow("ready");
        setRejection("申請狀態已更新，請檢查最新資料後再繼續。");
        setView("overview");
      }
      router.refresh();
      return;
    }
    if (action === "application_corrected" && !corrected) {
      return;
    }

    busyRef.current = true;
    let requestStarted = false;
    try {
      await navigator.locks.request(storageKey, async () => {
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
        const request = applicantActionRequest(next, corrected);
        requestStarted = true;
        try {
          const response = await submissionMutation.mutateAsync({
            expectedActorId: actorUserId,
            request,
          });
          await handleResponse(response, saved, next);
        } catch {
          await reconcile(next);
        }
      });
    } catch {
      setFlow("storage-error");
      setMessage(
        requestStarted
          ? "未能安全查核操作代碼。結果仍未確認；請恢復本機儲存後查核。"
          : "未能安全保存操作代碼，操作尚未提交。請恢復本機儲存後再試。"
      );
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
        setOperation(null);
        setFlow("ready");
        setMessage("");
        setReviewContext(null);
        setRejection(null);
        setView("overview");
        router.refresh();
      });
    } catch {
      setFlow("storage-error");
      setMessage(
        "操作已確認完成，但未能安全清除本機操作代碼。請恢復儲存後再次查核；原記錄仍保留。"
      );
    } finally {
      busyRef.current = false;
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
  const title =
    flow !== "ready" && !(flow === "retry" && view !== "overview")
      ? "申請操作結果"
      : viewTitle(view);
  const mode = panelMode(flow, view, operation, actorUserId, application.id);

  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center gap-3">
        <UnsavedChangesLink
          description="繼續處理會保留目前申請更改；放棄變更會清除未提交的內容並返回帳戶。已提交操作的查核記錄會保留。"
          href="/account"
          isDirty={unsaved}
          onDiscard={onDiscardUnsentWork}
        >
          ← 返回帳戶
        </UnsavedChangesLink>
        <h1 className="text-task font-semibold">{title}</h1>
      </header>
      {rejection ? (
        <AccountOperationOutcome
          message={rejection}
          title="申請資料需要檢查"
          tone="danger"
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
        onReviewEdit={onReviewEdit}
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
