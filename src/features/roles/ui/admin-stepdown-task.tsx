"use client";

import { Dialog } from "@base-ui/react/dialog";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import * as z from "zod";

import { useAppForm } from "@/components/ui/app-form";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { UnsavedChangesLink } from "@/components/unsaved-changes-link";
import { securityStateResponseSchema } from "@/features/account/security/security-contract";
import { AccountSecurityForm } from "@/features/account/security/security-form";
import {
  prepareAuthContextMarker,
  readAuthContextMarker,
} from "@/features/auth/auth-context-marker";

import type { GlobalRoleReceipt } from "../global-role-contract";
import {
  changeGlobalRole,
  GlobalRoleApiError,
  searchGlobalRolePeople,
} from "./global-role-api";
import {
  readSelfStepdownOperationReference,
  removeSelfStepdownOperationReference,
  storeSelfStepdownOperationReference,
  useRoleCommandLifetime,
} from "./role-command-lifetime";
import type { SelfStepdownOperationReference } from "./role-command-lifetime";
import { RoleTaskFrame } from "./role-task-frame";

const selfStepdownOutcomeText = (
  kind: "complete" | "unknown",
  resultingGlobalRole?: "member" | "staff"
) => {
  if (kind === "complete" && resultingGlobalRole) {
    const roleName = resultingGlobalRole === "member" ? "會員" : "職員";
    return `你已退出管理員身份，現時全域身份為${roleName}。所有登入工作階段已結束，請重新登入。`;
  }
  return "請勿重複提交。此頁的管理資料已清除；請重新登入以繼續使用帳戶。";
};

const GlobalRoleSelfStepdownOutcome = ({
  kind,
  resultingGlobalRole,
}: {
  kind: "complete" | "unknown";
  resultingGlobalRole?: "member" | "staff";
}) => (
  <section
    aria-label="自願退出管理員身份結果"
    className="border-border rounded-lg border p-4 sm:p-6"
    role={kind === "complete" ? "status" : "alert"}
  >
    <h2 className="text-section">
      {kind === "complete" ? "操作已完成" : "操作結果未能確認"}
    </h2>
    <p className="text-body mt-3">
      {selfStepdownOutcomeText(kind, resultingGlobalRole)}
    </p>
    <a
      className="text-primary mt-4 inline-flex min-h-11 items-center underline focus-visible:outline-2"
      href="/sign-in"
    >
      前往登入
    </a>
  </section>
);

const choiceSchema = z.object({ role: z.enum(["member", "staff"]) });
type Flow =
  | "checking"
  | "ready"
  | "pending"
  | "unknown"
  | "complete"
  | "denied"
  | "unavailable";

