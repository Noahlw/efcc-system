import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

import type { ProgramLeaderRoster } from "../program-leader-contract";
import type {
  ProgramLeaderDepartmentPage,
  ProgramLeaderProgram,
} from "./program-leader-api";

export interface DepartmentProgramLeaderNotice {
  kind: "alert" | "status";
  text: string;
}

export const DepartmentProgramLeaderNoticeView = ({
  notice,
}: {
  notice: DepartmentProgramLeaderNotice | null;
}) =>
  notice ? (
    <p
      aria-live={notice.kind === "alert" ? "assertive" : "polite"}
      className={
        notice.kind === "alert"
          ? "text-body border-border bg-muted mt-4 rounded-lg border p-3"
          : "text-body text-muted-foreground mt-4"
      }
      role={notice.kind}
    >
      {notice.text}
    </p>
  ) : null;

const ScopePagination = ({
  busy,
  page,
  hasMore,
  label,
  previous,
  next,
}: {
  busy: boolean;
  page: number;
  hasMore: boolean;
  label: string;
  previous: () => Promise<void>;
  next: () => Promise<void>;
}) =>
  page > 1 || hasMore ? (
    <nav aria-label={`${label}分頁`} className="mt-4 flex flex-wrap gap-3">
      <Button
        variant="secondary"
        type="button"
        disabled={busy || page <= 1}
        onClick={previous}
      >
        上一頁{label}
      </Button>
      <Button
        variant="secondary"
        type="button"
        disabled={busy || !hasMore}
        onClick={next}
      >
        下一頁{label}
      </Button>
    </nav>
  ) : null;

const ScopeEmpty = ({
  busy,
  known,
  page,
  label,
  message,
}: {
  busy: boolean;
  known: boolean;
  page: number;
  label: string;
  message: string;
}) =>
  busy || !known ? null : (
    <p className="text-muted-foreground mt-4">
      {page > 1 ? `此頁沒有${label}，請返回上一頁。` : message}
    </p>
  );

