"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

import type { ApplicantDecision, PendingApplication } from "./decisions";
import { postAccountOperation } from "./post-operation";

const storageKey = "efcc.application-decision.operation.v1";
const uuidPattern =
  /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/iu;
type Outcome = "approved" | "rejected";
interface Operation {
  key: string;
  applicationId: string;
  outcome: Outcome;
  actorUserId: string;
}
interface DecisionBody {
  applicationId: string;
  operationKey: string;
  outcome: Outcome;
  visibleReason?: string;
  internalNote?: string;
}
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
    !("applicationId" in value) ||
    !("outcome" in value) ||
    !("actorUserId" in value) ||
    typeof value.actorUserId !== "string" ||
    value.actorUserId.length === 0 ||
    value.actorUserId.length > 128 ||
    typeof value.key !== "string" ||
    !uuidPattern.test(value.key) ||
    typeof value.applicationId !== "string" ||
    !uuidPattern.test(value.applicationId) ||
    (value.outcome !== "approved" && value.outcome !== "rejected")
  ) {
    throw new Error("Invalid saved decision operation");
  }
  return {
    actorUserId: value.actorUserId,
    applicationId: value.applicationId,
    key: value.key,
    outcome: value.outcome,
  };
};

const decisionData = (body: unknown) => {
  if (
    typeof body !== "object" ||
    body === null ||
    !("data" in body) ||
    typeof body.data !== "object" ||
    body.data === null ||
    !("decision" in body.data)
  ) {
    return null;
  }
  return body.data;
};

const isApplicantDecision = (value: unknown): value is ApplicantDecision => {
  if (
    value === null ||
    typeof value !== "object" ||
    !("id" in value) ||
    !("applicationId" in value) ||
    !("outcome" in value) ||
    !("visibleReason" in value) ||
    !("createdAt" in value) ||
    typeof value.id !== "string" ||
    !uuidPattern.test(value.id) ||
    typeof value.applicationId !== "string" ||
    !uuidPattern.test(value.applicationId) ||
    (value.outcome !== "approved" && value.outcome !== "rejected") ||
    (value.visibleReason !== null && typeof value.visibleReason !== "string") ||
    typeof value.createdAt !== "number" ||
    !Number.isFinite(value.createdAt)
  ) {
    return false;
  }
  return true;
};

const readDecision = (body: unknown): ApplicantDecision | null | undefined => {
  const data = decisionData(body);
  if (!data) {
    return undefined;
  }
  const value = data.decision;
  if (value === null) {
    return null;
  }
  if (!isApplicantDecision(value)) {
    return undefined;
  }
  return {
    applicationId: value.applicationId,
    createdAt: value.createdAt,
    id: value.id,
    outcome: value.outcome,
    visibleReason: value.visibleReason,
  };
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
    <ul className="flex flex-col gap-3">
      {applications.map((application) => (
        <li key={application.id}>
          <Button
            type="button"
            variant="secondary"
            className="w-full justify-start text-left"
            disabled={disabled}
            aria-pressed={false}
            onClick={() => onSelect(application.id)}
          >
            審批 {application.fullName}（{application.username}）
          </Button>
        </li>
      ))}
    </ul>
  );
};

