import type {
  GuidanceImpact,
  GuidanceItem,
  GuidancePriority,
} from "./types";

/**
 * v2.1.1 fixes the PRIMARY ordering exactly: REQUIRED before
 * RECOMMENDED before OPTIONAL. The secondary tiebreak (impact
 * severity, then sortKey) is NOT part of the v2.1.1 contract handed to
 * this implementation -- it exists only to make ranking fully
 * deterministic, in the order impact's own six members were listed
 * (FILING, INTEGRITY, APPROVAL, DATA_ENTRY, SETUP, INFO), which reads
 * as a severity ordering but is a reasonable default, not a specified
 * rule.
 */
const PRIORITY_RANK: Record<GuidancePriority, number> =
  {
    REQUIRED: 0,
    RECOMMENDED: 1,
    OPTIONAL: 2,
  };

const IMPACT_RANK: Record<GuidanceImpact, number> =
  {
    FILING: 0,
    INTEGRITY: 1,
    APPROVAL: 2,
    DATA_ENTRY: 3,
    SETUP: 4,
    INFO: 5,
  };

export function compareGuidanceItems(
  a: GuidanceItem,
  b: GuidanceItem,
): number {
  const priorityDelta =
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];

  if (priorityDelta !== 0) {
    return priorityDelta;
  }

  const impactDelta =
    IMPACT_RANK[a.impact] - IMPACT_RANK[b.impact];

  if (impactDelta !== 0) {
    return impactDelta;
  }

  return a.sortKey.localeCompare(
    b.sortKey,
  );
}

/**
 * Pure, non-mutating sort. Callers pass the result of aggregate.ts's
 * own output (or ungrouped derived items) -- ranking has no opinion on
 * where an item came from.
 */
export function rankGuidanceItems(
  items: GuidanceItem[],
): GuidanceItem[] {
  return [...items].sort(
    compareGuidanceItems,
  );
}
