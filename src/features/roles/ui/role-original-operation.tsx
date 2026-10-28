"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { readAuthContextMarker } from "@/features/auth/auth-context-marker";

import { reconcileDepartmentManagerChange } from "./department-manager-api";
import {
  reconcileGlobalRoleChange,
  reconcileRoleAssignerChange,
} from "./global-role-api";
import { reconcileProgramLeaderChange } from "./program-leader-api";
import {
  readRoleOperationReference,
  removeRoleOperationReference,
  scopedOperationRecoveryHref,
  useRoleCommandLifetime,
} from "./role-command-lifetime";
import type { RoleOperationReference } from "./role-command-lifetime";
import { searchRolePeople } from "./role-person-api";

const operationLabels = {
  "department-manager": "部門主管職務",
  "global-role": "帳戶身份",
  "program-leader": "聚會負責人職務",
  "program-leader-grant-batch": "聚會負責人批次",
  "role-assigner": "職務指派權",
  "scoped-role": "人士職務",
} as const;
type OriginalFamily = keyof typeof operationLabels;
interface OriginalOperation {
  family: OriginalFamily;
  reference: RoleOperationReference;
}

const focusedOriginalTaskHref = (
  family: OriginalFamily,
  actorKind: "admin" | "role_assigner"
) => {
  if (family === "scoped-role") {
    return scopedOperationRecoveryHref(family);
  }
  if (family === "program-leader-grant-batch") {
    return `${scopedOperationRecoveryHref(family)}&authority=${actorKind}`;
  }
  return null;
};

const isOwnAdminExit = (
  family: OriginalFamily,
  receipt: { targetUserId: string; role?: string },
  actor: string
) =>
  family === "global-role" &&
  receipt.targetUserId === actor &&
  receipt.role === "admin";

