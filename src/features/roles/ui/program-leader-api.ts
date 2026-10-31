import {
  programLeaderDepartmentProgramsSchema,
  programLeaderGlobalProgramsSchema,
  programLeaderReconciliationResultSchema,
  programLeaderRosterSchema,
} from "../program-leader-contract";
import type { ProgramLeaderAuthorityKind } from "../program-leader-grant-batch-contract";

export interface ProgramLeaderProgram {
  departmentName: string;
  departmentId: string;
  id: string;
  name: string;
}

export interface ProgramLeaderDepartmentPage {
  actorUserId: string;
  departments: { assignmentId: string; id: string; name: string }[];
  hasNextPage: boolean;
  page: number;
}

interface ErrorBody {
  error?: { code?: string; message?: string };
}

export class ProgramLeaderApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ProgramLeaderApiError";
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
    throw new ProgramLeaderApiError(
      response.status,
      error?.error?.code ?? "service_error",
      error?.error?.message ?? "聚會職務服務暫時無法回應。"
    );
  }
  return (body as { data: T }).data;
};

const get = async <T>(path: string, signal?: AbortSignal): Promise<T> =>
  readData<T>(
    await fetch(path, { cache: "no-store", credentials: "same-origin", signal })
  );

export const getDepartmentProgramLeaderPrograms = async (
  actorUserId: string,
  departmentId: string,
  page: number,
  signal: AbortSignal
) => {
  const query = new URLSearchParams({
    departmentId,
    local: "1",
    page: String(page),
  });
  const response = await fetch(
    `/api/v2/roles/program-leaders/programs?${query}`,
    {
      cache: "no-store",
      credentials: "same-origin",
      headers: { "x-efcc-expected-actor-id": actorUserId },
      signal,
    }
  );
  return programLeaderDepartmentProgramsSchema.parse(
    await readData<unknown>(response)
  );
};

export const getProgramLeaderDepartments = (
  page: number,
  signal?: AbortSignal
) =>
  get<ProgramLeaderDepartmentPage>(
    `/api/v2/roles/program-leaders/departments?page=${page}`,
    signal
  );

export const getGlobalProgramLeaderPrograms = async (
  actorUserId: string,
  authorityKind: "admin" | "role_assigner",
  page: number,
  signal: AbortSignal
) => {
  const response = await fetch(
    `/api/v2/roles/program-leaders/programs?${new URLSearchParams({ authority: authorityKind, page: String(page) })}`,
    {
      cache: "no-store",
      credentials: "same-origin",
      headers: { "x-efcc-expected-actor-id": actorUserId },
      signal,
    }
  );
  return programLeaderGlobalProgramsSchema.parse(
    await readData<unknown>(response)
  );
};

export const getProgramLeaderRoster = async (
  programId: string,
  page: number,
  authorityKind: ProgramLeaderAuthorityKind,
  signal?: AbortSignal
) =>
  programLeaderRosterSchema.parse(
    await get<unknown>(
      `/api/v2/roles/program-leaders/programs/${encodeURIComponent(programId)}/leaders?${new URLSearchParams({ authority: authorityKind, page: String(page) })}`,
      signal
    )
  );

export const reconcileProgramLeaderChange = async (
  operationKey: string,
  actorUserId: string,
  authorityKind: "department_manager" | undefined,
  signal?: AbortSignal
) =>
  programLeaderReconciliationResultSchema.parse(
    await readData<unknown>(
      await fetch("/api/v2/roles/program-leaders/reconcile", {
        body: JSON.stringify({ authorityKind, operationKey }),
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-efcc-expected-actor-id": actorUserId,
        },
        method: "POST",
        signal,
      })
    )
  );
