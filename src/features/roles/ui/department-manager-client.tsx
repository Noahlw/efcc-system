"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import type {
  DepartmentManagerAssignment,
  DepartmentManagerCandidate,
  DepartmentManagerChange,
  DepartmentManagerDepartmentPage,
  DepartmentManagerPerson,
  DepartmentManagerReceipt,
} from "./department-manager-api";
import {
  changeDepartmentManager,
  confirmDepartmentManagerPassword,
  DepartmentManagerApiError,
  getDepartmentManagerDepartments,
  getDepartmentManagerPerson,
  reconcileDepartmentManagerChange,
  searchDepartmentManagerPeople,
} from "./department-manager-api";
import type {
  DepartmentManagerActionDraft,
  DepartmentManagerNotice,
} from "./department-manager-views";
import {
  DepartmentManagerActionReview,
  DepartmentManagerNoticeView,
  DepartmentManagerPendingView,
  DepartmentManagerPersonView,
  DepartmentManagerSearchView,
} from "./department-manager-views";
import {
  readRoleOperationReference,
  removeRoleOperationReference,
  storeRoleOperationReference,
  useRoleCommandLifetime,
} from "./role-command-lifetime";
import type { RoleOperationReference } from "./role-command-lifetime";

const isAbortError = (error: unknown): boolean =>
  error instanceof DOMException && error.name === "AbortError";

const grantedOrWithdrawn = (action: DepartmentManagerReceipt["action"]) =>
  action === "granted" ? "已授予" : "已撤回";

const hasStatus = (error: unknown, ...statuses: number[]) =>
  error instanceof DepartmentManagerApiError && statuses.includes(error.status);

