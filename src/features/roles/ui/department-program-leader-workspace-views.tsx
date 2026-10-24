import type { FormEvent } from "react";

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

export const DepartmentProgramLeaderScopeView = ({
  busy,
  departments,
  hasMoreDepartments,
  hasMorePrograms,
  onMoreDepartments,
  onMorePrograms,
  onProgramChange,
  onDepartmentChange,
  programs,
  selectedDepartmentId,
  selectedProgramId,
}: {
  busy: boolean;
  departments: ProgramLeaderDepartmentPage["departments"];
  hasMoreDepartments: boolean;
  hasMorePrograms: boolean;
  onMoreDepartments: () => Promise<void>;
  onMorePrograms: () => Promise<void>;
  onProgramChange: (programId: string) => void;
  onDepartmentChange: (departmentId: string) => void;
  programs: ProgramLeaderProgram[];
  selectedDepartmentId: string;
  selectedProgramId: string;
}) => (
  <section aria-labelledby="department-program-leader-scope-heading">
    <h2 className="text-section" id="department-program-leader-scope-heading">
      管理範圍
    </h2>
    <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
      <label
        className="text-body"
        htmlFor="department-program-leader-department"
      >
        部門
        <select
          className={controlClass}
          disabled={busy}
          id="department-program-leader-department"
          onChange={(event) => onDepartmentChange(event.currentTarget.value)}
          value={selectedDepartmentId}
        >
          <option value="">請選擇部門</option>
          {departments.map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-body" htmlFor="department-program-leader-program">
        聚會
        <select
          className={controlClass}
          disabled={busy || !selectedDepartmentId}
          id="department-program-leader-program"
          onChange={(event) => onProgramChange(event.currentTarget.value)}
          value={selectedProgramId}
        >
          <option value="">請選擇聚會</option>
          {programs.map((program) => (
            <option key={program.id} value={program.id}>
              {program.name}
            </option>
          ))}
        </select>
      </label>
    </div>
    {hasMoreDepartments ? (
      <button
        className="border-border text-body mt-3 min-h-11 rounded-lg border px-4 focus-visible:outline-2 disabled:opacity-60"
        disabled={busy}
        onClick={onMoreDepartments}
        type="button"
      >
        更多部門
      </button>
    ) : null}
    {selectedDepartmentId && hasMorePrograms ? (
      <button
        className="border-border text-body mt-3 ml-2 min-h-11 rounded-lg border px-4 focus-visible:outline-2 disabled:opacity-60"
        disabled={busy}
        onClick={onMorePrograms}
        type="button"
      >
        更多聚會
      </button>
    ) : null}
  </section>
);

export const DepartmentProgramLeaderRosterView = ({
  busy,
  hasMore,
  onMore,
  roster,
}: {
  busy: boolean;
  hasMore: boolean;
  onMore: () => Promise<void>;
  roster: ProgramLeaderRosterPage["leaders"];
}) => (
  <section
    aria-label="現任 Program Leader"
    className="border-border mt-7 border-t pt-6"
  >
    <h2 className="text-section">現任 Program Leader</h2>
    {roster.length > 0 ? (
      <ul className="border-border mt-3 divide-y border-y">
        {roster.map((leader) => (
          <li
            className="flex min-h-14 flex-col justify-center gap-1 py-3"
            key={leader.assignmentId}
          >
            <span className="text-body font-semibold">{leader.fullName}</span>
            <dl className="text-meta grid grid-cols-1 gap-x-3 sm:grid-cols-[max-content_minmax(0,1fr)]">
              <dt className="text-muted-foreground">Username</dt>
              <dd className="break-all">
                {leader.username ?? "未設定 Username"}
              </dd>
            </dl>
          </li>
        ))}
      </ul>
    ) : (
      <p className="text-body text-muted-foreground mt-3">
        此聚會目前沒有現任 Program Leader。
      </p>
    )}
    {hasMore ? (
      <button
        className="border-border text-body mt-3 min-h-11 rounded-lg border px-4 focus-visible:outline-2 disabled:opacity-60"
        disabled={busy}
        onClick={onMore}
        type="button"
      >
        更多現任職務
      </button>
    ) : null}
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
