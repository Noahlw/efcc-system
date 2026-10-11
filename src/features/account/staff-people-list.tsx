"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";

import { staffAccountIdentifier } from "./staff-account-identifier";
import type { ManagedAccount } from "./staff-accounts";
import { staffPeopleHref } from "./staff-people-href";

export const StaffPeopleList = ({
  accounts,
  personId,
  query,
}: {
  accounts: ManagedAccount[];
  personId?: string;
  query: string;
}) => {
  const [search, setSearch] = useState(query);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const normalizedQuery = search.toLocaleLowerCase();
  const filteredAccounts = normalizedQuery
    ? accounts.filter((account) =>
        `${account.fullName} ${account.username ?? ""}`
          .toLocaleLowerCase()
          .includes(normalizedQuery)
      )
    : accounts;

  return (
    <>
      {personId ? (
        <>
          <header className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-root font-semibold">帳戶管理</h2>
            <Link
              className="text-primary inline-flex min-h-11 items-center underline underline-offset-4 focus-visible:outline-2"
              href={staffPeopleHref(search)}
              prefetch={false}
            >
              更換對象
            </Link>
          </header>
          <Link
            className="text-primary mt-3 inline-flex min-h-11 items-center gap-2 underline underline-offset-4 focus-visible:outline-2"
            href="/staff/accounts?task=create"
            prefetch={false}
          >
            <Icon className="size-5" name="user" />
            建立帳戶
          </Link>
        </>
      ) : null}
      <div className="mt-4" role="search">
        <label className="text-sm font-medium" htmlFor="staff-account-search">
          搜尋姓名或 Username
        </label>
        <Input
          autoComplete="off"
          className="mt-2 w-full"
          disabled={!hydrated}
          id="staff-account-search"
          name="q"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="姓名或 Username"
          type="search"
          value={search}
        />
      </div>
      <p aria-live="polite" className="text-muted-foreground mt-4 text-sm">
        {filteredAccounts.length} 個可管理帳戶
      </p>
      {filteredAccounts.length > 0 ? (
        <ul className="divide-border mt-3 divide-y">
          {filteredAccounts.map((account) => (
            <li key={account.userId}>
              <Link
                aria-current={account.userId === personId ? "true" : undefined}
                className={`focus-visible:outline-primary flex min-h-16 items-center gap-3 rounded-lg px-3 py-3 focus-visible:outline-2 ${
                  account.userId === personId
                    ? "bg-accent"
                    : "hover:bg-muted/60"
                }`}
                href={staffPeopleHref(search, account.userId)}
                prefetch={false}
              >
                <span className="bg-muted flex size-[44px] shrink-0 items-center justify-center rounded-full">
                  <Icon className="size-[20px]" name="user" />
                </span>
                <span className="min-w-0 flex-1">
                  <strong className="block font-semibold break-words">
                    {account.fullName}
                  </strong>
                  <small className="text-muted-foreground mt-1 block text-sm break-all">
                    {staffAccountIdentifier(account)}
                  </small>
                </span>
                <Icon className="size-[20px] shrink-0" name="chevron-right" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground mt-5" role="status">
          找不到符合的帳戶，請修改姓名或 Username 後重試。
        </p>
      )}
    </>
  );
};
