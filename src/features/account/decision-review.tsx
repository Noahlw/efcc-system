"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { PageFrame, RootFrame, TaskHeader } from "@/components/page-frame";
import { useAppForm } from "@/components/ui/app-form";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { UnsavedChangesConfirmation } from "@/components/unsaved-changes-link";
import { businessRpc } from "@/shared/business-rpc";
import { formatChurchTimestamp } from "@/shared/time/church-time";

import {
  decisionFormSchema,
  decisionReconciliationResponseSchema,
  decisionWriteResponseSchema,
  storedDecisionOperationSchema,
} from "./decision-contract";
import type {
  DecisionFormValues,
  DecisionOutcome,
  DecisionReconciliationInput,
  DecisionSubmission,
  DecisionWriteInput,
  StoredDecisionOperation,
} from "./decision-contract";
import type { PendingApplication } from "./decisions";
import {
  AccountOperationDetails,
  AccountOperationOutcome,
  AccountOperationSummary,
  AccountTargetCard,
} from "./operation-presentation";
import { readTransientReconciliation } from "./reconciliation-query";
import { StaffManagementTabs } from "./staff-management-workspace";

const storageKey = "efcc.application-decision.operation.v1";
const decisionReconciliationQueryKey = [
  "staff-application-decision-reconciliation",
] as const;
type Operation = StoredDecisionOperation;

type Flow =
  | "restoring"
  | "ready"
  | "submitting"
  | "checking"
  | "unknown"
  | "retry"
  | "confirmed"
  | "conflict"
  | "storage-error";

const busyFlows = { checking: true, restoring: true, submitting: true };
const unresolvedFlows = { retry: true, "storage-error": true, unknown: true };

type DecisionRoutes =
  (typeof businessRpc)["api"]["v2"]["staff"]["application-decisions"];
type DecisionWriteResponse = InferResponseType<
  DecisionRoutes["$post"],
  200 | 201
>;
type DecisionReconciliationResponse = InferResponseType<
  DecisionRoutes["reconcile"]["$post"],
  200
>;
/** The committed staff decision exactly as the typed route returns it. */
type StaffDecisionPayload = DecisionWriteResponse["data"]["decision"];

type DecisionWriteOutcome =
  | { kind: "confirmed"; decision: StaffDecisionPayload }
  | { kind: "invalid" }
  | { kind: "unresolved" };

/**
 * Sensitive write through the typed client: the expected actor travels with the
 * request, and no SDK retry or optimistic success is enabled around it.
 */
const submitDecisionRequest = async ({
  actorUserId,
  request,
}: {
  actorUserId: string;
  request: DecisionWriteInput;
}): Promise<DecisionWriteOutcome> => {
  const response = await businessRpc.api.v2.staff[
    "application-decisions"
  ].$post(
    { json: request },
    {
      headers: { "x-efcc-expected-actor-id": actorUserId },
      init: { cache: "no-store", credentials: "same-origin" },
    }
  );
  if (response.status === 400) {
    return { kind: "invalid" };
  }
  if (response.status !== 200 && response.status !== 201) {
    return { kind: "unresolved" };
  }
  const body: unknown = await response.json();
  const parsed = decisionWriteResponseSchema.safeParse(body);
  if (!parsed.success) {
    return { kind: "unresolved" };
  }
  const decision: DecisionWriteResponse["data"]["decision"] =
    parsed.data.data.decision;
  return { decision, kind: "confirmed" };
};

type DecisionReconciliationResult =
  | {
      kind: "loaded";
      status: 200;
      decision: StaffDecisionPayload | null;
      applicationStatus: PendingApplication["status"] | null | undefined;
    }
  | { kind: "unknown"; status: number };

