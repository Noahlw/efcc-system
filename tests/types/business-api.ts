import { hc } from "hono/client";
import type { InferRequestType, InferResponseType } from "hono/client";

import type {
  DecisionReconciliationInput,
  DecisionWriteInput,
} from "../../src/features/account/decision-contract";
import type { AppType } from "../../src/server/api/app";
import { businessRpc } from "../../src/shared/business-rpc";

// Compile-only consumer: native RPC must retain routes and discriminated bodies.
const client = hc<AppType>("http://localhost:5199");

export const readIdentity = async () => {
  const response = await client.api.v2.me.$get();
  if (response.status === 200) {
    const { data } = await response.json();
    const name: string = data.displayName;
    const username: string | null = data.username;
    const membership: "active" | "pending" | "deactivated" =
      data.membershipStatus;
    return { membership, name, username };
  }
  const { error } = await response.json();
  const message: string = error.message;
  const code: string = error.code;
  return { code, message };
};

export const readStatus = async () => {
  const response = await client.api.v2.status.$get();
  if (response.status === 200) {
    const { data } = await response.json();
    const allowed: boolean = data.accessAllowed;
    const name: string | null = data.displayName;
    const reasons: readonly string[] = data.reasons;
    return { allowed, name, reasons };
  }
  const { error } = await response.json();
  const message: string = error.message;
  const code: string = error.code;
  return { code, message };
};

// Global error responses must also be part of each route's status union.
export const readGlobalErrors = async () => {
  const response = await client.api.v2.me.$get();
  if (response.status === 500 || response.status === 404) {
    const { error } = await response.json();
    const code: "internal_error" | "not_found" = error.code;
    return code;
  }
  return null;
};

type PublicApplicationRequest = InferRequestType<
  typeof businessRpc.api.v2.applications.$post
>["json"];
type PublicApplicationSuccess = InferResponseType<
  typeof businessRpc.api.v2.applications.$post,
  200 | 201
>;

const publicApplicationRequest: PublicApplicationRequest = {
  email: "applicant@example.test",
  fullName: "陳申請",
  operationKey: "a".repeat(64),
  password: "Synthetic-password-17!",
  phone: "+85221234567",
  username: "applicant",
};

export const submitPublicApplication = async () => {
  const response = await businessRpc.api.v2.applications.$post(
    { json: publicApplicationRequest },
    { init: { cache: "no-store", credentials: "omit" } }
  );
  if (response.status === 200 || response.status === 201) {
    const body: PublicApplicationSuccess = await response.json();
    const outcome: "pending" = body.data.outcome;
    return outcome;
  }
  if (
    response.status === 400 ||
    response.status === 403 ||
    response.status === 409 ||
    response.status === 429
  ) {
    const { error } = await response.json();
    return error.code;
  }
  return "unknown";
};

export const applicationCannotSelectMembershipStatus = () =>
  businessRpc.api.v2.applications.$post({
    json: {
      ...publicApplicationRequest,
      // @ts-expect-error membership status is server-owned
      membershipStatus: "active",
    },
  });

type ApplicantActionRequest = InferRequestType<
  typeof businessRpc.api.v2.applications.actions.$post
>["json"];
type ApplicantActionSuccess = InferResponseType<
  typeof businessRpc.api.v2.applications.actions.$post,
  200 | 201
>;
type ApplicantReconciliationRequest = InferRequestType<
  typeof businessRpc.api.v2.applications.actions.reconcile.$post
>["json"];

const applicantCorrection: ApplicantActionRequest = {
  action: "application_corrected",
  applicationId: "00000000-0000-4000-8000-000000000000",
  email: "member@example.test",
  fullName: "陳會員",
  operationKey: "00000000-0000-4000-8000-000000000001",
  phone: "61234567",
};

export const submitApplicantCorrection = async () => {
  const response = await businessRpc.api.v2.applications.actions.$post(
    { json: applicantCorrection },
    {
      headers: { "x-efcc-expected-actor-id": "synthetic-actor" },
      init: { cache: "no-store" },
    }
  );
  if (response.status === 200 || response.status === 201) {
    const body: ApplicantActionSuccess = await response.json();
    const action:
      | "application_corrected"
      | "application_withdrawn"
      | "application_resubmitted" = body.data.receipt.action;
    const createdAt: number = body.data.receipt.createdAt;
    return { action, createdAt };
  }
  if (
    response.status === 400 ||
    response.status === 401 ||
    response.status === 403 ||
    response.status === 409 ||
    response.status === 429
  ) {
    const { error } = await response.json();
    return error.code;
  }
  return "unknown";
};

// Staff decision commands are typed through the same client. The request body
// stays the shared Zod contract; the route returns the committed staff payload.
type StaffDecisionRoutes =
  (typeof businessRpc)["api"]["v2"]["staff"]["application-decisions"];
