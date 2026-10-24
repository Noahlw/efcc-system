"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";

import type {
  ProgramLeaderAssignment,
  ProgramLeaderCandidate,
  ProgramLeaderChange,
  ProgramLeaderPerson,
  ProgramLeaderProgram,
  ProgramLeaderReceipt,
} from "./program-leader-api";
import {
  changeProgramLeader,
  confirmProgramLeaderPassword,
  getProgramLeaderPerson,
  getProgramLeaderPrograms,
  ProgramLeaderApiError,
  reconcileProgramLeaderChange,
  searchProgramLeaderPeople,
} from "./program-leader-api";
import type {
  ProgramLeaderActionDraft,
  ProgramLeaderNotice,
} from "./program-leader-views";
import {
  ProgramLeaderActionReview,
  ProgramLeaderNoticeView,
  ProgramLeaderPendingView,
  ProgramLeaderPersonView,
  ProgramLeaderSearchView,
} from "./program-leader-views";
import {
  readRoleOperationReference,
  removeRoleOperationReference,
  storeRoleOperationReference,
  useRoleCommandLifetime,
} from "./role-command-lifetime";
import type { RoleOperationReference } from "./role-command-lifetime";

const isAbortError = (error: unknown): boolean =>
  error instanceof DOMException && error.name === "AbortError";

const hasStatus = (error: unknown, ...statuses: number[]) =>
  error instanceof ProgramLeaderApiError && statuses.includes(error.status);

const actionLabel = (action: ProgramLeaderReceipt["action"]) =>
  action === "granted" ? "已授予" : "已撤回";

