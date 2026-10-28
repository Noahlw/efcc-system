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

import {
  MIXED_SCOPED_ROLE_CHANGE_LIMIT,
  SCOPED_ROLE_CHANGE_LIMIT,
  scopedRoleChangeSchema,
} from "../scoped-role-change-contract";
import type {
  ScopedRoleChangeInput,
  ScopedRoleChangeReceipt,
} from "../scoped-role-change-contract";
import {
  readConflictingScopedOperationReference,
  scopedOperationRecoveryHref,
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
  getScopedRoleProgramBaseline,
  getLocalRoleBaseline,
  getLocalRoleProgramBaseline,
  reconcileLocalProgramRole,
  withdrawLocalProgramRole,
  reconcileScopedRoles,
  ScopedRoleApiError,
} from "./scoped-role-api";
import type {
  ScopedRoleBaseline,
  ScopedRoleDepartment,
  ScopedRoleProgramBaseline,
  ScopedRoleProgram,
} from "./scoped-role-api";

type ScopedRoleDraft =
  | (ScopedRoleDepartment & {
      role: "department_manager";
      enabled: boolean;
      page: number;
    })
  | (ScopedRoleProgram & {
      role: "program_leader";
      expectedDepartmentId: string;
      enabled: boolean;
      page: number;
    });

/** Narrows presentation only; authorized readers and the command own permission. */
interface ProgramRestriction {
  departmentId: string;
  programId: string;
}

const roleName = (role: ScopedRoleDraft["role"]) =>
  role === "department_manager" ? "部門主管" : "聚會負責人";

const draftKey = (choice: Pick<ScopedRoleDraft, "role" | "scopeId">) =>
  `${choice.role}:${choice.scopeId}`;

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

interface ProgramRemote {
  departmentId: string;
  page: number;
  data: ScopedRoleProgramBaseline | null;
  loading: boolean;
  error: string | null;
}

const changeLimit = (choices: ScopedRoleDraft[]) =>
  choices.some((choice) => choice.role === "program_leader")
    ? MIXED_SCOPED_ROLE_CHANGE_LIMIT
    : SCOPED_ROLE_CHANGE_LIMIT;

const exceedsChangeLimit = (choices: ScopedRoleDraft[]) =>
  choices.length > changeLimit(choices);

const visibleDepartments = (
  restriction: ProgramRestriction | null,
  programs: ProgramRemote | null,
  baseline: ScopedRoleBaseline | null
): ScopedRoleDepartment[] =>
  restriction
    ? [
        {
          assignmentId: null,
          scopeId: restriction.departmentId,
          scopeName: programs?.data?.departmentName ?? "指定聚會職務",
        },
      ]
    : (baseline?.departments ?? []);

const proofContext = (person: TaskIdentity, choices: ScopedRoleDraft[]) => [
  { label: "對象", value: `${person.fullName} · ${person.username ?? ""}` },
  ...choices.map((choice) => ({
    label: choice.scopeName,
    value: `${choice.enabled ? "新增" : "撤回"}${roleName(choice.role)}`,
  })),
];

const canSubmitChoices = (
  choices: ScopedRoleDraft[],
  phase: Phase,
  blocked: boolean,
  baseline: ScopedRoleBaseline | null
) =>
  phase === "ready" &&
  !blocked &&
  Boolean(baseline) &&
  choices.length > 0 &&
  !exceedsChangeLimit(choices);

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
  pages: ScopedRoleBaseline[],
  programPages: ScopedRoleProgramBaseline[] = []
) =>
  choices.every((choice) => {
    if (choice.role === "program_leader") {
      const page = programPages.find(
        (candidate) =>
          candidate.departmentId === choice.expectedDepartmentId &&
          candidate.page === choice.page
      );
      const row = page?.programs.find(
        (candidate) => candidate.scopeId === choice.scopeId
      );
      return row !== undefined && row.assignmentId === choice.assignmentId;
    }
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
        outcome.role === change.role &&
        outcome.scopeId === change.scopeId &&
        outcome.action === change.action
    )
  );

