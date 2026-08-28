import type {
  InputHTMLAttributes,
} from "react";

import {
  cn,
} from "../../lib/utils";

export interface InputProps
  extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export function Input(
  {
    className,
    invalid,
    ...props
  }: InputProps,
) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-[var(--radius-md)] border bg-[var(--surface-page)] " +
          "px-3 text-sm text-[var(--text-primary)] " +
          "placeholder:text-[var(--text-tertiary)] " +
          "transition-colors duration-150 " +
          "disabled:cursor-not-allowed disabled:opacity-50 " +
          "focus-visible:outline-2 focus-visible:outline-offset-2",
        invalid
          ? "border-[var(--color-danger-600)]"
          : "border-[var(--border-default)] hover:border-[var(--border-strong)]",
        className,
      )}
      aria-invalid={invalid}
      {...props}
    />
  );
}
