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
 * Reduced in application code (rather than a DISTINCT ON query) to
 * keep the query itself simple and let the existing
 * (org_id, line_id, calculated_at desc) index serve it well even as
 * history accumulates -- the row count per shipment stays small
 * (calculations per line, not per shipment), so this is not a scale
 * concern.
 */
export async function getLatestCalculationsByShipment(
  supabase: SupabaseClient,
  shipmentId: ShipmentId,
): Promise<Record<string, LatestLineCalculation>> {
  const { data, error } =
    await supabase
      .from("calculation_results")
      .select(
        "line_id, engine_version, embedded_emissions_tco2e, steps, calculated_at",
      )
      .eq("shipment_id", shipmentId)
      .order("calculated_at", { ascending: false });

  if (error || !data) {
    return {};
  }

  const latestByLine: Record<string, LatestLineCalculation> =
    {};

  for (const row of data as CalculationResultRow[]) {
    if (latestByLine[row.line_id]) {
      continue;
    }

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
