"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import * as z from "zod";

import { useAppForm } from "@/components/ui/app-form";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { UnsavedChangesLink } from "@/components/unsaved-changes-link";
import { AccountSecurityForm } from "@/features/account/security/security-form";
import { readAuthContextMarker } from "@/features/auth/auth-context-marker";

import { roleAssignerChangeSchema } from "../role-assigner-contract";
import type {
  RoleAssignerChangeInput,
  RoleAssignerReceipt,
} from "../role-assigner-contract";
import {
  changeRoleAssigner,
  reconcileRoleAssignerChange,
  searchGlobalRolePeople,
  GlobalRoleApiError,
} from "./global-role-api";
import type { GlobalRolePerson } from "./global-role-api";
import {
  readRoleOperationReference,
  storeRoleOperationReference,
  removeRoleOperationReference,
  useRoleCommandLifetime,
} from "./role-command-lifetime";
import type { RoleOperationReference } from "./role-command-lifetime";
import { getRolePersonDetail, RolePersonApiError } from "./role-person-api";
import { RoleTaskFrame } from "./role-task-frame";

const choices = z.object({ delegation: z.enum(["granted", "withdrawn"]) });
type Flow =
  | "pending"
  | "ready"
  | "unknown"
  | "denied"
  | "unavailable"
  | "conflict"
  | "storage";
const matches = (
  receipt: RoleAssignerReceipt,
  input: RoleAssignerChangeInput
) =>
  receipt.role === "role_assigner" &&
  receipt.action === input.action &&
  receipt.targetUserId === input.targetUserId;
const authorityError = (error: unknown) =>
  (error instanceof RolePersonApiError &&
    [401, 403, 404, 409].includes(error.status)) ||
  (error instanceof GlobalRoleApiError &&
    (error.status === 401 ||
      error.code === "actor_changed" ||
      (error.status === 403 &&
        error.code !== "password_confirmation_required")));

