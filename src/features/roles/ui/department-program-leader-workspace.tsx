"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { TaskHeader } from "@/components/page-frame";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { readAuthContextMarker } from "@/features/auth/auth-context-marker";
import { programLeaderWorkspaceHref } from "@/shared/protected-pages";
import type { ProgramLeaderWorkspaceContext } from "@/shared/protected-pages";

import { programLeaderRosterSchema } from "../program-leader-contract";
import type { ProgramLeaderChangeInput } from "../program-leader-contract";
import {
  DepartmentProgramLeaderCandidateView,
  DepartmentProgramLeaderNoticeView,
  DepartmentProgramLeaderReviewView,
  DepartmentProgramLeaderRosterView,
  DepartmentProgramLeaderScopeView,
} from "./department-program-leader-workspace-views";
import type {
  ProgramLeaderCandidate,
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
  getDepartmentProgramLeaderPrograms,
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

const WorkspaceHeader = ({
  departmentHref,
  departmentName,
  program,
  hasDepartment,
  hasProgram,
}: {
  departmentHref: string;
  departmentName: string | undefined;
  program: ProgramLeaderProgram | null | undefined;
  hasDepartment: boolean;
  hasProgram: boolean;
}) => {
  let title = hasDepartment ? "部門工作區" : "選擇部門";
  if (hasProgram) {
    title = program?.name ?? "聚會職務";
  }
  return (
    <TaskHeader
      singleRow
      title={title}
      returnControl={
        <Button
          variant="quiet"
          className="size-11 shrink-0"
          aria-label={
            hasProgram ? `返回${departmentName ?? "部門"}` : "返回主頁"
          }
          role="link"
          render={
            <Link href={hasProgram ? departmentHref : "/"} prefetch={false} />
          }
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
  initialContext,
}: {
  initialActorUserId: string;
  initialContext: ProgramLeaderWorkspaceContext;
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
  const [grantOpen, setGrantOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [pendingOperation, setPendingOperation] =
    useState<RoleOperationReference | null>(null);
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
      departmentPage,
      programPage,
      query,
      rosterPage,
      selectedDepartmentId,
      selectedProgramId,
    ]
  );

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
    setGrantOpen(false);
    setPassword("");
    setPendingOperation(null);
    setNotice(null);
    setDepartmentContext(null);
    setProgramContext(null);
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
            if (selectedProgramId && authorityAssignmentId) {
              const scope = programLeaderRosterSchema.parse(
                await getProgramLeaderRoster(selectedProgramId, 1, signal)
              );
              return scope.authorityAssignmentId === authorityAssignmentId &&
                scope.program.departmentId === selectedDepartmentId
                ? scope.actorUserId
                : "";
            }
            if (selectedDepartmentId && authorityAssignmentId) {
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
      const departmentId =
        initialDepartment ||
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
      const current = programLeaderRosterSchema.parse(
        await getProgramLeaderRoster(
          initialProgram,
          initialRosterPage,
          controller.signal
        )
      );
      if (!actorMatches(current.actorUserId, epoch)) {
        return;
      }
      if (
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
        departmentName: current.program.departmentName,
        id: current.program.id,
        name: current.program.name,
      });
      setRoster(current.leaders);
      setRosterPage(current.page);
      setHasMoreRoster(current.hasNextPage);
      setQuery(initialQuery);
      if (!initialQuery) {
        return;
      }
      const search = await getProgramLeaderCandidates(
        initialProgram,
        initialQuery,
        initialCandidatePage,
        controller.signal
      );
      if (!actorMatches(search.actorUserId, epoch)) {
        return;
      }
      if (search.authorityAssignmentId !== result.authorityAssignmentId) {
        lockUntilRechecked("部門管理權限已改變，資料已隱藏。請重新載入。");
        return;
      }
      setCandidates(search.candidates);
      setCandidatePage(search.page);
      setHasMoreCandidates(search.hasNextPage);
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
      initialActorUserId,
      lockUntilRechecked,
    ]
  );

  useEffect(() => {
    actorUserId.current = initialActorUserId;
    clearVisibleData();
    authMarker.current = readAuthContextMarker();
    const { controller, epoch } = beginRead();
    setBusy(true);
    setNotice({ kind: "status", text: "正在載入管理部門…" });

    const loadDepartments = async () => {
      try {
        const pending = readRoleOperationReference(
          "program-leader",
          initialActorUserId
        );
        setPendingOperation(pending);
        const result = await getProgramLeaderDepartments(
          initialDepartmentPage,
          controller.signal
        );
        if (!actorMatches(result.actorUserId, epoch)) {
          return;
        }
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
      if (!departmentId) {
        return;
      }
      const { controller, epoch } = beginRead();
      setBusy(true);
      setNotice({ kind: "status", text: "正在載入聚會…" });
      try {
        const result = await getDepartmentProgramLeaderPrograms(
          initialActorUserId,
          departmentId,
          page,
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
        setPrograms(result.programs);
        setDepartmentContext(result.department);
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
      setGrantOpen(false);
      if (departmentId) {
        void loadPrograms(departmentId, 1);
      } else {
        setBusy(false);
        setNotice(null);
      }
    },
    [loadPrograms, writeContext]
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
          await getProgramLeaderRoster(programId, page, controller.signal)
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
        setRoster(result.leaders);
        setProgramContext({
          departmentName: result.program.departmentName,
          id: result.program.id,
          name: result.program.name,
        });
        setRosterPage(result.page);
        setHasMoreRoster(result.hasNextPage);
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
      setCandidates([]);
      setCandidatePage(1);
      setHasMoreCandidates(false);
      setSelectedCandidateId("");
      setReviewOpen(false);
      setGrantOpen(false);
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
        writeContext({ candidatePage: result.page, q: query });
        setNotice(null);
      } catch (error) {
        if (!isAbortError(error) && isCurrent(epoch, initialActorUserId)) {
          if (
            readAuthContextMarker() !== authMarker.current ||
            hasStatus(error, 401, 403)
          ) {
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
      writeContext,
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

  const selectedDepartment = departmentContext;
  const selectedProgram = programContext;
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
        await loadRoster(selectedProgramId, 1, message);
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
        const input: ProgramLeaderChangeInput = {
          action: "granted",
          authorityAssignmentId: currentAuthorityAssignmentId,
          authorityKind: "department_manager",
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
      const result = await reconcileProgramLeaderChange(
        operation.operationKey,
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
  const editHref = (leader: ProgramLeaderRosterPage["leaders"][number]) => {
    const params = new URLSearchParams({
      assignment: leader.assignmentId,
      authority: authorityAssignmentId,
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
    Boolean(departmentContext),
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
      {pendingOperation ? (
        <ProgramLeaderPendingView busy={busy} onReconcile={reconcile} />
      ) : null}
      <DepartmentProgramLeaderScopeView
        busy={busy || Boolean(pendingOperation)}
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
            onAdd={() => setGrantOpen((current) => !current)}
            grantOpen={grantOpen}
          />
          <div id="program-single-grant" className="mt-6" hidden={!grantOpen}>
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
          </div>
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
