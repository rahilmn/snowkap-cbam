import {
  cva,
  type VariantProps,
} from "class-variance-authority";

import type {
  ButtonHTMLAttributes,
} from "react";

import {
  Loader2,
} from "lucide-react";

import {
  cn,
} from "../../lib/utils";

const buttonVariants =
  cva(
    "inline-flex items-center justify-center gap-2 rounded-[var(--radius-md)] " +
      "text-sm font-medium transition-colors duration-150 " +
      "disabled:pointer-events-none disabled:opacity-50 " +
      "focus-visible:outline-2 focus-visible:outline-offset-2",
    {
      variants: {
        variant: {
          primary:
            "bg-[var(--accent-brand)] text-[var(--text-on-brand)] " +
            "hover:bg-[var(--accent-brand-hover)]",

          secondary:
            "border border-[var(--border-strong)] bg-[var(--surface-raised)] " +
            "text-[var(--text-primary)] hover:bg-[var(--surface-sunken)]",

          ghost:
            "text-[var(--text-primary)] hover:bg-[var(--surface-sunken)]",

          destructive:
            "bg-[var(--color-danger-600)] text-white " +
            "hover:bg-[var(--color-danger-700)]",
        },

        size: {
          sm:
            "h-8 px-3",

          md:
            "h-9 px-4",

          lg:
            "h-11 px-5 text-base",
        },
      },

      defaultVariants: {
        variant:
          "primary",

        size:
          "md",
      },
    },
  );

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export function Button(
  {
    className,
    variant,
    size,
    loading,
    disabled,
    children,
    ...props
  }: ButtonProps,
) {
  return (
    <button
      className={cn(
        buttonVariants(
          {
            variant,
            size,
          },
        ),
        className,
      )}
      disabled={disabled ?? loading}
      {...props}
    >
      {loading ? (
        <Loader2
          className="size-4 animate-spin"
          aria-hidden="true"
        />
      ) : null}

      {children}
    </button>
  );
}
