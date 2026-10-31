"use client";

import { useCallback, useEffect, useRef } from "react";

export type ManagedRole =
  | "department-manager"
  | "program-leader"
  | "program-leader-grant-batch"
  | "global-role"
  | "scoped-role"
  | "role-assigner";

export interface RoleOperationReference {
  actorUserId: string;
  operationKey: string;
}

export interface SelfStepdownOperationReference extends RoleOperationReference {
  authContextMarker: string;
}

const operationStorageKey = (role: ManagedRole, actorUserId: string) =>
  `efcc.${role}.operation.v1:${encodeURIComponent(actorUserId)}`;

const selfStepdownStorageKey = (actorUserId: string) =>
  `efcc.admin-stepdown.feedback.v1:${encodeURIComponent(actorUserId)}`;

const isRoleOperationReference = (
  value: unknown
): value is RoleOperationReference => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === 2 &&
    typeof record.actorUserId === "string" &&
    typeof record.operationKey === "string" &&
    /^[0-9a-f-]{36}$/iu.test(record.operationKey)
  );
};

const isSelfStepdownOperationReference = (
  value: unknown
): value is SelfStepdownOperationReference => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === 3 &&
    typeof record.actorUserId === "string" &&
    typeof record.authContextMarker === "string" &&
    /^[0-9a-f-]{36}$/iu.test(record.authContextMarker) &&
    typeof record.operationKey === "string" &&
    /^[0-9a-f-]{36}$/iu.test(record.operationKey)
  );
};

export const readSelfStepdownOperationReference = (
  actorUserId: string
): SelfStepdownOperationReference | null => {
  const key = selfStepdownStorageKey(actorUserId);
  // An unreadable store is not proof of absence. Let the focused task fail
  // closed without deleting a potentially live original operation.
  const raw = sessionStorage.getItem(key);
  if (raw === null) {
    return null;
  }
  const value: unknown = JSON.parse(raw);
  if (
    !isSelfStepdownOperationReference(value) ||
    value.actorUserId !== actorUserId
  ) {
    throw new Error("Unreadable original Admin exit operation reference");
  }
  // Fresh authentication or a later Admin grant cannot settle this original
  // exit. Retain its opaque marker and block replacement exits for this actor.
  return value;
};

export const storeSelfStepdownOperationReference = (
  currentActorUserId: string | null,
  operation: SelfStepdownOperationReference
): boolean => {
  if (
    currentActorUserId !== operation.actorUserId ||
    !isSelfStepdownOperationReference(operation)
  ) {
    return false;
  }
  const key = selfStepdownStorageKey(operation.actorUserId);
  const serialized = JSON.stringify(operation);
  let attemptedWrite = false;
  try {
    const previous = sessionStorage.getItem(key);
    if (previous !== null) {
      // Any stored original operation fences a new exit dispatch.
      return false;
    }
    attemptedWrite = true;
    sessionStorage.setItem(key, serialized);
    if (sessionStorage.getItem(key) === serialized) {
      return true;
    }
  } catch {
    // Without a verified round trip the caller must not dispatch.
  }
  if (attemptedWrite) {
    try {
      sessionStorage.removeItem(key);
    } catch {
      // Storage failure still cannot authorize dispatch or imply a commit.
    }
  }
  return false;
};

export const removeSelfStepdownOperationReference = (
  currentActorUserId: string | null,
  operation: SelfStepdownOperationReference
): void => {
  if (currentActorUserId !== operation.actorUserId) {
    return;
  }
  try {
    const key = selfStepdownStorageKey(operation.actorUserId);
    const raw = sessionStorage.getItem(key);
    if (!raw) {
      return;
    }
    const stored: unknown = JSON.parse(raw);
    if (
      isSelfStepdownOperationReference(stored) &&
      stored.actorUserId === operation.actorUserId &&
      stored.operationKey === operation.operationKey &&
      stored.authContextMarker === operation.authContextMarker
    ) {
      sessionStorage.removeItem(key);
    }
  } catch {
    // Storage may be unavailable in private browser contexts.
  }
};

/** Only a successful absent read means no pending command; failures preserve storage and propagate. */
export const readRoleOperationReference = (
  role: ManagedRole,
  actorUserId: string
): RoleOperationReference | null => {
  const key = operationStorageKey(role, actorUserId);
  const raw = sessionStorage.getItem(key);
  if (raw === null) {
    return null;
  }
  const value: unknown = JSON.parse(raw);
  if (!isRoleOperationReference(value) || value.actorUserId !== actorUserId) {
    throw new Error("操作查核記錄無法讀取；請勿開始另一項操作。");
  }
  return value;
};

const scopedOperationFamilies = [
  "department-manager",
  "program-leader",
  "program-leader-grant-batch",
  "scoped-role",
] as const;
type ScopedOperationFamily = (typeof scopedOperationFamilies)[number];

/** Different scoped command shapes cannot replace an unresolved original intent. */
export const readConflictingScopedOperationReference = (
  ownFamily: ManagedRole,
  actorUserId: string
): {
  family: ScopedOperationFamily;
  reference: RoleOperationReference;
} | null => {
  if (!scopedOperationFamilies.some((family) => family === ownFamily)) {
    return null;
  }
  for (const family of scopedOperationFamilies) {
    if (family === ownFamily) {
      continue;
    }
    const reference = readRoleOperationReference(family, actorUserId);
    if (reference) {
      return { family, reference };
    }
  }
  return null;
};

