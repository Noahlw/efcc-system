"use client";

import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useAppForm } from "@/components/ui/app-form";
import { Button } from "@/components/ui/button";
import { UnsavedChangesLink } from "@/components/unsaved-changes-link";

import { createNativeAuthClient } from "./client";

export type SignInMode = "username" | "name";

const usernamePattern = /^[A-Za-z0-9_.]{3,30}$/u;

const modeCopy: Record<SignInMode, { label: string; hint: string }> = {
  name: {
    hint: "使用你的中文全名；同名時請改用使用者名稱。",
    label: "中文全名",
  },
  username: {
    hint: "使用教會給你的使用者名稱。",
    label: "使用者名稱",
  },
};

interface FailureCopy {
  message: string;
  /** Offered when the person should switch to Username sign-in. */
  switchToUsername?: boolean;
}

const failureCopy = (status: number, mode: SignInMode): FailureCopy => {
  if (status === 429) {
    return { message: "嘗試次數過多，請稍後再試。" };
  }
  if (status === 409) {
    return {
      message: "此中文姓名對應多個帳戶，請改用使用者名稱登入。",
      switchToUsername: true,
    };
  }
  if (status === 401 || status === 422) {
    return {
      message:
        mode === "name"
          ? "中文姓名或密碼不正確，請重新輸入。"
          : "使用者名稱或密碼不正確，請重新輸入。",
    };
  }
  return { message: "系統暫時無法登入，請稍後再試。" };
};

export const SignInForm = () => {
  const router = useRouter();
  const [authClient] = useState(createNativeAuthClient);
  const [mode, setMode] = useState<SignInMode>("username");
  const [failure, setFailure] = useState<FailureCopy | null>(null);

  const form = useAppForm({
    defaultValues: { identifier: "", password: "" },
    onSubmit: async ({ value }) => {
      setFailure(null);
      let result;
      try {
        // The EFCC name plugin has no built-in client method. Better Fetch
        // preserves its native status/code without importing server policy.
        result =
          mode === "username"
            ? await authClient.signIn.username({
                password: value.password,
                username: value.identifier.trim(),
              })
            : await authClient.$fetch("/sign-in/name", {
                body: {
                  fullName: value.identifier.trim(),
                  password: value.password,
                },
                method: "POST",
              });
      } catch {
        setFailure({ message: "無法連接系統，請檢查網絡後再試。" });
        return;
      }

      if (!result.error) {
        router.replace("/");
        router.refresh();
        return;
      }
      if (
        "code" in result.error &&
        result.error.code === "TEMPORARY_PASSWORD_EXPIRED"
      ) {
        setFailure({
          message: "臨時密碼已到期，請聯絡職員重新發出，再登入及更改密碼。",
        });
      } else {
        setFailure(failureCopy(result.error.status, mode));
      }
    },
  });

  const changeMode = (next: SignInMode) => {
    setMode(next);
    setFailure(null);
    // A different identifier kind starts fresh; the shared password stays.
    form.resetField("identifier");
  };

  return (
    <form
      className="mt-8 flex flex-col gap-6"
      noValidate
      onSubmit={async (event) => {
        event.preventDefault();
        event.stopPropagation();
        try {
          await form.handleSubmit();
        } catch {
          setFailure({ message: "系統暫時無法登入，請稍後再試。" });
        }
      }}
    >
      <ToggleGroup
        aria-label="登入方式"
        className="border-border bg-muted grid grid-cols-2 gap-2 rounded-lg border p-1"
        value={[mode]}
        onValueChange={(value) => {
          const [next] = value;
          if (next === "username" || next === "name") {
            changeMode(next);
          }
        }}
      >
        <Toggle
          value="username"
          className="text-muted-foreground data-[pressed]:bg-surface data-[pressed]:text-foreground min-h-12 rounded-md text-sm font-medium data-[pressed]:shadow-sm"
        >
          使用者名稱
        </Toggle>
        <Toggle
          value="name"
          className="text-muted-foreground data-[pressed]:bg-surface data-[pressed]:text-foreground min-h-12 rounded-md text-sm font-medium data-[pressed]:shadow-sm"
        >
          中文全名
        </Toggle>
      </ToggleGroup>

      <form.AppField
        name="identifier"
        validators={{
          onChange: ({ value }) => {
            const trimmed = value.trim();
            if (trimmed.length === 0) {
              return mode === "name"
                ? "請輸入中文全名。"
                : "請輸入使用者名稱。";
            }
            if (mode === "username" && !usernamePattern.test(trimmed)) {
              return "使用者名稱需為 3–30 個英文字母、數字、底線或點。";
            }
          },
        }}
      >
        {(field) => (
          <field.TextField
            key={mode}
            id="sign-in-identifier"
            label={modeCopy[mode].label}
            description={modeCopy[mode].hint}
            autoCapitalize="none"
            autoComplete={mode === "username" ? "username" : "name"}
            spellCheck={false}
          />
        )}
      </form.AppField>

      <form.AppField
        name="password"
        validators={{
          onChange: ({ value }) =>
            value.length === 0 ? "請輸入密碼。" : undefined,
        }}
      >
        {(field) => (
          <field.TextField
            id="sign-in-password"
            label="密碼"
            autoComplete="current-password"
            type="password"
          />
        )}
      </form.AppField>

      {failure ? (
        <div
          className="border-danger bg-danger-surface text-danger rounded-md border px-3 py-2 text-sm"
          role="alert"
        >
          <p>{failure.message}</p>
          {failure.switchToUsername ? (
            <Button
              className="mt-2"
              type="button"
              variant="secondary"
              onClick={() => changeMode("username")}
            >
              改用使用者名稱
            </Button>
          ) : null}
        </div>
      ) : null}

      <form.AppForm>
        <form.SubmitButton label="登入" pendingLabel="登入中…" />
      </form.AppForm>
      <form.Subscribe selector={(state) => state.isDirty}>
        {(isDirty) => (
          <UnsavedChangesLink
            description="繼續編輯會保留登入資料；放棄變更會清除目前登入表單，並開啟帳戶申請。"
            href="/apply"
            isDirty={isDirty}
            onDiscard={() => {
              form.reset();
              setFailure(null);
            }}
          >
            申請新帳戶
          </UnsavedChangesLink>
        )}
      </form.Subscribe>
    </form>
  );
};
