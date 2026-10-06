import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { membershipStatusLabel } from "@/features/identity/labels";
import type { ProtectedPageHref } from "@/shared/protected-pages";

import { staffAccountIdentifier } from "./staff-account-identifier";
import type { ManagedAccount } from "./staff-accounts";

const searchParams = (values: Record<string, string | undefined>) =>
  new URLSearchParams(
    Object.entries(values).filter((entry): entry is [string, string] =>
      Boolean(entry[1])
    )
  ).toString();

const peopleHref = (
  query?: string,
  personId?: string,
  task?: string
): ProtectedPageHref => {
  const params = searchParams({
    person: personId,
    q: query,
    task,
    view: "people",
  });
  return params ? `/staff/accounts?${params}` : "/staff/accounts?view=people";
};

const workItems = [
  {
    description: "先選擇一個人，再選擇要處理的工作。",
    href: "/staff/accounts?view=people",
    title: "帳戶管理",
  },
  {
    description: "檢視目前待批核的申請。",
    href: "/staff/applications",
    title: "會籍申請審批",
  },
  {
    description: "協助已核實身分的人建立帳戶。",
    href: "/staff/accounts?task=create",
    title: "建立帳戶",
  },
  {
    description: "唯讀查閱會籍決定及帳戶安全紀錄。",
    href: "/staff/account-audit",
    title: "帳戶操作紀錄",
  },
] as const;

const ActionLink = ({
  description,
  href,
  title,
}: {
  description: string;
  href: string;
  title: string;
}) => (
  <li>
    <Link
      className="hover:bg-muted/60 focus-visible:outline-primary flex min-h-16 items-center justify-between gap-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-2"
      href={href}
      prefetch={false}
    >
      <span>
        <span className="block font-semibold">{title}</span>
        <span className="text-muted-foreground mt-1 block text-sm">
          {description}
        </span>
      </span>
      <span aria-hidden="true" className="text-xl">
        ›
      </span>
    </Link>
  </li>
);

export const StaffManagementMenu = () => (
  <main className="mx-auto w-full max-w-5xl">
    <header>
      <h1 className="text-root font-semibold">管理</h1>
      <p className="text-muted-foreground mt-2">
        只顯示目前已提供而且可使用的工作。
      </p>
    </header>
    <section className="mt-8" aria-labelledby="management-work-heading">
      <h2 id="management-work-heading" className="text-section font-semibold">
        帳戶與會籍
      </h2>
      <ul className="divide-border mt-3 divide-y border-y">
        {workItems.slice(0, 3).map((item) => (
          <ActionLink key={item.href} {...item} />
        ))}
      </ul>
    </section>
    <section className="mt-8" aria-labelledby="management-history-heading">
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
  </main>
);

const DetailRow = ({ label, value }: { label: string; value: string }) => (
  <div className="grid gap-1 py-3 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
    <dt className="text-muted-foreground text-sm">{label}</dt>
    <dd className="font-medium break-words">{value}</dd>
  </div>
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
  const normalizedQuery = query.toLocaleLowerCase();
  const filteredAccounts = normalizedQuery
    ? accounts.filter((account) =>
        `${account.fullName} ${account.username ?? ""}`
          .toLocaleLowerCase()
          .includes(normalizedQuery)
      )
    : accounts;
  const selected = accounts.find((account) => account.userId === personId);
  const listHref = peopleHref(query);

  return (
    <main className="mx-auto w-full max-w-5xl">
      <div className="grid gap-8 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <aside className={selected ? "hidden min-w-0 lg:block" : "min-w-0"}>
          <header className="flex items-center justify-between gap-3">
            <h1 className="text-root font-semibold">帳戶管理</h1>
            {selected ? (
              <Link
                className="text-primary inline-flex min-h-11 items-center underline underline-offset-4 focus-visible:outline-2"
                href={listHref}
                prefetch={false}
              >
                更換對象
              </Link>
            ) : null}
          </header>
          <form
            action="/staff/accounts"
            className="mt-6"
            method="get"
            role="search"
          >
            <input type="hidden" name="view" value="people" />
            <label
              className="text-sm font-medium"
              htmlFor="staff-account-search"
            >
              搜尋姓名或 Username
            </label>
            <Input
              autoComplete="off"
              className="mt-2 w-full"
              id="staff-account-search"
              name="q"
              type="search"
              defaultValue={query}
              placeholder="姓名或 Username"
            />
            <Button className="mt-3 w-full" type="submit">
              搜尋
            </Button>
          </form>
          <p className="text-muted-foreground mt-4 text-sm" aria-live="polite">
            {filteredAccounts.length} 個可管理帳戶
          </p>
          {filteredAccounts.length > 0 ? (
            <ul className="mt-3 flex flex-col gap-2">
              {filteredAccounts.map((account) => (
                <li key={account.userId}>
                  <Link
                    aria-current={
                      account.userId === personId ? "true" : undefined
                    }
                    className={`border-border focus-visible:outline-primary block min-h-14 rounded-lg border px-4 py-3 focus-visible:outline-2 ${
                      account.userId === personId
                        ? "border-primary bg-accent"
                        : "hover:bg-muted/60"
                    }`}
                    href={peopleHref(query, account.userId)}
                    prefetch={false}
                  >
                    <span className="block font-semibold">
                      {account.fullName}
                    </span>
                    <span className="text-muted-foreground mt-1 block text-sm break-all">
                      {staffAccountIdentifier(account)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground mt-5" role="status">
              找不到符合的帳戶，請修改姓名或 Username 後重試。
            </p>
          )}
        </aside>

        <section
          className={selected ? "min-w-0" : "hidden min-w-0 lg:block"}
          aria-label="帳戶詳情"
        >
          {selected ? (
            <>
              <header className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h1
                    className="text-root font-semibold"
                    id="staff-person-heading"
                  >
                    {selected.fullName}
                  </h1>
                  <p className="text-muted-foreground mt-1 break-all">
                    {staffAccountIdentifier(selected)}
                  </p>
                  <p className="bg-accent text-accent-foreground mt-3 inline-flex min-h-8 items-center rounded-full px-3 text-sm font-medium">
                    {membershipStatusLabel(selected.membershipStatus)}
                  </p>
                </div>
                <Link
                  className="text-primary inline-flex min-h-11 items-center underline underline-offset-4 focus-visible:outline-2"
                  href={listHref}
                  prefetch={false}
                >
                  ← 返回帳戶列表
                </Link>
              </header>

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
                    href={peopleHref(query, selected.userId, "identity")}
                    title="修正身份資料"
                  />
                  <ActionLink
                    description="核實身分後重設密碼或重新發出臨時密碼"
                    href={peopleHref(query, selected.userId, "recovery")}
                    title="帳戶復原"
                  />
                  <ActionLink
                    description="會籍狀態及帳戶保安限制"
                    href={peopleHref(query, selected.userId, "restrictions")}
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
                <dl className="divide-border mt-3 divide-y">
                  <DetailRow label="電郵" value={selected.email || "未提供"} />
                  <DetailRow label="電話" value={selected.phone || "未提供"} />
                  <DetailRow
                    label="共用電話"
                    value={selected.phoneShared ? "是" : "否"}
                  />
                </dl>
              </section>

              <section className="mt-8 border-t pt-4">
                <h2 className="sr-only">其他操作</h2>
                <ul className="divide-border divide-y">
                  <ActionLink
                    description="只有符合現行條件的帳戶可以永久刪除。"
                    href={peopleHref(query, selected.userId, "deletion")}
                    title="永久刪除帳戶"
                  />
                </ul>
              </section>
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

export const staffPeopleHref = peopleHref;
