"use client";

import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { useForm } from "@tanstack/react-form";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  FieldControl,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldRoot,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";

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

const stringMessages = (errors: readonly unknown[]): string[] => {
  const messages: string[] = [];
  for (const error of errors) {
    if (typeof error === "string") {
      messages.push(error);
    }
  }
  return messages;
};

export const SignInForm = () => {
  const router = useRouter();
  const [mode, setMode] = useState<SignInMode>("username");
  const [failure, setFailure] = useState<FailureCopy | null>(null);

  const form = useForm({
    defaultValues: { identifier: "", password: "" },
    onSubmit: async ({ value }) => {
      setFailure(null);
      const [path, body] =
        mode === "username"
          ? [
              "/api/auth/sign-in/username",
              { password: value.password, username: value.identifier.trim() },
            ]
          : [
              "/api/auth/sign-in/name",
              { fullName: value.identifier.trim(), password: value.password },
            ];

      let response: Response;
      try {
        response = await fetch(path, {
          body: JSON.stringify(body),
          headers: { "content-type": "application/json" },
          method: "POST",
        });
      } catch {
        setFailure({ message: "無法連接系統，請檢查網絡後再試。" });
        return;
      }

      if (response.ok) {
        router.replace("/");
        router.refresh();
        return;
      }
      setFailure(failureCopy(response.status, mode));
    },
  });

  const switchToUsername = () => {
    setMode("username");
    setFailure(null);
    form.reset();
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
            setMode(next);
            setFailure(null);
          }
        }}
      >
        <Toggle
          value="username"
          className="text-muted-foreground data-[pressed]:bg-surface data-[pressed]:text-foreground min-h-11 rounded-md text-sm font-medium data-[pressed]:shadow-sm"
        >
          使用者名稱
        </Toggle>
        <Toggle
          value="name"
          className="text-muted-foreground data-[pressed]:bg-surface data-[pressed]:text-foreground min-h-11 rounded-md text-sm font-medium data-[pressed]:shadow-sm"
        >
          中文全名
        </Toggle>
      </ToggleGroup>

      <form.Field
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
        {(field) => {
          const messages = stringMessages(field.state.meta.errors);
          const invalid = field.state.meta.isTouched && messages.length > 0;
          return (
            <FieldRoot name="identifier" invalid={invalid}>
              <FieldLabel htmlFor="sign-in-identifier">
                {modeCopy[mode].label}
              </FieldLabel>
              <FieldControl
                id="sign-in-identifier"
                render={
                  <Input
                    key={mode}
                    autoCapitalize="none"
                    autoComplete={mode === "username" ? "username" : "name"}
                    spellCheck={false}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                }
              />
              <FieldDescription>{modeCopy[mode].hint}</FieldDescription>
              <FieldError match={invalid}>{messages.join(" ")}</FieldError>
            </FieldRoot>
          );
        }}
      </form.Field>

      <form.Field
        name="password"
        validators={{
          onChange: ({ value }) =>
            value.length === 0 ? "請輸入密碼。" : undefined,
        }}
      >
        {(field) => {
          const messages = stringMessages(field.state.meta.errors);
          const invalid = field.state.meta.isTouched && messages.length > 0;
          return (
            <FieldRoot name="password" invalid={invalid}>
              <FieldLabel htmlFor="sign-in-password">密碼</FieldLabel>
              <FieldControl
                id="sign-in-password"
                render={
                  <Input
                    autoComplete="current-password"
                    type="password"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                }
              />
              <FieldError match={invalid}>{messages.join(" ")}</FieldError>
            </FieldRoot>
          );
        }}
      </form.Field>

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
              onClick={switchToUsername}
            >
              改用使用者名稱
            </Button>
          ) : null}
        </div>
      ) : null}

      <form.Subscribe
        selector={(state) => ({
          canSubmit: state.canSubmit,
          isSubmitting: state.isSubmitting,
        })}
      >
        {({ canSubmit, isSubmitting }) => (
          <Button type="submit" disabled={!canSubmit || isSubmitting}>
            {isSubmitting ? "登入中…" : "登入"}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
};
