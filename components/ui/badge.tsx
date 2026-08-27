import {
  cva,
  type VariantProps,
} from "class-variance-authority";

import type {
  HTMLAttributes,
} from "react";

import {
  cn,
} from "../../lib/utils";

const badgeVariants =
  cva(
    "inline-flex items-center rounded-[var(--radius-sm)] px-2 py-0.5 text-xs font-medium",
    {
      variants: {
        tone: {
          neutral:
            "bg-[var(--surface-sunken)] text-[var(--text-secondary)]",

          // brand-800, not brand-700: brand-700 on brand-100 measures
          // 4.38:1 (below WCAG AA's 4.5:1); brand-800 clears it at
          // 6.38:1. See docs/adr/ADR-0015-status-badge-contrast-fix.md.
          brand:
            "bg-[var(--color-brand-100)] text-[var(--color-brand-800)]",

          success:
            "bg-[var(--color-success-100)] text-[var(--color-success-700)]",

          warning:
            "bg-[var(--color-warning-100)] text-[var(--color-warning-700)]",

          danger:
            "bg-[var(--color-danger-100)] text-[var(--color-danger-700)]",
        },
      },

      defaultVariants: {
        tone:
          "neutral",
      },
    },
  );

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge(
  {
    className,
    tone,
    ...props
  }: BadgeProps,
) {
  return (
    <span
      className={cn(
        badgeVariants(
          {
            tone,
          },
        ),
        className,
      )}
      {...props}
    />
  );
}