const hasIneligibleGrant = (
  eligibleForGrant: boolean | undefined,
  choices: ScopedRoleDraft[]
) => eligibleForGrant === false && choices.some((choice) => choice.enabled);

const changeEntries = (choices: ScopedRoleDraft[]) =>
  choices.map((choice) => {
    const scope =
      choice.role === "program_leader"
        ? {
            expectedDepartmentId: choice.expectedDepartmentId,
            role: choice.role,
            scopeId: choice.scopeId,
          }
        : { role: choice.role, scopeId: choice.scopeId };
    if (choice.enabled) {
      return { ...scope, action: "granted" as const };
    }
    if (!choice.assignmentId) {
      throw new Error("A withdrawal needs its reviewed assignment");
    }
    return {
      action: "withdrawn" as const,
      expectedAssignmentId: choice.assignmentId,
      ...scope,
    };
  });

const DutyChoice = ({
  checked,
  disabled,
  onBlur,
  onChange,
  row,
  changed,
  role = "department_manager",
}: {
  changed: boolean;
  checked: boolean;
  disabled: boolean;
  onBlur: () => void;
  onChange: (checked: boolean) => void;
  row: ScopedRoleDepartment | ScopedRoleProgram;
  role?: ScopedRoleDraft["role"];
}) => {
  const id = useId();
  let state = row.assignmentId ? `現任${roleName(role)}` : "未指派";
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
            {`${roleName(role)}：${row.scopeName}`}
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

const ScopedRoleLimitNote = ({
  baseline,
  local,
}: {
  baseline: ScopedRoleBaseline | null;
  local: boolean;
}) =>
  baseline ? (
    <p className="text-meta text-muted-foreground mt-2">
      {local ? (
        "只處理目前聚會的現任職務；其他職務保持不變。"
      ) : (
        <>
          只有部門主管時每次最多 {baseline.changeLimit} 項淨更改；
          包含聚會負責人時最多 {baseline.mixedChangeLimit}{" "}
          項。其他職務保持不變。
        </>
      )}
    </p>
  ) : null;

const restoredDestination = (
  receipt: ScopedRoleChangeReceipt,
  programId: string | undefined,
  targetUserId: string | null,
  returnHref: string,
  fallbackHref: string
) => {
  if (!programId) {
    return fallbackHref;
  }
  const sameContext =
    receipt.targetUserId === targetUserId &&
    receipt.changes.every(
      (change) =>
        change.role === "program_leader" && change.scopeId === programId
    );
  return sameContext ? returnHref : fallbackHref;
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
        <li className="wrap-anywhere" key={draftKey(choice)}>
          {choice.scopeName}：{choice.enabled ? "新增" : "撤回"}
          {roleName(choice.role)}
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

const DepartmentPagination = ({
  baseline,
  restricted,
  editable,
  page,
  onPageChange,
}: {
  baseline: ScopedRoleBaseline | null;
  restricted: boolean;
  editable: boolean;
  page: number;
  onPageChange: (page: number) => Promise<void>;
}) => {
  if (restricted || !baseline) {
    return null;
  }
  return (
    <nav aria-label="部門職務分頁" className="mt-4 flex flex-wrap gap-3">
      <Button
        disabled={!editable || page <= 1}
        onClick={() => onPageChange(page - 1)}
        type="button"
        variant="secondary"
      >
        上一頁部門
      </Button>
      <Button
        disabled={!editable || !baseline.hasNextPage}
        onClick={() => onPageChange(page + 1)}
        type="button"
        variant="secondary"
      >
        下一頁部門
      </Button>
    </nav>
  );
};

interface DepartmentChoicesProps {
  row: ScopedRoleDepartment;
  choices: ScopedRoleDraft[];
  phase: Phase;
  editable: boolean;
  eligibleForGrant: boolean;
  limit: number;
  restricted: boolean;
  programs: ProgramRemote | null;
  onBlur: () => void;
  toggle: (
    row: ScopedRoleDepartment | ScopedRoleProgram,
    enabled: boolean,
    departmentId?: string
  ) => void;
  loadPrograms: (
    departmentId: string,
    page: number,
    choices: ScopedRoleDraft[]
  ) => Promise<void>;
}

const ProgramChoices = ({
  row,
  choices,
  phase,
  editable,
  programs,
  onBlur,
  toggle,
  loadPrograms,
}: Pick<
  DepartmentChoicesProps,
  | "row"
  | "choices"
  | "phase"
  | "editable"
  | "programs"
  | "onBlur"
  | "toggle"
  | "loadPrograms"
>) => (
  <div className="border-border ml-3 border-l pl-4">
    <h3 className="text-body font-medium">聚會負責人</h3>
    {programs ? (
      <>
        {programs.loading ? <p role="status">正在讀取聚會職務…</p> : null}
        {programs.error ? <p role="alert">{programs.error}</p> : null}
        {programs.data?.programs.map((program) => {
          const selected =
            phase === "conflict"
              ? undefined
              : choices.find(
                  (entry) =>
                    entry.role === "program_leader" &&
                    entry.scopeId === program.scopeId
                );
          const atLimit =
            !selected && choices.length >= MIXED_SCOPED_ROLE_CHANGE_LIMIT;
          const grantDenied =
            !selected &&
            !program.assignmentId &&
            !programs.data?.eligibleForGrant;
          return (
            <DutyChoice
              key={program.scopeId}
              role="program_leader"
              row={program}
              changed={Boolean(selected)}
              checked={selected?.enabled ?? Boolean(program.assignmentId)}
              disabled={!editable || atLimit || grantDenied}
              onBlur={onBlur}
              onChange={(enabled) => toggle(program, enabled, row.scopeId)}
            />
          );
        })}
        {programs.data?.programs.length === 0 ? (
          <p role="status">目前沒有可處理的聚會。</p>
        ) : null}
        {programs.page > 1 || programs.data?.hasNextPage ? (
          <nav
            aria-label={`${row.scopeName}聚會職務分頁`}
            className="mt-3 flex flex-wrap gap-3"
          >
            <Button
              variant="secondary"
              type="button"
              disabled={!editable || programs.page <= 1}
              onClick={() =>
                loadPrograms(row.scopeId, programs.page - 1, choices)
              }
            >
              上一頁聚會
            </Button>
            <Button
              variant="secondary"
              type="button"
              disabled={!editable || !programs.data?.hasNextPage}
              onClick={() =>
                loadPrograms(row.scopeId, programs.page + 1, choices)
              }
            >
              下一頁聚會
            </Button>
          </nav>
        ) : null}
      </>
    ) : null}
    {programs && !programs.error ? null : (
      <Button
        variant="secondary"
        type="button"
        className="mt-3"
        disabled={!editable}
        onClick={() => loadPrograms(row.scopeId, 1, choices)}
      >
        {programs ? "重新讀取聚會職務" : `讀取${row.scopeName}的聚會職務`}
      </Button>
    )}
  </div>
);

const DepartmentChoices = (props: DepartmentChoicesProps) => {
  const {
    row,
    choices,
    phase,
    editable,
    eligibleForGrant,
    limit,
    restricted,
    onBlur,
    toggle,
  } = props;
  const choice =
    phase === "conflict"
      ? undefined
      : choices.find(
          (candidate) =>
            candidate.role === "department_manager" &&
            candidate.scopeId === row.scopeId
        );
  const limitReached = !choice && choices.length >= limit;
  const grantDenied = !row.assignmentId && !eligibleForGrant && !choice;
  return (
    <fieldset className="border-border mt-6 border-t pt-4">
      <legend className="text-section wrap-anywhere">{row.scopeName}</legend>
      {restricted ? null : (
        <DutyChoice
          changed={Boolean(choice)}
          checked={choice?.enabled ?? Boolean(row.assignmentId)}
          disabled={!editable || limitReached || grantDenied}
          onBlur={onBlur}
          onChange={(enabled) => toggle(row, enabled)}
          row={row}
        />
      )}
      <ProgramChoices {...props} />
    </fieldset>
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
  programRestriction,
}: {
  actorUserId: string;
  actorKind: "admin" | "role_assigner" | "department_manager";
  authorityAssignmentId: string | null;
  initialPerson: TaskIdentity | null;
  navigation: ReactNode;
  returnHref: string;
  targetUserId: string | null;
  programRestriction: ProgramRestriction | null;
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
  // Security refreshes the server page after confirmation. Equivalent reader
  // props must not restart this task's lifetime and discard its loaded pages.
  const initiallyAuthorized = initialPerson !== null;
  const restrictedDepartmentId = programRestriction?.departmentId;
  const restrictedProgramId = programRestriction?.programId;
  const returnsToProgram =
    returnHref === "/roles/program-leaders" ||
    returnHref.startsWith("/roles/program-leaders?");
  const localProgramId =
    actorKind === "department_manager" ? restrictedProgramId : undefined;
  const operationFamily = localProgramId ? "program-leader" : "scoped-role";
  const neutralHref = localProgramId
    ? "/roles/program-leaders"
    : "/roles/people";
  const [person, setPerson] = useState<TaskIdentity | null>(initialPerson);
  const [phase, setPhase] = useState<Phase>("ready");
  const [remote, setRemote] = useState<{
    data: ScopedRoleBaseline | null;
    error: string | null;
    loading: boolean;
    page: number;
  }>({ data: null, error: null, loading: true, page: 1 });
  const [programRemote, setProgramRemote] = useState<ProgramRemote | null>(
    null
  );
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
      removeRoleOperationReference(operationFamily, actor, prepared);
      preparedOperation.current = null;
    }
  }, [actor, operationFamily]);

  const dispose = useCallback(() => {
    discardPreparedOperation();
    invalidate();
    intent.current = null;
    setPerson(null);
    setRemote({ data: null, error: null, loading: false, page: 1 });
    setProgramRemote(null);
    setPrevious(null);
    setProof(false);
    setPhase("denied");
    router.replace(neutralHref);
  }, [discardPreparedOperation, invalidate, router, neutralHref]);
  const originalScopedOperationsClear = useCallback(() => {
    try {
      const conflict = readConflictingScopedOperationReference(
        operationFamily,
        actor
      );
      if (!conflict) {
        return true;
      }
      setPerson(null);
      setRemote({ data: null, error: null, loading: false, page: 1 });
      setProgramRemote(null);
      setProof(false);
      setPhase("denied");
      const recoveryHref = scopedOperationRecoveryHref(conflict.family);
      router.replace(
        conflict.family === "program-leader-grant-batch" &&
          actorKind !== "department_manager"
          ? `${recoveryHref}&authority=${actorKind}`
          : recoveryHref
      );
    } catch {
      setPerson(null);
      setRemote({ data: null, error: null, loading: false, page: 1 });
      setProgramRemote(null);
      setProof(false);
      setPhase("storage");
      setMessage("無法安全讀取原有職務操作，未有提交。請重新載入後查核。");
    }
    return false;
  }, [actor, actorKind, operationFamily, router]);

  const readSavedOperation = useCallback(() => {
    try {
      const saved = readRoleOperationReference(operationFamily, actor);
      if (saved) {
        return saved;
      }
      return originalScopedOperationsClear() ? null : undefined;
    } catch {
      setPerson(null);
      setRemote({ data: null, error: null, loading: false, page: 1 });
      setProof(false);
      setPhase("storage");
      setMessage(
        "無法安全讀取操作查核記錄，未有提交新的操作。請重新載入後再試。"
      );
    }
  }, [actor, operationFamily, originalScopedOperationsClear]);

  const retainPreparedOperation = (reference: RoleOperationReference) => {
    preparedOperation.current = reference;
    let saved: RoleOperationReference | null | undefined;
    try {
      saved = readRoleOperationReference(operationFamily, actor);
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
    (
      page: Pick<
        ScopedRoleBaseline,
        "actorUserId" | "actorKind" | "authorityAssignmentId"
      >
    ) =>
      page.actorUserId === actor &&
      page.actorKind === actorKind.replaceAll("_", "-") &&
      page.authorityAssignmentId === authorityAssignmentId &&
      readAuthContextMarker() === marker.current,
    [actor, actorKind, authorityAssignmentId]
  );

  const readDepartmentBaseline = useCallback(
    async (page: number, signal: AbortSignal) => {
      if (localProgramId) {
        return getLocalRoleBaseline(actor, localProgramId, signal);
      }
      if (!targetUserId) {
        throw new Error("No editable person selected");
      }
      return await getScopedRoleBaseline(actor, targetUserId, page, signal);
    },
    [actor, localProgramId, targetUserId]
  );
  const readProgramBaseline = useCallback(
    async (departmentId: string, page: number, signal: AbortSignal) => {
      if (!targetUserId) {
        throw new Error("No editable person selected");
      }
      return await (localProgramId
        ? getLocalRoleProgramBaseline(
            actor,
            localProgramId,
            targetUserId,
            departmentId,
            signal
          )
        : getScopedRoleProgramBaseline(
            actor,
            targetUserId,
            departmentId,
            page,
            signal,
            restrictedProgramId
          ));
    },
    [actor, localProgramId, targetUserId, restrictedProgramId]
  );

  const loadPage = useCallback(
    async (page: number, choices: ScopedRoleDraft[]) => {
      const { controller, epoch } = beginRead();
      reading.current = true;
      setRemote({ data: null, error: null, loading: true, page });
      setProgramRemote(null);
      try {
        const data = await readDepartmentBaseline(page, controller.signal);
        if (!isCurrent(epoch, actor)) {
          return;
        }
        if (!sameAuthority(data)) {
          dispose();
          return;
        }
        const relevant = choices.filter(
          (choice) =>
            choice.role === "department_manager" && choice.page === page
        );
        if (!sameReviewedRows(relevant, [data])) {
          setPrevious(choices);
          setProof(false);
          setPhase("conflict");
          setMessage("目前職務已有改變，整批未有儲存。請按最新資料重新選擇。");
        }
        setRemote({ data, error: null, loading: false, page });
      } catch (error) {
        if (!isCurrent(epoch, actor) || controller.signal.aborted) {
          return;
        }
        if (readAuthContextMarker() !== marker.current || denied(error)) {
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
      readDepartmentBaseline,
      isCurrent,
      releaseRead,
      sameAuthority,
    ]
  );

  const loadPrograms = useCallback(
    async (departmentId: string, page: number, choices: ScopedRoleDraft[]) => {
      const { controller, epoch } = beginRead();
      reading.current = true;
      setProgramRemote({
        data: null,
        departmentId,
        error: null,
        loading: true,
        page,
      });
      try {
        const data = await readProgramBaseline(
          departmentId,
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
        const relevant = choices.filter(
          (choice) =>
            choice.role === "program_leader" &&
            choice.expectedDepartmentId === departmentId &&
            choice.page === page
        );
        if (!sameReviewedRows(relevant, [], [data])) {
          setPrevious(choices);
          setProof(false);
          setPhase("conflict");
          setMessage(
            "聚會所屬部門或目前職務已有改變，整批未有儲存。請重新選擇。"
          );
        }
        setProgramRemote({
          data,
          departmentId,
          error: null,
          loading: false,
          page,
        });
      } catch (error) {
        if (!isCurrent(epoch, actor) || controller.signal.aborted) {
          return;
        }
        if (readAuthContextMarker() !== marker.current || denied(error)) {
          dispose();
        } else {
          setProgramRemote({
            data: null,
            departmentId,
            error: "暫時無法讀取聚會職務；未讀取的聚會不能編輯。",
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
      isCurrent,
      releaseRead,
      sameAuthority,
      readProgramBaseline,
    ]
  );

  const verifyContext = useCallback(
    (epoch: number) =>
      verifyActor(
        actor,
        epoch,
        async (signal) => {
          const current = localProgramId
            ? await getLocalRoleBaseline(actor, localProgramId, signal)
            : await searchRolePeople("", 1, signal);
          if (
            current.actorKind.replaceAll("_", "-") !==
              actorKind.replaceAll("_", "-") ||
            current.authorityAssignmentId !== authorityAssignmentId ||
            readAuthContextMarker() !== marker.current
          ) {
            return "";
          }
          return current.actorUserId;
        },
        dispose
      ),
    [
      actor,
      actorKind,
      authorityAssignmentId,
      dispose,
      localProgramId,
      verifyActor,
    ]
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
    } else if (initiallyAuthorized) {
      const loadInitial = async () => {
        await loadPage(1, []);
        if (restrictedDepartmentId && actorUserId.current === actor) {
          await loadPrograms(restrictedDepartmentId, 1, []);
        }
      };
      void loadInitial();
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
    initiallyAuthorized,
    loadPrograms,
    restrictedDepartmentId,
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
    let programPages: ScopedRoleProgramBaseline[] = [];
    const departmentChoices = choices.filter(
      (choice) => choice.role === "department_manager"
    );
    const programChoices = choices.filter(
      (choice) => choice.role === "program_leader"
    );
    const programRequests = [
      ...new Map(
        programChoices.map((choice) => [
          JSON.stringify([choice.expectedDepartmentId, choice.page]),
          choice,
        ])
      ).values(),
    ];
    const pageNumbers = [
      ...new Set(departmentChoices.map((choice) => choice.page)),
    ];
    const verified = await verifyActor(
      actor,
      epoch,
      async (signal) => {
        pages = await Promise.all(
          pageNumbers.map((page) => readDepartmentBaseline(page, signal))
        );
        programPages = await Promise.all(
          programRequests.map((choice) =>
            readProgramBaseline(
              choice.expectedDepartmentId,
              choice.page,
              signal
            )
          )
        );
        return [...pages, ...programPages].every(sameAuthority) ? actor : "";
      },
      dispose
    );
    if (!verified) {
      return null;
    }
    return {
      eligibleForGrant: [...pages, ...programPages].every(
        (page) => page.eligibleForGrant
      ),
      unchanged: sameReviewedRows(choices, pages, programPages),
    };
  };

  const releaseOperation = (reference: RoleOperationReference) => {
    removeRoleOperationReference(
      operationFamily,
      actorUserId.current,
      reference
    );
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
    if (restrictedDepartmentId && actorUserId.current === actor) {
      await loadPrograms(restrictedDepartmentId, 1, []);
    }
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
    if (programRemote && actorUserId.current === actor) {
      await loadPrograms(
        programRemote.departmentId,
        programRemote.page,
        choices
      );
    }
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
      removeRoleOperationReference(operationFamily, actor, reference);
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
    const blocked =
      busy.current || reading.current || proof || Boolean(programRemote?.error);
    if (
      !targetUserId ||
      !canSubmitChoices(choices, phase, blocked, remote.data)
    ) {
      return;
    }
    if (!originalScopedOperationsClear()) {
      return;
    }
    busy.current = true;
    setPhase("pending");
    setMessage("正在儲存整批職務變更…");
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
          operationFamily,
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
      const result = localProgramId
        ? await withdrawLocalProgramRole(actor, localProgramId, input)
        : await changeScopedRoles(actor, input);
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
      const outcome = localProgramId
        ? await reconcileLocalProgramRole(actor, reference.operationKey)
        : await reconcileScopedRoles(actor, reference.operationKey);
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
        : restoredDestination(
            outcome.receipt,
            localProgramId ?? programRestriction?.programId,
            targetUserId,
            returnHref,
            localProgramId
              ? "/roles/program-leaders"
              : `/roles/people?person=${encodeURIComponent(outcome.receipt.targetUserId)}`
          );
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
  const editable =
    phase === "ready" && !proof && !remote.loading && !programRemote?.loading;
  const pending = phase === "pending" || phase === "unknown";
  const reselectReady =
    Boolean(remote.data) &&
    !remote.loading &&
    !programRemote?.loading &&
    !programRemote?.error;

  return (
    <form.Subscribe selector={(state) => state.values.choices}>
      {(choices) => {
        const { data } = remote;
        const dirty = choices.length > 0 && phase === "ready";
        const invalidGrant = hasIneligibleGrant(
          remote.data?.eligibleForGrant,
          choices
        );
        const limit = changeLimit(choices);
        const toggle = (
          row: ScopedRoleDepartment | ScopedRoleProgram,
          enabled: boolean,
          departmentId?: string
        ) => {
          const role = departmentId ? "program_leader" : "department_manager";
          const remaining = choices.filter(
            (choice) => draftKey(choice) !== `${role}:${row.scopeId}`
          );
          if (enabled !== Boolean(row.assignmentId)) {
            remaining.push(
              departmentId
                ? {
                    ...row,
                    enabled,
                    expectedDepartmentId: departmentId,
                    page: programRemote?.page ?? 1,
                    role: "program_leader",
                  }
                : {
                    ...row,
                    enabled,
                    page: remote.page,
                    role: "department_manager",
                  }
            );
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
            ready={Boolean(data) && !programRemote?.error}
            reconcile={reconcile}
            reset={reset}
          />
        ) : null;
        return (
          <RoleTaskFrame
            actions={actions}
            navigation={navigation}
            title="編輯職務"
            returnControl={
              <UnsavedChangesLink
                variant="quiet"
                className="size-11 shrink-0 focus-visible:outline-2"
                description="離開後會清除未提交的職務選擇；原有已提交操作的查核記錄會保留。"
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
                <span className="sr-only">
                  {returnsToProgram ? "返回聚會" : "返回人員權責"}
                </span>
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
                  部門主管、聚會負責人與部門成員資格分開管理。只儲存你已讀取並明確更改的職務。
                </p>
                <ScopedRoleLimitNote
                  baseline={remote.data}
                  local={Boolean(localProgramId)}
                />
                {phase === "conflict" ? (
                  <Button
                    className="mt-4"
                    disabled={!reselectReady}
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
                        {visibleDepartments(
                          programRestriction,
                          programRemote,
                          data
                        ).map((row) => (
                          <DepartmentChoices
                            key={row.scopeId}
                            row={row}
                            choices={field.state.value}
                            phase={phase}
                            editable={editable}
                            eligibleForGrant={Boolean(data?.eligibleForGrant)}
                            limit={limit}
                            restricted={Boolean(programRestriction)}
                            programs={
                              programRemote?.departmentId === row.scopeId
                                ? programRemote
                                : null
                            }
                            onBlur={field.handleBlur}
                            toggle={toggle}
                            loadPrograms={loadPrograms}
                          />
                        ))}
                        {!programRestriction &&
                        remote.data?.departments.length === 0 ? (
                          <p role="status">目前沒有可處理的部門。</p>
                        ) : null}
                      </>
                    )}
                  </form.Field>
                </form>
                <DepartmentPagination
                  baseline={remote.data}
                  restricted={Boolean(programRestriction)}
                  editable={editable}
                  page={remote.page}
                  onPageChange={(page) => loadPage(page, choices)}
                />
                {proof ? (
                  <AccountSecurityForm
                    actorUserId={actor}
                    confirmationExpiresAt={null}
                    temporaryPasswordExpiresAt={null}
                    temporaryPasswordExpired={false}
                    task="confirm"
                    confirmationOnly
                    confirmationContext={proofContext(person, choices)}
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
