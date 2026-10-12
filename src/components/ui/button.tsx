"use client";

import { Button as BaseButton } from "@base-ui/react/button";

export type ButtonVariant = "danger" | "primary" | "quiet" | "secondary";

const variantClass: Record<ButtonVariant, string> = {
  danger:
    "min-h-[3.25rem] lg:min-h-12 border border-danger bg-danger px-5 py-3 text-white hover:bg-danger/90 disabled:hover:bg-danger",
  primary:
    "min-h-[3.25rem] lg:min-h-12 border border-primary bg-primary px-5 py-3 text-primary-foreground hover:bg-primary-hover disabled:hover:bg-primary",
  quiet:
    "min-h-11 bg-transparent p-0 text-primary border-0 hover:bg-muted disabled:hover:bg-transparent",
  secondary:
    "min-h-12 bg-surface text-primary border border-[#c4d1cc] px-5 py-3 hover:bg-background disabled:hover:bg-surface",
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
    className={`r11-button text-label inline-flex max-w-full min-w-11 items-center justify-center gap-[10px] rounded-[10px] leading-[1.4] font-[650] wrap-anywhere transition-colors disabled:cursor-default disabled:opacity-[0.53] ${variantClass[variant]} ${className}`}
    {...props}
  />
);
