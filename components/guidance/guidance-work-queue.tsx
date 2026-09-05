import Link from "next/link";

import {
  Badge,
  type BadgeProps,
} from "../ui/badge";

import {
  dismissGuidanceItemAction,
} from "../../app/guidance-actions";

import type {
  GuidanceCapResult,
} from "../../src/domain/guidance/cap";

import type {
  GuidanceImpact,
  GuidancePriority,
} from "../../src/domain/guidance/types";

/**
 * SME Experience v2.1.1, S2: the dashboard work queue -- "3 things
 * need your attention," not a static marketing tile. Renders whatever
 * deriveDashboardGuidance already ranked/deduplicated/dismissed/capped
 * (src/application/guidance/derive-dashboard-guidance.ts); this
 * component has no priority/ordering logic of its own.
 *
 * Priority/impact are NOT part of the StatusKey vocabulary
 * (src/domain/status-vocabulary) -- they are prioritisation metadata
 * about a guidance item, not a domain entity's own status/provenance,
 * so they are not run through StatusBadge/data-status-key. They ARE
 * rendered as plain, honest labels via the same Badge component
 * everything else uses, matching the precedent app/status/page.tsx's
 * own DATASET_STATUS_TONE already set for a status concept outside
 * that vocabulary's ten axes (confirmed exempt by
 * tests/architecture/status-vocabulary-enforcement.test.ts's own
 * scoping, which targets those ten source types by name).
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

export function GuidanceWorkQueue(
  {
    result,
  }: {
    result: GuidanceCapResult;
  },
) {
  if (result.visible.length === 0) {
    return (
      <p className="mb-6 text-sm text-[var(--text-tertiary)]">
        Nothing needs your attention right now.
      </p>
    );
  }

  return (
    <section
      aria-label="Needs your attention"
      className="mb-6 flex flex-col gap-2"
    >
      <h2 className="text-sm font-medium text-[var(--text-primary)]">
        Needs your attention
        {result.requiredOverflowCount > 0 ? (
          <span className="ml-1.5 font-normal text-[var(--text-tertiary)]">
            (+{result.requiredOverflowCount} more required)
          </span>
        ) : null}
      </h2>

      <ul className="flex flex-col gap-2">
        {result.visible.map(
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
    </section>
  );
}
