export interface ProgramLeaderCandidate {
  fullName: string;
  userId: string;
  username: string | null;
}

export interface ProgramLeaderSearchPage {
  actorUserId: string;
  candidates: ProgramLeaderCandidate[];
  hasNextPage: boolean;
  page: number;
}

export interface ProgramLeaderProgram {
  departmentName: string;
  id: string;
  name: string;
}

export interface ProgramLeaderProgramPage {
  actorUserId?: string;
  authorityAssignmentId?: string;
  hasNextPage: boolean;
  page: number;
  programs: ProgramLeaderProgram[];
}

export interface ProgramLeaderDepartmentPage {
  actorUserId: string;
  departments: { assignmentId: string; id: string; name: string }[];
  hasNextPage: boolean;
  page: number;
}

export interface ProgramLeaderRosterPage {
  actorUserId: string;
  authorityAssignmentId: string;
  hasNextPage: boolean;
  leaders: {
    assignmentId: string;
    createdAt: number;
    eligibleForWithdrawal: boolean;
    fullName: string;
    userId: string;
    username: string | null;
  }[];
  page: number;
}

export interface ProgramLeaderCandidatePage {
  actorUserId: string;
  authorityAssignmentId: string;
  candidates: ProgramLeaderCandidate[];
  hasNextPage: boolean;
  page: number;
}

export interface ProgramLeaderAssignment {
  assignmentId: string;
  createdAt: number;
  departmentName: string;
  scopeId: string;
  scopeName: string;
}

export interface ProgramLeaderPerson {
  eligibleForGrant: boolean;
  fullName: string;
  userId: string;
  username: string | null;
  assignments: ProgramLeaderAssignment[];
  assignmentPage: { hasNextPage: boolean; number: number };
}

export interface ProgramLeaderReceipt {
  action: "granted" | "withdrawn";
  createdAt: number;
  id: string;
  scopeId: string;
  scopeName: string;
  targetUserId: string;
}

export type ProgramLeaderChange =
  | {
      action: "granted";
      authorityAssignmentId?: string;
      operationKey: string;
      scopeId: string;
      targetUserId: string;
    }
  | {
      action: "withdrawn";
      authorityAssignmentId?: string;
      expectedAssignmentId: string;
      operationKey: string;
      scopeId: string;
      targetUserId: string;
    };

export interface ProgramLeaderReconciliation {
  outcome: "committed" | "unknown";
  receipt: ProgramLeaderReceipt | null;
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
      error?.error?.message ?? "Program Leader 服務暫時無法回應。"
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

const post = async <T>(path: string, body: unknown): Promise<T> =>
  readData<T>(
    await fetch(path, {
      body: JSON.stringify(body),
      cache: "no-store",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );

export const searchProgramLeaderPeople = (
  query: string,
  page: number,
  signal?: AbortSignal
) => {
  const search = new URLSearchParams({ page: String(page), q: query });
  return get<ProgramLeaderSearchPage>(
    `/api/v2/roles/program-leaders?${search.toString()}`,
    signal
  );
};

export const getProgramLeaderPrograms = (
  page: number,
  departmentIdOrSignal?: string | AbortSignal,
  signal?: AbortSignal
) => {
  const departmentId =
    typeof departmentIdOrSignal === "string" ? departmentIdOrSignal : undefined;
  const requestSignal =
    typeof departmentIdOrSignal === "string" ? signal : departmentIdOrSignal;
  const search = new URLSearchParams({ page: String(page) });
  if (departmentId) {
    search.set("departmentId", departmentId);
  }
  return get<ProgramLeaderProgramPage>(
    `/api/v2/roles/program-leaders/programs?${search.toString()}`,
    requestSignal
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

export const getProgramLeaderRoster = (
  programId: string,
  page: number,
  signal?: AbortSignal
) =>
  get<ProgramLeaderRosterPage>(
    `/api/v2/roles/program-leaders/programs/${encodeURIComponent(programId)}/leaders?page=${page}`,
    signal
  );

export const getProgramLeaderCandidates = (
  programId: string,
  query: string,
  page: number,
  signal?: AbortSignal
) => {
  const search = new URLSearchParams({ page: String(page), q: query });
  return get<ProgramLeaderCandidatePage>(
    `/api/v2/roles/program-leaders/programs/${encodeURIComponent(programId)}/candidates?${search.toString()}`,
    signal
  );
};

export const getProgramLeaderPerson = (
  targetUserId: string,
  assignmentPage: number,
  signal?: AbortSignal
) =>
  get<{ person: ProgramLeaderPerson }>(
    `/api/v2/roles/program-leaders/${encodeURIComponent(targetUserId)}?assignmentPage=${assignmentPage}`,
    signal
  );

export const confirmProgramLeaderPassword = (
  operationKey: string,
  password: string
) =>
  post<unknown>("/api/v2/account/password-confirmation", {
    operationKey,
    password,
  });

export const changeProgramLeader = (input: ProgramLeaderChange) =>
  post<{ receipt: ProgramLeaderReceipt }>(
    "/api/v2/roles/program-leaders",
    input
  );

export const reconcileProgramLeaderChange = (operationKey: string) =>
  post<ProgramLeaderReconciliation>("/api/v2/roles/program-leaders/reconcile", {
    operationKey,
  });
