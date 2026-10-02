import { hc } from "hono/client";

import type { AppType } from "../../src/server/api/app";

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
    const reasons: string[] = data.reasons;
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