type StaffDecisionWrite = InferResponseType<
  StaffDecisionRoutes["$post"],
  200 | 201
>;
type StaffDecisionReconciliation = InferResponseType<
  StaffDecisionRoutes["reconcile"]["$post"],
  200
>;

export const submitStaffDecision = async (request: DecisionWriteInput) => {
  const response = await businessRpc.api.v2.staff[
    "application-decisions"
  ].$post(
    { json: request },
    {
      headers: { "x-efcc-expected-actor-id": "compiled-only" },
      init: { cache: "no-store", credentials: "same-origin" },
    }
  );
  if (response.status === 200 || response.status === 201) {
    const body: StaffDecisionWrite = await response.json();
    const outcome: "approved" | "rejected" = body.data.decision.outcome;
    const note: string | null = body.data.decision.internalNote;
    return { note, outcome };
  }
  if (
    response.status === 400 ||
    response.status === 401 ||
    response.status === 403 ||
    response.status === 409 ||
    response.status === 429
  ) {
    const { error } = await response.json();
    return error.code;
  }
  return "unknown";
};

export const reconcileStaffDecision = async (
  request: DecisionReconciliationInput
) => {
  const response = await businessRpc.api.v2.staff[
    "application-decisions"
  ].reconcile.$post({ json: request });
  if (response.status === 200) {
    const body: StaffDecisionReconciliation = await response.json();
    const status:
      | "pending"
      | "approved"
      | "rejected"
      | "withdrawn"
      | null
      | undefined = body.data.applicationStatus;
    return { decisionId: body.data.decision?.id ?? null, status };
  }
  return "unknown";
};

const applicantReconciliation: ApplicantReconciliationRequest = {
  operationKey: "00000000-0000-4000-8000-000000000001",
};

export const reconcileApplicantAction = async () => {
  const response =
    await businessRpc.api.v2.applications.actions.reconcile.$post(
      { json: applicantReconciliation },
      {
        headers: { "x-efcc-expected-actor-id": "synthetic-actor" },
        init: { cache: "no-store" },
      }
    );
  if (response.status === 200) {
    const { data } = await response.json();
    return data.receipt?.action ?? null;
  }
  return null;
};

export const readApplicantProjection = async () => {
  const mine = await businessRpc.api.v2.applications.mine.$get();
  const state = await businessRpc.api.v2.applications["self-service"].$get();
  if (mine.status === 200 && state.status === 200) {
    const mineBody = await mine.json();
    const stateBody = await state.json();
    const eligible: boolean = stateBody.data.state.eligible;
    const status: "pending" | "approved" | "rejected" | "withdrawn" | null =
      mineBody.data.application?.status ?? null;
    return { eligible, status };
  }
  return null;
};

export const applicantEditCannotClaimAnotherAccount = () =>
  businessRpc.api.v2.applications.actions.$post({
    json: {
      ...applicantCorrection,
      // @ts-expect-error an applicant edit never carries account-creation fields
      username: "forged-username",
    },
  });

// Account security commands keep their receipt union and expected-actor header.
type SecurityCommandSuccess = InferResponseType<
  typeof businessRpc.api.v2.account.password.$post,
  200 | 201
>;
type SecurityReconciliationSuccess = InferResponseType<
  typeof businessRpc.api.v2.account.security.reconcile.$post,
  200
>;

export const changeOwnPassword = async (actorUserId: string) => {
  const response = await businessRpc.api.v2.account.password.$post(
    {
      json: {
        currentPassword: "Synthetic-current-password!",
        newPassword: "Synthetic-new-password!",
        operationKey: crypto.randomUUID(),
      },
    },
    {
      headers: { "x-efcc-expected-actor-id": actorUserId },
      init: { cache: "no-store", credentials: "same-origin" },
    }
  );
  if (response.status === 200 || response.status === 201) {
    const body: SecurityCommandSuccess = await response.json();
    const receipt: {
      action:
        | "other_sessions_revoked"
        | "password_changed"
        | "password_confirmed";
      createdAt: number;
      id: string;
    } = body.data.receipt;
    return receipt;
  }
  const body = await response.json();
  if ("error" in body) {
    const code: string = body.error.code;
    return code;
  }
  return "unknown";
};

export const readSecurityOperationReceipt = async (operationKey: string) => {
  const response = await businessRpc.api.v2.account.security.reconcile.$post({
    json: { operationKey },
  });
  if (response.status !== 200) {
    return null;
  }
  const body: SecurityReconciliationSuccess = await response.json();
  const receipt: SecurityReconciliationSuccess["data"]["receipt"] =
    body.data.receipt;
  return receipt;
};
