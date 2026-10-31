import * as z from "zod";

import {
  programLeaderAssigneeBaselineSchema,
  programLeaderRosterSchema,
  programLeaderReconciliationResultSchema,
  programLeaderReceiptSchema,
  programLeaderWithdrawalSchema,
} from "../program-leader-contract";
import {
  scopedRoleBaselineSchema,
  scopedRoleChangeReceiptSchema,
  scopedRoleReconciliationSchema,
  scopedRoleProgramBaselineSchema,
} from "../scoped-role-change-contract";
import type { ScopedRoleChangeInput } from "../scoped-role-change-contract";

export type ScopedRoleBaseline = Omit<
  z.output<typeof scopedRoleBaselineSchema>,
  "actorKind" | "changeLimit" | "mixedChangeLimit"
> & {
  actorKind: "admin" | "role-assigner" | "department-manager";
  changeLimit: number;
  mixedChangeLimit: number;
};
export type ScopedRoleDepartment = ScopedRoleBaseline["departments"][number];
export type ScopedRoleProgramBaseline = Omit<
  z.output<typeof scopedRoleProgramBaselineSchema>,
  "actorKind"
> & { actorKind: ScopedRoleBaseline["actorKind"] };
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

const readLocalProgram = async (
  actorUserId: string,
  programId: string,
  signal: AbortSignal,
  suffix: string
) =>
  readData(
    await fetch(
      `/api/v2/roles/program-leaders/programs/${encodeURIComponent(programId)}/leaders${suffix}`,
      {
        cache: "no-store",
        credentials: "same-origin",
        headers: { "x-efcc-expected-actor-id": actorUserId },
        signal,
      }
    )
  );

export const getLocalProgramAuthority = async (
  actorUserId: string,
  programId: string,
  signal: AbortSignal
) =>
  programLeaderRosterSchema.parse(
    await readLocalProgram(actorUserId, programId, signal, "?page=1")
  );

export const getLocalRoleBaseline = async (
  actorUserId: string,
  programId: string,
  signal: AbortSignal
): Promise<ScopedRoleBaseline> => {
  const current = await getLocalProgramAuthority(
    actorUserId,
    programId,
    signal
  );
  return {
    actorKind: "department-manager",
    actorUserId: current.actorUserId,
    authorityAssignmentId: current.authorityAssignmentId,
    changeLimit: 1,
    departments: [],
    eligibleForGrant: false,
    hasNextPage: false,
    mixedChangeLimit: 1,
    page: 1,
  };
};

export const getLocalRoleProgramBaseline = async (
  actorUserId: string,
  programId: string,
  targetUserId: string,
  departmentId: string,
  signal: AbortSignal
): Promise<ScopedRoleProgramBaseline> => {
  const current = programLeaderAssigneeBaselineSchema.parse(
    await readLocalProgram(
      actorUserId,
      programId,
      signal,
      `/${encodeURIComponent(targetUserId)}`
    )
  );
  if (current.departmentId !== departmentId) {
    throw new ScopedRoleApiError(
      409,
      "authority_changed",
      "聚會所屬部門已改變，請重新查閱。"
    );
  }
  return {
    actorKind: "department-manager",
    actorUserId: current.actorUserId,
    authorityAssignmentId: current.authorityAssignmentId,
    departmentId: current.departmentId,
    departmentName: current.departmentName,
    eligibleForGrant: false,
    hasNextPage: false,
    page: 1,
    programs: [
      {
        assignmentId: current.assignmentId,
        scopeId: current.programId,
        scopeName: current.programName,
      },
    ],
  };
};

const localReceipt = (receipt: z.output<typeof programLeaderReceiptSchema>) =>
  scopedRoleChangeReceiptSchema.parse({
    changes: [
      {
        action: receipt.action,
        role: "program_leader",
        scopeId: receipt.scopeId,
        scopeName: receipt.scopeName,
      },
    ],
    createdAt: receipt.createdAt,
    id: receipt.id,
    targetUserId: receipt.targetUserId,
  });

export const withdrawLocalProgramRole = async (
  actorUserId: string,
  programId: string,
  input: ScopedRoleChangeInput
) => {
  const [change] = input.changes;
  if (
    input.changes.length !== 1 ||
    change?.role !== "program_leader" ||
    change.action !== "withdrawn" ||
    change.scopeId !== programId ||
    !input.authorityAssignmentId
  ) {
    throw new ScopedRoleApiError(
      400,
      "invalid_input",
      "此工作只可撤回目前聚會的職務。"
    );
  }
  const command = programLeaderWithdrawalSchema.parse({
    action: change.action,
    authorityAssignmentId: input.authorityAssignmentId,
    authorityKind: "department_manager",
    expectedAssignmentId: change.expectedAssignmentId,
    operationKey: input.operationKey,
    scopeId: change.scopeId,
    targetUserId: input.targetUserId,
  });
  const result = z
    .object({ receipt: programLeaderReceiptSchema })
    .parse(await post("/api/v2/roles/program-leaders", actorUserId, command));
  return { receipt: localReceipt(result.receipt) };
};

export const reconcileLocalProgramRole = async (
  actorUserId: string,
  operationKey: string
) => {
  const result = programLeaderReconciliationResultSchema.parse(
    await post("/api/v2/roles/program-leaders/reconcile", actorUserId, {
      authorityKind: "department_manager",
      operationKey,
    })
  );
  return result.outcome === "committed"
    ? { outcome: "committed" as const, receipt: localReceipt(result.receipt) }
    : { outcome: "unknown" as const, receipt: null };
};
