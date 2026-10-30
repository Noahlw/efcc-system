import Link from "next/link";

import { Button } from "@/components/ui/button";

import { DepartmentDutyPager } from "./department-duty-pager";
import type { RolePersonDetail } from "./role-person-api";

const roleLabels = {
  admin: "管理員",
  member: "會友",
  staff: "職員",
} as const;

const accountStateLabels = {
  active: null,
  banned: "此帳戶已暫停使用；會籍與保安限制分開管理。",
  deactivated: "此帳戶的會籍已停用。",
  pending: "此帳戶的會籍仍在批核中。",
} as const;

export const RolePersonOverview = ({
  busy,
  onChangeTarget,
  onDutyPageChange,
  onProgramPageChange,
  person,
  returnHref,
}: {
  busy: boolean;
  onChangeTarget: () => void;
  onDutyPageChange: (page: number) => void;
  onProgramPageChange: (departmentId: string, page: number) => void;
  person: RolePersonDetail;
  returnHref: string;
}) => {
  const stateMessage = accountStateLabels[person.identity.accountState];
  return (
    <article aria-label={person.identity.fullName} className="min-w-0">
      <header className="bg-muted flex flex-wrap items-start justify-between gap-3 rounded-xl p-4">
        <div className="min-w-0 flex-1 basis-40">
          <h2 className="text-section font-[650] wrap-anywhere">
            {person.identity.fullName}
          </h2>
          <p className="text-meta text-muted-foreground mt-1 wrap-anywhere">
            {person.identity.username ?? "未有 Username"}
          </p>
          <p className="text-meta bg-muted text-primary mt-2 inline-flex rounded-full px-[10px] py-[3px] font-semibold">
            {roleLabels[person.identity.role]}
          </p>
        </div>
        <Button
          className="lg:@[50.001rem]:hidden"
          onClick={onChangeTarget}
          type="button"
          variant="secondary"
        >
          更換對象
        </Button>
      </header>

      {stateMessage ? (
        <p
          className="bg-warning-surface text-warning text-meta mt-4 rounded-[10px] px-4 py-3"
          role="status"
        >
          {stateMessage}
        </p>
      ) : null}
      {person.isSelf ? (
        <p className="text-meta text-muted-foreground mt-4" role="status">
          這是你的帳戶。你的部門及聚會職務可在此查閱；帳戶身份變更由「帳戶」處理。
        </p>
      ) : null}

      <div className="mt-6">
        <DepartmentDutyPager
          action={
            person.capabilities.canManageDuties ? (
              <Button
                nativeButton={false}
                render={
                  <Link
                    href={`/roles/people/duties?person=${encodeURIComponent(person.identity.userId)}&returnTo=${encodeURIComponent(returnHref)}`}
                  />
                }
                role="link"
                variant="primary"
              >
                編輯職務
              </Button>
            ) : null
          }
          key={`${person.identity.userId}:${person.duties.page}`}
          busy={busy}
          groupCount={person.duties.groupCount}
          groups={person.duties.groups}
          hasNextPage={person.duties.hasNextPage}
          onPageChange={onDutyPageChange}
          onProgramPageChange={onProgramPageChange}
          page={person.duties.page}
          pageSize={person.duties.pageSize}
          status={person.duties.status}
        />
      </div>

      {person.global ? (
        <section aria-labelledby="person-account-heading" className="mt-6">
          <h3 className="text-section" id="person-account-heading">
            帳戶身份與委派
          </h3>
          <dl className="mt-3 space-y-3 wrap-anywhere">
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-baseline gap-4">
              <dt className="text-meta text-muted-foreground">帳戶身份</dt>
              <dd className="text-meta font-[650]">
                {roleLabels[person.global.role]}
              </dd>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-baseline gap-4">
              <dt className="text-meta text-muted-foreground">職務指派權</dt>
              <dd className="text-meta">
                {person.global.roleAssignerAssignment ? "已委派" : "未委派"}
              </dd>
            </div>
            {person.global.role !== "admin" &&
            person.global.permanentCredential !== "usable" ? (
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-baseline gap-4">
                <dt className="text-meta text-muted-foreground">登入密碼</dt>
                <dd className="text-meta">
                  {person.global.permanentCredential === "missing"
                    ? "未有可用永久密碼"
                    : "仍須首次更改密碼"}
                </dd>
              </div>
            ) : null}
          </dl>
          {person.global.role === "admin" ? (
            <p className="text-meta text-muted-foreground mt-3" role="status">
              管理員身份變更後，此帳戶須重新登入；授權人的登入不受影響。
            </p>
          ) : null}
          {person.capabilities.canManageAccountRole ||
          person.capabilities.canManageRoleAssigner ? (
            <p className="text-meta text-muted-foreground mt-3">
              帳戶身份與職務指派權分開處理；相關操作會另行確認。
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-3">
            {person.capabilities.canManageAccountRole ? (
              <Button
                nativeButton={false}
                role="link"
                variant="primary"
                render={
                  <Link
                    href={`/roles/people/identity?person=${encodeURIComponent(person.identity.userId)}&returnTo=${encodeURIComponent(returnHref)}`}
                  />
                }
              >
                管理帳戶身份
              </Button>
            ) : null}
            {person.capabilities.canManageRoleAssigner ? (
              <Button
                nativeButton={false}
                role="link"
                variant="primary"
                render={
                  <Link
                    href={`/roles/people/delegation?person=${encodeURIComponent(person.identity.userId)}&returnTo=${encodeURIComponent(returnHref)}`}
                  />
                }
              >
                管理職務指派權
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}
    </article>
  );
};
