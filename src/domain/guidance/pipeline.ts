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

import type {
  GuidanceItem,
} from "./types";

/**
 * v2.1.1's own pipeline, applied in exactly this order: "1. derive
 * items from authoritative state 2. rank 3. deduplicate 4. apply
 * dismissal semantics." Returns the COMPLETE ranked/deduplicated/
 * post-dismissal set -- uncapped.
 *
 * Step 1 (derive) is the CALLER's job -- rule-specific derivers (e.g.
 * i19.ts) read real domain state and produce candidate GuidanceItems.
 * Aggregation (a separate, explicitly-specified mechanic collapsing
 * 4+ same-(rule,parent) raw signals into one item) runs here, first,
 * before ranking -- an aggregate's own priority/impact must already be
 * resolved (most-severe-member) before it can be ranked as an ordinary
 * item alongside everything else.
 *
 * 2026-09-05 (S2 remediation, B1, fresh Opus 5 review). Capping to the
 * dashboard's 3-card tile USED to be the pipeline's own last step, so
 * "the complete ranked set" existed nowhere -- there was no way for
 * /attention (app/attention/page.tsx) to show everything a REQUIRED
 * overflow control links to. Capping is now the DASHBOARD's own
 * explicit step (src/domain/guidance/cap.ts, called from
 * derive-dashboard-guidance.ts), applied on top of this function's
 * full result; /attention (derive-attention-guidance.ts) calls this
 * same function and renders its result uncapped. "Preserve deterministic
 * guidance semantics" -- both views are the same ranked collection,
 * never two independently-derived lists that could disagree.
 */
export function runGuidancePipeline(
  candidateItems: GuidanceItem[],
  dismissedItemIds: ReadonlySet<string>,
): GuidanceItem[] {
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

  return applyGuidanceDismissals(
    deduplicated,
    dismissedItemIds,
  );
}
