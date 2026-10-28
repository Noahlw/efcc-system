"use client";

import { useCallback, useEffect, useRef } from "react";

export type ManagedRole =
  | "department-manager"
  | "program-leader"
  | "global-role"
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
  actorUserId: string,
  authContextMarker: string | null
): SelfStepdownOperationReference | null => {
  const key = selfStepdownStorageKey(actorUserId);
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) {
      return null;
    }
    const value: unknown = JSON.parse(raw);
    if (
      !isSelfStepdownOperationReference(value) ||
      value.actorUserId !== actorUserId
    ) {
      sessionStorage.removeItem(key);
      return null;
    }
    if (value.authContextMarker !== authContextMarker) {
      // A later sign-in rotates the marker. Keep the opaque reference for
      // lifetime/account-switch fencing, but do not restore UNKNOWN into a
      // different authentication context.
      return null;
    }
    return value;
  } catch {
    try {
      sessionStorage.removeItem(key);
    } catch {
      // Storage may be unavailable in private browser contexts.
    }
    return null;
  }
};

export const storeSelfStepdownOperationReference = (
  currentActorUserId: string | null,
  operation: SelfStepdownOperationReference
): void => {
  if (currentActorUserId !== operation.actorUserId) {
    return;
  }
  try {
    sessionStorage.setItem(
      selfStepdownStorageKey(operation.actorUserId),
      JSON.stringify(operation)
    );
  } catch {
    // The in-memory reference still supports the current page's UNKNOWN state.
  }
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

export const readRoleOperationReference = (
  role: ManagedRole,
  actorUserId: string
): RoleOperationReference | null => {
  const key = operationStorageKey(role, actorUserId);
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) {
      return null;
    }
    const value: unknown = JSON.parse(raw);
    if (!isRoleOperationReference(value) || value.actorUserId !== actorUserId) {
      sessionStorage.removeItem(key);
      return null;
    }
    return value;
  } catch {
    try {
      sessionStorage.removeItem(key);
    } catch {
      // Storage may be unavailable in private browser contexts.
    }
    return null;
  }
};

export const storeRoleOperationReference = (
  role: ManagedRole,
  currentActorUserId: string | null,
  operation: RoleOperationReference
): void => {
  if (currentActorUserId !== operation.actorUserId) {
    return;
  }
  try {
    sessionStorage.setItem(
      operationStorageKey(role, operation.actorUserId),
      JSON.stringify(operation)
    );
  } catch {
    // The in-memory reference still supports recovery in this page.
  }
};

export const removeRoleOperationReference = (
  role: ManagedRole,
  currentActorUserId: string | null,
  operation: RoleOperationReference
): void => {
  if (currentActorUserId !== operation.actorUserId) {
    return;
  }
  try {
    const key = operationStorageKey(role, operation.actorUserId);
    const raw = sessionStorage.getItem(key);
    if (!raw) {
      return;
    }
    const stored: unknown = JSON.parse(raw);
    if (
      isRoleOperationReference(stored) &&
      stored.actorUserId === operation.actorUserId &&
      stored.operationKey === operation.operationKey
    ) {
      sessionStorage.removeItem(key);
    }
  } catch {
    // Storage may be unavailable in private browser contexts.
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
