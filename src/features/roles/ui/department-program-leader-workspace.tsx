"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { TaskHeader } from "@/components/page-frame";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { readAuthContextMarker } from "@/features/auth/auth-context-marker";
import { programLeaderWorkspaceHref } from "@/shared/protected-pages";
import type { ProgramLeaderWorkspaceContext } from "@/shared/protected-pages";

import { programLeaderRosterSchema } from "../program-leader-contract";
import type {
  ProgramLeaderReceipt,
  ProgramLeaderRoster,
} from "../program-leader-contract";
import {
  DepartmentProgramLeaderNoticeView,
  DepartmentProgramLeaderRosterView,
  DepartmentProgramLeaderScopeView,
} from "./department-program-leader-workspace-views";
import type {
  ProgramLeaderDepartmentPage,
  ProgramLeaderProgram,
} from "./program-leader-api";
import {
  getProgramLeaderDepartments,
  getGlobalProgramLeaderPrograms,
  getDepartmentProgramLeaderPrograms,
  getProgramLeaderRoster,
  ProgramLeaderApiError,
  reconcileProgramLeaderChange,
} from "./program-leader-api";
import {
  readConflictingScopedOperationReference,
  scopedOperationRecoveryHref,
  readRoleOperationReference,
  removeRoleOperationReference,
  useRoleCommandLifetime,
} from "./role-command-lifetime";
import type { RoleOperationReference } from "./role-command-lifetime";

const isAbortError = (error: unknown): boolean =>
  error instanceof DOMException && error.name === "AbortError";

const hasStatus = (error: unknown, ...statuses: number[]) =>
  error instanceof ProgramLeaderApiError && statuses.includes(error.status);

const errorText = (error: unknown, fallback: string) =>
  error instanceof ProgramLeaderApiError ? error.message : fallback;

const WorkspaceHeader = ({
  departmentHref,
  departmentName,
  program,
  hasDepartment,
  hasProgram,
  global,
}: {
  departmentHref: string;
  departmentName: string | undefined;
  program: ProgramLeaderProgram | null | undefined;
  hasDepartment: boolean;
  hasProgram: boolean;
  global: boolean;
}) => {
  let title = hasDepartment ? "部門工作區" : "選擇部門";
  if (global) {
    title = "選擇聚會";
  }
  if (hasProgram) {
    title = program?.name ?? "聚會職務";
  }
  let backHref = "/";
  let backLabel = "返回主頁";
  if (global) {
    backHref = "/roles/people";
    backLabel = "返回人員權責";
  }
  if (hasProgram) {
    backHref = departmentHref;
    backLabel = global ? "返回聚會" : `返回${departmentName ?? "部門"}`;
  }
  return (
    <TaskHeader
      singleRow
      title={title}
      returnControl={
        <Button
          variant="quiet"
          className="size-11 shrink-0"
          aria-label={backLabel}
          role="link"
          render={<Link href={backHref} prefetch={false} />}
        >
          <Icon name="arrow-left" className="size-5" />
        </Button>
      }
    />
  );
};

const scopePresentation = (
  selectedDepartmentId: string,
  hasDepartmentContext: boolean,
  busy: boolean,
  noticeKind: "alert" | "status" | undefined,
  departmentCount: number,
  hasMoreDepartments: boolean,
  departmentPage: number
) => ({
  canChangeDepartment:
    departmentCount > 1 || hasMoreDepartments || departmentPage > 1,
  known: selectedDepartmentId
    ? hasDepartmentContext
    : !busy && noticeKind !== "alert",
});

