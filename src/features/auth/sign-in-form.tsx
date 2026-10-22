"use client";

import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useAppForm } from "@/components/ui/app-form";
import { Button } from "@/components/ui/button";
import { UnsavedChangesLink } from "@/components/unsaved-changes-link";
import { clearSessionDrafts } from "@/features/account/session-draft";

import { createNativeAuthClient } from "./client";

export type SignInMode = "username" | "name";

const usernamePattern = /^[A-Za-z0-9_.]{3,30}$/u;

const modeCopy: Record<SignInMode, { label: string; hint: string }> = {
  name: {
    hint: "輸入申請時填寫的完整姓名。",
    label: "中文全名",
  },
  username: {
    hint: "你的專屬使用者名稱。",
    label: "Username",
  },
};

interface FailureCopy {
  title: string;
  message: string;
  /** Offered when the person should switch to Username sign-in. */
  switchToUsername?: boolean;
}

const failureCopy = (status: number): FailureCopy => {
  if (status === 429) {
    return {
      message: "登入嘗試次數較多，請稍候再試。",
      title: "請稍後再試",
    };
  }
  if (status === 409) {
    return {
      message: "請改用你的 Username 登入。姓名相同不代表同一個帳戶。",
      switchToUsername: true,
      title: "有多個帳戶使用這個姓名",
    };
  }
  if (status === 401 || status === 422) {
    return {
      message: "請檢查登入資料及密碼後再試。",
      title: "未能登入",
    };
  }
  return { message: "請稍後再試。", title: "系統暫時無法登入" };
};

export const SignInForm = () => {
  const router = useRouter();
  const [authClient] = useState(createNativeAuthClient);
  const [mode, setMode] = useState<SignInMode>("username");
  const [failure, setFailure] = useState<FailureCopy | null>(null);
  useEffect(() => {
    try {
      clearSessionDrafts();
    } catch {
      // No draft may be restored without a current matching actor and login generation.
    }
  }, []);

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
        setFailure({
          message: "請檢查網絡後再試。",
          title: "無法連接系統",
        });
        return;
      }

      if (!result.error) {
        try {
          clearSessionDrafts();
        } catch {
          /* Restore still checks actor, auth context and expiry. */
        }
        router.replace("/");
        router.refresh();
        return;
      }
      if (
        "code" in result.error &&
        result.error.code === "TEMPORARY_PASSWORD_EXPIRED"
      ) {
        setFailure({
          message: "請聯絡職員重新發出臨時密碼。",
          title: "臨時密碼已到期",
        });
      } else {
        setFailure(failureCopy(result.error.status));
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
          setFailure({
            message: "請稍後再試。",
            title: "系統暫時無法登入",
          });
        }
      }}
    >
      {failure ? (
        <div
          className="bg-warning-surface text-warning text-label rounded-xl p-4"
          role="alert"
        >
          <p className="font-semibold">{failure.title}</p>
          <p className="mt-1">{failure.message}</p>
        </div>
      ) : null}

      <ToggleGroup
        aria-label="登入方式"
        className="bg-background grid grid-cols-2 rounded-lg p-1"
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
          className="text-muted-foreground data-[pressed]:bg-surface data-[pressed]:text-primary min-h-12 rounded-md text-sm font-medium data-[pressed]:shadow-sm"
        >
          Username
        </Toggle>
        <Toggle
          value="name"
          className="text-muted-foreground data-[pressed]:bg-surface data-[pressed]:text-primary min-h-12 rounded-md text-sm font-medium data-[pressed]:shadow-sm"
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
          <field.PasswordField
            id="sign-in-password"
            label="密碼"
            autoComplete="current-password"
          />
        )}
      </form.AppField>

      <form.AppForm>
        <form.SubmitButton label="登入" pendingLabel="正在處理…" />
      </form.AppForm>
      {failure?.switchToUsername ? (
        <Button
          className="w-full"
          type="button"
          variant="secondary"
          onClick={() => changeMode("username")}
        >
          改用使用者名稱
        </Button>
      ) : null}
      <form.Subscribe selector={(state) => state.isDirty}>
        {(isDirty) => (
          <>
            <div className="text-meta mt-6 flex flex-wrap items-center justify-center gap-x-1 [&>a]:font-semibold [&>a]:no-underline">
              <span>第一次使用？</span>
              <UnsavedChangesLink
                description="繼續編輯會保留登入資料；放棄變更會清除目前登入表單，並開啟帳戶申請。"
                href="/apply"
                isDirty={isDirty}
                onDiscard={() => {
                  form.reset();
                  setFailure(null);
                }}
              >
                申請帳戶
              </UnsavedChangesLink>
            </div>
            <p className="text-muted-foreground text-meta mt-4">
              忘記登入資料或需要協助，請聯絡教會同工。
            </p>
          </>
        )}
      </form.Subscribe>
    </form>
  );
};