export const scopedOperationRecoveryHref = (family: ScopedOperationFamily) => {
  if (family === "program-leader-grant-batch") {
    return "/roles/program-leaders?picker=grant";
  }
  return family === "scoped-role" ? "/roles/people/duties" : "/roles/people";
};

/** A command may dispatch only after its exact actor/key survives a storage round trip. */
export const storeRoleOperationReference = (
  role: ManagedRole,
  currentActorUserId: string | null,
  operation: RoleOperationReference
): boolean => {
  if (currentActorUserId !== operation.actorUserId) {
    return false;
  }
  let freshlyWritten = false;
  try {
    if (readConflictingScopedOperationReference(role, operation.actorUserId)) {
      return false;
    }
    const existing = readRoleOperationReference(role, operation.actorUserId);
    if (existing) {
      return existing.operationKey === operation.operationKey;
    }
    sessionStorage.setItem(
      operationStorageKey(role, operation.actorUserId),
      JSON.stringify(operation)
    );
    freshlyWritten = true;
    const stored = readRoleOperationReference(role, operation.actorUserId);
    if (stored?.operationKey === operation.operationKey) {
      return true;
    }
  } catch {
    // A failed initial read never establishes ownership of an existing record.
  }
  if (freshlyWritten) {
    try {
      // Only this synchronous call's successfully written, never-dispatched
      // preparation may be removed after failed verification.
      sessionStorage.removeItem(
        operationStorageKey(role, operation.actorUserId)
      );
    } catch {
      // Preserve the opaque fence if cleanup is unavailable; never claim absence.
    }
  }
  return false;
};

export const removeRoleOperationReference = (
  role: ManagedRole,
  currentActorUserId: string | null,
  operation: RoleOperationReference
): boolean => {
  if (currentActorUserId !== operation.actorUserId) {
    return false;
  }
  try {
    const key = operationStorageKey(role, operation.actorUserId);
    const raw = sessionStorage.getItem(key);
    if (raw === null) {
      return true;
    }
    const stored: unknown = JSON.parse(raw);
    if (
      isRoleOperationReference(stored) &&
      stored.actorUserId === operation.actorUserId &&
      stored.operationKey === operation.operationKey
    ) {
      sessionStorage.removeItem(key);
      return sessionStorage.getItem(key) === null;
    }
    return false;
  } catch {
    return false;
  }
};

export const useRoleCommandLifetime = (initialActorUserId: string) => {
  const actorUserId = useRef<string | null>(initialActorUserId);
  const requestEpoch = useRef(0);
  const activeReadRequest = useRef<AbortController | null>(null);
  const actorProbe = useRef<AbortController | null>(null);

  const beginRead = useCallback(() => {
    activeReadRequest.current?.abort();
    const controller = new AbortController();
    activeReadRequest.current = controller;
    requestEpoch.current += 1;
    return { controller, epoch: requestEpoch.current };
  }, []);

  const releaseRead = useCallback((controller: AbortController) => {
    if (activeReadRequest.current === controller) {
      activeReadRequest.current = null;
    }
  }, []);

  const cancelRead = useCallback(
    (controller: AbortController, epoch: number) => {
      controller.abort();
      releaseRead(controller);
      if (requestEpoch.current === epoch) {
        requestEpoch.current += 1;
      }
    },
    [releaseRead]
  );

  const beginOperation = useCallback(() => {
    // A dispatched write may still commit after this page loses its actor.
    activeReadRequest.current?.abort();
    activeReadRequest.current = null;
    requestEpoch.current += 1;
    return requestEpoch.current;
  }, []);

  const isCurrent = useCallback(
    (epoch: number, expectedActor: string) =>
      requestEpoch.current === epoch && actorUserId.current === expectedActor,
    []
  );

  const verifyActor = useCallback(
    async (
      expectedActor: string,
      epoch: number,
      readActor: (signal: AbortSignal) => Promise<string>,
      onChanged: () => void
    ): Promise<boolean> => {
      if (!isCurrent(epoch, expectedActor)) {
        return false;
      }
      actorProbe.current?.abort();
      const controller = new AbortController();
      actorProbe.current = controller;
      try {
        const currentActor = await readActor(controller.signal);
        if (!isCurrent(epoch, expectedActor)) {
          return false;
        }
        if (currentActor !== expectedActor) {
          onChanged();
          return false;
        }
        return true;
      } finally {
        if (actorProbe.current === controller) {
          actorProbe.current = null;
        }
      }
    },
    [isCurrent]
  );

  const invalidate = useCallback(() => {
    requestEpoch.current += 1;
    activeReadRequest.current?.abort();
    activeReadRequest.current = null;
    actorProbe.current?.abort();
    actorProbe.current = null;
    actorUserId.current = null;
  }, []);

  useEffect(
    () => () => {
      requestEpoch.current += 1;
      activeReadRequest.current?.abort();
      actorProbe.current?.abort();
    },
    []
  );

  return {
    actorUserId,
    beginOperation,
    beginRead,
    cancelRead,
    invalidate,
    isCurrent,
    releaseRead,
    requestEpoch,
    verifyActor,
  };
};
