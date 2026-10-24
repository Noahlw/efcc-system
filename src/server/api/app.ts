import { Hono } from "hono";
import type { Context, ErrorHandler, Next } from "hono";
import type { ApplyGlobalResponse } from "hono/client";

import { applicantRoutes } from "../../features/account/applications/applicant-routes";
import {
  applicationBodySchema,
  reconciliationBodySchema,
} from "../../features/account/applications/application-contract";
import {
  createApplication,
  reconcileApplication,
} from "../../features/account/applications/applications";
import { boundedJsonValidator } from "../../features/account/bounded-json-validator";
import type { BusinessErrorResponses } from "../../features/account/business-error-contract";
import {
  BusinessApiError,
  drainRejectedBody,
  guardBusinessRequest,
} from "../../features/account/business-request";
import { decisionRoutes } from "../../features/account/decisions/decision-routes";
import { deletionRoutes } from "../../features/account/deletion/deletion-routes";
import { identityRoutes } from "../../features/account/identity-changes/identity-routes";
import { accountReadRoutes } from "../../features/account/read-routes";
import { restrictionRoutes } from "../../features/account/restrictions/restriction-routes";
import { accountSecurityRoutes } from "../../features/account/security/security-routes";
import { staffAccountRoutes } from "../../features/account/staff-account-routes";
import { auditRoutes } from "../../features/account/staff-workspace/audit-routes";
import { getPersonIdentity } from "../../features/identity/queries";
import { restrictionReasons } from "../../features/identity/restrictions";
import { departmentManagerRoutes } from "../../features/roles/department-manager-routes";
import { programLeaderRoutes } from "../../features/roles/program-leader-routes";
import { getDb } from "../db/client";

// Only registered command paths select these fixed stage names. Neither the
// request path nor any request/exception value is emitted in diagnostics.
const businessFailureStages: ReadonlyMap<string, string> = new Map([
  ["/api/v2/account/phone", "identity-command"],
  ["/api/v2/staff/accounts/identity", "identity-command"],
  ["/api/v2/account/changes/reconcile", "account-change-reconciliation"],
  ["/api/v2/staff/accounts", "assisted-account-command"],
  ["/api/v2/staff/accounts/password-reset", "assisted-account-command"],
  ["/api/v2/staff/accounts/password-reissue", "assisted-account-command"],
  ["/api/v2/staff/accounts/reconcile", "assisted-account-reconciliation"],
  ["/api/v2/account/password", "security-command"],
  ["/api/v2/account/password-confirmation", "security-command"],
  ["/api/v2/account/sessions/revoke-others", "security-command"],
  ["/api/v2/account/security/reconcile", "security-reconciliation"],
  ["/api/v2/applications", "application-command"],
  ["/api/v2/applications/reconcile", "application-reconciliation"],
  ["/api/v2/applications/actions", "applicant-command"],
  ["/api/v2/applications/actions/reconcile", "applicant-reconciliation"],
  ["/api/v2/staff/application-decisions", "decision-command"],
  ["/api/v2/staff/application-decisions/reconcile", "decision-reconciliation"],
  ["/api/v2/staff/accounts/restrictions", "restriction-command"],
  ["/api/v2/staff/accounts/delete", "deletion-command"],
  ["/api/v2/roles/department-managers", "role-command"],
  ["/api/v2/roles/department-managers/reconcile", "role-reconciliation"],
  ["/api/v2/roles/program-leaders", "role-command"],
  ["/api/v2/roles/program-leaders/reconcile", "role-reconciliation"],
]);

/** One generic unexpected-error boundary; internals never reach the client. */
const handleUnexpectedError: ErrorHandler = (error, c) => {
  c.header("cache-control", "private, no-store");
  if (error instanceof BusinessApiError) {
    const request = c.req.raw;
    const { body } = request;
    if (
      (error.code === "origin_denied" || error.code === "rate_limited") &&
      !request.bodyUsed &&
      body !== null
    ) {
      drainRejectedBody(body);
    }
    return c.json(
      { error: { code: error.code, message: error.message } },
      error.status
    );
  }
  console.error(
    JSON.stringify({
      category: "unexpected",
      outcome: "failed",
      stage:
        c.req.method === "POST"
          ? (businessFailureStages.get(c.req.path) ?? "business-request")
          : "business-request",
    })
  );
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

const applicationGuard =
  (action: "create" | "reconcile") =>
  async (c: Context, next: Next): Promise<void> => {
    c.header("cache-control", "private, no-store");
    await guardBusinessRequest(c.req.raw, action);
    return next();
  };

const applicationJsonValidator = boundedJsonValidator(
  applicationBodySchema,
  "申請資料格式不正確。"
);
const reconciliationJsonValidator = boundedJsonValidator(
  reconciliationBodySchema,
  "申請資料格式不正確。"
);

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
  .route("/", departmentManagerRoutes)
  .route("/", programLeaderRoutes)
  .route("/", decisionRoutes)
  .route("/", auditRoutes)
  .route("/", deletionRoutes)
  .post(
    "/applications",
    applicationGuard("create"),
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
  BusinessErrorResponses
>;

export const handleBusinessRequest = (
  request: Request
): Response | Promise<Response> => businessApi.fetch(request);
