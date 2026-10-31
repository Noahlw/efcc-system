"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  normalizedStaffAccountPage,
  parseStaffSearch,
} from "@/features/account/staff-search-contract";
import { readAuthContextMarker } from "@/features/auth/auth-context-marker";

import { useRoleCommandLifetime } from "./role-command-lifetime";
import { RoleOriginalOperation } from "./role-original-operation";
import type {
  RolePersonCandidate,
  RolePersonDetail,
  RolePersonSearchPage,
} from "./role-person-api";
import {
  getRolePersonDetail,
  RolePersonApiError,
  searchRolePeople,
} from "./role-person-api";
import { RolePersonOverview } from "./role-person-overview";

const isAbortError = (error: unknown) =>
  error instanceof DOMException && error.name === "AbortError";

const errorMessage = (error: unknown, fallback: string) => {
  if (!(error instanceof RolePersonApiError)) {
    return fallback;
  }
  switch (error.status) {
    case 403: {
      return "你的管理權限已改變，請重新整理後再試。";
    }
    case 404: {
      return "此人士目前不在可管理的範圍內。";
    }
    case 409: {
      return "管理權限或資料已改變，請重新整理後再試。";
    }
    default: {
      return error.message;
    }
  }
};

const accountRoleLabel = {
  admin: "管理員",
  member: "會友",
  staff: "職員",
} as const;

type SearchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "error"; message: string };
const updateNavigation = (
  values: Record<string, string | undefined>,
  replace = false
) => {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(values)) {
    if (value) {
      url.searchParams.set(key, value);
    } else {
      url.searchParams.delete(key);
    }
  }
  window.history[replace ? "replaceState" : "pushState"](null, "", url);
};

const singleParam = (params: URLSearchParams, key: string) => {
  const values = params.getAll(key);
  return values.length === 1 ? values[0] : undefined;
};

const personParam = (value: string | undefined) =>
  value && value.length <= 128 && /^[a-z0-9_-]+$/iu.test(value)
    ? value
    : undefined;
const rolePeopleReturnPath = ({
  query,
  page,
  person,
  assignmentPage,
  programDepartment,
  programPage,
}: {
  query: string;
  page: number;
  person: string | undefined;
  assignmentPage: number;
  programDepartment: string | undefined;
  programPage: number;
}) => {
  const params = new URLSearchParams();
  if (query && [...query].length <= 100) {
    params.set("q", query);
  }
  if (page > 1) {
    params.set("page", String(page));
  }
  if (person) {
    params.set("person", person);
  }
  if (assignmentPage > 1) {
    params.set("assignmentPage", String(assignmentPage));
  }
  if (programDepartment) {
    params.set("programDepartment", programDepartment);
  }
  if (programPage > 1) {
    params.set("programPage", String(programPage));
  }
  return `/roles/people${params.size ? `?${params}` : ""}`;
};

const SearchFeedback = ({
  busy,
  notice,
  error,
  empty,
  query,
}: {
  busy: boolean;
  notice: string | null;
  error: string | null;
  empty: boolean;
  query: string;
}) => (
  <>
    {busy ? (
      <p className="text-meta text-muted-foreground mt-3" role="status">
        正在搜尋可管理的人士，請稍候。
      </p>
    ) : null}
    {notice ? (
      <p className="text-warning text-meta mt-3" role="alert">
        {notice}
      </p>
    ) : null}
    {error ? (
      <p
        className="text-warning text-meta mt-3"
        id="role-person-search-error"
        role="alert"
      >
        {error}
      </p>
    ) : null}
    {empty ? (
      <p className="text-meta text-muted-foreground mt-4" role="status">
        找不到符合「{query}」而又可管理的人士。
      </p>
    ) : null}
  </>
);