export const DepartmentManagerClient = ({
  initialActorUserId,
}: {
  initialActorUserId: string;
}) => {
  const router = useRouter();
  const lifetime = useRoleCommandLifetime(initialActorUserId);
  const {
    actorUserId,
    beginOperation: beginRoleOperation,
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
  const [personBusy, setPersonBusy] = useState(false);
  const [departments, setDepartments] = useState<
    DepartmentManagerDepartmentPage["departments"]
  >([]);
  const [departmentPage, setDepartmentPage] = useState(1);
  const [hasMoreDepartments, setHasMoreDepartments] = useState(false);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState("");
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<DepartmentManagerCandidate[]>(
    []
  );
  const [searchPage, setSearchPage] = useState(1);
  const [hasMoreCandidates, setHasMoreCandidates] = useState(false);
  const [person, setPerson] = useState<DepartmentManagerPerson | null>(null);
  const [notice, setNotice] = useState<DepartmentManagerNotice | null>(null);
  const [actionDraft, setActionDraft] =
    useState<DepartmentManagerActionDraft | null>(null);
  const [password, setPassword] = useState("");
  const [pendingOperation, setPendingOperation] =
    useState<RoleOperationReference | null>(null);
  const authorityAssignmentId = useRef<string | null>(null);
  const authorityKnown = useRef(false);

  const settlePendingOperation = (operation: RoleOperationReference) => {
    if (actorUserId.current !== operation.actorUserId) {
      return;
    }
    removeRoleOperationReference(
      "department-manager",
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

  const clearVisibleData = useCallback(() => {
    authorityAssignmentId.current = null;
    authorityKnown.current = false;
    setActorReady(false);
    setBusy(false);
    setSearchBusy(false);
    setPersonBusy(false);
    setDepartments([]);
    setDepartmentPage(1);
    setHasMoreDepartments(false);
    setSelectedDepartmentId("");
    setQuery("");
    setCandidates([]);
    setSearchPage(1);
    setHasMoreCandidates(false);
    setPerson(null);
    setActionDraft(null);
    setPassword("");
    setPendingOperation(null);
    setNotice(null);
  }, []);

  const abortRequests = useCallback(() => {
    invalidate();
  }, [invalidate]);

  const disposeForActorChange = useCallback(
    (text = "登入帳戶或管理權限已改變，本頁資料及操作草稿已清除。") => {
      abortRequests();
      clearVisibleData();
      setNotice({ kind: "alert", text });
      router.refresh();
    },
    [abortRequests, clearVisibleData, router]
  );

  const lockUntilRechecked = useCallback(
    (text = "暫時未能確認登入狀態，本頁資料已隱藏。請重新載入。") => {
      abortRequests();
      clearVisibleData();
      setNotice({ kind: "alert", text });
    },
    [abortRequests, clearVisibleData]
  );

  const beginRequest = () => {
    const { controller, epoch } = beginRead();
    setBusy(true);
    return { controller, epoch };
  };

  const beginOperation = () => {
    setBusy(true);
    return beginRoleOperation();
  };

  const isCurrentRequest = (epoch: number, expectedActor: string) =>
    isCurrent(epoch, expectedActor);

  const verifyActor = useCallback(
    async (expectedActor: string, epoch: number): Promise<boolean> => {
      try {
        return await verifyRoleActor(
          expectedActor,
          epoch,
          async (signal) => {
            const current = await searchDepartmentManagerPeople("", 1, signal);
            if (
              current.actorUserId === expectedActor &&
              requestEpoch.current === epoch
            ) {
              const currentAuthority = current.authorityAssignmentId ?? null;
              if (
                authorityKnown.current &&
                authorityAssignmentId.current !== currentAuthority
              ) {
                disposeForActorChange(
                  "管理權限已改變，本頁資料及操作草稿已清除。"
                );
              } else {
                authorityAssignmentId.current = currentAuthority;
                authorityKnown.current = true;
              }
            }
            return current.actorUserId;
          },
          () =>
            disposeForActorChange("登入帳戶已轉換，本頁資料及操作草稿已清除。")
        );
      } catch (error) {
        if (isAbortError(error) || requestEpoch.current !== epoch) {
          return false;
        }
        if (
          error instanceof DepartmentManagerApiError &&
          (error.status === 401 || error.status === 403)
        ) {
          disposeForActorChange(
            "目前登入狀態或管理權限已改變，本頁資料及操作草稿已清除。"
          );
        } else {
          lockUntilRechecked();
        }
        return false;
      }
    },
    [disposeForActorChange, lockUntilRechecked, verifyRoleActor]
  );

  const handleReadFailure = useCallback(
    async (
      error: unknown,
      expectedActor: string,
      epoch: number,
      kind: "departments" | "person" | "search"
    ) => {
      if (
        isAbortError(error) ||
        requestEpoch.current !== epoch ||
        !(await verifyActor(expectedActor, epoch))
      ) {
        return;
      }
      if (error instanceof DepartmentManagerApiError && error.status === 404) {
        setPerson(null);
        setActionDraft(null);
        setPassword("");
        setNotice({
          kind: "status",
          text: "此人士目前不在可管理的範圍內，或資料已改變。",
        });
        return;
      }
      if (error instanceof DepartmentManagerApiError && error.status === 400) {
        setNotice({
          kind: "alert",
          text: "搜尋資料格式不正確，請修改後再試。",
        });
        return;
      }
      if (error instanceof DepartmentManagerApiError && error.status === 409) {
        setNotice({
          kind: "alert",
          text: "資料已更新，請重新查閱後再試。",
        });
        return;
      }
      const text =
        error instanceof DepartmentManagerApiError && error.status === 403
          ? "目前未獲准查看這項資料。"
          : "服務暫時無法使用，請稍後重試。";
      if (kind === "departments") {
        setDepartments([]);
      }
      if (kind === "person") {
        setPerson(null);
      }
      setNotice({ kind: "alert", text });
    },
    [verifyActor]
  );

  useEffect(() => {
    actorUserId.current = initialActorUserId;
    const { controller, epoch } = beginRead();
    setBusy(true);
    setActorReady(false);
    setNotice({ kind: "status", text: "正在載入部門…" });

    const initialize = async () => {
      try {
        const identity = await searchDepartmentManagerPeople(
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
        authorityAssignmentId.current = identity.authorityAssignmentId ?? null;
        authorityKnown.current = true;

        const firstPage = await getDepartmentManagerDepartments(
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
          "department-manager",
          initialActorUserId
        );
        setDepartments(firstPage.departments);
        setDepartmentPage(firstPage.page);
        setHasMoreDepartments(firstPage.hasNextPage);
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
        if (
          error instanceof DepartmentManagerApiError &&
          (error.status === 401 || error.status === 403)
        ) {
          disposeForActorChange(
            "目前登入狀態或管理權限已改變，本頁資料及操作草稿已清除。"
          );
        } else {
          lockUntilRechecked("部門資料暫時無法載入，請重新載入後再試。");
        }
      } finally {
        if (requestEpoch.current === epoch) {
          setBusy(false);
          releaseRead(controller);
        }
      }
    };

    void initialize();
    return () => {
      cancelRead(controller, epoch);
    };
  }, [
    disposeForActorChange,
    initialActorUserId,
    beginRead,
    cancelRead,
    lockUntilRechecked,
    releaseRead,
    verifyActor,
  ]);

  const probeCurrentActor = useCallback(async () => {
    const expectedActor = actorUserId.current;
    if (!actorReady || !expectedActor) {
      return;
    }
    const epoch = requestEpoch.current;
    await verifyActor(expectedActor, epoch);
  }, [actorReady, verifyActor]);

  useEffect(() => {
    const onVisibilityChange = async () => {
      if (document.visibilityState === "visible") {
        await probeCurrentActor();
      }
    };
    window.addEventListener("focus", probeCurrentActor);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("focus", probeCurrentActor);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [probeCurrentActor]);

  const runSearch = async (pageNumber: number) => {
    const expectedActor = actorUserId.current;
    if (!actorReady || !expectedActor || busy) {
      return;
    }
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      setCandidates([]);
      setNotice({ kind: "alert", text: "請輸入姓名或 Username。" });
      return;
    }
    const { controller, epoch } = beginRequest();
    setSearchBusy(true);
    if (pageNumber === 1) {
      setCandidates([]);
      setHasMoreCandidates(false);
    }
    setNotice({ kind: "status", text: "正在搜尋人士…" });
    try {
      const result = await searchDepartmentManagerPeople(
        normalizedQuery,
        pageNumber,
        controller.signal
      );
      if (!isCurrentRequest(epoch, expectedActor)) {
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
      setSearchPage(result.page);
      setHasMoreCandidates(result.hasNextPage);
      setNotice(
        result.candidates.length === 0 && pageNumber === 1
          ? { kind: "status", text: "沒有找到符合的人士。" }
          : null
      );
    } catch (error) {
      await handleReadFailure(error, expectedActor, epoch, "search");
    } finally {
      if (isCurrentRequest(epoch, expectedActor)) {
        setSearchBusy(false);
        setBusy(false);
        releaseRead(controller);
      }
    }
  };

  const loadPerson = async (
    targetUserId: string,
    assignmentPage: number,
    append: boolean
  ) => {
    const expectedActor = actorUserId.current;
    if (!actorReady || !expectedActor || busy) {
      return;
    }
    const { controller, epoch } = beginRequest();
    setPersonBusy(true);
    setNotice({ kind: "status", text: "正在載入人士資料…" });
    try {
      const response = await getDepartmentManagerPerson(
        targetUserId,
        assignmentPage,
        controller.signal
      );
      if (
        !isCurrentRequest(epoch, expectedActor) ||
        !(await verifyActor(expectedActor, epoch))
      ) {
        return;
      }
      setPerson((current) =>
        append && current?.userId === response.person.userId
          ? {
              ...response.person,
              assignments: [
                ...current.assignments,
                ...response.person.assignments,
              ],
            }
          : response.person
      );
      setActionDraft(null);
      setPassword("");
      setNotice(
        response.person.assignments.length === 0 && assignmentPage === 1
          ? {
              kind: "status",
              text: response.person.eligibleForGrant
                ? "此人士目前沒有部門主管職務。"
                : "此人士目前沒有部門主管職務，亦未符合新增條件。",
            }
          : null
      );
    } catch (error) {
      await handleReadFailure(error, expectedActor, epoch, "person");
    } finally {
      if (isCurrentRequest(epoch, expectedActor)) {
        setPersonBusy(false);
        setBusy(false);
        releaseRead(controller);
      }
    }
  };

  const loadMoreDepartments = async () => {
    const expectedActor = actorUserId.current;
    if (!actorReady || !expectedActor || busy || !hasMoreDepartments) {
      return;
    }
    const { controller, epoch } = beginRequest();
    setNotice({ kind: "status", text: "正在載入更多部門…" });
    try {
      const result = await getDepartmentManagerDepartments(
        departmentPage + 1,
        controller.signal
      );
      if (
        !isCurrentRequest(epoch, expectedActor) ||
        !(await verifyActor(expectedActor, epoch))
      ) {
        return;
      }
      setDepartments((current) => [...current, ...result.departments]);
      setDepartmentPage(result.page);
      setHasMoreDepartments(result.hasNextPage);
      setNotice(null);
    } catch (error) {
      await handleReadFailure(error, expectedActor, epoch, "departments");
    } finally {
      if (isCurrentRequest(epoch, expectedActor)) {
        setBusy(false);
        releaseRead(controller);
      }
    }
  };

  const beginGrant = () => {
    const department = departments.find(
      (item) => item.id === selectedDepartmentId
    );
    if (
      !person ||
      !department ||
      !person.eligibleForGrant ||
      pendingOperation
    ) {
      setNotice({
        kind: "alert",
        text: "請先選擇符合條件的人士及部門。",
      });
      return;
    }
    if (
      person.assignments.some(
        (assignment) => assignment.scopeId === department.id
      )
    ) {
      setNotice({ kind: "status", text: "此人士已負責該部門。" });
      return;
    }
    setActionDraft({
      action: "granted",
      scopeId: department.id,
      scopeName: department.name,
    });
    setPassword("");
    setNotice(null);
  };

  const beginWithdrawal = (assignment: DepartmentManagerAssignment) => {
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

  const verifyCurrentActor = (expectedActor: string, epoch: number) => {
    if (!isCurrentRequest(epoch, expectedActor)) {
      return Promise.resolve(false);
    }
    return verifyActor(expectedActor, epoch);
  };

  const handleActionFailure = async (
    error: unknown,
    commandSent: boolean,
    expectedActor: string,
    epoch: number,
    pending: RoleOperationReference | null,
    selectedPerson: DepartmentManagerPerson,
    selectedAction: DepartmentManagerActionDraft
  ) => {
    if (!commandSent || !pending) {
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
    if (hasStatus(error, 409)) {
      settlePendingOperation(pending);
      setActionDraft(null);
      setNotice({
        kind: "alert",
        text: "資料已改變，操作未完成；請重新查閱後再確認。",
      });
      try {
        const refreshed = await getDepartmentManagerPerson(
          selectedPerson.userId,
          1
        );
        if (await verifyCurrentActor(expectedActor, epoch)) {
          setPerson(refreshed.person);
        }
      } catch {
        // The conflict notice remains useful when the refreshed view is unavailable.
      }
      return;
    }
    if (hasStatus(error, 400)) {
      settlePendingOperation(pending);
      setActionDraft(selectedAction);
      setNotice({
        kind: "alert",
        text: "操作資料不正確，請重新檢查人士、部門及目前密碼。",
      });
      return;
    }
    setActionDraft(null);
    setNotice({
      kind: "status",
      text: "操作結果未能確認。不要重複提交，請查核操作結果。",
    });
  };

  const applyActionReceipt = async (
    receipt: DepartmentManagerReceipt,
    selectedPerson: DepartmentManagerPerson,
    expectedActor: string,
    epoch: number,
    pending: RoleOperationReference
  ) => {
    if (!isCurrentRequest(epoch, expectedActor)) {
      return;
    }
    settlePendingOperation(pending);
    setActionDraft(null);
    setNotice({
      kind: "status",
      text: `${grantedOrWithdrawn(receipt.action)}「${receipt.scopeName}」的部門主管職務。`,
    });
    setPerson(null);
    try {
      const refreshed = await getDepartmentManagerPerson(
        selectedPerson.userId,
        1
      );
      if (await verifyCurrentActor(expectedActor, epoch)) {
        setPerson(refreshed.person);
      }
    } catch {
      if (await verifyCurrentActor(expectedActor, epoch)) {
        setNotice({
          kind: "status",
          text: "操作已完成，但未能更新人士資料；請重新查閱。",
        });
      }
    }
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
    const epoch = beginOperation();
    setPassword("");
    setNotice({ kind: "status", text: "正在確認目前密碼…" });
    let commandSent = false;
    let pending: RoleOperationReference | null = null;
    try {
      if (!(await verifyCurrentActor(expectedActor, epoch))) {
        return;
      }
      await confirmDepartmentManagerPassword(
        crypto.randomUUID(),
        passwordValue
      );
      if (!(await verifyCurrentActor(expectedActor, epoch))) {
        return;
      }

      const operationKey = crypto.randomUUID();
      pending = { actorUserId: expectedActor, operationKey };
      storeRoleOperationReference(
        "department-manager",
        actorUserId.current,
        pending
      );
      setPendingOperation(pending);
      const input: DepartmentManagerChange =
        selectedAction.action === "granted"
          ? {
              action: "granted",
              ...(authorityAssignmentId.current
                ? { authorityAssignmentId: authorityAssignmentId.current }
                : {}),
              operationKey,
              scopeId: selectedAction.scopeId,
              targetUserId: selectedPerson.userId,
            }
          : {
              action: "withdrawn",
              ...(authorityAssignmentId.current
                ? { authorityAssignmentId: authorityAssignmentId.current }
                : {}),
              expectedAssignmentId: selectedAction.assignment.assignmentId,
              operationKey,
              scopeId: selectedAction.assignment.scopeId,
              targetUserId: selectedPerson.userId,
            };
      commandSent = true;
      const { receipt } = await changeDepartmentManager(input);
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
      await applyActionReceipt(
        receipt,
        selectedPerson,
        expectedActor,
        epoch,
        pending
      );
    } catch (error) {
      if (!isCurrentRequest(epoch, expectedActor)) {
        return;
      }
      await handleActionFailure(
        error,
        commandSent,
        expectedActor,
        epoch,
        pending,
        selectedPerson,
        selectedAction
      );
    } finally {
      if (isCurrentRequest(epoch, expectedActor)) {
        setPassword("");
        setBusy(false);
      }
    }
  };

  const applyReconciliation = async (
    receipt: DepartmentManagerReceipt,
    expectedActor: string,
    epoch: number,
    pending: RoleOperationReference
  ) => {
    if (!isCurrentRequest(epoch, expectedActor)) {
      return;
    }
    settlePendingOperation(pending);
    setNotice({
      kind: "status",
      text: `${grantedOrWithdrawn(receipt.action)}「${receipt.scopeName}」的部門主管職務。`,
    });
    const selectedUserId = person?.userId;
    if (selectedUserId !== receipt.targetUserId) {
      return;
    }
    setPerson(null);
    try {
      const refreshed = await getDepartmentManagerPerson(selectedUserId, 1);
      if (await verifyCurrentActor(expectedActor, epoch)) {
        setPerson(refreshed.person);
      }
    } catch {
      if (await verifyCurrentActor(expectedActor, epoch)) {
        setNotice({
          kind: "status",
          text: "操作已完成，但未能更新人士資料；請重新查閱。",
        });
      }
    }
  };

  const reconcile = async () => {
    const expectedActor = actorUserId.current;
    const pending = pendingOperation;
    if (
      !actorReady ||
      !expectedActor ||
      !pending ||
      pending.actorUserId !== expectedActor ||
      busy
    ) {
      return;
    }
    const epoch = beginOperation();
    setNotice({ kind: "status", text: "正在查核操作結果…" });
    try {
      if (!(await verifyCurrentActor(expectedActor, epoch))) {
        return;
      }
      const result = await reconcileDepartmentManagerChange(
        pending.operationKey
      );
      if (!(await verifyCurrentActor(expectedActor, epoch))) {
        return;
      }
      if (result.outcome === "committed" && result.receipt) {
        await applyReconciliation(
          result.receipt,
          expectedActor,
          epoch,
          pending
        );
      } else {
        setNotice({
          kind: "status",
          text: "伺服器仍未能確認結果。請稍後再次查核。",
        });
      }
    } catch (error) {
      if (!isCurrentRequest(epoch, expectedActor)) {
        return;
      }
      if (await verifyCurrentActor(expectedActor, epoch)) {
        setNotice({
          kind: hasStatus(error, 409) ? "alert" : "status",
          text: "暫時未能查核操作結果；操作仍未確定，請稍後再試。",
        });
      }
    } finally {
      if (isCurrentRequest(epoch, expectedActor)) {
        setBusy(false);
      }
    }
  };

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    return runSearch(1);
  };

  return (
    <section aria-busy={busy} className="mx-auto w-full max-w-[56rem]">
      <DepartmentManagerNoticeView
        actorReady={actorReady}
        notice={notice}
        onReload={() => window.location.reload()}
      />
      {pendingOperation ? (
        <DepartmentManagerPendingView
          actorReady={actorReady}
          busy={busy}
          onReconcile={reconcile}
        />
      ) : null}
      <DepartmentManagerSearchView
        actorReady={actorReady}
        busy={busy}
        candidates={candidates}
        hasMoreCandidates={hasMoreCandidates}
        onMore={() => runSearch(searchPage + 1)}
        onQueryChange={(value) => {
          setQuery(value);
          setCandidates([]);
          setHasMoreCandidates(false);
          setPerson(null);
          setActionDraft(null);
          setPassword("");
          setNotice(null);
        }}
        onSearch={submitSearch}
        onSelect={(userId) => loadPerson(userId, 1, false)}
        query={query}
        searchBusy={searchBusy}
      />
      {person ? (
        <DepartmentManagerPersonView
          actorReady={actorReady}
          busy={busy}
          departments={departments}
          hasMoreDepartments={hasMoreDepartments}
          onDepartmentChange={setSelectedDepartmentId}
          onGrant={beginGrant}
          onMoreAssignments={() =>
            loadPerson(person.userId, person.assignmentPage.number + 1, true)
          }
          onMoreDepartments={loadMoreDepartments}
          onWithdraw={beginWithdrawal}
          pending={Boolean(pendingOperation)}
          person={person}
          personBusy={personBusy}
          selectedDepartmentId={selectedDepartmentId}
        />
      ) : null}
      {person && actionDraft ? (
        <DepartmentManagerActionReview
          busy={busy}
          onCancel={() => {
            setActionDraft(null);
            setPassword("");
          }}
          onPasswordChange={setPassword}
          onSubmit={submitAction}
          password={password}
          personName={person.fullName}
          review={actionDraft}
        />
      ) : null}
    </section>
  );
};