export const DepartmentProgramLeaderScopeView = ({
  busy,
  global,
  known,
  departments,
  hasMoreDepartments,
  hasMorePrograms,
  onMoreDepartments,
  onMorePrograms,
  onPreviousDepartments,
  onPreviousPrograms,
  departmentPage,
  programPage,
  departmentName,
  canChangeDepartment,
  onProgramChange,
  onDepartmentChange,
  programs,
  selectedDepartmentId,
  selectedProgramId,
}: {
  busy: boolean;
  global: boolean;
  known: boolean;
  departments: ProgramLeaderDepartmentPage["departments"];
  hasMoreDepartments: boolean;
  hasMorePrograms: boolean;
  onMoreDepartments: () => Promise<void>;
  onMorePrograms: () => Promise<void>;
  onPreviousDepartments: () => Promise<void>;
  onPreviousPrograms: () => Promise<void>;
  departmentPage: number;
  programPage: number;
  departmentName: string;
  canChangeDepartment: boolean;
  onProgramChange: (programId: string) => void;
  onDepartmentChange: (departmentId: string) => void;
  programs: ProgramLeaderProgram[];
  selectedDepartmentId: string;
  selectedProgramId: string;
}) => {
  if (selectedProgramId) {
    return null;
  }
  if (selectedDepartmentId || global) {
    return (
      <section aria-label={global ? "可管理的聚會" : `${departmentName}的聚會`}>
        <div className="flex min-w-0 items-start justify-between gap-3">
          <h2 className="text-section min-w-0 wrap-anywhere">
            {global ? "選擇聚會" : departmentName}
          </h2>
          {!global && canChangeDepartment ? (
            <Button
              variant="secondary"
              type="button"
              disabled={busy}
              onClick={() => onDepartmentChange("")}
            >
              更換部門
            </Button>
          ) : null}
        </div>
        {programs.length > 0 ? (
          <ul className="border-border divide-border mt-4 divide-y border-y">
            {programs.map((program) => (
              <li key={program.id}>
                <Button
                  variant="quiet"
                  type="button"
                  disabled={busy}
                  className="flex min-h-14 w-full items-center justify-between! gap-3 rounded-none px-0 py-3 text-left"
                  aria-label={`管理${program.name}的負責人`}
                  onClick={() => onProgramChange(program.id)}
                >
                  <span className="min-w-0 wrap-anywhere">
                    {program.name}
                    {global ? (
                      <span className="text-meta text-muted-foreground mt-1 block">
                        {program.departmentName}
                      </span>
                    ) : null}
                  </span>
                  <Icon name="chevron-right" className="size-5 shrink-0" />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <ScopeEmpty
            busy={busy}
            known={known}
            page={programPage}
            label="聚會"
            message={
              global ? "目前沒有可管理的聚會。" : "此部門暫時未有可管理的聚會。"
            }
          />
        )}
        <ScopePagination
          busy={busy}
          page={programPage}
          hasMore={hasMorePrograms}
          label="聚會"
          previous={onPreviousPrograms}
          next={onMorePrograms}
        />
      </section>
    );
  }
  return (
    <section aria-label="可管理的部門">
      {departments.length > 0 ? (
        <ul className="border-border divide-border mt-4 divide-y border-y">
          {departments.map((department) => (
            <li key={department.id}>
              <Button
                variant="quiet"
                type="button"
                disabled={busy}
                className="flex min-h-14 w-full items-center justify-between! gap-3 rounded-none px-0 py-3 text-left"
                aria-label={`進入${department.name}`}
                onClick={() => onDepartmentChange(department.id)}
              >
                <span className="min-w-0 wrap-anywhere">{department.name}</span>
                <Icon name="chevron-right" className="size-5 shrink-0" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <ScopeEmpty
          busy={busy}
          known={known}
          page={departmentPage}
          label="部門"
          message="目前沒有可管理的部門。"
        />
      )}
      <ScopePagination
        busy={busy}
        page={departmentPage}
        hasMore={hasMoreDepartments}
        label="部門"
        previous={onPreviousDepartments}
        next={onMoreDepartments}
      />
    </section>
  );
};

export const DepartmentProgramLeaderRosterView = ({
  busy,
  known,
  hasMore,
  onMore,
  onPrevious,
  page,
  roster,
  editHref,
  onAdd,
}: {
  busy: boolean;
  known: boolean;
  hasMore: boolean;
  onMore: () => Promise<void>;
  onPrevious: () => Promise<void>;
  page: number;
  roster: ProgramLeaderRoster["leaders"];
  editHref: (leader: ProgramLeaderRoster["leaders"][number]) => string;
  onAdd: () => void;
}) => (
  <section aria-label="現任負責人" className="mt-7">
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-section">現任負責人</h2>
      {known ? (
        <Button
          variant="quiet"
          type="button"
          className="size-11 shrink-0"
          disabled={busy}
          aria-label="指派負責人"
          onClick={onAdd}
        >
          <Icon name="plus" className="size-5" />
        </Button>
      ) : null}
    </div>
    {roster.length > 0 ? (
      <ul className="border-border divide-border mt-3 divide-y border-y">
        {roster.map((leader) => (
          <li
            className="flex min-h-14 min-w-0 items-center justify-between gap-3 py-3"
            key={leader.assignmentId}
          >
            <div className="min-w-0">
              <p className="text-body font-semibold wrap-anywhere">
                {leader.fullName}
              </p>
              <p className="text-muted-foreground mt-1 break-all">
                {leader.username ?? "未設定 Username"}
              </p>
            </div>
            {leader.eligibleForWithdrawal ? (
              <Button
                variant="quiet"
                disabled={busy}
                className="size-11 shrink-0"
                role="link"
                aria-label={`編輯${leader.fullName}（${leader.username ?? "未設定 Username"}）的聚會職務`}
                render={<Link href={editHref(leader)} prefetch={false} />}
              >
                <Icon name="settings" className="size-5" />
              </Button>
            ) : (
              <span className="text-meta text-muted-foreground">
                需要管理員處理
              </span>
            )}
          </li>
        ))}
      </ul>
    ) : (
      <ScopeEmpty
        busy={busy}
        known={known}
        page={page}
        label="負責人"
        message="尚未指派負責人。"
      />
    )}
    <ScopePagination
      busy={busy}
      page={page}
      hasMore={hasMore}
      label="負責人"
      previous={onPrevious}
      next={onMore}
    />
  </section>
);
