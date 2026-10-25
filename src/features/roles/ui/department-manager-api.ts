export interface DepartmentManagerCandidate {
  fullName: string;
  userId: string;
  username: string | null;
}

export interface DepartmentManagerSearchPage {
  actorUserId: string;
  authorityAssignmentId?: string;
  candidates: DepartmentManagerCandidate[];
  hasNextPage: boolean;
  page: number;
}

export interface DepartmentManagerDepartmentPage {
  departments: { id: string; name: string }[];
  hasNextPage: boolean;
  page: number;
}

export interface DepartmentManagerAssignment {
  assignmentId: string;
  createdAt: number;
  scopeId: string;
  scopeName: string;
}

export interface DepartmentManagerPerson {
  eligibleForGrant: boolean;
  fullName: string;
  userId: string;
  username: string | null;
  assignments: DepartmentManagerAssignment[];
  assignmentPage: { hasNextPage: boolean; number: number };
}

export interface DepartmentManagerReceipt {
  action: "granted" | "withdrawn";
  createdAt: number;
  id: string;
  scopeId: string;
  scopeName: string;
  targetUserId: string;
}

export type DepartmentManagerChange =
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

export interface DepartmentManagerReconciliation {
  outcome: "committed" | "unknown";
  receipt: DepartmentManagerReceipt | null;
}

interface ErrorBody {
  error?: { code?: string; message?: string };
}

export class DepartmentManagerApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "DepartmentManagerApiError";
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
    throw new DepartmentManagerApiError(
      response.status,
      error?.error?.code ?? "service_error",
      error?.error?.message ?? "部門主管服務暫時無法回應。"
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

export const searchDepartmentManagerPeople = (
  query: string,
  page: number,
  signal?: AbortSignal
) => {
  const search = new URLSearchParams({ page: String(page), q: query });
  return get<DepartmentManagerSearchPage>(
    `/api/v2/roles/department-managers?${search.toString()}`,
    signal
  );
};

export const getDepartmentManagerDepartments = (
  page: number,
  signal?: AbortSignal
) =>
  get<DepartmentManagerDepartmentPage>(
    `/api/v2/roles/department-managers/departments?page=${page}`,
    signal
  );

export const getDepartmentManagerPerson = (
  targetUserId: string,
  assignmentPage: number,
  signal?: AbortSignal
) =>
  get<{ person: DepartmentManagerPerson }>(
    `/api/v2/roles/department-managers/${encodeURIComponent(targetUserId)}?assignmentPage=${assignmentPage}`,
    signal
  );

export const confirmDepartmentManagerPassword = (
  operationKey: string,
  password: string
) =>
  post<unknown>("/api/v2/account/password-confirmation", {
    operationKey,
    password,
  });

export const changeDepartmentManager = (input: DepartmentManagerChange) =>
  post<{ receipt: DepartmentManagerReceipt }>(
    "/api/v2/roles/department-managers",
    input
  );

export const reconcileDepartmentManagerChange = (operationKey: string) =>
  post<DepartmentManagerReconciliation>(
    "/api/v2/roles/department-managers/reconcile",
    { operationKey }
  );
