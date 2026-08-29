import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import type {
  CnCodeLevel,
} from "../../domain/shipments/types";

import type {
  DecimalString,
} from "../../domain/shared/decimal";

import type {
  CountryCode,
} from "../../domain/shared/country";

import type {
  ReportingPeriod,
  IsoTimestamp,
} from "../../domain/shared/reporting-period";

import type {
  OrganizationId,
} from "../../domain/shared/ids";

import type {
  EmissionDataMethodology,
} from "../../domain/emissions/types";

import type {
  ResolutionReason,
} from "../../domain/regulatory/types";

import type {
  EngineVersion,
} from "../../domain/calculations/types";

import {
  listPeriodShipmentLines,
  type PeriodShipmentLine,
} from "./list-period-shipment-lines";

export type PeriodExportQuantityUnit =
  | "TONNES"
  | "MWH";

export type PeriodExportDeterminationMethod =
  | "DEFAULT"
  | "ACTUAL"
  | "NOT_DETERMINED";

/**
 * One flattened row of a period's full export -- CSV (period-export-csv.ts)
 * and XLSX (app/api/reports/export/route.ts) are both built from this
 * exact shape, so the two file formats can never silently disagree on
 * which columns exist or what a field means. Deliberately reuses the
 * same field vocabulary as lines-table.tsx / why-this-number-panel.tsx
 * (cn_code, cn_code_level, origin_country, production_route,
 * determination method, dataset_version/engine_version,
 * embedded_emissions_tco2e) rather than inventing new names for the
 * same facts -- this row is "the same facts already rendered per-line
 * on a shipment's detail screen, flattened across every line in a
 * period," per this task's own framing.
 *
 * Every field that isn't always knowable is nullable rather than
 * defaulted to an empty-looking-but-wrong value: `dataset_version` and
 * `methodology` are mutually exclusive (only one method applies per
 * line), `resolution_reason` only exists for a DEFAULT determination,
 * and `engine_version`/`embedded_emissions_tco2e`/`calculated_at` are
 * all null together exactly when the line hasn't been calculated yet
 * (see build-period-summary.ts's own IncompleteLineReason for the two
 * ways that can happen) -- never a fabricated placeholder for "not yet
 * known."
 */
export interface PeriodExportRow {
  shipment_reference: string;
  line_number: number;

  cn_code: string;
  cn_code_level: CnCodeLevel;

  origin_country: CountryCode;
  production_route: string | null;

  quantity: DecimalString;
  quantity_unit: PeriodExportQuantityUnit;

  determination_method: PeriodExportDeterminationMethod;
  dataset_version: string | null;
  methodology: EmissionDataMethodology | null;
  resolution_reason: ResolutionReason | null;

  engine_version: EngineVersion | null;
  embedded_emissions_tco2e: DecimalString | null;
  calculated_at: IsoTimestamp | null;
}

/**
 * Exactly one of net_mass_tonnes/quantity_mwh is ever set on a
 * ShipmentLine (see ShipmentLine's own doc comment in
 * src/domain/shipments/types.ts, "isLineQuantityValid in
 * invariants.ts") -- mirrors calculate-line.ts's own private
 * quantityInput helper, which makes the identical assumption for the
 * identical reason; not imported from there since that function isn't
 * exported (each caller of this established, tiny either/or mapping
 * keeps its own copy, the same way shipment-mapper.ts's and
 * emission-data-mapper.ts's own toReportingPeriod each do).
 */
function quantityOf(
  line: PeriodShipmentLine["line"],
): { quantity: DecimalString; quantity_unit: PeriodExportQuantityUnit } {
  return line.net_mass_tonnes !== null
    ? { quantity: line.net_mass_tonnes, quantity_unit: "TONNES" }
    : { quantity: line.quantity_mwh as DecimalString, quantity_unit: "MWH" };
}

function toExportRow(
  entry: PeriodShipmentLine,
): PeriodExportRow {
  const determination =
    entry.line.emission_determination;

  return {
    shipment_reference: entry.shipment_reference,
    line_number: entry.line.line_number,

    cn_code: entry.line.cn_code,
    cn_code_level: entry.line.cn_code_level,

    origin_country: entry.line.origin_country,
    production_route: entry.line.production_route?.name ?? null,

    ...quantityOf(entry.line),

    determination_method: determination?.method ?? "NOT_DETERMINED",
    dataset_version: determination?.method === "DEFAULT" ? determination.resolution.dataset_version : null,
    methodology: determination?.method === "ACTUAL" ? determination.snapshot.methodology : null,
    resolution_reason: determination?.method === "DEFAULT" ? determination.resolution.reason : null,

    engine_version: entry.calculation?.engine_version ?? null,
    embedded_emissions_tco2e: entry.calculation?.embedded_emissions_tco2e ?? null,
    calculated_at: entry.calculation?.calculated_at ?? null,
  };
}

/**
 * The row-level export view for one org + reporting period -- every
 * shipment line in the period, one row each, full provenance intact.
 * Built on the same listPeriodShipmentLines fetch build-period-summary.ts
 * uses (see that function's own doc comment), so the export's row count
 * and the summary's line_count can never drift apart from querying the
 * period two different ways.
 *
 * Sorted by shipment reference then line number -- a stable, readable
 * order for a document a declarant may print or attach to a filing
 * (master plan §22: Snowkap "prepares... for the declarant's own use"),
 * not the arbitrary order the three underlying queries happened to
 * return rows in.
 */
export async function buildPeriodExportRows(
  supabase: SupabaseClient,
  orgId: OrganizationId,
  period: ReportingPeriod,
): Promise<PeriodExportRow[]> {
  const { lines } =
    await listPeriodShipmentLines(
      supabase,
      orgId,
      period,
    );

  return lines
    .map(
      toExportRow,
    )
    .sort(
      (a, b) => {
        if (a.shipment_reference !== b.shipment_reference) {
          return a.shipment_reference.localeCompare(
            b.shipment_reference,
          );
        }

        return a.line_number - b.line_number;
      },
    );
}