const ReviewEditor = ({
  selected,
  busy,
  flow,
  outcome,
  visibleReason,
  internalNote,
  retryingOriginal,
  onCancel,
  onOutcomeChange,
  onReasonChange,
  onNoteChange,
  onSubmit,
}: {
  selected: PendingApplication;
  busy: boolean;
  flow: Flow;
  outcome: Outcome;
  visibleReason: string;
  internalNote: string;
  retryingOriginal: boolean;
  onCancel: () => void;
  onOutcomeChange: (value: Outcome) => void;
  onReasonChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  onSubmit: (event: React.SubmitEvent<HTMLFormElement>) => Promise<void>;
}) => {
  let submitLabel = outcome === "approved" ? "提交批准決定" : "提交拒絕決定";
  if (flow === "retry") {
    submitLabel = "重試同一決定";
  }
  if (busy) {
    submitLabel = "正在查核或提交…";
  }
  const notesDisabled = busy || flow === "unknown" || retryingOriginal;
  return (
    <section
      className="border-border bg-surface rounded-lg border p-5"
      aria-labelledby="review-name"
    >
      <Button
        type="button"
        variant="secondary"
        className="mb-5"
        disabled={flow !== "ready"}
        onClick={onCancel}
      >
        返回待批清單（未提交）
      </Button>
      <h2 className="text-xl font-semibold" id="review-name" tabIndex={-1}>
        {selected.fullName}
      </h2>
      <dl className="mt-4 grid gap-3">
        <div>
          <dt className="text-muted-foreground">使用者名稱</dt>
          <dd className="break-words">{selected.username}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">電郵</dt>
          <dd className="break-words">{selected.email}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">電話</dt>
          <dd>{selected.phone}</dd>
        </div>
        {[
          { label: "所屬組別", value: selected.groupNote },
          { label: "介紹人", value: selected.referralNote },
          { label: "申請意向", value: selected.intentNote },
        ].map((note) =>
          note.value ? (
            <div key={note.label}>
              <dt className="text-muted-foreground">{note.label}</dt>
              <dd className="break-words whitespace-pre-wrap">{note.value}</dd>
            </div>
          ) : null
        )}
      </dl>
      <form className="mt-6 flex flex-col gap-5" onSubmit={onSubmit}>
        <fieldset className="flex flex-col gap-2" disabled={flow !== "ready"}>
          <legend className="font-medium">審批決定</legend>
          <label className="flex min-h-11 items-center gap-3">
            <input
              type="radio"
              name="decision-outcome"
              value="approved"
              checked={outcome === "approved"}
              onChange={() => onOutcomeChange("approved")}
              className="h-5 w-5"
            />
            批准申請
          </label>
          <label className="flex min-h-11 items-center gap-3">
            <input
              type="radio"
              name="decision-outcome"
              value="rejected"
              checked={outcome === "rejected"}
              onChange={() => onOutcomeChange("rejected")}
              className="h-5 w-5"
            />
            拒絕申請
          </label>
        </fieldset>
        {outcome === "rejected" ? (
          <div className="flex flex-col gap-2">
            <label className="font-medium" htmlFor="decision-visible-reason">
              拒絕原因（申請人可見，必填）
            </label>
            <textarea
              id="decision-visible-reason"
              name="visibleReason"
              value={visibleReason}
              required
              maxLength={1000}
              disabled={notesDisabled}
              onChange={(event) => onReasonChange(event.target.value)}
              aria-describedby="decision-reason-help"
              className="border-input-border min-h-28 w-full rounded-md border bg-white px-3 py-3 text-base"
            />
            <p id="decision-reason-help" className="text-muted-foreground">
              最多 500 字；這段原因會顯示在申請人的收件匣。
            </p>
          </div>
        ) : null}
        <div className="flex flex-col gap-2">
          <label className="font-medium" htmlFor="decision-internal-note">
            內部備註（選填，申請人不可見）
          </label>
          <textarea
            id="decision-internal-note"
            name="internalNote"
            value={internalNote}
            maxLength={1000}
            disabled={notesDisabled}
            onChange={(event) => onNoteChange(event.target.value)}
            aria-describedby="decision-note-help"
            className="border-input-border min-h-28 w-full rounded-md border bg-white px-3 py-3 text-base"
          />
          <p id="decision-note-help" className="text-muted-foreground">
            最多 500 字，只供有權限的職員或管理員查閱。
          </p>
        </div>
        <Button
          type="submit"
          disabled={busy || (flow !== "ready" && flow !== "retry")}
        >
          {submitLabel}
        </Button>
      </form>
    </section>
  );
};

