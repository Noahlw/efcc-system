"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  AccountOperationOutcome,
  AccountOperationSummary,
} from "@/features/account/operation-presentation";
import type { AccountOperationSummaryRow } from "@/features/account/operation-presentation";
import { membershipStatusLabel } from "@/features/identity/labels";
import { businessRpc } from "@/shared/business-rpc";

import {
  restrictionActionSchema,
  restrictionErrorSchema,
  restrictionReceiptResponseSchema,
  restrictionRequestSchema,
  storedRestrictionOperationSchema,
} from "./restriction-contract";
import type {
  RestrictionAction,
  RestrictionChangeReceipt,
  RestrictionRequest,
  StoredRestrictionOperation,
} from "./restriction-contract";
import { AccountSecurityForm } from "./security-form";
import type { ManagedAccount } from "./staff-accounts";
import type {
  StaffOperationReference,
  StaffPersonTaskContext,
} from "./staff-task-contract";
import { useStaffTaskDirty } from "./staff-task-frame";

const storageKey = "efcc.restriction.operation.v1";
type Action = RestrictionAction;
type Operation = StoredRestrictionOperation & StaffOperationReference;
type Flow =
  | "restoring"
  | "ready"
  | "submitting"
  | "checking"
  | "retry"
  | "unknown"
  | "rejected"
  | "confirmed";
const labels: Record<Action, string> = {
  account_banned: "封鎖帳戶",
  account_unbanned: "解除封鎖",
  membership_deactivated: "停用會籍",
  membership_reactivated: "重新啟用會籍",
};
const flowTitles: Record<Flow, string> = {
  checking: "正在查核操作",
  confirmed: "操作已確認完成",
  ready: "操作狀態",
  rejected: "操作未完成",
  restoring: "正在查核操作",
  retry: "未找到完成紀錄",
  submitting: "正在提交操作",
  unknown: "操作結果未確認",
};
const flowTones: Record<Flow, "danger" | "info" | "success" | "warning"> = {
  checking: "info",
  confirmed: "success",
  ready: "info",
  rejected: "warning",
  restoring: "info",
  retry: "warning",
  submitting: "info",
  unknown: "warning",
};
const readOperation = (): Operation | null => {
  const raw = localStorage.getItem(storageKey);
  if (!raw) {
    return null;
  }
  const parsed = storedRestrictionOperationSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error("Invalid restriction operation metadata");
  }
  return parsed.data;
};
const clearOperation = (expected: Operation) => {
  const saved = readOperation();
  if (
    saved &&
    (saved.actorUserId !== expected.actorUserId ||
      saved.key !== expected.key ||
      saved.targetUserId !== expected.targetUserId ||
      saved.action !== expected.action)
  ) {
    throw new Error("Operation metadata changed.");
  }
  localStorage.removeItem(storageKey);
  if (readOperation() !== null) {
    throw new Error("Operation metadata remains stored.");
  }
};
const matching = (
  receipt: RestrictionChangeReceipt,
  operation: Pick<Operation, "action" | "targetUserId">
) =>
  receipt.action === operation.action &&
  receipt.targetUserId === operation.targetUserId;

type RestrictionSubmitOutcome =
  | { kind: "confirmed"; receipt: RestrictionChangeReceipt }
  | { code: string | null; kind: "definitive"; message: string; status: number }
  | { kind: "unknown" };

/** No automatic retry/replay: an ambiguous response stays UNKNOWN until reconciliation. */
const sendRestrictionCommand = async (
  request: RestrictionRequest,
  expectedActorUserId: string
): Promise<RestrictionSubmitOutcome> => {
  const response = await businessRpc.api.v2.staff.accounts.restrictions.$post(
    { json: request },
    {
      headers: { "x-efcc-expected-actor-id": expectedActorUserId },
      init: { cache: "no-store", credentials: "same-origin" },
    }
  );
  const body: unknown = await response.json().catch(() => null);
  const result = restrictionReceiptResponseSchema.safeParse(body);
  if (
    (response.status === 200 || response.status === 201) &&
    result.success &&
    result.data.data.receipt &&
    matching(result.data.data.receipt, request)
  ) {
    return { kind: "confirmed", receipt: result.data.data.receipt };
  }
  if ([400, 401, 403, 409].includes(response.status)) {
    const error = restrictionErrorSchema.safeParse(body);
    return {
      code: error.success ? error.data.error.code : null,
      kind: "definitive",
      message: error.success
        ? error.data.error.message
        : "這次操作未提交，請檢查目前狀態後再試。",
      status: response.status,
    };
  }
  return { kind: "unknown" };
};