export const DepartmentProgramLeaderWorkspace = ({
  initialActorUserId,
  initialAuthorityAssignmentId,
  initialContext,
}: {
  initialActorUserId: string;
  initialAuthorityAssignmentId: string | null;
  initialContext: ProgramLeaderWorkspaceContext;
}) => {
  const authorityKind = initialContext.authority ?? "department_manager";
  const global = authorityKind !== "department_manager";
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
  const [departments, setDepartments] = useState<
    ProgramLeaderDepartmentPage["departments"]
  >([]);
  const [departmentPage, setDepartmentPage] = useState(1);
  const [hasMoreDepartments, setHasMoreDepartments] = useState(false);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState("");
  const [programs, setPrograms] = useState<ProgramLeaderProgram[]>([]);
  const [programPage, setProgramPage] = useState(1);
  const [hasMorePrograms, setHasMorePrograms] = useState(false);
  const [authorityAssignmentId, setAuthorityAssignmentId] = useState<
    string | null
  >(initialAuthorityAssignmentId);
  const [selectedProgramId, setSelectedProgramId] = useState("");
  const [roster, setRoster] = useState<ProgramLeaderRoster["leaders"]>([]);
  const [rosterPage, setRosterPage] = useState(1);
  const [hasMoreRoster, setHasMoreRoster] = useState(false);
  const [query, setQuery] = useState("");
  const [candidatePage, setCandidatePage] = useState(1);
  const [pendingOperation, setPendingOperation] =
    useState<RoleOperationReference | null>(null);
  const [originalRecoveryHref, setOriginalRecoveryHref] = useState<
    string | null
  >(null);
  const [notice, setNotice] = useState<{
    kind: "alert" | "status";
    text: string;
  } | null>(null);
  const [departmentContext, setDepartmentContext] = useState<{
    id: string;
    name: string;
    assignmentId: string;
  } | null>(null);
  const [programContext, setProgramContext] =
    useState<ProgramLeaderProgram | null>(null);
  const authMarker = useRef<string | null>(null);
  const {
    department: initialDepartment,
    program: initialProgram,
    departmentPage: initialDepartmentPage,
    programPage: initialProgramPage,
    rosterPage: initialRosterPage,
    q: initialQuery,
    candidatePage: initialCandidatePage,
  } = initialContext;

  const writeContext = useCallback(
    (updates: Partial<ProgramLeaderWorkspaceContext>) => {
      const href = programLeaderWorkspaceHref({
        authority: initialContext.authority,
        candidatePage,
        department: selectedDepartmentId,
        departmentPage,
        program: selectedProgramId,
        programPage,
        q: query,
        rosterPage,
        ...updates,
      });
      window.history.replaceState(null, "", href);
    },
    [
      candidatePage,
      initialContext.authority,
      departmentPage,
      programPage,
      query,
      rosterPage,
      selectedDepartmentId,
      selectedProgramId,
    ]
  );

  const clearVisibleData = useCallback(() => {
    setOriginalRecoveryHref(null);
    setBusy(false);
    setDepartments([]);
    setDepartmentPage(1);
    setHasMoreDepartments(false);
    setSelectedDepartmentId("");
    setPrograms([]);
    setProgramPage(1);
    setHasMorePrograms(false);
    setAuthorityAssignmentId(initialAuthorityAssignmentId);
    setSelectedProgramId("");
    setRoster([]);
    setRosterPage(1);
    setHasMoreRoster(false);
    setQuery("");
    setCandidatePage(1);
    setPendingOperation(null);
    setNotice(null);
    setDepartmentContext(null);
    setProgramContext(null);
  }, [initialAuthorityAssignmentId]);

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
      if (readAuthContextMarker() !== authMarker.current) {
        disposeForActorChange();
        return false;
      }
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
            if (readAuthContextMarker() !== authMarker.current) {
              return "";
            }
            if (selectedProgramId && (global || authorityAssignmentId)) {
              const scope = programLeaderRosterSchema.parse(
                await getProgramLeaderRoster(
                  selectedProgramId,
                  1,
                  authorityKind,
                  signal
                )
              );
              return scope.authorityKind === authorityKind &&
                scope.authorityAssignmentId === authorityAssignmentId &&
                scope.program.departmentId === selectedDepartmentId
                ? scope.actorUserId
                : "";
            }
            if (!global && selectedDepartmentId && authorityAssignmentId) {
              const scope = await getDepartmentProgramLeaderPrograms(
                expectedActor,
                selectedDepartmentId,
                1,
                signal
              );
              return scope.authorityAssignmentId === authorityAssignmentId
                ? scope.actorUserId
                : "";
            }
            if (authorityKind !== "department_manager") {
              const current = await getGlobalProgramLeaderPrograms(
                expectedActor,
                authorityKind,
                1,
                signal
              );
              return current.authorityKind === authorityKind &&
                current.authorityAssignmentId === initialAuthorityAssignmentId
                ? current.actorUserId
                : "";
            }
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
        if (
          readAuthContextMarker() !== authMarker.current ||
          hasStatus(error, 401, 403)
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
    [
      disposeForActorChange,
      authorityKind,
      global,
      initialAuthorityAssignmentId,
      lockUntilRechecked,
      requestEpoch,
      verifyRoleActor,
      selectedProgramId,
      selectedDepartmentId,
      authorityAssignmentId,
    ]
  );

  const restoreScope = useCallback(
    async (
      controller: AbortController,
      epoch: number,
      available: ProgramLeaderDepartmentPage
    ) => {
      const [only] = available.departments;
      const originalProgram =
        !initialDepartment && initialProgram
          ? programLeaderRosterSchema.parse(
              await getProgramLeaderRoster(
                initialProgram,
                initialRosterPage,
                authorityKind,
                controller.signal
              )
            )
          : null;
      if (
        originalProgram &&
        !actorMatches(originalProgram.actorUserId, epoch)
      ) {
        return;
      }
      const departmentId =
        initialDepartment ||
        originalProgram?.program.departmentId ||
        (available.page === 1 &&
        available.departments.length === 1 &&
        !available.hasNextPage
          ? only?.id
          : "");
      if (!departmentId) {
        return;
      }
      const result = await getDepartmentProgramLeaderPrograms(
        initialActorUserId,
        departmentId,
        initialProgramPage,
        controller.signal
      );
      if (!actorMatches(result.actorUserId, epoch)) {
        return;
      }
      setSelectedDepartmentId(departmentId);
      setDepartmentContext(result.department);
      setAuthorityAssignmentId(result.authorityAssignmentId);
      setPrograms(result.programs);
      setProgramPage(result.page);
      setHasMorePrograms(result.hasNextPage);
      if (!initialProgram) {
        const href = programLeaderWorkspaceHref({
          candidatePage: initialCandidatePage,
          department: departmentId,
          departmentPage: initialDepartmentPage,
          program: "",
          programPage: initialProgramPage,
          q: initialQuery,
          rosterPage: initialRosterPage,
        });
        window.history.replaceState(null, "", href);
        return;
      }
      const current =
        originalProgram ??
        programLeaderRosterSchema.parse(
          await getProgramLeaderRoster(
            initialProgram,
            initialRosterPage,
            authorityKind,
            controller.signal
          )
        );
      if (!actorMatches(current.actorUserId, epoch)) {
        return;
      }
      if (
        current.authorityKind !== authorityKind ||
        current.authorityAssignmentId !== result.authorityAssignmentId ||
        current.program.departmentId !== departmentId
      ) {
        lockUntilRechecked(
          "部門或聚會管理權限已改變，資料已隱藏。請重新載入。"
        );
        return;
      }
      setSelectedProgramId(current.program.id);
      setProgramContext({
        departmentId: current.program.departmentId,
        departmentName: current.program.departmentName,
        id: current.program.id,
        name: current.program.name,
      });
      setRoster(current.leaders);
      setRosterPage(current.page);
      setHasMoreRoster(current.hasNextPage);
      setQuery(initialQuery);
    },
    [
      actorMatches,
      initialDepartment,
      initialProgram,
      initialDepartmentPage,
      initialProgramPage,
      initialRosterPage,
      initialQuery,
      initialCandidatePage,
      authorityKind,
      initialActorUserId,
      lockUntilRechecked,
    ]
  );

  const restoreGlobalScope = useCallback(
    async (controller: AbortController, epoch: number) => {
      if (authorityKind === "department_manager") {
        return;
      }
      const current = await getGlobalProgramLeaderPrograms(
        initialActorUserId,
        authorityKind,
        initialProgramPage,
        controller.signal
      );
      if (!actorMatches(current.actorUserId, epoch)) {
        return;
      }
      if (
        current.authorityKind !== authorityKind ||
        current.authorityAssignmentId !== initialAuthorityAssignmentId
      ) {
        disposeForActorChange("職務指派權限已改變，資料已清除。請重新載入。");
        return;
      }
      setAuthorityAssignmentId(current.authorityAssignmentId);
      setPrograms(current.programs);
      setProgramPage(current.page);
      setHasMorePrograms(current.hasNextPage);
      if (!initialProgram) {
        return;
      }
      const selected = await getProgramLeaderRoster(
        initialProgram,
        initialRosterPage,
        authorityKind,
        controller.signal
      );
      if (!actorMatches(selected.actorUserId, epoch)) {
        return;
      }
      if (
        selected.authorityKind !== authorityKind ||
        selected.authorityAssignmentId !== current.authorityAssignmentId
      ) {
        disposeForActorChange("職務指派權限已改變，資料已清除。請重新載入。");
        return;
      }
      setSelectedDepartmentId(selected.program.departmentId);
      setSelectedProgramId(selected.program.id);
      setProgramContext({
        ...selected.program,
        departmentId: selected.program.departmentId,
      });
      setRoster(selected.leaders);
      setRosterPage(selected.page);
      setHasMoreRoster(selected.hasNextPage);
      setQuery(initialQuery);
    },
    [
      authorityKind,
      initialActorUserId,
      initialAuthorityAssignmentId,
      initialProgramPage,
      initialProgram,
      initialRosterPage,
      initialQuery,
      actorMatches,
      disposeForActorChange,
    ]
  );

  useEffect(() => {
    actorUserId.current = initialActorUserId;
    clearVisibleData();
    authMarker.current = readAuthContextMarker();
    const { controller, epoch } = beginRead();
    setBusy(true);
    setNotice({
      kind: "status",
      text: global ? "正在載入聚會…" : "正在載入管理部門…",
    });

    const loadDepartments = async () => {
      try {
        const pending = readRoleOperationReference(
          "program-leader",
          initialActorUserId
        );
        setPendingOperation(global ? null : pending);
        const conflict = readConflictingScopedOperationReference(
          "program-leader",
          initialActorUserId
        );
        if (global) {
          await restoreGlobalScope(controller, epoch);
          if (!isCurrent(epoch, initialActorUserId)) {
            return;
          }
          let recovery: string | null = null;
          if (pending) {
            recovery = "/roles/people";
          } else if (conflict) {
            recovery = scopedOperationRecoveryHref(conflict.family);
            if (conflict.family === "program-leader-grant-batch") {
              recovery += `&authority=${authorityKind}`;
            }
          }
          setOriginalRecoveryHref(recovery);
          setNotice(null);
          return;
        }
        const result = await getProgramLeaderDepartments(
          initialDepartmentPage,
          controller.signal
        );
        if (!actorMatches(result.actorUserId, epoch)) {
          return;
        }
        setOriginalRecoveryHref(
          conflict ? scopedOperationRecoveryHref(conflict.family) : null
        );
        setDepartments(result.departments);
        setDepartmentPage(result.page);
        setHasMoreDepartments(result.hasNextPage);
        await restoreScope(controller, epoch, result);
        if (!isCurrent(epoch, initialActorUserId)) {
          return;
        }
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
        if (
          readAuthContextMarker() !== authMarker.current ||
          hasStatus(error, 401, 403)
        ) {
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
    clearVisibleData,
    cancelRead,
    disposeForActorChange,
    initialActorUserId,
    authorityKind,
    global,
    restoreGlobalScope,
    isCurrent,
    initialDepartmentPage,
    restoreScope,
    lockUntilRechecked,
    releaseRead,
  ]);

  const probeCurrentActor = useCallback(async () => {
    if (readAuthContextMarker() !== authMarker.current) {
      disposeForActorChange();
      return;
    }
    const expectedActor = actorUserId.current;
    if (!expectedActor) {
      return;
    }
    await verifyActor(expectedActor, requestEpoch.current);
  }, [actorUserId, disposeForActorChange, requestEpoch, verifyActor]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void probeCurrentActor();
      }
    };
    window.addEventListener("focus", probeCurrentActor);
    const store = Reflect.get(window, "cookieStore") as EventTarget | undefined;
    store?.addEventListener("change", probeCurrentActor);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("focus", probeCurrentActor);
      store?.removeEventListener("change", probeCurrentActor);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [probeCurrentActor]);

  const loadMoreDepartments = useCallback(
    async (page: number) => {
      const { controller, epoch } = beginRead();
      setBusy(true);
      try {
        const result = await getProgramLeaderDepartments(
          page,
          controller.signal
        );
        if (!actorMatches(result.actorUserId, epoch)) {
          return;
        }
        setDepartments(result.departments);
        setDepartmentPage(result.page);
        setHasMoreDepartments(result.hasNextPage);
        writeContext({ departmentPage: result.page });
        setNotice(null);
      } catch (error) {
        if (!isAbortError(error) && isCurrent(epoch, initialActorUserId)) {
          if (
            readAuthContextMarker() !== authMarker.current ||
            hasStatus(error, 401, 403)
          ) {
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
    },
    [
      actorMatches,
      beginRead,
      disposeForActorChange,
      initialActorUserId,
      isCurrent,
      releaseRead,
      writeContext,
    ]
  );

  const loadPrograms = useCallback(
    async (departmentId: string, page: number) => {
      if (!departmentId && !global) {
        return;
      }
      const { controller, epoch } = beginRead();
      setBusy(true);
      setNotice({ kind: "status", text: "正在載入聚會…" });
      try {
        const result =
          authorityKind === "department_manager"
            ? await getDepartmentProgramLeaderPrograms(
                initialActorUserId,
                departmentId,
                page,
                controller.signal
              )
            : await getGlobalProgramLeaderPrograms(
                initialActorUserId,
                authorityKind,
                page,
                controller.signal
              );
        if (!actorMatches(result.actorUserId ?? "", epoch)) {
          return;
        }
        if (
          result.authorityKind !== authorityKind ||
          (global
            ? result.authorityAssignmentId !== initialAuthorityAssignmentId
            : !result.authorityAssignmentId)
        ) {
          lockUntilRechecked("部門管理權限已改變，資料已隱藏。請重新載入。");
          return;
        }
        setAuthorityAssignmentId(result.authorityAssignmentId);
        setPrograms(result.programs);
        if ("department" in result) {
          setDepartmentContext(result.department);
        }
        setProgramPage(result.page);
        setHasMorePrograms(result.hasNextPage);
        writeContext({
          candidatePage: 1,
          department: departmentId,
          program: "",
          programPage: result.page,
          q: "",
          rosterPage: 1,
        });
        setNotice(null);
      } catch (error) {
        if (!isAbortError(error) && isCurrent(epoch, initialActorUserId)) {
          if (
            readAuthContextMarker() !== authMarker.current ||
            hasStatus(error, 401, 403)
          ) {
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
      authorityKind,
      global,
      initialAuthorityAssignmentId,
      beginRead,
      disposeForActorChange,
      initialActorUserId,
      isCurrent,
      lockUntilRechecked,
      releaseRead,
      writeContext,
    ]
  );

  const onDepartmentChange = useCallback(
    (departmentId: string) => {
      setSelectedDepartmentId(departmentId);
      writeContext({
        candidatePage: 1,
        department: departmentId,
        program: "",
        programPage: 1,
        q: "",
        rosterPage: 1,
      });
      setDepartmentContext(null);
      setProgramContext(null);
      setPrograms([]);
      setProgramPage(1);
      setHasMorePrograms(false);
      setAuthorityAssignmentId(initialAuthorityAssignmentId);
      setSelectedProgramId("");
      setRoster([]);
      setRosterPage(1);
      setHasMoreRoster(false);
      setQuery("");
      setCandidatePage(1);
      if (departmentId) {
        void loadPrograms(departmentId, 1);
      } else {
        setBusy(false);
        setNotice(null);
      }
    },
    [initialAuthorityAssignmentId, loadPrograms, writeContext]
  );

  const loadMorePrograms = useCallback(
    () => loadPrograms(selectedDepartmentId, programPage + 1),
    [loadPrograms, programPage, selectedDepartmentId]
  );

  const loadRoster = useCallback(
    async (programId: string, page: number, successNotice?: string) => {
      if (!programId) {
        return;
      }
      const expectedAuthorityAssignmentId = authorityAssignmentId;
      const { controller, epoch } = beginRead();
      setBusy(true);
      setNotice({ kind: "status", text: "正在載入現任職務…" });
      try {
        const result = programLeaderRosterSchema.parse(
          await getProgramLeaderRoster(
            programId,
            page,
            authorityKind,
            controller.signal
          )
        );
        if (!actorMatches(result.actorUserId, epoch)) {
          return;
        }
        if (
          (!global && !expectedAuthorityAssignmentId) ||
          result.authorityKind !== authorityKind ||
          result.authorityAssignmentId !== expectedAuthorityAssignmentId
        ) {
          lockUntilRechecked("部門管理權限已改變，資料已隱藏。請重新載入。");
          return;
        }
        setRoster(result.leaders);
        setProgramContext({
          departmentId: result.program.departmentId,
          departmentName: result.program.departmentName,
          id: result.program.id,
          name: result.program.name,
        });
        setRosterPage(result.page);
        setHasMoreRoster(result.hasNextPage);
        setSelectedDepartmentId(result.program.departmentId);
        writeContext({
          program: programId,
          rosterPage: result.page,
          ...(programId === selectedProgramId
            ? {}
            : { candidatePage: 1, q: "" }),
        });
        setNotice(
          successNotice ? { kind: "status", text: successNotice } : null
        );
      } catch (error) {
        if (!isAbortError(error) && isCurrent(epoch, initialActorUserId)) {
          if (
            readAuthContextMarker() !== authMarker.current ||
            hasStatus(error, 401, 403)
          ) {
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
      authorityKind,
      global,
      beginRead,
      disposeForActorChange,
      initialActorUserId,
      isCurrent,
      lockUntilRechecked,
      releaseRead,
      selectedProgramId,
      writeContext,
    ]
  );

  const onProgramChange = useCallback(
    (programId: string) => {
      setSelectedProgramId(programId);
      writeContext({
        candidatePage: 1,
        program: programId,
        q: "",
        rosterPage: 1,
      });
      setProgramContext(null);
      setRoster([]);
      setRosterPage(1);
      setHasMoreRoster(false);
      setQuery("");
      setCandidatePage(1);
      if (programId) {
        void loadRoster(programId, 1);
      } else {
        setBusy(false);
        setNotice(null);
      }
    },
    [loadRoster, writeContext]
  );

  const loadMoreRoster = useCallback(
    () => loadRoster(selectedProgramId, rosterPage + 1),
    [loadRoster, rosterPage, selectedProgramId]
  );

  const selectedDepartment = departmentContext;
  const selectedProgram = programContext;

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
      const actionText = receipt.action === "granted" ? "已授予" : "已撤回";
      const message = `${actionText}「${receipt.scopeName}」的 Program Leader 職務。`;
      if (selectedProgramId === receipt.scopeId) {
        await loadRoster(selectedProgramId, 1, message);
      } else {
        setNotice({ kind: "status", text: message });
      }
    },
    [isCurrent, loadRoster, selectedProgramId, settlePendingOperation]
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
      const result = await reconcileProgramLeaderChange(
        operation.operationKey,
        initialActorUserId,
        "department_manager"
      );
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

  const returnContext = {
    authority: initialContext.authority,
    candidatePage,
    department: selectedDepartmentId,
    departmentPage,
    program: selectedProgramId,
    programPage,
    q: query,
    rosterPage,
  };
  const returnHref = programLeaderWorkspaceHref(returnContext);
  const departmentHref = programLeaderWorkspaceHref({
    ...returnContext,
    candidatePage: 1,
    program: "",
    q: "",
    rosterPage: 1,
  });
  const editHref = (leader: ProgramLeaderRoster["leaders"][number]) => {
    if (global) {
      return `/roles/people/duties?${new URLSearchParams({
        department: selectedDepartmentId,
        person: leader.userId,
        program: selectedProgramId,
        returnTo: returnHref,
      })}`;
    }
    const params = new URLSearchParams({
      assignment: leader.assignmentId,
      authority: authorityAssignmentId ?? "",
      department: selectedDepartmentId,
      origin: "program",
      person: leader.userId,
      program: selectedProgramId,
      returnTo: returnHref,
    });
    return `/roles/people/duties?${params}`;
  };

  const scopeView = scopePresentation(
    selectedDepartmentId,
    global || Boolean(departmentContext),
    busy,
    notice?.kind,
    departments.length,
    hasMoreDepartments,
    departmentPage
  );

  return (
    <div aria-busy={busy}>
      <WorkspaceHeader
        departmentHref={departmentHref}
        global={global}
        departmentName={selectedDepartment?.name}
        program={selectedProgram}
        hasDepartment={Boolean(selectedDepartmentId)}
        hasProgram={Boolean(selectedProgramId)}
      />
      {selectedProgram ? (
        <p className="text-muted-foreground -mt-2 mb-6 wrap-anywhere">
          {selectedProgram.departmentName}
        </p>
      ) : null}
      <DepartmentProgramLeaderNoticeView notice={notice} />
      {notice?.kind === "alert" ? (
        <Button
          variant="primary"
          type="button"
          className="mt-3"
          onClick={() => window.location.reload()}
        >
          重新載入工作區
        </Button>
      ) : null}
      {originalRecoveryHref ? (
        <section aria-label="原有職務操作" className="mt-6 space-y-3">
          <p>原有職務操作仍待確認；新職務更改未有提交。</p>
          <Button
            nativeButton={false}
            render={<Link href={originalRecoveryHref} />}
            variant="primary"
          >
            查核原有職務操作
          </Button>
        </section>
      ) : null}
      {pendingOperation ? (
        <section aria-label="待查核操作" className="mt-6 space-y-3">
          <p>上一項操作結果未能確認，請先查核原有操作。</p>
          <Button
            disabled={busy}
            onClick={reconcile}
            type="button"
            variant="primary"
          >
            查核操作結果
          </Button>
        </section>
      ) : null}
      <DepartmentProgramLeaderScopeView
        busy={busy || Boolean(pendingOperation)}
        global={global}
        known={scopeView.known}
        departmentName={selectedDepartment?.name ?? "部門職務"}
        canChangeDepartment={scopeView.canChangeDepartment}
        departmentPage={departmentPage}
        programPage={programPage}
        onPreviousDepartments={() => loadMoreDepartments(departmentPage - 1)}
        onPreviousPrograms={() =>
          loadPrograms(selectedDepartmentId, programPage - 1)
        }
        departments={departments}
        hasMoreDepartments={hasMoreDepartments}
        hasMorePrograms={hasMorePrograms}
        onDepartmentChange={onDepartmentChange}
        onMoreDepartments={() => loadMoreDepartments(departmentPage + 1)}
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
            known={Boolean(programContext)}
            page={rosterPage}
            onPrevious={() => loadRoster(selectedProgramId, rosterPage - 1)}
            editHref={editHref}
            hasMore={hasMoreRoster}
            onMore={loadMoreRoster}
            roster={roster}
            onAdd={() => router.push(`${returnHref}&picker=grant`)}
          />
        </>
      ) : null}
    </div>
  );
};
