import { getAuth } from "@/server/auth";
import { isAllowedPublicAuthRequest } from "@/server/auth/allowlist";

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
    return await getAuth().handler(request);
  } catch {
    console.error("Authentication request failed");
    return Response.json(
      {
        code: "INTERNAL_SERVER_ERROR",
        message: "系統暫時無法完成驗證，請稍後再試。",
      },
      { headers: { "cache-control": "private, no-store" }, status: 500 }
    );
  }
};

export const GET = handleAuthRequest;
export const POST = handleAuthRequest;
export const PUT = handleAuthRequest;
export const PATCH = handleAuthRequest;
export const DELETE = handleAuthRequest;
export const HEAD = handleAuthRequest;
export const OPTIONS = handleAuthRequest;
