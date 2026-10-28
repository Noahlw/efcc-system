"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import * as z from "zod";

import { useAppForm } from "@/components/ui/app-form";
import { Button } from "@/components/ui/button";
import { FieldControl, FieldLabel, FieldRoot } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { UnsavedChangesLink } from "@/components/unsaved-changes-link";
import { AccountSecurityForm } from "@/features/account/security/security-form";
import { readAuthContextMarker } from "@/features/auth/auth-context-marker";

import type {
  ProgramLeaderCandidate,
  ProgramLeaderCandidatePage,
  ProgramLeaderRoster,
} from "../program-leader-contract";
import {
  PROGRAM_LEADER_GRANT_BATCH_LIMIT,
  programLeaderGrantBatchSchema,
} from "../program-leader-grant-batch-contract";
import type {
  ProgramLeaderGrantBatchInput,
  ProgramLeaderGrantBatchReceipt,
} from "../program-leader-grant-batch-contract";
import { ProgramLeaderApiError } from "./program-leader-api";
import {
  readGrantBatchCandidates,
  readGrantBatchScope,
  reconcileProgramLeaderGrantBatch,
  saveProgramLeaderGrantBatch,
  validateGrantBatchSelection,
} from "./program-leader-grant-batch-api";
import {
  readRoleOperationReference,
  removeRoleOperationReference,
  storeRoleOperationReference,
  useRoleCommandLifetime,
} from "./role-command-lifetime";
import type { RoleOperationReference } from "./role-command-lifetime";
import { RoleTaskFrame } from "./role-task-frame";

type Phase =
  | "loading"
  | "ready"
  | "pending"
  | "unknown"
  | "conflict"
  | "storage"
  | "denied";
interface GrantSubmissionMeta {
  submit: ((selection: ProgramLeaderCandidate[]) => Promise<void>) | null;
}

const defaultSubmissionMeta: GrantSubmissionMeta = { submit: null };

const family = "program-leader-grant-batch";
const searchQuery = z
  .string()
  .trim()
  .min(1, "請輸入姓名或用戶名稱。")
  .refine((query) => [...query].length <= 100, "請輸入不多於 100 個字。");
const aborted = (error: unknown) =>
  error instanceof DOMException && error.name === "AbortError";
const statusIs = (error: unknown, ...statuses: number[]) =>
  error instanceof ProgramLeaderApiError && statuses.includes(error.status);
const knownNoWrite = (error: unknown): error is ProgramLeaderApiError =>
  error instanceof ProgramLeaderApiError &&
  (error.status === 400 || error.code === "password_confirmation_required");

const matchesReceipt = (
  input: ProgramLeaderGrantBatchInput,
  receipt: ProgramLeaderGrantBatchReceipt
) =>
  input.scopeId === receipt.scopeId &&
  input.targetUserIds.length === receipt.targetUserIds.length &&
  input.targetUserIds.every((id, index) => id === receipt.targetUserIds[index]);

const CandidateRows = ({
  rows,
  selected,
  editable,
  toggle,
}: {
  rows: ProgramLeaderCandidate[];
  selected: ProgramLeaderCandidate[];
  editable: boolean;
  toggle: (person: ProgramLeaderCandidate) => void;
}) => (
  <ul aria-label="候選會友" className="border-border mt-5 divide-y border-y">
    {rows.map((person) => {
      const pressed = selected.some((entry) => entry.userId === person.userId);
      return (
        <li
          key={person.userId}
          className="flex min-h-14 min-w-0 items-center justify-between gap-3 py-3"
        >
          <div className="min-w-0">
            <p className="font-semibold wrap-anywhere">{person.fullName}</p>
            <p className="text-muted-foreground mt-1 break-all">
              {person.username ?? "未有 Username"}
            </p>
          </div>
          <Button
            aria-label={`選取${person.fullName} · ${person.username ?? "未有 Username"}`}
            aria-pressed={pressed}
            className="size-11 shrink-0"
            disabled={
              !editable ||
              (!pressed && selected.length >= PROGRAM_LEADER_GRANT_BATCH_LIMIT)
            }
            onClick={() => toggle(person)}
            title={`${pressed ? "取消選取" : "選取"}${person.fullName} · ${person.username ?? "未有 Username"}`}
            type="button"
            variant="quiet"
          >
            <span
              className={`inline-flex transition-transform duration-150 ease-out motion-reduce:transition-none ${pressed ? "rotate-180" : "rotate-0"}`}
            >
              <Icon className="size-5" name={pressed ? "minus" : "plus"} />
            </span>
          </Button>
        </li>
      );
    })}
  </ul>
);

