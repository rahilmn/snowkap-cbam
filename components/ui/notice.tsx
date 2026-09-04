import type {
  HTMLAttributes,
} from "react";

import {
  Info,
  CheckCircle2,
  AlertTriangle,
  XCircle,
} from "lucide-react";

import {
  cn,
} from "../../lib/utils";

export type NoticeTone =
  | "info"
  | "success"
  | "warning"
  | "danger";

const TONE_CLASSES: Record<NoticeTone, string> =
  {
    info: "border-[var(--border-default)] bg-[var(--surface-sunken)] text-[var(--text-primary)]",
    success: "border-[var(--color-success-300)] bg-[var(--color-success-100)] text-[var(--color-success-700)]",
    warning: "border-[var(--color-warning-300)] bg-[var(--color-warning-100)] text-[var(--color-warning-700)]",
    danger: "border-[var(--color-danger-300)] bg-[var(--color-danger-100)] text-[var(--color-danger-700)]",
  };

const TONE_ICON: Record<NoticeTone, typeof Info> =
  {
    info: Info,
    success: CheckCircle2,
    warning: AlertTriangle,
    danger: XCircle,
  };

export interface NoticeProps
  extends HTMLAttributes<HTMLDivElement> {
  tone?: NoticeTone;
}

/**
 * A standing, block-level message -- distinct from FieldError (one
 * field's own validation message). `role="alert"` only for the
 * negative tone (warning/danger), matching the SME plan's own §7.5
 * spec: an info/success notice is not urgent enough to interrupt a
 * screen reader mid-flow the way FieldError's unconditional
 * role="alert" is for a field the user is actively filling in.
 */
export function Notice(
  {
    tone = "info",
    className,
    children,
    ...props
  }: NoticeProps,
) {
  const Icon =
    TONE_ICON[tone];

  const isNegative =
    tone === "warning" || tone === "danger";

  return (
    <div
      role={isNegative ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-[var(--radius-md)] border p-3 text-sm",
        TONE_CLASSES[tone],
        className,
      )}
      {...props}
    >
      <Icon
        className="mt-0.5 size-4 shrink-0"
        aria-hidden="true"
      />

      <div>
        {children}
      </div>
    </div>
  );
}