const reconciliationQueryKey = ["restriction-reconciliation"] as const;

const restrictionReviewRows = (
  action: Action,
  actorName: string | undefined,
  actorUsername: string | null | undefined,
  account: ManagedAccount
): AccountOperationSummaryRow[] => {
  let membershipAfter = account.membershipStatus;
  if (action === "membership_deactivated") {
    membershipAfter = "deactivated";
  } else if (action === "membership_reactivated") {
    membershipAfter = "active";
  }
  let bannedAfter = account.banned !== null;
  if (action === "account_banned") {
    bannedAfter = true;
  } else if (action === "account_unbanned") {
    bannedAfter = false;
  }
  return [
    { label: "登入職員", value: actorName ?? "目前登入職員" },
    { label: "職員 Username", value: actorUsername ?? "未設定" },
    {
      label: "對象帳戶",
      value: `${account.fullName}（${account.username ?? "未設定 Username"}）`,
    },
    { label: "帳戶 ID", value: account.userId },
    {
      label: "目前會籍",
      value: membershipStatusLabel(account.membershipStatus),
    },
    {
      label: "目前安全限制",
      value: account.banned === null ? "未封鎖" : "已封鎖",
    },
    { label: "操作", value: labels[action] },
    { label: "操作後會籍", value: membershipStatusLabel(membershipAfter) },
    { label: "操作後安全限制", value: bannedAfter ? "已封鎖" : "未封鎖" },
    {
      label: "管理員保護",
      value:
        account.role === "admin" &&
        (action === "account_banned" || action === "membership_deactivated")
          ? "伺服器會再次檢查是否仍有其他可用管理員"
          : "只更改此項操作指定的狀態，另一項保持不變",
    },
  ];
};

const permitted = (action: Action, account: ManagedAccount) => {
  if (action === "account_banned") {
    return account.banned === null;
  }
  if (action === "account_unbanned") {
    return account.banned !== null;
  }
  if (action === "membership_deactivated") {
    return account.membershipStatus === "active";
  }
  return account.membershipStatus === "deactivated";
};
const isRetryFor = (
  flow: Flow,
  operation: Operation | null,
  actorUserId: string,
  targetUserId: string
) =>
  flow === "retry" &&
  operation?.actorUserId === actorUserId &&
  operation.targetUserId === targetUserId;
const isActionDisabled = (
  action: Action,
  flow: Flow,
  busy: boolean,
  operation: Operation | null,
  actorUserId: string,
  account: ManagedAccount
) => {
  if (busy || (flow !== "ready" && flow !== "retry")) {
    return true;
  }
  if (flow === "retry") {
    return (
      operation?.actorUserId !== actorUserId ||
      operation.targetUserId !== account.userId ||
      operation.action !== action
    );
  }
  return !permitted(action, account);
};

const RestrictionChangeFormView = ({
  account,
  actorUserId,
  busy,
  flow,
  isActionDisabled: actionDisabled,
  message,
  onCheck,
  onConfirmReview,
  onEditReview,
  onFinish,
  onStartReview,
  operation,
  reviewAction,
  reviewRows,
}: {
  account: ManagedAccount;
  actorUserId: string;
  busy: boolean;
  flow: Flow;
  isActionDisabled: (action: Action) => boolean;
  message: string;
  onCheck: () => void;
  onConfirmReview: () => void;
  onEditReview: () => void;
  onFinish: () => void;
  onStartReview: (action: Action) => void;
  operation: Operation | null;
  reviewAction: Action | null;
  reviewRows: readonly AccountOperationSummaryRow[];
}) => (
  <section
    aria-label="會籍與安全限制"
    className="border-border mt-6 rounded-lg border p-5"
  >
    <h2 className="text-xl font-semibold">會籍與安全限制</h2>
    <p className="mt-3">
      {account.fullName}：會籍
      {membershipStatusLabel(account.membershipStatus)}，安全限制
      {account.banned === null ? "未封鎖" : "已封鎖"}。
    </p>
    <p className="mt-3">
      封鎖／解除封鎖只改變安全限制；停用／重新啟用只改變會籍，兩者互相獨立。
    </p>
    {message ? (
      <AccountOperationOutcome
        busy={busy}
        message={message}
        title={flowTitles[flow]}
        tone={flowTones[flow]}
      />
    ) : null}
    {flow === "unknown" || flow === "retry" ? (
      <Button className="mt-3" type="button" onClick={onCheck} disabled={busy}>
        查核之前的操作
      </Button>
    ) : null}
    {(flow === "confirmed" || flow === "rejected") &&
    operation?.actorUserId === actorUserId ? (
      <Button className="mt-3" type="button" onClick={onFinish}>
        {flow === "rejected"
          ? "操作未完成，開始另一項操作"
          : "完成，開始另一項操作"}
      </Button>
    ) : null}
    {reviewAction ? (
      <section
        aria-labelledby="restriction-review-title"
        className="border-border mt-5 rounded-lg border p-4"
      >
        <h3 className="text-task font-semibold" id="restriction-review-title">
          核對限制操作
        </h3>
        <AccountOperationSummary rows={reviewRows} />
        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <Button type="button" variant="secondary" onClick={onEditReview}>
            返回修改
          </Button>
          <Button type="button" onClick={onConfirmReview}>
            確認並{labels[reviewAction]}
          </Button>
        </div>
      </section>
    ) : (
      <div className="mt-5 flex flex-col gap-3">
        {restrictionActionSchema.options.map((action) => (
          <Button
            key={action}
            type="button"
            disabled={actionDisabled(action)}
            onClick={() => onStartReview(action)}
          >
            {labels[action]}
          </Button>
        ))}
      </div>
    )}
  </section>
);

