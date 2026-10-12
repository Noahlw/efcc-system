"use client";

import { createFormHook, createFormHookContexts } from "@tanstack/react-form";
import type {
  AppFieldExtendedReactFormApi,
  FormAsyncValidateOrFn,
  FormValidateOrFn,
} from "@tanstack/react-form";
import { useState } from "react";
import type { ComponentProps, ReactNode } from "react";

import { Button } from "./button";
import {
  FieldControl,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldRoot,
} from "./field";
import { Icon } from "./icon";
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

const StringFieldFrame = ({
  children,
  description,
  id,
  invalid,
  label,
  messages,
  name,
  textClassName,
}: {
  children: ReactNode;
  description?: string;
  id: string;
  invalid: boolean;
  label: string;
  messages: readonly string[];
  name: string;
  textClassName?: string;
}) => (
  <FieldRoot name={name} invalid={invalid}>
    <FieldLabel className={textClassName} htmlFor={id}>
      {label}
    </FieldLabel>
    {children}
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

type TextFieldProps = Omit<
  ComponentProps<typeof Input>,
  "value" | "onChange" | "onBlur"
> & {
  id: string;
  label: string;
  description?: string;
  textClassName?: string;
};

// ponytail: Input already owns Field.Control; one control preserves label/id association.
const TextField = ({
  label,
  description,
  id,
  textClassName,
  ...props
}: TextFieldProps) => {
  const field = useFieldContext<string>();
  const messages = fieldMessages(field.state.meta.errors);
  const invalid = field.state.meta.isTouched && messages.length > 0;
  return (
    <StringFieldFrame
      description={description}
      id={id}
      invalid={invalid}
      label={label}
      messages={messages}
      name={field.name}
      textClassName={textClassName}
    >
      <Input
        {...props}
        id={id}
        value={field.state.value}
        onBlur={field.handleBlur}
        onChange={(event) => field.handleChange(event.target.value)}
      />
    </StringFieldFrame>
  );
};

const PasswordField = ({
  className = "",
  description,
  id,
  label,
  textClassName,
  ...props
}: Omit<TextFieldProps, "type">) => {
  const field = useFieldContext<string>();
  const messages = fieldMessages(field.state.meta.errors);
  const invalid = field.state.meta.isTouched && messages.length > 0;
  const [revealed, setRevealed] = useState(false);
  return (
    <StringFieldFrame
      description={description}
      id={id}
      invalid={invalid}
      label={label}
      messages={messages}
      name={field.name}
      textClassName={textClassName}
    >
      <div className="relative">
        <Input
          {...props}
          id={id}
          className={`pr-12 ${className}`}
          type={revealed ? "text" : "password"}
          value={field.state.value}
          onBlur={field.handleBlur}
          onChange={(event) => field.handleChange(event.target.value)}
        />
        <Button
          aria-label={`${revealed ? "隱藏" : "顯示"}${label}`}
          aria-pressed={revealed}
          className="absolute top-1/2 right-1 -translate-y-1/2"
          type="button"
          variant="quiet"
          onClick={() => setRevealed((current) => !current)}
        >
          <Icon className="h-5 w-5" name="eye" />
        </Button>
      </div>
    </StringFieldFrame>
  );
};

interface RadioCardOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
  disabledReason?: string;
}

