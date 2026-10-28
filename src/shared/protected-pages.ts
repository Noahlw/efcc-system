export const protectedPagePaths = [
  "/",
  "/status",
  "/account",
  "/application",
  "/inbox",
  "/roles/people",
  "/roles/people/identity",
  "/roles/people/delegation",
  "/roles/people/duties",
  "/roles/program-leaders",
  "/staff/applications",
  "/staff/accounts",
  "/staff/account-audit",
  "/staff/roles/department-managers",
  "/staff/roles/program-leaders",
  "/staff/roles/global-roles",
] as const;

export type ProtectedPagePath = (typeof protectedPagePaths)[number];
export type ProtectedPageHref =
  | ProtectedPagePath
  | `${ProtectedPagePath}?${string}`;

/** Exact delivered paths only; URL parameters must never become arbitrary redirects. */
export const protectedRetryHref = (value: unknown): ProtectedPagePath =>
  protectedPagePaths.find((path) => path === value) ?? "/";

const retrySearchKeys: Record<ProtectedPagePath, readonly string[]> = {
  "/": [
    "week",
    "date",
    "after",
    "participationAfter",
    "invitationAfter",
    "noticeAfter",
  ],
  "/account": ["task"],
  "/application": [],
  "/inbox": ["page"],
  "/roles/people": [
    "q",
    "page",
    "person",
    "assignmentPage",
    "programDepartment",
    "programPage",
  ],
  "/roles/people/delegation": ["person", "returnTo"],
  "/roles/people/duties": [
    "person",
    "returnTo",
    "department",
    "program",
    "origin",
    "authority",
    "assignment",
  ],
  "/roles/people/identity": ["person", "returnTo"],
  "/roles/program-leaders": [
    "department",
    "program",
    "departmentPage",
    "programPage",
    "rosterPage",
    "q",
    "candidatePage",
    "picker",
  ],
  "/staff/account-audit": ["page", "record", "taskReturn"],
  "/staff/accounts": ["view", "q", "page", "person", "task"],
  "/staff/applications": ["page", "record", "query", "taskReturn"],
  "/staff/roles/department-managers": [],
  "/staff/roles/global-roles": [],
  "/staff/roles/program-leaders": [],
  "/status": [],
};

/** Keep only delivered navigation state; the fresh reader still validates and authorizes it. */
export const protectedRetrySearchParams = (
  path: ProtectedPagePath,
  params:
    | URLSearchParams
    | Readonly<Record<string, string | string[] | undefined>>
): Record<string, string> =>
  Object.fromEntries(
    retrySearchKeys[path].flatMap((key) => {
      const supplied =
        params instanceof URLSearchParams ? params.getAll(key) : params[key];
      const values =
        typeof supplied === "string" ? [supplied] : (supplied ?? []);
      const [value] = values;
      return values.length === 1 && value !== undefined ? [[key, value]] : [];
    })
  );

const isRolePeopleId = (value: string) =>
  value.length <= 128 && /^[a-z0-9_-]+$/iu.test(value);

const rolePeoplePage = (text: string | undefined) => {
  const number = Number(text);
  if (
    !text ||
    !/^\d+$/u.test(text) ||
    !Number.isSafeInteger(number) ||
    number <= 1 ||
    number > Math.floor(Number.MAX_SAFE_INTEGER / 25)
  ) {
    return;
  }
  return String(number);
};

const rolePeopleReturnSearch = (params: URLSearchParams) => {
  const allowed = protectedRetrySearchParams("/roles/people", params);
  const safe = new URLSearchParams();
  if (allowed.q && [...allowed.q].length <= 100) {
    safe.set("q", allowed.q);
  }
  for (const key of ["person", "programDepartment"]) {
    const id = allowed[key];
    if (id && isRolePeopleId(id)) {
      safe.set(key, id);
    }
  }
  for (const key of ["page", "assignmentPage", "programPage"]) {
    const page = rolePeoplePage(allowed[key]);
    if (page) {
      safe.set(key, page);
    }
  }
  return safe;
};

/** Reconstruct the only accepted role-task return destination; never follow an arbitrary URL. */
export const rolePeopleReturnHref = (
  value: unknown
): ProtectedPageHref | null => {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    !value.startsWith("/roles/people")
  ) {
    return null;
  }
  try {
    const url = new URL(value, "https://return.invalid");
    if (
      url.origin !== "https://return.invalid" ||
      url.pathname !== "/roles/people" ||
      url.hash
    ) {
      return null;
    }
    const safe = rolePeopleReturnSearch(url.searchParams);
    return safe.size ? `/roles/people?${safe}` : "/roles/people";
  } catch {
    return null;
  }
};

export interface ProgramLeaderWorkspaceContext {
  department: string;
  program: string;
  departmentPage: number;
  programPage: number;
  rosterPage: number;
  q: string;
  candidatePage: number;
}

const workspaceScopeId = (value: string | undefined) =>
  value && isRolePeopleId(value) ? value : "";

export const programLeaderWorkspaceContext = (
  supplied: Readonly<Record<string, string | string[] | undefined>>
): ProgramLeaderWorkspaceContext => {
  const safe = protectedRetrySearchParams("/roles/program-leaders", supplied);
  return {
    candidatePage: Number(rolePeoplePage(safe.candidatePage) ?? 1),
    department: workspaceScopeId(safe.department),
    departmentPage: Number(rolePeoplePage(safe.departmentPage) ?? 1),
    program: workspaceScopeId(safe.program),
    programPage: Number(rolePeoplePage(safe.programPage) ?? 1),
    q: safe.q && [...safe.q].length <= 100 ? safe.q.trim() : "",
    rosterPage: Number(rolePeoplePage(safe.rosterPage) ?? 1),
  };
};

export const programLeaderWorkspaceHref = (
  context: ProgramLeaderWorkspaceContext
): ProtectedPageHref => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(context)) {
    if (typeof value === "number" ? value > 1 : Boolean(value)) {
      params.set(key, String(value));
    }
  }
  return params.size
    ? `/roles/program-leaders?${params}`
    : "/roles/program-leaders";
};

/** Only the delivered, freshly authorized local workspace can receive task Back. */
export const programLeaderReturnHref = (
  value: unknown
): ProtectedPageHref | null => {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    !value.startsWith("/roles/program-leaders")
  ) {
    return null;
  }
  try {
    const url = new URL(value, "https://return.invalid");
    if (
      url.origin !== "https://return.invalid" ||
      url.pathname !== "/roles/program-leaders" ||
      url.hash
    ) {
      return null;
    }
    const params = protectedRetrySearchParams(
      "/roles/program-leaders",
      url.searchParams
    );
    return programLeaderWorkspaceHref(programLeaderWorkspaceContext(params));
  } catch {
    return null;
  }
};
