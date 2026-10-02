import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { resolveAccess } from "@/server/auth/access";

/**
 * Response-capable request guard for protected pages and the business API.
 * It owns session validation and 90-day renewal (forwarding Better Auth's
 * Set-Cookie values) and injects the authoritative access decision for this
 * request. Native `/api/auth` endpoints manage their own cookies and never
 * pass through here.
 */
const RESTRICTED_LANDING = "/status";
const SIGN_IN = "/sign-in";

export const proxy = async (request: NextRequest) => {
  const url = new URL(request.url);
  const isBusinessApi = url.pathname.startsWith("/api/v2");
  const { decision, setCookies } = await resolveAccess(request);

  const requestHeaders = new Headers(request.headers);
  // Never trust client-supplied decision headers.
  requestHeaders.delete("x-efcc-user-id");
  requestHeaders.delete("x-efcc-access");
  requestHeaders.delete("x-efcc-restrictions");
  if (decision.userId) {
    requestHeaders.set("x-efcc-user-id", decision.userId);
  }
  requestHeaders.set("x-efcc-access", decision.level);
  requestHeaders.set("x-efcc-restrictions", decision.reasons.join(","));

  const respond = (response: NextResponse) => {
    for (const cookie of setCookies) {
      response.headers.append("set-cookie", cookie);
    }
    return response;
  };

  if (!isBusinessApi) {
    if (decision.level === "anonymous") {
      return respond(NextResponse.redirect(new URL(SIGN_IN, url)));
    }
    if (
      decision.level === "restricted" &&
      url.pathname !== RESTRICTED_LANDING
    ) {
      return respond(NextResponse.redirect(new URL(RESTRICTED_LANDING, url)));
    }
  }

  return respond(NextResponse.next({ request: { headers: requestHeaders } }));
};

export const config = {
  matcher: ["/", "/status", "/api/v2/:path*"],
};
