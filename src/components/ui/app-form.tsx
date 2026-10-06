"use client";

import { createFormHook, createFormHookContexts } from "@tanstack/react-form";
import type { ComponentProps } from "react";

import { Button } from "./button";
import {
  FieldControl,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldRoot,
} from "./field";
import { Input } from "./input";

const fieldMessages = (errors: readonly unknown[]) => {
  const messages: string[] = [];
  for (const error of errors) {
    if (typeof error === "string") {
      messages.push(error);
    }
    if (
      error &&
      typeof error === "object" &&
      "message" in error &&
      typeof error.message === "string"
    ) {
      messages.push(error.message);
    }
  }
  return messages;
};

export const { fieldContext, formContext, useFieldContext, useFormContext } =
  createFormHookContexts();

const TextField = ({
  label,
  description,
  id,
  textClassName,
  ...props
}: Omit<ComponentProps<typeof Input>, "value" | "onChange" | "onBlur"> & {
  id: string;
  label: string;
  description?: string;
  textClassName?: string;
}) => {
  const field = useFieldContext<string>();
  const messages = fieldMessages(field.state.meta.errors);
  const invalid = field.state.meta.isTouched && messages.length > 0;
  return (
    <FieldRoot name={field.name} invalid={invalid}>
      <FieldLabel className={textClassName} htmlFor={id}>
        {label}
      </FieldLabel>
      <FieldControl
        id={id}
        render={
          <Input
            {...props}
            value={field.state.value}
            onBlur={field.handleBlur}
            onChange={(event) => field.handleChange(event.target.value)}
          />
        }
      />
      {description ? (
        <FieldDescription className={textClassName}>
          {description}
        </FieldDescription>
      ) : null}
      <FieldError className={textClassName} match={invalid}>
        {messages.join(" ")}
      </FieldError>
    </FieldRoot>
  );
};

const TextareaField = ({
  label,
  description,
  id,
  maxLength,
  rows,
  textClassName,
}: {
  id: string;
  label: string;
  description?: string;
  maxLength: number;
  rows: number;
  textClassName?: string;
}) => {
  const field = useFieldContext<string>();
  const messages = fieldMessages(field.state.meta.errors);
  const invalid = field.state.meta.isTouched && messages.length > 0;
  return (
    <FieldRoot name={field.name} invalid={invalid}>
      <FieldLabel className={textClassName} htmlFor={id}>
        {label}
      </FieldLabel>
      <FieldControl
        id={id}
        render={
          <textarea
            className="border-input-border bg-surface text-foreground focus-visible:border-primary aria-invalid:border-danger min-h-24 w-full resize-y rounded-md border px-3 py-2 text-base outline-none"
            maxLength={maxLength}
            rows={rows}
            value={field.state.value}
            onBlur={field.handleBlur}
            onChange={(event) => field.handleChange(event.target.value)}
          />
        }
      />
      {description ? (
        <FieldDescription className={textClassName}>
          {description}
        </FieldDescription>
      ) : null}
      <FieldError className={textClassName} match={invalid}>
        {messages.join(" ")}
      </FieldError>
    </FieldRoot>
  );
};

const SubmitButton = ({
  label,
  pendingLabel,
  disabled = false,
}: {
  label: string;
  pendingLabel: string;
  disabled?: boolean;
}) => {
  const form = useFormContext();
  return (
    <form.Subscribe
      selector={(state) => ({
        canSubmit: state.canSubmit,
        isSubmitting: state.isSubmitting,
      })}
    >
      {({ canSubmit, isSubmitting }) => (
        <Button type="submit" disabled={disabled || !canSubmit || isSubmitting}>
          {isSubmitting ? pendingLabel : label}
        </Button>
      )}
    </form.Subscribe>
  );
};

export const { useAppForm, withForm, withFieldGroup } = createFormHook({
  fieldComponents: { TextField, TextareaField },
  fieldContext,
  formComponents: { SubmitButton },
  formContext,
});