export const DecisionReview = ({
  applications,
  actorUserId,
}: {
  applications: PendingApplication[];
  actorUserId: string;
}) => {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome>("approved");
  const [visibleReason, setVisibleReason] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [flow, setFlow] = useState<Flow>("restoring");
  const [message, setMessage] = useState(
    "正在檢查此瀏覽器有沒有尚待確認的操作。"
  );
  const [receipt, setReceipt] = useState<ApplicantDecision | null>(null);
  const operationRef = useRef<Operation | null>(null);
  const bodyRef = useRef<DecisionBody | null>(null);
  const busyRef = useRef(false);
  const selected = applications.find(
    (application) => application.id === selectedId
  );
  const busy = Object.hasOwn(busyFlows, flow);
  const unresolved = Object.hasOwn(unresolvedFlows, flow);

  const reconcile = useCallback(
    async (operation: Operation) => {
      if (operationRef.current?.key !== operation.key) {
        bodyRef.current = null;
        setVisibleReason("");
        setInternalNote("");
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
      setOutcome(operation.outcome);
      setFlow("checking");
      setMessage("正在向伺服器查核決定，未有確定結果前請勿改換申請。");
      try {
        const response = await postAccountOperation(
          actorUserId,
          "/api/v2/staff/application-decisions/reconcile",
          {
            applicationId: operation.applicationId,
            operationKey: operation.key,
          }
        );
        const body: unknown = await response.json();
        const decision = readDecision(body);
        if (
          !response.ok ||
          decision === undefined ||
          (decision !== null &&
            decision.applicationId !== operation.applicationId)
        ) {
          setFlow("unknown");
          setMessage(reconciliationFailureCopy(response.status));
          return;
        }
        const data = decisionData(body);
        const applicationStatus =
          data && "applicationStatus" in data
            ? data.applicationStatus
            : undefined;
        if (decision) {
          setReceipt(decision);
          setFlow("confirmed");
          setMessage("伺服器已確認這項決定；重試不會再產生另一項審批紀錄。");
          router.refresh();
        } else if (
          applicationStatus === "approved" ||
          applicationStatus === "rejected" ||
          applicationStatus === "withdrawn"
        ) {
          // Terminal application ids are never reopened; resubmission creates a new application.
          setFlow("conflict");
          setMessage(
            "此申請已被其他決定處理或已撤回；這項操作沒有完成紀錄，不能當作已成功。請返回待批清單。"
          );
          router.refresh();
        } else {
          setFlow("retry");
          setMessage(
            "尚未找到此操作的完成紀錄，不能當作已成功。重試會保留原申請與決定；重新載入後，請填寫同一份原因及備註。"
          );
        }
      } catch {
        setFlow("unknown");
        setMessage(
          "查核時連線失敗，結果仍未確認。請再次查核，切勿當作已成功。"
        );
      }
    },
    [actorUserId, router]
  );

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

  const submit = async (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      busyRef.current ||
      !selected ||
      (flow !== "ready" && flow !== "retry")
    ) {
      return;
    }
    if (
      (outcome === "rejected" && !visibleReason.trim()) ||
      [...visibleReason.trim()].length > 500 ||
      [...internalNote.trim()].length > 500
    ) {
      setMessage(
        "拒絕申請必須填寫申請人可見的原因；每份原因或備註最多 500 字。"
      );
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
          outcome,
        };
        if (
          operation.applicationId !== selected.id ||
          operation.outcome !== outcome
        ) {
          await reconcile(operation);
          return;
        }
        localStorage.setItem(storageKey, JSON.stringify(operation));
        if (readOperation()?.key !== operation.key) {
          throw new Error("Operation was not persisted");
        }
        operationRef.current = operation;
        const body = bodyRef.current ?? {
          applicationId: operation.applicationId,
          internalNote: internalNote || undefined,
          operationKey: operation.key,
          outcome: operation.outcome,
          visibleReason: outcome === "rejected" ? visibleReason : undefined,
        };
        bodyRef.current = body;
        setFlow("submitting");
        setMessage("正在提交決定，請勿重複按下提交。");
        try {
          const response = await postAccountOperation(
            actorUserId,
            "/api/v2/staff/application-decisions",
            body
          );
          const result: unknown = await response.json();
          const decision = readDecision(result);
          if (
            response.ok &&
            decision &&
            decision.applicationId === operation.applicationId
          ) {
            setReceipt(decision);
            setFlow("confirmed");
            setMessage("決定已由伺服器確認，申請人可在收件匣查看。");
            router.refresh();
            return;
          }
          if (fresh && response.status === 400) {
            if (readOperation()?.key === operation.key) {
              localStorage.removeItem(storageKey);
            }
            operationRef.current = null;
            bodyRef.current = null;
            setFlow("ready");
            setMessage("決定資料未獲接受，未有提交。請檢查原因及備註格式。");
            return;
          }
          await reconcile(operation);
        } catch {
          await reconcile(operation);
        }
      });
    } catch {
      if (operationRef.current) {
        setFlow("unknown");
        setMessage(
          "未能確認操作代碼或連線狀態；之前的結果仍未確認，請再次查核。"
        );
      } else {
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
        setVisibleReason("");
        setInternalNote("");
        setOutcome("approved");
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

  return (
    <div className="mt-6 flex flex-col gap-5">
      {message ? (
        <p
          role={unresolved ? "alert" : "status"}
          aria-live="polite"
          className="border-border bg-surface rounded-lg border p-4"
        >
          {message}
        </p>
      ) : null}
      {receipt ? (
        <section
          aria-labelledby="decision-result"
          className="border-border bg-surface rounded-lg border p-5"
        >
          <h2 id="decision-result" className="text-xl font-semibold">
            {receipt.outcome === "approved"
              ? "已確認批准申請"
              : "已確認拒絕申請"}
          </h2>
          {receipt.visibleReason ? (
            <p className="mt-3 break-words whitespace-pre-wrap">
              {receipt.visibleReason}
            </p>
          ) : null}
          <p className="text-muted-foreground mt-3 break-words">
            決定識別碼：{receipt.id}
          </p>
          <Button
            className="mt-5 w-full"
            type="button"
            disabled={busy || flow !== "confirmed"}
            onClick={finish}
          >
            返回待批清單
          </Button>
        </section>
      ) : null}
      {flow === "conflict" ? (
        <Button type="button" variant="secondary" onClick={finish}>
          返回待批清單
        </Button>
      ) : null}
      {unresolved ? (
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={check}
        >
          再次查核決定
        </Button>
      ) : null}
      {flow !== "confirmed" && flow !== "conflict" ? (
        <>
          {selectedId ? null : (
            <ReviewChooser
              applications={applications}
              disabled={flow !== "ready"}
              onSelect={(id) => {
                setSelectedId(id);
                setVisibleReason("");
                setInternalNote("");
                setMessage("");
                requestAnimationFrame(() =>
                  document.querySelector<HTMLElement>("#review-name")?.focus()
                );
              }}
            />
          )}
          {selected ? (
            <ReviewEditor
              selected={selected}
              busy={busy}
              flow={flow}
              outcome={outcome}
              visibleReason={visibleReason}
              internalNote={internalNote}
              retryingOriginal={flow === "retry" && bodyRef.current !== null}
              onCancel={() => setSelectedId(null)}
              onOutcomeChange={setOutcome}
              onReasonChange={setVisibleReason}
              onNoteChange={setInternalNote}
              onSubmit={submit}
            />
          ) : null}
          {!selected &&
          operationRef.current &&
          flow !== "restoring" &&
          flow !== "checking" ? (
            <p className="text-muted-foreground">
              原申請目前不在可審批清單內。保留操作代碼並再次查核，或聯絡管理員核對帳戶紀錄。
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
};
