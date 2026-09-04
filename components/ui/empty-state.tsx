import type {
  ComponentType,
  ReactNode,
} from "react";

import {
  cn,
} from "../../lib/utils";

export interface EmptyStateProps {
  icon?: ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

/**
 * Formalises the "nothing here yet" pattern already repeated ad hoc
 * across this codebase (e.g. EmissionDataList's own
 * `&lt;p className="p-4 text-sm text-[var(--text-secondary)]"&gt;` for a
 * zero-record org) into one primitive, so a future screen reaches for
 * this instead of re-inventing the same three lines of Tailwind (SME
 * plan §7.5). Does not replace any EXISTING inline empty-state text --
 * migrating those is a separate, later change, not implied by adding
 * this component.
 */
export function EmptyState(
  {
    icon: Icon,
    title,
    description,
    action,
    className,
  }: EmptyStateProps,
) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 rounded-[var(--radius-md)] border border-dashed border-[var(--border-default)] p-8 text-center",
        className,
      )}
    >
      {Icon ? (
        <Icon
          className="size-8 text-[var(--text-tertiary)]"
          aria-hidden="true"
        />
      ) : null}

      <p className="text-sm font-medium text-[var(--text-primary)]">
        {title}
      </p>

      {description ? (
        <p className="max-w-sm text-sm text-[var(--text-secondary)]">
          {description}
        </p>
      ) : null}

      {action ? (
        <div className="mt-2">
          {action}
        </div>
      ) : null}
    </div>
  );
}
