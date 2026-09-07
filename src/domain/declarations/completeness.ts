import type {
  ShipmentId,
  ShipmentLineId,
} from "../shared/ids";

import type {
  IsoTimestamp,
} from "../shared/reporting-period";

import type {
  ShipmentStatus,
} from "../shipments/types";

import type {
  CompletenessBlocker,
  CompletenessReport,
} from "./types";

export interface CompletenessCheckLine {
  line_id: ShipmentLineId;
  line_number: number;
  has_emission_determination: boolean;
  has_calculation_result: boolean;
  // 2026-08-29 (P13 adversarial audit): whether the line's latest
  // calculation_results row's own frozen `determination` still matches
  // the line's CURRENT emission_determination -- meaningless (and never
  // consulted) when has_calculation_result is false, since
  // LINE_NOT_CALCULATED already covers that case. Computed by the
  // caller (compute-declaration-draft-facts.ts), which is the layer
  // that actually has both jsonb values in hand; this module stays a
  // pure boolean-in, blocker-out function exactly as before, never
  // performing the structural comparison itself.
  calculation_is_current: boolean;
  // 2026-09-07 (S5 review round 8, finding S5R8-A-B2). Whether this
  // line's latest calculation_results row's own frozen engine_version
  // still matches the engine version the app currently runs --
  // computed by the caller (compute-declaration-draft-facts.ts, the
  // layer that has both the frozen calculation and the live
  // current_engine_version() fact in hand), the same "caller computes,
  // this module only decides" split calculation_is_current/dataset_is_
  // current already use. Meaningless (and never consulted) when
  // has_calculation_result is false, exactly like calculation_is_current
  // -- LINE_NOT_CALCULATED already covers that case.
  calculation_engine_is_current: boolean;
  // 2026-09-06 (S5 cross-phase hardening). Whether this line's own
  // DEFAULT determination still names a regulatory_datasets row that is
  // currently ACTIVE -- computed by the caller (compute-declaration-
  // draft-facts.ts, the layer that has both the frozen determination
  // and live regulatory state in hand), the same "caller computes,
  // this module only decides" split calculation_is_current already
  // uses. Always `true` for an ACTUAL determination or a line with no
  // determination at all -- this check has no meaning for either, and
  // LINE_NOT_DETERMINED already covers the latter.
  dataset_is_current: boolean;
}

export interface CompletenessCheckShipment {
  shipment_id: ShipmentId;
  shipment_reference: string;
  status: ShipmentStatus;
  lines: CompletenessCheckLine[];
}

/**
 * The pure decision src/application/declarations/compute-declaration-draft-facts.ts
 * exists to feed: given every shipment currently in a period (already
 * fetched -- this function does no I/O of its own, matching
 * transitionShipment's own "the invariant lives in a pure function"
 * shape, src/domain/shipments/lifecycle.ts), name every reason the
 * period isn't ready to file, or report none.
 *
 * A shipment must be READY or LOCKED to count as lockable -- the exact
 * predicate public.record_declaration_filed()'s own SHIPMENTS_NOT_LOCKABLE
 * check applies at filing time (20260829330000, section 4: "s.status in
 * ('READY', 'LOCKED')"). LOCKED is accepted here for the identical
 * reason that RPC accepts it: an amendment's member set legitimately
 * includes shipments the superseded declaration already locked, and
 * this is a preview of what that RPC will accept, not a second,
 * differently-drawn line.
 *
 * A line missing its determination short-circuits before checking
 * has_calculation_result (`continue`, not two separate blockers) --
 * calculate-line.ts itself refuses to calculate an undetermined line
 * (INPUT_UNRESOLVED), so "not calculated" is never an independent fact
 * about such a line, only a restatement of "not determined."
 *
 * `complete` is derived (`blockers.length === 0`), never stored
 * independently, so the two can never drift apart -- a caller that
 * wants to know WHY should read `blockers`, and one that only wants
 * TO/FRO should read `complete`, but there is exactly one underlying
 * fact either way.
 */
