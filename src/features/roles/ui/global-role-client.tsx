"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";

import {
  prepareAuthContextMarker,
  readAuthContextMarker,
} from "@/features/auth/auth-context-marker";

import type {
  GlobalRoleChange,
  GlobalRolePerson,
  GlobalRoleCandidate,
  GlobalRoleReceipt,
  RoleAssignerChange,
  RoleAssignerReceipt,
} from "./global-role-api";
import {
  changeRoleAssigner,
  changeGlobalRole,
  confirmGlobalRolePassword,
  getGlobalRolePerson,
  GlobalRoleApiError,
  reconcileGlobalRoleChange,
  reconcileRoleAssignerChange,
  searchGlobalRolePeople,
} from "./global-role-api";
import type {
  GlobalRoleActionDraft,
  GlobalRoleNotice,
} from "./global-role-views";
import {
  GlobalRoleActionReview,
  GlobalRolePendingView,
  GlobalRolePersonView,
  GlobalRoleSearchView,
  GlobalRoleSelfStepdownOutcome,
  GlobalRoleSelfStepdownReview,
  GlobalRoleSelfStepdownView,
} from "./global-role-views";
import {
  readSelfStepdownOperationReference,
  readRoleOperationReference,
  removeSelfStepdownOperationReference,
  removeRoleOperationReference,
  storeSelfStepdownOperationReference,
  storeRoleOperationReference,
  useRoleCommandLifetime,
} from "./role-command-lifetime";
import type {
  RoleOperationReference,
  SelfStepdownOperationReference,
} from "./role-command-lifetime";

const isAbortError = (error: unknown) =>
  error instanceof DOMException && error.name === "AbortError";

const hasStatus = (error: unknown, ...statuses: number[]) =>
  error instanceof GlobalRoleApiError && statuses.includes(error.status);

type CurrentAuthIdentity =
  | { kind: "none" }
  | { kind: "identified"; userId: string }
  | { kind: "indeterminate" };

const readCurrentAuthIdentity = async (): Promise<CurrentAuthIdentity> => {
  try {
    const response = await fetch("/api/auth/get-session", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      return { kind: "indeterminate" };
    }
    const current: unknown = await response.json();
    if (current === null) {
      return { kind: "none" };
    }
    if (
      current !== null &&
      typeof current === "object" &&
      "user" in current &&
      current.user !== null &&
      typeof current.user === "object" &&
      "id" in current.user &&
      typeof current.user.id === "string" &&
      current.user.id.length > 0
    ) {
      return { kind: "identified", userId: current.user.id };
    }
  } catch {
    return { kind: "indeterminate" };
  }
  return { kind: "indeterminate" };
};

type GlobalRoleCommandRole = "global-role" | "role-assigner";
type PendingGlobalRoleOperation = RoleOperationReference & {
  role: GlobalRoleCommandRole;
};

const resultingGlobalRoleForAction = (
  selectedAction: Extract<GlobalRoleActionDraft, { role: "staff" | "admin" }>
): "admin" | "member" | "staff" => {
  if (selectedAction.role === "admin") {
    return "admin";
  }
  return selectedAction.action === "granted" ? "staff" : "member";
};

const selfStepdownReceiptMatches = (
  receipt: GlobalRoleReceipt,
  expectedActor: string,
  resultingGlobalRole: "member" | "staff"
) =>
  receipt.action === "withdrawn" &&
  receipt.role === "admin" &&
  receipt.targetUserId === expectedActor &&
  receipt.resultingGlobalRole === resultingGlobalRole;

