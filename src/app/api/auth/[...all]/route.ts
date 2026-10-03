import { getAuth } from "@/server/auth";
import { isAllowedPublicAuthRequest } from "@/server/auth/allowlist";

/** Public auth boundary: only the implemented entries reach Better Auth. */
const handleAuthRequest = (request: Request): Promise<Response> | Response => {
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
  return getAuth().handler(request);
};

export const GET = handleAuthRequest;
export const POST = handleAuthRequest;
export const PUT = handleAuthRequest;
export const PATCH = handleAuthRequest;
export const DELETE = handleAuthRequest;
export const HEAD = handleAuthRequest;
export const OPTIONS = handleAuthRequest;
