"use client";

import { useForm } from "@tanstack/react-form";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  FieldControl,
  FieldError,
  FieldLabel,
  FieldRoot,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const usernamePattern = /^[A-Za-z0-9_.]{3,30}$/u;

const failureMessage = (status: number): string => {
  if (status === 429) {
    return "嘗試次數過多，請稍後再試。";
  }
  if (status === 401 || status === 422) {
    return "使用者名稱或密碼不正確，請重新輸入。";
  }
  return "系統暫時無法登入，請稍後再試。";
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
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: { password: "", username: "" },
    onSubmit: async ({ value }) => {
      setFormError(null);
      let response: Response;
      try {
        response = await fetch("/api/auth/sign-in/username", {
          body: JSON.stringify({
            password: value.password,
            username: value.username.trim(),
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        });
      } catch {
        setFormError("無法連接系統，請檢查網絡後再試。");
        return;
      }

      if (response.ok) {
        router.replace("/");
        router.refresh();
        return;
      }
      setFormError(failureMessage(response.status));
    },
  });

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
          setFormError("系統暫時無法登入，請稍後再試。");
        }
      }}
    >
      <form.Field
        name="username"
        validators={{
          onChange: ({ value }) => {
            const trimmed = value.trim();
            if (trimmed.length === 0) {
              return "請輸入使用者名稱。";
            }
            if (!usernamePattern.test(trimmed)) {
              return "使用者名稱需為 3–30 個英文字母、數字、底線或點。";
            }
          },
        }}
      >
        {(field) => {
          const messages = stringMessages(field.state.meta.errors);
          const invalid = field.state.meta.isTouched && messages.length > 0;
          return (
            <FieldRoot name={field.name} invalid={invalid}>
              <FieldLabel htmlFor={field.name}>使用者名稱</FieldLabel>
              <FieldControl
                id={field.name}
                render={
                  <Input
                    autoCapitalize="none"
                    autoComplete="username"
                    spellCheck={false}
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
            <FieldRoot name={field.name} invalid={invalid}>
              <FieldLabel htmlFor={field.name}>密碼</FieldLabel>
              <FieldControl
                id={field.name}
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

      {formError ? (
        <p
          className="border-danger bg-danger-surface text-danger rounded-md border px-3 py-2 text-sm"
          role="alert"
        >
          {formError}
        </p>
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