export const RoleAssignerTask = ({
  actorUserId: actor,
  initialPerson,
  navigation,
  targetUserId,
  returnHref,
}: {
  actorUserId: string;
  initialPerson: GlobalRolePerson | null;
  targetUserId: string;
  navigation: ReactNode;
  returnHref: string;
}) => {
  const router = useRouter();
  const lifetime = useRoleCommandLifetime(actor);
  const {
    beginRead,
    cancelRead,
    releaseRead,
    isCurrent,
    invalidate,
    verifyActor,
    beginOperation,
    requestEpoch,
  } = lifetime;
  const [person, setPerson] = useState<GlobalRolePerson | null>(initialPerson);
  const [flow, setFlow] = useState<Flow>("pending");
  const [message, setMessage] = useState("正在確認目前權限…");
  const [proof, setProof] = useState(false);
  const busy = useRef(false);
  const marker = useRef<string | null>(null);
  const operation = useRef<RoleOperationReference | null>(null);
  const preparedOperation = useRef<RoleOperationReference | null>(null);
  const intent = useRef<RoleAssignerChangeInput | null>(null);
  const staleWitness = useRef(false);
  const feedback = useRef<HTMLParagraphElement>(null);
  const reviewedAssignmentId =
    initialPerson?.roleAssignerAssignment?.assignmentId;
  const baseline = initialPerson?.roleAssignerAssignment
    ? "granted"
    : "withdrawn";
  const discardPreparedOperation = useCallback(() => {
    const prepared = preparedOperation.current;
    if (prepared) {
      removeRoleOperationReference("role-assigner", actor, prepared);
      preparedOperation.current = null;
    }
  }, [actor]);

  const dispose = useCallback(() => {
    discardPreparedOperation();
    invalidate();
    setPerson(null);
    setProof(false);
    setFlow("denied");
    setMessage("登入帳戶或管理權限已改變，人士資料及未提交更改已清除。");
    router.replace("/roles/people");
  }, [discardPreparedOperation, invalidate, router]);
  const handleReadFailure = useCallback(
    (error: unknown) => {
      if (authorityError(error) || readAuthContextMarker() !== marker.current) {
        dispose();
        return;
      }
      if (staleWitness.current) {
        return;
      }
      setFlow(operation.current ? "unknown" : "unavailable");
      setMessage(
        "暫時未能讀取最新狀態。未提交的選擇已保留，請重新讀取後再儲存。"
      );
    },
    [dispose]
  );
  const authorize = useCallback(
    async (epoch: number, signal?: AbortSignal) => {
      const result = await getRolePersonDetail(targetUserId, 1, signal);
      if (!isCurrent(epoch, actor)) {
        return null;
      }
      if (
        readAuthContextMarker() !== marker.current ||
        result.person.actorUserId !== actor ||
        !result.person.capabilities.canManageRoleAssigner ||
        result.person.global?.role !== "staff"
      ) {
        dispose();
        return null;
      }
      if (!operation.current) {
        const { global, identity } = result.person;
        if (global?.role === "staff") {
          setPerson({
            eligibleForAdmin: global.eligibleForAdmin,
            eligibleForRoleAssigner: global.eligibleForRoleAssigner,
            eligibleForStaff: global.eligibleForStaff,
            fullName: identity.fullName,
            role: global.role,
            roleAssignerAssignment: global.roleAssignerAssignment,
            userId: identity.userId,
            username: identity.username,
          });
        }
      }
      return result.person;
    },
    [actor, dispose, targetUserId, isCurrent]
  );
  const verifyAuthority = useCallback(
    async (epoch: number) => {
      const valid = await verifyActor(
        actor,
        epoch,
        async (signal) => {
          const current = await searchGlobalRolePeople("", 1, signal);
          return current.actorUserId;
        },
        dispose
      );
      if (!valid) {
        return false;
      }
      if (readAuthContextMarker() !== marker.current) {
        dispose();
        return false;
      }
      return true;
    },
    [actor, dispose, verifyActor]
  );
  useEffect(() => {
    marker.current = readAuthContextMarker();
    try {
      operation.current = readRoleOperationReference("role-assigner", actor);
    } catch {
      setPerson(null);
      setFlow("storage");
      setMessage(
        "無法安全讀取操作查核記錄，未有提交新的操作。請重新載入後再試。"
      );
      return;
    }
    if (operation.current) {
      setPerson(null);
    }
    const request = beginRead();
    let active = true;
    busy.current = true;
    void (async () => {
      try {
        const saved = operation.current;
        const authorized = saved
          ? await verifyAuthority(request.epoch)
          : await authorize(request.epoch, request.controller.signal);
        if (!authorized || !active) {
          return;
        }
        setFlow(saved ? "unknown" : "ready");
        setMessage(saved ? "先查核原有操作；未確認前不能另行儲存。" : "");
      } catch (error) {
        if (
          active &&
          !request.controller.signal.aborted &&
          isCurrent(request.epoch, actor)
        ) {
          handleReadFailure(error);
        }
      } finally {
        releaseRead(request.controller);
        if (active) {
          busy.current = false;
        }
      }
    })();
    const recheckBusyActor = async () => {
      const epoch = requestEpoch.current;
      try {
        await verifyAuthority(epoch);
      } catch (error) {
        if (!isCurrent(epoch, actor)) {
          return;
        }
        setPerson(null);
        setProof(false);
        handleReadFailure(error);
      }
    };
    const recheck = async () => {
      // A dispatched command must not suspend shared-browser privacy fencing.
      if (readAuthContextMarker() !== marker.current) {
        dispose();
        return;
      }
      if (document.visibilityState === "hidden") {
        return;
      }
      if (busy.current) {
        await recheckBusyActor();
        return;
      }
      const read = beginRead();
      try {
        await (operation.current
          ? verifyAuthority(read.epoch)
          : authorize(read.epoch, read.controller.signal));
      } catch (error) {
        if (!read.controller.signal.aborted && isCurrent(read.epoch, actor)) {
          handleReadFailure(error);
        }
      } finally {
        releaseRead(read.controller);
      }
    };
    const store = Reflect.get(window, "cookieStore") as EventTarget | undefined;
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    store?.addEventListener("change", recheck);
    return () => {
      active = false;
      cancelRead(request.controller, request.epoch);
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
      store?.removeEventListener("change", recheck);
    };
  }, [
    actor,
    authorize,
    beginRead,
    cancelRead,
    requestEpoch,
    dispose,
    handleReadFailure,
    isCurrent,
    releaseRead,
    verifyAuthority,
  ]);
  useEffect(() => {
    if (message && flow === "ready" && !proof) {
      feedback.current?.focus();
    }
  }, [message, flow, proof]);
  const finish = (reference: RoleOperationReference, destination: string) => {
    removeRoleOperationReference("role-assigner", actor, reference);
    operation.current = null;
    setPerson(null);
    setProof(false);
    window.location.assign(destination);
  };
  const freezeChangedAssignment = () => {
    staleWitness.current = true;
    setProof(false);
    setFlow("conflict");
    setMessage(
      "委派已更新；原有選擇只供參考。請重新載入最新委派，再重新選擇。"
    );
  };
  const restoreUnsent = async (
    error: GlobalRoleApiError,
    epoch: number,
    reference: RoleOperationReference
  ) => {
    const attemptedGrant = intent.current?.action === "granted";
    removeRoleOperationReference("role-assigner", actor, reference);
    operation.current = null;
    intent.current = null;
    try {
      const current = await authorize(epoch);
      if (!current) {
        return;
      }
      if (
        current.global?.roleAssignerAssignment?.assignmentId !==
        reviewedAssignmentId
      ) {
        freezeChangedAssignment();
        return;
      }
      setFlow("ready");
      if (attemptedGrant && !current.global?.eligibleForRoleAssigner) {
        setProof(false);
        setMessage("目前委派或資格已改變，未有儲存。請返回人員權責重新查閱。");
        return;
      }
      const needsProof = error.code === "password_confirmation_required";
      setProof(needsProof);
      setMessage(
        needsProof ? "請先確認目前密碼，再按一次儲存。" : error.message
      );
    } catch (readError) {
      handleReadFailure(readError);
    }
  };
  const releaseFreshActorMismatch = (
    error: unknown,
    reference: RoleOperationReference | null
  ) => {
    // Only a fresh dispatch's explicit pre-effect actor mismatch releases its key.
    if (
      error instanceof GlobalRoleApiError &&
      error.status === 409 &&
      error.code === "actor_changed" &&
      reference &&
      intent.current &&
      operation.current?.operationKey === reference.operationKey
    ) {
      removeRoleOperationReference("role-assigner", actor, reference);
      operation.current = null;
      intent.current = null;
    }
  };
  const retainAmbiguousOperation = async (epoch: number) => {
    // An error response is not an actor check. Hide protected presentation before
    // probing; a probe outage may retain only the original opaque operation.
    setPerson(null);
    setProof(false);
    if (readAuthContextMarker() !== marker.current) {
      dispose();
      return;
    }
    try {
      if (!(await verifyAuthority(epoch))) {
        return;
      }
      setFlow("unknown");
      setMessage("未能確認是否已儲存。請查核原有操作，切勿另行提交。");
    } catch (error) {
      if (!isCurrent(epoch, actor)) {
        return;
      }
      if (authorityError(error) || readAuthContextMarker() !== marker.current) {
        dispose();
        return;
      }
      setFlow("unknown");
      setMessage(
        "暫時無法確認目前權限；只保留原有操作供稍後查核，不能另行儲存。"
      );
    }
  };
  const handleFailure = async (
    error: unknown,
    epoch: number,
    reference: RoleOperationReference | null
  ) => {
    releaseFreshActorMismatch(error, reference);
    if (!isCurrent(epoch, actor)) {
      return;
    }
    if (authorityError(error)) {
      dispose();
      if (error instanceof GlobalRoleApiError && error.status === 401) {
        router.replace("/sign-in");
      }
      return;
    }
    if (!reference) {
      handleReadFailure(error);
      return;
    }
    if (
      error instanceof GlobalRoleApiError &&
      (error.status === 400 ||
        error.code === "conflict" ||
        error.code === "password_confirmation_required")
    ) {
      await restoreUnsent(error, epoch, reference);
      return;
    }
    await retainAmbiguousOperation(epoch);
  };
  const retainPreparedOperation = (reference: RoleOperationReference) => {
    preparedOperation.current = reference;
    let saved: RoleOperationReference | null | undefined;
    try {
      saved = readRoleOperationReference("role-assigner", actor);
    } catch {
      // This fresh reference has not dispatched. Retry must verify its same key.
      saved = undefined;
    }
    if (saved && saved.operationKey !== reference.operationKey) {
      preparedOperation.current = null;
      operation.current = saved;
      intent.current = null;
      setPerson(null);
      setFlow("unknown");
      setMessage("已有原有操作需要查核；未有提交這次選擇。");
      return;
    }
    setFlow("ready");
    setMessage(
      "無法安全保留操作查核記錄，未有提交。原有選擇及操作編號已保留，請重試儲存。"
    );
  };

  const save = async (delegation: "granted" | "withdrawn") => {
    if (
      busy.current ||
      flow !== "ready" ||
      proof ||
      !person ||
      delegation === baseline
    ) {
      return;
    }
    busy.current = true;
    const epoch = beginOperation();
    setFlow("pending");
    setMessage("正在儲存…");
    let reference: RoleOperationReference | null = null;
    try {
      const current = await authorize(epoch);
      if (!current?.global) {
        return;
      }
      // The reviewed withdrawal witness is never rebound to a replacement grant.
      if (
        current.global.roleAssignerAssignment?.assignmentId !==
        reviewedAssignmentId
      ) {
        freezeChangedAssignment();
        return;
      }
      if (delegation === "granted" && !current.global.eligibleForRoleAssigner) {
        setFlow("ready");
        setMessage("目前委派或資格已改變，未有儲存。請返回人員權責重新查閱。");
        return;
      }
      reference = preparedOperation.current ?? {
        actorUserId: actor,
        operationKey: crypto.randomUUID(),
      };
      const input = roleAssignerChangeSchema.parse(
        delegation === "granted"
          ? {
              action: "granted",
              operationKey: reference.operationKey,
              targetUserId: person.userId,
            }
          : {
              action: "withdrawn",
              expectedAssignmentId: reviewedAssignmentId,
              operationKey: reference.operationKey,
              targetUserId: person.userId,
            }
      );
      if (!storeRoleOperationReference("role-assigner", actor, reference)) {
        retainPreparedOperation(reference);
        return;
      }
      preparedOperation.current = null;
      operation.current = reference;
      intent.current = input;
      const result = await changeRoleAssigner(input, actor);
      if (!(await verifyAuthority(epoch))) {
        return;
      }
      if (!matches(result.receipt, input)) {
        throw new Error("Unverified outcome");
      }
      finish(reference, returnHref);
    } catch (error) {
      await handleFailure(error, epoch, reference);
    } finally {
      busy.current = false;
    }
  };
  const reconcile = async () => {
    const reference = operation.current;
    if (!reference || busy.current || flow !== "unknown") {
      return;
    }
    busy.current = true;
    const epoch = beginOperation();
    setFlow("pending");
    try {
      if (!(await verifyAuthority(epoch))) {
        return;
      }
      const result = await reconcileRoleAssignerChange(
        reference.operationKey,
        actor
      );
      if (!(await verifyAuthority(epoch))) {
        return;
      }
      if (
        result.outcome !== "committed" ||
        !result.receipt ||
        (intent.current && !matches(result.receipt, intent.current))
      ) {
        setFlow("unknown");
        setMessage("仍未能確認原有操作，請稍後再查核。");
        return;
      }
      finish(
        reference,
        intent.current
          ? returnHref
          : `/roles/people?person=${encodeURIComponent(result.receipt.targetUserId)}`
      );
    } catch (error) {
      if (!isCurrent(epoch, actor)) {
        return;
      }
      if (authorityError(error)) {
        dispose();
      } else {
        setFlow("unknown");
        setMessage("暫時無法查核；原有操作仍然保留。");
      }
    } finally {
      busy.current = false;
    }
  };
  const retryRead = async () => {
    if (busy.current) {
      return;
    }
    busy.current = true;
    const request = beginRead();
    setFlow("pending");
    try {
      const authorized = operation.current
        ? await verifyAuthority(request.epoch)
        : await authorize(request.epoch, request.controller.signal);
      if (!authorized) {
        return;
      }
      setFlow(operation.current ? "unknown" : "ready");
      setMessage(
        operation.current ? "先查核原有操作；未確認前不能另行儲存。" : ""
      );
    } catch (error) {
      if (
        !request.controller.signal.aborted &&
        isCurrent(request.epoch, actor)
      ) {
        handleReadFailure(error);
      }
    } finally {
      releaseRead(request.controller);
      busy.current = false;
    }
  };
  const form = useAppForm({
    defaultValues: choices.parse({ delegation: baseline }),
    onSubmit: ({ value }) => save(choices.parse(value).delegation),
    validators: { onSubmit: choices },
  });
  const editable = flow === "ready" && !proof;
  const actionStatus: Record<Flow, string> = {
    conflict: "原有選擇只供參考",
    denied: "",
    pending: "正在處理…",
    ready: "1 項未提交更改",
    storage: "無法安全讀取操作查核記錄",
    unavailable: "最新狀態暫時無法讀取",
    unknown: "結果待確認",
  };
  const renderActions = (
    delegation: "granted" | "withdrawn",
    dirty: boolean
  ) => {
    if (!dirty && flow !== "unknown" && !operation.current) {
      return null;
    }
    return (
      <>
        <p className="text-meta mr-auto" role="status">
          {actionStatus[flow]}
        </p>
        {flow === "unknown" ? (
          <Button onClick={reconcile} type="button" variant="primary">
            查核原有操作
          </Button>
        ) : (
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={!editable}
              onClick={() => {
                discardPreparedOperation();
                form.reset();
                setMessage("");
              }}
            >
              重設
            </Button>
            <Button
              type="submit"
              form="role-assigner-form"
              variant="primary"
              disabled={
                !editable ||
                (delegation === "granted" && !person?.eligibleForRoleAssigner)
              }
            >
              儲存
            </Button>
          </>
        )}
      </>
    );
  };
  return (
    <form.Subscribe selector={(state) => state.values.delegation}>
      {(delegation) => {
        const dirty = !!person && delegation !== baseline;
        return (
          <RoleTaskFrame
            title="管理職務指派權"
            navigation={navigation}
            returnControl={
              <UnsavedChangesLink
                variant="quiet"
                className="size-11 shrink-0 focus-visible:outline-2"
                href={returnHref}
                description="未提交的委派選擇將會清除。"
                isDirty={dirty && flow === "ready"}
                onDiscard={() => {
                  if (busy.current) {
                    return false;
                  }
                  discardPreparedOperation();
                  form.reset();
                }}
              >
                <Icon name="arrow-left" className="size-5" />
                <span className="sr-only">返回人員權責</span>
              </UnsavedChangesLink>
            }
            actions={renderActions(delegation, dirty)}
          >
            {person ? (
              <>
                <h2 className="text-section wrap-anywhere">
                  {person.fullName}
                </h2>
                <p className="text-muted-foreground mt-1 wrap-anywhere">
                  {person.username ?? "未有 Username"}
                </p>
                <p className="text-meta text-muted-foreground mt-4">
                  目前身份：職員。委派只供合資格職員使用，與帳戶身份分開儲存。
                </p>
                <form
                  id="role-assigner-form"
                  className="mt-6 space-y-6"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void form.handleSubmit();
                  }}
                >
                  <form.AppField name="delegation">
                    {(field) => (
                      <field.RadioCardField
                        id="role-assigner"
                        label="職務指派權"
                        disabled={!editable}
                        options={[
                          {
                            description:
                              "不具職務指派權；獨立部門及聚會職務保留。",
                            label: "未委派",
                            value: "withdrawn",
                          },
                          {
                            description:
                              "可為合資格會友管理部門主管及聚會負責人，不包括職員或管理員身份。",
                            disabled:
                              !person.roleAssignerAssignment &&
                              !person.eligibleForRoleAssigner,
                            label: "委派職務指派權",
                            value: "granted",
                          },
                        ]}
                      />
                    )}
                  </form.AppField>
                  {dirty ? (
                    <p className="text-meta" role="status">
                      {flow === "conflict" ? "原有選擇：" : ""}
                      {delegation === "granted"
                        ? "將新增職務指派權"
                        : "將撤回職務指派權"}
                    </p>
                  ) : null}
                </form>
                {proof ? (
                  <AccountSecurityForm
                    actorUserId={actor}
                    confirmationExpiresAt={null}
                    temporaryPasswordExpiresAt={null}
                    temporaryPasswordExpired={false}
                    task="confirm"
                    confirmationOnly
                    confirmationContext={[
                      {
                        label: "對象",
                        value: `${person.fullName} · ${person.username ?? ""}`,
                      },
                      {
                        label: "職務指派權",
                        value: delegation === "granted" ? "委派" : "撤回",
                      },
                    ]}
                    onConfirmationClose={() => setProof(false)}
                    onConfirmedInWork={() => {
                      setProof(false);
                      setMessage("密碼已確認，請再按一次儲存。");
                    }}
                  />
                ) : null}
              </>
            ) : null}
            {message ? (
              <p
                ref={feedback}
                tabIndex={-1}
                role={
                  flow === "ready" || flow === "denied" ? "alert" : "status"
                }
                className="mt-6 wrap-anywhere focus-visible:outline-2"
              >
                {message}
              </p>
            ) : null}
            {flow === "unavailable" ? (
              <Button
                type="button"
                variant="primary"
                className="mt-4"
                onClick={retryRead}
              >
                重新讀取最新狀態
              </Button>
            ) : null}
            {flow === "conflict" ? (
              <Button
                type="button"
                variant="primary"
                className="mt-4"
                onClick={() => window.location.reload()}
              >
                重新載入最新委派
              </Button>
            ) : null}
            {flow === "storage" ? (
              <Button
                className="mt-4"
                onClick={() => window.location.reload()}
                type="button"
                variant="primary"
              >
                重新載入查核記錄
              </Button>
            ) : null}
          </RoleTaskFrame>
        );
      }}
    </form.Subscribe>
  );
};