export const RolePersonWorkspace = ({
  initialActorKind,
  initialActorUserId,
  initialAuthorityAssignmentId,
}: {
  initialActorKind: "admin" | "role_assigner";
  initialActorUserId: string;
  initialAuthorityAssignmentId: string | null;
}) => {
  const {
    actorUserId: actorRef,
    beginRead: beginSearch,
    invalidate: invalidateSearch,
    isCurrent: isCurrentSearch,
    releaseRead: releaseSearch,
  } = useRoleCommandLifetime(initialActorUserId);
  const {
    beginRead: beginDetail,
    invalidate: invalidateDetail,
    isCurrent: isCurrentDetail,
    releaseRead: releaseDetail,
  } = useRoleCommandLifetime(initialActorUserId);

  const routeParams = useSearchParams();
  const params = new URLSearchParams(routeParams.toString());
  const routeQuery = singleParam(params, "q") ?? "";
  const routePage = normalizedStaffAccountPage(singleParam(params, "page"));
  const routePerson = personParam(singleParam(params, "person"));
  const routeAssignmentPage = normalizedStaffAccountPage(
    singleParam(params, "assignmentPage")
  );
  const routeProgramDepartment = personParam(
    singleParam(params, "programDepartment")
  );
  const routeProgramPage = normalizedStaffAccountPage(
    singleParam(params, "programPage")
  );
  const [query, setQuery] = useState(routeQuery);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [searchState, setSearchState] = useState<SearchState>({ kind: "idle" });
  const [candidates, setCandidates] = useState<RolePersonCandidate[]>([]);
  const [searchPage, setSearchPage] = useState(1);
  const [hasNextSearchPage, setHasNextSearchPage] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RolePersonDetail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [actorNotice, setActorNotice] = useState<string | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const detailRegion = useRef<HTMLElement>(null);
  const authMarker = useRef<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const composing = useRef(false);
  const lastTarget = useRef<string | null>(null);

  const disposeProtectedState = useCallback(
    (message: string) => {
      invalidateSearch();
      invalidateDetail();
      clearTimeout(searchTimer.current ?? undefined);
      updateNavigation(
        {
          assignmentPage: undefined,
          page: undefined,
          person: undefined,
          programDepartment: undefined,
          programPage: undefined,
          q: undefined,
        },
        true
      );
      setDetailBusy(false);
      setCandidates([]);
      setSearchState({ kind: "idle" });
      setSearchPage(1);
      setHasNextSearchPage(false);
      lastTarget.current = null;
      setSubmittedQuery("");
      setQuery("");
      setSelectedUserId(null);
      setDetail(null);
      setDetailError(null);
      setActorNotice(message);
    },
    [invalidateDetail, invalidateSearch]
  );
  useEffect(() => {
    authMarker.current = readAuthContextMarker();
    let probe: AbortController | null = null;
    let disposed = false;
    const checkAuthority = async () => {
      if (readAuthContextMarker() !== authMarker.current) {
        disposeProtectedState("登入帳戶已更改，已清除人員資料。請重新整理。");
        return;
      }
      if (document.hidden || !actorRef.current) {
        return;
      }
      probe?.abort();
      const controller = new AbortController();
      probe = controller;
      try {
        const current = await searchRolePeople("", 1, controller.signal);
        if (
          !disposed &&
          !controller.signal.aborted &&
          (readAuthContextMarker() !== authMarker.current ||
            current.actorUserId !== initialActorUserId ||
            current.actorKind !== initialActorKind ||
            current.authorityAssignmentId !== initialAuthorityAssignmentId)
        ) {
          disposeProtectedState("管理權限已改變，已清除人員資料。請重新整理。");
        }
      } catch (error) {
        if (
          !disposed &&
          !controller.signal.aborted &&
          error instanceof RolePersonApiError &&
          [401, 403, 409].includes(error.status)
        ) {
          disposeProtectedState(
            errorMessage(error, "登入或管理權限已改變，請重新登入。")
          );
        }
      }
    };
    const onAuthorityChange = () => {
      void checkAuthority();
    };
    const store = Reflect.get(window, "cookieStore") as EventTarget | undefined;
    store?.addEventListener("change", onAuthorityChange);
    window.addEventListener("focus", onAuthorityChange);
    document.addEventListener("visibilitychange", onAuthorityChange);
    return () => {
      disposed = true;
      probe?.abort();
      store?.removeEventListener("change", onAuthorityChange);
      window.removeEventListener("focus", onAuthorityChange);
      document.removeEventListener("visibilitychange", onAuthorityChange);
    };
  }, [
    actorRef,
    disposeProtectedState,
    initialActorKind,
    initialActorUserId,
    initialAuthorityAssignmentId,
  ]);

  const applySearchPage = useCallback((result: RolePersonSearchPage) => {
    setCandidates(result.candidates);
    setSearchPage(result.page);
    setHasNextSearchPage(result.hasNextPage);
    setSearchState({ kind: "ready" });
  }, []);

  const runSearch = useCallback(
    async (searchQuery: string, page: number) => {
      const expectedActor = actorRef.current;
      if (!expectedActor) {
        return;
      }
      setSearchState({ kind: "loading" });
      setActorNotice(null);
      const { controller, epoch } = beginSearch();
      try {
        const result = await searchRolePeople(
          searchQuery,
          page,
          controller.signal
        );
        if (!isCurrentSearch(epoch, expectedActor)) {
          return;
        }
        if (
          readAuthContextMarker() !== authMarker.current ||
          result.actorUserId !== expectedActor ||
          result.actorKind !== initialActorKind ||
          result.authorityAssignmentId !== initialAuthorityAssignmentId
        ) {
          disposeProtectedState(
            "登入帳戶已更改，已清除上一帳戶的人員資料。請重新整理。"
          );
          return;
        }
        const current = await searchRolePeople("", 1, controller.signal);
        if (!isCurrentSearch(epoch, expectedActor)) {
          return;
        }
        if (
          readAuthContextMarker() !== authMarker.current ||
          current.actorUserId !== expectedActor ||
          current.actorKind !== initialActorKind ||
          current.authorityAssignmentId !== initialAuthorityAssignmentId
        ) {
          disposeProtectedState("管理權限已改變，已清除人員資料。請重新整理。");
          return;
        }
        setSubmittedQuery(searchQuery);
        applySearchPage(result);
      } catch (error) {
        if (isAbortError(error) || !isCurrentSearch(epoch, expectedActor)) {
          return;
        }
        if (
          error instanceof RolePersonApiError &&
          [401, 403, 409].includes(error.status)
        ) {
          disposeProtectedState(
            errorMessage(error, "登入或管理權限已改變，請重新登入。")
          );
          return;
        }
        setCandidates([]);
        setSearchState({
          kind: "error",
          message: errorMessage(error, "暫時未能搜尋人士，請稍後再試。"),
        });
      } finally {
        releaseSearch(controller);
      }
    },
    [
      actorRef,
      applySearchPage,
      beginSearch,
      disposeProtectedState,
      initialActorKind,
      initialAuthorityAssignmentId,
      isCurrentSearch,
      releaseSearch,
    ]
  );

  const loadDetail = useCallback(
    async (
      targetUserId: string,
      assignmentPage: number,
      programDepartment?: string,
      programPage?: number
    ) => {
      const expectedActor = actorRef.current;
      if (!expectedActor) {
        return;
      }
      setDetailBusy(true);
      setDetailError(null);
      const { controller, epoch } = beginDetail();
      try {
        const result = await getRolePersonDetail(
          targetUserId,
          assignmentPage,
          controller.signal,
          programDepartment,
          programPage
        );
        if (!isCurrentDetail(epoch, expectedActor)) {
          return;
        }
        if (
          readAuthContextMarker() !== authMarker.current ||
          result.person.actorUserId !== expectedActor ||
          result.person.actorKind !== initialActorKind ||
          result.person.authorityAssignmentId !== initialAuthorityAssignmentId
        ) {
          disposeProtectedState(
            "登入帳戶已更改，已清除上一帳戶的人員資料。請重新整理。"
          );
          return;
        }
        const current = await searchRolePeople("", 1, controller.signal);
        if (!isCurrentDetail(epoch, expectedActor)) {
          return;
        }
        if (
          readAuthContextMarker() !== authMarker.current ||
          current.actorUserId !== expectedActor ||
          current.actorKind !== initialActorKind ||
          current.authorityAssignmentId !== initialAuthorityAssignmentId
        ) {
          disposeProtectedState("管理權限已改變，已清除人員資料。請重新整理。");
          return;
        }
        setDetail(result.person);
      } catch (error) {
        if (isAbortError(error) || !isCurrentDetail(epoch, expectedActor)) {
          return;
        }
        if (
          error instanceof RolePersonApiError &&
          [401, 403, 409].includes(error.status)
        ) {
          disposeProtectedState(
            errorMessage(error, "登入或管理權限已改變，請重新登入。")
          );
          return;
        }
        if (error instanceof RolePersonApiError && error.status === 404) {
          setCandidates((current) =>
            current.filter((candidate) => candidate.userId !== targetUserId)
          );
          setDetail(null);
        }
        setDetailError(
          errorMessage(error, "暫時未能載入此人士的職務，請稍後再試。")
        );
      } finally {
        if (isCurrentDetail(epoch, expectedActor)) {
          setDetailBusy(false);
        }
        releaseDetail(controller);
      }
    },
    [
      actorRef,
      beginDetail,
      disposeProtectedState,
      initialActorKind,
      initialAuthorityAssignmentId,
      isCurrentDetail,
      releaseDetail,
    ]
  );

  useEffect(() => {
    clearTimeout(searchTimer.current ?? undefined);
    setQuery(routeQuery);
    const { controller } = beginSearch();
    controller.abort();
    releaseSearch(controller);
    if (!actorRef.current) {
      return;
    }
    try {
      parseStaffSearch(routeQuery);
    } catch {
      setCandidates([]);
      setSearchState({
        kind: "error",
        message: "搜尋內容最多可輸入 100 個字。",
      });
      return;
    }
    if (!routeQuery.trim()) {
      setCandidates([]);
      setSubmittedQuery("");
      setSearchState({ kind: "idle" });
      return;
    }
    void runSearch(routeQuery.trim(), routePage);
  }, [actorRef, beginSearch, releaseSearch, routePage, routeQuery, runSearch]);

  useEffect(() => {
    if (!actorRef.current) {
      return;
    }
    if (lastTarget.current !== (routePerson ?? null)) {
      lastTarget.current = routePerson ?? null;
      setDetail(null);
      setDetailError(null);
    }
    setSelectedUserId(routePerson ?? null);
    if (routePerson) {
      void loadDetail(
        routePerson,
        routeAssignmentPage,
        routeProgramDepartment,
        routeProgramPage
      );
    } else {
      const { controller } = beginDetail();
      controller.abort();
      releaseDetail(controller);
      setDetailBusy(false);
    }
  }, [
    actorRef,
    beginDetail,
    loadDetail,
    releaseDetail,
    routeAssignmentPage,
    routePerson,
    routeProgramDepartment,
    routeProgramPage,
  ]);

  useEffect(
    () => () => {
      clearTimeout(searchTimer.current ?? undefined);
    },
    []
  );

  const scheduleSearch = (value: string) => {
    clearTimeout(searchTimer.current ?? undefined);
    const { controller } = beginSearch();
    controller.abort();
    releaseSearch(controller);
    setSearchState({ kind: "idle" });
    try {
      parseStaffSearch(value);
    } catch {
      setCandidates([]);
      setSearchState({
        kind: "error",
        message: "搜尋內容最多可輸入 100 個字。",
      });
      return;
    }
    if (!composing.current) {
      searchTimer.current = setTimeout(() => {
        const trimmed = value.trim();
        if (trimmed === routeQuery && routePage === 1) {
          if (trimmed) {
            void runSearch(trimmed, 1);
          } else {
            setCandidates([]);
          }
        } else {
          updateNavigation({ page: undefined, q: trimmed || undefined });
        }
      }, 300);
    }
  };

  const selectPerson = (targetUserId: string) => {
    setSelectedUserId(targetUserId);
    setDetail(null);
    setDetailError(null);
    setActorNotice(null);
    if (routePerson === targetUserId) {
      void loadDetail(targetUserId, 1);
    } else {
      updateNavigation({
        assignmentPage: undefined,
        person: targetUserId,
        programDepartment: undefined,
        programPage: undefined,
      });
    }
    requestAnimationFrame(() => detailRegion.current?.focus());
  };

  const changeTarget = () => {
    const { controller } = beginDetail();
    controller.abort();
    releaseDetail(controller);
    setDetailBusy(false);
    setSelectedUserId(null);
    setDetail(null);
    setDetailError(null);
    updateNavigation({
      assignmentPage: undefined,
      person: undefined,
      programDepartment: undefined,
      programPage: undefined,
    });
    requestAnimationFrame(() => searchInput.current?.focus());
  };

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    clearTimeout(searchTimer.current ?? undefined);
    try {
      parseStaffSearch(query);
    } catch {
      setSearchState({
        kind: "error",
        message: "搜尋內容最多可輸入 100 個字。",
      });
      searchInput.current?.focus();
      return;
    }
    const trimmed = query.trim();
    if (trimmed === routeQuery && routePage === 1 && trimmed) {
      void runSearch(trimmed, 1);
    } else {
      updateNavigation({ page: undefined, q: trimmed || undefined });
    }
  };

  const searchBusy = searchState.kind === "loading";
  const searchMessage =
    searchState.kind === "error" ? searchState.message : null;
  const showNoResults =
    searchState.kind === "ready" &&
    candidates.length === 0 &&
    submittedQuery.length > 0;
  const returnHref = rolePeopleReturnPath({
    assignmentPage: routeAssignmentPage,
    page: routePage,
    person: routePerson,
    programDepartment: routeProgramDepartment,
    programPage: routeProgramPage,
    query: routeQuery,
  });

  const renderDetail = () => {
    const compactChangeTarget = (
      <Button
        className="mt-3 lg:@[50.001rem]:hidden"
        onClick={changeTarget}
        type="button"
        variant="secondary"
      >
        更換對象
      </Button>
    );
    if (detailError) {
      return (
        <div className="border-border rounded-[12px] border p-4" role="alert">
          <p>{detailError}</p>
          {compactChangeTarget}
          {selectedUserId ? (
            <Button
              className="mt-3"
              onClick={() => {
                void loadDetail(
                  selectedUserId,
                  routeAssignmentPage,
                  routeProgramDepartment,
                  routeProgramPage
                );
              }}
              type="button"
              variant="primary"
            >
              重試
            </Button>
          ) : null}
        </div>
      );
    }
    if (detail) {
      return (
        <RolePersonOverview
          busy={detailBusy}
          onChangeTarget={changeTarget}
          onDutyPageChange={(page) => {
            updateNavigation({
              assignmentPage: page > 1 ? String(page) : undefined,
              programDepartment: undefined,
              programPage: undefined,
            });
          }}
          onProgramPageChange={(departmentId, page) => {
            updateNavigation({
              programDepartment: departmentId,
              programPage: page > 1 ? String(page) : undefined,
            });
          }}
          returnHref={returnHref}
          person={detail}
        />
      );
    }
    if (selectedUserId) {
      return (
        <div>
          <p className="text-muted-foreground" role="status">
            {detailBusy
              ? "正在載入此人士的職務，請稍候。"
              : "尚未載入此人士的職務。"}
          </p>
          {compactChangeTarget}
        </div>
      );
    }
    return (
      <div className="border-border text-muted-foreground hidden min-h-48 rounded-[12px] border border-dashed p-6 lg:@[50.001rem]:flex lg:@[50.001rem]:items-center lg:@[50.001rem]:justify-center">
        先搜尋並選擇一位人士，再查閱職務。
      </div>
    );
  };

  return (
    <div className="@container mx-auto w-full">
      <RoleOriginalOperation
        actor={initialActorUserId}
        actorKind={initialActorKind}
        authorityAssignmentId={initialAuthorityAssignmentId}
      />
      <div className="grid gap-6 lg:@[50.001rem]:grid-cols-[minmax(15rem,20rem)_minmax(0,1fr)]">
        <aside
          aria-label="尋找人士"
          className={`min-w-0 ${selectedUserId ? "hidden lg:@[50.001rem]:block" : ""}`}
        >
          <section aria-labelledby="role-person-search-heading">
            <h2 className="text-section" id="role-person-search-heading">
              {initialActorKind === "admin" ? "搜尋人士" : "搜尋會友"}
            </h2>
            <p className="text-meta text-muted-foreground mt-1">
              輸入姓名或 Username，搜尋要管理的對象。
            </p>
            <form
              className="mt-3 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-2"
              onSubmit={submitSearch}
              role="search"
            >
              <label
                className="text-label min-w-0 flex-1"
                htmlFor="role-person-search"
              >
                姓名或 Username
                <input
                  autoComplete="off"
                  disabled={!hydrated}
                  className="border-input-border bg-background focus-visible:border-primary aria-invalid:border-danger mt-1 min-h-12 w-full rounded-md border px-3 focus-visible:outline-2"
                  id="role-person-search"
                  onChange={(event) => {
                    setQuery(event.currentTarget.value);
                    scheduleSearch(event.currentTarget.value);
                  }}
                  onCompositionStart={() => {
                    composing.current = true;
                    clearTimeout(searchTimer.current ?? undefined);
                  }}
                  onCompositionEnd={(event) => {
                    composing.current = false;
                    scheduleSearch(event.currentTarget.value);
                  }}
                  aria-invalid={searchMessage ? true : undefined}
                  aria-describedby={
                    searchMessage ? "role-person-search-error" : undefined
                  }
                  ref={searchInput}
                  type="search"
                  value={query}
                />
              </label>
              <Button
                aria-label="搜尋"
                aria-busy={searchBusy}
                className="mb-0.5 size-11 justify-center"
                disabled={
                  !hydrated ||
                  searchBusy ||
                  !query.trim() ||
                  actorNotice !== null
                }
                type="submit"
                variant="quiet"
              >
                <Icon className="size-5" name="search" />
              </Button>
            </form>
            <SearchFeedback
              busy={searchBusy}
              notice={actorNotice}
              error={searchMessage}
              empty={showNoResults}
              query={submittedQuery}
            />
            {candidates.length > 0 ? (
              <ul
                aria-label="搜尋結果"
                className="border-border divide-border mt-4 divide-y border-y"
              >
                {candidates.map((candidate) => (
                  <li key={candidate.userId}>
                    <button
                      aria-pressed={selectedUserId === candidate.userId}
                      className="hover:bg-muted focus-visible:outline-primary flex min-h-14 w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 text-left focus-visible:outline-2"
                      onClick={() => selectPerson(candidate.userId)}
                      type="button"
                    >
                      <span className="text-label min-w-0 wrap-anywhere">
                        {candidate.fullName}
                      </span>
                      <span className="text-meta text-muted-foreground flex min-w-0 flex-wrap items-center gap-2">
                        {candidate.username ? (
                          <span className="wrap-anywhere">
                            {candidate.username}
                          </span>
                        ) : null}
                        <span className="bg-muted text-primary rounded-full px-2 py-[2px] text-[0.8125rem] font-semibold">
                          {accountRoleLabel[candidate.accountRole]}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {searchState.kind === "ready" &&
            (searchPage > 1 || hasNextSearchPage) ? (
              <div className="mt-3 flex items-center justify-between gap-2">
                <Button
                  disabled={searchBusy || searchPage <= 1}
                  onClick={() => {
                    updateNavigation({
                      page:
                        searchPage - 1 > 1 ? String(searchPage - 1) : undefined,
                    });
                  }}
                  type="button"
                  variant="secondary"
                >
                  上一頁
                </Button>
                <span className="text-meta text-muted-foreground">
                  第 {searchPage} 頁
                </span>
                <Button
                  disabled={searchBusy || !hasNextSearchPage}
                  onClick={() => {
                    updateNavigation({ page: String(searchPage + 1) });
                  }}
                  type="button"
                  variant="secondary"
                >
                  下一頁
                </Button>
              </div>
            ) : null}
          </section>
        </aside>

        <section
          aria-label="人員詳情"
          aria-busy={detailBusy}
          className={`min-w-0 focus-visible:outline-2 ${selectedUserId ? "" : "hidden lg:@[50.001rem]:block"}`}
          ref={detailRegion}
          tabIndex={-1}
        >
          {renderDetail()}
        </section>
      </div>
      <p className="sr-only" role="status">
        {initialActorKind === "admin"
          ? "管理員查閱模式"
          : "Role Assigner 查閱模式"}
      </p>
    </div>
  );
};
