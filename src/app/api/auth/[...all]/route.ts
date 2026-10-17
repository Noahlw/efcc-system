import { getAuth } from "@/server/auth";
import { isAllowedPublicAuthRequest } from "@/server/auth/allowlist";

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
    const response = await getAuth().handler(request);
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
