import Link from "next/link";
import type { FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

import type {
  ProgramLeaderCandidate,
  ProgramLeaderDepartmentPage,
  ProgramLeaderProgram,
  ProgramLeaderRosterPage,
} from "./program-leader-api";

export interface DepartmentProgramLeaderNotice {
  kind: "alert" | "status";
  text: string;
}

const controlClass =
  "border-input-border bg-surface text-foreground mt-1 min-h-[52px] w-full rounded-[10px] border px-[14px] py-3 focus-visible:outline-2 disabled:opacity-60";

const actionClass =
  "bg-primary text-primary-foreground text-body min-h-11 rounded-[10px] px-5 py-2 font-semibold focus-visible:outline-2 disabled:opacity-60";

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
  if (selectedDepartmentId) {
    return (
      <section aria-label={`${departmentName}的聚會`}>
        <div className="flex min-w-0 items-start justify-between gap-3">
          <h2 className="text-section min-w-0 wrap-anywhere">
            {departmentName}
          </h2>
          {canChangeDepartment ? (
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
          <ul className="border-border mt-4 divide-y border-y">
            {programs.map((program) => (
              <li key={program.id}>
                <Button
                  variant="quiet"
                  type="button"
                  disabled={busy}
                  className="flex min-h-14 w-full items-center justify-between gap-3 rounded-none px-0 py-3 text-left"
                  aria-label={`管理${program.name}的負責人`}
                  onClick={() => onProgramChange(program.id)}
                >
                  <span className="min-w-0 wrap-anywhere">{program.name}</span>
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
            message="此部門暫時未有可管理的聚會。"
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
        <ul className="border-border mt-4 divide-y border-y">
          {departments.map((department) => (
            <li key={department.id}>
              <Button
                variant="quiet"
                type="button"
                disabled={busy}
                className="flex min-h-14 w-full items-center justify-between gap-3 rounded-none px-0 py-3 text-left"
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
  grantOpen,
}: {
  busy: boolean;
  known: boolean;
  hasMore: boolean;
  onMore: () => Promise<void>;
  onPrevious: () => Promise<void>;
  page: number;
  roster: ProgramLeaderRosterPage["leaders"];
  editHref: (leader: ProgramLeaderRosterPage["leaders"][number]) => string;
  onAdd: () => void;
  grantOpen: boolean;
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
          aria-expanded={grantOpen}
          aria-controls="program-single-grant"
          onClick={onAdd}
        >
          <Icon name="plus" className="size-5" />
        </Button>
      ) : null}
    </div>
    {roster.length > 0 ? (
      <ul className="border-border mt-3 divide-y border-y">
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
                aria-label={`編輯${leader.fullName}的聚會職務`}
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

export const DepartmentProgramLeaderCandidateView = ({
  busy,
  candidates,
  hasMore,
  onMore,
  onQueryChange,
  onReview,
  onSearch,
  onSelect,
  query,
  selectedCandidateId,
  searchBusy,
}: {
  busy: boolean;
  candidates: ProgramLeaderCandidate[];
  hasMore: boolean;
  onMore: () => Promise<void>;
  onQueryChange: (value: string) => void;
  onReview: () => void;
  onSearch: (event: FormEvent<HTMLFormElement>) => void;
  onSelect: (userId: string) => void;
  query: string;
  selectedCandidateId: string;
  searchBusy: boolean;
}) => (
  <section
    aria-labelledby="department-program-leader-candidate-heading"
    className="border-border mt-7 border-t pt-6"
  >
    <h2
      className="text-section"
      id="department-program-leader-candidate-heading"
    >
      搜尋同部門 Member
    </h2>
    <form className="mt-4 flex flex-col gap-3 sm:flex-row" onSubmit={onSearch}>
      <label
        className="text-body flex-1"
        htmlFor="department-program-leader-search"
      >
        搜尋同部門 Member
        <input
          autoComplete="off"
          className={controlClass}
          disabled={busy}
          id="department-program-leader-search"
          onChange={(event) => onQueryChange(event.currentTarget.value)}
          value={query}
        />
      </label>
      <button
        className={`${actionClass} self-end`}
        disabled={busy || !query.trim()}
        type="submit"
      >
        {searchBusy ? "搜尋中…" : "搜尋"}
      </button>
    </form>
    {candidates.length > 0 ? (
      <ul
        aria-label="候選人搜尋結果"
        className="border-border mt-5 divide-y border-y"
      >
        {candidates.map((candidate) => (
          <li key={candidate.userId}>
            <button
              aria-pressed={selectedCandidateId === candidate.userId}
              className="text-body focus-visible:outline-primary flex min-h-14 w-full items-center justify-between gap-3 py-3 text-left focus-visible:outline-2 disabled:opacity-60"
              disabled={busy}
              onClick={() => onSelect(candidate.userId)}
              type="button"
            >
              <span className="font-semibold">{candidate.fullName}</span>
              <span className="text-muted-foreground text-right break-all">
                {candidate.username ?? "未設定 Username"}
              </span>
            </button>
          </li>
        ))}
      </ul>
    ) : null}
    {hasMore ? (
      <button
        className="border-border text-body mt-3 min-h-11 rounded-lg border px-4 focus-visible:outline-2 disabled:opacity-60"
        disabled={busy}
        onClick={onMore}
        type="button"
      >
        更多候選人
      </button>
    ) : null}
    {selectedCandidateId ? (
      <button
        className={`${actionClass} mt-4 w-full sm:w-auto`}
        disabled={busy}
        onClick={onReview}
        type="button"
      >
        檢視操作
      </button>
    ) : null}
  </section>
);

export const DepartmentProgramLeaderReviewView = ({
  busy,
  candidate,
  departmentName,
  onClose,
  onPasswordChange,
  onSubmit,
  password,
  programName,
}: {
  busy: boolean;
  candidate: ProgramLeaderCandidate;
  departmentName: string;
  onClose: () => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  password: string;
  programName: string;
}) => (
  <div
    aria-labelledby="department-program-leader-review-heading"
    aria-modal="true"
    className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6"
    role="dialog"
  >
    <form
      aria-labelledby="department-program-leader-review-heading"
      className="bg-surface border-border w-full max-w-xl rounded-t-2xl border p-5 shadow-xl sm:rounded-2xl sm:p-6"
      onSubmit={onSubmit}
    >
      <h2
        className="text-section"
        id="department-program-leader-review-heading"
      >
        檢視操作
      </h2>
      <p className="text-body mt-4">
        授予 Program Leader 職務：確定要安排「{candidate.fullName}」負責「
        {departmentName} · {programName}」。
      </p>
      <p className="text-meta text-muted-foreground mt-3">
        提交前會再次核對目前帳戶及部門管理權限。
      </p>
      <label
        className="text-body mt-4 block"
        htmlFor="department-program-leader-password"
      >
        目前密碼
        <input
          autoComplete="current-password"
          className={controlClass}
          disabled={busy}
          id="department-program-leader-password"
          onChange={(event) => onPasswordChange(event.currentTarget.value)}
          required
          type="password"
          value={password}
        />
      </label>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <button
          className={actionClass}
          disabled={busy || !password}
          type="submit"
        >
          確認並提交
        </button>
        <button
          className="border-border text-body min-h-11 rounded-[10px] border px-4 py-2 focus-visible:outline-2 disabled:opacity-60"
          disabled={busy}
          onClick={onClose}
          type="button"
        >
          取消
        </button>
      </div>
    </form>
  </div>
);
