"use client";

import { Input as BaseInput } from "@base-ui/react/input";

/** Token-styled field: 52px height, visible focus, and 17px text. */
export const Input = ({
  className = "",
  ...props
}: React.ComponentProps<"input">) => (
  <BaseInput
    className={`border-input-border bg-surface text-foreground focus-visible:border-primary aria-invalid:border-danger text-body min-h-[52px] w-full rounded-md border px-3 outline-none ${className}`}
    {...props}
  />
);