const PickerActions = ({
  count,
  phase,
  editable,
  prepared,
  formId,
  reset,
  reconcile,
  retryStorage,
}: {
  count: number;
  phase: Phase;
  editable: boolean;
  prepared: boolean;
  formId: string;
  reset: () => void;
  reconcile: () => void;
  retryStorage: () => void;
}) => {
  if (phase === "unknown" || phase === "pending") {
    return (
      <Button
        disabled={phase === "pending"}
        onClick={reconcile}
        type="button"
        variant="primary"
      >
        {phase === "pending" ? "正在處理…" : "查核原有操作"}
      </Button>
    );
  }
  if (phase === "storage" && prepared) {
    return (
      <Button onClick={retryStorage} type="button" variant="primary">
        重試保留並儲存
      </Button>
    );
  }
  if (phase !== "ready" || count === 0) {
    return null;
  }
  return (
    <>
      <p className="text-muted-foreground mr-auto" role="status">
        已選 {count} 位會友
      </p>
      <Button
        disabled={!editable}
        onClick={reset}
        type="button"
        variant="secondary"
      >
        重設
      </Button>
      <Button
        disabled={!editable}
        form={formId}
        type="submit"
        variant="primary"
      >
        儲存變更
      </Button>
    </>
  );
};

const queryHref = (href: string, query: string) => {
  const url = new URL(href, "https://return.invalid");
  if (query) {
    url.searchParams.set("q", query);
  } else {
    url.searchParams.delete("q");
  }
  return `${url.pathname}${url.search}`;
};

interface CandidateViewPage {
  rows: ProgramLeaderCandidate[];
  page: number;
  hasNext: boolean;
}

const candidateViewPage = (
  selected: ProgramLeaderCandidate[],
  remote: ProgramLeaderCandidatePage | null,
  selectedOnly: boolean
): CandidateViewPage =>
  selectedOnly
    ? { hasNext: false, page: 1, rows: selected }
    : {
        hasNext: Boolean(remote?.hasNextPage),
        page: remote?.page ?? 1,
        rows: remote?.candidates ?? [],
      };

const hasPickerActions = (phase: Phase, count: number, prepared: boolean) =>
  phase === "unknown" ||
  phase === "pending" ||
  (phase === "storage" && prepared) ||
  (phase === "ready" && count > 0);

const CandidateSearch = ({
  editable,
  error,
  searchId,
  value,
  onChange,
  onBlur,
  onSearch,
}: {
  editable: boolean;
  error: string;
  searchId: string;
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  onSearch: () => void;
}) => (
  <>
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (editable) {
          onSearch();
        }
      }}
    >
      <div className="flex items-end gap-2">
        <FieldRoot className="min-w-0 flex-1" invalid={Boolean(error)}>
          <FieldLabel htmlFor={searchId}>搜尋會友</FieldLabel>
          <FieldControl
            aria-describedby={error ? `${searchId}-error` : undefined}
            aria-invalid={Boolean(error)}
            autoComplete="off"
            className="border-border bg-surface min-h-12 w-full rounded-lg border px-3 focus-visible:outline-2"
            disabled={!editable}
            id={searchId}
            onBlur={onBlur}
            onChange={(event) => onChange(event.currentTarget.value)}
            value={value}
          />
        </FieldRoot>
        <Button
          aria-label="搜尋會友"
          className="size-12 shrink-0"
          disabled={!editable}
          type="submit"
          variant="quiet"
        >
          <Icon className="size-5" name="search" />
        </Button>
      </div>
    </form>
    {error ? (
      <p className="text-danger mt-2" id={`${searchId}-error`} role="alert">
        {error}
      </p>
    ) : null}
  </>
);

const CandidateResults = ({
  editable,
  selection,
  selectedOnly,
  searched,
  view,
  reading,
  error,
  onSelectedOnly,
  onRetry,
  onPage,
  toggle,
}: {
  editable: boolean;
  selection: ProgramLeaderCandidate[];
  selectedOnly: boolean;
  searched: boolean;
  view: CandidateViewPage;
  reading: boolean;
  error: boolean;
  onSelectedOnly: () => void;
  onRetry: () => void;
  onPage: (page: number) => void;
  toggle: (person: ProgramLeaderCandidate) => void;
}) => (
  <>
    {selection.length > 0 ? (
      <Button
        aria-pressed={selectedOnly}
        className="mt-4"
        disabled={!editable}
        onClick={onSelectedOnly}
        type="button"
        variant="quiet"
      >
        已選 {selection.length} 位
      </Button>
    ) : null}
    {selection.length >= PROGRAM_LEADER_GRANT_BATCH_LIMIT ? (
      <p className="mt-3" role="status">
        已達一次指派上限，請先取消選擇才加入另一位。
      </p>
    ) : null}
    {reading ? (
      <p className="mt-5" role="status">
        正在讀取候選會友…
      </p>
    ) : null}
    {error ? (
      <Button
        className="mt-4"
        onClick={onRetry}
        type="button"
        variant="primary"
      >
        重新讀取候選會友
      </Button>
    ) : null}
    <CandidateRows
      editable={editable}
      rows={view.rows}
      selected={selection}
      toggle={toggle}
    />
    {!reading && !error && view.rows.length === 0 ? (
      <p className="mt-5" role="status">
        {searched || selectedOnly
          ? "未找到可指派的會友。"
          : "輸入姓名或用戶名稱，搜尋可指派的會友。"}
      </p>
    ) : null}
    {view.page > 1 || view.hasNext ? (
      <nav aria-label="會友分頁" className="mt-5 flex flex-wrap gap-3">
        <Button
          disabled={!editable || view.page <= 1}
          onClick={() => onPage(view.page - 1)}
          type="button"
          variant="secondary"
        >
          上一頁會友
        </Button>
        <Button
          disabled={!editable || !view.hasNext}
          onClick={() => onPage(view.page + 1)}
          type="button"
          variant="secondary"
        >
          下一頁會友
        </Button>
      </nav>
    ) : null}
  </>
);

