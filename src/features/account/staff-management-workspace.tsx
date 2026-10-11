import Link from "next/link";
import type { ComponentProps } from "react";

import { membershipStatusLabel } from "@/features/identity/labels";

import {
  AccountOperationSummary,
  AccountTargetCard,
  AccountTaskLink,
} from "./operation-presentation";
import { staffAccountIdentifier } from "./staff-account-identifier";
import type { ManagedAccount } from "./staff-accounts";
import { staffPeopleHref } from "./staff-people-href";
import { StaffPeopleList } from "./staff-people-list";

const workItems = [
  {
    description: "先選擇一個人，再選擇要處理的工作。",
    href: "/staff/accounts?view=people",
    icon: "users",
    title: "帳戶管理",
  },
  {
    description: "檢視目前待批核的申請。",
    href: "/staff/applications",
    icon: "file-text",
    title: "會籍申請審批",
  },
  {
    description: "協助已核實身分的人建立帳戶。",
    href: "/staff/accounts?task=create",
    icon: "user",
    title: "建立帳戶",
  },
  {
    description: "唯讀查閱會籍決定及帳戶安全紀錄。",
    href: "/staff/account-audit",
    icon: "file-text",
    title: "帳戶操作紀錄",
  },
] as const;

const ActionLink = ({
  description,
  href,
  icon,
  title,
}: {
  description: string;
  href: string;
  icon: ComponentProps<typeof AccountTaskLink>["icon"];
  title: string;
}) => (
  <li>
    <AccountTaskLink
      description={description}
      href={href}
      icon={icon}
      label={title}
    />
  </li>
);

export const StaffManagementMenu = () => (
  <main className="mx-auto w-full">
    <header>
      <h1 className="text-root font-semibold">管理</h1>
      <p className="text-muted-foreground mt-2">
        只顯示目前已提供而且可使用的工作。
      </p>
    </header>
    <div className="mt-8 grid gap-8 lg:grid-cols-2">
      <section aria-labelledby="management-work-heading">
        <h2 id="management-work-heading" className="text-section font-semibold">
          帳戶與會籍
        </h2>
        <ul className="divide-border mt-3 divide-y border-y">
          {workItems.slice(0, 3).map((item) => (
            <ActionLink key={item.href} {...item} />
          ))}
        </ul>
      </section>
      <section aria-labelledby="management-history-heading">
        <h2
          id="management-history-heading"
          className="text-section font-semibold"
        >
          查閱紀錄
        </h2>
        <ul className="divide-border mt-3 divide-y border-y">
          {workItems.slice(3).map((item) => (
            <ActionLink key={item.href} {...item} />
          ))}
        </ul>
      </section>
    </div>
  </main>
);

export const StaffManagementTabs = ({
  current,
}: {
  current: "accounts" | "applications" | "audit";
}) => (
  <nav
    aria-label="管理工作"
    className="border-border mb-6 flex flex-wrap gap-2 border-b"
  >
    {[
      { href: "/staff/accounts?view=people", id: "accounts", label: "帳戶" },
      { href: "/staff/applications", id: "applications", label: "審批" },
      { href: "/staff/account-audit", id: "audit", label: "紀錄" },
    ].map((item) => (
      <Link
        aria-current={current === item.id ? "page" : undefined}
        className={`inline-flex min-h-11 items-center border-b-2 px-4 py-2 font-medium focus-visible:outline-2 ${
          current === item.id
            ? "border-primary text-primary"
            : "text-muted-foreground border-transparent"
        }`}
        href={item.href}
        key={item.id}
        prefetch={false}
      >
        {item.label}
      </Link>
    ))}
  </nav>
);