export const RestrictionChangeForm = ({
  actorName,
  actorUsername,
  actorUserId,
  account,
  confirmationExpiresAt,
}: {
  actorName?: string;
  actorUsername: string | null;
  actorUserId: string;
  account: ManagedAccount;
  confirmationExpiresAt: number | null;
}) => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const setTaskDirty = useStaffTaskDirty();
  const [flow, setFlow] = useState<Flow>("restoring");
  const [message, setMessage] = useState("正在查核未確認操作。");
  const [operation, setOperation] = useState<Operation | null>(null);
  const [reviewAction, setReviewAction] = useState<Action | null>(null);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [confirmedUntil, setConfirmedUntil] = useState<number | null>(
    confirmationExpiresAt
  );
  const busyRef = useRef(false);
  const busy =
    flow === "restoring" || flow === "submitting" || flow === "checking";
  const confirmationIsFresh =
    confirmedUntil !== null && confirmedUntil > Math.floor(Date.now() / 1000);
  const submission = useMutation({
    gcTime: 0,
    mutationFn: ({
      expectedActorUserId,
      request,
    }: {
      expectedActorUserId: string;
      request: RestrictionRequest;
    }) => sendRestrictionCommand(request, expectedActorUserId),
    networkMode: "always",
    retry: false,
  });

  const reconcile = useCallback(
    async (
      saved: Operation
    ): Promise<"confirmed" | "missing" | "rejected" | "unknown"> => {
      setOperation(saved);
      setReviewAction(null);
      setTaskDirty(false);
      if (saved.actorUserId !== actorUserId) {
        setFlow("unknown");
        setMessage(
          "此瀏覽器保留了另一帳戶未確認的操作。請以原帳戶登入查核，操作代碼不會被清除。"
        );
        return "unknown";
      }
      setFlow("checking");
      setMessage("正在向伺服器查核結果。");
      let outcome: "confirmed" | "missing" | "rejected" | "unknown";
      try {
        outcome = await queryClient.query({
          gcTime: 0,
          networkMode: "always",
          queryFn: async (): Promise<
            "confirmed" | "missing" | "rejected" | "unknown"
          > => {
            const response =
              await businessRpc.api.v2.account.changes.reconcile.$post(
                { json: { operationKey: saved.key } },
                {
                  headers: { "x-efcc-expected-actor-id": actorUserId },
                  init: { cache: "no-store", credentials: "same-origin" },
                }
              );
            if (response.status !== 200) {
              return "unknown";
            }
            const parsed = restrictionReceiptResponseSchema.safeParse(
              await response.json().catch(() => null)
            );
            if (!parsed.success) {
              return "unknown";
            }
            const { receipt } = parsed.data.data;
            if (receipt === null) {
              return saved.rejected ? "rejected" : "missing";
            }
            return matching(receipt, saved) ? "confirmed" : "unknown";
          },
          queryKey: reconciliationQueryKey,
          retry: false,
          staleTime: 0,
        });
      } catch {
        setFlow("unknown");
        setMessage("暫時未能查核，結果仍未確認。操作代碼已保留，請再次查核。");
        return "unknown";
      } finally {
        queryClient.removeQueries({
          exact: true,
          queryKey: reconciliationQueryKey,
        });
      }
      if (outcome === "confirmed") {
        setFlow("confirmed");
        setMessage(
          `伺服器已確認「${labels[saved.action]}」完成；對象帳戶：${saved.targetUserId}。`
        );
        router.refresh();
      } else if (outcome === "rejected") {
        setFlow("rejected");
        setMessage(
          "伺服器已拒絕此操作，操作未完成。請按最新帳戶狀態開始另一項操作。"
        );
        router.refresh();
      } else if (outcome === "missing") {
        setFlow("retry");
        setMessage(
          "尚未找到完成紀錄，不能當作成功。請核對原對象與操作後重試原操作。"
        );
        router.refresh();
      } else {
        setFlow("unknown");
        setMessage("暫時未能查核，結果仍未確認。操作代碼已保留，請再次查核。");
      }
      return outcome;
    },
    [actorUserId, queryClient, router, setTaskDirty]
  );
  const check = useCallback(async () => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    try {
      await navigator.locks.request(storageKey, async () => {
        const saved = readOperation();
        if (saved) {
          await reconcile(saved);
        } else {
          setOperation(null);
          setReviewAction(null);
          setTaskDirty(false);
          setFlow("ready");
          setMessage("");
        }
      });
    } catch {
      setFlow("unknown");
      setMessage(
        "未能安全讀寫操作代碼或取得瀏覽器鎖；請恢復本機儲存後再查核。"
      );
    } finally {
      busyRef.current = false;
    }
  }, [reconcile, setTaskDirty]);
  useEffect(() => {
    void check();
    const changed = (event: StorageEvent) => {
      if (event.key === storageKey) {
        void check();
      }
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [check]);

  const retryHere = isRetryFor(flow, operation, actorUserId, account.userId);
  const disabled = busy || (flow !== "ready" && !retryHere);
  const actionDisabled = (action: Action) =>
    isActionDisabled(action, flow, busy, operation, actorUserId, account);
  const startReview = (action: Action) => {
    if (busyRef.current || disabled) {
      return;
    }
    setReviewAction(action);
    setTaskDirty(true);
    setMessage("");
  };
  const editReview = () => {
    setReviewAction(null);
    setTaskDirty(false);
    setMessage("");
  };
  const recoverAfterConfirmationRequired = async (
    next: Operation,
    action: Action,
    errorMessage: string
  ) => {
    if ((await reconcile(next)) !== "missing") {
      return;
    }
    clearOperation(next);
    setOperation(null);
    setFlow("ready");
    setMessage(errorMessage);
    setReviewAction(action);
    setTaskDirty(true);
    setConfirmationOpen(true);
  };
  const handleDefinitiveOutcome = async (
    next: Operation,
    action: Action,
    saved: Operation | null,
    outcome: Extract<RestrictionSubmitOutcome, { kind: "definitive" }>
  ) => {
    if (
      outcome.status === 403 &&
      outcome.code === "password_confirmation_required"
    ) {
      await recoverAfterConfirmationRequired(next, action, outcome.message);
      return true;
    }
    if (!saved && outcome.status === 400) {
      clearOperation(next);
      setOperation(null);
      setFlow("ready");
      setMessage("資料格式不正確，操作未完成。請重新查核帳戶狀態。");
      return true;
    }
    if (
      outcome.status === 409 &&
      (outcome.code === "conflict" || outcome.code === "last_effective_admin")
    ) {
      const rejected: Operation = { ...next, rejected: true };
      localStorage.setItem(storageKey, JSON.stringify(rejected));
      await reconcile(rejected);
      return true;
    }
    return false;
  };
  const submit = async (action: Action) => {
    if (
      busyRef.current ||
      disabled ||
      reviewAction !== action ||
      !confirmationIsFresh
    ) {
      return;
    }
    busyRef.current = true;
    setReviewAction(null);
    setTaskDirty(false);
    try {
      await navigator.locks.request(storageKey, async () => {
        const saved = readOperation();
        if (
          saved &&
          (saved.actorUserId !== actorUserId ||
            saved.key !== operation?.key ||
            saved.targetUserId !== account.userId ||
            saved.action !== action)
        ) {
          await reconcile(saved);
          return;
        }
        const next: Operation = saved ?? {
          action,
          actorUserId,
          key: crypto.randomUUID(),
          targetUserId: account.userId,
        };
        localStorage.setItem(storageKey, JSON.stringify(next));
        if (readOperation()?.key !== next.key) {
          throw new Error("Operation metadata was not persisted");
        }
        const request = restrictionRequestSchema.safeParse({
          action: next.action,
          operationKey: next.key,
          targetUserId: next.targetUserId,
        });
        if (!request.success) {
          setOperation(next);
          setFlow("rejected");
          setMessage("請重新查核帳戶狀態；沒有未確認的伺服器操作。");
          return;
        }
        setOperation(next);
        setFlow("submitting");
        setMessage("正在提交，請勿重複按下提交。");
        let outcome: RestrictionSubmitOutcome;
        try {
          outcome = await submission.mutateAsync({
            expectedActorUserId: actorUserId,
            request: request.data,
          });
        } catch {
          outcome = { kind: "unknown" };
        } finally {
          submission.reset();
        }
        if (outcome.kind === "confirmed") {
          setFlow("confirmed");
          setMessage(
            `伺服器已確認「${labels[action]}」完成；對象帳戶：${next.targetUserId}。`
          );
          router.refresh();
          return;
        }
        if (
          outcome.kind === "definitive" &&
          (await handleDefinitiveOutcome(next, action, saved, outcome))
        ) {
          return;
        }
        await reconcile(next);
      });
    } catch {
      setFlow("unknown");
      setMessage("未能安全保存操作代碼，結果未確認。請再次查核。");
    } finally {
      busyRef.current = false;
    }
  };
  const confirmReview = () => {
    if (!reviewAction || disabled) {
      return;
    }
    if (!confirmationIsFresh) {
      setMessage(
        "請先確認目前登入密碼；完成後會返回同一份核對資料，再由你明確提交。"
      );
      setConfirmationOpen(true);
      return;
    }
    void submit(reviewAction);
  };
  const finish = async () => {
    if (
      busyRef.current ||
      (flow !== "confirmed" && flow !== "rejected") ||
      operation?.actorUserId !== actorUserId
    ) {
      return;
    }
    busyRef.current = true;
    try {
      await navigator.locks.request(storageKey, async () => {
        const saved = readOperation();
        if (saved && saved.key !== operation.key) {
          await reconcile(saved);
          return;
        }
        clearOperation(operation);
        setOperation(null);
        setReviewAction(null);
        setTaskDirty(false);
        setFlow("ready");
        setMessage("");
        router.refresh();
      });
    } catch {
      setMessage("未能清除操作代碼，請恢復本機儲存後再試。");
    } finally {
      busyRef.current = false;
    }
  };

  const review = reviewAction
    ? restrictionReviewRows(reviewAction, actorName, actorUsername, account)
    : null;

  return (
    <>
      <RestrictionChangeFormView
        account={account}
        actorUserId={actorUserId}
        busy={busy}
        flow={flow}
        isActionDisabled={actionDisabled}
        message={message}
        onCheck={check}
        onConfirmReview={confirmReview}
        onEditReview={editReview}
        onFinish={finish}
        onStartReview={startReview}
        operation={operation}
        reviewAction={reviewAction}
        reviewRows={review ?? []}
      />
      {confirmationOpen ? (
        <AccountSecurityForm
          actorName={actorName}
          actorUserId={actorUserId}
          actorUsername={actorUsername}
          confirmationContext={review ?? []}
          confirmationExpiresAt={confirmedUntil}
          confirmationOnly
          onConfirmationClose={() => setConfirmationOpen(false)}
          onConfirmedInWork={() => {
            setConfirmedUntil(Math.floor(Date.now() / 1000) + 600);
            setConfirmationOpen(false);
            setMessage("");
          }}
          task="confirm"
          temporaryPasswordExpired={false}
          temporaryPasswordExpiresAt={null}
        />
      ) : null}
    </>
  );
};

export const StaffRestrictions = ({
  accounts,
  context,
}: {
  accounts: ManagedAccount[];
  context: StaffPersonTaskContext;
}) => {
  const target = accounts.find(
    (account) => account.userId === context.targetUserId
  );
  return target ? (
    <RestrictionChangeForm
      actorName={context.actor.identity?.actorName}
      actorUsername={context.actor.identity?.actorUsername ?? null}
      actorUserId={context.actor.userId}
      account={target}
      confirmationExpiresAt={
        context.actor.identity?.confirmationExpiresAt ?? null
      }
    />
  ) : (
    <p className="mt-6" role="status">
      此帳戶目前不在你的管理範圍內，或暫時無法載入。沒有顯示帳戶資料或操作。
    </p>
  );
};