/** Reconciliation stays a fresh server check; its result is never cached. */
const reconcileDecisionRequest = async ({
  actorUserId,
  request,
  signal,
}: {
  actorUserId: string;
  request: DecisionReconciliationInput;
  signal: AbortSignal;
}): Promise<DecisionReconciliationResult> => {
  const response = await businessRpc.api.v2.staff[
    "application-decisions"
  ].reconcile.$post(
    { json: request },
    {
      headers: { "x-efcc-expected-actor-id": actorUserId },
      init: { cache: "no-store", credentials: "same-origin", signal },
    }
  );
  if (response.status !== 200) {
    return { kind: "unknown", status: response.status };
  }
  const body: unknown = await response.json();
  const parsed = decisionReconciliationResponseSchema.safeParse(body);
  if (!parsed.success) {
    return { kind: "unknown", status: response.status };
  }
  const result: DecisionReconciliationResponse["data"] = parsed.data.data;
  if (
    result.decision !== null &&
    result.decision.applicationId !== request.applicationId
  ) {
    return { kind: "unknown", status: response.status };
  }
  return {
    applicationStatus: result.applicationStatus,
    decision: result.decision,
    kind: "loaded",
    status: 200,
  };
};

const readOperation = (): Operation | null => {
  const saved = localStorage.getItem(storageKey);
  if (!saved) {
    return null;
  }
  const value: unknown = JSON.parse(saved);
  const parsed = storedDecisionOperationSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("Invalid saved decision operation");
  }
  return parsed.data;
};

const reconciliationFailureCopy = (status: number): string => {
  if (status === 401 || status === 403) {
    return "目前未能確認管理權限；之前的決定結果仍未確認。請重新登入或聯絡管理員，再查核此操作。";
  }
  if (status === 429) {
    return "查核次數較多，請稍後再試；決定結果仍未確認。";
  }
  return "暫時未能查核決定。操作代碼會保留，請稍後再次查核。";
};

/**
 * What the server's reconciliation result means for this task. Terminal
 * application ids are never reopened; resubmission creates a new application.
 */
const reconciliationNotice = (
  result: DecisionReconciliationResult
): {
  flow: Flow;
  message: string;
  receipt: StaffDecisionPayload | null;
  refresh: boolean;
} => {
  if (result.kind === "unknown") {
    return {
      flow: "unknown",
      message: reconciliationFailureCopy(result.status),
      receipt: null,
      refresh: false,
    };
  }
  if (result.decision) {
    return {
      flow: "confirmed",
      message: "伺服器已確認這項決定；重試不會再產生另一項審批紀錄。",
      receipt: result.decision,
      refresh: true,
    };
  }
  if (
    result.applicationStatus === "approved" ||
    result.applicationStatus === "rejected" ||
    result.applicationStatus === "withdrawn"
  ) {
    return {
      flow: "conflict",
      message:
        "此申請已被其他決定處理或已撤回；這項操作沒有完成紀錄，不能當作已成功。請返回待批清單。",
      receipt: null,
      refresh: true,
    };
  }
  return {
    flow: "retry",
    message:
      "尚未找到此操作的完成紀錄，不能當作已成功。重試會保留原申請與決定；重新載入後，請填寫同一份原因及備註。",
    receipt: null,
    refresh: false,
  };
};

const UnresolvedOperationNotice = ({
  flow,
  hasOperation,
}: {
  flow: Flow;
  hasOperation: boolean;
}) =>
  hasOperation && flow !== "restoring" && flow !== "checking" ? (
    <p className="text-muted-foreground">
      原申請目前不在可審批清單內。保留操作代碼並再次查核，或聯絡管理員核對帳戶紀錄。
    </p>
  ) : null;

