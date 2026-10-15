import Link from "next/link";
import type { ComponentProps } from "react";

import { TaskHeader } from "@/components/page-frame";
import { Icon } from "@/components/ui/icon";
import { membershipStatusLabel } from "@/features/identity/labels";

import type { ManagedAccount } from "../managed-accounts";
import {
  AccountOperationOutcome,
  AccountOperationSummary,
  AccountTargetCard,
  AccountTaskLink,
} from "../operation-presentation";
import { staffAccountIdentifier } from "../staff-account-identifier";
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
    icon: "plus",
    title: "建立帳戶",
  },
  {
    description: "唯讀查閱會籍決定及帳戶安全紀錄。",
    href: "/staff/account-audit",
    icon: "shield",
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

export const StaffManagementMenu = ({ actorName }: { actorName?: string }) => (
  <main className="mx-auto w-full">
    <header>
      <h1 className="text-root">管理</h1>
      <p className="text-muted-foreground mt-2">
        {actorName
          ? `${actorName}，請選擇要處理的工作。`
          : "請選擇要處理的工作。"}
      </p>
    </header>
    <div className="mt-8 grid gap-8 lg:grid-cols-2">
      <section aria-labelledby="management-work-heading">
        <h2 id="management-work-heading" className="text-section">
          帳戶與會籍
        </h2>
        <ul className="border-border mt-3 border-t">
          {workItems.slice(0, 3).map((item) => (
            <ActionLink key={item.href} {...item} />
          ))}
        </ul>
      </section>
      <section aria-labelledby="management-history-heading">
        <h2 id="management-history-heading" className="text-section">
          查閱紀錄
        </h2>
        <ul className="border-border mt-3 border-t">
          {workItems.slice(3).map((item) => (
            <ActionLink key={item.href} {...item} />
          ))}
        </ul>
        <p className="text-meta text-muted-foreground mt-6">
          只顯示你目前有權使用的工作。
        </p>
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
        className={`text-label inline-flex min-h-12 min-w-16 items-center justify-center border-b-2 px-3 pt-[7px] pb-3 focus-visible:outline-2 ${
          current === item.id
            ? "border-primary text-primary font-[650]"
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
    <main
      className={`@container mx-auto w-full ${selected ? "max-w-[64rem]" : ""}`}
    >
      {selected ? (
        <TaskHeader
          className="mb-0"
          title="帳戶詳情"
          returnControl={
            <Link
              aria-label="返回帳戶列表"
              className="text-muted-foreground inline-flex min-h-11 min-w-11 items-center justify-center"
              href={listHref}
              prefetch={false}
            >
              <Icon className="size-5" name="arrow-left" />
            </Link>
          }
        />
      ) : null}
      <div className={selected ? "hidden" : undefined}>
        {selected ? null : (
          <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-root">帳戶管理</h1>
            <Link
              className="bg-primary text-primary-foreground text-meta inline-flex min-h-11 items-center rounded-[10px] px-4 py-[10px] font-[650] focus-visible:outline-2"
              href="/staff/accounts?task=create"
              prefetch={false}
            >
              <Icon className="mr-2 size-[18px]" name="plus" />
              建立帳戶
            </Link>
          </header>
        )}
        <StaffManagementTabs current="accounts" />
      </div>
      <div
        className={
          selected
            ? "grid gap-6 @[58rem]:grid-cols-[15rem_minmax(0,1fr)]"
            : "max-w-[600px]"
        }
      >
        {selected ? null : (
          <p className="text-label text-muted-foreground mb-5">
            先選擇一個人，處理他的帳戶。
          </p>
        )}
        <aside
          className={selected ? "hidden min-w-0 @[58rem]:block" : "min-w-0"}
        >
          <StaffPeopleList
            accounts={accounts}
            key={query}
            personId={selected?.userId}
            query={query}
          />
        </aside>

        <section
          className={selected ? "min-w-0" : "hidden min-w-0 @[58rem]:block"}
          aria-label="帳戶詳情"
        >
          {selected ? (
            <>
              <AccountTargetCard
                identifier={staffAccountIdentifier(selected)}
                name={selected.fullName}
                changeTarget={
                  <Link
                    className="text-primary text-meta inline-flex min-h-11 shrink-0 items-center"
                    href={listHref}
                    prefetch={false}
                  >
                    更換對象
                  </Link>
                }
              >
                <span
                  className={`text-meta mt-[10px] inline-flex rounded-full px-[10px] py-[3px] font-semibold ${selected.membershipStatus === "active" ? "bg-muted text-primary" : "bg-warning-surface text-warning"}`}
                >
                  會籍{membershipStatusLabel(selected.membershipStatus)}
                </span>
              </AccountTargetCard>
              {selected.banned ? (
                <AccountOperationOutcome
                  title="帳戶已暫停使用"
                  message="會籍與保安限制兩項狀態分開管理。"
                  tone="danger"
                />
              ) : null}

              <section
                className="mt-8"
                aria-labelledby="person-actions-heading"
              >
                <h2 className="text-section" id="person-actions-heading">
                  你想處理甚麼？
                </h2>
                <ul className="border-border border-t">
                  <ActionLink
                    description="姓名、Username、電郵及電話"
                    href={staffPeopleHref(query, selected.userId, "identity")}
                    icon="file-text"
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
                <h2 className="text-section mb-4" id="person-contact-heading">
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

              <details className="border-border mt-8 border-t pt-4">
                <summary className="text-label flex min-h-11 cursor-pointer list-none items-center justify-between py-3 focus-visible:outline-2 [&::-webkit-details-marker]:hidden">
                  其他操作
                  <Icon className="size-[18px]" name="chevron-right" />
                </summary>
                <ul className="border-border border-t">
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
