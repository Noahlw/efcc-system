import type { FormEvent, ReactNode } from "react";

import type { GlobalRoleCandidate, GlobalRolePerson } from "./global-role-api";

export interface GlobalRoleNotice {
  kind: "alert" | "status";
  text: string;
}

export type GlobalRoleActionDraft =
  | { action: "granted"; role: "staff" }
  | { action: "withdrawn"; role: "staff" }
  | { action: "granted"; role: "admin" }
  | { action: "granted"; role: "role_assigner" }
  | { action: "withdrawn"; assignmentId: string; role: "role_assigner" };

const GlobalRoleEligibilityNotice = ({
  person,
}: {
  person: GlobalRolePerson;
}) => {
  let message: string | null = null;
  if (person.role === "member" && !person.eligibleForStaff) {
    message = "此人士目前未符合新增職員身份的條件。";
  } else if (person.role === "staff" && !person.eligibleForRoleAssigner) {
    message = "此人士目前未符合新增 Role Assigner 委派的條件。";
  }
  if (!person.eligibleForAdmin) {
    message = message
      ? `${message} 此人士目前亦未符合新增管理員身份的條件。`
      : "此人士目前未符合新增管理員身份的條件。";
  }
  return message ? (
    <p className="text-meta text-muted-foreground mt-4">{message}</p>
  ) : null;
};

const getActionButtonLabel = (review: GlobalRoleActionDraft) => {
  if (review.role === "admin") {
    return "確認並設為管理員";
  }
  if (review.role === "staff") {
    return review.action === "granted" ? "確認並設為職員" : "確認並改為會員";
  }
  return review.action === "granted" ? "確認並委派" : "確認並撤回";
};

const getReviewPrompt = (review: GlobalRoleActionDraft, personName: string) => {
  if (review.role === "admin") {
    return `確定將「${personName}」的全域身份改為管理員？其現有登入工作階段將全部結束。`;
  }
  if (review.role === "staff") {
    const resultingRole = review.action === "granted" ? "職員" : "會員";
    return `確定將「${personName}」的全域身份改為${resultingRole}？`;
  }
  const action = review.action === "granted" ? "委派" : "撤回";
  return `確定要${action}「${personName}」的 Role Assigner 職務？`;
};

const selfStepdownOutcomeText = (
  kind: "complete" | "unknown",
  resultingGlobalRole?: "member" | "staff"
) => {
  if (kind === "complete" && resultingGlobalRole) {
    const roleName = resultingGlobalRole === "member" ? "會員" : "職員";
    return `你已退出管理員身份，現時全域身份為${roleName}。所有登入工作階段已結束，請重新登入。`;
  }
  return "請勿重複提交。此頁的管理資料已清除；請重新登入以繼續使用帳戶。";
};

export const GlobalRoleSelfStepdownOutcome = ({
  kind,
  resultingGlobalRole,
}: {
  kind: "complete" | "unknown";
  resultingGlobalRole?: "member" | "staff";
}) => (
  <section
    aria-label="自願退出管理員身份結果"
    className="border-border rounded-lg border p-4 sm:p-6"
    role={kind === "complete" ? "status" : "alert"}
  >
    <h2 className="text-section">
      {kind === "complete" ? "操作已完成" : "操作結果未能確認"}
    </h2>
    <p className="text-body mt-3">
      {selfStepdownOutcomeText(kind, resultingGlobalRole)}
    </p>
    <a
      className="text-primary mt-4 inline-flex min-h-11 items-center underline focus-visible:outline-2"
      href="/sign-in"
    >
      前往登入
    </a>
  </section>
);

