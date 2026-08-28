import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import type {
  CalculationStep,
  EngineVersion,
} from "../../domain/calculations/types";

import type {
  DecimalString,
} from "../../domain/shared/decimal";

import type {
  IsoTimestamp,
} from "../../domain/shared/reporting-period";

import type {
  ShipmentId,
} from "../../domain/shared/ids";

export interface LatestLineCalculation {
  engine_version: EngineVersion;
  embedded_emissions_tco2e: DecimalString;
  steps: CalculationStep[];
  calculated_at: IsoTimestamp;
}

interface CalculationResultRow {
  line_id: string;
  engine_version: EngineVersion;
  embedded_emissions_tco2e: string;
  steps: CalculationStep[];
  calculated_at: string;
}

/**
 * The most recent calculation_results row per line_id for one
 * shipment, keyed by line id -- "recalculation appends"
 * (docs/plans/MASTER_PLAN.md §6/§12), so a line's *current* result is
 * whichever row has the latest calculated_at, not a single canonical
 * row. A line absent from the returned record has never been
 * successfully calculated (calculation_results only ever holds
 * COMPUTED results -- see calculate-line.ts) -- the UI renders that as
 * "Not calculated," not as an error.
 *
 * Reads the latest_calculation_results view (DISTINCT ON line_id,
 * ordered calculated_at desc / id desc for a deterministic tiebreak --
 * see 20260829200000_p6_calculation_results_hardening.sql) rather than
 * fetching every row for the shipment and reducing in application
 * code: an earlier version did exactly that and, found in the
 * mandatory P6 review, silently truncated past PostgREST's row cap
 * once a shipment's calculation history (across all its lines and
 * every recalculation) exceeded it -- lines whose only calculation
 * fell outside the newest rows would render as "Not calculated" even
 * though they had been.
 */
export async function getLatestCalculationsByShipment(
  supabase: SupabaseClient,
  shipmentId: ShipmentId,
): Promise<Record<string, LatestLineCalculation>> {
  const { data, error } =
    await supabase
      .from("latest_calculation_results")
      .select(
        "line_id, engine_version, embedded_emissions_tco2e, steps, calculated_at",
      )
      .eq("shipment_id", shipmentId);

  if (error || !data) {
    return {};
  }

  const latestByLine: Record<string, LatestLineCalculation> =
    {};

  for (const row of data as CalculationResultRow[]) {
    latestByLine[row.line_id] =
      {
        engine_version: row.engine_version,
        embedded_emissions_tco2e: row.embedded_emissions_tco2e as DecimalString,
        steps: row.steps,
        calculated_at: row.calculated_at as IsoTimestamp,
      };
  }

  return latestByLine;
}
