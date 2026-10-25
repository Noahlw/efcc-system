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
  eligibleForRoleAssigner: boolean;
  eligibleForStaff: boolean;
  fullName: string;
  role: "member" | "staff";
  roleAssignerAssignment: { assignmentId: string; createdAt: number } | null;
  userId: string;
  username: string | null;
}

export interface GlobalRoleReceipt {
  action: "granted" | "withdrawn";
  createdAt: number;
  id: string;
  resultingGlobalRole: "member" | "staff";
  role: "staff";
  targetUserId: string;
}

export interface RoleAssignerReceipt {
  action: "granted" | "withdrawn";
  createdAt: number;
  id: string;
  role: "role_assigner";
  targetUserId: string;
}

export interface GlobalRoleChange {
  action: "granted" | "withdrawn";
  operationKey: string;
  role: "staff";
  targetUserId: string;
}

export type RoleAssignerChange =
  | {
      action: "granted";
      operationKey: string;
      targetUserId: string;
    }
  | {
      action: "withdrawn";
      expectedAssignmentId: string;
      operationKey: string;
      targetUserId: string;
    };

export interface GlobalRoleReconciliation {
  outcome: "committed" | "unknown";
  receipt: GlobalRoleReceipt | null;
}

export interface RoleAssignerReconciliation {
  outcome: "committed" | "unknown";
  receipt: RoleAssignerReceipt | null;
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

export const getGlobalRolePerson = (
  targetUserId: string,
  signal?: AbortSignal
) =>
  get<{ person: GlobalRolePerson }>(
    `/api/v2/roles/global-roles/${encodeURIComponent(targetUserId)}`,
    signal
  );

export const confirmGlobalRolePassword = (
  operationKey: string,
  password: string
) =>
  post<unknown>("/api/v2/account/password-confirmation", {
    operationKey,
    password,
  });

export const changeGlobalRole = (input: GlobalRoleChange) =>
  post<{ receipt: GlobalRoleReceipt }>("/api/v2/roles/global-roles", input);

export const reconcileGlobalRoleChange = (operationKey: string) =>
  post<GlobalRoleReconciliation>("/api/v2/roles/global-roles/reconcile", {
    operationKey,
  });

export const changeRoleAssigner = (input: RoleAssignerChange) =>
  post<{ receipt: RoleAssignerReceipt }>("/api/v2/roles/role-assigners", input);

export const reconcileRoleAssignerChange = (operationKey: string) =>
  post<RoleAssignerReconciliation>("/api/v2/roles/role-assigners/reconcile", {
    operationKey,
  });
