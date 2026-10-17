"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";

import type { StaffAccountDirectoryEntry } from "../managed-accounts";
import { staffAccountIdentifier } from "../staff-account-identifier";
import { parseStaffSearch } from "../staff-search-contract";
import { staffPeopleHref } from "./staff-people-href";

export const StaffPeopleList = ({
  accounts,
  personId,
  query,
  page,
  hasNextPage,
  initialQuery,
  initialPage,
}: {
  accounts: StaffAccountDirectoryEntry[];
  initialQuery: string;
  initialPage: number;
  page: number;
  hasNextPage: boolean;
  personId?: string;
  query: string;
}) => {
  const [search, setSearch] = useState(query);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const [result, setResult] = useState({
    accounts,
    hasNextPage,
    page: initialPage,
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [readVersion, setReadVersion] = useState(0);
  const composing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const initial = useRef(true);

  const cancelPending = () => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
    }
    generation.current += 1;
    controller.current?.abort();
  };

  const scheduleSearch = (value: string) => {
    cancelPending();
    setLoading(false);
    try {
      parseStaffSearch(value);
      setError(null);
    } catch {
      setError("搜尋內容最多可輸入 100 個字。");
      return;
    }
    if (composing.current) {
      return;
    }
    timer.current = setTimeout(() => {
      const nextQuery = value.trim();
      if (nextQuery !== query || page !== 1) {
        window.history.pushState(
          null,
          "",
          staffPeopleHref(nextQuery, personId)
        );
      } else {
        setReadVersion((version) => version + 1);
      }
    }, 300);
  };

  useEffect(() => {
    setSearch(query);
    const url = new URL(window.location.href);
    if (page === 1 && url.searchParams.has("page")) {
      url.searchParams.delete("page");
      window.history.replaceState(null, "", url);
    }
    if (
      initial.current &&
      readVersion === 0 &&
      query === initialQuery &&
      page === initialPage
    ) {
      initial.current = false;
      return;
    }
    initial.current = false;
    generation.current += 1;
    const { current } = generation;
    const request = new AbortController();
    controller.current = request;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ page: String(page), q: query });
    const read = async () => {
      try {
        const response = await fetch(`/api/v2/staff/accounts?${params}`, {
          cache: "no-store",
          credentials: "same-origin",
          signal: request.signal,
        });
        if (!response.ok) {
          throw new Error("Staff directory unavailable");
        }
        const body: {
          data: {
            accounts: StaffAccountDirectoryEntry[];
            page: number;
            hasNextPage: boolean;
          };
        } = await response.json();
        if (current !== generation.current || request.signal.aborted) {
          return;
        }
        setResult(body.data);
        if (body.data.page !== page) {
          window.history.replaceState(
            null,
            "",
            staffPeopleHref(query, personId, undefined, body.data.page)
          );
        }
      } catch {
        if (current === generation.current && !request.signal.aborted) {
          setError("暫時未能載入帳戶，請稍後再試。");
          setResult({ accounts: [], hasNextPage: false, page });
        }
      } finally {
        if (current === generation.current && !request.signal.aborted) {
          setLoading(false);
        }
      }
    };
    void read();
    return () => {
      request.abort();
      if (timer.current !== null) {
        clearTimeout(timer.current);
      }
    };
  }, [query, page, initialQuery, initialPage, personId, readVersion]);

  useEffect(
    () => () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
      }
      controller.current?.abort();
      generation.current += 1;
    },
    []
  );
  const filteredAccounts = result.accounts;

  return (
    <>
      <div className={personId ? undefined : "mt-4"} role="search">
        <label
          className="text-label font-semibold"
          htmlFor="staff-account-search"
        >
          搜尋帳戶
        </label>
        <Input
          autoComplete="off"
          className="mt-2 w-full"
          disabled={!hydrated}
          id="staff-account-search"
          name="q"
          onChange={(event) => {
            setSearch(event.target.value);
            scheduleSearch(event.target.value);
          }}
          onCompositionStart={() => {
            composing.current = true;
            cancelPending();
            setLoading(false);
          }}
          onCompositionEnd={(event) => {
            composing.current = false;
            scheduleSearch(event.currentTarget.value);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "staff-search-error" : undefined}
          placeholder="姓名或 Username"
          type="search"
          value={search}
        />
      </div>
      {error ? (
        <p id="staff-search-error" role="alert">
          {error}
        </p>
      ) : null}
      {loading ? <p role="status">正在搜尋帳戶…</p> : null}
      <p
        aria-live="polite"
        className="text-muted-foreground text-meta my-[9px]"
      >
        {filteredAccounts.length} 個可管理帳戶
      </p>
      {filteredAccounts.length > 0 ? (
        <ul className="mt-[10px] flex flex-col gap-[10px]">
          {filteredAccounts.map((account) => (
            <li key={account.userId}>
              <Link
                aria-current={account.userId === personId ? "true" : undefined}
                className={`focus-visible:outline-primary flex min-h-16 items-center gap-4 rounded-[9px] border px-[13px] py-[17px] focus-visible:outline-2 ${
                  account.userId === personId
                    ? "border-primary bg-[#eff7f2]"
                    : "border-border hover:bg-background"
                }`}
                href={staffPeopleHref(
                  query,
                  account.userId,
                  undefined,
                  result.page
                )}
                prefetch={false}
              >
                <span className="bg-muted text-primary text-label flex size-[42px] shrink-0 items-center justify-center rounded-full font-[650]">
                  {[...account.fullName.trim()][0] || "—"}
                </span>
                <span className="min-w-0 flex-1">
                  <strong className="block leading-[1.4] font-semibold break-words">
                    {account.fullName}
                  </strong>
                  <small className="text-muted-foreground text-meta mt-1 block break-all">
                    {staffAccountIdentifier(account)}
                  </small>
                </span>
                <Icon
                  className="size-[18px] shrink-0 opacity-[0.77]"
                  name="chevron-right"
                />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground mt-5" role="status">
          找不到符合的帳戶，請修改姓名或 Username 後重試。
        </p>
      )}
      <nav aria-label="帳戶分頁" className="mt-5 flex items-center gap-3">
        {result.page > 1 ? (
          <Button
            nativeButton={false}
            render={
              <Link
                href={staffPeopleHref(
                  query,
                  undefined,
                  undefined,
                  result.page - 1
                )}
                prefetch={false}
              />
            }
          >
            上一頁帳戶
          </Button>
        ) : null}
        <span>第 {result.page} 頁</span>
        {result.hasNextPage ? (
          <Button
            nativeButton={false}
            render={
              <Link
                href={staffPeopleHref(
                  query,
                  undefined,
                  undefined,
                  result.page + 1
                )}
                prefetch={false}
              />
            }
          >
            下一頁帳戶
          </Button>
        ) : null}
      </nav>
    </>
  );
};