const PreviousSelection = ({ people }: { people: ProgramLeaderCandidate[] }) =>
  people.length > 0 ? (
    <section
      aria-label="上次原定選取"
      className="border-border mt-6 border-t pt-5"
    >
      <h2 className="text-section">上次原定選取（未儲存）</h2>
      <p className="mt-2">以下只供參考，未有套用任何變更。</p>
      <ul className="mt-3 space-y-2">
        {people.map((person) => (
          <li className="wrap-anywhere" key={person.userId}>
            {person.fullName} · {person.username}
          </li>
        ))}
      </ul>
    </section>
  ) : null;

const PickerFeedback = ({
  phase,
  message,
  feedback,
  knownScope,
  prepared,
  reading,
  onReselect,
  onRetryScope,
}: {
  phase: Phase;
  message: string;
  feedback: RefObject<HTMLParagraphElement | null>;
  knownScope: boolean;
  prepared: boolean;
  reading: boolean;
  onReselect: () => void;
  onRetryScope: () => void;
}) => (
  <>
    {phase === "loading" ? <p role="status">正在讀取聚會資料…</p> : null}
    {phase === "conflict" ? (
      <Button
        className="mt-5"
        disabled={!knownScope || reading}
        onClick={onReselect}
        type="button"
        variant="primary"
      >
        按最新資格重新選擇
      </Button>
    ) : null}
    {message ? (
      <p
        className="mt-6 wrap-anywhere focus-visible:outline-2"
        ref={feedback}
        role={phase === "pending" || phase === "unknown" ? "status" : "alert"}
        tabIndex={-1}
      >
        {message}
      </p>
    ) : null}
    {phase === "storage" && !prepared ? (
      <Button
        className="mt-4"
        onClick={() => window.location.reload()}
        type="button"
        variant="primary"
      >
        重新載入聚會資料
      </Button>
    ) : null}
    {(phase === "ready" || phase === "conflict") && !knownScope ? (
      <Button
        className="mt-4"
        disabled={reading}
        onClick={onRetryScope}
        type="button"
        variant="primary"
      >
        重新讀取聚會資料
      </Button>
    ) : null}
  </>
);

