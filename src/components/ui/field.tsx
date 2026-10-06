"use client";

import { Field } from "@base-ui/react/field";

export const FieldRoot = Field.Root;

export const FieldLabel = ({
  className = "",
  ...props
}: React.ComponentProps<typeof Field.Label>) => (
  <Field.Label
    className={`text-foreground text-label font-medium ${className}`}
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
  <Field.Error className={`text-danger text-sm ${className}`} {...props} />
);

export const FieldDescription = ({
  className = "",
  ...props
}: React.ComponentProps<typeof Field.Description>) => (
  <Field.Description
    className={`text-muted-foreground text-sm ${className}`}
    {...props}
  />
);