export const StaffPeopleWorkspace = ({
  accounts,
  personId,
  query,
}: {
  accounts: ManagedAccount[];
  personId?: string;
  query: string;
}) => {
  const selected = accounts.find((account) => account.userId === personId);
  const listHref = staffPeopleHref(query);

  return (
    <main className="@container mx-auto w-full">
      <div className={selected ? "hidden @[40rem]:block" : undefined}>
        {selected ? null : (
          <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-root font-semibold">帳戶管理</h1>
            <Link
              className="border-border text-primary inline-flex min-h-12 items-center rounded-md border px-4 py-2 focus-visible:outline-2"
              href="/staff/accounts?task=create"
              prefetch={false}
            >
              建立帳戶
            </Link>
          </header>
        )}
        <StaffManagementTabs current="accounts" />
      </div>
      <div className="grid gap-8 @[40rem]:grid-cols-[17rem_minmax(0,1fr)]">
        <aside
          className={selected ? "hidden min-w-0 @[40rem]:block" : "min-w-0"}
        >
          <StaffPeopleList
            accounts={accounts}
            key={query}
            personId={selected?.userId}
            query={query}
          />
        </aside>

        <section
          className={selected ? "min-w-0" : "hidden min-w-0 @[40rem]:block"}
          aria-label="帳戶詳情"
        >
          {selected ? (
            <>
              <header className="flex flex-wrap items-start justify-between gap-4">
                <h1
                  className="text-root font-semibold"
                  id="staff-person-heading"
                >
                  帳戶詳情
                </h1>
                <Link
                  className="text-primary inline-flex min-h-11 items-center underline underline-offset-4 focus-visible:outline-2"
                  href={listHref}
                  prefetch={false}
                >
                  ← 返回帳戶列表
                </Link>
              </header>
              <AccountTargetCard
                identifier={staffAccountIdentifier(selected)}
                name={selected.fullName}
              />
              <AccountOperationSummary
                rows={[
                  {
                    label: "會籍狀態",
                    value: membershipStatusLabel(selected.membershipStatus),
                  },
                  {
                    label: "保安限制",
                    value: selected.banned ? "禁止登入" : "未設保安限制",
                  },
                ]}
              />

              <section
                className="mt-8"
                aria-labelledby="person-actions-heading"
              >
                <h2
                  className="text-section border-border border-b pb-2 font-semibold"
                  id="person-actions-heading"
                >
                  你想處理甚麼？
                </h2>
                <ul className="divide-border divide-y">
                  <ActionLink
                    description="姓名、Username、電郵及電話"
                    href={staffPeopleHref(query, selected.userId, "identity")}
                    icon="user"
                    title="修正身份資料"
                  />
                  <ActionLink
                    description="核實身分後重設密碼或重新發出臨時密碼"
                    href={staffPeopleHref(query, selected.userId, "recovery")}
                    icon="key-round"
                    title="帳戶復原"
                  />
                  <ActionLink
                    description="會籍狀態及帳戶保安限制"
                    href={staffPeopleHref(
                      query,
                      selected.userId,
                      "restrictions"
                    )}
                    icon="shield"
                    title="會籍與限制"
                  />
                </ul>
              </section>

              <section
                className="mt-8"
                aria-labelledby="person-contact-heading"
              >
                <h2
                  className="text-section border-border border-b pb-2 font-semibold"
                  id="person-contact-heading"
                >
                  帳戶資料
                </h2>
                <AccountOperationSummary
                  rows={[
                    { label: "電郵", value: selected.email || "未提供" },
                    { label: "電話", value: selected.phone || "未提供" },
                    {
                      label: "共用電話",
                      value: selected.phoneShared ? "是" : "否",
                    },
                  ]}
                />
              </section>

              <details className="border-danger mt-8 border-t pt-4">
                <summary className="text-danger min-h-11 cursor-pointer py-3 font-semibold focus-visible:outline-2">
                  危險操作
                </summary>
                <ul className="divide-border divide-y">
                  <ActionLink
                    description="只有符合現行條件的帳戶可以永久刪除。"
                    href={staffPeopleHref(query, selected.userId, "deletion")}
                    icon="shield"
                    title="永久刪除帳戶"
                  />
                </ul>
              </details>
            </>
          ) : (
            <div className="border-border text-muted-foreground hidden min-h-48 rounded-lg border border-dashed p-6 lg:flex lg:items-center lg:justify-center">
              先搜尋並選擇一個帳戶，再查看資料及可用工作。
            </div>
          )}
        </section>
      </div>
    </main>
  );
};
