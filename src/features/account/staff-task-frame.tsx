"use client";

import { createContext, useContext, useState } from "react";

import { UnsavedChangesLink } from "@/components/unsaved-changes-link";

const StaffTaskDirtyContext = createContext<((dirty: boolean) => void) | null>(
  null
);

export const useStaffTaskDirty = () => {
  const setDirty = useContext(StaffTaskDirtyContext);
  if (!setDirty) {
    throw new Error("Staff task content must be rendered inside its frame.");
  }
  return setDirty;
};

export const StaffTaskFrame = ({
  actions,
  children,
  returnHref,
  returnLabel,
  target,
  title,
}: {
  actions?: React.ReactNode;
  children: React.ReactNode;
  returnHref?: string;
  returnLabel?: string;
  target?: { fullName: string; username: string | null };
  title: string;
}) => {
  const [dirty, setDirty] = useState(false);

  return (
    <>
      <header className="mb-6 flex flex-col gap-3">
        {returnHref || actions ? (
          <div className="flex items-center justify-between gap-4">
            {returnHref ? (
              <UnsavedChangesLink
                description="放棄變更會清除未提交的核對；已送出操作的查核記錄會保留。"
                href={returnHref}
                isDirty={dirty}
                onDiscard={() => setDirty(false)}
              >
                ← {returnLabel ?? "返回帳戶詳情"}
              </UnsavedChangesLink>
            ) : (
              <span />
            )}
            {actions}
          </div>
        ) : null}
        <h1 className="text-task font-semibold">{title}</h1>
        {target ? (
          <p className="text-muted-foreground break-all">
            對象：{target.fullName}（{target.username ?? "未設定 Username"}）
          </p>
        ) : null}
      </header>
      <StaffTaskDirtyContext.Provider value={setDirty}>
        {children}
      </StaffTaskDirtyContext.Provider>
    </>
  );
};
