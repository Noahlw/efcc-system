import * as z from "zod";

import { getPersonIdentity } from "@/features/identity/queries";
import { getAuth } from "@/server/auth";
import { isAllowedPublicAuthRequest } from "@/server/auth/allowlist";
import { getDb } from "@/server/db/client";

const privateAuthFailure = (): Response => {
  console.error(
    JSON.stringify({
      category: "unexpected",
      outcome: "failed",
      stage: "native-auth-request",
    })
  );
  return Response.json(
    {
      code: "INTERNAL_SERVER_ERROR",
      message: "系統暫時無法完成驗證，請稍後再試。",
    },
    { headers: { "cache-control": "private, no-store" }, status: 500 }
  );
};

const authContextCookie = (requestUrl: URL) => {
  const secure = requestUrl.protocol === "https:" ? "; Secure" : "";
  return `efcc-auth-context=${crypto.randomUUID()}; Path=/; Max-Age=7776000; SameSite=Lax${secure}`;
};

const changesAuthContext = (request: Request, pathname: string) =>
  request.method === "POST" &&
  [
    "/api/auth/sign-in/username",
    "/api/auth/sign-in/name",
    "/api/auth/sign-out",
  ].includes(pathname);

const nativeUserPayload = z.looseObject({
  user: z.object({ id: z.string() }),
});
const restrictedSession = z
  .object({ expiresAt: z.string(), id: z.string(), userId: z.string() })
  .optional();

/** Native authentication remains usable without returning restricted contact data. */
const projectRestrictedAuthResponse = async (response: Response) => {
  if (!response.ok) {
    return response;
  }
  const raw = await response.text();
  const body: unknown = JSON.parse(raw);
  const parsed = nativeUserPayload.safeParse(body);
  if (!parsed.success) {
    if (body !== null && typeof body === "object" && "user" in body) {
      throw new Error("Invalid native user response");
    }
    return new Response(raw, response);
  }
  const identity = await getPersonIdentity(getDb(), parsed.data.user.id);
  if (
    identity &&
    !identity.banned &&
    identity.membershipStatus !== "deactivated"
  ) {
    return new Response(raw, response);
  }
  const headers = new Headers(response.headers);
  headers.set("cache-control", "private, no-store");
  headers.delete("content-length");
  return Response.json(
    { ...parsed.data, session: restrictedSession.parse(parsed.data.session) },
    { headers, status: response.status }
  );
};

/** Public auth boundary: only the implemented entries reach Better Auth. */
const handleAuthRequest = async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  if (
    !isAllowedPublicAuthRequest({
      method: request.method,
      pathname: url.pathname,
    })
  ) {
    // A fresh Response per request: a shared instance has a consumed body stream.
    return Response.json(
      {
        error: {
          code: "not_found",
          message: "這個驗證端點尚未開放。",
        },
      },
      { status: 404 }
    );
  }
  try {
    const native = await getAuth().handler(request);
    const response = await projectRestrictedAuthResponse(native);
    if (response.status >= 500) {
      return privateAuthFailure();
    }
    if (response.ok && changesAuthContext(request, url.pathname)) {
      const headers = new Headers(response.headers);
      headers.append("set-cookie", authContextCookie(url));
      return new Response(response.body, {
        headers,
        status: response.status,
        statusText: response.statusText,
      });
    }
    return response;
  } catch {
    return privateAuthFailure();
  }
};

export const GET = handleAuthRequest;
export const POST = handleAuthRequest;
export const PUT = handleAuthRequest;
export const PATCH = handleAuthRequest;
export const DELETE = handleAuthRequest;
export const HEAD = handleAuthRequest;
export const OPTIONS = handleAuthRequest;
