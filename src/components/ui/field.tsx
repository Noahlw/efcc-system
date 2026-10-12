"use client";

import { Field } from "@base-ui/react/field";

export const FieldRoot = ({
  className = "",
  ...props
}: React.ComponentProps<typeof Field.Root>) => (
  <Field.Root
    className={`flex min-w-0 flex-col gap-2 ${className}`}
    {...props}
  />
);

export const FieldLabel = ({
  className = "",
  ...props
}: React.ComponentProps<typeof Field.Label>) => (
  <Field.Label
    className={`text-foreground text-label font-semibold ${className}`}
    {...props}
  />
);

export const FieldControl = ({
  className = "",
  ...props
}: React.ComponentProps<typeof Field.Control>) => (
  <Field.Control className={className} {...props} />
);

export const FieldError = ({
  className = "",
  ...props
}: React.ComponentProps<typeof Field.Error>) => (
  <Field.Error className={`text-danger text-meta ${className}`} {...props} />
);

export const FieldDescription = ({
  className = "",
  ...props
}: React.ComponentProps<typeof Field.Description>) => (
  <Field.Description
    className={`text-muted-foreground text-meta ${className}`}
    {...props}
  />
);
