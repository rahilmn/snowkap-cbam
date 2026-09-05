import Link from "next/link";

import {
  Badge,
  type BadgeProps,
} from "../ui/badge";

import {
  dismissGuidanceItemAction,
} from "../../app/guidance-actions";

import type {
  GuidanceImpact,
  GuidanceItem,
  GuidancePriority,
} from "../../src/domain/guidance/types";

/**
 * 2026-09-05 (S2 remediation, B1, fresh Opus 5 review). The per-item
 * card markup, extracted out of guidance-work-queue.tsx so the
 * dashboard's own capped tile and /attention's complete, uncapped view
 * (app/attention/page.tsx) render every item identically -- one
 * definition of what a guidance item looks like, not two that could
 * drift apart.
 *
 * Priority/impact are NOT part of the StatusKey vocabulary
 * (src/domain/status-vocabulary) -- see guidance-work-queue.tsx's own
 * (unchanged) comment on why they're plain Badge labels rather than
 * StatusBadge/data-status-key.
 */

const PRIORITY_LABEL: Record<GuidancePriority, string> =
  {
    REQUIRED: "Required",
    RECOMMENDED: "Recommended",
    OPTIONAL: "Optional",
  };

const PRIORITY_TONE: Record<GuidancePriority, BadgeProps["tone"]> =
  {
    REQUIRED: "danger",
    RECOMMENDED: "warning",
    OPTIONAL: "neutral",
  };

const IMPACT_LABEL: Record<GuidanceImpact, string> =
  {
    FILING: "Filing",
    INTEGRITY: "Integrity",
    APPROVAL: "Approval",
    DATA_ENTRY: "Data entry",
    SETUP: "Setup",
    INFO: "Info",
  };

export function GuidanceItemList(
  {
    items,
  }: {
    items: GuidanceItem[];
  },
) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map(
        (item) => (
          <li
            key={item.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-raised)] p-3"
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              {item.href ? (
                <Link
                  href={item.href}
                  className="text-sm font-medium text-[var(--text-primary)] hover:text-[var(--accent-interactive)]"
                >
                  {item.title}
                </Link>
              ) : (
                <span className="text-sm font-medium text-[var(--text-primary)]">
                  {item.title}
                </span>
              )}

              <span className="text-xs text-[var(--text-tertiary)]">
                {item.reason}
              </span>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <Badge tone={PRIORITY_TONE[item.priority]}>
                {PRIORITY_LABEL[item.priority]}
              </Badge>

              <Badge tone="neutral">
                {IMPACT_LABEL[item.impact]}
              </Badge>

              {item.priority !== "REQUIRED" ? (
                <form action={dismissGuidanceItemAction}>
                  <input
                    type="hidden"
                    name="itemKey"
                    value={item.id}
                  />

                  <button
                    type="submit"
                    className="rounded-[var(--radius-sm)] px-2 py-1 text-xs font-medium text-[var(--text-tertiary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-secondary)]"
                    aria-label={`Dismiss: ${item.title}`}
                  >
                    Dismiss
                  </button>
                </form>
              ) : null}
            </div>
          </li>
        ),
      )}
    </ul>
  );
}
