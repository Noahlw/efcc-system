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
      <div className={personId ? undefined : "mt-4"} role="search">
        <label
          className="text-label font-semibold"
          htmlFor="staff-account-search"
        >
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
                href={staffPeopleHref(search, account.userId)}
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
    </>
  );
};
