import { Hono } from "hono";
import type {
  Context,
  Env,
  ErrorHandler,
  Input,
  MiddlewareHandler,
  Next,
  TypedResponse,
} from "hono";
import { bodyLimit } from "hono/body-limit";
import type { ApplyGlobalResponse } from "hono/client";
import { HTTPException } from "hono/http-exception";
import { validator } from "hono/validator";
import type * as z from "zod";

import { applicantRoutes } from "../../features/account/applicant-routes";
import {
  applicationBodySchema,
  reconciliationBodySchema,
} from "../../features/account/application-contract";
import {
  ApplicationRequestError,
  createApplication,
  guardApplicationRequest,
  MAX_REQUEST_BYTES,
  reconcileApplication,
} from "../../features/account/applications";
import { auditRoutes } from "../../features/account/audit-routes";
import { decisionRoutes } from "../../features/account/decision-routes";
import { deletionRoutes } from "../../features/account/deletion-routes";
import { identityRoutes } from "../../features/account/identity-routes";
import { accountReadRoutes } from "../../features/account/read-routes";
import { restrictionRoutes } from "../../features/account/restriction-routes";
import { accountSecurityRoutes } from "../../features/account/security-routes";
import { staffAccountRoutes } from "../../features/account/staff-account-routes";
import { getPersonIdentity } from "../../features/identity/queries";
import { restrictionReasons } from "../../features/identity/restrictions";
import { getDb } from "../db/client";

/** One generic unexpected-error boundary; internals never reach the client. */
const handleUnexpectedError: ErrorHandler = (error, c) => {
  c.header("cache-control", "private, no-store");
  if (error instanceof ApplicationRequestError) {
    return c.json(
      { error: { code: error.code, message: error.message } },
      error.status
    );
  }
  console.error("Unexpected business API failure");
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

const applicationValidationResponse = (c: Context) =>
  c.json(
    {
      error: {
        code: "validation_error" as const,
        message: "申請資料格式不正確。",
      },
    },
    400
  );

type ApplicationValidationResponse = TypedResponse<
  { error: { code: "validation_error"; message: string } },
  400,
  "json"
>;

const applicationGuard =
  (action: "create" | "reconcile") =>
  async (c: Context, next: Next): Promise<void> => {
    c.header("cache-control", "private, no-store");
    await guardApplicationRequest(c.req.raw, action);
    return next();
  };

const applicationRequestEnvelope = (c: Context, next: Next) => {
  const mediaType = c.req
    .header("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  const contentLength = c.req.header("content-length");
  if (
    mediaType !== "application/json" ||
    (contentLength !== undefined &&
      (!/^\d+$/u.test(contentLength) ||
        Number(contentLength) > MAX_REQUEST_BYTES))
  ) {
    return Promise.resolve(applicationValidationResponse(c));
  }
  return next();
};

const applicationBodyLimit = bodyLimit({
  maxSize: MAX_REQUEST_BYTES,
  onError: applicationValidationResponse,
}) as MiddlewareHandler<Env, string, Input, ApplicationValidationResponse>;

const applicationUtf8Validation = async (c: Context, next: Next) => {
  const body = await c.req.raw.clone().arrayBuffer();
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    return applicationValidationResponse(c);
  }
  return next();
};
const mapMalformedApplicationJson = async (c: Context, next: Next) => {
  try {
    return await next();
  } catch (error) {
    if (error instanceof HTTPException && error.status === 400) {
      return applicationValidationResponse(c);
    }
    throw error;
  }
};

const zodJsonValidator = <T extends z.ZodType>(schema: T) =>
  validator("json", (value, c) => {
    const parsed = schema.safeParse(value);
    return parsed.success ? parsed.data : applicationValidationResponse(c);
  }) as MiddlewareHandler<
    Env,
    string,
    { in: { json: z.input<T> }; out: { json: z.output<T> } },
    ApplicationValidationResponse
  >;

const applicationJsonValidator = zodJsonValidator(applicationBodySchema);
const reconciliationJsonValidator = zodJsonValidator(reconciliationBodySchema);

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
  .route("/", accountReadRoutes)
  .route("/", applicantRoutes)
  .route("/", accountSecurityRoutes)
  .route("/", identityRoutes)
  .route("/", staffAccountRoutes)
  .route("/", restrictionRoutes)
  .route("/", decisionRoutes)
  .route("/", auditRoutes)
  .route("/", deletionRoutes)
  .post(
    "/applications",
    applicationGuard("create"),
    applicationRequestEnvelope,
    applicationBodyLimit,
    applicationUtf8Validation,
    mapMalformedApplicationJson,
    applicationJsonValidator,
    async (c) => {
      const input = c.req.valid("json");
      const result = await createApplication(input);
      return c.json(
        { data: { outcome: "pending" as const } },
        result === "created" ? 201 : 200
      );
    }
  )
  .post(
    "/applications/reconcile",
    applicationGuard("reconcile"),
    applicationRequestEnvelope,
    applicationBodyLimit,
    applicationUtf8Validation,
    mapMalformedApplicationJson,
    reconciliationJsonValidator,
    async (c) => {
      const { operationKey } = c.req.valid("json");
      const outcome = await reconcileApplication(operationKey);
      return c.json({ data: { outcome } }, 200);
    }
  )
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
    400: {
      json: {
        error: {
          code: "validation_error" | "invalid_password";
          message: string;
        };
      };
    };
    401: { json: { error: { code: "unauthorized"; message: string } } };
    403: {
      json: {
        error: {
          code:
            | "business_access_denied"
            | "origin_denied"
            | "password_change_required"
            | "temporary_password_expired"
            | "password_confirmation_required"
            | "identity_verification_required";
          message: string;
        };
      };
    };
    404: { json: { error: { code: "not_found"; message: string } } };
    409: { json: { error: { code: "conflict"; message: string } } };
    429: { json: { error: { code: "rate_limited"; message: string } } };
    500: { json: { error: { code: "internal_error"; message: string } } };
  }
>;

export const handleBusinessRequest = (
  request: Request
): Response | Promise<Response> => businessApi.fetch(request);
