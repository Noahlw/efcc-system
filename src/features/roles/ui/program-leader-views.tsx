import type { FormEvent } from "react";

import type {
  ProgramLeaderAssignment,
  ProgramLeaderCandidate,
  ProgramLeaderPerson,
  ProgramLeaderProgram,
} from "./program-leader-api";

export type ProgramLeaderActionDraft =
  | { action: "granted"; scopeId: string; scopeName: string }
  | { action: "withdrawn"; assignment: ProgramLeaderAssignment };

export interface ProgramLeaderNotice {
  kind: "alert" | "status";
  text: string;
}

export const ProgramLeaderNoticeView = ({
  notice,
}: {
  notice: ProgramLeaderNotice | null;
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

export const ProgramLeaderSearchView = ({
  busy,
  candidates,
  hasMore,
  onMore,
  onQueryChange,
  onSearch,
  onSelect,
  query,
  searchBusy,
}: {
  busy: boolean;
  candidates: ProgramLeaderCandidate[];
  hasMore: boolean;
  onMore: () => Promise<void>;
  onQueryChange: (value: string) => void;
  onSearch: (event: FormEvent<HTMLFormElement>) => void;
  onSelect: (userId: string) => void;
  query: string;
  searchBusy: boolean;
}) => (
  <section aria-labelledby="program-leader-search-heading">
    <h2 className="text-section" id="program-leader-search-heading">
      搜尋人士
    </h2>
    <form className="mt-4 flex flex-col gap-3 sm:flex-row" onSubmit={onSearch}>
      <label className="text-body flex-1" htmlFor="program-leader-search">
        姓名或 Username
        <input
          autoComplete="off"
          className="border-input-border bg-surface text-foreground mt-1 min-h-[52px] w-full rounded-[10px] border px-[14px] py-3 focus-visible:outline-2 disabled:opacity-60"
          disabled={busy}
          id="program-leader-search"
          onChange={(event) => onQueryChange(event.currentTarget.value)}
          value={query}
        />
      </label>
      <button
        className="bg-primary text-primary-foreground text-body min-h-11 self-end rounded-[10px] px-5 py-2 font-semibold focus-visible:outline-2 disabled:opacity-60"
        disabled={busy || !query.trim()}
        type="submit"
      >
        {searchBusy ? "搜尋中…" : "搜尋"}
      </button>
    </form>
    {candidates.length > 0 ? (
      <ul
        aria-label="搜尋結果"
        className="border-border mt-5 divide-y border-y"
      >
        {candidates.map((candidate) => (
          <li key={candidate.userId}>
            <button
              className="text-body focus-visible:outline-primary flex min-h-14 w-full items-center justify-between gap-3 py-3 text-left focus-visible:outline-2"
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
        更多人士
      </button>
    ) : null}
  </section>
);

export const ProgramLeaderPersonView = ({
  busy,
  hasMoreAssignments,
  hasMorePrograms,
  onGrant,
  onMoreAssignments,
  onMorePrograms,
  onProgramChange,
  onWithdraw,
  pending,
  person,
  programs,
  selectedProgramId,
}: {
  busy: boolean;
  hasMoreAssignments: boolean;
  hasMorePrograms: boolean;
  onGrant: () => void;
  onMoreAssignments: () => Promise<void>;
  onMorePrograms: () => Promise<void>;
  onProgramChange: (programId: string) => void;
  onWithdraw: (assignment: ProgramLeaderAssignment) => void;
  pending: boolean;
  person: ProgramLeaderPerson;
  programs: ProgramLeaderProgram[];
  selectedProgramId: string;
}) => (
  <section
    aria-labelledby="program-leader-person-heading"
    className="border-border mt-8 border-t pt-6"
  >
    <h2 className="text-section" id="program-leader-person-heading">
      人士資料
    </h2>
    <h3 className="text-body mt-4 font-semibold">{person.fullName}</h3>
    <dl className="border-border text-body mt-3 grid grid-cols-1 gap-x-4 border-y py-3 sm:grid-cols-[minmax(5rem,0.5fr)_minmax(0,1.5fr)]">
      <dt className="text-muted-foreground">Username</dt>
      <dd className="break-all">{person.username ?? "未設定"}</dd>
    </dl>
    <section
      aria-labelledby="program-leader-assignments-heading"
      className="mt-6"
    >
      <h3
        className="text-label font-semibold"
        id="program-leader-assignments-heading"
      >
        現有 Program Leader 職務
      </h3>
      {person.assignments.length > 0 ? (
        <ul className="border-border mt-2 divide-y border-y">
          {person.assignments.map((assignment) => (
            <li
              className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"
              key={assignment.assignmentId}
            >
              <span className="text-body">
                {assignment.departmentName} · {assignment.scopeName}
              </span>
              <button
                className="border-border text-body min-h-11 self-start rounded-lg border px-4 focus-visible:outline-2 disabled:opacity-60 sm:self-auto"
                disabled={busy || pending}
                onClick={() => onWithdraw(assignment)}
                type="button"
              >
                撤回 Program Leader
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body text-muted-foreground mt-2">
          此人士目前沒有 Program Leader 職務。
        </p>
      )}
      {hasMoreAssignments ? (
        <button
          className="border-border text-body mt-3 min-h-11 rounded-lg border px-4 focus-visible:outline-2 disabled:opacity-60"
          disabled={busy}
          onClick={onMoreAssignments}
          type="button"
        >
          更多現有職務
        </button>
      ) : null}
    </section>
    <section
      aria-labelledby="program-leader-grant-heading"
      className="border-border mt-6 border-t pt-5"
    >
      <h3
        className="text-label font-semibold"
        id="program-leader-grant-heading"
      >
        授予 Program Leader 職務
      </h3>
      {person.eligibleForGrant ? null : (
        <p className="text-body text-muted-foreground mt-2">
          此人士目前不符合新增條件；如有現有職務，仍可按需要撤回。
        </p>
      )}
      <label className="text-body mt-4 block" htmlFor="program-leader-scope">
        聚會
        <select
          className="border-input-border bg-surface text-foreground mt-1 min-h-[52px] w-full rounded-[10px] border px-[14px] py-3 focus-visible:outline-2 disabled:opacity-60"
          disabled={busy || pending || !person.eligibleForGrant}
          id="program-leader-scope"
          onChange={(event) => onProgramChange(event.currentTarget.value)}
          value={selectedProgramId}
        >
          <option value="">請選擇聚會</option>
          {programs.map((program) => (
            <option
              disabled={person.assignments.some(
                (assignment) => assignment.scopeId === program.id
              )}
              key={program.id}
              value={program.id}
            >
              {program.departmentName} · {program.name}
            </option>
          ))}
        </select>
      </label>
      {programs.length === 0 ? (
        <p className="text-body text-muted-foreground mt-2">
          目前沒有可選的聚會。
        </p>
      ) : null}
      {hasMorePrograms ? (
        <button
          className="border-border text-body mt-3 min-h-11 rounded-lg border px-4 focus-visible:outline-2 disabled:opacity-60"
          disabled={busy}
          onClick={onMorePrograms}
          type="button"
        >
          更多聚會
        </button>
      ) : null}
      <button
        className="bg-primary text-primary-foreground text-body mt-4 min-h-11 w-full rounded-[10px] px-4 py-2 font-semibold focus-visible:outline-2 disabled:opacity-60 sm:w-auto"
        disabled={
          busy || pending || !person.eligibleForGrant || !selectedProgramId
        }
        onClick={onGrant}
        type="button"
      >
        授予 Program Leader
      </button>
    </section>
  </section>
);

export const ProgramLeaderActionReview = ({
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
  review: ProgramLeaderActionDraft;
}) => (
  <form
    aria-labelledby="program-leader-review-heading"
    className="border-border mt-6 rounded-xl border p-4"
    onSubmit={onSubmit}
  >
    <h3 className="text-label font-semibold" id="program-leader-review-heading">
      確認操作
    </h3>
    <p className="text-body mt-2">
      {review.action === "granted" ? "確定要授予" : "確定要撤回"}「{personName}
      」在「
      {review.action === "granted"
        ? review.scopeName
        : review.assignment.scopeName}
      」的 Program Leader 職務。
    </p>
    <label className="text-body mt-4 block" htmlFor="program-leader-password">
      目前密碼
      <input
        autoComplete="current-password"
        className="border-input-border bg-surface text-foreground focus-visible:border-primary mt-1 min-h-[52px] w-full rounded-[10px] border px-[14px] py-3 leading-[1.5] focus-visible:outline-2 disabled:opacity-60"
        disabled={busy}
        id="program-leader-password"
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

export const ProgramLeaderPendingView = ({
  busy,
  onReconcile,
}: {
  busy: boolean;
  onReconcile: () => Promise<void>;
}) => (
  <section
    aria-labelledby="program-leader-pending-heading"
    className="border-border mt-6 rounded-xl border p-4"
  >
    <h3
      className="text-label font-semibold"
      id="program-leader-pending-heading"
    >
      待查核操作
    </h3>
    <p className="text-body text-muted-foreground mt-2">
      上一項操作結果未能確認。請查核結果後再開始其他操作。
    </p>
    <button
      className="bg-primary text-primary-foreground text-body mt-4 min-h-11 rounded-[10px] px-4 py-2 font-semibold focus-visible:outline-2 disabled:opacity-60"
      disabled={busy}
      onClick={onReconcile}
      type="button"
    >
      查核操作結果
    </button>
  </section>
);
