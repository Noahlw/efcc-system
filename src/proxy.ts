import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getPersonIdentity } from "@/features/identity/queries";
import { resolveAccess } from "@/server/auth/access";
import type { AccessResolution } from "@/server/auth/access";
import { getDb } from "@/server/db/client";
import { roleAssignerAssignment } from "@/server/db/schema/roles";

import {
  protectedRetryHref,
  protectedRetrySearchParams,
} from "./shared/protected-pages";

/**
 * Response-capable request guard for protected pages and the business API.
 * It owns session validation and 90-day renewal (forwarding Better Auth's
 * Set-Cookie values) and injects the authoritative access decision for this
 * request. Native `/api/auth` endpoints manage their own cookies and never
 * pass through here.
 *
 * An unexpected guard failure never degrades to "signed out": API reads get
 * the shared typed 500 shape and pages get the generic retry surface.
 */
const RESTRICTED_LANDING = "/status";
const SIGN_IN = "/sign-in";
const UNAVAILABLE = "/unavailable";
const ROLE_MANAGEMENT_PAGES = [
  "/roles/people",
  "/staff/roles/department-managers",
  "/staff/roles/global-roles",
  "/staff/roles/program-leaders",
] as const;

const canOpenRoleManagementPage = async (
  pathname: string,
  decision: AccessResolution["decision"]
) => {
  if (
    !ROLE_MANAGEMENT_PAGES.some((path) => path === pathname) ||
    decision.level !== "full" ||
    !decision.userId
  ) {
    return false;
  }
  const identity = await getPersonIdentity(getDb(), decision.userId);
  if (identity?.accountRole === "admin") {
    return true;
  }
  if (
    ![
      "/roles/people",
      "/staff/roles/department-managers",
      "/staff/roles/program-leaders",
    ].includes(pathname) ||
    identity?.accountRole !== "staff"
  ) {
    return false;
  }
  const assignment = await getDb()
    .select({ id: roleAssignerAssignment.id })
    .from(roleAssignerAssignment)
    .where(eq(roleAssignerAssignment.userId, decision.userId))
    .limit(1)
    .get();
  return Boolean(assignment);
};

const isRoleManagementPageDenied = (pathname: string, authorized: boolean) =>
  ROLE_MANAGEMENT_PAGES.some((path) => path === pathname) && !authorized;

export const proxy = async (request: NextRequest) => {
  const url = new URL(request.url);
  const isBusinessApi = url.pathname.startsWith("/api/v2");
  const isPublicPage = url.pathname === "/sign-in" || url.pathname === "/apply";

  let resolution: AccessResolution;
  let roleManagementAllowed = false;
  try {
    resolution = await resolveAccess(request);
    roleManagementAllowed = await canOpenRoleManagementPage(
      url.pathname,
      resolution.decision
    );
  } catch {
    console.error(
      JSON.stringify({
        category: "unexpected",
        outcome: "failed",
        stage: "access-resolution",
      })
    );
    if (isBusinessApi) {
      const guardError = NextResponse.json(
        {
          error: {
            code: "internal_error",
            message: "系統暫時無法完成請求，請稍後再試。",
          },
        },
        { status: 500 }
      );
      guardError.headers.set("cache-control", "private, no-store");
      return guardError;
    }
    // Only delivered protected pages are retryable; anything else retries Home.
    const returnTo = protectedRetryHref(url.pathname);
    const unavailable = new URL(UNAVAILABLE, url);
    unavailable.searchParams.set("returnTo", returnTo);
    const retry = new URLSearchParams(
      protectedRetrySearchParams(returnTo, url.searchParams)
    );
    if (retry.size > 0) {
      unavailable.searchParams.set("retry", retry.toString());
    }
    const redirect = NextResponse.redirect(unavailable);
    redirect.headers.set("cache-control", "private, no-store");
    return redirect;
  }

  const { decision, setCookies } = resolution;

  const requestHeaders = new Headers(request.headers);
  // Never trust client-supplied decision headers.
  requestHeaders.delete("x-efcc-user-id");
  requestHeaders.delete("x-efcc-access");
  requestHeaders.delete("x-efcc-session-id");
  if (decision.userId) {
    requestHeaders.set("x-efcc-user-id", decision.userId);
    if (decision.sessionId) {
      requestHeaders.set("x-efcc-session-id", decision.sessionId);
    }
  }
  requestHeaders.set("x-efcc-access", decision.level);

  const respond = (response: NextResponse) => {
    response.headers.set("cache-control", "private, no-store");
    for (const cookie of setCookies) {
      response.headers.append("set-cookie", cookie);
    }
    return response;
  };

  if (decision.level === "password-change-required") {
    if (
      isBusinessApi &&
      url.pathname !== "/api/v2/account/password" &&
      url.pathname !== "/api/v2/account/security" &&
      url.pathname !== "/api/v2/account/security/reconcile"
    ) {
      return respond(
        NextResponse.json(
          {
            error: {
              code: "password_change_required",
              message: "請先更改臨時密碼；到期時請聯絡職員重新發出。",
            },
          },
          { status: 403 }
        )
      );
    }
    if (!isBusinessApi && url.pathname !== "/account") {
      return respond(NextResponse.redirect(new URL("/account", url)));
    }
  }

  if (!isBusinessApi && !isPublicPage) {
    if (decision.level === "anonymous") {
      const signIn = new URL(SIGN_IN, url);
      signIn.searchParams.set("reason", "authentication-required");
      return respond(NextResponse.redirect(signIn));
    }
    if (
      decision.level === "restricted" &&
      ![RESTRICTED_LANDING, "/account", "/application", "/inbox"].includes(
        url.pathname
      )
    ) {
      return respond(NextResponse.redirect(new URL(RESTRICTED_LANDING, url)));
    }
    if (isRoleManagementPageDenied(url.pathname, roleManagementAllowed)) {
      return respond(NextResponse.redirect(new URL("/staff/accounts", url)));
    }
  }

  return respond(NextResponse.next({ request: { headers: requestHeaders } }));
};

export const config = {
  matcher: [
    "/",
    "/status",
    "/account",
    "/application",
    "/inbox",
    "/roles/people",
    "/roles/program-leaders",
    "/staff/applications",
    "/staff/accounts",
    "/staff/account-audit",
    "/staff/roles/department-managers",
    "/staff/roles/global-roles",
    "/staff/roles/program-leaders",
    "/sign-in",
    "/apply",
    "/api/v2/:path*",
  ],
};