export const GlobalRoleClient = ({
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
  const [candidates, setCandidates] = useState<GlobalRoleCandidate[]>([]);
  const [candidatePage, setCandidatePage] = useState(1);
  const [hasMoreCandidates, setHasMoreCandidates] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [person, setPerson] = useState<GlobalRolePerson | null>(null);
  const [notice, setNotice] = useState<GlobalRoleNotice | null>(null);
  const [actionDraft, setActionDraft] = useState<GlobalRoleActionDraft | null>(
    null
  );
  const [selfStepdownRole, setSelfStepdownRole] = useState<"member" | "staff">(
    "member"
  );
  const [selfStepdownReview, setSelfStepdownReview] = useState<
    "member" | "staff" | null
  >(null);
  const [selfStepdownOutcome, setSelfStepdownOutcome] = useState<{
    kind: "complete" | "unknown" | "unconfirmed";
    resultingGlobalRole?: "member" | "staff";
  } | null>(null);
  const [password, setPassword] = useState("");
  const [pendingOperation, setPendingOperation] =
    useState<PendingGlobalRoleOperation | null>(null);

  const clearVisibleData = useCallback(() => {
    setActorReady(false);
    setBusy(false);
    setSearchBusy(false);
    setQuery("");
    setCandidates([]);
    setCandidatePage(1);
    setHasMoreCandidates(false);
    setSelectedUserId(null);
    setPerson(null);
    setActionDraft(null);
    setSelfStepdownReview(null);
    setSelfStepdownOutcome(null);
    setPassword("");
    setPendingOperation(null);
    setNotice(null);
  }, []);

  const disposeForActorChange = useCallback(
    (text = "登入帳戶或管理權限已改變，本頁人士資料已清除。") => {
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
            const current = await searchGlobalRolePeople("", 1, signal);
            return current.actorUserId;
          },
          () => disposeForActorChange("登入帳戶已轉換，本頁人士資料已清除。")
        );
      } catch (error) {
        if (isAbortError(error) || requestEpoch.current !== epoch) {
          return false;
        }
        if (hasStatus(error, 401, 403)) {
          disposeForActorChange(
            "目前登入狀態或管理權限已改變，本頁人士資料已清除。"
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
    setNotice({ kind: "status", text: "正在確認登入狀態…" });

    const initialize = async () => {
      try {
        const identity = await searchGlobalRolePeople("", 1, controller.signal);
        if (requestEpoch.current !== epoch) {
          return;
        }
        if (identity.actorUserId !== initialActorUserId) {
          disposeForActorChange("登入帳戶已轉換，本頁人士資料已清除。");
          return;
        }
        if (!(await verifyActor(initialActorUserId, epoch))) {
          return;
        }
        const selfStepdownOperation = readSelfStepdownOperationReference(
          initialActorUserId,
          readAuthContextMarker()
        );
        if (selfStepdownOperation) {
          setSelfStepdownOutcome({ kind: "unknown" });
          setActorReady(true);
          return;
        }
        const roleAssignerOperation = readRoleOperationReference(
          "role-assigner",
          initialActorUserId
        );
        const globalRoleOperation = readRoleOperationReference(
          "global-role",
          initialActorUserId
        );
        let pending: PendingGlobalRoleOperation | null = null;
        if (roleAssignerOperation) {
          pending = { ...roleAssignerOperation, role: "role-assigner" };
        } else if (globalRoleOperation) {
          pending = { ...globalRoleOperation, role: "global-role" };
        }
        if (pending) {
          setPendingOperation(pending);
          setNotice({
            kind: "status",
            text: `上一項${pending.role === "global-role" ? "職員身份" : "Role Assigner"}操作結果未能確認，請先查核結果。`,
          });
        }
        setActorReady(true);
        if (!pending) {
          setNotice(null);
        }
      } catch (error) {
        if (isAbortError(error) || requestEpoch.current !== epoch) {
          return;
        }
        if (hasStatus(error, 401, 403)) {
          disposeForActorChange(
            "目前登入狀態或管理權限已改變，本頁人士資料已清除。"
          );
        } else {
          lockUntilRechecked("全域角色資料暫時無法載入，請重新載入後再試。");
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

  const clearActionReview = () => {
    setActionDraft(null);
    setPassword("");
  };

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

  const runSearch = async (pageNumber: number) => {
    const expectedActor = actorUserId.current;
    if (
      !actorReady ||
      !expectedActor ||
      busy ||
      pendingOperation ||
      !query.trim()
    ) {
      return;
    }
    const { controller, epoch } = beginRead();
    setBusy(true);
    setSearchBusy(true);
    setPerson(null);
    setSelectedUserId(null);
    clearActionReview();
    if (pageNumber === 1) {
      setCandidates([]);
      setHasMoreCandidates(false);
    }
    setNotice({ kind: "status", text: "正在搜尋人士…" });
    try {
      const result = await searchGlobalRolePeople(
        query.trim(),
        pageNumber,
        controller.signal
      );
      if (!isCurrent(epoch, expectedActor)) {
        return;
      }
      if (result.actorUserId !== expectedActor) {
        disposeForActorChange("登入帳戶已轉換，本頁人士資料已清除。");
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

  const loadPerson = async (targetUserId: string) => {
    const expectedActor = actorUserId.current;
    if (!actorReady || !expectedActor || busy || pendingOperation) {
      return;
    }
    const { controller, epoch } = beginRead();
    setBusy(true);
    clearActionReview();
    setSelectedUserId(targetUserId);
    setPerson(null);
    setNotice({ kind: "status", text: "正在載入人士資料…" });
    try {
      const result = await getGlobalRolePerson(targetUserId, controller.signal);
      if (
        !isCurrent(epoch, expectedActor) ||
        !(await verifyActor(expectedActor, epoch))
      ) {
        return;
      }
      setPerson(result.person);
      setNotice(null);
    } catch (error) {
      if (isAbortError(error) || !isCurrent(epoch, expectedActor)) {
        return;
      }
      if (!(await verifyActor(expectedActor, epoch))) {
        return;
      }
      setSelectedUserId(null);
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

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void runSearch(1);
  };

  const beginRoleAssignerGrant = () => {
    if (!person?.eligibleForRoleAssigner || pendingOperation) {
      setNotice({
        kind: "alert",
        text: "此人士目前未符合新增 Role Assigner 委派的條件。",
      });
      return;
    }
    setActionDraft({ action: "granted", role: "role_assigner" });
    setPassword("");
    setNotice(null);
  };

  const beginStaffGrant = () => {
    if (!person?.eligibleForStaff || pendingOperation) {
      setNotice({
        kind: "alert",
        text: "此人士目前未符合新增職員身份的條件。",
      });
      return;
    }
    setActionDraft({ action: "granted", role: "staff" });
    setPassword("");
    setNotice(null);
  };

  const beginStaffWithdrawal = () => {
    if (!person || person.role !== "staff" || pendingOperation) {
      setNotice({
        kind: "alert",
        text: "此人士的全域身份已改變，請重新查閱。",
      });
      return;
    }
    setActionDraft({ action: "withdrawn", role: "staff" });
    setPassword("");
    setNotice(null);
  };

  const beginAdminGrant = () => {
    if (!person?.eligibleForAdmin || pendingOperation) {
      setNotice({
        kind: "alert",
        text: "此人士目前未符合新增管理員身份的條件。",
      });
      return;
    }
    setActionDraft({ action: "granted", role: "admin" });
    setPassword("");
    setNotice(null);
  };

  const beginSelfStepdownReview = () => {
    if (!actorReady || pendingOperation || actionDraft || busy) {
      return;
    }
    setPassword("");
    setNotice(null);
    setSelfStepdownReview(selfStepdownRole);
  };

  const beginRoleAssignerWithdrawal = (
    assignment: NonNullable<GlobalRolePerson["roleAssignerAssignment"]>
  ) => {
    if (pendingOperation) {
      setNotice({
        kind: "alert",
        text: "請先查核上一項操作，確認結果後再開始其他操作。",
      });
      return;
    }
    setActionDraft({
      action: "withdrawn",
      assignmentId: assignment.assignmentId,
      role: "role_assigner",
    });
    setPassword("");
    setNotice(null);
  };

  const settlePendingOperation = (operation: PendingGlobalRoleOperation) => {
    if (actorUserId.current !== operation.actorUserId) {
      return;
    }
    removeRoleOperationReference(
      operation.role,
      actorUserId.current,
      operation
    );
    const nextRole =
      operation.role === "role-assigner" ? "global-role" : "role-assigner";
    const nextReference = readRoleOperationReference(
      nextRole,
      operation.actorUserId
    );
    const nextPending: PendingGlobalRoleOperation | null = nextReference
      ? { ...nextReference, role: nextRole }
      : null;
    setPendingOperation((current) => {
      if (
        current?.actorUserId !== operation.actorUserId ||
        current.operationKey !== operation.operationKey
      ) {
        return current;
      }
      return nextPending;
    });
  };

  const verifyCurrentActor = (expectedActor: string, epoch: number) =>
    isCurrent(epoch, expectedActor)
      ? verifyActor(expectedActor, epoch)
      : Promise.resolve(false);

  const refreshPerson = async (targetUserId: string, expectedActor: string) => {
    const { controller, epoch } = beginRead();
    setBusy(true);
    try {
      const result = await getGlobalRolePerson(targetUserId, controller.signal);
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
          text: "未能更新人士資料，請重新查閱。",
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
    receipt: RoleAssignerReceipt,
    expectedActor: string,
    epoch: number,
    operation: PendingGlobalRoleOperation
  ) => {
    if (!isCurrent(epoch, expectedActor)) {
      return;
    }
    settlePendingOperation(operation);
    setActionDraft(null);
    setNotice({
      kind: "status",
      text:
        receipt.action === "granted"
          ? "Role Assigner 委派已完成。"
          : "Role Assigner 委派已撤回。",
    });
    if (selectedUserId === receipt.targetUserId) {
      await refreshPerson(receipt.targetUserId, expectedActor);
    }
  };

  const applyGlobalRoleReceipt = async (
    receipt: GlobalRoleReceipt,
    expectedActor: string,
    epoch: number,
    operation: PendingGlobalRoleOperation
  ) => {
    if (!isCurrent(epoch, expectedActor)) {
      return;
    }
    settlePendingOperation(operation);
    setActionDraft(null);
    setPassword("");
    if (receipt.role === "admin") {
      setSelectedUserId(null);
      setPerson(null);
      setNotice({
        kind: "status",
        text: "管理員身份已新增；其現有登入工作階段已全部結束。",
      });
      return;
    }
    setNotice({
      kind: "status",
      text:
        receipt.resultingGlobalRole === "staff"
          ? "職員身份已新增。"
          : "職員身份已撤回。",
    });
    if (selectedUserId === receipt.targetUserId) {
      await refreshPerson(receipt.targetUserId, expectedActor);
    }
  };

  const handleActionFailure = async (
    error: unknown,
    selectedAction: GlobalRoleActionDraft,
    selectedPerson: GlobalRolePerson,
    expectedActor: string,
    epoch: number,
    operation: PendingGlobalRoleOperation | null
  ) => {
    if (!isCurrent(epoch, expectedActor)) {
      return;
    }
    if (!operation) {
      if (await verifyCurrentActor(expectedActor, epoch)) {
        setNotice({
          kind: "alert",
          text: "目前密碼或登入權限未能確認，請重新輸入後再試。",
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
          : "操作資料不正確，請重新檢查人士及目前密碼。",
      });
      if (hasStatus(error, 409)) {
        setPerson(null);
        await refreshPerson(selectedPerson.userId, expectedActor);
      }
      return;
    }
    setActionDraft(null);
    setNotice({
      kind: "status",
      text: "操作結果未能確認。不要重複提交，請查核操作結果。",
    });
  };

  const submitGlobalRoleAction = async (
    selectedAction: Extract<GlobalRoleActionDraft, { role: "staff" | "admin" }>,
    selectedPerson: GlobalRolePerson,
    expectedActor: string,
    epoch: number,
    operation: PendingGlobalRoleOperation
  ) => {
    const input: GlobalRoleChange =
      selectedAction.role === "admin"
        ? {
            action: "granted",
            operationKey: operation.operationKey,
            role: "admin",
            targetUserId: selectedPerson.userId,
          }
        : {
            action: selectedAction.action,
            operationKey: operation.operationKey,
            role: "staff",
            targetUserId: selectedPerson.userId,
          };
    const { receipt } = await changeGlobalRole(input);
    if (!(await verifyCurrentActor(expectedActor, epoch))) {
      return;
    }
    const resultingGlobalRole = resultingGlobalRoleForAction(selectedAction);
    if (
      receipt.action !== selectedAction.action ||
      receipt.resultingGlobalRole !== resultingGlobalRole ||
      receipt.role !== selectedAction.role ||
      receipt.targetUserId !== selectedPerson.userId
    ) {
      setActionDraft(null);
      setNotice({
        kind: "status",
        text: "操作結果未能確認。請查核操作結果，不要重複提交。",
      });
      return;
    }
    await applyGlobalRoleReceipt(receipt, expectedActor, epoch, operation);
  };

  const submitRoleAssignerAction = async (
    selectedAction: Extract<GlobalRoleActionDraft, { role: "role_assigner" }>,
    selectedPerson: GlobalRolePerson,
    expectedActor: string,
    epoch: number,
    operation: PendingGlobalRoleOperation
  ) => {
    const input: RoleAssignerChange =
      selectedAction.action === "granted"
        ? {
            action: "granted",
            operationKey: operation.operationKey,
            targetUserId: selectedPerson.userId,
          }
        : {
            action: "withdrawn",
            expectedAssignmentId: selectedAction.assignmentId,
            operationKey: operation.operationKey,
            targetUserId: selectedPerson.userId,
          };
    const { receipt } = await changeRoleAssigner(input);
    if (!(await verifyCurrentActor(expectedActor, epoch))) {
      return;
    }
    if (
      receipt.action !== selectedAction.action ||
      receipt.role !== "role_assigner" ||
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
  };

  const verifySelfStepdownIdentity = async (
    expectedActor: string,
    epoch: number,
    authContextMarker: string
  ): Promise<CurrentAuthIdentity | null> => {
    if (!isCurrent(epoch, expectedActor)) {
      return null;
    }
    const currentIdentity = await readCurrentAuthIdentity();
    if (!isCurrent(epoch, expectedActor)) {
      return null;
    }
    if (
      readAuthContextMarker() !== authContextMarker ||
      (currentIdentity.kind === "identified" &&
        currentIdentity.userId !== expectedActor)
    ) {
      disposeForActorChange("登入帳戶已轉換，本頁人士資料已清除。");
      return null;
    }
    return currentIdentity;
  };

  const settleSelfStepdownOutcome = (outcome: {
    kind: "complete" | "unknown" | "unconfirmed";
    resultingGlobalRole?: "member" | "staff";
  }) => {
    invalidate();
    clearVisibleData();
    setSelfStepdownOutcome(outcome);
  };

  const handleSelfStepdownFailure = async (
    error: unknown,
    expectedActor: string,
    resultingGlobalRole: "member" | "staff",
    epoch: number,
    dispatched: boolean,
    operationReference: SelfStepdownOperationReference | null
  ) => {
    if (isAbortError(error) || !isCurrent(epoch, expectedActor)) {
      return;
    }
    if (!dispatched) {
      if (await verifyCurrentActor(expectedActor, epoch)) {
        setSelfStepdownReview(resultingGlobalRole);
        setNotice({
          kind: "alert",
          text: "目前密碼或登入權限未能確認，請重新輸入後再試。",
        });
      }
      return;
    }
    if (!operationReference) {
      settleSelfStepdownOutcome({ kind: "unknown" });
      return;
    }

    const currentIdentity = await verifySelfStepdownIdentity(
      expectedActor,
      epoch,
      operationReference.authContextMarker
    );
    if (!currentIdentity) {
      return;
    }
    if (
      hasStatus(error, 400, 409) &&
      currentIdentity.kind === "identified" &&
      (await verifyCurrentActor(expectedActor, epoch))
    ) {
      removeSelfStepdownOperationReference(expectedActor, operationReference);
      setSelfStepdownReview(null);
      setNotice({
        kind: "alert",
        text: "資料已改變，操作未完成；請重新查閱後再確認。",
      });
      return;
    }
    settleSelfStepdownOutcome({
      kind:
        currentIdentity.kind === "indeterminate" ? "unconfirmed" : "unknown",
    });
  };

  const acknowledgeSelfStepdown = async (
    receipt: GlobalRoleReceipt,
    expectedActor: string,
    resultingGlobalRole: "member" | "staff",
    epoch: number,
    operationReference: SelfStepdownOperationReference
  ) => {
    const currentIdentity = await verifySelfStepdownIdentity(
      expectedActor,
      epoch,
      operationReference.authContextMarker
    );
    if (!currentIdentity) {
      return;
    }
    if (currentIdentity.kind === "indeterminate") {
      settleSelfStepdownOutcome({ kind: "unconfirmed" });
      return;
    }
    if (
      !selfStepdownReceiptMatches(receipt, expectedActor, resultingGlobalRole)
    ) {
      settleSelfStepdownOutcome({ kind: "unknown" });
      return;
    }
    removeSelfStepdownOperationReference(expectedActor, operationReference);
    settleSelfStepdownOutcome({
      kind: "complete",
      resultingGlobalRole,
    });
  };

  const submitSelfStepdown = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const expectedActor = actorUserId.current;
    const resultingGlobalRole = selfStepdownReview;
    if (
      !actorReady ||
      !expectedActor ||
      !resultingGlobalRole ||
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
    let dispatched = false;
    let operationReference: SelfStepdownOperationReference | null = null;
    try {
      if (!(await verifyCurrentActor(expectedActor, epoch))) {
        return;
      }
      await confirmGlobalRolePassword(crypto.randomUUID(), passwordValue);
      if (!(await verifyCurrentActor(expectedActor, epoch))) {
        return;
      }

      operationReference = {
        actorUserId: expectedActor,
        authContextMarker: prepareAuthContextMarker(),
        operationKey: crypto.randomUUID(),
      };
      storeSelfStepdownOperationReference(expectedActor, operationReference);
      dispatched = true;
      setNotice({ kind: "status", text: "正在提交自願退出操作…" });
      const { receipt } = await changeGlobalRole({
        action: "withdrawn",
        operationKey: operationReference.operationKey,
        resultingGlobalRole,
        role: "admin",
        targetUserId: expectedActor,
      });
      if (!isCurrent(epoch, expectedActor)) {
        return;
      }
      if (operationReference) {
        await acknowledgeSelfStepdown(
          receipt,
          expectedActor,
          resultingGlobalRole,
          epoch,
          operationReference
        );
      } else {
        settleSelfStepdownOutcome({ kind: "unconfirmed" });
      }
    } catch (error) {
      await handleSelfStepdownFailure(
        error,
        expectedActor,
        resultingGlobalRole,
        epoch,
        dispatched,
        operationReference
      );
    } finally {
      if (isCurrent(epoch, expectedActor)) {
        setPassword("");
        setBusy(false);
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
    setBusy(true);
    setPassword("");
    setNotice({ kind: "status", text: "正在確認目前密碼…" });
    let operation: PendingGlobalRoleOperation | null = null;
    try {
      if (!(await verifyCurrentActor(expectedActor, epoch))) {
        return;
      }
      await confirmGlobalRolePassword(crypto.randomUUID(), passwordValue);
      if (!(await verifyCurrentActor(expectedActor, epoch))) {
        return;
      }

      const operationKey = crypto.randomUUID();
      const operationReference: PendingGlobalRoleOperation = {
        actorUserId: expectedActor,
        operationKey,
        role:
          selectedAction.role === "role_assigner"
            ? "role-assigner"
            : "global-role",
      };
      operation = operationReference;
      storeRoleOperationReference(
        operationReference.role,
        actorUserId.current,
        {
          actorUserId: operationReference.actorUserId,
          operationKey: operationReference.operationKey,
        }
      );
      setPendingOperation(operationReference);
      await (selectedAction.role === "role_assigner"
        ? submitRoleAssignerAction(
            selectedAction,
            selectedPerson,
            expectedActor,
            epoch,
            operationReference
          )
        : submitGlobalRoleAction(
            selectedAction,
            selectedPerson,
            expectedActor,
            epoch,
            operationReference
          ));
    } catch (error) {
      await handleActionFailure(
        error,
        selectedAction,
        selectedPerson,
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
    const epoch = beginOperation();
    setBusy(true);
    setNotice({ kind: "status", text: "正在查核操作結果…" });
    try {
      if (!(await verifyCurrentActor(expectedActor, epoch))) {
        return;
      }
      if (operation.role === "global-role") {
        const result = await reconcileGlobalRoleChange(operation.operationKey);
        if (!(await verifyCurrentActor(expectedActor, epoch))) {
          return;
        }
        if (result.outcome === "committed" && result.receipt) {
          await applyGlobalRoleReceipt(
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
      } else {
        const result = await reconcileRoleAssignerChange(
          operation.operationKey
        );
        if (!(await verifyCurrentActor(expectedActor, epoch))) {
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

  if (selfStepdownOutcome) {
    return (
      <GlobalRoleSelfStepdownOutcome
        kind={selfStepdownOutcome.kind}
        resultingGlobalRole={selfStepdownOutcome.resultingGlobalRole}
      />
    );
  }

  if (!actorReady && !notice) {
    return null;
  }

  return (
    <div aria-label="全域角色管理" className="mt-6" aria-busy={busy}>
      {selfStepdownReview ? (
        <GlobalRoleSelfStepdownReview
          busy={!actorReady || busy}
          onCancel={() => {
            setSelfStepdownReview(null);
            setPassword("");
          }}
          onPasswordChange={setPassword}
          onSubmit={submitSelfStepdown}
          password={password}
          resultingGlobalRole={selfStepdownReview}
        />
      ) : (
        <GlobalRoleSelfStepdownView
          busy={
            !actorReady ||
            busy ||
            Boolean(pendingOperation) ||
            Boolean(actionDraft)
          }
          onResultingRoleChange={setSelfStepdownRole}
          onStart={beginSelfStepdownReview}
          resultingGlobalRole={selfStepdownRole}
        />
      )}
      <GlobalRoleSearchView
        candidates={candidates}
        hasMore={hasMoreCandidates}
        loading={
          busy ||
          searchBusy ||
          Boolean(pendingOperation) ||
          Boolean(selfStepdownReview)
        }
        notice={notice}
        onLoadMore={() => runSearch(candidatePage + 1)}
        onQueryChange={(nextQuery) => {
          setQuery(nextQuery);
          setCandidates([]);
          setHasMoreCandidates(false);
          setPerson(null);
          setSelectedUserId(null);
          clearActionReview();
          setNotice(null);
        }}
        onSearch={submitSearch}
        onSelect={loadPerson}
        page={candidatePage}
        query={query}
        selectedUserId={selectedUserId}
      />
      {pendingOperation ? (
        <GlobalRolePendingView
          busy={busy}
          onReconcile={reconcile}
          roleLabel={
            pendingOperation.role === "global-role"
              ? "職員身份"
              : "Role Assigner"
          }
        />
      ) : null}
      {person ? (
        <GlobalRolePersonView
          busy={!actorReady || busy}
          onDemoteToMember={beginStaffWithdrawal}
          onGrantAdmin={beginAdminGrant}
          onPromoteToStaff={beginStaffGrant}
          onGrantRoleAssigner={beginRoleAssignerGrant}
          onWithdrawRoleAssigner={beginRoleAssignerWithdrawal}
          pending={Boolean(pendingOperation)}
          person={person}
        />
      ) : null}
      {person && actionDraft ? (
        <GlobalRoleActionReview
          busy={!actorReady || busy || Boolean(pendingOperation)}
          hasRoleAssigner={Boolean(person.roleAssignerAssignment)}
          onCancel={cancelReview}
          onPasswordChange={setPassword}
          onSubmit={submitAction}
          password={password}
          personName={person.fullName}
          review={actionDraft}
        />
      ) : null}
    </div>
  );
};
