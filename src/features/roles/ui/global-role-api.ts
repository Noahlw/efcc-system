import * as z from "zod";

import { globalRoleReceiptSchema } from "../global-role-contract";
import type { GlobalRoleChangeInput } from "../global-role-contract";
import { roleAssignerReceiptSchema } from "../role-assigner-contract";
import type { RoleAssignerChangeInput } from "../role-assigner-contract";

export interface GlobalRoleCandidate {
  fullName: string;
  userId: string;
  username: string | null;
}

export interface GlobalRoleSearchPage {
  actorUserId: string;
  candidates: GlobalRoleCandidate[];
  hasNextPage: boolean;
  page: number;
}

export interface GlobalRolePerson {
  eligibleForAdmin: boolean;
  eligibleForRoleAssigner: boolean;
  eligibleForStaff: boolean;
  fullName: string;
  role: "member" | "staff";
  roleAssignerAssignment: { assignmentId: string; createdAt: number } | null;
  userId: string;
  username: string | null;
}

interface ErrorBody {
  error?: { code?: string; message?: string };
}

export class GlobalRoleApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "GlobalRoleApiError";
    this.code = code;
    this.status = status;
  }
}

const readData = async <T>(response: Response): Promise<T> => {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const error = body as ErrorBody | null;
    throw new GlobalRoleApiError(
      response.status,
      error?.error?.code ?? "service_error",
      error?.error?.message ?? "全域角色服務暫時無法回應。"
    );
  }
  return (body as { data: T }).data;
};

const get = async <T>(path: string, signal?: AbortSignal): Promise<T> =>
  readData<T>(
    await fetch(path, {
      cache: "no-store",
      credentials: "same-origin",
      signal,
    })
  );

const post = async <T>(
  path: string,
  body: unknown,
  actorUserId?: string,
  signal?: AbortSignal
): Promise<T> =>
  readData<T>(
    await fetch(path, {
      body: JSON.stringify(body),
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        ...(actorUserId ? { "x-efcc-expected-actor-id": actorUserId } : {}),
      },
      method: "POST",
      signal,
    })
  );

export const searchGlobalRolePeople = (
  query: string,
  page: number,
  signal?: AbortSignal
) => {
  const search = new URLSearchParams({ page: String(page), q: query });
  return get<GlobalRoleSearchPage>(
    `/api/v2/roles/global-roles?${search.toString()}`,
    signal
  );
};

export const changeGlobalRole = async (
  input: GlobalRoleChangeInput,
  actorUserId: string
) =>
  z
    .object({ receipt: globalRoleReceiptSchema })
    .parse(
      await post<unknown>("/api/v2/roles/global-roles", input, actorUserId)
    );

export const reconcileGlobalRoleChange = async (
  operationKey: string,
  actorUserId: string,
  signal: AbortSignal
) =>
  z
    .object({
      outcome: z.enum(["committed", "unknown"]),
      receipt: globalRoleReceiptSchema.nullable(),
    })
    .parse(
      await post<unknown>(
        "/api/v2/roles/global-roles/reconcile",
        { operationKey },
        actorUserId,
        signal
      )
    );

export const changeRoleAssigner = async (
  input: RoleAssignerChangeInput,
  actorUserId: string
) =>
  z
    .object({ receipt: roleAssignerReceiptSchema })
    .parse(
      await post<unknown>("/api/v2/roles/role-assigners", input, actorUserId)
    );

export const reconcileRoleAssignerChange = async (
  operationKey: string,
  actorUserId: string,
  signal: AbortSignal
) =>
  z
    .object({
      outcome: z.enum(["committed", "unknown"]),
      receipt: roleAssignerReceiptSchema.nullable(),
    })
    .parse(
      await post<unknown>(
        "/api/v2/roles/role-assigners/reconcile",
        {
          operationKey,
        },
        actorUserId,
        signal
      )
    );
