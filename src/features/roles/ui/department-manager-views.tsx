import type { FormEvent } from "react";

import type {
  DepartmentManagerAssignment,
  DepartmentManagerCandidate,
  DepartmentManagerDepartmentPage,
  DepartmentManagerPerson,
} from "./department-manager-api";

export interface DepartmentManagerNotice {
  kind: "alert" | "status";
  text: string;
}

export type DepartmentManagerActionDraft =
  | { action: "granted"; scopeId: string; scopeName: string }
  | { action: "withdrawn"; assignment: DepartmentManagerAssignment };

export const DepartmentManagerNoticeView = ({
  actorReady,
  notice,
  onReload,
}: {
  actorReady: boolean;
  notice: DepartmentManagerNotice | null;
  onReload: () => void;
}) =>
  notice ? (
    <div
      className={`text-body mb-5 rounded-lg p-4 ${
        notice.kind === "alert"
          ? "bg-warning-surface text-warning"
          : "bg-background text-foreground"
      }`}
      role={notice.kind}
    >
      {notice.text}
      {actorReady ? null : (
        <button
          className="ml-3 min-h-11 underline focus-visible:outline-2"
          onClick={onReload}
          type="button"
        >
          重新載入
        </button>
      )}
    </div>
  ) : null;

export const DepartmentManagerPendingView = ({
  actorReady,
  busy,
  onReconcile,
}: {
  actorReady: boolean;
  busy: boolean;
  onReconcile: () => Promise<void>;
}) => (
  <section
    aria-labelledby="department-manager-pending-heading"
    className="border-border mb-8 rounded-xl border p-4"
  >
    <h2 className="text-section" id="department-manager-pending-heading">
      操作結果未確定
    </h2>
    <p className="text-body mt-2">
      請查核原操作結果。確認前，暫停其他部門主管操作。
    </p>
    <button
      className="bg-primary text-primary-foreground text-body mt-4 min-h-11 rounded-lg px-4 py-2 font-semibold focus-visible:outline-2 disabled:opacity-60"
      disabled={busy || !actorReady}
      onClick={onReconcile}
      type="button"
    >
      查核操作結果
    </button>
  </section>
);

export const DepartmentManagerSearchView = ({
  actorReady,
  busy,
  candidates,
  hasMoreCandidates,
  onMore,
  onQueryChange,
  onSearch,
  onSelect,
  query,
  searchBusy,
}: {
  actorReady: boolean;
  busy: boolean;
  candidates: DepartmentManagerCandidate[];
  hasMoreCandidates: boolean;
  onMore: () => Promise<void>;
  onQueryChange: (value: string) => void;
  onSearch: (event: FormEvent<HTMLFormElement>) => void;
  onSelect: (userId: string) => Promise<void>;
  query: string;
  searchBusy: boolean;
}) => (
  <section
    aria-busy={searchBusy}
    aria-labelledby="department-manager-search-heading"
  >
    <h2 className="text-section" id="department-manager-search-heading">
      搜尋人士
    </h2>
    <form className="mt-3 flex flex-col gap-3 sm:flex-row" onSubmit={onSearch}>
      <label className="text-body flex-1" htmlFor="department-manager-query">
        搜尋姓名或 Username
        <input
          autoComplete="off"
          className="border-input-border bg-surface text-foreground focus-visible:border-primary mt-1 min-h-[52px] w-full rounded-[10px] border px-[14px] py-3 leading-[1.5] focus-visible:outline-2 disabled:opacity-60"
          disabled={!actorReady || busy}
          id="department-manager-query"
          maxLength={80}
          name="query"
          onChange={(event) => onQueryChange(event.currentTarget.value)}
          value={query}
        />
      </label>
      <button
        className="bg-primary text-primary-foreground text-body min-h-[52px] rounded-[10px] px-5 font-semibold focus-visible:outline-2 disabled:opacity-60 sm:mt-7"
        disabled={!actorReady || busy}
        type="submit"
      >
        搜尋
      </button>
    </form>

    {candidates.length > 0 ? (
      <ul aria-label="搜尋結果" className="border-border mt-4 border-t">
        {candidates.map((candidate) => (
          <li className="border-border border-b" key={candidate.userId}>
            <button
              className="text-body flex min-h-14 w-full flex-col items-start justify-center py-3 text-left focus-visible:outline-2 disabled:opacity-60"
              disabled={busy}
              onClick={() => onSelect(candidate.userId)}
              type="button"
            >
              <span className="font-semibold">{candidate.fullName}</span>
              <span className="text-meta text-muted-foreground mt-1">
                Username：{candidate.username ?? "未設定"}
              </span>
            </button>
          </li>
        ))}
      </ul>
    ) : null}
    {hasMoreCandidates ? (
      <button
        className="border-border text-body mt-3 min-h-11 rounded-lg border px-4 focus-visible:outline-2 disabled:opacity-60"
        disabled={busy}
        onClick={onMore}
        type="button"
      >
        更多搜尋結果
      </button>
    ) : null}
  </section>
);

