"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";

import { useAppForm } from "@/components/ui/app-form";
import { Button } from "@/components/ui/button";
import { FieldControl, FieldLabel, FieldRoot } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { UnsavedChangesLink } from "@/components/unsaved-changes-link";
import { AccountSecurityForm } from "@/features/account/security/security-form";
import { readAuthContextMarker } from "@/features/auth/auth-context-marker";

import { scopedRoleChangeSchema } from "../scoped-role-change-contract";
import type {
  ScopedRoleChangeInput,
  ScopedRoleChangeReceipt,
} from "../scoped-role-change-contract";
import {
  readRoleOperationReference,
  removeRoleOperationReference,
  storeRoleOperationReference,
  useRoleCommandLifetime,
} from "./role-command-lifetime";
import type { RoleOperationReference } from "./role-command-lifetime";
import { RolePersonApiError, searchRolePeople } from "./role-person-api";
import { RoleTaskFrame } from "./role-task-frame";
import {
  changeScopedRoles,
  getScopedRoleBaseline,
  reconcileScopedRoles,
  ScopedRoleApiError,
} from "./scoped-role-api";
import type {
  ScopedRoleBaseline,
  ScopedRoleDepartment,
} from "./scoped-role-api";

interface ScopedRoleDraft extends ScopedRoleDepartment {
  enabled: boolean;
  page: number;
}

interface TaskIdentity {
  fullName: string;
  userId: string;
  username: string | null;
}

type Phase =
  | "ready"
  | "pending"
  | "unknown"
  | "conflict"
  | "denied"
  | "storage";

const hasTaskActions = (phase: Phase, count: number) =>
  phase === "pending" ||
  phase === "unknown" ||
  (phase === "ready" && count > 0);

const denied = (error: unknown) =>
  (error instanceof ScopedRoleApiError ||
    error instanceof RolePersonApiError) &&
  [401, 403, 404, 409].includes(error.status);

const sameReviewedRows = (
  choices: ScopedRoleDraft[],
  pages: ScopedRoleBaseline[]
) =>
  choices.every((choice) => {
    const page = pages.find((candidate) => candidate.page === choice.page);
    const row = page?.departments.find(
      (candidate) => candidate.scopeId === choice.scopeId
    );
    return row !== undefined && row.assignmentId === choice.assignmentId;
  });

const receiptMatches = (
  input: ScopedRoleChangeInput,
  receipt: ScopedRoleChangeReceipt
) =>
  input.targetUserId === receipt.targetUserId &&
  input.changes.length === receipt.changes.length &&
  input.changes.every((change) =>
    receipt.changes.some(
      (outcome) =>
        outcome.scopeId === change.scopeId && outcome.action === change.action
    )
  );

const hasIneligibleGrant = (
  eligibleForGrant: boolean | undefined,
  choices: ScopedRoleDraft[]
) => eligibleForGrant === false && choices.some((choice) => choice.enabled);

const changeEntries = (choices: ScopedRoleDraft[]) =>
  choices.map((choice) => {
    if (choice.enabled) {
      return { action: "granted" as const, scopeId: choice.scopeId };
    }
    if (!choice.assignmentId) {
      throw new Error("A withdrawal needs its reviewed assignment");
    }
    return {
      action: "withdrawn" as const,
      expectedAssignmentId: choice.assignmentId,
      scopeId: choice.scopeId,
    };
  });

const DutyChoice = ({
  checked,
  disabled,
  onBlur,
  onChange,
  row,
  changed,
}: {
  changed: boolean;
  checked: boolean;
  disabled: boolean;
  onBlur: () => void;
  onChange: (checked: boolean) => void;
  row: ScopedRoleDepartment;
}) => {
  const id = useId();
  let state = row.assignmentId ? "現任部門主管" : "未指派";
  if (changed) {
    state = checked ? "將新增" : "將撤回";
  }
  return (
    <FieldRoot name={id}>
      <FieldLabel
        className="flex min-h-11 min-w-0 items-center gap-3 py-3"
        htmlFor={id}
      >
        <FieldControl
          id={id}
          aria-labelledby={`${id}-name`}
          aria-describedby={`${id}-state`}
          render={
            <input
              checked={checked}
              className="h-5 w-5 shrink-0"
              disabled={disabled}
              onBlur={onBlur}
              onChange={(event) => onChange(event.target.checked)}
              type="checkbox"
            />
          }
        />
        <span className="min-w-0 wrap-anywhere">
          <span className="block" id={`${id}-name`}>
            {`部門主管：${row.scopeName}`}
          </span>
          <span
            className="text-meta text-muted-foreground mt-1 block"
            id={`${id}-state`}
          >
            {state}
          </span>
        </span>
      </FieldLabel>
    </FieldRoot>
  );
};

