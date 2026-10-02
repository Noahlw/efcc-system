/**
 * Public `/api/auth` allowlist for this slice. Only implemented entries are
 * usable; every other native path or method returns 404 so enabling the
 * credential engine does not expose signup, recovery or session management.
 * Native `disabledPaths` is not an allowlist.
 */

const USERNAME_SIGN_IN = { method: "POST", path: "/sign-in/username" } as const;
const NAME_SIGN_IN = { method: "POST", path: "/sign-in/name" } as const;
const GET_SESSION = { method: "GET", path: "/get-session" } as const;
const SIGN_OUT = { method: "POST", path: "/sign-out" } as const;

const ALLOWED = [
  USERNAME_SIGN_IN,
  NAME_SIGN_IN,
  GET_SESSION,
  SIGN_OUT,
] as const;
const BASE_PATH = "/api/auth";

export interface AuthRequestTarget {
  method: string;
  pathname: string;
}

/**
 * Exact method/path match after the `/api/auth` base path and an optional
 * trailing slash. Dynamic paths such as `/reset-password/:token` never match.
 */
export const isAllowedPublicAuthRequest = (
  target: AuthRequestTarget
): boolean => {
  if (!target.pathname.startsWith(`${BASE_PATH}/`)) {
    return false;
  }
  let rest = target.pathname.slice(BASE_PATH.length);
  if (rest.length > 1 && rest.endsWith("/")) {
    rest = rest.slice(0, -1);
  }
  return ALLOWED.some(
    (entry) => entry.method === target.method && entry.path === rest
  );
};
