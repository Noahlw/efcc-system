export const protectedPagePaths = [
  "/",
  "/status",
  "/account",
  "/application",
  "/inbox",
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
  "/roles/program-leaders": [],
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