const PreviousIntent = ({ choices }: { choices: ScopedRoleDraft[] }) => (
  <section
    className="border-border mt-6 rounded-xl border p-4"
    aria-labelledby="previous-scoped-intent"
  >
    <h2 className="text-section" id="previous-scoped-intent">
      上次未儲存的選擇
    </h2>
    <p className="text-muted-foreground mt-2">
      整批未有儲存。以下只供參考，請按最新職務重新選擇。
    </p>
    <ul className="mt-3 space-y-2">
      {choices.map((choice) => (
        <li className="wrap-anywhere" key={choice.scopeId}>
          {choice.scopeName}：{choice.enabled ? "新增部門主管" : "撤回部門主管"}
        </li>
      ))}
    </ul>
  </section>
);

const ScopedRoleActions = ({
  count,
  editable,
  invalidGrant,
  phase,
  ready,
  reconcile,
  reset,
}: {
  count: number;
  editable: boolean;
  invalidGrant: boolean;
  phase: Phase;
  ready: boolean;
  reconcile: () => Promise<void>;
  reset: () => void;
}) => {
  if (phase === "pending" || phase === "unknown") {
    return (
      <>
        <p className="text-meta mr-auto" role="status">
          結果待確認
        </p>
        <Button
          disabled={phase === "pending"}
          onClick={reconcile}
          type="button"
          variant="primary"
        >
          查核原有操作
        </Button>
      </>
    );
  }
  if (phase !== "ready" || count === 0) {
    return null;
  }
  return (
    <>
      <p className="text-meta mr-auto" role="status">
        {count} 項未提交更改
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
        disabled={!editable || !ready || invalidGrant}
        form="scoped-role-form"
        type="submit"
        variant="primary"
      >
        儲存
      </Button>
    </>
  );
};

