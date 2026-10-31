"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import * as z from "zod";

import { useAppForm } from "@/components/ui/app-form";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { TaskDepartureLink } from "@/components/unsaved-changes-link";
import { AccountSecurityForm } from "@/features/account/security/security-form";
import { readAuthContextMarker } from "@/features/auth/auth-context-marker";

import { globalRoleChangeSchema } from "../global-role-contract";
import type { GlobalRoleReceipt } from "../global-role-contract";
import {
  changeGlobalRole,
  GlobalRoleApiError,
  reconcileGlobalRoleChange,
  searchGlobalRolePeople,
} from "./global-role-api";
import type { GlobalRolePerson } from "./global-role-api";
import {
  readRoleOperationReference,
  removeRoleOperationReference,
  storeRoleOperationReference,
  useRoleCommandLifetime,
} from "./role-command-lifetime";
import type { RoleOperationReference } from "./role-command-lifetime";
import { getRolePersonDetail, RolePersonApiError } from "./role-person-api";
import { RoleTaskFrame } from "./role-task-frame";

const choiceSchema = z.object({ role: z.enum(["member", "staff", "admin"]) });
type IdentityChoice = z.infer<typeof choiceSchema>;
const identityChangeLabels = {
  admin: "設為管理員",
  member: "設為會友",
  staff: "設為職員",
} as const;
type Flow =
  | "cleanup"
  | "ready"
  | "pending"
  | "unknown"
  | "unavailable"
  | "denied"
  | "storage";
const unavailableStaffMessage =
  "此帳戶目前不符合新增職員身份的條件，未有儲存。請重設或選擇會友。";
interface IdentityIntent {
  action: "granted" | "withdrawn";
  resultingGlobalRole: "member" | "staff" | "admin";
  targetUserId: string;
}

const matchesIntent = (receipt: GlobalRoleReceipt, intent: IdentityIntent) =>
  receipt.role ===
    (intent.resultingGlobalRole === "admin" ? "admin" : "staff") &&
  receipt.action === intent.action &&
  receipt.targetUserId === intent.targetUserId &&
  receipt.resultingGlobalRole === intent.resultingGlobalRole;

const isAuthorityError = (error: unknown) =>
  (error instanceof RolePersonApiError &&
    [401, 403, 404, 409].includes(error.status)) ||
  (error instanceof GlobalRoleApiError &&
    (error.status === 401 ||
      error.code === "actor_changed" ||
      (error.status === 403 &&
        error.code !== "password_confirmation_required")));

const isKnownNoWrite = (error: unknown): error is GlobalRoleApiError =>
  error instanceof GlobalRoleApiError &&
  (error.code === "password_confirmation_required" ||
    error.status === 400 ||
    error.code === "conflict");

const actionLabel = (flow: Flow) => {
  if (flow === "pending") {
    return "正在處理…";
  }
  return flow === "unknown" ? "結果待確認" : "1 項未提交更改";
};

