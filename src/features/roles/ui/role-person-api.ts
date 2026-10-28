export type RolePersonAccountRole = "admin" | "member" | "staff";

export interface RolePersonCandidate {
  accountRole: RolePersonAccountRole;
  fullName: string;
  userId: string;
  username: string | null;
}

export interface RolePersonSearchPage {
  actorKind: "admin" | "role_assigner";
  actorUserId: string;
  authorityAssignmentId: string | null;
  candidates: RolePersonCandidate[];
  hasNextPage: boolean;
  page: number;
}

export interface RolePersonDutyProgram {
  assignmentId: string;
  createdAt: number;
  programId: string;
  programName: string;
}

export interface RolePersonDutyGroup {
  departmentId: string;
  departmentName: string;
  manager: { assignmentId: string; createdAt: number } | null;
  programs: RolePersonDutyProgram[];
  programsPage: number;
  hasNextProgramsPage: boolean;
}

export interface RolePersonDuties {
  groupCount: number | null;
  groups: RolePersonDutyGroup[];
  hasNextPage: boolean;
  page: number;
  pageSize: number;
  status: "complete" | "partial";
}

export interface RolePersonDetail {
  actorKind: "admin" | "role_assigner";
  actorUserId: string;
  authorityAssignmentId: string | null;
  capabilities: {
    canGrantAdmin: boolean;
    canManageAccountRole: boolean;
    canManageDuties: boolean;
    canManageRoleAssigner: boolean;
  };
  duties: RolePersonDuties;
  global: {
    eligibleForAdmin: boolean;
    eligibleForRoleAssigner: boolean;
    eligibleForStaff: boolean;
    permanentCredential: "first-change-required" | "missing" | "usable";
    role: RolePersonAccountRole;
    roleAssignerAssignment: {
      assignmentId: string;
      createdAt: number;
    } | null;
  } | null;
  identity: {
    accountState: "active" | "banned" | "deactivated" | "pending";
    fullName: string;
    role: RolePersonAccountRole;
    userId: string;
    username: string | null;
  };
  isSelf: boolean;
}

interface ErrorBody {
  error?: { code?: string; message?: string };
}

export class RolePersonApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "RolePersonApiError";
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
    throw new RolePersonApiError(
      response.status,
      error?.error?.code ?? "service_error",
      error?.error?.message ?? "人員權責服務暫時無法回應。"
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

export const searchRolePeople = (
  query: string,
  page: number,
  signal?: AbortSignal
) => {
  const search = new URLSearchParams({ page: String(page), q: query });
  return get<RolePersonSearchPage>(
    `/api/v2/roles/people?${search.toString()}`,
    signal
  );
};

export const getRolePersonDetail = (
  targetUserId: string,
  assignmentPage: number,
  signal?: AbortSignal,
  programDepartment?: string,
  programPage?: number
) => {
  const search = new URLSearchParams({
    assignmentPage: String(assignmentPage),
  });
  if (programDepartment && programPage) {
    search.set("programDepartment", programDepartment);
    search.set("programPage", String(programPage));
  }
  return get<{ person: RolePersonDetail }>(
    `/api/v2/roles/people/${encodeURIComponent(targetUserId)}?${search.toString()}`,
    signal
  );
};