export const GlobalRoleSearchView = ({
  candidates,
  hasMore,
  loading,
  notice,
  onLoadMore,
  onQueryChange,
  onSearch,
  onSelect,
  page,
  query,
  selectedUserId,
}: {
  candidates: GlobalRoleCandidate[];
  hasMore: boolean;
  loading: boolean;
  notice: GlobalRoleNotice | null;
  onLoadMore: () => void;
  onQueryChange: (query: string) => void;
  onSearch: (event: FormEvent<HTMLFormElement>) => void;
  onSelect: (userId: string) => void;
  page: number;
  query: string;
  selectedUserId: string | null;
}) => (
  <section aria-labelledby="global-role-search-heading" className="mb-8">
    <h2 className="text-section" id="global-role-search-heading">
      搜尋人士
    </h2>
    <form className="mt-3 flex flex-col gap-3 sm:flex-row" onSubmit={onSearch}>
      <label className="text-label flex-1" htmlFor="global-role-search">
        姓名或 Username
        <input
          autoComplete="off"
          className="border-border bg-background mt-1 min-h-12 w-full rounded-md border px-3 focus-visible:outline-2"
          disabled={loading}
          id="global-role-search"
          maxLength={100}
          onChange={(event) => onQueryChange(event.currentTarget.value)}
          type="search"
          value={query}
        />
      </label>
      <button
        className="bg-primary text-primary-foreground min-h-12 rounded-md px-5 font-semibold focus-visible:outline-2 disabled:opacity-60"
        disabled={loading || !query.trim()}
        type="submit"
      >
        搜尋
      </button>
    </form>
    {notice ? (
      <p
        className={`mt-3 ${notice.kind === "alert" ? "text-destructive" : "text-muted-foreground"}`}
        role={notice.kind}
      >
        {notice.text}
      </p>
    ) : null}
    {candidates.length > 0 ? (
      <ul
        aria-label="搜尋結果"
        className="border-border mt-4 divide-y border-y"
      >
        {candidates.map((candidate) => (
          <li key={candidate.userId}>
            <button
              aria-pressed={selectedUserId === candidate.userId}
              className="hover:bg-muted focus-visible:outline-primary flex min-h-14 w-full flex-col items-start justify-center gap-1 px-3 text-left focus-visible:outline-2 sm:flex-row sm:items-center sm:justify-between"
              disabled={loading}
              onClick={() => onSelect(candidate.userId)}
              type="button"
            >
              <span className="text-label">{candidate.fullName}</span>
              {candidate.username ? (
                <span className="text-meta text-muted-foreground">
                  {candidate.username}
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    ) : null}
    {hasMore ? (
      <button
        className="text-primary mt-3 min-h-11 rounded-md px-3 underline focus-visible:outline-2 disabled:opacity-60"
        disabled={loading}
        onClick={onLoadMore}
        type="button"
      >
        載入更多人士（第 {page + 1} 頁）
      </button>
    ) : null}
  </section>
);

export const GlobalRolePersonView = ({
  busy,
  onDemoteToMember,
  onPromoteToStaff,
  onGrantAdmin,
  onGrantRoleAssigner,
  onWithdrawRoleAssigner,
  pending,
  person,
}: {
  busy: boolean;
  onDemoteToMember: () => void;
  onPromoteToStaff: () => void;
  onGrantAdmin: () => void;
  onGrantRoleAssigner: () => void;
  onWithdrawRoleAssigner: (
    assignment: NonNullable<GlobalRolePerson["roleAssignerAssignment"]>
  ) => void;
  pending: boolean;
  person: GlobalRolePerson;
}) => {
  const assignment = person.roleAssignerAssignment;
  let roleAction: ReactNode = null;
  let roleAssignerAction: ReactNode = null;
  if (person.role === "member" && person.eligibleForStaff) {
    roleAction = (
      <button
        className="bg-primary text-primary-foreground min-h-11 rounded-md px-4 font-semibold focus-visible:outline-2 disabled:opacity-60"
        disabled={busy || pending}
        onClick={onPromoteToStaff}
        type="button"
      >
        設為職員
      </button>
    );
  } else if (person.role === "staff") {
    roleAction = (
      <button
        className="border-border min-h-11 rounded-md border px-4 font-semibold focus-visible:outline-2 disabled:opacity-60"
        disabled={busy || pending}
        onClick={onDemoteToMember}
        type="button"
      >
        改為會員
      </button>
    );
  }
  const adminAction = person.eligibleForAdmin ? (
    <button
      className="border-border min-h-11 rounded-md border px-4 font-semibold focus-visible:outline-2 disabled:opacity-60"
      disabled={busy || pending}
      onClick={onGrantAdmin}
      type="button"
    >
      設為管理員
    </button>
  ) : null;
  if (person.role === "staff" && assignment) {
    roleAssignerAction = (
      <button
        className="border-border min-h-11 rounded-md border px-4 font-semibold focus-visible:outline-2 disabled:opacity-60"
        disabled={busy || pending}
        onClick={() => onWithdrawRoleAssigner(assignment)}
        type="button"
      >
        撤回 Role Assigner
      </button>
    );
  } else if (person.role === "staff" && person.eligibleForRoleAssigner) {
    roleAssignerAction = (
      <button
        className="bg-primary text-primary-foreground min-h-11 rounded-md px-4 font-semibold focus-visible:outline-2 disabled:opacity-60"
        disabled={busy || pending}
        onClick={onGrantRoleAssigner}
        type="button"
      >
        委派 Role Assigner
      </button>
    );
  }

  return (
    <section
      aria-labelledby="global-role-person-heading"
      aria-live="polite"
      className="border-border rounded-lg border p-4 sm:p-6"
      role="region"
      aria-label="人士資料"
    >
      <h2 className="text-section" id="global-role-person-heading">
        {person.fullName}
      </h2>
      <dl className="mt-5 grid gap-4 sm:grid-cols-2">
        {person.username ? (
          <div>
            <dt className="text-meta text-muted-foreground">Username</dt>
            <dd className="text-meta mt-1 break-all">{person.username}</dd>
          </div>
        ) : null}
        <div>
          <dt className="text-meta text-muted-foreground">現時全域身份</dt>
          <dd className="text-label mt-1">
            {person.role === "member" ? "會員" : "職員"}
          </dd>
        </div>
        <div>
          <dt className="text-meta text-muted-foreground">Role Assigner</dt>
          <dd className="text-label mt-1">
            {assignment ? "已委派" : "未委派"}
          </dd>
        </div>
      </dl>
      <GlobalRoleEligibilityNotice person={person} />
      {roleAction || adminAction || roleAssignerAction ? (
        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          {roleAction}
          {adminAction}
          {roleAssignerAction}
        </div>
      ) : null}
    </section>
  );
};

export const GlobalRoleActionReview = ({
  busy,
  hasRoleAssigner,
  onCancel,
  onPasswordChange,
  onSubmit,
  password,
  personName,
  review,
}: {
  busy: boolean;
  hasRoleAssigner: boolean;
  onCancel: () => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  password: string;
  personName: string;
  review: GlobalRoleActionDraft;
}) => (
  <section
    aria-labelledby="global-role-review-heading"
    className="border-border mt-6 rounded-lg border p-4 sm:p-6"
  >
    <h3 className="text-label font-semibold" id="global-role-review-heading">
      確認操作
    </h3>
    <p className="text-body mt-3">{getReviewPrompt(review, personName)}</p>
    {review.role === "staff" &&
    review.action === "withdrawn" &&
    hasRoleAssigner ? (
      <p className="text-body mt-3">此操作亦會撤回其 Role Assigner 委派。</p>
    ) : null}
    <form className="mt-4 space-y-4" onSubmit={onSubmit}>
      <label className="text-body block" htmlFor="global-role-password">
        目前密碼
        <input
          autoComplete="current-password"
          className="border-border bg-background mt-1 min-h-12 w-full rounded-md border px-3 focus-visible:outline-2"
          id="global-role-password"
          onChange={(event) => onPasswordChange(event.currentTarget.value)}
          required
          type="password"
          value={password}
        />
      </label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          className="bg-primary text-primary-foreground min-h-11 rounded-md px-4 font-semibold focus-visible:outline-2 disabled:opacity-60"
          disabled={busy || !password}
          type="submit"
        >
          {getActionButtonLabel(review)}
        </button>
        <button
          className="border-border min-h-11 rounded-md border px-4 focus-visible:outline-2 disabled:opacity-60"
          disabled={busy}
          onClick={onCancel}
          type="button"
        >
          取消
        </button>
      </div>
    </form>
  </section>
);

export const GlobalRolePendingView = ({
  busy,
  onReconcile,
  roleLabel,
}: {
  busy: boolean;
  onReconcile: () => void;
  roleLabel: string;
}) => (
  <section
    aria-label={`待查核的${roleLabel}操作`}
    className="border-border mt-6 rounded-lg border p-4"
  >
    <p className="text-body">
      上一項{roleLabel}操作結果未能確認。請先查核結果，不要重複提交。
    </p>
    <button
      className="border-border mt-3 min-h-11 rounded-md border px-4 focus-visible:outline-2 disabled:opacity-60"
      disabled={busy}
      onClick={onReconcile}
      type="button"
    >
      查核操作結果
    </button>
  </section>
);