export const AdminStepdownTask = ({
  actorUserId: actor,
  fullName,
  username,
  navigation,
}: {
  actorUserId: string;
  fullName: string;
  username: string | null;
  navigation: ReactNode;
}) => {
  const router = useRouter();
  const {
    beginOperation,
    beginRead,
    cancelRead,
    invalidate,
    isCurrent,
    releaseRead,
    verifyActor,
  } = useRoleCommandLifetime(actor);
  const [flow, setFlow] = useState<Flow>("checking");
  const [message, setMessage] = useState("正在確認目前權限…");
  const [proof, setProof] = useState(false);
  const [review, setReview] = useState(false);
  const [result, setResult] = useState<"member" | "staff">("member");
  const busy = useRef(false);
  const marker = useRef<string | null>(null);
  const operation = useRef<SelfStepdownOperationReference | null>(null);
  const flowRef = useRef(flow);
  flowRef.current = flow;
  const form = useAppForm({
    defaultValues: { role: "member" as "member" | "staff" },
    onSubmit: ({ value }) => {
      setResult(choiceSchema.parse(value).role);
      setReview(true);
    },
    validators: { onSubmit: choiceSchema },
  });
  const dispose = useCallback(() => {
    invalidate();
    setProof(false);
    setReview(false);
    setFlow("denied");
    setMessage("登入帳戶或權限已改變，未提交選擇已清除。");
    router.replace("/account");
    router.refresh();
  }, [invalidate, router]);

  const authorize = useCallback(
    async (epoch: number) => {
      if (readAuthContextMarker() !== marker.current) {
        dispose();
        return false;
      }
      const allowed = await verifyActor(
        actor,
        epoch,
        async (signal) => {
          const current = await searchGlobalRolePeople("", 1, signal);
          return current.actorUserId;
        },
        dispose
      );
      if (!allowed || !isCurrent(epoch, actor)) {
        return false;
      }
      if (readAuthContextMarker() !== marker.current) {
        dispose();
        return false;
      }
      return true;
    },
    [actor, dispose, isCurrent, verifyActor]
  );

  useEffect(() => {
    marker.current = prepareAuthContextMarker();
    const { controller, epoch } = beginRead();
    let active = true;
    const initialize = async () => {
      try {
        operation.current = readSelfStepdownOperationReference(actor);
      } catch {
        invalidate();
        setFlow("unavailable");
        setMessage(
          "暫時未能讀取原有操作記錄，資料已隱藏；請恢復瀏覽器儲存功能後重新載入。"
        );
        releaseRead(controller);
        return;
      }
      if (operation.current) {
        setFlow("unknown");
        setMessage("");
        return;
      }
      try {
        if ((await authorize(epoch)) && active && isCurrent(epoch, actor)) {
          setFlow("ready");
          setMessage("");
        }
      } catch (error) {
        if (active && !controller.signal.aborted && isCurrent(epoch, actor)) {
          if (
            error instanceof GlobalRoleApiError &&
            (error.status === 401 || error.status === 403)
          ) {
            dispose();
          } else {
            invalidate();
            setFlow("unavailable");
            setMessage("暫時未能確認管理權限，資料已隱藏；請重新載入。");
          }
        }
      } finally {
        releaseRead(controller);
      }
    };
    void initialize();
    const recheck = async () => {
      if (document.visibilityState === "hidden") {
        return;
      }
      if (readAuthContextMarker() !== marker.current) {
        dispose();
        return;
      }
      // Revocation may be our own commit. Never turn its missing Session into
      // settlement, a protected receipt read, or permission for a replacement.
      if (busy.current || flowRef.current !== "ready") {
        return;
      }
      const request = beginRead();
      try {
        await authorize(request.epoch);
      } catch (error) {
        if (!isCurrent(request.epoch, actor)) {
          return;
        }
        if (
          error instanceof GlobalRoleApiError &&
          (error.status === 401 || error.status === 403)
        ) {
          dispose();
        } else {
          invalidate();
          setFlow("unavailable");
          setProof(false);
          setReview(false);
          setMessage("暫時未能確認管理權限，資料已隱藏；請重新載入。");
        }
      } finally {
        releaseRead(request.controller);
      }
    };
    const cookies = Reflect.get(window, "cookieStore") as
      | EventTarget
      | undefined;
    cookies?.addEventListener("change", recheck);
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      active = false;
      cancelRead(controller, epoch);
      cookies?.removeEventListener("change", recheck);
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, [
    actor,
    authorize,
    beginRead,
    cancelRead,
    dispose,
    invalidate,
    isCurrent,
    releaseRead,
  ]);

  const beginReview = async () => {
    if (busy.current || flow !== "ready" || proof) {
      return;
    }
    busy.current = true;
    const { controller, epoch } = beginRead();
    setFlow("checking");
    try {
      if (!(await authorize(epoch))) {
        return;
      }
      const response = await fetch("/api/v2/account/security", {
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      });
      if (!isCurrent(epoch, actor)) {
        return;
      }
      if (
        readAuthContextMarker() !== marker.current ||
        response.status === 401 ||
        response.status === 403
      ) {
        dispose();
        return;
      }
      if (!response.ok) {
        throw new Error("Security state unavailable");
      }
      const body: unknown = await response.json();
      if (!isCurrent(epoch, actor)) {
        return;
      }
      if (readAuthContextMarker() !== marker.current) {
        dispose();
        return;
      }
      const {
        data: { state },
      } = securityStateResponseSchema.parse(body);
      setFlow("ready");
      if (
        state.passwordConfirmationExpiresAt === null ||
        state.passwordConfirmationExpiresAt <= Math.floor(Date.now() / 1000)
      ) {
        setMessage("請先確認目前密碼，返回後再按繼續；不會自動退出。");
        setProof(true);
      } else {
        await form.handleSubmit();
      }
    } catch (error) {
      if (!isCurrent(epoch, actor)) {
        return;
      }
      if (
        error instanceof GlobalRoleApiError &&
        (error.status === 401 || error.status === 403)
      ) {
        dispose();
        return;
      }
      setFlow("ready");
      setMessage("暫時未能確認安全狀態，未有提交；請再試。");
    } finally {
      releaseRead(controller);
      busy.current = false;
    }
  };

  const verifyPostDispatchIdentity = async (
    epoch: number,
    reference: SelfStepdownOperationReference
  ) => {
    if (readAuthContextMarker() !== reference.authContextMarker) {
      dispose();
      return false;
    }
    const sameIdentity = await verifyActor(
      actor,
      epoch,
      async (signal) => {
        const response = await fetch("/api/auth/get-session", {
          cache: "no-store",
          credentials: "same-origin",
          signal,
        });
        if (!response.ok) {
          throw new Error("Unreadable authentication context");
        }
        const identity = z
          .object({
            user: z.object({ id: z.string() }),
          })
          .nullable()
          .parse(await response.json());
        // A missing Session is expected after revocation, not evidence of
        // success. Only a matching command receipt can settle the operation.
        return identity?.user.id ?? actor;
      },
      dispose
    );
    if (!sameIdentity || !isCurrent(epoch, actor)) {
      return false;
    }
    if (readAuthContextMarker() !== reference.authContextMarker) {
      dispose();
      return false;
    }
    return true;
  };

  const acknowledge = async (
    receipt: GlobalRoleReceipt,
    epoch: number,
    reference: SelfStepdownOperationReference
  ) => {
    if (!isCurrent(epoch, actor)) {
      return;
    }
    // Only the public Session identity fences an acknowledgement after dispatch.
    if (!(await verifyPostDispatchIdentity(epoch, reference))) {
      return;
    }
    if (
      receipt.role !== "admin" ||
      receipt.action !== "withdrawn" ||
      receipt.targetUserId !== actor ||
      receipt.resultingGlobalRole !== result
    ) {
      throw new Error("Unverified outcome");
    }
    removeSelfStepdownOperationReference(actor, reference);
    operation.current = null;
    invalidate();
    setFlow("complete");
    setMessage("");
  };

  const restoreNoWrite = async (
    error: GlobalRoleApiError,
    epoch: number,
    reference: SelfStepdownOperationReference
  ) => {
    if (!(await authorize(epoch))) {
      return;
    }
    removeSelfStepdownOperationReference(actor, reference);
    operation.current = null;
    setFlow("ready");
    const needsProof = error.code === "password_confirmation_required";
    setMessage(
      needsProof
        ? "請先確認目前密碼，返回後再明確確認退出。"
        : "未有退出。必須保留另一位有效管理員；請重新查閱後再確認。"
    );
    setProof(needsProof);
  };

  const handleDispatchFailure = async (
    error: unknown,
    epoch: number,
    reference: SelfStepdownOperationReference | null
  ) => {
    // Fresh dispatch's explicit mismatch is a pre-effect guard. A 401 alone
    // can follow commit and must never release an ambiguous original key.
    if (
      error instanceof GlobalRoleApiError &&
      error.status === 409 &&
      error.code === "actor_changed" &&
      reference &&
      operation.current?.operationKey === reference.operationKey
    ) {
      removeSelfStepdownOperationReference(actor, reference);
      operation.current = null;
      dispose();
      return;
    }
    if (!isCurrent(epoch, actor)) {
      return;
    }
    if (readAuthContextMarker() !== marker.current) {
      dispose();
      return;
    }
    if (!reference) {
      dispose();
      return;
    }
    const noWrite =
      error instanceof GlobalRoleApiError &&
      (error.status === 400 ||
        error.code === "conflict" ||
        error.code === "password_confirmation_required");
    if (noWrite) {
      try {
        await restoreNoWrite(error, epoch, reference);
        return;
      } catch {
        // An unreadable current context cannot settle the command.
      }
    }
    try {
      if (!(await verifyPostDispatchIdentity(epoch, reference))) {
        return;
      }
    } catch {
      // An unreadable Session leaves uncertainty, never inferred success.
      if (!isCurrent(epoch, actor)) {
        return;
      }
    }
    invalidate();
    setFlow("unknown");
    setMessage("");
  };

  const submit = async () => {
    if (busy.current || flow !== "ready" || !review || operation.current) {
      return;
    }
    busy.current = true;
    setFlow("pending");
    setReview(false);
    const epoch = beginOperation();
    let reference: SelfStepdownOperationReference | null = null;
    try {
      if (!(await authorize(epoch))) {
        return;
      }
      const candidate: SelfStepdownOperationReference = {
        actorUserId: actor,
        authContextMarker: prepareAuthContextMarker(),
        operationKey: crypto.randomUUID(),
      };
      if (!storeSelfStepdownOperationReference(actor, candidate)) {
        setFlow("ready");
        setMessage(
          "未有提交退出操作。暫時未能保留安全操作記錄；請恢復瀏覽器儲存功能後，再明確確認退出。"
        );
        return;
      }
      reference = candidate;
      operation.current = reference;
      const { receipt } = await changeGlobalRole(
        {
          action: "withdrawn",
          operationKey: reference.operationKey,
          resultingGlobalRole: result,
          role: "admin",
          targetUserId: actor,
        },
        actor
      );
      await acknowledge(receipt, epoch, reference);
    } catch (error) {
      await handleDispatchFailure(error, epoch, reference);
    } finally {
      busy.current = false;
    }
  };

  const settled = flow === "complete" || flow === "unknown";
  const visible = !settled && flow !== "denied" && flow !== "unavailable";
  const editable = flow === "ready" && !proof && !review;
  return (
    <form.Subscribe selector={(state) => state.values.role}>
      {(role) => (
        <RoleTaskFrame
          title="自願退出管理員身份"
          navigation={visible ? navigation : null}
          returnControl={
            visible ? (
              <UnsavedChangesLink
                href="/account"
                variant="quiet"
                className="size-11 shrink-0"
                isDirty={role !== "member" && flow === "ready"}
                description="未提交的身份選擇將會清除。"
                onDiscard={() => {
                  if (busy.current) {
                    return false;
                  }
                  form.reset();
                }}
              >
                <Icon name="arrow-left" className="size-5" />
                <span className="sr-only">返回帳戶</span>
              </UnsavedChangesLink>
            ) : null
          }
          actions={
            (visible || flow === "unavailable") && (
              <>
                {visible ? (
                  <>
                    <p className="text-meta mr-auto" role="status">
                      {flow === "pending"
                        ? "正在提交退出操作…"
                        : "退出後需要重新登入"}
                    </p>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={!editable}
                      onClick={() => {
                        form.reset();
                        setMessage("");
                      }}
                    >
                      重設
                    </Button>
                    <Button
                      type="button"
                      variant="primary"
                      disabled={!editable}
                      onClick={beginReview}
                    >
                      繼續
                    </Button>
                  </>
                ) : null}
                {flow === "unavailable" ? (
                  <form action="/account" method="get">
                    <input type="hidden" name="task" value="admin-exit" />
                    <Button type="submit" variant="primary">
                      重新載入
                    </Button>
                  </form>
                ) : null}
              </>
            )
          }
        >
          {settled ? (
            <GlobalRoleSelfStepdownOutcome
              kind={flow === "complete" ? "complete" : "unknown"}
              resultingGlobalRole={flow === "complete" ? result : undefined}
            />
          ) : null}
          {visible ? (
            <>
              <h2 className="text-section wrap-anywhere">{fullName}</h2>
              <p className="text-muted-foreground mt-1 wrap-anywhere">
                {username ?? "未有 Username"}
              </p>
              <p className="mt-6">
                退出將撤回你的管理員權限，結束所有裝置的登入，包括目前登入。必須保留另一位有效管理員。會籍及獨立部門／聚會職務不變，職務指派權不會自動恢復。
              </p>
              <p className="text-muted-foreground mt-3">
                新增另一位管理員是人員權責內的獨立工作，不會代你退出。
              </p>
              <div className="mt-6">
                <form.AppField name="role">
                  {(field) => (
                    <field.RadioCardField
                      id="admin-stepdown-role"
                      label="退出後的全域身份"
                      disabled={!editable}
                      options={[
                        {
                          description: "不具職員或管理員權限。",
                          label: "會友（預設）",
                          value: "member",
                        },
                        {
                          description:
                            "保留職員工具；不具管理員或自動恢復的職務指派權。",
                          label: "職員",
                          value: "staff",
                        },
                      ]}
                    />
                  )}
                </form.AppField>
              </div>
              {proof ? (
                <AccountSecurityForm
                  actorUserId={actor}
                  confirmationExpiresAt={null}
                  temporaryPasswordExpiresAt={null}
                  temporaryPasswordExpired={false}
                  task="confirm"
                  confirmationOnly
                  confirmationContext={[
                    { label: "操作", value: "自願退出管理員身份" },
                    {
                      label: "退出後身份",
                      value: role === "staff" ? "職員" : "會友",
                    },
                  ]}
                  onConfirmationClose={() => setProof(false)}
                  onConfirmedInWork={() => {
                    setProof(false);
                    setMessage("密碼已確認，請再按繼續並明確確認退出。");
                  }}
                />
              ) : null}
              <Dialog.Root
                open={review}
                onOpenChange={(open) => {
                  if (!busy.current) {
                    setReview(open);
                  }
                }}
              >
                <Dialog.Portal>
                  <Dialog.Backdrop className="fixed inset-0 z-50 bg-[#13302c59]" />
                  <Dialog.Viewport
                    className="fixed inset-x-0 z-50 grid place-items-center overflow-y-auto p-4"
                    style={{
                      bottom:
                        "calc(100% - var(--s3-task-viewport-height, 100%) - var(--s3-task-viewport-offset-top, 0px))",
                      top: "var(--s3-task-viewport-offset-top, 0px)",
                    }}
                  >
                    <Dialog.Popup className="border-border bg-surface max-h-[calc(var(--s3-task-viewport-height,100dvh)-env(safe-area-inset-top)-env(safe-area-inset-bottom)-2rem)] w-full max-w-lg overflow-y-auto overscroll-contain rounded-2xl border p-6 shadow-xl outline-none">
                      <Dialog.Title className="text-task">
                        確認自願退出
                      </Dialog.Title>
                      <Dialog.Description className="mt-3">
                        退出後的全域身份將是
                        {result === "staff" ? "職員" : "會友"}
                        。此操作會結束此帳戶所有登入工作階段，包括目前工作階段；完成後需要重新登入。
                      </Dialog.Description>
                      <div className="mt-6 flex flex-wrap gap-3">
                        <Dialog.Close
                          render={<Button type="button" variant="secondary" />}
                        >
                          取消
                        </Dialog.Close>
                        <Button type="button" variant="danger" onClick={submit}>
                          確認並退出管理員身份
                        </Button>
                      </div>
                    </Dialog.Popup>
                  </Dialog.Viewport>
                </Dialog.Portal>
              </Dialog.Root>
            </>
          ) : null}
          {message ? (
            <p
              className="mt-6 wrap-anywhere"
              role={flow === "ready" || flow === "denied" ? "alert" : "status"}
            >
              {message}
            </p>
          ) : null}
        </RoleTaskFrame>
      )}
    </form.Subscribe>
  );
};
