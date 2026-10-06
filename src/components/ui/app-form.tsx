"use client";

import { createFormHook, createFormHookContexts } from "@tanstack/react-form";
import type {
  AppFieldExtendedReactFormApi,
  FormAsyncValidateOrFn,
  FormValidateOrFn,
} from "@tanstack/react-form";
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
  disabled,
  id,
  maxLength,
  rows,
  textClassName,
}: {
  id: string;
  label: string;
  description?: string;
  disabled?: boolean;
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
            disabled={disabled}
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

const CheckboxField = ({
  disabled,
  id,
  label,
  textClassName,
}: {
  id: string;
  label: string;
  disabled?: boolean;
  textClassName?: string;
}) => {
  const field = useFieldContext<boolean>();
  const messages = fieldMessages(field.state.meta.errors);
  const invalid = field.state.meta.isTouched && messages.length > 0;
  return (
    <FieldRoot name={field.name} invalid={invalid}>
      <div className="flex min-h-11 min-w-0 items-center gap-3">
        <FieldControl
          id={id}
          render={
            <input
              checked={field.state.value}
              className="h-5 w-5 shrink-0"
              disabled={disabled}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.checked)}
              type="checkbox"
            />
          }
        />
        <FieldLabel className={textClassName} htmlFor={id}>
          {label}
        </FieldLabel>
      </div>
      <FieldError className={textClassName} match={invalid}>
        {messages.join(" ")}
      </FieldError>
    </FieldRoot>
  );
};

const fieldComponents = { CheckboxField, TextField, TextareaField };
const formComponents = { SubmitButton };

export const { useAppForm, withForm, withFieldGroup } = createFormHook({
  fieldComponents,
  fieldContext,
  formComponents,
  formContext,
});

/**
 * The concrete form instance shared by composition owners: one field/value
 * owner per task, bound to the shared Base UI field components.
 */
export type AppFormApi<TFormData> = AppFieldExtendedReactFormApi<
  TFormData,
  FormValidateOrFn<TFormData> | undefined,
  FormValidateOrFn<TFormData> | undefined,
  FormAsyncValidateOrFn<TFormData> | undefined,
  FormValidateOrFn<TFormData> | undefined,
  FormAsyncValidateOrFn<TFormData> | undefined,
  FormValidateOrFn<TFormData> | undefined,
  FormAsyncValidateOrFn<TFormData> | undefined,
  FormValidateOrFn<TFormData> | undefined,
  FormAsyncValidateOrFn<TFormData> | undefined,
  FormAsyncValidateOrFn<TFormData> | undefined,
  unknown,
  typeof fieldComponents,
  typeof formComponents
>;
