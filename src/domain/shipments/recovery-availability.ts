import type {
  ShipmentStatus,
} from "./types";

/**
 * S5 review round 13 remediation (findings S5R13-A-1 x2, S5R13-B-1,
 * S5R13-C-1, S5R13-D-1, S5R13-E-1). The single authoritative answer to
 * "given this shipment's status, can [recalculate a line's emissions /
 * redetermine a line] actually be done right now, or does it need a
 * reopen first, or is it permanently impossible" -- consulted by every
 * UI surface that renders a "recalculate"/"redetermine" instruction or
 * control, instead of each one independently re-deriving (and, per this
 * round's findings, getting wrong) its own hedge.
 *
 * - AVAILABLE: the action can be taken directly, right now.
 * - REQUIRES_REOPEN: the shipment must be reopened to DRAFT first (an
 *   ordinary, always-available action for a READY shipment) before the
 *   action can be taken.
 * - BLOCKED: permanently impossible -- the shipment is LOCKED or VOID,
 *   both terminal per transitionShipment's own doc comment
 *   (lifecycle.ts). `blockedStatus` names which, since existing copy
 *   throughout this codebase gives LOCKED and VOID distinct wording
 *   ("contact support" vs "this shipment has been voided").
 */
export type RecoveryAvailability =
  | { status: "AVAILABLE" }
  | { status: "REQUIRES_REOPEN" }
  | { status: "BLOCKED"; blockedStatus: "LOCKED" | "VOID" };

/**
 * Redetermining a line (editing its classification/origin/quantity, or
 * switching between an ACTUAL and a DEFAULT determination) is gated
 * purely by whether the shipment is currently DRAFT -- shipment_lines is
 * DRAFT-only writable (RLS policy shipment_lines_update_parent_draft_only
 * plus the app.enforce_shipment_lines_parent_editable trigger,
 * migration 20260904090000). This is the ALREADY-correct 3-way pattern
 * multiple surfaces independently arrived at for LINE_DATASET_SUPERSEDED
 * (why-this-number-panel.tsx's datasetSuperseded block, the shipment
 * page's datasetSupersededLineCount caption, Reports page's
 * DatasetSupersededLinesCard) -- extracted here as the one shared
 * definition so it can also be applied to the surfaces round 13 found
 * missing it (completeness-report-card.tsx, declaration-actions.tsx,
 * IncompleteLinesCard), rather than re-derived a fourth/fifth/sixth
 * time.
 */
export function redetermineAvailability(
  shipmentStatus: ShipmentStatus,
): RecoveryAvailability {
  if (shipmentStatus === "LOCKED" || shipmentStatus === "VOID") {
    return {
      status: "BLOCKED",
      blockedStatus: shipmentStatus,
    };
  }

  if (shipmentStatus === "READY") {
    return {
      status: "REQUIRES_REOPEN",
    };
  }

  return {
    status: "AVAILABLE",
  };
}

/**
 * Recalculating a line's emissions on a READY (non-LOCKED/VOID)
 * shipment is gated by a SINGLE fact, and it is NOT "why is the line
 * stale" -- it is whether a calculation_results row already exists for
 * this line at the currently-running engine version. That is the exact
 * and only condition public.record_calculation_result's own READY
 * carve-out (supabase/migrations/20260906210000_s5_calculation_result_refuses_ready.sql,
 * the `exists (select 1 from calculation_results cr where
 * cr.line_id = p_line_id and cr.engine_version = p_engine_version)`
 * clause) checks, BEFORE it ever looks at whether the submitted
 * determination matches the line's current one. Concretely, read
 * straight from that SQL:
 *
 * - A row already exists at the current engine version (this is exactly
 *   what `calculation_engine_is_current` means -- see
 *   completeness.ts's CompletenessCheckLine and
 *   compute-declaration-draft-facts.ts's own engine_version !==
 *   current_engine_version() check, computed from the SAME latest-row
 *   fact) => the carve-out's `exists(...)` is true => READY refuses the
 *   write with SHIPMENT_NOT_EDITABLE, full stop -- REGARDLESS of
 *   whether the line's determination is stale, current, or anything
 *   else. This is the common case a redetermine-without-recalculate
 *   leaves behind (S5R13-A-1's own live repro: calc at 1.4.0, redetermine,
 *   mark READY, resubmit at the still-current 1.4.0 -> refused).
 * - No row exists yet at the current engine version (the line's latest
 *   calculation predates an engine bump, i.e. `calculation_engine_is_current`
 *   is false) => the carve-out's `exists(...)` is false => the write
 *   proceeds to the ordinary DETERMINATION_MISMATCH check, which always
 *   passes because the caller always submits the line's own current,
 *   freshly-read determination => the recalculation SUCCEEDS directly,
 *   with no reopen needed. This holds even for a line that is ALSO
 *   determination-stale (i.e. would be reported as LINE_CALCULATION_STALE,
 *   not LINE_CALCULATION_ENGINE_OUTDATED, by completeness.ts's own
 *   calculation_is_current-before-calculation_engine_is_current branch
 *   order) -- completeness.ts's blocker REASON and this function's
 *   AVAILABILITY answer are two different computations over related but
 *   not identical facts, and must not be conflated. This is the reason
 *   this function takes `calculationEngineIsCurrent` as its one
 *   staleness-related input, NOT a "why is it stale" reason enum the
 *   way round 13's own findings proposed (a two-value ENGINE_OUTDATED /
 *   DETERMINATION_STALE reason would have gotten the combined case --
 *   old engine version AND a stale determination -- wrong, reporting
 *   REQUIRES_REOPEN for a line the RPC would actually recalculate
 *   directly). Verified against the live migration SQL and live-tested
 *   against real Postgres for exactly this combined case as part of
 *   this remediation's regression suite
 *   (tests/integration/calculation-result-ready-shipment-lock.test.ts).
 */
export function recalculateAvailability(
  shipmentStatus: ShipmentStatus,
  calculationEngineIsCurrent: boolean,
): RecoveryAvailability {
  if (shipmentStatus === "LOCKED" || shipmentStatus === "VOID") {
    return {
      status: "BLOCKED",
      blockedStatus: shipmentStatus,
    };
  }

  if (shipmentStatus === "READY") {
    return calculationEngineIsCurrent
      ? { status: "REQUIRES_REOPEN" }
      : { status: "AVAILABLE" };
  }

  return {
    status: "AVAILABLE",
  };
}
