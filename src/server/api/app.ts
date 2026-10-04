import { Hono } from "hono";
import type { ErrorHandler } from "hono";
import type { ApplyGlobalResponse } from "hono/client";

import {
  createApplicationDecision,
  getAccountAudit,
  getDecisionInbox,
  getOwnApplication,
  getReviewApplications,
  parseDecisionReconciliationRequest,
  parseDecisionRequest,
  reconcileApplicationDecision,
} from "@/features/account/decisions";

import {
  changeOwnPhone,
  correctStaffIdentity,
  getOwnAccountIdentity,
  parseOwnPhone,
  parseStaffIdentity,
  parseIdentityReconciliation,
  reconcileIdentityChange,
} from "../../features/account/account-changes";
import {
  createApplicantAction,
  getApplicantState,
  parseApplicantAction,
  parseApplicantReconciliation,
  reconcileApplicantAction,
} from "../../features/account/applicant-actions";
import {
  ApplicationRequestError,
  createApplication,
  guardApplicationRequest,
  parseApplicationRequest,
  parseReconciliationRequest,
  reconcileApplication,
} from "../../features/account/applications";
import {
  changeAccountRestriction,
  parseRestrictionRequest,
} from "../../features/account/restrictions";
import {
  createAccountSecurityOperation,
  getAccountSecurityState,
  parseAccountSecurityRequest,
  parseSecurityReconciliationRequest,
  reconcileAccountSecurityOperation,
} from "../../features/account/security";
import {
  createAssistedAccount,
  getStaffAccounts,
  parseStaffCreationRequest,
  parseStaffAccountReconciliation,
  reconcileStaffAccount,
  parseStaffPasswordRequest,
  resetStaffPassword,
} from "../../features/account/staff-accounts";
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
  .get("/applications/mine", async (c) => {
    const application = await getOwnApplication(c.req.raw.headers);
    return c.json({ data: { application } }, 200);
  })
  .get("/applications/self-service", async (c) => {
    const state = await getApplicantState(c.req.raw.headers);
    return c.json({ data: { state } }, 200);
  })
  .post("/applications/actions", async (c) => {
    await guardApplicationRequest(c.req.raw, "applicant-action");
    const input = await parseApplicantAction(c.req.raw);
    const result = await createApplicantAction(c.req.raw.headers, input);
    return c.json(
      { data: { receipt: result.receipt } },
      result.created ? 201 : 200
    );
  })
  .post("/applications/actions/reconcile", async (c) => {
    await guardApplicationRequest(c.req.raw, "applicant-reconcile");
    const input = await parseApplicantReconciliation(c.req.raw);
    const receipt = await reconcileApplicantAction(
      c.req.raw.headers,
      input.operationKey
    );
    return c.json({ data: { receipt } }, 200);
  })
  .get("/inbox", async (c) => {
    const decisions = await getDecisionInbox(c.req.raw.headers);
    return c.json({ data: { decisions } }, 200);
  })
  .get("/staff/applications", async (c) => {
    const applications = await getReviewApplications(c.req.raw.headers);
    return c.json({ data: { applications } }, 200);
  })
  .get("/staff/account-audit", async (c) => {
    const events = await getAccountAudit(c.req.raw.headers);
    return c.json({ data: { events } }, 200);
  })
  .post("/staff/application-decisions", async (c) => {
    c.header("cache-control", "private, no-store");
    await guardApplicationRequest(c.req.raw, "decision");
    const input = await parseDecisionRequest(c.req.raw);
    const result = await createApplicationDecision(c.req.raw.headers, input);
    return c.json(
      { data: { decision: result.decision } },
      result.created ? 201 : 200
    );
  })
  .post("/staff/application-decisions/reconcile", async (c) => {
    c.header("cache-control", "private, no-store");
    await guardApplicationRequest(c.req.raw, "decision-reconcile");
    const input = await parseDecisionReconciliationRequest(c.req.raw);
    const result = await reconcileApplicationDecision(
      c.req.raw.headers,
      input.operationKey,
      input.applicationId
    );
    return c.json({ data: result }, 200);
  })
  .post("/applications", async (c) => {
    c.header("cache-control", "private, no-store");
    await guardApplicationRequest(c.req.raw, "create");
    const input = await parseApplicationRequest(c.req.raw);
    const result = await createApplication(input);
    return c.json(
      { data: { outcome: "pending" as const } },
      result === "created" ? 201 : 200
    );
  })
  .post("/applications/reconcile", async (c) => {
    c.header("cache-control", "private, no-store");
    await guardApplicationRequest(c.req.raw, "reconcile");
    const input = await parseReconciliationRequest(c.req.raw);
    const outcome = await reconcileApplication(input.operationKey);
    return c.json({ data: { outcome } }, 200);
  })
  .get("/account/security", async (c) => {
    const state = await getAccountSecurityState(c.req.raw.headers);
    return c.json({ data: { state } }, 200);
  })
  .get("/account/identity", async (c) => {
    const identity = await getOwnAccountIdentity(c.req.raw.headers);
    return c.json({ data: { identity } }, 200);
  })
  .post("/account/phone", async (c) => {
    await guardApplicationRequest(c.req.raw, "own-phone");
    const input = await parseOwnPhone(c.req.raw);
    const result = await changeOwnPhone(c.req.raw.headers, input);
    return c.json(
      { data: { receipt: result.receipt } },
      result.created ? 201 : 200
    );
  })
  .post("/staff/accounts/identity", async (c) => {
    await guardApplicationRequest(c.req.raw, "staff-identity");
    const input = await parseStaffIdentity(c.req.raw);
    const result = await correctStaffIdentity(c.req.raw.headers, input);
    return c.json(
      { data: { receipt: result.receipt } },
      result.created ? 201 : 200
    );
  })
  .post("/staff/accounts/restrictions", async (c) => {
    await guardApplicationRequest(c.req.raw, "account-restriction");
    const input = await parseRestrictionRequest(c.req.raw);
    const result = await changeAccountRestriction(c.req.raw.headers, input);
    return c.json(
      { data: { receipt: result.receipt } },
      result.created ? 201 : 200
    );
  })
  .post("/account/changes/reconcile", async (c) => {
    await guardApplicationRequest(c.req.raw, "account-change-reconcile");
    const input = await parseIdentityReconciliation(c.req.raw);
    const receipt = await reconcileIdentityChange(
      c.req.raw.headers,
      input.operationKey
    );
    return c.json({ data: { receipt } }, 200);
  })
  .get("/staff/accounts", async (c) => {
    const accounts = await getStaffAccounts(c.req.raw.headers);
    return c.json({ data: { accounts } }, 200);
  })
  .post("/staff/accounts", async (c) => {
    await guardApplicationRequest(c.req.raw, "staff-account-create");
    const result = await createAssistedAccount(
      c.req.raw.headers,
      await parseStaffCreationRequest(c.req.raw)
    );
    return c.json(
      {
        data: {
          receipt: result.receipt,
          ...("temporaryPassword" in result
            ? { temporaryPassword: result.temporaryPassword }
            : {}),
        },
      },
      result.created ? 201 : 200
    );
  })
  .post("/staff/accounts/reconcile", async (c) => {
    await guardApplicationRequest(c.req.raw, "staff-account-reconcile");
    const input = await parseStaffAccountReconciliation(c.req.raw);
    const receipt = await reconcileStaffAccount(
      c.req.raw.headers,
      input.operationKey
    );
    return c.json({ data: { receipt } }, 200);
  })
  .post("/staff/accounts/password-reissue", async (c) => {
    await guardApplicationRequest(c.req.raw, "staff-password-reissue");
    const result = await resetStaffPassword(
      c.req.raw.headers,
      await parseStaffPasswordRequest(c.req.raw),
      true
    );
    return c.json(
      {
        data: {
          receipt: result.receipt,
          ...("temporaryPassword" in result
            ? { temporaryPassword: result.temporaryPassword }
            : {}),
        },
      },
      result.created ? 201 : 200
    );
  })
  .post("/staff/accounts/password-reset", async (c) => {
    await guardApplicationRequest(c.req.raw, "staff-password-reset");
    const result = await resetStaffPassword(
      c.req.raw.headers,
      await parseStaffPasswordRequest(c.req.raw),
      false
    );
    return c.json(
      {
        data: {
          receipt: result.receipt,
          ...("temporaryPassword" in result
            ? { temporaryPassword: result.temporaryPassword }
            : {}),
        },
      },
      result.created ? 201 : 200
    );
  })
  .post("/account/password", async (c) => {
    c.header("cache-control", "private, no-store");
    await guardApplicationRequest(c.req.raw, "password-change");
    const input = await parseAccountSecurityRequest(
      c.req.raw,
      "password_changed"
    );
    const result = await createAccountSecurityOperation(
      c.req.raw.headers,
      input
    );
    return c.json(
      { data: { receipt: result.receipt } },
      result.created ? 201 : 200
    );
  })
  .post("/account/sessions/revoke-others", async (c) => {
    c.header("cache-control", "private, no-store");
    await guardApplicationRequest(c.req.raw, "session-revoke");
    const input = await parseAccountSecurityRequest(
      c.req.raw,
      "other_sessions_revoked"
    );
    const result = await createAccountSecurityOperation(
      c.req.raw.headers,
      input
    );
    return c.json(
      { data: { receipt: result.receipt } },
      result.created ? 201 : 200
    );
  })
  .post("/account/password-confirmation", async (c) => {
    c.header("cache-control", "private, no-store");
    await guardApplicationRequest(c.req.raw, "password-confirmation");
    const input = await parseAccountSecurityRequest(
      c.req.raw,
      "password_confirmed"
    );
    const result = await createAccountSecurityOperation(
      c.req.raw.headers,
      input
    );
    return c.json(
      { data: { receipt: result.receipt } },
      result.created ? 201 : 200
    );
  })
  .post("/account/security/reconcile", async (c) => {
    c.header("cache-control", "private, no-store");
    await guardApplicationRequest(c.req.raw, "security-reconcile");
    const input = await parseSecurityReconciliationRequest(c.req.raw);
    const receipt = await reconcileAccountSecurityOperation(
      c.req.raw.headers,
      input.operationKey
    );
    return c.json({ data: { receipt } }, 200);
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
