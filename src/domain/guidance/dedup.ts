import {
  compareGuidanceItems,
} from "./rank";

import type {
  GuidanceItem,
} from "./types";

/**
 * "Every guidance item must have ... exclusive family" (v2.1.1) --
 * items sharing the same `family` are mutually exclusive; only the
 * highest-priority one survives (tiebreak: impact severity, then
 * sortKey -- the same ordering rank.ts uses, reused via
 * compareGuidanceItems so the two functions can never silently
 * disagree about "most important").
 *
 * Pure, non-mutating. Runs AFTER aggregate.ts (an aggregate's own
 * family is unique to itself, so it is never affected by dedup) and
 * BEFORE dismissal semantics, per v2.1.1's own pipeline ordering:
 * "1. derive 2. rank 3. deduplicate 4. apply dismissal 5. apply cap".
 */
export function deduplicateGuidanceItems(
  items: GuidanceItem[],
): GuidanceItem[] {
  const byFamily =
    new Map<string, GuidanceItem>();

  for (
    const item of items
  ) {
    const existing =
      byFamily.get(
        item.family,
      );

    if (
      !existing ||
      compareGuidanceItems(item, existing) < 0
    ) {
      byFamily.set(
        item.family,
        item,
      );
    }
  }

  return [...byFamily.values()];
}
