"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import * as z from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import type { OwnApplication } from "./decisions";
import { postAccountOperation } from "./post-operation";

const storageKey = "efcc.applicant.operation.v1";
const actionSchema = z.enum([
  "application_corrected",
  "application_withdrawn",
  "application_resubmitted",
]);
const operationSchema = z.strictObject({
  action: actionSchema,
  actorUserId: z.string().min(1).max(128),
  applicationId: z.uuid(),
  key: z.uuid(),
});
type Operation = z.infer<typeof operationSchema>;
const receiptSchema = z.object({
  action: actionSchema,
  applicationId: z.uuid(),
  createdAt: z.number().int(),
  id: z.uuid(),
});
const responseSchema = z.object({
  data: z.object({ receipt: receiptSchema.nullable() }),
});
const matchesOperation = (
  receipt: z.infer<typeof receiptSchema>,
  operation: Operation
) =>
  receipt.action === operation.action &&
  (operation.action === "application_resubmitted"
    ? receipt.applicationId !== operation.applicationId
    : receipt.applicationId === operation.applicationId);
type Flow =
  | "restoring"
  | "ready"
  | "submitting"
  | "checking"
  | "unknown"
  | "retry"
  | "confirmed";
const readOperation = () => {
  const raw = localStorage.getItem(storageKey);
  return raw ? operationSchema.parse(JSON.parse(raw)) : null;
};
const labels = {
  application_corrected: "修正申請資料",
  application_resubmitted: "重新提交申請",
  application_withdrawn: "撤回申請",
};
export const ApplicantForm = ({
  actorUserId,
  application,
  eligible,
}: {
  actorUserId: string;
  application: OwnApplication;
  eligible: boolean;
}) => {
  const router = useRouter();
  const [flow, setFlow] = useState<Flow>("restoring");
  const [message, setMessage] = useState("正在查核未確認操作。");
  const [operation, setOperation] = useState<Operation | null>(null);
  const busyRef = useRef(false);
  const busy =
    flow === "restoring" || flow === "checking" || flow === "submitting";
  const reconcile = useCallback(
    async (saved: Operation) => {
      setOperation(saved);
      if (saved.actorUserId !== actorUserId) {
        setFlow("unknown");
        setMessage(
          "此瀏覽器保留了另一帳戶未確認的操作。請以原帳戶登入查核；操作代碼不會被清除。"
        );
        return;
      }
      setFlow("checking");
      setMessage("正在向伺服器查核結果。");
      try {
        const response = await postAccountOperation(
          actorUserId,
          "/api/v2/applications/actions/reconcile",
          {
            operationKey: saved.key,
          }
        );
        const parsed = responseSchema.safeParse(await response.json());
        if (
          !response.ok ||
          !parsed.success ||
          (parsed.data.data.receipt &&
            !matchesOperation(parsed.data.data.receipt, saved))
        ) {
          throw new Error("Receipt unavailable");
        }
        if (parsed.data.data.receipt) {
          setFlow("confirmed");
          setMessage(`伺服器已確認「${labels[saved.action]}」完成。`);
        } else {
          setFlow("retry");
          setMessage(
            "尚未找到完成紀錄，不能當作成功。請重新填寫相同資料重試原操作。"
          );
        }
        router.refresh();
      } catch {
        setFlow("unknown");
        setMessage(
          "暫時未能查核，結果仍未確認。請再次查核；未確認前不要開始另一項操作。"
        );
      }
    },
    [actorUserId, router]
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
  }, [reconcile]);
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
  const disabled = (action: Operation["action"]) =>
    !eligible ||
    busy ||
    (flow !== "ready" &&
      !(
        flow === "retry" &&
        operation?.action === action &&
        operation.actorUserId === actorUserId
      ));
  const submit = async (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      !eligible ||
      busyRef.current ||
      (flow !== "ready" && flow !== "retry")
    ) {
      return;
    }
    const form = event.currentTarget;
    const fields = new FormData(form, event.nativeEvent.submitter);
    const parsed = actionSchema.safeParse(fields.get("action"));
    if (!parsed.success) {
      return;
    }
    busyRef.current = true;
    try {
      await navigator.locks.request(storageKey, async () => {
        const saved = readOperation();
        if (
          saved &&
          (saved.actorUserId !== actorUserId ||
            saved.key !== operation?.key ||
            saved.action !== parsed.data)
        ) {
          await reconcile(saved);
          return;
        }
        const next = saved ?? {
          action: parsed.data,
          actorUserId,
          applicationId: application.id,
          key: crypto.randomUUID(),
        };
        localStorage.setItem(storageKey, JSON.stringify(next));
        if (readOperation()?.key !== next.key) {
          throw new Error("Metadata unavailable");
        }
        setOperation(next);
        setFlow("submitting");
        setMessage("正在提交，請勿重複按下提交。");
        const body = {
          action: next.action,
          applicationId: next.applicationId,
          operationKey: next.key,
          ...(next.action === "application_corrected"
            ? {
                email: fields.get("email"),
                fullName: fields.get("fullName"),
                phone: fields.get("phone"),
              }
            : {}),
        };
        try {
          const response = await postAccountOperation(
            actorUserId,
            "/api/v2/applications/actions",
            body
          );
          const result = responseSchema.safeParse(await response.json());
          if (
            response.ok &&
            result.success &&
            result.data.data.receipt &&
            matchesOperation(result.data.data.receipt, next)
          ) {
            setFlow("confirmed");
            setMessage(`伺服器已確認「${labels[next.action]}」完成。`);
            router.refresh();
          } else if (!saved && response.status === 400) {
            localStorage.removeItem(storageKey);
            setOperation(null);
            setFlow("ready");
            setMessage("資料格式不正確，請檢查欄位。");
          } else {
            await reconcile(next);
          }
        } catch {
          await reconcile(next);
        }
      });
    } catch {
      setFlow("unknown");
      setMessage("未能安全保存操作代碼，結果未確認。請再次查核。");
    } finally {
      busyRef.current = false;
    }
  };
  const finish = async () => {
    if (
      busyRef.current ||
      flow !== "confirmed" ||
      operation?.actorUserId !== actorUserId
    ) {
      return;
    }
    busyRef.current = true;
    try {
      await navigator.locks.request(storageKey, async () => {
        const saved = readOperation();
        if (saved && saved.key !== operation?.key) {
          await reconcile(saved);
          return;
        }
        localStorage.removeItem(storageKey);
        setOperation(null);
        setFlow("ready");
        setMessage("");
        router.refresh();
      });
    } catch {
      setMessage("未能清除操作代碼，請恢復本機儲存後重試。");
    } finally {
      busyRef.current = false;
    }
  };
  return (
    <section
      className="border-border mt-6 rounded-lg border p-5"
      aria-labelledby="applicant-actions"
    >
      <h2 id="applicant-actions" className="text-xl font-semibold">
        處理自己的申請
      </h2>
      <p className="mt-3">
        從未獲批准時可修正姓名、電郵及電話；使用者名稱不變。電郵變更後未經驗證，不會啟用電郵復原。
      </p>
      <p className="mt-3" role="status" aria-live="polite">
        {message}
      </p>
      {flow === "unknown" || flow === "retry" ? (
        <Button type="button" onClick={check} disabled={busy} className="mt-3">
          查核之前的操作
        </Button>
      ) : null}
      {flow === "confirmed" && operation?.actorUserId === actorUserId ? (
        <Button type="button" onClick={finish} className="mt-3">
          完成，開始另一項操作
        </Button>
      ) : null}
      {eligible ? (
        <>
          <form onSubmit={submit} className="mt-5 flex flex-col gap-3">
            <fieldset
              disabled={disabled("application_corrected")}
              className="flex flex-col gap-3"
            >
              <legend className="font-semibold">修正資料</legend>
              <label htmlFor="applicant-name">中文全名</label>
              <Input
                id="applicant-name"
                name="fullName"
                autoComplete="name"
                defaultValue={application.fullName}
                maxLength={200}
                required
              />
              <label htmlFor="applicant-email">電郵</label>
              <Input
                id="applicant-email"
                name="email"
                type="email"
                autoComplete="email"
                defaultValue={application.email}
                maxLength={254}
                required
              />
              <label htmlFor="applicant-phone">電話</label>
              <Input
                id="applicant-phone"
                name="phone"
                type="tel"
                autoComplete="tel"
                defaultValue={application.phone ?? ""}
                maxLength={40}
                required
              />
              <Button type="submit" name="action" value="application_corrected">
                修正申請資料
              </Button>
            </fieldset>
          </form>
          <form onSubmit={submit} className="mt-5 flex flex-col gap-3">
            {application.status === "pending" ||
            operation?.action === "application_withdrawn" ? (
              <Button
                type="submit"
                name="action"
                value="application_withdrawn"
                disabled={disabled("application_withdrawn")}
              >
                撤回申請
              </Button>
            ) : null}
            {application.status === "rejected" ||
            application.status === "withdrawn" ||
            operation?.action === "application_resubmitted" ? (
              <Button
                type="submit"
                name="action"
                value="application_resubmitted"
                disabled={disabled("application_resubmitted")}
              >
                重新提交申請
              </Button>
            ) : null}
          </form>
        </>
      ) : (
        <p className="mt-3">
          此帳戶目前不能以申請人身分修正或重新提交。已完成操作仍可查核。
        </p>
      )}
    </section>
  );
};
