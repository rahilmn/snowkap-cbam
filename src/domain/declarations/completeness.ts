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
        },
      );
    }

    if (shipment.lines.length === 0) {
      blockers.push(
        {
          reason: "SHIPMENT_HAS_NO_LINES",
          shipment_id: shipment.shipment_id,
          shipment_reference: shipment.shipment_reference,
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
