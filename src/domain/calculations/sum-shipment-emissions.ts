import {
  toDecimal,
  toDecimalString,
  type DecimalString,
} from "../shared/decimal";

export type ShipmentEmissionsTotal =
  | { status: "NONE" }
  | {
      status: "PARTIAL";
      total_tco2e: DecimalString;
      calculatedLineCount: number;
      totalLineCount: number;
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
 * NONE (not zero) when no line has been calculated yet, so the UI can
 * render "not yet calculated" rather than a misleading "0 tCO2e" --
 * the same "no value" is never "value is zero" discipline
 * CLAUDE.md states for the regulatory subsystem, applied here even
 * though this aggregation itself is not part of the protected zone.
 */
export function sumShipmentEmissions(
  computedLineEmissions: DecimalString[],
  totalLineCount: number,
): ShipmentEmissionsTotal {
  if (totalLineCount === 0 || computedLineEmissions.length === 0) {
    return {
      status: "NONE",
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
      };
}
