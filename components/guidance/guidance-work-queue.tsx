import Link from "next/link";

import {
  GuidanceItemList,
} from "./guidance-item-list";

import type {
  GuidanceDashboardResult,
} from "../../src/application/guidance/derive-dashboard-guidance";

/**
 * SME Experience v2.1.1, S2: the dashboard work queue -- "3 things
 * need your attention," not a static marketing tile. Renders whatever
 * deriveDashboardGuidance already ranked/deduplicated/dismissed/capped
 * (src/application/guidance/derive-dashboard-guidance.ts); this
 * component has no priority/ordering logic of its own. Per-item card
 * markup lives in guidance-item-list.tsx, shared with /attention's
 * complete, uncapped view (app/attention/page.tsx).
 */
export function GuidanceWorkQueue(
  {
    result,
  }: {
    result: GuidanceDashboardResult;
  },
) {
  // 2026-09-05 (S2 remediation, B3, fresh Opus 5 review). UNAVAILABLE
  // is a genuine fetch failure -- rendered distinctly from a real empty
  // queue, never silently collapsed into "Nothing needs your attention
  // right now," which would be a false all-clear on a compliance tool.
  if (result.status === "UNAVAILABLE") {
    return (
      <p
        role="alert"
        className="mb-6 text-sm text-[var(--color-danger-700)]"
      >
        Couldn&apos;t load your guidance right now. Try refreshing the
        page.
      </p>
    );
  }

  const cap =
    result.cap;

  if (cap.visible.length === 0) {
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
      </h2>

      <GuidanceItemList
        items={cap.visible}
      />

      {/*
        2026-09-05 (S2 remediation, B1, fresh Opus 5 review). The
        overflow control is part of the VISIBLE set, distinct from
        `cap.visible`'s own (always at most 3) cards -- it never
        inflates the card count, and it is always reachable rather than
        a silent drop. requiredOverflowCount takes priority over a
        generic "See all": hidden REQUIRED work is the one case that
        must never look like "nothing else to do here."
      */}
      {cap.requiredOverflowCount > 0 ? (
        <Link
          href="/attention#required"
          className="rounded-[var(--radius-md)] border border-[var(--color-danger-300)] bg-[var(--color-danger-50)] p-3 text-sm font-medium text-[var(--color-danger-700)] hover:bg-[var(--color-danger-100)]"
        >
          {cap.requiredOverflowCount === 1
            ? "1 more required item needs your attention"
            : `${cap.requiredOverflowCount} more required items need your attention`}
          {" →"}
        </Link>
      ) : cap.hiddenCount > 0 ? (
        <Link
          href="/attention"
          className="text-sm font-medium text-[var(--accent-interactive)] hover:text-[var(--accent-interactive-hover)]"
        >
          See all →
        </Link>
      ) : null}
    </section>
  );
}
