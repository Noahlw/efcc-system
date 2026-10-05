"use client";

import { Button as BaseButton } from "@base-ui/react/button";

export type ButtonVariant = "primary" | "secondary";

const variantClass: Record<ButtonVariant, string> = {
  primary:
    "min-h-[52px] bg-primary text-primary-foreground hover:bg-primary-hover disabled:hover:bg-primary",
  secondary:
    "min-h-12 bg-surface text-foreground border border-input-border hover:bg-muted disabled:hover:bg-surface",
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
    className={`text-body inline-flex min-w-11 items-center justify-center gap-2 rounded-md px-4 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${variantClass[variant]} ${className}`}
    {...props}
  />
);
