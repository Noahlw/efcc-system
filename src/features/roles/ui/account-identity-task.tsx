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

const choiceSchema = z.object({ role: z.enum(["member", "staff"]) });
type Flow = "ready" | "pending" | "unknown" | "denied" | "storage";
const unavailableStaffMessage =
  "此帳戶目前不符合新增職員身份的條件，未有儲存。請重設或選擇會友。";
interface IdentityIntent {
  action: "granted" | "withdrawn";
  resultingGlobalRole: "member" | "staff";
  targetUserId: string;
}

const matchesIntent = (receipt: GlobalRoleReceipt, intent: IdentityIntent) =>
  receipt.role === "staff" &&
  receipt.action === intent.action &&
  receipt.targetUserId === intent.targetUserId &&
  receipt.resultingGlobalRole === intent.resultingGlobalRole;

const isAuthorityError = (error: unknown) =>
  error instanceof RolePersonApiError ||
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
  initialPerson,
  navigation,
  returnHref,
}: {
  actorUserId: string;
  initialPerson: GlobalRolePerson;
  navigation: ReactNode;
  returnHref: string;
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
    verifyActor,
  } = useRoleCommandLifetime(actor);
  const [person, setPerson] = useState<GlobalRolePerson | null>(initialPerson);
  const [flow, setFlow] = useState<Flow>("pending");
  const [message, setMessage] = useState("正在確認目前權限…");
  const [proof, setProof] = useState(false);
  const operation = useRef<RoleOperationReference | null>(null);
  const preparedOperation = useRef<RoleOperationReference | null>(null);
  const submittedIntent = useRef<IdentityIntent | null>(null);
  const busy = useRef(false);
  const authMarker = useRef<string | null>(null);
  const errorFocus = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (message && flow === "ready" && !proof) {
      errorFocus.current?.focus();
    }
  }, [flow, message, proof]);
  const discardPreparedOperation = useCallback(() => {
    const prepared = preparedOperation.current;
    if (prepared) {
      removeRoleOperationReference("global-role", actor, prepared);
      preparedOperation.current = null;
    }
  }, [actor]);

  const dispose = useCallback(() => {
    discardPreparedOperation();
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

  const authorize = useCallback(
    async (epoch: number, signal?: AbortSignal) => {
      if (readAuthContextMarker() !== authMarker.current) {
        dispose();
        return null;
      }
      const result = await getRolePersonDetail(initialPerson.userId, 1, signal);
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
      return result.person;
    },
    [actor, dispose, initialPerson.userId, isCurrent]
  );

  // Settlement requires current actor/Admin authority, not continued target
  // eligibility: a committed Staff exit may remove the target from this reader.
  const verifyAuthority = async (epoch: number) => {
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
  };

  useEffect(() => {
    authMarker.current = readAuthContextMarker();
    const { controller, epoch } = beginRead();
    busy.current = true;
    let active = true;
    const check = async () => {
      try {
        if (!(await authorize(epoch, controller.signal)) || !active) {
          return;
        }
        const saved = readSavedOperation();
        if (saved === undefined) {
          return;
        }
        operation.current = saved;
        if (saved) {
          setPerson(null);
        }
        setFlow(saved ? "unknown" : "ready");
        setMessage(saved ? "先查核原有操作；未確認前不能另行儲存。" : "");
      } catch {
        if (active && !controller.signal.aborted && isCurrent(epoch, actor)) {
          dispose();
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
      if (document.visibilityState === "hidden" || busy.current) {
        return;
      }
      const readRequest = beginRead();
      try {
        await authorize(readRequest.epoch, readRequest.controller.signal);
      } catch {
        if (
          !readRequest.controller.signal.aborted &&
          isCurrent(readRequest.epoch, actor)
        ) {
          dispose();
        }
      } finally {
        releaseRead(readRequest.controller);
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
    isCurrent,
    readSavedOperation,
    releaseRead,
  ]);

  const finish = (reference: RoleOperationReference, destination: string) => {
    removeRoleOperationReference("global-role", actorUserId.current, reference);
    operation.current = null;
    setPerson(null);
    setProof(false);
    window.location.assign(destination);
  };

  const refreshBaseline = async (epoch: number) => {
    const current = await authorize(epoch);
    if (!current) {
      return null;
    }
    const { global, identity } = current;
    if (!global || global.role === "admin" || global.role !== person?.role) {
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
    return global;
  };

  const restoreUnsent = async (
    error: GlobalRoleApiError,
    epoch: number,
    reference: RoleOperationReference
  ) => {
    try {
      const current = await refreshBaseline(epoch);
      if (!current) {
        return;
      }
      removeRoleOperationReference(
        "global-role",
        actorUserId.current,
        reference
      );
      operation.current = null;
      setFlow("ready");
      const needsProof = error.code === "password_confirmation_required";
      setMessage(
        needsProof ? "請先確認目前密碼，再按一次儲存。" : error.message
      );
      setProof(needsProof);
      if (
        submittedIntent.current?.resultingGlobalRole === "staff" &&
        !current.eligibleForStaff
      ) {
        setMessage(unavailableStaffMessage);
        setProof(false);
      }
      submittedIntent.current = null;
    } catch {
      dispose();
    }
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
      dispose();
      return;
    }
    if (isKnownNoWrite(error)) {
      await restoreUnsent(error, epoch, reference);
      return;
    }
    setFlow("unknown");
    setMessage("未能確認是否已儲存。請查核原有操作，切勿另行提交。 ");
  };

  const save = async (role: "member" | "staff") => {
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
      const current = await refreshBaseline(epoch);
      if (!current) {
        return;
      }
      if (role === "staff" && !current.eligibleForStaff) {
        setFlow("ready");
        setMessage(unavailableStaffMessage);
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
        action: role === "staff" ? "granted" : "withdrawn",
        operationKey: reference.operationKey,
        role: "staff",
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
    const epoch = beginOperation();
    try {
      if (!(await verifyAuthority(epoch))) {
        return;
      }
      const result = await reconcileGlobalRoleChange(
        reference.operationKey,
        actor
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
        dispose();
      } else {
        setFlow("unknown");
        setMessage("暫時無法查核；原有操作仍然保留。 ");
      }
    } finally {
      busy.current = false;
    }
  };

  const form = useAppForm({
    defaultValues: { role: initialPerson.role },
    onSubmit: async ({ value }) => {
      await save(choiceSchema.parse(value).role);
    },
    validators: { onSubmit: choiceSchema },
  });
  const editable = flow === "ready" && !proof;
  const staffGrantUnavailable =
    person?.role === "member" && !person.eligibleForStaff;
  const pendingActions =
    flow === "unknown" || (flow === "pending" && operation.current !== null);
  const messageRole =
    flow === "ready" || flow === "denied" ? "alert" : "status";

  return (
    <form.Subscribe selector={(state) => state.values.role}>
      {(role) => {
        const dirty = person !== null && role !== person.role;
        return (
          <RoleTaskFrame
            title="管理帳戶身份"
            navigation={navigation}
            returnControl={
              <UnsavedChangesLink
                variant="quiet"
                className="size-11 shrink-0 focus-visible:outline-2"
                description="未提交的身份選擇將會清除。"
                href={returnHref}
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
            actions={
              (person && dirty) || pendingActions ? (
                <>
                  <p className="text-meta mr-auto" role="status">
                    {actionLabel(flow)}
                  </p>
                  {flow === "unknown" ? (
                    <Button onClick={reconcile} variant="primary" type="button">
                      查核原有操作
                    </Button>
                  ) : (
                    <>
                      <Button
                        disabled={!editable}
                        onClick={() => {
                          discardPreparedOperation();
                          form.reset();
                          setMessage("");
                        }}
                        type="button"
                        variant="secondary"
                      >
                        重設
                      </Button>
                      <Button
                        disabled={
                          !editable ||
                          (role === "staff" && staffGrantUnavailable)
                        }
                        form="account-identity-form"
                        type="submit"
                        variant="primary"
                      >
                        儲存
                      </Button>
                    </>
                  )}
                </>
              ) : null
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
                        ]}
                      />
                    )}
                  </form.AppField>
                  {person.role === "staff" && role === "member" ? (
                    <p className="text-warning">
                      離開職員身份會同時撤回職務指派權；獨立部門及聚會職務保留，不會在日後恢復職員時自動恢復委派。
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
                        label: "帳戶身份",
                        value: role === "staff" ? "設為職員" : "設為會友",
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
