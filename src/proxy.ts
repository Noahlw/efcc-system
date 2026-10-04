import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { resolveAccess } from "@/server/auth/access";
import type { AccessResolution } from "@/server/auth/access";

import { protectedRetryHref } from "./shared/protected-pages";

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

export const proxy = async (request: NextRequest) => {
  const url = new URL(request.url);
  const isBusinessApi = url.pathname.startsWith("/api/v2");

  let resolution: AccessResolution;
  try {
    resolution = await resolveAccess(request);
  } catch {
    console.error("Access guard failed");
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

  if (!isBusinessApi) {
    if (decision.level === "anonymous") {
      const signIn = new URL(SIGN_IN, url);
      signIn.searchParams.set("reason", "authentication-required");
      return respond(NextResponse.redirect(signIn));
    }
    if (
      decision.level === "restricted" &&
      url.pathname !== RESTRICTED_LANDING &&
      url.pathname !== "/account" &&
      url.pathname !== "/application" &&
      url.pathname !== "/inbox"
    ) {
      return respond(NextResponse.redirect(new URL(RESTRICTED_LANDING, url)));
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
    "/staff/applications",
    "/staff/account-audit",
    "/api/v2/:path*",
  ],
};
