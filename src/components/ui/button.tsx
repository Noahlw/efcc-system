"use client";

import { Button as BaseButton } from "@base-ui/react/button";

export type ButtonVariant = "danger" | "primary" | "quiet" | "secondary";

const variantClass: Record<ButtonVariant, string> = {
  danger:
    "min-h-[3.25rem] bg-danger px-4 py-0 text-white hover:bg-danger/90 disabled:hover:bg-danger",
  primary:
    "min-h-[3.25rem] bg-primary px-4 py-0 text-primary-foreground hover:bg-primary-hover disabled:hover:bg-primary",
  quiet:
    "min-h-11 bg-transparent p-0 text-foreground border-0 hover:bg-muted disabled:hover:bg-transparent",
  secondary:
    "min-h-12 bg-surface text-foreground border border-input-border px-4 py-0 hover:bg-muted disabled:hover:bg-surface",
};

export type ButtonProps = Omit<
  React.ComponentProps<typeof BaseButton>,
  "className"
> & {
  variant?: ButtonVariant;
  className?: string;
};

/** Base UI-backed button; 44px minimum target and a visible focus ring. */
export const Button = ({
  variant = "primary",
  className = "",
  ...props
}: ButtonProps) => (
  <BaseButton
    className={`text-body inline-flex max-w-full min-w-11 items-center justify-center gap-2 rounded-md font-medium wrap-anywhere transition-colors disabled:cursor-default disabled:opacity-[0.53] ${variantClass[variant]} ${className}`}
    {...props}
  />
);
