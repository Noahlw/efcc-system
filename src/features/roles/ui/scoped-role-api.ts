import * as z from "zod";

import {
  scopedRoleBaselineSchema,
  scopedRoleChangeReceiptSchema,
  scopedRoleReconciliationSchema,
  scopedRoleProgramBaselineSchema,
} from "../scoped-role-change-contract";
import type { ScopedRoleChangeInput } from "../scoped-role-change-contract";

export type ScopedRoleBaseline = z.output<typeof scopedRoleBaselineSchema>;
export type ScopedRoleDepartment = ScopedRoleBaseline["departments"][number];
export type ScopedRoleProgramBaseline = z.output<
  typeof scopedRoleProgramBaselineSchema
>;
export type ScopedRoleProgram = ScopedRoleProgramBaseline["programs"][number];

const errorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
const dataSchema = z.object({ data: z.unknown() });

export class ScopedRoleApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ScopedRoleApiError";
    this.status = status;
    this.code = code;
  }
}

const readData = async (response: Response) => {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const error = errorSchema.safeParse(body);
    throw new ScopedRoleApiError(
      response.status,
      error.success ? error.data.error.code : "service_error",
      error.success ? error.data.error.message : "部門職務服務暫時未能回應。"
    );
  }
  return dataSchema.parse(body).data;
};

const post = async (path: string, actorUserId: string, input: unknown) =>
  readData(
    await fetch(path, {
      body: JSON.stringify(input),
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        "x-efcc-expected-actor-id": actorUserId,
      },
      method: "POST",
    })
  );

export const getScopedRoleBaseline = async (
  actorUserId: string,
  targetUserId: string,
  page: number,
  signal: AbortSignal
) =>
  scopedRoleBaselineSchema.parse(
    await readData(
      await fetch(
        `/api/v2/roles/scoped-department-managers/${encodeURIComponent(targetUserId)}?page=${page}`,
        {
          cache: "no-store",
          credentials: "same-origin",
          headers: { "x-efcc-expected-actor-id": actorUserId },
          signal,
        }
      )
    )
  );

export const getScopedRoleProgramBaseline = async (
  actorUserId: string,
  targetUserId: string,
  departmentId: string,
  page: number,
  signal: AbortSignal,
  programId?: string
) => {
  const query = new URLSearchParams({ departmentId, page: String(page) });
  if (programId) {
    query.set("programId", programId);
  }
  return scopedRoleProgramBaselineSchema.parse(
    await readData(
      await fetch(
        `/api/v2/roles/scoped-department-managers/${encodeURIComponent(targetUserId)}/programs?${query}`,
        {
          cache: "no-store",
          credentials: "same-origin",
          headers: { "x-efcc-expected-actor-id": actorUserId },
          signal,
        }
      )
    )
  );
};

export const changeScopedRoles = async (
  actorUserId: string,
  input: ScopedRoleChangeInput
) =>
  z
    .object({ receipt: scopedRoleChangeReceiptSchema })
    .parse(
      await post("/api/v2/roles/scoped-department-managers", actorUserId, input)
    );

export const reconcileScopedRoles = async (
  actorUserId: string,
  operationKey: string
) =>
  scopedRoleReconciliationSchema.parse(
    await post(
      "/api/v2/roles/scoped-department-managers/reconcile",
      actorUserId,
      { operationKey }
    )
  );
