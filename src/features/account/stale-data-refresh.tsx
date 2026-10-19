"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { UnsavedChangesConfirmation } from "@/components/unsaved-changes-link";

import { AccountOperationOutcome } from "./operation-presentation";

/** The feature owner replaces its draft only after its authorised read succeeds. */
export const StaleDataRefresh = ({
  disabled,
  pending,
  onRefresh,
}: {
  disabled: boolean;
  pending: boolean;
  onRefresh: () => Promise<void>;
}) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-4">
      <AccountOperationOutcome
        title="資料已更新，請重新載入"
        message="呢份資料已被其他操作修改。你目前嘅修改尚未儲存，請載入最新資料後再核對。"
        tone="warning"
      />
      {disabled ? (
        <p className="text-meta mb-3" role="status">
          仍有未確認的操作，請先查核原操作結果；原操作代碼會保留。
        </p>
      ) : null}
      <Button
        disabled={disabled || pending}
        type="button"
        variant="secondary"
        onClick={() => setOpen(true)}
      >
        {pending ? "正在載入最新資料…" : "重新載入最新資料"}
      </Button>
      <UnsavedChangesConfirmation
        description="重新載入會放棄未儲存修改。只有成功取得最新資料後，才會替換目前草稿。"
        open={open}
        onOpenChange={setOpen}
        onDiscard={() => {
          setOpen(false);
          void onRefresh();
        }}
      />
    </div>
  );
};