export const ProgramLeaderCandidatePicker = ({
  actor,
  authorityAssignmentId,
  departmentId,
  programId,
  returnHref,
  navigation,
  initialQuery,
}: {
  actor: string;
  authorityAssignmentId: string;
  departmentId: string;
  programId: string;
  returnHref: string;
  navigation: ReactNode;
  initialQuery: string;
}) => {
  const entryQuery = useRef(initialQuery);
  const formId = useId();
  const searchId = useId();
  const feedback = useRef<HTMLParagraphElement>(null);
  const marker = useRef<string | null>(null);
  const busy = useRef(false);
  const contextCheck = useRef<{
    epoch: number;
    kind: "scope" | "actor";
    promise: Promise<boolean>;
    probeId: symbol;
  } | null>(null);
  const operation = useRef<RoleOperationReference | null>(null);
  const intent = useRef<ProgramLeaderGrantBatchInput | null>(null);
  const prepared = useRef<ProgramLeaderGrantBatchInput | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [scope, setScope] = useState<ProgramLeaderRoster | null>(null);
  const [remote, setRemote] = useState<ProgramLeaderCandidatePage | null>(null);
  const [readBusy, setReadBusy] = useState(false);
  const [readError, setReadError] = useState(false);
  const [query, setQuery] = useState(entryQuery.current);
  const [queryError, setQueryError] = useState("");
  const returnDestination = queryHref(returnHref, query);
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [previous, setPrevious] = useState<ProgramLeaderCandidate[]>([]);
  const [proof, setProof] = useState(false);
  const [message, setMessage] = useState("");
  const {
    actorUserId,
    beginRead,
    cancelRead,
    releaseRead,
    beginOperation,
    invalidate,
    isCurrent,
    requestEpoch,
    verifyActor,
  } = useRoleCommandLifetime(actor);
  const form = useAppForm({
    defaultValues: {
      query: entryQuery.current,
      selected: [] as ProgramLeaderCandidate[],
    },
    onSubmit: async ({ value, meta }) => {
      if (!meta.submit) {
        throw new Error("An explicit grant submission is required");
      }
      await meta.submit(value.selected);
    },
    onSubmitMeta: defaultSubmissionMeta,
  });

  const dispose = useCallback(
    (text = "登入帳戶或部門管理權限已改變，選擇及本頁資料已清除。") => {
      invalidate();
      busy.current = false;
      prepared.current = null;
      intent.current = null;
      form.reset();
      setScope(null);
      setRemote(null);
      setPrevious([]);
      setQuery("");
      setProof(false);
      setReadBusy(false);
      setPhase("denied");
      setMessage(text);
    },
    [form, invalidate]
  );

  const sameScope = useCallback(
    (current: ProgramLeaderRoster) =>
      current.actorUserId === actor &&
      current.authorityAssignmentId === authorityAssignmentId &&
      current.program.id === programId &&
      current.program.departmentId === departmentId &&
      readAuthContextMarker() === marker.current,
    [actor, authorityAssignmentId, departmentId, programId]
  );

  const verifyContext = useCallback(
    (epoch: number): Promise<boolean> => {
      if (readAuthContextMarker() !== marker.current) {
        dispose();
        return Promise.resolve(false);
      }
      const active = contextCheck.current;
      if (active?.epoch === epoch && active.kind === "scope") {
        return active.promise;
      }
      // Focus/cookie rechecks share the lifetime owner's in-flight probe rather
      // than aborting a Save's same-epoch authority verification.
      const probeId = Symbol("scope-authority-probe");
      const promise = (async () => {
        try {
          return await verifyActor(
            actor,
            epoch,
            async (signal) => {
              const current = await readGrantBatchScope(
                actor,
                programId,
                signal
              );
              return sameScope(current) ? current.actorUserId : "";
            },
            dispose
          );
        } catch (error) {
          if (!isCurrent(epoch, actor) || aborted(error)) {
            return false;
          }
          dispose(
            statusIs(error, 401, 403, 404, 409)
              ? undefined
              : "暫時無法確認目前權限，資料已隱藏。原有操作查核記錄仍然保留。"
          );
          return false;
        } finally {
          if (contextCheck.current?.probeId === probeId) {
            contextCheck.current = null;
          }
        }
      })();
      contextCheck.current = { epoch, kind: "scope", probeId, promise };
      return promise;
    },
    [actor, dispose, isCurrent, programId, sameScope, verifyActor]
  );

  const verifyRecoveryActor = useCallback(
    (epoch: number): Promise<boolean> => {
      if (readAuthContextMarker() !== marker.current) {
        dispose();
        return Promise.resolve(false);
      }
      const active = contextCheck.current;
      if (active?.epoch === epoch && active.kind === "actor") {
        return active.promise;
      }
      const probeId = Symbol("actor-session-probe");
      const promise = (async () => {
        try {
          const matches = await verifyActor(
            actor,
            epoch,
            async (signal) => {
              const response = await fetch("/api/auth/get-session", {
                cache: "no-store",
                credentials: "same-origin",
                signal,
              });
              if (!response.ok) {
                throw new Error("Unreadable authentication context");
              }
              const identity = z
                .object({ user: z.object({ id: z.string() }) })
                .nullable()
                .parse(await response.json());
              return identity?.user.id ?? "";
            },
            dispose
          );
          if (readAuthContextMarker() !== marker.current) {
            dispose();
            return false;
          }
          return matches && isCurrent(epoch, actor);
        } catch (error) {
          if (!isCurrent(epoch, actor) || aborted(error)) {
            return false;
          }
          dispose("暫時無法確認登入狀態，原有操作查核記錄仍然保留。");
          return false;
        } finally {
          if (contextCheck.current?.probeId === probeId) {
            contextCheck.current = null;
          }
        }
      })();
      contextCheck.current = { epoch, kind: "actor", probeId, promise };
      return promise;
    },
    [actor, dispose, isCurrent, verifyActor]
  );

  useEffect(() => {
    marker.current = readAuthContextMarker();
    const { controller, epoch } = beginRead();
    const load = async () => {
      try {
        const stored = readRoleOperationReference(family, actor);
        if (stored) {
          operation.current = stored;
          setPhase("unknown");
          setMessage(
            "有一項原有批次尚未確認。請只查核原有操作，不要重新提交。"
          );
          return;
        }
        const current = await readGrantBatchScope(
          actor,
          programId,
          controller.signal
        );
        if (!isCurrent(epoch, actor)) {
          return;
        }
        if (!sameScope(current)) {
          dispose();
          return;
        }
        setScope(current);
        setPhase("ready");
        if (entryQuery.current) {
          const candidates = await readGrantBatchCandidates(
            actor,
            programId,
            entryQuery.current,
            1,
            controller.signal
          );
          if (!isCurrent(epoch, actor)) {
            return;
          }
          if (
            candidates.actorUserId !== actor ||
            candidates.authorityAssignmentId !== authorityAssignmentId ||
            readAuthContextMarker() !== marker.current
          ) {
            dispose();
            return;
          }
          setRemote(candidates);
        }
      } catch (error) {
        if (controller.signal.aborted || !isCurrent(epoch, actor)) {
          return;
        }
        if (
          readAuthContextMarker() !== marker.current ||
          statusIs(error, 401, 403, 404, 409)
        ) {
          dispose();
          return;
        }
        setPhase("storage");
        setMessage(
          "暫時無法讀取原有操作或聚會資料，不能開始另一項操作。請重新載入。"
        );
      } finally {
        releaseRead(controller);
      }
    };
    void load();
    return () => cancelRead(controller, epoch);
  }, [
    actor,
    authorityAssignmentId,
    beginRead,
    cancelRead,
    dispose,
    isCurrent,
    programId,
    releaseRead,
    sameScope,
  ]);

  useEffect(() => {
    const recheck = () => {
      if (readAuthContextMarker() !== marker.current) {
        dispose();
        return;
      }
      if (actorUserId.current === actor) {
        const verify =
          operation.current && !intent.current
            ? verifyRecoveryActor
            : verifyContext;
        void verify(requestEpoch.current);
      }
    };
    const visible = () => {
      if (document.visibilityState === "visible") {
        recheck();
      }
    };
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", visible);
    window.cookieStore?.addEventListener("change", recheck);
    return () => {
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", visible);
      window.cookieStore?.removeEventListener("change", recheck);
    };
  }, [
    actor,
    actorUserId,
    dispose,
    requestEpoch,
    verifyContext,
    verifyRecoveryActor,
  ]);

  useEffect(() => {
    if (message) {
      feedback.current?.focus();
    }
  }, [message]);

  const readCandidates = async (submittedQuery: string, page: number) => {
    const { controller, epoch } = beginRead();
    setReadBusy(true);
    setReadError(false);
    setRemote(null);
    try {
      const result = await readGrantBatchCandidates(
        actor,
        programId,
        submittedQuery,
        page,
        controller.signal
      );
      if (!isCurrent(epoch, actor)) {
        return;
      }
      if (
        readAuthContextMarker() !== marker.current ||
        result.actorUserId !== actor ||
        result.authorityAssignmentId !== authorityAssignmentId
      ) {
        dispose();
        return;
      }
      if (!(await verifyContext(epoch))) {
        return;
      }
      setRemote(result);
    } catch (error) {
      if (controller.signal.aborted || !isCurrent(epoch, actor)) {
        return;
      }
      if (
        readAuthContextMarker() !== marker.current ||
        statusIs(error, 401, 403, 404, 409)
      ) {
        dispose();
        return;
      }
      setReadError(true);
      setMessage("暫時無法讀取候選會友；選擇仍然保留，請重新搜尋。");
    } finally {
      releaseRead(controller);
      if (isCurrent(epoch, actor)) {
        setReadBusy(false);
      }
    }
  };

  const releaseOperation = (reference: RoleOperationReference) => {
    removeRoleOperationReference(family, actorUserId.current, reference);
    const remaining = readRoleOperationReference(family, actor);
    if (remaining) {
      throw new Error("Original operation fence remains");
    }
    operation.current = null;
    intent.current = null;
  };
  const complete = (
    reference: RoleOperationReference,
    receipt: ProgramLeaderGrantBatchReceipt
  ) => {
    releaseOperation(reference);
    form.reset();
    setScope(null);
    setRemote(null);
    const destination =
      receipt.scopeId === programId
        ? returnDestination
        : `/roles/program-leaders?program=${encodeURIComponent(receipt.scopeId)}`;
    window.location.assign(destination);
  };
  const conflict = async (
    selection: ProgramLeaderCandidate[],
    reference: RoleOperationReference | null,
    epoch: number
  ) => {
    if (!isCurrent(epoch, actor)) {
      return;
    }
    if (reference) {
      releaseOperation(reference);
    }
    prepared.current = null;
    setProof(false);
    setPrevious(selection);
    form.setFieldValue("selected", []);
    setRemote(null);
    setScope(null);
    setPhase("conflict");
    setMessage("整批未有儲存。原定選取只供參考，請按最新資料重新選擇。");
    const read = beginRead();
    try {
      const current = await readGrantBatchScope(
        actor,
        programId,
        read.controller.signal
      );
      if (!isCurrent(read.epoch, actor)) {
        return;
      }
      if (!sameScope(current)) {
        dispose();
        return;
      }
      setScope(current);
    } catch (error) {
      if (read.controller.signal.aborted || !isCurrent(read.epoch, actor)) {
        return;
      }
      if (
        readAuthContextMarker() !== marker.current ||
        statusIs(error, 401, 403, 404, 409)
      ) {
        dispose();
        return;
      }
      setMessage("整批未有儲存，暫時無法讀取最新資格。請重新載入。");
    } finally {
      releaseRead(read.controller);
    }
    if (isCurrent(read.epoch, actor) && query) {
      await readCandidates(query, 1);
    }
  };

  const noWrite = async (
    error: ProgramLeaderApiError,
    selection: ProgramLeaderCandidate[],
    reference: RoleOperationReference
  ) => {
    releaseOperation(reference);
    const read = beginRead();
    try {
      const current = await readGrantBatchScope(
        actor,
        programId,
        read.controller.signal
      );
      if (!isCurrent(read.epoch, actor)) {
        return;
      }
      if (!sameScope(current)) {
        dispose();
        return;
      }
      await validateGrantBatchSelection(
        actor,
        {
          authorityAssignmentId,
          expectedDepartmentId: departmentId,
          scopeId: programId,
          targetUserIds: selection.map((person) => person.userId),
        },
        read.controller.signal
      );
      if (!isCurrent(read.epoch, actor)) {
        return;
      }
      if (readAuthContextMarker() !== marker.current) {
        dispose();
        return;
      }
      setScope(current);
      setPhase("ready");
      const needsProof = error.code === "password_confirmation_required";
      setProof(needsProof);
      setMessage(
        needsProof ? "請先確認目前密碼，再按一次儲存。" : error.message
      );
    } catch (refreshError) {
      if (read.controller.signal.aborted || !isCurrent(read.epoch, actor)) {
        return;
      }
      if (
        readAuthContextMarker() !== marker.current ||
        statusIs(refreshError, 401, 403, 404)
      ) {
        dispose();
        return;
      }
      if (statusIs(refreshError, 409)) {
        if (await verifyContext(read.epoch)) {
          await conflict(selection, null, read.epoch);
        }
        return;
      }
      setScope(null);
      setPhase("ready");
      setMessage("整批未有儲存，暫時無法確認目前資格。請重新載入聚會資料。");
    } finally {
      releaseRead(read.controller);
    }
  };

  const handleSaveFailure = async (
    error: unknown,
    selection: ProgramLeaderCandidate[],
    reference: RoleOperationReference | null,
    epoch: number
  ) => {
    if (!isCurrent(epoch, actor)) {
      return;
    }
    if (reference && knownNoWrite(error)) {
      try {
        await noWrite(error, selection, reference);
      } catch {
        if (readAuthContextMarker() !== marker.current) {
          dispose();
          return;
        }
        setPhase("unknown");
        setMessage("未能清理原有查核記錄，請只查核原有操作，不要重新提交。");
      }
      return;
    }
    if (!(await verifyContext(epoch))) {
      return;
    }
    if (statusIs(error, 401, 403, 404)) {
      dispose();
      return;
    }
    if (statusIs(error, 409) && !reference) {
      await conflict(selection, null, epoch);
      return;
    }
    setPhase(reference ? "unknown" : "ready");
    setMessage(
      reference
        ? "未能確認整批是否已儲存。請只查核原有操作，不要重複提交。"
        : "未有提交，原有選擇已保留，請重新讀取目前資格。"
    );
  };

  const retryScope = async (selection: ProgramLeaderCandidate[]) => {
    const read = beginRead();
    setReadBusy(true);
    try {
      const current = await readGrantBatchScope(
        actor,
        programId,
        read.controller.signal
      );
      if (!isCurrent(read.epoch, actor)) {
        return;
      }
      if (!sameScope(current)) {
        dispose();
        return;
      }
      if (selection.length > 0) {
        await validateGrantBatchSelection(
          actor,
          {
            authorityAssignmentId,
            expectedDepartmentId: departmentId,
            scopeId: programId,
            targetUserIds: selection.map((person) => person.userId),
          },
          read.controller.signal
        );
      }
      if (!isCurrent(read.epoch, actor)) {
        return;
      }
      if (readAuthContextMarker() !== marker.current) {
        dispose();
        return;
      }
      setScope(current);
      setMessage("已重新確認目前資格，請檢查選擇再按儲存。");
    } catch (error) {
      if (read.controller.signal.aborted || !isCurrent(read.epoch, actor)) {
        return;
      }
      if (
        readAuthContextMarker() !== marker.current ||
        statusIs(error, 401, 403, 404)
      ) {
        dispose();
        return;
      }
      if (statusIs(error, 409)) {
        await conflict(selection, null, read.epoch);
        return;
      }
      setMessage("暫時無法讀取聚會資料，未有提交。請稍後重新讀取。");
    } finally {
      releaseRead(read.controller);
      if (isCurrent(read.epoch, actor)) {
        setReadBusy(false);
      }
    }
  };

  const save = async (
    selection: ProgramLeaderCandidate[],
    retryPrepared = false
  ) => {
    if (
      actorUserId.current !== actor ||
      busy.current ||
      readBusy ||
      proof ||
      !scope ||
      selection.length === 0 ||
      (!retryPrepared && phase !== "ready")
    ) {
      return;
    }
    busy.current = true;
    setPhase("pending");
    setMessage("正在檢查及儲存整批指派…");
    const read = beginRead();
    let { epoch } = read;
    let reference: RoleOperationReference | null = null;
    try {
      if (!(await verifyContext(epoch))) {
        return;
      }
      const input =
        prepared.current ??
        programLeaderGrantBatchSchema.parse({
          authorityAssignmentId,
          expectedDepartmentId: departmentId,
          operationKey: crypto.randomUUID(),
          scopeId: programId,
          targetUserIds: selection.map((person) => person.userId),
        });
      await validateGrantBatchSelection(
        actor,
        {
          authorityAssignmentId: input.authorityAssignmentId,
          expectedDepartmentId: input.expectedDepartmentId,
          scopeId: input.scopeId,
          targetUserIds: input.targetUserIds,
        },
        read.controller.signal
      );
      if (!isCurrent(epoch, actor) || !(await verifyContext(epoch))) {
        return;
      }
      reference = { actorUserId: actor, operationKey: input.operationKey };
      prepared.current = input;
      if (
        !storeRoleOperationReference(family, actorUserId.current, reference)
      ) {
        setPhase("storage");
        setMessage(
          "無法安全保留操作查核記錄，未有提交。請恢復儲存空間後重試保留同一項操作。"
        );
        return;
      }
      prepared.current = null;
      operation.current = reference;
      intent.current = input;
      epoch = beginOperation();
      const result = await saveProgramLeaderGrantBatch(actor, input);
      if (!(await verifyContext(epoch))) {
        return;
      }
      if (!matchesReceipt(input, result.receipt)) {
        throw new Error("Unverified original batch receipt");
      }
      complete(reference, result.receipt);
    } catch (error) {
      await handleSaveFailure(error, selection, reference, epoch);
    } finally {
      releaseRead(read.controller);
      busy.current = false;
    }
  };

  const reconcile = async () => {
    const reference = operation.current;
    if (!reference || busy.current || phase !== "unknown") {
      return;
    }
    busy.current = true;
    setPhase("pending");
    const epoch = beginOperation();
    const verify = intent.current ? verifyContext : verifyRecoveryActor;
    try {
      if (!(await verify(epoch))) {
        return;
      }
      const result = await reconcileProgramLeaderGrantBatch(
        actor,
        reference.operationKey
      );
      if (!(await verify(epoch))) {
        return;
      }
      if (
        result.outcome === "unknown" ||
        (intent.current && !matchesReceipt(intent.current, result.receipt))
      ) {
        setPhase("unknown");
        setMessage("仍未能確認原有整批操作，請稍後再查核。");
        return;
      }
      complete(reference, result.receipt);
    } catch (error) {
      if (!isCurrent(epoch, actor)) {
        return;
      }
      if (!(await verify(epoch))) {
        return;
      }
      if (statusIs(error, 401, 403, 404, 409)) {
        dispose();
        return;
      }
      setPhase("unknown");
      setMessage("暫時無法查核，原有操作記錄仍然保留。");
    } finally {
      busy.current = false;
    }
  };

  return (
    <form.Subscribe selector={(state) => state.values.selected}>
      {(selected) => {
        const editable =
          phase === "ready" && !proof && !readBusy && Boolean(scope);
        const view = candidateViewPage(selected, remote, selectedOnly);
        const toggle = (person: ProgramLeaderCandidate) => {
          if (!editable) {
            return;
          }
          const exists = selected.some(
            (entry) => entry.userId === person.userId
          );
          if (!exists && selected.length >= PROGRAM_LEADER_GRANT_BATCH_LIMIT) {
            return;
          }
          form.setFieldValue(
            "selected",
            exists
              ? selected.filter((entry) => entry.userId !== person.userId)
              : [...selected, person]
          );
        };
        const reset = () => {
          form.setFieldValue("selected", []);
          setSelectedOnly(false);
          setMessage("");
        };
        const hasActions = hasPickerActions(
          phase,
          selected.length,
          Boolean(prepared.current)
        );
        const actions = hasActions ? (
          <PickerActions
            count={selected.length}
            editable={editable}
            formId={formId}
            phase={phase}
            prepared={Boolean(prepared.current)}
            reset={reset}
            reconcile={() => {
              void reconcile();
            }}
            retryStorage={() => {
              void save(selected, true);
            }}
          />
        ) : null;
        return (
          <RoleTaskFrame
            navigation={navigation}
            title="指派負責人"
            actions={actions}
            returnControl={
              <UnsavedChangesLink
                variant="quiet"
                className="size-11 shrink-0 focus-visible:outline-2"
                description="離開後會清除未提交的會友選擇；原有已提交操作的查核記錄會保留。"
                href={returnDestination}
                isDirty={
                  selected.length > 0 &&
                  (phase === "ready" ||
                    (phase === "storage" && Boolean(prepared.current)))
                }
                onDiscard={() => {
                  if (busy.current) {
                    return false;
                  }
                  const unsent = prepared.current;
                  if (unsent) {
                    try {
                      releaseOperation({
                        actorUserId: actor,
                        operationKey: unsent.operationKey,
                      });
                    } catch {
                      setMessage(
                        "暫時無法清理未提交的查核記錄，請先恢復儲存空間。"
                      );
                      return false;
                    }
                    prepared.current = null;
                  }
                  reset();
                }}
              >
                <Icon className="size-5" name="arrow-left" />
                <span className="sr-only">返回聚會</span>
              </UnsavedChangesLink>
            }
          >
            {scope ? (
              <>
                <p className="text-muted-foreground -mt-2 mb-6 wrap-anywhere">
                  {scope.program.name}（{scope.program.departmentName}）
                </p>
                <p className="text-muted-foreground mb-5">
                  一次最多選取 {PROGRAM_LEADER_GRANT_BATCH_LIMIT}{" "}
                  位會友，整批成功或全部不儲存。減號只取消未儲存的選擇。
                </p>
                <form.Field name="query">
                  {(field) => (
                    <CandidateSearch
                      editable={editable}
                      error={queryError}
                      onBlur={field.handleBlur}
                      onChange={field.handleChange}
                      onSearch={() => {
                        const parsed = searchQuery.safeParse(field.state.value);
                        if (!parsed.success) {
                          setQueryError(
                            parsed.error.issues[0]?.message ??
                              "請輸入姓名或用戶名稱。"
                          );
                          document
                            .querySelector<HTMLInputElement>(
                              `#${CSS.escape(searchId)}`
                            )
                            ?.focus();
                          return;
                        }
                        setQueryError("");
                        setQuery(parsed.data);
                        setSelectedOnly(false);
                        window.history.replaceState(
                          null,
                          "",
                          queryHref(
                            window.location.pathname + window.location.search,
                            parsed.data
                          )
                        );
                        void readCandidates(parsed.data, 1);
                      }}
                      searchId={searchId}
                      value={field.state.value}
                    />
                  )}
                </form.Field>
                <CandidateResults
                  editable={editable}
                  error={readError}
                  onPage={(page) => {
                    void readCandidates(query, page);
                  }}
                  onRetry={() => {
                    void readCandidates(query, 1);
                  }}
                  onSelectedOnly={() => setSelectedOnly(!selectedOnly)}
                  reading={readBusy}
                  searched={Boolean(query)}
                  selectedOnly={selectedOnly}
                  selection={selected}
                  toggle={toggle}
                  view={view}
                />
                <form
                  id={formId}
                  onSubmit={(event) => {
                    event.preventDefault();
                    void form.handleSubmit({ submit: save });
                  }}
                />
              </>
            ) : null}
            <PreviousSelection people={previous} />
            {proof && scope ? (
              <AccountSecurityForm
                actorUserId={actor}
                confirmationExpiresAt={null}
                temporaryPasswordExpiresAt={null}
                temporaryPasswordExpired={false}
                task="confirm"
                confirmationOnly
                confirmationContext={[
                  { label: "聚會", value: scope.program.name },
                  ...selected.map((person) => ({
                    label: "新增聚會負責人",
                    value: `${person.fullName} · ${person.username ?? ""}`,
                  })),
                ]}
                onConfirmationClose={() => setProof(false)}
                onConfirmedInWork={() => {
                  setProof(false);
                  setMessage("密碼已確認，請檢查選擇再按一次儲存。");
                }}
              />
            ) : null}
            <PickerFeedback
              feedback={feedback}
              knownScope={Boolean(scope)}
              message={message}
              phase={phase}
              prepared={Boolean(prepared.current)}
              reading={readBusy}
              onReselect={() => {
                setPrevious([]);
                reset();
                setPhase("ready");
                setMessage("已重新讀取目前資格，請重新選擇。");
              }}
              onRetryScope={() => {
                void retryScope(selected);
              }}
            />
          </RoleTaskFrame>
        );
      }}
    </form.Subscribe>
  );
};