/** Read-only settlement of existing opaque references; never prepares or replays a command. */
export const RoleOriginalOperation = ({
  actor,
  actorKind,
  authorityAssignmentId,
}: {
  actor: string;
  actorKind: "admin" | "role_assigner";
  authorityAssignmentId: string | null;
}) => {
  const router = useRouter();
  const {
    beginRead,
    cancelRead,
    invalidate,
    isCurrent,
    releaseRead,
    verifyActor,
  } = useRoleCommandLifetime(actor);
  const marker = useRef<string | null>(null);
  const [operations, setOperations] = useState<OriginalOperation[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [visible, setVisible] = useState(true);

  const dispose = useCallback(() => {
    invalidate();
    setVisible(false);
    setOperations([]);
    setMessage(null);
    router.refresh();
  }, [invalidate, router]);

  const verify = useCallback(
    async (epoch: number) => {
      if (!isCurrent(epoch, actor)) {
        return false;
      }
      if (readAuthContextMarker() !== marker.current) {
        dispose();
        return false;
      }
      const current = await verifyActor(
        actor,
        epoch,
        async (signal) => {
          const result = await searchRolePeople("", 1, signal);
          return result.actorKind === actorKind &&
            result.authorityAssignmentId === authorityAssignmentId
            ? result.actorUserId
            : "";
        },
        dispose
      );
      if (!current || !isCurrent(epoch, actor)) {
        return false;
      }
      if (readAuthContextMarker() !== marker.current) {
        dispose();
        return false;
      }
      return true;
    },
    [actor, actorKind, authorityAssignmentId, dispose, isCurrent, verifyActor]
  );

  useEffect(() => {
    marker.current = readAuthContextMarker();
    const { controller, epoch } = beginRead();
    let active = true;
    const restore = async () => {
      try {
        const families: OriginalFamily[] =
          actorKind === "admin"
            ? [
                "department-manager",
                "program-leader",
                "global-role",
                "role-assigner",
                "scoped-role",
                "program-leader-grant-batch",
              ]
            : [
                "department-manager",
                "program-leader",
                "scoped-role",
                "program-leader-grant-batch",
              ];
        const saved = families.flatMap((family) => {
          const reference = readRoleOperationReference(family, actor);
          return reference ? [{ family, reference }] : [];
        });
        if (!saved.length || !(await verify(epoch)) || !active) {
          return;
        }
        if (active && isCurrent(epoch, actor)) {
          setOperations(saved);
        }
      } catch {
        if (active && isCurrent(epoch, actor)) {
          setMessage(
            "未能安全讀取原有操作。請重新載入；未有提交或取代任何操作。"
          );
        }
      } finally {
        releaseRead(controller);
      }
    };
    void restore();
    const checkMarker = () => {
      if (readAuthContextMarker() !== marker.current) {
        dispose();
      }
    };
    window.addEventListener("focus", checkMarker);
    const store = Reflect.get(window, "cookieStore") as EventTarget | undefined;
    store?.addEventListener("change", checkMarker);
    document.addEventListener("visibilitychange", checkMarker);
    return () => {
      active = false;
      cancelRead(controller, epoch);
      window.removeEventListener("focus", checkMarker);
      store?.removeEventListener("change", checkMarker);
      document.removeEventListener("visibilitychange", checkMarker);
    };
  }, [
    actor,
    actorKind,
    beginRead,
    cancelRead,
    dispose,
    isCurrent,
    releaseRead,
    verify,
  ]);

  const reconcile = async (original: OriginalOperation) => {
    if (busy) {
      return;
    }
    setBusy(true);
    const { controller, epoch } = beginRead();
    try {
      if (!(await verify(epoch))) {
        return;
      }
      const { family, reference } = original;
      const focusedHref = focusedOriginalTaskHref(family, actorKind);
      if (focusedHref) {
        router.push(focusedHref);
        return;
      }
      let result;
      switch (family) {
        case "department-manager": {
          result = await reconcileDepartmentManagerChange(
            reference.operationKey,
            actor,
            controller.signal
          );
          break;
        }
        case "program-leader": {
          result = await reconcileProgramLeaderChange(
            reference.operationKey,
            actor,
            undefined,
            controller.signal
          );
          break;
        }
        case "global-role": {
          result = await reconcileGlobalRoleChange(
            reference.operationKey,
            actor,
            controller.signal
          );
          break;
        }
        case "role-assigner": {
          result = await reconcileRoleAssignerChange(
            reference.operationKey,
            actor,
            controller.signal
          );
          break;
        }
        default: {
          throw new Error("未支援的原有操作種類。");
        }
      }
      if (!isCurrent(epoch, actor) || !(await verify(epoch))) {
        return;
      }
      if (result.outcome !== "committed" || !result.receipt) {
        setMessage(
          "原有操作結果仍未能確認。操作編號已保留，請勿重新提交相同工作。"
        );
        return;
      }
      // The generic key cannot settle Account's strict own-Admin exit owner.
      if (isOwnAdminExit(family, result.receipt, actor)) {
        setMessage(
          "自願退出管理員身份須在原有帳戶工作中查核；此處不會推定結果。"
        );
        return;
      }
      removeRoleOperationReference(family, actor, reference);
      if (readRoleOperationReference(family, actor)) {
        setMessage(
          "原有結果已確認，但查核記錄未能清除。請重新載入後再開始相同工作。"
        );
        return;
      }
      setOperations((current) => current.filter((entry) => entry !== original));
      setMessage("伺服器已確認原有操作完成，以下重新讀取該人士的目前狀態。");
      router.replace(
        `/roles/people?person=${encodeURIComponent(result.receipt.targetUserId)}`
      );
      router.refresh();
    } catch {
      if (isCurrent(epoch, actor)) {
        if (readAuthContextMarker() === marker.current) {
          try {
            if (!(await verify(epoch))) {
              return;
            }
          } catch {
            // Unavailable current authority is not permission to retain the
            // previous account's presentation or to replace its original key.
            dispose();
            return;
          }
          setMessage(
            "暫時未能在目前權限下查核。原有操作編號保留，請稍後再查核。"
          );
        } else {
          dispose();
        }
      }
    } finally {
      releaseRead(controller);
      setBusy(false);
    }
  };

  if (!visible) {
    return (
      <section aria-label="原有操作查核" className="mb-6 space-y-3">
        <p role="alert">
          目前登入或權限未能確認。原有操作仍然保留，請重新載入。
        </p>
        <Button
          onClick={() => window.location.reload()}
          type="button"
          variant="primary"
        >
          重新載入查核
        </Button>
      </section>
    );
  }
  if (!operations.length && !message) {
    return null;
  }
  return (
    <section aria-label="原有操作查核" className="mb-6 space-y-3">
      {message ? <p role="status">{message}</p> : null}
      {operations.map((original) => (
        <div
          className="flex flex-wrap items-center gap-3"
          key={original.family}
        >
          <p>{operationLabels[original.family]}：原有結果待確認</p>
          <Button
            disabled={busy}
            onClick={() => {
              void reconcile(original);
            }}
            type="button"
            variant="primary"
          >
            查核原有{operationLabels[original.family]}操作
          </Button>
        </div>
      ))}
    </section>
  );
};