export const ProgramLeaderClient = ({
  initialActorUserId,
}: {
  initialActorUserId: string;
}) => {
  const router = useRouter();
  const lifetime = useRoleCommandLifetime(initialActorUserId);
  const {
    actorUserId,
    beginOperation,
    beginRead,
    cancelRead,
    invalidate,
    isCurrent,
    releaseRead,
    requestEpoch,
    verifyActor: verifyRoleActor,
  } = lifetime;

  const [actorReady, setActorReady] = useState(false);
  const [busy, setBusy] = useState(true);
  const [searchBusy, setSearchBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<ProgramLeaderCandidate[]>([]);
  const [candidatePage, setCandidatePage] = useState(1);
  const [hasMoreCandidates, setHasMoreCandidates] = useState(false);
  const [programs, setPrograms] = useState<ProgramLeaderProgram[]>([]);
  const [programPage, setProgramPage] = useState(1);
  const [hasMorePrograms, setHasMorePrograms] = useState(false);
  const [selectedProgramId, setSelectedProgramId] = useState("");
  const [person, setPerson] = useState<ProgramLeaderPerson | null>(null);
  const [notice, setNotice] = useState<ProgramLeaderNotice | null>(null);
  const [actionDraft, setActionDraft] =
    useState<ProgramLeaderActionDraft | null>(null);
  const [password, setPassword] = useState("");
  const [pendingOperation, setPendingOperation] =
    useState<RoleOperationReference | null>(null);

  const clearVisibleData = useCallback(() => {
    setActorReady(false);
    setBusy(false);
    setSearchBusy(false);
    setQuery("");
    setCandidates([]);
    setCandidatePage(1);
    setHasMoreCandidates(false);
    setPrograms([]);
    setProgramPage(1);
    setHasMorePrograms(false);
    setSelectedProgramId("");
    setPerson(null);
    setActionDraft(null);
    setPassword("");
    setPendingOperation(null);
    setNotice(null);
  }, []);

  const disposeForActorChange = useCallback(
    (text = "登入帳戶或管理權限已改變，本頁資料及操作草稿已清除。") => {
      invalidate();
      clearVisibleData();
      setNotice({ kind: "alert", text });
      router.refresh();
    },
    [clearVisibleData, invalidate, router]
  );

  const lockUntilRechecked = useCallback(
    (text = "暫時未能確認登入狀態，本頁資料已隱藏。請重新載入。") => {
      invalidate();
      clearVisibleData();
      setNotice({ kind: "alert", text });
    },
    [clearVisibleData, invalidate]
  );

  const verifyActor = useCallback(
    async (expectedActor: string, epoch: number): Promise<boolean> => {
      try {
        return await verifyRoleActor(
          expectedActor,
          epoch,
          async (signal) => {
            const current = await searchProgramLeaderPeople("", 1, signal);
            return current.actorUserId;
          },
          () =>
            disposeForActorChange("登入帳戶已轉換，本頁資料及操作草稿已清除。")
        );
      } catch (error) {
        if (isAbortError(error) || requestEpoch.current !== epoch) {
          return false;
        }
        if (hasStatus(error, 401, 403)) {
          disposeForActorChange(
            "目前登入狀態或管理權限已改變，本頁資料及操作草稿已清除。"
          );
        } else {
          lockUntilRechecked();
        }
        return false;
      }
    },
    [disposeForActorChange, lockUntilRechecked, requestEpoch, verifyRoleActor]
  );

  useEffect(() => {
    actorUserId.current = initialActorUserId;
    const { controller, epoch } = beginRead();
    setBusy(true);
    setActorReady(false);
    setNotice({ kind: "status", text: "正在載入聚會…" });

    const initialize = async () => {
      try {
        const identity = await searchProgramLeaderPeople(
          "",
          1,
          controller.signal
        );
        if (requestEpoch.current !== epoch) {
          return;
        }
        if (identity.actorUserId !== initialActorUserId) {
          disposeForActorChange("登入帳戶已轉換，本頁資料及操作草稿已清除。");
          return;
        }

        const firstPrograms = await getProgramLeaderPrograms(
          1,
          controller.signal
        );
        if (
          requestEpoch.current !== epoch ||
          !(await verifyActor(initialActorUserId, epoch))
        ) {
          return;
        }

        const pending = readRoleOperationReference(
          "program-leader",
          initialActorUserId
        );
        setPrograms(firstPrograms.programs);
        setProgramPage(firstPrograms.page);
        setHasMorePrograms(firstPrograms.hasNextPage);
        setPendingOperation(pending);
        setActorReady(true);
        setNotice(
          pending
            ? {
                kind: "status",
                text: "上一項操作結果未確定。請查核結果後再開始其他操作。",
              }
            : null
        );
      } catch (error) {
        if (isAbortError(error) || requestEpoch.current !== epoch) {
          return;
        }
        if (hasStatus(error, 401, 403)) {
          disposeForActorChange(
            "目前登入狀態或管理權限已改變，本頁資料及操作草稿已清除。"
          );
        } else {
          lockUntilRechecked("聚會資料暫時無法載入，請重新載入後再試。");
        }
      } finally {
        if (requestEpoch.current === epoch) {
          setBusy(false);
          releaseRead(controller);
        }
      }
    };

    void initialize();
    return () => cancelRead(controller, epoch);
  }, [
    beginRead,
    cancelRead,
    disposeForActorChange,
    initialActorUserId,
    lockUntilRechecked,
    releaseRead,
    requestEpoch,
    verifyActor,
    actorUserId,
  ]);

  const probeCurrentActor = useCallback(async () => {
    const expectedActor = actorUserId.current;
    if (!actorReady || !expectedActor) {
      return;
    }
    await verifyActor(expectedActor, requestEpoch.current);
  }, [actorReady, actorUserId, requestEpoch, verifyActor]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void probeCurrentActor();
      }
    };
    window.addEventListener("focus", probeCurrentActor);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("focus", probeCurrentActor);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [probeCurrentActor]);

  const beginReadRequest = () => {
    const { controller, epoch } = beginRead();
    setBusy(true);
    return { controller, epoch };
  };

  const beginRoleOperation = () => {
    setBusy(true);
    return beginOperation();
  };

  const runSearch = async (pageNumber: number) => {
    const expectedActor = actorUserId.current;
    if (!actorReady || !expectedActor || busy || !query.trim()) {
      return;
    }
    const { controller, epoch } = beginReadRequest();
    setSearchBusy(true);
    if (pageNumber === 1) {
      setCandidates([]);
      setHasMoreCandidates(false);
    }
    setNotice({ kind: "status", text: "正在搜尋人士…" });
    try {
      const result = await searchProgramLeaderPeople(
        query.trim(),
        pageNumber,
        controller.signal
      );
      if (!isCurrent(epoch, expectedActor)) {
        return;
      }
      if (result.actorUserId !== expectedActor) {
        disposeForActorChange("登入帳戶已轉換，本頁資料及操作草稿已清除。");
        return;
      }
      if (!(await verifyActor(expectedActor, epoch))) {
        return;
      }
      setCandidates((current) =>
        pageNumber === 1
          ? result.candidates
          : [...current, ...result.candidates]
      );
      setCandidatePage(result.page);
      setHasMoreCandidates(result.hasNextPage);
      setNotice(
        result.candidates.length === 0 && pageNumber === 1
          ? { kind: "status", text: "沒有找到符合的人士。" }
          : null
      );
    } catch (error) {
      if (isAbortError(error) || !isCurrent(epoch, expectedActor)) {
        return;
      }
      if (!(await verifyActor(expectedActor, epoch))) {
        return;
      }
      setNotice({
        kind: "alert",
        text: hasStatus(error, 400)
          ? "搜尋資料格式不正確，請修改後再試。"
          : "服務暫時無法使用，請稍後重試。",
      });
    } finally {
      if (isCurrent(epoch, expectedActor)) {
        setSearchBusy(false);
        setBusy(false);
        releaseRead(controller);
      }
    }
  };

  const loadPerson = async (targetUserId: string, assignmentPage = 1) => {
    const expectedActor = actorUserId.current;
    if (!actorReady || !expectedActor || busy) {
      return;
    }
    const { controller, epoch } = beginReadRequest();
    setNotice({ kind: "status", text: "正在載入人士資料…" });
    try {
      const result = await getProgramLeaderPerson(
        targetUserId,
        assignmentPage,
        controller.signal
      );
      if (
        !isCurrent(epoch, expectedActor) ||
        !(await verifyActor(expectedActor, epoch))
      ) {
        return;
      }
      setPerson((current) =>
        assignmentPage > 1 && current?.userId === result.person.userId
          ? {
              ...result.person,
              assignments: [
                ...current.assignments,
                ...result.person.assignments,
              ],
            }
          : result.person
      );
      setActionDraft(null);
      setPassword("");
      setNotice(
        result.person.assignments.length === 0 && assignmentPage === 1
          ? {
              kind: "status",
              text: result.person.eligibleForGrant
                ? "此人士目前沒有 Program Leader 職務。"
                : "此人士目前沒有 Program Leader 職務，亦未符合新增條件。",
            }
          : null
      );
    } catch (error) {
      if (isAbortError(error) || !isCurrent(epoch, expectedActor)) {
        return;
      }
      if (!(await verifyActor(expectedActor, epoch))) {
        return;
      }
      setPerson(null);
      setNotice({
        kind: hasStatus(error, 404) ? "status" : "alert",
        text: hasStatus(error, 404)
          ? "此人士目前不在可管理的範圍內，或資料已改變。"
          : "未能載入人士資料，請稍後重試。",
      });
    } finally {
      if (isCurrent(epoch, expectedActor)) {
        setBusy(false);
        releaseRead(controller);
      }
    }
  };

  const loadMorePrograms = async () => {
    const expectedActor = actorUserId.current;
    if (!actorReady || !expectedActor || busy || !hasMorePrograms) {
      return;
    }
    const { controller, epoch } = beginReadRequest();
    try {
      const result = await getProgramLeaderPrograms(
        programPage + 1,
        controller.signal
      );
      if (
        !isCurrent(epoch, expectedActor) ||
        !(await verifyActor(expectedActor, epoch))
      ) {
        return;
      }
      setPrograms((current) => [...current, ...result.programs]);
      setProgramPage(result.page);
      setHasMorePrograms(result.hasNextPage);
      setNotice(null);
    } catch (error) {
      if (isAbortError(error) || !isCurrent(epoch, expectedActor)) {
        return;
      }
      if (await verifyActor(expectedActor, epoch)) {
        setNotice({ kind: "alert", text: "未能載入更多聚會，請稍後重試。" });
      }
    } finally {
      if (isCurrent(epoch, expectedActor)) {
        setBusy(false);
        releaseRead(controller);
      }
    }
  };

  const loadMoreAssignments = async () => {
    if (person?.assignmentPage.hasNextPage) {
      await loadPerson(person.userId, person.assignmentPage.number + 1);
    }
  };

  const beginGrant = () => {
    const program = programs.find((item) => item.id === selectedProgramId);
    if (!person || !program || !person.eligibleForGrant || pendingOperation) {
      setNotice({ kind: "alert", text: "請先選擇符合條件的人士及聚會。" });
      return;
    }
    if (
      person.assignments.some((assignment) => assignment.scopeId === program.id)
    ) {
      setNotice({ kind: "status", text: "此人士已負責該聚會。" });
      return;
    }
    setActionDraft({
      action: "granted",
      scopeId: program.id,
      scopeName: `${program.departmentName} · ${program.name}`,
    });
    setPassword("");
    setNotice(null);
  };

  const beginWithdrawal = (assignment: ProgramLeaderAssignment) => {
    if (pendingOperation) {
      setNotice({
        kind: "alert",
        text: "請先查核上一項操作，確認結果後再開始其他操作。",
      });
      return;
    }
    setActionDraft({ action: "withdrawn", assignment });
    setPassword("");
    setNotice(null);
  };

  const settlePendingOperation = (operation: RoleOperationReference) => {
    if (actorUserId.current !== operation.actorUserId) {
      return;
    }
    removeRoleOperationReference(
      "program-leader",
      actorUserId.current,
      operation
    );
    setPendingOperation((current) =>
      current?.actorUserId === operation.actorUserId &&
      current.operationKey === operation.operationKey
        ? null
        : current
    );
  };

  const verifyCurrentActor = (expectedActor: string, epoch: number) =>
    isCurrent(epoch, expectedActor)
      ? verifyActor(expectedActor, epoch)
      : Promise.resolve(false);

  const refreshPerson = async (targetUserId: string, expectedActor: string) => {
    const { controller, epoch } = beginReadRequest();
    try {
      const result = await getProgramLeaderPerson(
        targetUserId,
        1,
        controller.signal
      );
      if (
        isCurrent(epoch, expectedActor) &&
        (await verifyActor(expectedActor, epoch))
      ) {
        setPerson(result.person);
      }
    } catch {
      if (
        isCurrent(epoch, expectedActor) &&
        (await verifyActor(expectedActor, epoch))
      ) {
        setNotice({
          kind: "status",
          text: "操作已完成，但未能更新人士資料；請重新查閱。",
        });
      }
    } finally {
      if (isCurrent(epoch, expectedActor)) {
        setBusy(false);
        releaseRead(controller);
      }
    }
  };

  const applyReceipt = async (
    receipt: ProgramLeaderReceipt,
    expectedActor: string,
    epoch: number,
    operation: RoleOperationReference
  ) => {
    if (!isCurrent(epoch, expectedActor)) {
      return;
    }
    settlePendingOperation(operation);
    setActionDraft(null);
    setNotice({
      kind: "status",
      text: `${actionLabel(receipt.action)}「${receipt.scopeName}」的 Program Leader 職務。`,
    });
    const selectedUserId = person?.userId;
    setPerson(null);
    if (selectedUserId === receipt.targetUserId) {
      await refreshPerson(selectedUserId, expectedActor);
    }
  };

  const handleActionFailure = async (
    error: unknown,
    commandSent: boolean,
    expectedActor: string,
    epoch: number,
    operation: RoleOperationReference | null,
    selectedAction: ProgramLeaderActionDraft
  ) => {
    if (!isCurrent(epoch, expectedActor)) {
      return;
    }
    if (!commandSent || !operation) {
      if (await verifyCurrentActor(expectedActor, epoch)) {
        setNotice({
          kind: "alert",
          text: hasStatus(error, 401, 403)
            ? "目前密碼或登入權限未能確認，請重新輸入後再試。"
            : "未能確認目前密碼，請檢查後再試。",
        });
      }
      return;
    }
    if (!(await verifyCurrentActor(expectedActor, epoch))) {
      return;
    }
    if (hasStatus(error, 400, 409)) {
      settlePendingOperation(operation);
      setActionDraft(hasStatus(error, 409) ? null : selectedAction);
      setNotice({
        kind: "alert",
        text: hasStatus(error, 409)
          ? "資料已改變，操作未完成；請重新查閱後再確認。"
          : "操作資料不正確，請重新檢查人士、聚會及目前密碼。",
      });
      return;
    }
    setActionDraft(null);
    setNotice({
      kind: "status",
      text: "操作結果未能確認。不要重複提交，請查核操作結果。",
    });
  };

  const submitAction = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const expectedActor = actorUserId.current;
    const selectedPerson = person;
    const selectedAction = actionDraft;
    if (
      !actorReady ||
      !expectedActor ||
      !selectedPerson ||
      !selectedAction ||
      !password ||
      pendingOperation ||
      busy
    ) {
      return;
    }
    const passwordValue = password;
    const epoch = beginRoleOperation();
    setPassword("");
    setNotice({ kind: "status", text: "正在確認目前密碼…" });
    let commandSent = false;
    let operation: RoleOperationReference | null = null;
    try {
      if (!(await verifyCurrentActor(expectedActor, epoch))) {
        return;
      }
      await confirmProgramLeaderPassword(crypto.randomUUID(), passwordValue);
      // The proof POST is unabortable; recheck actor before dispatching the role command.
      if (!(await verifyCurrentActor(expectedActor, epoch))) {
        return;
      }

      const operationKey = crypto.randomUUID();
      operation = { actorUserId: expectedActor, operationKey };
      storeRoleOperationReference(
        "program-leader",
        actorUserId.current,
        operation
      );
      setPendingOperation(operation);
      const input: ProgramLeaderChange =
        selectedAction.action === "granted"
          ? {
              action: "granted",
              operationKey,
              scopeId: selectedAction.scopeId,
              targetUserId: selectedPerson.userId,
            }
          : {
              action: "withdrawn",
              expectedAssignmentId: selectedAction.assignment.assignmentId,
              operationKey,
              scopeId: selectedAction.assignment.scopeId,
              targetUserId: selectedPerson.userId,
            };
      commandSent = true;
      const { receipt } = await changeProgramLeader(input);
      if (!(await verifyCurrentActor(expectedActor, epoch))) {
        return;
      }
      if (
        receipt.action !== selectedAction.action ||
        receipt.scopeId !== input.scopeId ||
        receipt.targetUserId !== selectedPerson.userId
      ) {
        setActionDraft(null);
        setNotice({
          kind: "status",
          text: "操作結果未能確認。請查核操作結果，不要重複提交。",
        });
        return;
      }
      await applyReceipt(receipt, expectedActor, epoch, operation);
    } catch (error) {
      await handleActionFailure(
        error,
        commandSent,
        expectedActor,
        epoch,
        operation,
        selectedAction
      );
    } finally {
      if (isCurrent(epoch, expectedActor)) {
        setPassword("");
        setBusy(false);
      }
    }
  };

  const applyReconciliation = async (
    receipt: ProgramLeaderReceipt,
    expectedActor: string,
    epoch: number,
    operation: RoleOperationReference
  ) => {
    if (!isCurrent(epoch, expectedActor)) {
      return;
    }
    settlePendingOperation(operation);
    setNotice({
      kind: "status",
      text: `${actionLabel(receipt.action)}「${receipt.scopeName}」的 Program Leader 職務。`,
    });
    const selectedUserId = person?.userId;
    setPerson(null);
    if (selectedUserId === receipt.targetUserId) {
      await refreshPerson(selectedUserId, expectedActor);
    }
  };

  const reconcile = async () => {
    const expectedActor = actorUserId.current;
    const operation = pendingOperation;
    if (
      !actorReady ||
      !expectedActor ||
      !operation ||
      operation.actorUserId !== expectedActor ||
      busy
    ) {
      return;
    }
    const epoch = beginRoleOperation();
    setNotice({ kind: "status", text: "正在查核操作結果…" });
    try {
      if (!(await verifyCurrentActor(expectedActor, epoch))) {
        return;
      }
      const result = await reconcileProgramLeaderChange(operation.operationKey);
      if (!(await verifyCurrentActor(expectedActor, epoch))) {
        return;
      }
      if (result.outcome === "committed" && result.receipt) {
        await applyReconciliation(
          result.receipt,
          expectedActor,
          epoch,
          operation
        );
      } else {
        setNotice({
          kind: "status",
          text: "伺服器仍未能確認結果。請稍後再次查核。",
        });
      }
    } catch (error) {
      if (
        isCurrent(epoch, expectedActor) &&
        (await verifyCurrentActor(expectedActor, epoch))
      ) {
        setNotice({
          kind: hasStatus(error, 409) ? "alert" : "status",
          text: "暫時未能查核操作結果；操作仍未確定，請稍後再試。",
        });
      }
    } finally {
      if (isCurrent(epoch, expectedActor)) {
        setBusy(false);
      }
    }
  };

  const cancelReview = () => {
    setActionDraft(null);
    setPassword("");
    setNotice(null);
  };

  return (
    <>
      <section
        aria-busy={!actorReady || busy}
        aria-label="Program Leader 管理"
        className="space-y-6"
      >
        <ProgramLeaderNoticeView notice={notice} />
        {pendingOperation ? (
          <ProgramLeaderPendingView busy={busy} onReconcile={reconcile} />
        ) : null}
        <ProgramLeaderSearchView
          busy={!actorReady || busy || Boolean(pendingOperation)}
          candidates={candidates}
          hasMore={hasMoreCandidates}
          onMore={() => runSearch(candidatePage + 1)}
          onQueryChange={setQuery}
          onSearch={async (event) => {
            event.preventDefault();
            await runSearch(1);
          }}
          onSelect={async (userId) => {
            await loadPerson(userId);
          }}
          query={query}
          searchBusy={searchBusy}
        />
        {person ? (
          <ProgramLeaderPersonView
            busy={!actorReady || busy}
            hasMoreAssignments={person.assignmentPage.hasNextPage}
            hasMorePrograms={hasMorePrograms}
            onGrant={beginGrant}
            onMoreAssignments={loadMoreAssignments}
            onMorePrograms={loadMorePrograms}
            onProgramChange={setSelectedProgramId}
            onWithdraw={beginWithdrawal}
            pending={Boolean(pendingOperation)}
            person={person}
            programs={programs}
            selectedProgramId={selectedProgramId}
          />
        ) : null}
        {person && actionDraft ? (
          <ProgramLeaderActionReview
            busy={!actorReady || busy}
            onCancel={cancelReview}
            onPasswordChange={setPassword}
            onSubmit={async (event) => {
              await submitAction(event);
            }}
            password={password}
            personName={person.fullName}
            review={actionDraft}
          />
        ) : null}
      </section>
    </>
  );
};
