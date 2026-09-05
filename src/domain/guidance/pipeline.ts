import {
  aggregateGuidanceItems,
} from "./aggregate";

import {
  rankGuidanceItems,
} from "./rank";

import {
  deduplicateGuidanceItems,
} from "./dedup";

import {
  applyGuidanceDismissals,
} from "./dismiss";

import {
  capGuidanceItems,
  type GuidanceCapResult,
} from "./cap";

import type {
  GuidanceItem,
} from "./types";

/**
 * v2.1.1's own pipeline, applied in exactly this order:
 * "1. derive items from authoritative state 2. rank 3. deduplicate
 * 4. apply dismissal semantics 5. apply cap 6. preserve REQUIRED
 * visibility / overflow control."
 *
 * Step 1 (derive) is the CALLER's job -- rule-specific derivers (e.g.
 * i19.ts) read real domain state and produce candidate GuidanceItems.
 * Aggregation (a separate, explicitly-specified mechanic collapsing
 * 4+ same-(rule,parent) raw signals into one item) runs here, first,
 * before ranking -- an aggregate's own priority/impact must already be
 * resolved (most-severe-member) before it can be ranked as an ordinary
 * item alongside everything else. Steps 5/6 are one mechanism
 * (capGuidanceItems already preserves REQUIRED visibility as part of
 * capping, not as a separate pass).
 */
export function runGuidancePipeline(
  candidateItems: GuidanceItem[],
  dismissedItemIds: ReadonlySet<string>,
): GuidanceCapResult {
  const aggregated =
    aggregateGuidanceItems(
      candidateItems,
    );

  const ranked =
    rankGuidanceItems(
      aggregated,
    );

  const deduplicated =
    deduplicateGuidanceItems(
      ranked,
    );

  const afterDismissals =
    applyGuidanceDismissals(
      deduplicated,
      dismissedItemIds,
    );

  return capGuidanceItems(
    afterDismissals,
  );
}
