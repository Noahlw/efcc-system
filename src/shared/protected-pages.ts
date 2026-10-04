export const protectedPagePaths = [
  "/",
  "/status",
  "/account",
  "/application",
  "/inbox",
  "/staff/applications",
  "/staff/account-audit",
] as const;

export type ProtectedPagePath = (typeof protectedPagePaths)[number];

/** Exact delivered paths only; URL parameters must never become arbitrary redirects. */
export const protectedRetryHref = (value: unknown): ProtectedPagePath =>
  protectedPagePaths.find((path) => path === value) ?? "/";
