import type {
  SelectHTMLAttributes,
} from "react";

import {
  cn,
} from "../../lib/utils";

export interface SelectProps
  extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;

  // Same purpose-built pairing Input.errorId already established --
  // see that file's own doc comment.
  errorId?: string;
}

/**
 * Native <select>, matching Input's exact prop shape and styling
 * convention (SME plan §7.5) -- 44px tall below `md` (a select is
 * exactly the kind of small tap target the plan's mobile DoD calls
 * out), the ordinary Input height from `md` up.
 */
export function Select(
  {
    className,
    invalid,
    errorId,
    ...props
  }: SelectProps,
) {
  return (
    <select
      className={cn(
        "h-11 w-full rounded-[var(--radius-md)] border bg-[var(--surface-page)] " +
          "px-3 text-sm text-[var(--text-primary)] " +
          "transition-colors duration-150 " +
          "disabled:cursor-not-allowed disabled:opacity-50 " +
          "focus-visible:outline-2 focus-visible:outline-offset-2 " +
          "md:h-10",
        invalid
          ? "border-[var(--color-danger-600)]"
          : "border-[var(--border-default)] hover:border-[var(--border-strong)]",
        className,
      )}
      aria-invalid={invalid}
      aria-describedby={invalid ? errorId : undefined}
      {...props}
    />
  );
}