const ReviewChooser = ({
  applications,
  disabled,
  onSelect,
}: {
  applications: PendingApplication[];
  disabled: boolean;
  onSelect: (id: string) => void;
}) => {
  if (applications.length === 0) {
    return (
      <p className="text-muted-foreground">目前沒有你可審批的待批申請。</p>
    );
  }
  return (
    <ul className="border-border border-t">
      {applications.map((application) => (
        <li key={application.id}>
          <Button
            type="button"
            variant="quiet"
            className="border-border text-foreground w-full justify-start gap-4 rounded-none border-b px-0 py-4 text-left font-normal"
            disabled={disabled}
            aria-pressed={false}
            aria-label={`審批 ${application.fullName}（${application.username}）`}
            onClick={() => onSelect(application.id)}
          >
            <span className="bg-background text-muted-foreground flex size-[43px] shrink-0 items-center justify-center rounded-xl">
              <Icon name="user" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="text-body block font-semibold break-words">
                {application.fullName}
              </span>
              <span className="text-meta text-muted-foreground mt-1 block font-normal break-words">
                {application.username ?? "未設定 Username"}
              </span>
              <time
                className="text-meta text-muted-foreground mt-1 block font-normal"
                dateTime={new Date(application.createdAt * 1000).toISOString()}
              >
                {formatChurchTimestamp(new Date(application.createdAt * 1000))}
              </time>
            </span>
            <Icon className="size-[18px] shrink-0" name="chevron-right" />
          </Button>
        </li>
      ))}
    </ul>
  );
};

const ReviewEditor = ({
  busy,
  draft,
  fallbackOutcome,
  flow,
  retryingOriginal,
  selected,
  onDirty,
  onPrepareReview,
  step,
}: {
  selected: PendingApplication;
  /** The frozen reviewed values, or null when this operation has no draft yet. */
  draft: DecisionSubmission | null;
  fallbackOutcome: DecisionOutcome | undefined;
  busy: boolean;
  flow: Flow;
  retryingOriginal: boolean;
  onDirty: () => void;
  onPrepareReview: (values: DecisionFormValues) => void;
  step: "edit" | "review";
}) => {
  const form = useAppForm({
    defaultValues: {
      internalNote: draft?.internalNote ?? "",
      outcome: draft?.outcome ?? fallbackOutcome ?? "approved",
      visibleReason: draft?.visibleReason ?? "",
    },
    listeners: {
      onChange: () => {
        onDirty();
      },
    },
    onSubmit: ({ value }) => {
      onPrepareReview(value);
    },
    validators: { onSubmit: decisionFormSchema },
  });
  let submitLabel = "檢查並預覽決定";
  if (flow === "retry") {
    submitLabel = "檢查後重試同一決定";
  }
  if (busy) {
    submitLabel = "正在查核或提交…";
  }
  const notesDisabled = busy || flow === "unknown" || retryingOriginal;

  return (
    <section
      className="min-w-0"
      aria-labelledby="review-name"
      hidden={step !== "edit"}
    >
      <h2 className="sr-only" id="review-name" tabIndex={-1}>
        {selected.fullName}
      </h2>
      <span className="text-meta bg-warning-surface text-warning inline-flex rounded-full px-3 py-1 font-medium">
        待批核
      </span>
      <AccountOperationSummary
        rows={[
          { label: "電郵", value: selected.email },
          { label: "電話", value: selected.phone },
          ...[
            { label: "所屬組別", value: selected.groupNote },
            { label: "介紹人", value: selected.referralNote },
            { label: "申請意向", value: selected.intentNote },
          ]
            .filter((note) => note.value)
            .map((note) => ({
              label: note.label,
              value: <span className="whitespace-pre-wrap">{note.value}</span>,
            })),
        ]}
      />
      <form
        className="mt-6 flex flex-col gap-5"
        noValidate
        onSubmit={async (event) => {
          event.preventDefault();
          const element = event.currentTarget;
          await form.handleSubmit();
          requestAnimationFrame(() =>
            element.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
          );
        }}
      >
        <form.AppField name="outcome">
          {(field) => (
            <field.RadioCardField
              disabled={flow !== "ready"}
              id="decision-outcome"
              label="審批決定"
              presentation="segments"
              options={[
                { label: "批准申請", value: "approved" },
                { label: "拒絕申請", value: "rejected" },
              ]}
            />
          )}
        </form.AppField>
        <form.Subscribe selector={(state) => state.values.outcome}>
          {(outcome) =>
            outcome === "rejected" ? (
              <form.AppField name="visibleReason">
                {(field) => (
                  <field.TextareaField
                    description="最多 500 字；這段原因會顯示在申請人的收件匣。"
                    disabled={notesDisabled}
                    id="decision-visible-reason"
                    label="拒絕原因（申請人可見，必填）"
                    characterLimit={500}
                    maxLength={1000}
                    rows={5}
                    textClassName="text-base"
                  />
                )}
              </form.AppField>
            ) : (
              <AccountOperationOutcome
                message="提交後，申請人會收到批准紀錄；獨立的保安限制仍然適用。"
                title="批准這份會籍申請"
                tone="info"
              />
            )
          }
        </form.Subscribe>
        <form.AppField name="internalNote">
          {(field) => (
            <field.TextareaField
              description="最多 500 字，只供有權限的職員或管理員查閱。"
              disabled={notesDisabled}
              id="decision-internal-note"
              label="內部備註（選填，申請人不可見）"
              characterLimit={500}
              maxLength={1000}
              rows={5}
              textClassName="text-base"
            />
          )}
        </form.AppField>
        <form.AppForm>
          <form.SubmitButton
            disabled={busy || (flow !== "ready" && flow !== "retry")}
            label={submitLabel}
            pendingLabel="正在查核或提交…"
          />
        </form.AppForm>
      </form>
    </section>
  );
};

