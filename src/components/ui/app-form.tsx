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

export const { fieldContext, formContext, useFieldContext, useFormContext } =
  createFormHookContexts();

const TextField = ({
  label,
  description,
  id,
  ...props
}: Omit<ComponentProps<typeof Input>, "value" | "onChange" | "onBlur"> & {
  id: string;
  label: string;
  description?: string;
}) => {
  const field = useFieldContext<string>();
  const messages: string[] = [];
  for (const error of field.state.meta.errors) {
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
  const invalid = field.state.meta.isTouched && messages.length > 0;
  return (
    <FieldRoot name={field.name} invalid={invalid}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
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
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      <FieldError match={invalid}>{messages.join(" ")}</FieldError>
    </FieldRoot>
  );
};

const SubmitButton = ({
  label,
  pendingLabel,
}: {
  label: string;
  pendingLabel: string;
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
        <Button type="submit" disabled={!canSubmit || isSubmitting}>
          {isSubmitting ? pendingLabel : label}
        </Button>
      )}
    </form.Subscribe>
  );
};

export const { useAppForm, withForm, withFieldGroup } = createFormHook({
  fieldComponents: { TextField },
  fieldContext,
  formComponents: { SubmitButton },
  formContext,
});