export const ScopedRoleTask = ({
  actorUserId: actor,
  actorKind,
  authorityAssignmentId,
  initialPerson,
  navigation,
  returnHref,
  targetUserId,
}: {
  actorUserId: string;
  actorKind: "admin" | "role_assigner";
  authorityAssignmentId: string | null;
  initialPerson: TaskIdentity | null;
  navigation: ReactNode;
  returnHref: string;
  targetUserId: string;
}) => {
  const router = useRouter();
  const {
    actorUserId,
    beginOperation,
    beginRead,
    invalidate,
    isCurrent,
    releaseRead,
    verifyActor,
  } = useRoleCommandLifetime(actor);
  const [person, setPerson] = useState<TaskIdentity | null>(initialPerson);
  const [phase, setPhase] = useState<Phase>("ready");
  const [remote, setRemote] = useState<{
    data: ScopedRoleBaseline | null;
    error: string | null;
    loading: boolean;
    page: number;
  }>({ data: null, error: null, loading: true, page: 1 });
  const [message, setMessage] = useState("");
  const [proof, setProof] = useState(false);
  const [previous, setPrevious] = useState<ScopedRoleDraft[] | null>(null);
  const operation = useRef<RoleOperationReference | null>(null);
  const preparedOperation = useRef<RoleOperationReference | null>(null);
  const intent = useRef<ScopedRoleChangeInput | null>(null);
  const busy = useRef(false);
  const reading = useRef(false);
  const marker = useRef<string | null>(null);
  const feedback = useRef<HTMLParagraphElement>(null);

  const discardPreparedOperation = useCallback(() => {
    const prepared = preparedOperation.current;
    if (prepared) {
      removeRoleOperationReference("scoped-role", actor, prepared);
      preparedOperation.current = null;
    }
  }, [actor]);

  const dispose = useCallback(() => {
    discardPreparedOperation();
    invalidate();
    intent.current = null;
    setPerson(null);
    setRemote({ data: null, error: null, loading: false, page: 1 });
    setPrevious(null);
    setProof(false);
    setPhase("denied");
    router.replace("/roles/people");
  }, [discardPreparedOperation, invalidate, router]);

  const readSavedOperation = useCallback(() => {
    try {
      return readRoleOperationReference("scoped-role", actor);
    } catch {
      setPerson(null);
      setRemote({ data: null, error: null, loading: false, page: 1 });
      setProof(false);
      setPhase("storage");
      setMessage(
        "無法安全讀取操作查核記錄，未有提交新的操作。請重新載入後再試。"
      );
    }
  }, [actor]);

  const retainPreparedOperation = (reference: RoleOperationReference) => {
    preparedOperation.current = reference;
    let saved: RoleOperationReference | null | undefined;
    try {
      saved = readRoleOperationReference("scoped-role", actor);
    } catch {
      // This fresh reference has not dispatched. Retry must verify its same key.
      saved = undefined;
    }
    if (saved && saved.operationKey !== reference.operationKey) {
      preparedOperation.current = null;
      operation.current = saved;
      intent.current = null;
      setPerson(null);
      setRemote({ data: null, error: null, loading: false, page: 1 });
      setPhase("unknown");
      setMessage("已有原有操作需要查核；未有提交這次選擇。");
      return;
    }
    setPhase("ready");
    setMessage(
      "無法安全保留操作查核記錄，未有提交。原有選擇及操作編號已保留，請重試儲存。"
    );
  };

  const sameAuthority = useCallback(
    (page: ScopedRoleBaseline) =>
      page.actorUserId === actor &&
      page.actorKind === (actorKind === "admin" ? "admin" : "role-assigner") &&
      page.authorityAssignmentId === authorityAssignmentId &&
      readAuthContextMarker() === marker.current,
    [actor, actorKind, authorityAssignmentId]
  );

  const loadPage = useCallback(
    async (page: number, choices: ScopedRoleDraft[]) => {
      const { controller, epoch } = beginRead();
      reading.current = true;
      setRemote({ data: null, error: null, loading: true, page });
      try {
        const data = await getScopedRoleBaseline(
          actor,
          targetUserId,
          page,
          controller.signal
        );
        if (!isCurrent(epoch, actor)) {
          return;
        }
        if (!sameAuthority(data)) {
          dispose();
          return;
        }
        const relevant = choices.filter((choice) => choice.page === page);
        if (!sameReviewedRows(relevant, [data])) {
          setPrevious(choices);
          setPhase("conflict");
          setMessage("目前職務已有改變，整批未有儲存。請按最新資料重新選擇。");
        }
        setRemote({ data, error: null, loading: false, page });
      } catch (error) {
        if (!isCurrent(epoch, actor) || controller.signal.aborted) {
          return;
        }
        if (denied(error)) {
          dispose();
        } else {
          setRemote({
            data: null,
            error: "暫時無法讀取目前部門職務；未讀取的部門不能編輯。",
            loading: false,
            page,
          });
        }
      } finally {
        releaseRead(controller);
        if (isCurrent(epoch, actor)) {
          reading.current = false;
        }
      }
    },
    [
      actor,
      beginRead,
      dispose,
      targetUserId,
      isCurrent,
      releaseRead,
      sameAuthority,
    ]
  );

  const verifyContext = useCallback(
    (epoch: number) =>
      verifyActor(
        actor,
        epoch,
        async (signal) => {
          const current = await searchRolePeople("", 1, signal);
          if (
            current.actorKind !== actorKind ||
            current.authorityAssignmentId !== authorityAssignmentId ||
            readAuthContextMarker() !== marker.current
          ) {
            return "";
          }
          return current.actorUserId;
        },
        dispose
      ),
    [actor, actorKind, authorityAssignmentId, dispose, verifyActor]
  );

  useEffect(() => {
    actorUserId.current = actor;
    marker.current = readAuthContextMarker();
    const saved = readSavedOperation();
    if (saved === undefined) {
      return;
    }
    if (saved) {
      operation.current = saved;
      setPerson(null);
      setRemote({ data: null, error: null, loading: false, page: 1 });
      setPhase("unknown");
      setMessage("先查核原有操作；未確認前不能另行儲存。");
    } else if (initialPerson) {
      void loadPage(1, []);
    } else {
      dispose();
    }
    const recheck = async () => {
      // Authentication notifications must fence protected presentation even
      // while the original write or its reader is still held in flight.
      if (readAuthContextMarker() !== marker.current) {
        dispose();
        return;
      }
      if (document.hidden || busy.current || reading.current) {
        return;
      }
      const epoch = beginOperation();
      try {
        await verifyContext(epoch);
      } catch (error) {
        if (isCurrent(epoch, actor) && denied(error)) {
          dispose();
        }
      }
    };
    const store = Reflect.get(window, "cookieStore") as EventTarget | undefined;
    store?.addEventListener("change", recheck);
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      invalidate();
      store?.removeEventListener("change", recheck);
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, [
    actor,
    actorUserId,
    beginOperation,
    dispose,
    initialPerson,
    invalidate,
    isCurrent,
    loadPage,
    readSavedOperation,
    verifyContext,
  ]);

  useEffect(() => {
    if (message && !proof && phase === "ready") {
      feedback.current?.focus();
    }
  }, [message, phase, proof]);

  const reviewUnchanged = async (epoch: number, choices: ScopedRoleDraft[]) => {
    let pages: ScopedRoleBaseline[] = [];
    const pageNumbers = [...new Set(choices.map((choice) => choice.page))];
    const verified = await verifyActor(
      actor,
      epoch,
      async (signal) => {
        pages = await Promise.all(
          pageNumbers.map((page) =>
            getScopedRoleBaseline(actor, targetUserId, page, signal)
          )
        );
        return pages.every(sameAuthority) ? actor : "";
      },
      dispose
    );
    if (!verified) {
      return null;
    }
    return {
      eligibleForGrant: pages.every((page) => page.eligibleForGrant),
      unchanged: sameReviewedRows(choices, pages),
    };
  };

  const releaseOperation = (reference: RoleOperationReference) => {
    removeRoleOperationReference("scoped-role", actorUserId.current, reference);
    operation.current = null;
    intent.current = null;
  };

  const showConflict = async (
    choices: ScopedRoleDraft[],
    reference: RoleOperationReference | null
  ) => {
    if (reference) {
      releaseOperation(reference);
    }
    setProof(false);
    setPrevious(choices);
    setPhase("conflict");
    setMessage("整批未有儲存。上次選擇只供參考，請按最新職務重新選擇。");
    await loadPage(remote.page, []);
  };

  const restoreNoWrite = async (
    error: ScopedRoleApiError,
    choices: ScopedRoleDraft[],
    reference: RoleOperationReference,
    epoch: number
  ) => {
    if (operation.current !== reference || !intent.current) {
      return;
    }
    // The command definitively did not write. A later reader outage cannot
    // turn this fresh, unsent draft into an unresolved submitted operation.
    releaseOperation(reference);
    setProof(false);
    setRemote({ data: null, error: null, loading: true, page: remote.page });
    let current: Awaited<ReturnType<typeof reviewUnchanged>>;
    try {
      current = await reviewUnchanged(epoch, choices);
    } catch (readError) {
      if (!isCurrent(epoch, actor)) {
        return;
      }
      if (readAuthContextMarker() !== marker.current) {
        dispose();
        return;
      }
      if (denied(readError)) {
        throw readError;
      }
      setPhase("ready");
      setRemote({
        data: null,
        error: "暫時無法讀取目前部門職務；未讀取的部門不能編輯。",
        loading: false,
        page: remote.page,
      });
      setMessage(
        "整批未有提交，原有選擇已保留。請先重新讀取目前職務，再檢查及儲存。"
      );
      return;
    }
    if (!current) {
      return;
    }
    if (!current.unchanged) {
      await showConflict(choices, null);
      return;
    }
    setPhase("ready");
    const needsProof = error.code === "password_confirmation_required";
    setProof(needsProof);
    setMessage(needsProof ? "請先確認目前密碼，再按一次儲存。" : error.message);
    if (!current.eligibleForGrant && choices.some((choice) => choice.enabled)) {
      setProof(false);
      setMessage(
        "對象目前不符合新增職務的條件。請重設或取消新增選擇；現有職務仍可按權限撤回。"
      );
    }
    await loadPage(remote.page, choices);
  };

  const verifyUnknownContext = async (epoch: number) => {
    if (readAuthContextMarker() !== marker.current) {
      dispose();
      return false;
    }
    try {
      return await verifyContext(epoch);
    } catch (actorError) {
      if (!isCurrent(epoch, actor)) {
        return false;
      }
      if (readAuthContextMarker() !== marker.current || denied(actorError)) {
        dispose();
        return false;
      }
      // An unavailable actor read is not proof of unchanged authority. Keep
      // only recovery visible until reconciliation can verify the actor.
      setPerson(null);
      setPrevious(null);
      setProof(false);
      setRemote({ data: null, error: null, loading: false, page: 1 });
      return true;
    }
  };

  const handleFailure = async (
    error: unknown,
    choices: ScopedRoleDraft[],
    reference: RoleOperationReference | null,
    epoch: number
  ) => {
    if (
      error instanceof ScopedRoleApiError &&
      error.code === "actor_changed" &&
      reference &&
      operation.current?.operationKey === reference.operationKey
    ) {
      removeRoleOperationReference("scoped-role", actor, reference);
      operation.current = null;
      intent.current = null;
    }
    if (!isCurrent(epoch, actor)) {
      return;
    }
    if (
      error instanceof ScopedRoleApiError &&
      error.code === "conflict" &&
      reference
    ) {
      await showConflict(choices, reference);
      return;
    }
    const knownNoWrite =
      error instanceof ScopedRoleApiError &&
      (error.code === "password_confirmation_required" || error.status === 400);
    if (knownNoWrite && reference) {
      await restoreNoWrite(error, choices, reference, epoch);
      return;
    }
    if (denied(error)) {
      dispose();
      if (
        (error instanceof ScopedRoleApiError ||
          error instanceof RolePersonApiError) &&
        error.status === 401
      ) {
        router.replace("/sign-in");
      }
      return;
    }
    if (!reference) {
      setPhase("ready");
      setMessage(
        "暫時未能確認目前職務，未有提交；原有選擇已保留。請重試讀取。"
      );
      return;
    }
    if (!(await verifyUnknownContext(epoch))) {
      return;
    }
    setPhase("unknown");
    setMessage("未能確認整批是否已儲存。請只查核原有操作，切勿另行提交。");
  };

  const complete = (reference: RoleOperationReference, destination: string) => {
    releaseOperation(reference);
    setPerson(null);
    setProof(false);
    window.location.assign(destination);
  };

  const recoverSaveFailure = async (
    error: unknown,
    choices: ScopedRoleDraft[],
    reference: RoleOperationReference | null,
    epoch: number
  ) => {
    try {
      await handleFailure(error, choices, reference, epoch);
    } catch (recoveryError) {
      if (isCurrent(epoch, actor)) {
        if (denied(recoveryError)) {
          dispose();
        } else {
          setPhase(reference ? "unknown" : "ready");
          setMessage(
            reference
              ? "暫時無法查核原有操作，請稍後再查核。"
              : "未有提交；原有選擇已保留，請重新讀取目前職務。"
          );
        }
      }
    }
  };

  const save = async (choices: ScopedRoleDraft[]) => {
    if (
      busy.current ||
      reading.current ||
      phase !== "ready" ||
      proof ||
      choices.length === 0 ||
      !remote.data
    ) {
      return;
    }
    busy.current = true;
    setPhase("pending");
    setMessage("正在儲存整批部門主管變更…");
    const epoch = beginOperation();
    let reference: RoleOperationReference | null = null;
    try {
      if (!(await verifyContext(epoch))) {
        return;
      }
      const current = await reviewUnchanged(epoch, choices);
      if (!current) {
        return;
      }
      if (!current.unchanged) {
        await showConflict(choices, null);
        return;
      }
      if (
        !current.eligibleForGrant &&
        choices.some((choice) => choice.enabled)
      ) {
        setPhase("ready");
        setMessage(
          "對象目前不符合新增職務的條件，未有提交。請取消新增選擇或重設。"
        );
        await loadPage(remote.page, choices);
        return;
      }
      const prepared = preparedOperation.current ?? {
        actorUserId: actor,
        operationKey: crypto.randomUUID(),
      };
      const input = scopedRoleChangeSchema.parse({
        ...(authorityAssignmentId ? { authorityAssignmentId } : {}),
        changes: changeEntries(choices),
        operationKey: prepared.operationKey,
        targetUserId,
      });
      reference = prepared;
      if (
        !storeRoleOperationReference(
          "scoped-role",
          actorUserId.current,
          reference
        )
      ) {
        retainPreparedOperation(reference);
        return;
      }
      preparedOperation.current = null;
      operation.current = reference;
      intent.current = input;
      const result = await changeScopedRoles(actor, input);
      if (!(await verifyContext(epoch))) {
        return;
      }
      if (!receiptMatches(input, result.receipt)) {
        throw new Error("Unverified aggregate outcome");
      }
      complete(reference, returnHref);
    } catch (error) {
      await recoverSaveFailure(error, choices, reference, epoch);
    } finally {
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
    try {
      if (!(await verifyContext(epoch))) {
        return;
      }
      const outcome = await reconcileScopedRoles(actor, reference.operationKey);
      if (!(await verifyContext(epoch))) {
        return;
      }
      if (outcome.outcome === "unknown") {
        setPhase("unknown");
        setMessage("仍未能確認原有操作，請稍後再查核。");
        return;
      }
      const original = intent.current;
      if (original && !receiptMatches(original, outcome.receipt)) {
        setPhase("unknown");
        setMessage("查核結果與原有選擇不符，未有確認這次更改。");
        return;
      }
      const destination = original
        ? returnHref
        : `/roles/people?person=${encodeURIComponent(outcome.receipt.targetUserId)}`;
      complete(reference, destination);
    } catch (error) {
      if (!isCurrent(epoch, actor)) {
        return;
      }
      if (denied(error)) {
        dispose();
      } else {
        setPhase("unknown");
        setMessage("暫時無法查核；原有操作仍然保留。");
      }
    } finally {
      busy.current = false;
    }
  };

  const defaultChoices: ScopedRoleDraft[] = [];
  const form = useAppForm({
    defaultValues: { choices: defaultChoices },
    onSubmit: async ({ value }) => {
      await save(value.choices);
    },
  });
  useEffect(() => {
    if (phase === "denied") {
      form.reset();
    }
  }, [form, phase]);
  const editable = phase === "ready" && !proof && !remote.loading;
  const pending = phase === "pending" || phase === "unknown";

  return (
    <form.Subscribe selector={(state) => state.values.choices}>
      {(choices) => {
        const { data } = remote;
        const dirty = choices.length > 0 && phase === "ready";
        const invalidGrant = hasIneligibleGrant(
          remote.data?.eligibleForGrant,
          choices
        );
        const toggle = (row: ScopedRoleDepartment, enabled: boolean) => {
          const remaining = choices.filter(
            (choice) => choice.scopeId !== row.scopeId
          );
          if (enabled !== Boolean(row.assignmentId)) {
            remaining.push({ ...row, enabled, page: remote.page });
          }
          form.setFieldValue("choices", remaining);
          setMessage("");
        };
        const reset = () => {
          discardPreparedOperation();
          form.reset();
          setMessage("");
        };
        const actions = hasTaskActions(phase, choices.length) ? (
          <ScopedRoleActions
            count={choices.length}
            editable={editable}
            invalidGrant={invalidGrant}
            phase={phase}
            ready={Boolean(data)}
            reconcile={reconcile}
            reset={reset}
          />
        ) : null;
        return (
          <RoleTaskFrame
            actions={actions}
            navigation={navigation}
            title="編輯部門主管職務"
            returnControl={
              <UnsavedChangesLink
                variant="quiet"
                className="size-11 shrink-0 focus-visible:outline-2"
                description="離開後會清除未提交的部門主管選擇；原有已提交操作的查核記錄會保留。"
                href={returnHref}
                isDirty={dirty}
                onDiscard={() => {
                  if (busy.current) {
                    return false;
                  }
                  discardPreparedOperation();
                  form.reset();
                }}
              >
                <Icon className="size-5" name="arrow-left" />
                <span className="sr-only">返回人員權責</span>
              </UnsavedChangesLink>
            }
          >
            {person ? (
              <>
                <h2 className="text-section wrap-anywhere">
                  {person.fullName}
                </h2>
                <p className="text-muted-foreground mt-1 wrap-anywhere">
                  {person.username ?? "未有 Username"}
                </p>
                {previous ? <PreviousIntent choices={previous} /> : null}
                <p className="text-muted-foreground mt-4">
                  部門主管與部門成員資格、聚會職務分開管理。只儲存你已讀取並明確更改的職務。
                </p>
                {remote.data ? (
                  <p className="text-meta text-muted-foreground mt-2">
                    每次最多 {remote.data.changeLimit}{" "}
                    項淨更改；其他職務保持不變。
                  </p>
                ) : null}
                {phase === "conflict" ? (
                  <Button
                    className="mt-4"
                    disabled={remote.loading || !remote.data}
                    onClick={() => {
                      form.reset();
                      setPrevious(null);
                      setPhase("ready");
                      setMessage("已讀取最新職務，請重新選擇再儲存。");
                    }}
                    type="button"
                    variant="primary"
                  >
                    按最新職務重新選擇
                  </Button>
                ) : null}
                {remote.loading ? (
                  <p className="mt-6" role="status">
                    正在讀取部門職務…
                  </p>
                ) : null}
                {remote.error ? (
                  <div className="mt-6">
                    <p role="alert">{remote.error}</p>
                    <Button
                      className="mt-3"
                      onClick={() =>
                        loadPage(
                          remote.page,
                          phase === "conflict" ? [] : choices
                        )
                      }
                      type="button"
                      variant="primary"
                    >
                      重新讀取部門職務
                    </Button>
                  </div>
                ) : null}
                <form
                  id="scoped-role-form"
                  className="mt-6"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void form.handleSubmit();
                  }}
                >
                  <form.Field name="choices">
                    {(field) => (
                      <>
                        {data?.departments.map((row) => {
                          const choice =
                            phase === "conflict"
                              ? undefined
                              : field.state.value.find(
                                  (candidate) =>
                                    candidate.scopeId === row.scopeId
                                );
                          const checked = choice
                            ? choice.enabled
                            : Boolean(row.assignmentId);
                          const limitReached =
                            !choice &&
                            field.state.value.length >= data.changeLimit;
                          const grantDenied =
                            !row.assignmentId &&
                            !data.eligibleForGrant &&
                            !choice;
                          return (
                            <DutyChoice
                              changed={Boolean(choice)}
                              checked={checked}
                              disabled={
                                !editable || limitReached || grantDenied
                              }
                              key={row.scopeId}
                              onBlur={field.handleBlur}
                              onChange={(enabled) => toggle(row, enabled)}
                              row={row}
                            />
                          );
                        })}
                        {remote.data?.departments.length === 0 ? (
                          <p role="status">目前沒有可處理的部門。</p>
                        ) : null}
                      </>
                    )}
                  </form.Field>
                </form>
                {remote.data ? (
                  <nav
                    aria-label="部門職務分頁"
                    className="mt-4 flex flex-wrap gap-3"
                  >
                    <Button
                      disabled={!editable || remote.page <= 1}
                      onClick={() => loadPage(remote.page - 1, choices)}
                      type="button"
                      variant="secondary"
                    >
                      上一頁部門
                    </Button>
                    <Button
                      disabled={!editable || !remote.data.hasNextPage}
                      onClick={() => loadPage(remote.page + 1, choices)}
                      type="button"
                      variant="secondary"
                    >
                      下一頁部門
                    </Button>
                  </nav>
                ) : null}
                {proof ? (
                  <AccountSecurityForm
                    actorUserId={actor}
                    confirmationExpiresAt={null}
                    temporaryPasswordExpiresAt={null}
                    temporaryPasswordExpired={false}
                    task="confirm"
                    confirmationOnly
                    confirmationContext={[
                      {
                        label: "對象",
                        value: `${person.fullName} · ${person.username ?? ""}`,
                      },
                      ...choices.map((choice) => ({
                        label: choice.scopeName,
                        value: choice.enabled ? "新增部門主管" : "撤回部門主管",
                      })),
                    ]}
                    onConfirmationClose={() => setProof(false)}
                    onConfirmedInWork={() => {
                      setProof(false);
                      setMessage("密碼已確認，請檢查選擇再按一次儲存。");
                    }}
                  />
                ) : null}
              </>
            ) : null}
            {message ? (
              <p
                className="mt-6 wrap-anywhere focus-visible:outline-2"
                ref={feedback}
                role={pending ? "status" : "alert"}
                tabIndex={-1}
              >
                {message}
              </p>
            ) : null}
            {phase === "storage" ? (
              <Button
                className="mt-4"
                onClick={() => window.location.reload()}
                type="button"
                variant="primary"
              >
                重新載入查核記錄
              </Button>
            ) : null}
          </RoleTaskFrame>
        );
      }}
    </form.Subscribe>
  );
};
