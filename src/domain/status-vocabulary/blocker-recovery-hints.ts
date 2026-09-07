import type {
  CompletenessBlocker,
} from "../declarations/types";

import {
  recalculateAvailability,
  redetermineAvailability,
} from "../shipments/recovery-availability";

/**
 * 2026-09-07 (S5 review round 13 remediation, findings S5R13-A-1,
 * S5R13-B-1, S5R13-D-1). The ONE shared source of the recovery hint
 * shown alongside a CompletenessBlocker -- consulted by every surface
 * that renders one (completeness-report-card.tsx's blockers table,
 * declaration-actions.tsx's MarkReadyForm inline blockers list) instead
 * of each independently re-deriving (and, per that round's findings,
 * getting wrong or omitting) its own hedge.
 *
 * Replaces the old per-surface pattern of hedging only
 * LINE_DATASET_SUPERSEDED/LINE_CALCULATION_ENGINE_OUTDATED off a coarse,
 * declaration-wide "is ANY member shipment LOCKED" boolean --
 * LINE_CALCULATION_STALE had NEVER received any hedge in 12 prior
 * rounds, and MarkReadyForm's blockers list had never received a hedge
 * for ANY reason (git history: no S5 round had ever touched that file).
 * Now driven entirely by each blocker's OWN shipment_status (and, for
 * LINE_CALCULATION_STALE, its own calculation_engine_is_current -- see
 * recalculateAvailability's own doc comment for why that specific fact,
 * not the blocker reason itself, decides READY-recalculate availability)
 * via the shared recovery-availability.ts helpers every other
 * recalculate/redetermine guidance surface in this codebase now uses.
 *
 * `shipment_status`/`calculation_engine_is_current` are absent (not
 * merely null) on a completeness_report JSON blob persisted before this
 * fix landed -- completeness_report is a frozen jsonb snapshot, so an
 * old declaration's cached report can still be read back with the old
 * shape. `!blocker.shipment_status` (not `=== null`) deliberately
 * covers both `null` (the type's own period-level case) and `undefined`
 * (old data), falling back to showing no hint rather than guessing.
 */
export function blockerRecoveryHint(
  blocker: CompletenessBlocker,
): string | null {
  if (!blocker.shipment_status) {
    return null;
  }

  const availability =
    blocker.reason === "LINE_DATASET_SUPERSEDED"
      ? redetermineAvailability(blocker.shipment_status)
      : blocker.reason === "LINE_CALCULATION_ENGINE_OUTDATED"
        ? recalculateAvailability(blocker.shipment_status, false)
        : blocker.reason === "LINE_CALCULATION_STALE"
          ? recalculateAvailability(
              blocker.shipment_status,
              // Conservative fallback for old data missing this field
              // (see this function's own doc comment) -- `true` is the
              // safe assumption: it only ever produces REQUIRES_REOPEN
              // where the real answer might have been AVAILABLE, never
              // the reverse.
              blocker.calculation_engine_is_current ?? true,
            )
          : null;

  if (availability === null || availability.status === "AVAILABLE") {
    return null;
  }

  const verb =
    blocker.reason === "LINE_DATASET_SUPERSEDED" ? "redetermined" : "recalculated";

  if (availability.status === "BLOCKED") {
    return availability.blockedStatus === "LOCKED"
      ? `If this shipment has already been LOCKED (the routine case for an amendment), it cannot be ${verb} through the normal declaration flow -- contact support.`
      : "This shipment has been voided and can never be edited or reopened. Contact support.";
  }

  return `This shipment is READY -- reopen it first, then ${verb === "redetermined" ? "redetermine" : "recalculate"} this line.`;
}
