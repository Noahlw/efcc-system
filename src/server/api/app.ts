import { Hono } from "hono";
import type { ErrorHandler } from "hono";
import type { ApplyGlobalResponse } from "hono/client";

import { getPersonIdentity } from "../../features/identity/queries";
import { restrictionReasons } from "../../features/identity/restrictions";
import { getDb } from "../db/client";

/** One generic unexpected-error boundary; internals never reach the client. */
const handleUnexpectedError: ErrorHandler = (error, c) => {
  console.error("Unexpected business API failure", error);
  return c.json(
    {
      error: {
        code: "internal_error",
        message: "系統暫時無法完成請求，請稍後再試。",
      },
    },
    500
  );
};

/**
 * EFCC business API under /api/v2, delegated from the App Router handler.
 * The proxy has already validated the session and injected the authoritative
 * access decision; identity is re-derived from D1 on every request.
 */
export const businessApi = new Hono()
  .basePath("/api/v2")
  .get("/me", async (c) => {
    const userId = c.req.header("x-efcc-user-id");
    const access = c.req.header("x-efcc-access");

    if (!userId || access === "anonymous") {
      return c.json(
        { error: { code: "unauthorized", message: "請先登入。" } },
        401
      );
    }
    if (access !== "full") {
      return c.json(
        {
          error: {
            code: "business_access_denied",
            message: "你的帳戶目前無法使用教會功能。",
          },
        },
        403
      );
    }

    const identity = await getPersonIdentity(getDb(), userId);
    if (!identity) {
      return c.json(
        {
          error: {
            code: "business_access_denied",
            message: "無法確認你的會籍狀態。",
          },
        },
        403
      );
    }

    return c.json(
      {
        data: {
          displayName: identity.displayName,
          membershipStatus: identity.membershipStatus,
          username: identity.username,
        },
      },
      200
    );
  })

  /**
   * Current applicable restrictions, readable with a valid session even while
   * business access is denied. Never returns participation or notice content.
   */
  .get("/status", async (c) => {
    const userId = c.req.header("x-efcc-user-id");
    const access = c.req.header("x-efcc-access");

    if (!userId || access === "anonymous") {
      return c.json(
        { error: { code: "unauthorized", message: "請先登入。" } },
        401
      );
    }

    const identity = await getPersonIdentity(getDb(), userId);
    const reasons = identity
      ? restrictionReasons(identity.membershipStatus, identity.banned)
      : (["profile_missing"] as const);

    return c.json(
      {
        data: {
          accessAllowed: reasons.length === 0,
          displayName: identity?.displayName ?? null,
          reasons,
        },
      },
      200
    );
  })

  .notFound((c) =>
    c.json(
      { error: { code: "not_found", message: "找不到這個 API 路徑。" } },
      404
    )
  )
  .onError(handleUnexpectedError);

export type AppType = ApplyGlobalResponse<
  typeof businessApi,
  {
    404: { json: { error: { code: "not_found"; message: string } } };
    500: { json: { error: { code: "internal_error"; message: string } } };
  }
>;

export const handleBusinessRequest = (
  request: Request
): Response | Promise<Response> => businessApi.fetch(request);
