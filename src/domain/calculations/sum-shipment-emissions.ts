import {
  toDecimal,
  toDecimalString,
  type DecimalString,
} from "../shared/decimal";

export type ShipmentEmissionsTotal =
  | {
      status: "NONE";
      // 2026-09-07 (S5 review round 5, finding S5R5-A-1). NONE means
      // "nothing to sum," not "nothing was ever calculated" -- the
      // identical distinction PARTIAL's own staleLineCount already
      // makes, extended to the shape that occurs when EVERY line is
      // simultaneously stale (the common single-line-shipment case).
      // Without it, a shipment with one real, frozen calculation --
      // excluded here only because it is stale, not because it was
      // never computed -- rendered the bare "Not yet calculated"
      // headline, disagreeing with that same line's own "Stale --
      // recalculate" badge shown in the lines table on the same page.
      staleLineCount: number;
    }
  | {
      status: "PARTIAL";
      total_tco2e: DecimalString;
      calculatedLineCount: number;
      totalLineCount: number;
      // 2026-09-07 (S5 review round 4, finding S5R4-VOCAB-2). How many
      // of the lines NOT counted in calculatedLineCount already have a
      // calculation sitting in calculation_results, but it was excluded
      // because it is STALE (recalculated determination, not yet
      // recalculated) rather than because the line has never been
      // calculated at all. Both cases previously collapsed into the
      // same bare count, so the caller's own "N of M lines calculated
      // so far" caption read as "the rest simply haven't been done
      // yet" for a line that is, in fact, already flagged with its own
      // "Stale -- recalculate" badge elsewhere on the same page --
      // matching the distinction build-period-summary.ts's own
      // IncompleteLineReason (NOT_CALCULATED vs CALCULATION_STALE)
      // already makes one level up, at the period-report layer.
      staleLineCount: number;
    }
  | {
      status: "COMPLETE";
      total_tco2e: DecimalString;
      totalLineCount: number;
    };

/**
 * S3 (importer experience), v2.1.1 "prominent result" (§6): the
 * shipment-level headline figure a user actually cares about, summed
 * from each line's own latest COMPUTED embedded_emissions_tco2e
 * (get-latest-calculations.ts -- calculation_results only ever holds
 * COMPUTED results, so every value passed in here is a genuine,
 * already-computed figure).
 *
 * An AGGREGATION, never a second calculation: RULE-EE-001/EE-009 and
 * every regulatory determination stay entirely the calculation
 * engine's own job (calculate-line-emissions.ts) -- this function only
 * adds numbers that engine already produced. Decimal.js arithmetic
 * lives here because this file is under src/domain/calculations/,
 * where the layering rule permits it (src/domain/shared/decimal.ts's
 * own header comment).
 *
 * `computedLineEmissions` MUST already be filtered to CURRENT
 * calculations only (src/domain/emissions/check-calculation-currency.ts)
 * -- a STALE one (the line was re-determined without being
 * recalculated; calculation_results is append-only, so its superseded
 * figure just sits there) must never reach this function, the same way
 * build-period-summary.ts's calculationIsCurrent excludes one from the
 * period-level total, for the identical reason: this codebase found
 * and fixed exactly this class of bug once already at the reporting
 * layer (2026-09-03, P14) and it is not this function's job to
 * re-derive that filter itself (it has no way to: it only receives
 * bare DecimalStrings, not the determinations needed to check
 * currency) -- the caller (get-shipment-emissions-total.ts) does it,
 * the same way calculation-cell.tsx's own per-line staleness badge
 * does.
 *
 * NONE (not zero) when no line has been calculated yet, so the UI can
 * render "not yet calculated" rather than a misleading "0 tCO2e" --
 * the same "no value" is never "value is zero" discipline
 * CLAUDE.md states for the regulatory subsystem, applied here even
 * though this aggregation itself is not part of the protected zone.
 */
export function sumShipmentEmissions(
  computedLineEmissions: DecimalString[],
  totalLineCount: number,
  staleLineCount = 0,
): ShipmentEmissionsTotal {
  if (totalLineCount === 0 || computedLineEmissions.length === 0) {
    return {
      status: "NONE",
      staleLineCount,
    };
  }

  const total =
    computedLineEmissions.reduce(
      (sum, value) => sum.plus(toDecimal(value)),
      toDecimal("0" as DecimalString),
    );

  const total_tco2e =
    toDecimalString(total);

  return computedLineEmissions.length === totalLineCount
    ? {
        status: "COMPLETE",
        total_tco2e,
        totalLineCount,
      }
    : {
        status: "PARTIAL",
        total_tco2e,
        calculatedLineCount: computedLineEmissions.length,
        totalLineCount,
        staleLineCount,
      };
}