export const AccountIdentityTask = ({
  actorUserId: actor,
  actorName,
  actorUsername,
  initialPerson,
  navigation,
  returnHref,
  targetUserId,
}: {
  actorUserId: string;
  actorName?: string;
  actorUsername?: string | null;
  initialPerson: GlobalRolePerson | null;
  navigation: ReactNode;
  returnHref: string;
  targetUserId: string;
}) => {
  const router = useRouter();
  const {
    actorUserId,
    beginOperation,
    beginRead,
    cancelRead,
    invalidate,
    isCurrent,
    releaseRead,
    requestEpoch,
    verifyActor,
  } = useRoleCommandLifetime(actor);
  const [person, setPerson] = useState<GlobalRolePerson | null>(initialPerson);
  const [flow, setFlow] = useState<Flow>("pending");
  const [message, setMessage] = useState("正在確認目前權限…");
  const [proof, setProof] = useState(false);
  const operation = useRef<RoleOperationReference | null>(null);
  const preparedOperation = useRef<RoleOperationReference | null>(null);
  const cleanupFailure = useRef<{
    error: GlobalRoleApiError;
    reference: RoleOperationReference;
  } | null>(null);
  const submittedIntent = useRef<IdentityIntent | null>(null);
  const busy = useRef(false);
  const authMarker = useRef<string | null>(null);
  const errorFocus = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (message && (flow === "ready" || flow === "unavailable") && !proof) {
      errorFocus.current?.focus();
    }
  }, [flow, message, proof]);
  const discardPreparedOperation = useCallback(() => {
    const prepared = preparedOperation.current;
    if (
      prepared &&
      !removeRoleOperationReference("global-role", actor, prepared)
    ) {
      setMessage("暫時無法清理未提交的查核記錄，請先恢復儲存空間。");
      return false;
    }
    preparedOperation.current = null;
    return true;
  }, [actor]);

  const dispose = useCallback(() => {
    discardPreparedOperation();
    cleanupFailure.current = null;
    invalidate();
    setPerson(null);
    setProof(false);
    setFlow("denied");
    setMessage(
      "登入帳戶或管理權限已改變，人士資料及未提交更改已清除。請重新開啟。 "
    );
    router.replace("/roles/people");
  }, [discardPreparedOperation, invalidate, router]);

  const readSavedOperation = useCallback(() => {
    try {
      return readRoleOperationReference("global-role", actor);
    } catch {
      setPerson(null);
      setProof(false);
      setFlow("storage");
      setMessage(
        "無法安全讀取操作查核記錄，未有提交新的操作。請重新載入後再試。"
      );
    }
  }, [actor]);

  const retainPreparedOperation = (reference: RoleOperationReference) => {
    preparedOperation.current = reference;
    let saved: RoleOperationReference | null | undefined;
    try {
      saved = readRoleOperationReference("global-role", actor);
    } catch {
      // This fresh reference has not dispatched. Retry must verify its same key.
      saved = undefined;
    }
    if (saved && saved.operationKey !== reference.operationKey) {
      preparedOperation.current = null;
      operation.current = saved;
      submittedIntent.current = null;
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

  const handleReadFailure = useCallback(
    (error: unknown) => {
      if (
        readAuthContextMarker() !== authMarker.current ||
        isAuthorityError(error)
      ) {
        dispose();
        if (
          (error instanceof RolePersonApiError ||
            error instanceof GlobalRoleApiError) &&
          error.status === 401
        ) {
          router.replace("/sign-in");
        }
        return;
      }
      if (cleanupFailure.current) {
        setPerson(null);
        setProof(false);
        setFlow("cleanup");
        setMessage(
          "未有儲存；暫時未能確認權限或清理本機查核記錄。請重試清理後再儲存。"
        );
        return;
      }
      if (operation.current) {
        // An unresolved submitted operation is not permission to keep old
        // protected presentation while the current actor cannot be verified.
        setPerson(null);
        setProof(false);
      }
      setFlow(operation.current ? "unknown" : "unavailable");
      setMessage(
        operation.current
          ? "暫時無法讀取目前權限；原有操作仍然保留，請稍後再查核。"
          : "暫時無法讀取目前狀態；未提交選擇已保留，請重新讀取後再儲存。"
      );
    },
    [dispose, router]
  );

  const authorize = useCallback(
    async (epoch: number, signal?: AbortSignal) => {
      if (readAuthContextMarker() !== authMarker.current) {
        dispose();
        return null;
      }
      const result = await getRolePersonDetail(targetUserId, 1, signal);
      if (!isCurrent(epoch, actor)) {
        return null;
      }
      if (
        readAuthContextMarker() !== authMarker.current ||
        result.person.actorUserId !== actor ||
        !result.person.capabilities.canManageAccountRole
      ) {
        dispose();
        return null;
      }
      const { global, identity } = result.person;
      if (
        !global ||
        global.role === "admin" ||
        global.role !== initialPerson?.role
      ) {
        dispose();
        return null;
      }
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
      return result.person;
    },
    [actor, dispose, initialPerson?.role, targetUserId, isCurrent]
  );

  // Settlement requires current actor/Admin authority, not continued target
  // eligibility: a committed transition can remove the target from this reader.
  const verifyAuthority = useCallback(
    async (epoch: number) => {
      const authorized = await verifyActor(
        actor,
        epoch,
        async (signal) => {
          const current = await searchGlobalRolePeople("", 1, signal);
          return current.actorUserId;
        },
        dispose
      );
      if (!authorized) {
        return false;
      }
      if (readAuthContextMarker() !== authMarker.current) {
        dispose();
        return false;
      }
      return true;
    },
    [actor, dispose, verifyActor]
  );

  const retryRead = useCallback(async () => {
    if (busy.current) {
      if (readAuthContextMarker() !== authMarker.current) {
        dispose();
        return;
      }
      if (operation.current) {
        // Recheck only the actor while a write is in flight: starting a new
        // read lifetime here would invalidate or rebind the submitted command.
        const epoch = requestEpoch.current;
        try {
          await verifyAuthority(epoch);
        } catch (error) {
          if (isCurrent(epoch, actor)) {
            handleReadFailure(error);
          }
        }
      }
      return;
    }
    if (cleanupFailure.current) {
      try {
        await verifyAuthority(requestEpoch.current);
      } catch (error) {
        handleReadFailure(error);
      }
      return;
    }
    busy.current = true;
    const { controller, epoch } = beginRead();
    setFlow("pending");
    try {
      const allowed = operation.current
        ? await verifyAuthority(epoch)
        : await authorize(epoch, controller.signal);
      if (!allowed || !isCurrent(epoch, actor)) {
        return;
      }
      setFlow(operation.current ? "unknown" : "ready");
      setMessage(
        operation.current ? "先查核原有操作；未確認前不能另行儲存。" : ""
      );
    } catch (error) {
      if (!controller.signal.aborted && isCurrent(epoch, actor)) {
        handleReadFailure(error);
      }
    } finally {
      releaseRead(controller);
      busy.current = false;
    }
  }, [
    actor,
    authorize,
    beginRead,
    dispose,
    handleReadFailure,
    isCurrent,
    releaseRead,
    requestEpoch,
    verifyAuthority,
  ]);

  useEffect(() => {
    authMarker.current = readAuthContextMarker();
    const saved = readSavedOperation();
    if (saved === undefined) {
      return;
    }
    operation.current = saved;
    if (saved) {
      setPerson(null);
    }
    const { controller, epoch } = beginRead();
    busy.current = true;
    let active = true;
    const check = async () => {
      try {
        if (saved) {
          if (!(await verifyAuthority(epoch)) || !active) {
            return;
          }
        } else if (!(await authorize(epoch, controller.signal)) || !active) {
          return;
        }
        setFlow(saved ? "unknown" : "ready");
        setMessage(saved ? "先查核原有操作；未確認前不能另行儲存。" : "");
      } catch (error) {
        if (active && !controller.signal.aborted && isCurrent(epoch, actor)) {
          handleReadFailure(error);
        }
      } finally {
        releaseRead(controller);
        if (active) {
          busy.current = false;
        }
      }
    };
    void check();
    const recheck = async () => {
      if (readAuthContextMarker() !== authMarker.current) {
        dispose();
        return;
      }
      if (document.visibilityState !== "hidden") {
        await retryRead();
      }
    };
    const store = Reflect.get(window, "cookieStore") as EventTarget | undefined;
    store?.addEventListener("change", recheck);
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      active = false;
      cancelRead(controller, epoch);
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
      store?.removeEventListener("change", recheck);
    };
  }, [
    actor,
    authorize,
    beginRead,
    cancelRead,
    dispose,
    handleReadFailure,
    isCurrent,
    readSavedOperation,
    releaseRead,
    retryRead,
    verifyAuthority,
  ]);

  const finish = (reference: RoleOperationReference, destination: string) => {
    removeRoleOperationReference("global-role", actorUserId.current, reference);
    operation.current = null;
    setPerson(null);
    setProof(false);
    window.location.assign(destination);
  };

  const restoreUnsent = async (
    error: GlobalRoleApiError,
    epoch: number,
    reference: RoleOperationReference
  ) => {
    const intent = submittedIntent.current;
    if (
      !removeRoleOperationReference(
        "global-role",
        actorUserId.current,
        reference
      )
    ) {
      cleanupFailure.current = { error, reference };
      setProof(false);
      setFlow("cleanup");
      setMessage("未有儲存；暫時未能清理本機查核記錄。請重試清理後再儲存。");
      return false;
    }
    cleanupFailure.current = null;
    operation.current = null;
    submittedIntent.current = null;
    setProof(false);
    try {
      const currentPerson = await authorize(epoch);
      const current = currentPerson?.global;
      if (!current) {
        return false;
      }
      setFlow("ready");
      const needsProof = error.code === "password_confirmation_required";
      setMessage(
        needsProof ? "請先確認目前密碼，再按一次儲存。" : error.message
      );
      setProof(needsProof);
      if (
        intent?.resultingGlobalRole === "staff" &&
        !current.eligibleForStaff
      ) {
        setMessage(unavailableStaffMessage);
        setProof(false);
      }
      if (
        intent?.resultingGlobalRole === "admin" &&
        !current.eligibleForAdmin
      ) {
        setMessage(
          "此帳戶目前不符合新增管理員身份的條件，未有儲存。請重設或選擇其他身份。"
        );
        setProof(false);
      }
      return true;
    } catch (readError) {
      if (isCurrent(epoch, actor)) {
        handleReadFailure(readError);
      }
    }
    return false;
  };

  const retryCleanup = async () => {
    const failure = cleanupFailure.current;
    if (!failure || busy.current) {
      return false;
    }
    busy.current = true;
    const epoch = beginOperation();
    try {
      if (await verifyAuthority(epoch)) {
        const restored = await restoreUnsent(
          failure.error,
          epoch,
          failure.reference
        );
        return restored && isCurrent(epoch, actor);
      }
    } catch (error) {
      if (isCurrent(epoch, actor)) {
        handleReadFailure(error);
      }
    } finally {
      if (isCurrent(epoch, actor)) {
        busy.current = false;
      }
    }
    return false;
  };

  const showOriginalUnknown = async (epoch: number, feedback: string) => {
    if (!isCurrent(epoch, actor)) {
      return;
    }
    if (readAuthContextMarker() !== authMarker.current) {
      dispose();
      return;
    }
    try {
      if (!(await verifyAuthority(epoch))) {
        return;
      }
    } catch (error) {
      if (isCurrent(epoch, actor)) {
        handleReadFailure(error);
      }
      return;
    }
    setFlow("unknown");
    setMessage(feedback);
  };

  const handleFailure = async (
    error: unknown,
    epoch: number,
    reference: RoleOperationReference | null
  ) => {
    // The dispatch guard's explicit actor mismatch precedes every effect.
    // Only this freshly dispatched, still matching in-memory reference may
    // be released; restored/reconciled or ambiguous operations stay protected.
    if (
      error instanceof GlobalRoleApiError &&
      error.status === 409 &&
      error.code === "actor_changed" &&
      reference &&
      submittedIntent.current &&
      operation.current?.operationKey === reference.operationKey
    ) {
      removeRoleOperationReference("global-role", actor, reference);
      operation.current = null;
      submittedIntent.current = null;
    }
    if (!isCurrent(epoch, actor)) {
      return;
    }
    if (isAuthorityError(error)) {
      dispose();
      if (
        (error instanceof GlobalRoleApiError ||
          error instanceof RolePersonApiError) &&
        error.status === 401
      ) {
        router.replace("/sign-in");
      }
      return;
    }
    if (!reference) {
      handleReadFailure(error);
      return;
    }
    if (isKnownNoWrite(error)) {
      await restoreUnsent(error, epoch, reference);
      return;
    }
    await showOriginalUnknown(
      epoch,
      "未能確認是否已儲存。請查核原有操作，切勿另行提交。 "
    );
  };

  const save = async (role: "member" | "staff" | "admin") => {
    if (
      busy.current ||
      flow !== "ready" ||
      !person ||
      role === person.role ||
      proof
    ) {
      return;
    }
    busy.current = true;
    setFlow("pending");
    setMessage("正在儲存…");
    const epoch = beginOperation();
    let reference: RoleOperationReference | null = null;
    try {
      const currentPerson = await authorize(epoch);
      const current = currentPerson?.global;
      if (!current) {
        return;
      }
      if (role === "staff" && !current.eligibleForStaff) {
        setFlow("ready");
        setMessage(unavailableStaffMessage);
        return;
      }
      if (role === "admin" && !current.eligibleForAdmin) {
        setFlow("ready");
        setMessage(
          "此帳戶目前不符合新增管理員身份的條件，未有儲存。請重設或選擇其他身份。"
        );
        return;
      }
      reference = preparedOperation.current ?? {
        actorUserId: actor,
        operationKey: crypto.randomUUID(),
      };
      if (
        !storeRoleOperationReference(
          "global-role",
          actorUserId.current,
          reference
        )
      ) {
        retainPreparedOperation(reference);
        return;
      }
      preparedOperation.current = null;
      operation.current = reference;
      const input = globalRoleChangeSchema.parse({
        action: role === "member" ? "withdrawn" : "granted",
        operationKey: reference.operationKey,
        role: role === "admin" ? "admin" : "staff",
        targetUserId: person.userId,
      });
      const intent: IdentityIntent = {
        action: input.action,
        resultingGlobalRole: role,
        targetUserId: input.targetUserId,
      };
      submittedIntent.current = intent;
      const result = await changeGlobalRole(input, actor);
      if (!(await verifyAuthority(epoch))) {
        return;
      }
      if (!matchesIntent(result.receipt, intent)) {
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
    setFlow("pending");
    const { controller, epoch } = beginRead();
    try {
      if (!(await verifyAuthority(epoch))) {
        return;
      }
      const result = await reconcileGlobalRoleChange(
        reference.operationKey,
        actor,
        controller.signal
      );
      if (!(await verifyAuthority(epoch))) {
        return;
      }
      if (result.outcome !== "committed" || !result.receipt) {
        setFlow("unknown");
        setMessage("仍未能確認原有操作，請稍後再查核。 ");
        return;
      }
      const intent = submittedIntent.current;
      if (intent && !matchesIntent(result.receipt, intent)) {
        setFlow("unknown");
        setMessage("原有操作的結果與本次選擇不符，未有確認這次更改。");
        return;
      }
      const destination = intent
        ? returnHref
        : `/roles/people?person=${encodeURIComponent(result.receipt.targetUserId)}`;
      finish(reference, destination);
    } catch (error) {
      if (!isCurrent(epoch, actor)) {
        return;
      }
      if (isAuthorityError(error)) {
        handleReadFailure(error);
      } else {
        await showOriginalUnknown(epoch, "暫時無法查核；原有操作仍然保留。 ");
      }
    } finally {
      releaseRead(controller);
      busy.current = false;
    }
  };

  const defaultValues: IdentityChoice = {
    role: initialPerson?.role ?? "member",
  };
  const form = useAppForm({
    defaultValues,
    onSubmit: async ({ value }) => {
      await save(choiceSchema.parse(value).role);
    },
    validators: { onSubmit: choiceSchema },
  });
  const editable = (flow === "ready" || flow === "cleanup") && !proof;
  const staffGrantUnavailable =
    person?.role === "member" && !person.eligibleForStaff;
  const grantUnavailable: Record<IdentityChoice["role"], boolean> = {
    admin: !person?.eligibleForAdmin,
    member: false,
    staff: staffGrantUnavailable,
  };
  const pendingActions =
    flow === "unknown" || (flow === "pending" && operation.current !== null);
  const messageRole =
    flow === "pending" || flow === "unknown" ? "status" : "alert";
  let recoveryAction: ReactNode = null;
  if (flow === "cleanup") {
    recoveryAction = (
      <Button
        className="mt-4"
        onClick={retryCleanup}
        type="button"
        variant="primary"
      >
        重試清理記錄
      </Button>
    );
  } else if (flow === "storage") {
    recoveryAction = (
      <Button
        className="mt-4"
        onClick={() => window.location.reload()}
        type="button"
        variant="primary"
      >
        重新載入查核記錄
      </Button>
    );
  } else if (flow === "unavailable") {
    recoveryAction = (
      <Button
        className="mt-3"
        onClick={retryRead}
        type="button"
        variant="primary"
      >
        重新讀取目前狀態
      </Button>
    );
  }

  const discardDraft = () => {
    if (busy.current || cleanupFailure.current || !discardPreparedOperation()) {
      return false;
    }
    form.reset();
  };

  const resetDraft = async () => {
    if (busy.current) {
      return;
    }
    if (cleanupFailure.current) {
      if (!(await retryCleanup())) {
        return;
      }
    } else if (!discardPreparedOperation()) {
      return;
    }
    form.reset();
    setProof(false);
    setMessage("");
  };

  const isDirtyRole = (role: IdentityChoice["role"]) =>
    ["ready", "cleanup", "unavailable"].includes(flow) &&
    role !== (initialPerson?.role ?? "member");

  return (
    <form.Subscribe selector={(state) => state.values.role}>
      {(role) => {
        const dirty = isDirtyRole(role);
        return (
          <RoleTaskFrame
            departure={{
              description: "未提交的身份選擇將會清除。",
              isDirty: (dirty || flow === "cleanup") && !pendingActions,
              onDiscard: discardDraft,
            }}
            title="管理帳戶身份"
            navigation={navigation}
            returnControl={
              <TaskDepartureLink
                variant="quiet"
                className="size-11 shrink-0 focus-visible:outline-2"
                href={returnHref}
              >
                <Icon name="arrow-left" className="size-5" />
                <span className="sr-only">返回人員權責</span>
              </TaskDepartureLink>
            }
            actions={
              (person && dirty) || pendingActions
                ? {
                    context: (
                      <p className="text-meta" role="status">
                        {actionLabel(flow)}
                      </p>
                    ),
                    controls:
                      flow === "unknown" ? (
                        <Button
                          onClick={reconcile}
                          variant="primary"
                          type="button"
                        >
                          查核原有操作
                        </Button>
                      ) : (
                        <>
                          <Button
                            disabled={!editable}
                            onClick={resetDraft}
                            type="button"
                            variant="secondary"
                          >
                            重設
                          </Button>
                          <Button
                            disabled={
                              !editable ||
                              flow === "cleanup" ||
                              grantUnavailable[role]
                            }
                            form="account-identity-form"
                            type="submit"
                            variant="primary"
                          >
                            儲存
                          </Button>
                        </>
                      ),
                  }
                : null
            }
          >
            {person ? (
              <>
                <h2 className="text-section wrap-anywhere">
                  {person.fullName}
                </h2>
                <p className="text-muted-foreground mt-1 wrap-anywhere">
                  {person.username ?? "未有 Username"}
                </p>
                <form
                  id="account-identity-form"
                  className="mt-6 space-y-6"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void form.handleSubmit();
                  }}
                >
                  <form.AppField name="role">
                    {(field) => (
                      <field.RadioCardField
                        id="account-role"
                        label="帳戶身份"
                        disabled={!editable}
                        options={[
                          {
                            description:
                              "不具職員權限；會籍及獨立部門／聚會職務不變。",
                            label: "會友",
                            value: "member",
                          },
                          {
                            description:
                              "可使用職員工具；職務指派權需要另行委派。",
                            disabled:
                              person.role !== "staff" &&
                              !person.eligibleForStaff,
                            label: "職員",
                            value: "staff",
                          },
                          {
                            description:
                              "直接新增管理員，毋須先成為職員或等待對方接受。",
                            disabled: !person.eligibleForAdmin,
                            label: "管理員",
                            value: "admin",
                          },
                        ]}
                      />
                    )}
                  </form.AppField>
                  {person.role === "staff" && role === "member" ? (
                    <p className="text-warning">
                      離開職員身份會同時撤回職務指派權；獨立部門及聚會職務保留，不會在日後恢復職員時自動恢復委派。
                    </p>
                  ) : null}
                  {role === "admin" ? (
                    <p className="text-muted-foreground">
                      此帳戶的所有登入將會結束，須重新登入；你會保留管理員身份及目前登入。
                      {person.role === "staff"
                        ? " 離開職員身份會同時撤回職務指派權；獨立部門及聚會職務保留。"
                        : " 會籍及獨立部門／聚會職務不變。"}
                    </p>
                  ) : null}
                </form>
                {proof ? (
                  <AccountSecurityForm
                    actorUserId={actor}
                    actorName={actorName}
                    actorUsername={actorUsername}
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
                        label: "帳戶身份",
                        value: identityChangeLabels[role],
                      },
                    ]}
                    onConfirmationClose={() => setProof(false)}
                    onConfirmedInWork={() => {
                      setProof(false);
                      setMessage("密碼已確認，請再按一次儲存。 ");
                    }}
                  />
                ) : null}
              </>
            ) : null}
            {message ? (
              <p
                ref={errorFocus}
                tabIndex={-1}
                role={messageRole}
                className="mt-6 wrap-anywhere focus-visible:outline-2"
              >
                {message}
              </p>
            ) : null}
            {recoveryAction}
          </RoleTaskFrame>
        );
      }}
    </form.Subscribe>
  );
};
