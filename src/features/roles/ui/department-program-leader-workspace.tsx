"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";

import {
  DepartmentProgramLeaderCandidateView,
  DepartmentProgramLeaderNoticeView,
  DepartmentProgramLeaderReviewView,
  DepartmentProgramLeaderRosterView,
  DepartmentProgramLeaderScopeView,
} from "./department-program-leader-workspace-views";
import type {
  ProgramLeaderCandidate,
  ProgramLeaderChange,
  ProgramLeaderDepartmentPage,
  ProgramLeaderProgram,
  ProgramLeaderReceipt,
  ProgramLeaderRosterPage,
} from "./program-leader-api";
import {
  changeProgramLeader,
  confirmProgramLeaderPassword,
  getProgramLeaderCandidates,
  getProgramLeaderDepartments,
  getProgramLeaderPrograms,
  getProgramLeaderRoster,
  ProgramLeaderApiError,
  reconcileProgramLeaderChange,
} from "./program-leader-api";
import { ProgramLeaderPendingView } from "./program-leader-views";
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

const errorText = (error: unknown, fallback: string) =>
  error instanceof ProgramLeaderApiError ? error.message : fallback;

export const DepartmentProgramLeaderWorkspace = ({
  initialActorUserId,
}: {
  initialActorUserId: string;
}) => {
  const router = useRouter();
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
  } = useRoleCommandLifetime(initialActorUserId);

  const [busy, setBusy] = useState(true);
  const [searchBusy, setSearchBusy] = useState(false);
  const [departments, setDepartments] = useState<
    ProgramLeaderDepartmentPage["departments"]
  >([]);
  const [departmentPage, setDepartmentPage] = useState(1);
  const [hasMoreDepartments, setHasMoreDepartments] = useState(false);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState("");
  const [programs, setPrograms] = useState<ProgramLeaderProgram[]>([]);
  const [programPage, setProgramPage] = useState(1);
  const [hasMorePrograms, setHasMorePrograms] = useState(false);
  const [authorityAssignmentId, setAuthorityAssignmentId] = useState("");
  const [selectedProgramId, setSelectedProgramId] = useState("");
  const [roster, setRoster] = useState<ProgramLeaderRosterPage["leaders"]>([]);
  const [rosterPage, setRosterPage] = useState(1);
  const [hasMoreRoster, setHasMoreRoster] = useState(false);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<ProgramLeaderCandidate[]>([]);
  const [candidatePage, setCandidatePage] = useState(1);
  const [hasMoreCandidates, setHasMoreCandidates] = useState(false);
  const [selectedCandidateId, setSelectedCandidateId] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [pendingOperation, setPendingOperation] =
    useState<RoleOperationReference | null>(null);
  const [notice, setNotice] = useState<{
    kind: "alert" | "status";
    text: string;
  } | null>(null);

  const clearVisibleData = useCallback(() => {
    setBusy(false);
    setSearchBusy(false);
    setDepartments([]);
    setDepartmentPage(1);
    setHasMoreDepartments(false);
    setSelectedDepartmentId("");
    setPrograms([]);
    setProgramPage(1);
    setHasMorePrograms(false);
    setAuthorityAssignmentId("");
    setSelectedProgramId("");
    setRoster([]);
    setRosterPage(1);
    setHasMoreRoster(false);
    setQuery("");
    setCandidates([]);
    setCandidatePage(1);
    setHasMoreCandidates(false);
    setSelectedCandidateId("");
    setReviewOpen(false);
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

  const actorMatches = useCallback(
    (receivedActorUserId: string, epoch: number) => {
      if (!isCurrent(epoch, initialActorUserId)) {
        return false;
      }
      if (receivedActorUserId !== initialActorUserId) {
        disposeForActorChange("登入帳戶已轉換，本頁資料及操作草稿已清除。");
        return false;
      }
      return true;
    },
    [disposeForActorChange, initialActorUserId, isCurrent]
  );

  const verifyActor = useCallback(
    async (expectedActor: string, epoch: number): Promise<boolean> => {
      try {
        return await verifyRoleActor(
          expectedActor,
          epoch,
          async (signal) => {
            const current = await getProgramLeaderDepartments(1, signal);
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
    setNotice({ kind: "status", text: "正在載入管理部門…" });

    const loadDepartments = async () => {
      try {
        const result = await getProgramLeaderDepartments(1, controller.signal);
        if (!actorMatches(result.actorUserId, epoch)) {
          return;
        }
        setDepartments(result.departments);
        setDepartmentPage(result.page);
        setHasMoreDepartments(result.hasNextPage);
        const pending = readRoleOperationReference(
          "program-leader",
          initialActorUserId
        );
        setPendingOperation(pending);
        setNotice(
          pending
            ? {
                kind: "status",
                text: "上一項操作結果未能確認。請查核結果後再開始其他操作。",
              }
            : null
        );
      } catch (error) {
        if (isAbortError(error) || !isCurrent(epoch, initialActorUserId)) {
          return;
        }
        if (hasStatus(error, 401, 403)) {
          disposeForActorChange(
            "目前登入狀態或管理權限已改變，本頁資料及操作草稿已清除。"
          );
        } else {
          lockUntilRechecked(
            "無法安全讀取操作查核記錄或部門資料，請重新載入後再試。"
          );
        }
      } finally {
        releaseRead(controller);
        if (isCurrent(epoch, initialActorUserId)) {
          setBusy(false);
        }
      }
    };

    void loadDepartments();
    return () => cancelRead(controller, epoch);
  }, [
    actorMatches,
    beginRead,
    cancelRead,
    disposeForActorChange,
    initialActorUserId,
    isCurrent,
    lockUntilRechecked,
    releaseRead,
  ]);

  const probeCurrentActor = useCallback(async () => {
    const expectedActor = actorUserId.current;
    if (!expectedActor) {
      return;
    }
    await verifyActor(expectedActor, requestEpoch.current);
  }, [actorUserId, requestEpoch, verifyActor]);

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

  const loadMoreDepartments = useCallback(async () => {
    const page = departmentPage + 1;
    const { controller, epoch } = beginRead();
    setBusy(true);
    try {
      const result = await getProgramLeaderDepartments(page, controller.signal);
      if (!actorMatches(result.actorUserId, epoch)) {
        return;
      }
      setDepartments((current) => [...current, ...result.departments]);
      setDepartmentPage(result.page);
      setHasMoreDepartments(result.hasNextPage);
      setNotice(null);
    } catch (error) {
      if (!isAbortError(error) && isCurrent(epoch, initialActorUserId)) {
        if (hasStatus(error, 401, 403)) {
          disposeForActorChange();
        } else {
          setNotice({
            kind: "alert",
            text: errorText(error, "暫時未能載入更多部門。"),
          });
        }
      }
    } finally {
      releaseRead(controller);
      if (isCurrent(epoch, initialActorUserId)) {
        setBusy(false);
      }
    }
  }, [
    actorMatches,
    beginRead,
    departmentPage,
    disposeForActorChange,
    initialActorUserId,
    isCurrent,
    releaseRead,
  ]);

  const loadPrograms = useCallback(
    async (departmentId: string, page: number, append: boolean) => {
      if (!departmentId) {
        return;
      }
      const { controller, epoch } = beginRead();
      setBusy(true);
      setNotice({ kind: "status", text: "正在載入聚會…" });
      try {
        const result = await getProgramLeaderPrograms(
          page,
          departmentId,
          controller.signal
        );
        if (!actorMatches(result.actorUserId ?? "", epoch)) {
          return;
        }
        if (!result.authorityAssignmentId) {
          lockUntilRechecked("部門管理權限已改變，資料已隱藏。請重新載入。");
          return;
        }
        setAuthorityAssignmentId(result.authorityAssignmentId);
        setPrograms((current) =>
          append ? [...current, ...result.programs] : result.programs
        );
        setProgramPage(result.page);
        setHasMorePrograms(result.hasNextPage);
        setNotice(null);
      } catch (error) {
        if (!isAbortError(error) && isCurrent(epoch, initialActorUserId)) {
          if (hasStatus(error, 401, 403)) {
            disposeForActorChange();
          } else {
            setNotice({
              kind: "alert",
              text: errorText(error, "暫時未能載入聚會，請稍後重試。"),
            });
          }
        }
      } finally {
        releaseRead(controller);
        if (isCurrent(epoch, initialActorUserId)) {
          setBusy(false);
        }
      }
    },
    [
      actorMatches,
      beginRead,
      disposeForActorChange,
      initialActorUserId,
      isCurrent,
      lockUntilRechecked,
      releaseRead,
    ]
  );

  const onDepartmentChange = useCallback(
    (departmentId: string) => {
      setSelectedDepartmentId(departmentId);
      setPrograms([]);
      setProgramPage(1);
      setHasMorePrograms(false);
      setAuthorityAssignmentId("");
      setSelectedProgramId("");
      setRoster([]);
      setRosterPage(1);
      setHasMoreRoster(false);
      setCandidates([]);
      setCandidatePage(1);
      setHasMoreCandidates(false);
      setSelectedCandidateId("");
      setReviewOpen(false);
      if (departmentId) {
        void loadPrograms(departmentId, 1, false);
      } else {
        setBusy(false);
        setNotice(null);
      }
    },
    [loadPrograms]
  );

  const loadMorePrograms = useCallback(
    () => loadPrograms(selectedDepartmentId, programPage + 1, true),
    [loadPrograms, programPage, selectedDepartmentId]
  );

  const loadRoster = useCallback(
    async (
      programId: string,
      page: number,
      append: boolean,
      successNotice?: string
    ) => {
      if (!programId) {
        return;
      }
      const expectedAuthorityAssignmentId = authorityAssignmentId;
      const { controller, epoch } = beginRead();
      setBusy(true);
      setNotice({ kind: "status", text: "正在載入現任職務…" });
      try {
        const result = await getProgramLeaderRoster(
          programId,
          page,
          controller.signal
        );
        if (!actorMatches(result.actorUserId, epoch)) {
          return;
        }
        if (
          !expectedAuthorityAssignmentId ||
          result.authorityAssignmentId !== expectedAuthorityAssignmentId
        ) {
          lockUntilRechecked("部門管理權限已改變，資料已隱藏。請重新載入。");
          return;
        }
        setRoster((current) =>
          append ? [...current, ...result.leaders] : result.leaders
        );
        setRosterPage(result.page);
        setHasMoreRoster(result.hasNextPage);
        setNotice(
          successNotice ? { kind: "status", text: successNotice } : null
        );
      } catch (error) {
        if (!isAbortError(error) && isCurrent(epoch, initialActorUserId)) {
          if (hasStatus(error, 401, 403)) {
            disposeForActorChange();
          } else {
            setNotice({
              kind: "alert",
              text: errorText(error, "暫時未能載入現任職務，請稍後重試。"),
            });
          }
        }
      } finally {
        releaseRead(controller);
        if (isCurrent(epoch, initialActorUserId)) {
          setBusy(false);
        }
      }
    },
    [
      actorMatches,
      authorityAssignmentId,
      beginRead,
      disposeForActorChange,
      initialActorUserId,
      isCurrent,
      lockUntilRechecked,
      releaseRead,
    ]
  );

  const onProgramChange = useCallback(
    (programId: string) => {
      setSelectedProgramId(programId);
      setRoster([]);
      setRosterPage(1);
      setHasMoreRoster(false);
      setQuery("");
      setCandidates([]);
      setCandidatePage(1);
      setHasMoreCandidates(false);
      setSelectedCandidateId("");
      setReviewOpen(false);
      if (programId) {
        void loadRoster(programId, 1, false);
      } else {
        setBusy(false);
        setNotice(null);
      }
    },
    [loadRoster]
  );

  const loadMoreRoster = useCallback(
    () => loadRoster(selectedProgramId, rosterPage + 1, true),
    [loadRoster, rosterPage, selectedProgramId]
  );

  const loadCandidates = useCallback(
    async (page: number, append: boolean) => {
      if (!selectedProgramId || !query.trim()) {
        return;
      }
      const expectedAuthorityAssignmentId = authorityAssignmentId;
      const { controller, epoch } = beginRead();
      setBusy(true);
      setSearchBusy(true);
      setSelectedCandidateId("");
      setReviewOpen(false);
      setNotice({ kind: "status", text: "正在搜尋同部門 Member…" });
      try {
        const result = await getProgramLeaderCandidates(
          selectedProgramId,
          query,
          page,
          controller.signal
        );
        if (!actorMatches(result.actorUserId, epoch)) {
          return;
        }
        if (
          !expectedAuthorityAssignmentId ||
          result.authorityAssignmentId !== expectedAuthorityAssignmentId
        ) {
          lockUntilRechecked("部門管理權限已改變，資料已隱藏。請重新載入。");
          return;
        }
        setCandidates((current) =>
          append ? [...current, ...result.candidates] : result.candidates
        );
        setCandidatePage(result.page);
        setHasMoreCandidates(result.hasNextPage);
        setNotice(null);
      } catch (error) {
        if (!isAbortError(error) && isCurrent(epoch, initialActorUserId)) {
          if (hasStatus(error, 401, 403)) {
            disposeForActorChange();
          } else {
            setCandidates([]);
            setNotice({
              kind: "alert",
              text: errorText(error, "暫時未能搜尋同部門 Member。"),
            });
          }
        }
      } finally {
        releaseRead(controller);
        if (isCurrent(epoch, initialActorUserId)) {
          setBusy(false);
          setSearchBusy(false);
        }
      }
    },
    [
      actorMatches,
      authorityAssignmentId,
      beginRead,
      disposeForActorChange,
      initialActorUserId,
      isCurrent,
      lockUntilRechecked,
      query,
      releaseRead,
      selectedProgramId,
    ]
  );

  const onSearch = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void loadCandidates(1, false);
    },
    [loadCandidates]
  );

  const loadMoreCandidates = useCallback(
    () => loadCandidates(candidatePage + 1, true),
    [candidatePage, loadCandidates]
  );

  const selectedDepartment = departments.find(
    (department) => department.id === selectedDepartmentId
  );
  const selectedProgram = programs.find(
    (program) => program.id === selectedProgramId
  );
  const reviewCandidate = candidates.find(
    (candidate) => candidate.userId === selectedCandidateId
  );

  const openReview = useCallback(() => {
    if (
      !reviewCandidate ||
      !selectedDepartment ||
      !selectedProgram ||
      !authorityAssignmentId ||
      pendingOperation
    ) {
      setNotice({
        kind: "alert",
        text: "請重新選擇目前部門、聚會及同部門 Member。",
      });
      return;
    }
    setReviewOpen(true);
  }, [
    authorityAssignmentId,
    reviewCandidate,
    selectedDepartment,
    selectedProgram,
    pendingOperation,
  ]);

  const settlePendingOperation = useCallback(
    (operation: RoleOperationReference) => {
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
    },
    [actorUserId]
  );

  const applyReceipt = useCallback(
    async (
      receipt: ProgramLeaderReceipt,
      expectedActor: string,
      epoch: number,
      operation: RoleOperationReference
    ) => {
      if (!isCurrent(epoch, expectedActor)) {
        return;
      }
      settlePendingOperation(operation);
      setReviewOpen(false);
      setPassword("");
      setSelectedCandidateId("");
      const actionText = receipt.action === "granted" ? "已授予" : "已撤回";
      const message = `${actionText}「${receipt.scopeName}」的 Program Leader 職務。`;
      if (selectedProgramId === receipt.scopeId) {
        await loadRoster(selectedProgramId, 1, false, message);
      } else {
        setNotice({ kind: "status", text: message });
      }
    },
    [isCurrent, loadRoster, selectedProgramId, settlePendingOperation]
  );

  const handleGrantFailure = useCallback(
    async (
      error: unknown,
      commandSent: boolean,
      expectedActor: string,
      epoch: number,
      operation: RoleOperationReference | null
    ) => {
      if (
        !isCurrent(epoch, expectedActor) ||
        !(await verifyActor(expectedActor, epoch))
      ) {
        return;
      }
      if (!commandSent || !operation) {
        setNotice({
          kind: "alert",
          text: hasStatus(error, 401, 403)
            ? "目前密碼或登入權限未能確認，請重新輸入後再試。"
            : "未能確認目前密碼，請檢查後再試。",
        });
        return;
      }
      if (hasStatus(error, 400, 409)) {
        settlePendingOperation(operation);
        setReviewOpen(false);
        setNotice({
          kind: "alert",
          text: hasStatus(error, 409)
            ? "部門管理權限或聚會資料已改變，操作未完成；請重新查閱。"
            : "操作資料不正確，請重新查閱後再試。",
        });
        return;
      }
      setReviewOpen(false);
      setNotice({
        kind: "status",
        text: "操作結果未能確認。不要重複提交，請查核操作結果。",
      });
    },
    [isCurrent, settlePendingOperation, verifyActor]
  );

  const submitGrant = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const expectedActor = actorUserId.current;
      const candidate = reviewCandidate;
      const departmentId = selectedDepartmentId;
      const programId = selectedProgramId;
      const currentAuthorityAssignmentId = authorityAssignmentId;
      if (
        !expectedActor ||
        !candidate ||
        !departmentId ||
        !programId ||
        !currentAuthorityAssignmentId ||
        !password ||
        pendingOperation ||
        busy
      ) {
        return;
      }

      const passwordValue = password;
      const epoch = beginOperation();
      setBusy(true);
      setPassword("");
      setNotice({ kind: "status", text: "正在確認目前密碼…" });
      let commandSent = false;
      let operation: RoleOperationReference | null = null;
      try {
        if (!(await verifyActor(expectedActor, epoch))) {
          return;
        }
        await confirmProgramLeaderPassword(crypto.randomUUID(), passwordValue);
        // The proof request is a POST and is never aborted; verify the actor again.
        if (!(await verifyActor(expectedActor, epoch))) {
          return;
        }

        const operationKey = crypto.randomUUID();
        operation = { actorUserId: expectedActor, operationKey };
        if (
          !storeRoleOperationReference(
            "program-leader",
            actorUserId.current,
            operation
          )
        ) {
          lockUntilRechecked(
            "無法安全保留操作查核記錄，未有提交。請重新載入後再試。"
          );
          return;
        }
        setPendingOperation(operation);
        const input: ProgramLeaderChange = {
          action: "granted",
          authorityAssignmentId: currentAuthorityAssignmentId,
          operationKey,
          scopeId: programId,
          targetUserId: candidate.userId,
        };
        commandSent = true;
        const { receipt } = await changeProgramLeader(input);
        if (!(await verifyActor(expectedActor, epoch))) {
          return;
        }
        if (
          receipt.action !== input.action ||
          receipt.scopeId !== input.scopeId ||
          receipt.targetUserId !== input.targetUserId
        ) {
          setReviewOpen(false);
          setNotice({
            kind: "status",
            text: "操作結果未能確認。請查核操作結果，不要重複提交。",
          });
          return;
        }
        await applyReceipt(receipt, expectedActor, epoch, operation);
      } catch (error) {
        await handleGrantFailure(
          error,
          commandSent,
          expectedActor,
          epoch,
          operation
        );
      } finally {
        if (isCurrent(epoch, expectedActor)) {
          setPassword("");
          setBusy(false);
        }
      }
    },
    [
      actorUserId,
      applyReceipt,
      authorityAssignmentId,
      beginOperation,
      busy,
      handleGrantFailure,
      isCurrent,
      lockUntilRechecked,
      password,
      pendingOperation,
      reviewCandidate,
      selectedDepartmentId,
      selectedProgramId,
      settlePendingOperation,
      verifyActor,
    ]
  );

  const reconcile = useCallback(async () => {
    const expectedActor = actorUserId.current;
    const operation = pendingOperation;
    if (
      !expectedActor ||
      !operation ||
      operation.actorUserId !== expectedActor ||
      busy
    ) {
      return;
    }
    const epoch = beginOperation();
    setBusy(true);
    setNotice({ kind: "status", text: "正在查核操作結果…" });
    try {
      if (!(await verifyActor(expectedActor, epoch))) {
        return;
      }
      const result = await reconcileProgramLeaderChange(operation.operationKey);
      if (!(await verifyActor(expectedActor, epoch))) {
        return;
      }
      if (result.outcome === "committed" && result.receipt) {
        await applyReceipt(result.receipt, expectedActor, epoch, operation);
      } else {
        setNotice({
          kind: "status",
          text: "伺服器仍未能確認結果。請稍後再次查核。",
        });
      }
    } catch (error) {
      if (
        isCurrent(epoch, expectedActor) &&
        (await verifyActor(expectedActor, epoch))
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
  }, [
    actorUserId,
    applyReceipt,
    beginOperation,
    busy,
    isCurrent,
    pendingOperation,
    verifyActor,
  ]);

  return (
    <div aria-busy={busy}>
      <DepartmentProgramLeaderNoticeView notice={notice} />
      {pendingOperation ? (
        <ProgramLeaderPendingView busy={busy} onReconcile={reconcile} />
      ) : null}
      <DepartmentProgramLeaderScopeView
        busy={busy || Boolean(pendingOperation)}
        departments={departments}
        hasMoreDepartments={hasMoreDepartments}
        hasMorePrograms={hasMorePrograms}
        onDepartmentChange={onDepartmentChange}
        onMoreDepartments={loadMoreDepartments}
        onMorePrograms={loadMorePrograms}
        onProgramChange={onProgramChange}
        programs={programs}
        selectedDepartmentId={selectedDepartmentId}
        selectedProgramId={selectedProgramId}
      />
      {selectedProgramId ? (
        <>
          <DepartmentProgramLeaderRosterView
            busy={busy || Boolean(pendingOperation)}
            hasMore={hasMoreRoster}
            onMore={loadMoreRoster}
            roster={roster}
          />
          <DepartmentProgramLeaderCandidateView
            busy={busy || Boolean(pendingOperation)}
            candidates={candidates}
            hasMore={hasMoreCandidates}
            onMore={loadMoreCandidates}
            onQueryChange={setQuery}
            onReview={openReview}
            onSearch={onSearch}
            onSelect={setSelectedCandidateId}
            query={query}
            selectedCandidateId={selectedCandidateId}
            searchBusy={searchBusy}
          />
        </>
      ) : null}
      {reviewOpen &&
      reviewCandidate &&
      selectedDepartment &&
      selectedProgram ? (
        <DepartmentProgramLeaderReviewView
          candidate={reviewCandidate}
          busy={busy || Boolean(pendingOperation)}
          departmentName={selectedDepartment.name}
          onClose={() => setReviewOpen(false)}
          onPasswordChange={setPassword}
          onSubmit={submitGrant}
          password={password}
          programName={selectedProgram.name}
        />
      ) : null}
    </div>
  );
};
