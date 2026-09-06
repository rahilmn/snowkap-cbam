import {
  checkCalculationCurrency,
} from "../../domain/emissions/check-calculation-currency";

import {
  determinationDatasetIsCurrent,
} from "../../domain/emissions/determination-dataset-currency";

import {
  sumShipmentEmissions,
  type ShipmentEmissionsTotal,
} from "../../domain/calculations/sum-shipment-emissions";

import type {
  DecimalString,
} from "../../domain/shared/decimal";

import type {
  EmissionDetermination,
} from "../../domain/emissions/types";

import type {
  LatestLineCalculation,
} from "./get-latest-calculations";

/**
 * S3 (importer experience), v2.1.1 "prominent result" (§6), fixed
 * 2026-09-06 after a fresh independent review (B1): a line's latest
 * calculation_results row can be STALE -- calculated against a
 * determination the line no longer carries, because it was
 * re-determined (the exact workflow the "Stale -- newer data
 * available" badge prompts an importer into) without being
 * recalculated. calculation_results is append-only, so the superseded
 * figure just sits there. A stale figure MUST contribute nothing to
 * the shipment total, not its old value -- the identical rule
 * build-period-summary.ts's own calculationIsCurrent already enforces
 * for the period-level total (2026-09-03, P14), for the identical
 * reason: this headline disagreeing with the very staleness badge
 * shown two inches below it on the same page would be worse than
 * either being wrong alone.
 *
 * Reuses checkCalculationCurrency, the SAME domain function
 * calculation-cell.tsx already calls to render that per-line badge --
 * never a second staleness check.
 */
export interface ShipmentEmissionsTotalResult {
  total: ShipmentEmissionsTotal;

  // 2026-09-06 (S5 review remediation, finding A4). How many of the
  // CURRENT, included-in-`total` lines are resolved against a
  // regulatory dataset that is no longer ACTIVE -- a fact `total`
  // itself has no way to carry (it is a pure sum, and this is
  // deliberately NOT excluded from it the way a STALE calculation is,
  // since the calculation itself is still current; only the regulatory
  // data behind it has moved). Zero when none are, which is the common
  // case and needs no caption.
  datasetSupersededLineCount: number;
}

export function getShipmentEmissionsTotal(
  lines: {
    id: string;
    emission_determination: EmissionDetermination | null;
  }[],
  latestCalculations: Record<string, LatestLineCalculation>,
  activeDatasetIds: ReadonlySet<string>,
): ShipmentEmissionsTotalResult {
  const currentComputedEmissions: DecimalString[] =
    [];

  let datasetSupersededLineCount =
    0;

  for (const line of lines) {
    const calculation =
      latestCalculations[line.id];

    if (!calculation) {
      continue;
    }

    if (
      checkCalculationCurrency(
        calculation.determination,
        line.emission_determination,
      ) !== "CURRENT"
    ) {
      continue;
    }

    currentComputedEmissions.push(
      calculation.embedded_emissions_tco2e,
    );

    if (
      !determinationDatasetIsCurrent(
        line.emission_determination,
        activeDatasetIds,
      )
    ) {
      datasetSupersededLineCount += 1;
    }
  }

  return {
    total: sumShipmentEmissions(
      currentComputedEmissions,
      lines.length,
    ),
    datasetSupersededLineCount,
  };
}