const RadioCardField = ({
  description,
  disabled = false,
  id,
  label,
  options,
  presentation = "cards",
  required = false,
  textClassName,
}: {
  description?: string;
  disabled?: boolean;
  id: string;
  label: string;
  options: readonly RadioCardOption[];
  presentation?: "cards" | "segments";
  required?: boolean;
  textClassName?: string;
}) => {
  const field = useFieldContext<string>();
  const messages = fieldMessages(field.state.meta.errors);
  const invalid = field.state.meta.isTouched && messages.length > 0;
  const segmented = presentation === "segments";
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;
  const groupDescription = [
    description ? descriptionId : null,
    invalid ? errorId : null,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <FieldRoot name={field.name} invalid={invalid}>
      <fieldset
        role="radiogroup"
        aria-describedby={groupDescription || undefined}
        className="flex flex-col gap-2"
        disabled={disabled}
      >
        <legend
          className={`text-foreground text-label font-semibold ${textClassName ?? ""}`}
        >
          {label}
        </legend>
        {description ? (
          <FieldDescription className={textClassName} id={descriptionId}>
            {description}
          </FieldDescription>
        ) : null}
        <div
          className={
            segmented
              ? "bg-background flex min-w-0 rounded-[0.5625rem] p-1"
              : "flex flex-col gap-2"
          }
        >
          {options.map((option) => {
            const optionId = `${id}-${option.value}`;
            const optionDescriptionId = `${optionId}-description`;
            const disabledReasonId = `${optionId}-disabled-reason`;
            const describedBy = [
              option.description ? optionDescriptionId : null,
              option.disabled && option.disabledReason
                ? disabledReasonId
                : null,
              invalid ? errorId : null,
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <label
                className={`${
                  segmented
                    ? "text-muted-foreground has-[:checked]:bg-surface has-[:checked]:text-primary has-[:focus-visible]:outline-primary text-meta relative flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center rounded-md px-[0.625rem] py-2 text-center font-semibold has-[:checked]:shadow-[0_1px_4px_#203b3210] has-[:disabled]:opacity-50 has-[:focus-visible]:outline-2"
                    : "border-border bg-surface has-[:checked]:border-primary flex min-h-11 min-w-0 items-start gap-[11px] rounded-[9px] border p-[15px] has-[:checked]:bg-[#f3f8f5]"
                } ${
                  disabled || option.disabled
                    ? "cursor-not-allowed"
                    : "cursor-pointer"
                }`}
                htmlFor={optionId}
                key={option.value}
              >
                <input
                  aria-describedby={describedBy || undefined}
                  aria-invalid={invalid || undefined}
                  checked={field.state.value === option.value}
                  className={
                    segmented
                      ? "absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                      : "accent-primary mt-1 h-5 w-5 shrink-0"
                  }
                  disabled={option.disabled}
                  id={optionId}
                  name={field.name}
                  onBlur={field.handleBlur}
                  onChange={() => field.handleChange(option.value)}
                  required={required}
                  type="radio"
                  value={option.value}
                />
                <span
                  className={
                    segmented ? "pointer-events-none min-w-0" : "min-w-0"
                  }
                >
                  <span
                    className={
                      segmented ? "block font-semibold" : "block font-medium"
                    }
                  >
                    {option.label}
                  </span>
                  {option.description ? (
                    <span
                      className="text-muted-foreground text-meta block"
                      id={optionDescriptionId}
                    >
                      {option.description}
                    </span>
                  ) : null}
                  {option.disabled && option.disabledReason ? (
                    <span
                      className="text-muted-foreground text-meta block"
                      id={disabledReasonId}
                    >
                      {option.disabledReason}
                    </span>
                  ) : null}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <FieldError className={textClassName} id={errorId} match={invalid}>
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
            className="border-input-border bg-surface text-foreground focus-visible:border-primary aria-invalid:border-danger min-h-[105px] w-full resize-y rounded-[10px] border px-[14px] py-3 text-base leading-[1.5] outline-none"
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
      {/* The label wraps the control so the whole >=44px row is the hit target. */}
      <FieldLabel
        className={`flex min-h-11 min-w-0 items-center gap-3 ${textClassName ?? ""}`}
        htmlFor={id}
      >
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
        {label}
      </FieldLabel>
      <FieldError className={textClassName} match={invalid}>
        {messages.join(" ")}
      </FieldError>
    </FieldRoot>
  );
};

const fieldComponents = {
  CheckboxField,
  PasswordField,
  RadioCardField,
  TextField,
  TextareaField,
};
const formComponents = { SubmitButton };

export const { useAppForm } = createFormHook({
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
