import type {
  InputHTMLAttributes,
} from "react";

import {
  cn,
} from "../../lib/utils";

export interface InputProps
  extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;

  // The id of this field's own <FieldError> (components/ui/field-error.tsx)
  // -- kept as a distinct, purpose-built prop rather than asking every
  // caller to remember to type out a raw `aria-describedby` by hand,
  // so a field only ever gets programmatically associated with its own
  // error message when it is genuinely `invalid`, never left dangling
  // when the field is currently valid (a caller-supplied
  // `aria-describedby` still passes through untouched via `...props`
  // for any other, non-error use).
  errorId?: string;
}

export function Input(
  {
    className,
    invalid,
    errorId,
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
      aria-describedby={invalid ? errorId : undefined}
      {...props}
    />
  );
}