const DecisionConfirmation = ({
  selected,
  submission,
  busy,
  flow,
  canEdit,
  onEdit,
  onConfirm,
}: {
  selected: PendingApplication;
  /** The frozen reviewed values this confirmation submits verbatim. */
  submission: DecisionSubmission;
  busy: boolean;
  flow: Flow;
  canEdit: boolean;
  onEdit: () => void;
  onConfirm: () => void;
}) => {
  const { internalNote = "", outcome, visibleReason = "" } = submission;
  const rows = [
    { label: "申請人", value: selected.fullName },
    { label: "Username", value: selected.username ?? "沒有設定" },
    {
      label: "決定",
      value: outcome === "approved" ? "批准申請" : "拒絕申請",
    },
    ...(outcome === "rejected"
      ? [{ label: "申請人可見原因", value: visibleReason }]
      : []),
    {
      label: "職員內部備註（申請人不可見）",
      value: internalNote || "沒有內部備註",
    },
  ];

  return (
    <section aria-labelledby="decision-review-heading" className="min-w-0">
      <h2 className="sr-only" id="decision-review-heading">
        提交前檢查
      </h2>
      <p className="text-muted-foreground mt-2">
        核對申請人、決定及備註；此畫面尚未提交。
      </p>
      <AccountOperationSummary rows={rows} />
      <AccountOperationOutcome
        title="這次審批的影響"
        message={
          outcome === "approved"
            ? "提交後批准會籍；獨立的帳戶保安限制仍然適用。"
            : "提交後拒絕此份申請；原因會顯示在申請人的收件匣，內部備註只供有權職員查閱。"
        }
        tone={outcome === "approved" ? "neutral" : "warning"}
      />
      <div className="mt-6 flex flex-col-reverse gap-3">
        <Button
          className="w-full"
          disabled={!canEdit}
          onClick={onEdit}
          type="button"
          variant="secondary"
        >
          返回修改
        </Button>
        <Button
          className="w-full"
          disabled={busy || (flow !== "ready" && flow !== "retry")}
          onClick={onConfirm}
          type="button"
        >
          {flow === "retry"
            ? "重試同一決定"
            : `確認並提交${outcome === "approved" ? "批准" : "拒絕"}`}
        </Button>
      </div>
      <AccountOperationDetails
        title="申請資料"
        rows={[
          { label: "電郵", value: selected.email },
          { label: "電話", value: selected.phone ?? "沒有提供" },
          { label: "所屬組別", value: selected.groupNote ?? "沒有提供" },
          { label: "介紹人", value: selected.referralNote ?? "沒有提供" },
          { label: "申請意向", value: selected.intentNote ?? "沒有提供" },
          { label: "申請識別碼", value: selected.id },
        ]}
      />
    </section>
  );
};