const DepartmentManagerAssignments = ({
  assignments,
  busy,
  hasNextPage,
  onMore,
  onWithdraw,
  page,
  pending,
}: {
  assignments: DepartmentManagerAssignment[];
  busy: boolean;
  hasNextPage: boolean;
  onMore: () => Promise<void>;
  onWithdraw: (assignment: DepartmentManagerAssignment) => void;
  page: number;
  pending: boolean;
}) => (
  <div className="mt-6">
    <h3 className="text-label font-semibold">現有部門主管職務</h3>
    {assignments.length > 0 ? (
      <ul className="border-border mt-3 border-t">
        {assignments.map((assignment) => (
          <li
            className="border-border flex min-h-14 flex-wrap items-center justify-between gap-3 border-b py-3"
            key={assignment.assignmentId}
          >
            <span className="text-body">{assignment.scopeName}</span>
            <button
              className="text-body text-danger min-h-11 min-w-11 rounded-lg px-3 font-semibold underline focus-visible:outline-2 disabled:opacity-60"
              disabled={busy || pending}
              onClick={() => onWithdraw(assignment)}
              type="button"
            >
              撤回部門主管
            </button>
          </li>
        ))}
      </ul>
    ) : (
      <p className="text-body text-muted-foreground mt-2">
        目前沒有部門主管職務。
      </p>
    )}
    {hasNextPage ? (
      <button
        className="border-border text-body mt-3 min-h-11 rounded-lg border px-4 focus-visible:outline-2 disabled:opacity-60"
        disabled={busy}
        onClick={onMore}
        type="button"
      >
        更多現有職務
      </button>
    ) : null}
    <span className="sr-only">目前顯示第 {page} 頁</span>
  </div>
);

const DepartmentManagerGrantForm = ({
  actorReady,
  assignments,
  busy,
  departments,
  eligible,
  hasMoreDepartments,
  onChange,
  onGrant,
  onMoreDepartments,
  pending,
  selectedDepartmentId,
}: {
  actorReady: boolean;
  assignments: DepartmentManagerAssignment[];
  busy: boolean;
  departments: DepartmentManagerDepartmentPage["departments"];
  eligible: boolean;
  hasMoreDepartments: boolean;
  onChange: (departmentId: string) => void;
  onGrant: () => void;
  onMoreDepartments: () => Promise<void>;
  pending: boolean;
  selectedDepartmentId: string;
}) => (
  <section
    aria-labelledby="department-manager-grant-heading"
    className="border-border mt-6 border-t pt-5"
  >
    <h3
      className="text-label font-semibold"
      id="department-manager-grant-heading"
    >
      授予部門主管職務
    </h3>
    {eligible ? null : (
      <p className="text-body text-muted-foreground mt-2">
        此人士目前不符合新增條件；如有現有職務，仍可按需要撤回。
      </p>
    )}
    <label className="text-body mt-4 block" htmlFor="department-manager-scope">
      部門
      <select
        className="border-input-border bg-surface text-foreground mt-1 min-h-[52px] w-full rounded-[10px] border px-[14px] py-3 focus-visible:outline-2 disabled:opacity-60"
        disabled={!actorReady || busy || !eligible || pending}
        id="department-manager-scope"
        onChange={(event) => onChange(event.currentTarget.value)}
        value={selectedDepartmentId}
      >
        <option value="">請選擇部門</option>
        {departments.map((department) => (
          <option
            disabled={assignments.some(
              (assignment) => assignment.scopeId === department.id
            )}
            key={department.id}
            value={department.id}
          >
            {department.name}
          </option>
        ))}
      </select>
    </label>
    {departments.length === 0 ? (
      <p className="text-body text-muted-foreground mt-2">
        目前沒有可選的部門。
      </p>
    ) : null}
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
    <button
      className="bg-primary text-primary-foreground text-body mt-4 min-h-11 w-full rounded-[10px] px-4 py-2 font-semibold focus-visible:outline-2 disabled:opacity-60 sm:w-auto"
      disabled={
        !actorReady || busy || !eligible || !selectedDepartmentId || pending
      }
      onClick={onGrant}
      type="button"
    >
      授予部門主管
    </button>
  </section>
);

