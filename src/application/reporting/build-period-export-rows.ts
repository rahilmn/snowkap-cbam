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
  checkCalculationCurrency,
} from "../../domain/emissions/check-calculation-currency";

import type {
  EmissionDetermination,
} from "../../domain/emissions/types";

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

  // --- 2026-09-03 (P14): provenance, appended ------------------------
  //
  // Appended after calculated_at, never interleaved: route.test.ts
  // resolves columns by header, and both formats' existing byte-stable
  // prefixes stay byte-stable.
  //
  // Every one of these describes the calculation that produced
  // embedded_emissions_tco2e, EXCEPT installation_name, which is
  // labelled as the live lookup it is.

  /**
   * The frozen country-mapping enum, copied verbatim from the
   * resolution snapshot: "MAPPED" or "UNLISTED".
   *
   * Null for an ACTUAL determination (the actual path never reads
   * origin) and for an undetermined line. Documented in the XLSX Notes
   * sheet and the release report as: copied verbatim from the frozen
   * regulatory resolution snapshot; populated only for DEFAULT
   * determinations; it does NOT distinguish an EU member state from a
   * genuinely unlisted third country or from a non-country code, and it
   * is not a scope indicator.
   */
  country_mapping_status: string | null;

  /** The producer's emission_data record an ACTUAL figure came from. */
  emission_data_id: string | null;
  emission_data_version: number | null;

  /**
   * A LIVE lookup of current, grant-dependent visibility -- not
   * provenance. Null when the installation is no longer visible to this
   * organization (the grant was revoked or expired), and it can change
   * between two exports of the same period after a revoke or a rename.
   * The declaration's own filed_snapshot remains the archived record.
   */
  installation_name: string | null;

  /** The sharing grant an ACTUAL figure was read through, if any. */
  sharing_grant_id: string | null;

  /**
   * Whether the figure in this row is the CURRENT calculation of this
   * line: "CURRENT", "STALE" (calculated against a determination the
   * line no longer carries -- a state the filing gate refuses), or
   * "NOT_CALCULATED".
   */
  calculation_currency: "CURRENT" | "STALE" | "NOT_CALCULATED";
}

interface InstallationNameRow {
  id: string;
  name: string;
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

/**
 * 2026-09-03 (P14). Which determination do the provenance columns
 * describe?
 *
 * The one the CALCULATION was performed against, whenever there is a
 * calculation. The row's whole subject is embedded_emissions_tco2e, and
 * describing that figure with facts taken from the line's CURRENT
 * determination produces a row that contradicts itself: edit a line's
 * quantity and the determination is nulled while the calculation
 * survives, so today's export prints "Determination method =
 * NOT_DETERMINED" beside a real tCO2e figure that was very much
 * determined.
 *
 * With no calculation there is nothing to describe but the line's
 * current state, which is the honest answer to "what is this line
 * right now".
 */
function describedDetermination(
  entry: PeriodShipmentLine,
): EmissionDetermination | null {
  return entry.calculation !== null
    ? entry.calculation.determination
    : entry.line.emission_determination;
}

function currencyOf(
  entry: PeriodShipmentLine,
): PeriodExportRow["calculation_currency"] {
  if (entry.calculation === null) {
    return "NOT_CALCULATED";
  }

  return checkCalculationCurrency(
    entry.calculation.determination,
    entry.line.emission_determination,
  );
}

function toExportRow(
  entry: PeriodShipmentLine,
  installationNameById: ReadonlyMap<string, string>,
): PeriodExportRow {
  const determination =
    describedDetermination(entry);

  const snapshot =
    determination?.method === "ACTUAL" ? determination.snapshot : null;

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

    country_mapping_status:
      determination?.method === "DEFAULT"
        ? determination.resolution.country_mapping.status
        : null,

    emission_data_id: snapshot?.emission_data_id ?? null,
    emission_data_version: snapshot?.emission_data_version ?? null,

    installation_name:
      snapshot === null
        ? null
        : installationNameById.get(snapshot.installation_id) ?? null,

    sharing_grant_id: snapshot?.sharing_grant_id ?? null,

    calculation_currency: currencyOf(entry),
  };
}

/**
 * Current, RLS-scoped names for the installations behind this period's
 * ACTUAL determinations.
 *
 * Batched once for the whole export rather than per row. Read under the
 * caller's own RLS, so an installation whose sharing grant has been
 * revoked simply does not come back and its column is blank -- which is
 * the truth: the name is not provenance, it is what this organization
 * can see today.
 *
 * A query failure degrades the NAMES only. Every other column in the
 * export is frozen provenance and must not be withheld because a
 * cosmetic lookup failed.
 */
async function fetchInstallationNames(
  supabase: SupabaseClient,
  lines: readonly PeriodShipmentLine[],
): Promise<Map<string, string>> {
  const installationIds =
    Array.from(
      new Set(
        lines
          .map(
            (entry) => describedDetermination(entry),
          )
          .filter(
            (determination): determination is EmissionDetermination =>
              determination?.method === "ACTUAL",
          )
          .map(
            (determination) =>
              determination.method === "ACTUAL"
                ? determination.snapshot.installation_id as string
                : "",
          ),
      ),
    );

  if (installationIds.length === 0) {
    return new Map();
  }

  const { data, error } =
    await supabase
      .from("installations")
      .select("id, name")
      .in("id", installationIds);

  if (error || !data) {
    return new Map();
  }

  return new Map(
    (data as InstallationNameRow[]).map(
      (row) => [row.id, row.name],
    ),
  );
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

  const installationNameById =
    await fetchInstallationNames(
      supabase,
      lines,
    );

  return lines
    .map(
      (entry) =>
        toExportRow(
          entry,
          installationNameById,
        ),
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