export function buildCompletenessReport(
  shipments: CompletenessCheckShipment[],
  generatedAt: IsoTimestamp,
): CompletenessReport {
  const blockers: CompletenessBlocker[] =
    [];

  let lineCount =
    0;

  if (shipments.length === 0) {
    blockers.push(
      {
        reason: "NO_SHIPMENTS_IN_PERIOD",
        shipment_id: null,
        shipment_reference: null,
        shipment_status: null,
      },
    );
  }

  for (const shipment of shipments) {
    if (shipment.status !== "READY" && shipment.status !== "LOCKED") {
      blockers.push(
        {
          reason: "SHIPMENT_NOT_LOCKABLE",
          shipment_id: shipment.shipment_id,
          shipment_reference: shipment.shipment_reference,
          shipment_status: shipment.status,
        },
      );
    }

    if (shipment.lines.length === 0) {
      blockers.push(
        {
          reason: "SHIPMENT_HAS_NO_LINES",
          shipment_id: shipment.shipment_id,
          shipment_reference: shipment.shipment_reference,
          shipment_status: shipment.status,
        },
      );

      continue;
    }

    for (const line of shipment.lines) {
      lineCount += 1;

      if (!line.has_emission_determination) {
        blockers.push(
          {
            reason: "LINE_NOT_DETERMINED",
            shipment_id: shipment.shipment_id,
            shipment_reference: shipment.shipment_reference,
            shipment_status: shipment.status,
            line_id: line.line_id,
            line_number: line.line_number,
          },
        );

        continue;
      }

      if (!line.has_calculation_result) {
        blockers.push(
          {
            reason: "LINE_NOT_CALCULATED",
            shipment_id: shipment.shipment_id,
            shipment_reference: shipment.shipment_reference,
            shipment_status: shipment.status,
            line_id: line.line_id,
            line_number: line.line_number,
          },
        );
      } else if (!line.calculation_is_current) {
        // Determined AND calculated, but not against each other: the
        // line's latest calculation_results row was frozen against a
        // determination this line no longer carries (redetermined
        // without a follow-up recalculation -- see this reason's own
        // doc comment on CompletenessBlockerReason). Distinct from, not
        // layered onto, LINE_NOT_CALCULATED above -- an `else if`, not a
        // second independent check, so a line is never flagged with
        // both for the same underlying fact.
        //
        // 2026-09-07 (S5 review round 13 remediation). Carries
        // calculation_engine_is_current alongside shipment_status --
        // see CompletenessBlocker's own doc comment for why
        // recalculateAvailability needs this specific fact, not just
        // "which reason fired," to answer whether this line can be
        // recalculated directly on a READY shipment.
        blockers.push(
          {
            reason: "LINE_CALCULATION_STALE",
            shipment_id: shipment.shipment_id,
            shipment_reference: shipment.shipment_reference,
            shipment_status: shipment.status,
            line_id: line.line_id,
            line_number: line.line_number,
            calculation_engine_is_current: line.calculation_engine_is_current,
          },
        );
      } else if (!line.calculation_engine_is_current) {
        // Determined, calculated, AND the calculation matches the
        // current determination -- but that calculation was produced by
        // an engine version the app no longer runs.
        // record_declaration_filed() refuses this at filing time
        // (CALCULATION_ENGINE_OUTDATED); this reason previews the same
        // fact here, before filing is attempted. A fourth, independent
        // `else if`, not layered onto the ones above: a line is flagged
        // with exactly one of LINE_NOT_CALCULATED / LINE_CALCULATION_
        // STALE / LINE_CALCULATION_ENGINE_OUTDATED / LINE_DATASET_
        // SUPERSEDED for the same underlying fact, never more than one
        // at once.
        blockers.push(
          {
            reason: "LINE_CALCULATION_ENGINE_OUTDATED",
            shipment_id: shipment.shipment_id,
            shipment_reference: shipment.shipment_reference,
            shipment_status: shipment.status,
            line_id: line.line_id,
            line_number: line.line_number,
          },
        );
      } else if (!line.dataset_is_current) {
        // Determined, calculated, current against both its own
        // determination AND the engine version -- but the determination
        // itself now names a superseded regulatory dataset. A fifth,
        // independent `else if`, not layered onto the ones above: a line
        // is flagged with exactly one of these reasons for the same
        // underlying fact, never more than one at once.
        blockers.push(
          {
            reason: "LINE_DATASET_SUPERSEDED",
            shipment_id: shipment.shipment_id,
            shipment_reference: shipment.shipment_reference,
            shipment_status: shipment.status,
            line_id: line.line_id,
            line_number: line.line_number,
          },
        );
      }
    }
  }

  // Deterministic, not insertion order -- matches build-period-summary.ts's
  // own incomplete_lines sort (identical shipment_reference-then-line_number
  // key), since this report is read/refreshed repeatedly across a
  // period's lifetime as more lines get resolved.
  blockers.sort(
    (a, b) => {
      const referenceA =
        a.shipment_reference ?? "";

      const referenceB =
        b.shipment_reference ?? "";

      if (referenceA !== referenceB) {
        return referenceA.localeCompare(
          referenceB,
        );
      }

      return (a.line_number ?? 0) - (b.line_number ?? 0);
    },
  );

  return {
    generated_at: generatedAt,
    shipment_count: shipments.length,
    line_count: lineCount,
    complete: blockers.length === 0,
    blockers,
  };
}