const DecisionStatus = ({
  busy,
  flow,
  message,
  receipt,
  unresolved,
  onCheck,
  onFinish,
}: {
  busy: boolean;
  flow: Flow;
  message: string;
  receipt: StaffDecisionPayload | null;
  unresolved: boolean;
  onCheck: () => void;
  onFinish: () => void;
}) => (
  <>
    {message && !receipt ? (
      <p
        role={unresolved ? "alert" : "status"}
        aria-live="polite"
        className="min-w-0"
      >
        {message}
      </p>
    ) : null}
    {receipt ? (
      <div>
        <AccountOperationOutcome
          message="伺服器已確認這項決定；重試不會再產生另一項審批紀錄。"
          title={
            receipt.outcome === "approved" ? "已確認批准申請" : "已確認拒絕申請"
          }
          tone="success"
        />
        <AccountOperationSummary
          rows={[
            { label: "決定識別碼", value: receipt.id },
            ...(receipt.visibleReason
              ? [{ label: "申請人可見原因", value: receipt.visibleReason }]
              : []),
          ]}
        />
        <Button
          className="mt-5 w-full"
          type="button"
          disabled={busy || flow !== "confirmed"}
          onClick={onFinish}
        >
          返回待批清單
        </Button>
      </div>
    ) : null}
    {flow === "conflict" ? (
      <Button type="button" variant="secondary" onClick={onFinish}>
        返回待批清單
      </Button>
    ) : null}
    {unresolved ? (
      <Button
        type="button"
        variant="secondary"
        disabled={busy}
        onClick={onCheck}
      >
        再次查核決定
      </Button>
    ) : null}
  </>
);

const decisionTaskTitle = (
  receipt: StaffDecisionPayload | null,
  step: "edit" | "review",
  draft: DecisionSubmission | null
) => {
  if (receipt) {
    return "審批決定已完成";
  }
  if (step === "review" && draft) {
    return draft.outcome === "approved" ? "檢查批准決定" : "檢查拒絕決定";
  }
  return "審批會籍申請";
};

const decisionApplicantTarget = (
  selected: PendingApplication | undefined,
  step: "edit" | "review",
  flow: Flow
) => {
  if (!selected) {
    return null;
  }
  if (step === "edit" && flow !== "confirmed" && flow !== "conflict") {
    return (
      <p className="text-label text-muted-foreground min-w-0 break-words">
        {selected.fullName} · {selected.username ?? selected.userId}
      </p>
    );
  }
  return (
    <AccountTargetCard
      identifier={selected.username ?? selected.userId}
      name={selected.fullName}
    />
  );
};

