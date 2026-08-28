import type {
  HTMLAttributes,
} from "react";

import {
  cn,
} from "../../lib/utils";

/**
 * role="alert" so assistive tech announces the error the moment it
 * appears (form validation failure, failed sign-in, etc.) without the
 * user needing to discover it visually.
 */
export function FieldError(
  {
    className,
    children,
    ...props
  }: HTMLAttributes<HTMLParagraphElement>,
) {
  if (!children) {
    return null;
  }

  return (
    <p
      role="alert"
      className={cn(
        "text-sm text-[var(--color-danger-700)]",
        className,
      )}
      {...props}
    >
      {children}
    </p>
  );
}
