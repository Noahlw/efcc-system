"use client";

import { Input as BaseInput } from "@base-ui/react/input";

/** Token-styled text input: 44px target, visible focus, 17px text. */
export const Input = ({
  className = "",
  ...props
}: React.ComponentProps<"input">) => (
  <BaseInput
    className={`border-input-border bg-surface text-foreground focus-visible:border-primary aria-invalid:border-danger min-h-11 w-full rounded-md border px-3 text-base outline-none ${className}`}
    {...props}
  />
);