export const DecisionReview = ({
  applications,
  actorUserId,
  navigation,
}: {
  applications: PendingApplication[];
  actorUserId: string;
  navigation: ReactNode;
}) => {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DecisionSubmission | null>(null);
  const [draftDirty, setDraftDirty] = useState(false);
  const [step, setStep] = useState<"edit" | "review">("edit");
  const [returnConfirmationOpen, setReturnConfirmationOpen] = useState(false);
  const [flow, setFlow] = useState<Flow>("restoring");
  const [message, setMessage] = useState(
    "正在檢查此瀏覽器有沒有尚待確認的操作。"
  );
  const [receipt, setReceipt] = useState<StaffDecisionPayload | null>(null);
  const operationRef = useRef<Operation | null>(null);
  const bodyRef = useRef<DecisionWriteInput | null>(null);
  const busyRef = useRef(false);

  const submissionMutation = useMutation({
    gcTime: 0,
    mutationFn: submitDecisionRequest,
    networkMode: "always",
    retry: false,
  });
  const queryClient = useQueryClient();

  const updateDraftDirty = useCallback((dirty: boolean) => {
    setDraftDirty(dirty);
  }, []);
  const selected = applications.find(
    (application) => application.id === selectedId
  );
  const busy = Object.hasOwn(busyFlows, flow);
  const unresolved = Object.hasOwn(unresolvedFlows, flow);

  const reconcile = useCallback(
    async (operation: Operation) => {
      if (operationRef.current?.key !== operation.key) {
        bodyRef.current = null;
        setDraft(null);
        setStep("edit");
        updateDraftDirty(false);
      }
      setReceipt(null);
      if (operation.actorUserId !== actorUserId) {
        operationRef.current = operation;
        setSelectedId(null);
        setFlow("unknown");
        setMessage(
          "此瀏覽器保留了另一帳戶尚未確認的操作。請先以原職員帳戶登入查核；操作代碼不會被覆蓋或清除。"
        );
        return;
      }
      operationRef.current = operation;
      setSelectedId(operation.applicationId);
      setFlow("checking");
      setMessage("正在向伺服器查核決定，未有確定結果前請勿改換申請。");
      let result: DecisionReconciliationResult;
      try {
        result = await readTransientReconciliation(
          queryClient,
          decisionReconciliationQueryKey,
          ({ signal }) =>
            reconcileDecisionRequest({
              actorUserId,
              request: {
                applicationId: operation.applicationId,
                operationKey: operation.key,
              },
              signal,
            })
        );
      } catch {
        setFlow("unknown");
        setMessage(
          "查核時連線失敗，結果仍未確認。請再次查核，切勿當作已成功。"
        );
        return;
      }
      const notice = reconciliationNotice(result);
      setReceipt(notice.receipt);
      setFlow(notice.flow);
      setMessage(notice.message);
      if (notice.refresh) {
        router.refresh();
      }
    },
    [actorUserId, queryClient, router, updateDraftDirty]
  );

  useEffect(() => {
    if (!draftDirty) {
      return;
    }
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [draftDirty]);

  useEffect(() => {
    try {
      const operation = readOperation();
      if (operation) {
        void reconcile(operation);
      } else {
        setFlow("ready");
        setMessage("");
      }
    } catch {
      setFlow("storage-error");
      setMessage(
        "無法讀取此瀏覽器的操作代碼。請恢復本機儲存後再次查核，未核實前不要開始另一項決定。"
      );
    }
  }, [reconcile]);

  const check = async () => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    try {
      const operation = operationRef.current ?? readOperation();
      if (operation) {
        await reconcile(operation);
      } else {
        setFlow("ready");
        setMessage("");
      }
    } catch {
      setFlow("storage-error");
      setMessage("仍未能讀取操作代碼。請檢查瀏覽器儲存設定後重試。");
    } finally {
      busyRef.current = false;
    }
  };

  const prepareReview = (values: DecisionFormValues) => {
    if (
      busyRef.current ||
      !selected ||
      (flow !== "ready" && flow !== "retry")
    ) {
      return;
    }
    const parsed = decisionFormSchema.safeParse(values);
    if (!parsed.success) {
      setMessage("原因及備註最多 500 字；拒絕決定必須填寫申請人可見原因。");
      return;
    }
    setMessage("");
    setDraft(parsed.data);
    setStep("review");
    updateDraftDirty(true);
  };

  const submit = async (frozen: DecisionSubmission) => {
    if (
      busyRef.current ||
      !selected ||
      step !== "review" ||
      (flow !== "ready" && flow !== "retry")
    ) {
      return;
    }
    busyRef.current = true;
    try {
      // ponytail: native per-browser lock keeps tabs from overwriting an unresolved operation.
      await navigator.locks.request(storageKey, async () => {
        const saved = readOperation();
        if (saved && saved.key !== operationRef.current?.key) {
          await reconcile(saved);
          return;
        }
        const fresh = operationRef.current === null;
        const operation = operationRef.current ?? {
          actorUserId,
          applicationId: selected.id,
          key: crypto.randomUUID(),
          outcome: frozen.outcome,
        };
        if (
          operation.applicationId !== selected.id ||
          operation.outcome !== frozen.outcome
        ) {
          await reconcile(operation);
          return;
        }
        localStorage.setItem(storageKey, JSON.stringify(operation));
        if (readOperation()?.key !== operation.key) {
          throw new Error("Operation was not persisted");
        }
        operationRef.current = operation;
        updateDraftDirty(false);
        const body = bodyRef.current ?? {
          applicationId: operation.applicationId,
          internalNote: frozen.internalNote,
          operationKey: operation.key,
          outcome: operation.outcome,
          visibleReason: frozen.visibleReason,
        };
        bodyRef.current = body;
        setFlow("submitting");
        setMessage("正在提交決定，請勿重複按下提交。");
        let outcome: DecisionWriteOutcome;
        try {
          outcome = await submissionMutation.mutateAsync({
            actorUserId,
            request: body,
          });
        } catch {
          outcome = { kind: "unresolved" };
        } finally {
          submissionMutation.reset();
        }
        if (
          outcome.kind === "confirmed" &&
          outcome.decision.applicationId === operation.applicationId
        ) {
          setReceipt(outcome.decision);
          setFlow("confirmed");
          setMessage("決定已由伺服器確認，申請人可在收件匣查看。");
          router.refresh();
          return;
        }
        if (fresh && outcome.kind === "invalid") {
          if (readOperation()?.key === operation.key) {
            localStorage.removeItem(storageKey);
          }
          operationRef.current = null;
          bodyRef.current = null;
          setFlow("ready");
          setStep("edit");
          updateDraftDirty(true);
          setMessage("決定資料未獲接受，未有提交。請檢查原因及備註格式。");
          return;
        }
        await reconcile(operation);
      });
    } catch {
      if (operationRef.current) {
        updateDraftDirty(false);
        setFlow("unknown");
        setMessage(
          "未能確認操作代碼或連線狀態；之前的結果仍未確認，請再次查核。"
        );
      } else {
        updateDraftDirty(true);
        setFlow("storage-error");
        setMessage(
          "瀏覽器未能安全儲存操作代碼，未有提交。請允許本機儲存並使用支援安全鎖定的瀏覽器後重試。"
        );
      }
    } finally {
      busyRef.current = false;
    }
  };

  const finish = async () => {
    if ((flow !== "confirmed" && flow !== "conflict") || busyRef.current) {
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
        if (saved) {
          localStorage.removeItem(storageKey);
        }
        operationRef.current = null;
        bodyRef.current = null;
        setReceipt(null);
        setSelectedId(null);
        setDraft(null);
        setStep("edit");
        updateDraftDirty(false);
        setFlow("ready");
        setMessage("");
        router.refresh();
      });
    } catch {
      setMessage("未能清除本機操作代碼。請檢查儲存設定後重試。");
    } finally {
      busyRef.current = false;
    }
  };

  const returnToList = () => {
    if (busyRef.current || flow !== "ready" || operationRef.current !== null) {
      return;
    }
    setReturnConfirmationOpen(false);
    setSelectedId(null);
    setDraft(null);
    setStep("edit");
    updateDraftDirty(false);
    setMessage("");
  };

  const focused = selectedId !== null || receipt !== null;
  const content = (
    <main
      className={
        focused ? "flex flex-col gap-5" : "flex min-h-0 flex-1 flex-col gap-5"
      }
    >
      {focused ? (
        <TaskHeader
          returnControl={
            <Button
              aria-label="返回待批清單"
              className="text-muted-foreground size-11 shrink-0"
              disabled={flow !== "ready" || operationRef.current !== null}
              onClick={() => {
                if (draftDirty) {
                  setReturnConfirmationOpen(true);
                } else {
                  returnToList();
                }
              }}
              type="button"
              variant="quiet"
            >
              <Icon className="size-5" name="arrow-left" />
            </Button>
          }
          title={decisionTaskTitle(receipt, step, draft)}
        />
      ) : (
        <>
          <TaskHeader
            returnControl={
              <a
                href="/staff/accounts"
                className="flex min-h-11 min-w-11 items-center justify-center rounded-lg focus-visible:outline-2"
              >
                <Icon className="size-5" name="arrow-left" />
                <span className="sr-only">返回管理</span>
              </a>
            }
            title="會籍申請審批"
          />
          <StaffManagementTabs current="applications" />
          <p className="text-label text-muted-foreground">
            檢查申請資料，再作出會籍決定。
          </p>
          <div className="mt-6 mb-4 flex items-center justify-between gap-3">
            <h2 className="text-section">待批核</h2>
            <span className="text-meta text-muted-foreground">
              {applications.length} 份申請
            </span>
          </div>
        </>
      )}
      {decisionApplicantTarget(selected, step, flow)}
      <DecisionStatus
        busy={busy}
        flow={flow}
        message={message}
        receipt={receipt}
        unresolved={unresolved}
        onCheck={check}
        onFinish={finish}
      />
      {flow !== "confirmed" && flow !== "conflict" ? (
        <>
          {selectedId ? null : (
            <div className="min-h-0 overflow-y-auto">
              <ReviewChooser
                applications={applications}
                disabled={flow !== "ready"}
                onSelect={(id) => {
                  setSelectedId(id);
                  setDraft(null);
                  setStep("edit");
                  updateDraftDirty(false);
                  setMessage("");
                  requestAnimationFrame(() =>
                    document.querySelector<HTMLElement>("#review-name")?.focus()
                  );
                }}
              />
            </div>
          )}
          {selected ? (
            <ReviewEditor
              key={selectedId}
              busy={busy}
              draft={draft}
              fallbackOutcome={operationRef.current?.outcome}
              flow={flow}
              retryingOriginal={flow === "retry" && bodyRef.current !== null}
              selected={selected}
              step={step}
              onDirty={() => updateDraftDirty(true)}
              onPrepareReview={prepareReview}
            />
          ) : null}
          {selected && step === "review" && draft ? (
            <DecisionConfirmation
              selected={selected}
              submission={draft}
              busy={busy}
              flow={flow}
              canEdit={
                flow === "ready" ||
                (flow === "retry" && bodyRef.current === null)
              }
              onEdit={() => setStep("edit")}
              onConfirm={() => {
                void submit(draft);
              }}
            />
          ) : null}
          {selected ? null : (
            <UnresolvedOperationNotice
              flow={flow}
              hasOperation={operationRef.current !== null}
            />
          )}
        </>
      ) : null}
      {focused ? null : (
        <p className="text-meta text-muted-foreground mt-6">
          只列出目前仍待批，而且你有權處理的申請。例行審批無需再次確認密碼。
        </p>
      )}
      <UnsavedChangesConfirmation
        description="放棄會清除未提交的審批原因及備註；已提交操作的查核記錄會保留。"
        onDiscard={returnToList}
        onOpenChange={setReturnConfirmationOpen}
        open={returnConfirmationOpen}
      />
    </main>
  );
  return focused ? (
    <PageFrame navigation={navigation} variant="task">
      {content}
    </PageFrame>
  ) : (
    <RootFrame navigation={navigation}>{content}</RootFrame>
  );
};
