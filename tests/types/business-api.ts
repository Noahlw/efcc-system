import { hc } from "hono/client";
import type { InferRequestType, InferResponseType } from "hono/client";

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
