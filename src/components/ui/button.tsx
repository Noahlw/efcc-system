"use client";

import { Button as BaseButton } from "@base-ui/react/button";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";

const buttonClasses = cva(
  "r11-button text-label inline-flex max-w-full min-w-11 items-center justify-center gap-[10px] rounded-[10px] leading-[1.4] font-[650] wrap-anywhere transition-colors disabled:cursor-default disabled:opacity-[0.53]",
  {
    defaultVariants: { variant: "primary" },
    variants: {
      variant: {
        danger:
          "border-danger bg-danger hover:bg-danger/90 disabled:hover:bg-danger min-h-[3.25rem] border px-5 py-3 text-white lg:min-h-12",
        primary:
          "border-primary bg-primary text-primary-foreground hover:bg-primary-hover disabled:hover:bg-primary min-h-[3.25rem] border px-5 py-3 lg:min-h-12",
        quiet:
          "text-primary hover:bg-background min-h-11 border-0 bg-transparent p-0 disabled:hover:bg-transparent",
        secondary:
          "bg-surface text-primary hover:bg-background disabled:hover:bg-surface min-h-12 border border-[#c4d1cc] px-5 py-3",
      },
    },
  }
);

export type ButtonVariant = NonNullable<
  VariantProps<typeof buttonClasses>["variant"]
>;

export type ButtonProps = Omit<
  React.ComponentProps<typeof BaseButton>,
  "className"
> & {
  variant?: ButtonVariant;
  className?: string;
};

/** Base UI-backed button; 44px minimum target and a visible focus ring. */
export const Button = ({ variant, className, ...props }: ButtonProps) => (
  <BaseButton className={buttonClasses({ className, variant })} {...props} />
);