export const DepartmentManagerPersonView = ({
  actorReady,
  hasMoreDepartments,
  busy,
  departments,
  onDepartmentChange,
  onGrant,
  onMoreAssignments,
  onMoreDepartments,
  onWithdraw,
  pending,
  person,
  personBusy,
  selectedDepartmentId,
}: {
  actorReady: boolean;
  hasMoreDepartments: boolean;
  busy: boolean;
  departments: DepartmentManagerDepartmentPage["departments"];
  onDepartmentChange: (departmentId: string) => void;
  onGrant: () => void;
  onMoreAssignments: () => Promise<void>;
  onMoreDepartments: () => Promise<void>;
  onWithdraw: (assignment: DepartmentManagerAssignment) => void;
  pending: boolean;
  person: DepartmentManagerPerson;
  personBusy: boolean;
  selectedDepartmentId: string;
}) => (
  <section
    aria-busy={personBusy}
    aria-labelledby="department-manager-person-heading"
    className="border-border mt-8 border-t pt-6"
  >
    <h2 className="text-section" id="department-manager-person-heading">
      人士資料
    </h2>
    <h3 className="text-body mt-4 font-semibold">{person.fullName}</h3>
    <dl className="border-border text-body mt-3 grid grid-cols-1 gap-x-4 border-y py-3 sm:grid-cols-[minmax(5rem,0.5fr)_minmax(0,1.5fr)]">
      <dt className="text-muted-foreground">Username</dt>
      <dd className="break-all">{person.username ?? "未設定"}</dd>
    </dl>
    <DepartmentManagerAssignments
      assignments={person.assignments}
      busy={busy}
      hasNextPage={person.assignmentPage.hasNextPage}
      onMore={onMoreAssignments}
      onWithdraw={onWithdraw}
      page={person.assignmentPage.number}
      pending={pending}
    />
    <DepartmentManagerGrantForm
      actorReady={actorReady}
      assignments={person.assignments}
      busy={busy}
      departments={departments}
      eligible={person.eligibleForGrant}
      hasMoreDepartments={hasMoreDepartments}
      onChange={onDepartmentChange}
      onGrant={onGrant}
      onMoreDepartments={onMoreDepartments}
      pending={pending}
      selectedDepartmentId={selectedDepartmentId}
    />
  </section>
);

export const DepartmentManagerActionReview = ({
  busy,
  onCancel,
  onPasswordChange,
  onSubmit,
  password,
  personName,
  review,
}: {
  busy: boolean;
  onCancel: () => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  password: string;
  personName: string;
  review: DepartmentManagerActionDraft;
}) => (
  <form
    aria-labelledby="department-manager-review-heading"
    className="border-border mt-6 rounded-xl border p-4"
    onSubmit={onSubmit}
  >
    <h3
      className="text-label font-semibold"
      id="department-manager-review-heading"
    >
      確認操作
    </h3>
    <p className="text-body mt-2">
      {review.action === "granted" ? "確定要授予" : "確定要撤回"}「{personName}
      」在「
      {review.action === "granted"
        ? review.scopeName
        : review.assignment.scopeName}
      」的部門主管職務。
    </p>
    <label
      className="text-body mt-4 block"
      htmlFor="department-manager-password"
    >
      目前密碼
      <input
        autoComplete="current-password"
        className="border-input-border bg-surface text-foreground focus-visible:border-primary mt-1 min-h-[52px] w-full rounded-[10px] border px-[14px] py-3 leading-[1.5] focus-visible:outline-2 disabled:opacity-60"
        disabled={busy}
        id="department-manager-password"
        onChange={(event) => onPasswordChange(event.currentTarget.value)}
        required
        type="password"
        value={password}
      />
    </label>
    <div className="mt-4 flex flex-col gap-3 sm:flex-row">
      <button
        className="bg-primary text-primary-foreground text-body min-h-11 rounded-[10px] px-4 py-2 font-semibold focus-visible:outline-2 disabled:opacity-60"
        disabled={busy || !password}
        type="submit"
      >
        {review.action === "granted" ? "確認並授予" : "確認並撤回"}
      </button>
      <button
        className="border-border text-body min-h-11 rounded-[10px] border px-4 py-2 focus-visible:outline-2 disabled:opacity-60"
        disabled={busy}
        onClick={onCancel}
        type="button"
      >
        取消
      </button>
    </div>
  </form>
);
