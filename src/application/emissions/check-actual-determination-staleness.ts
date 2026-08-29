import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import {
  checkActualSnapshotStaleness,
  type ActualSnapshotStaleness,
} from "../../domain/emissions/check-actual-snapshot-staleness";

import type {
  ActualEmissionSnapshot,
} from "../../domain/emissions/types";

import type {
  ReportingPeriod,
} from "../../domain/shared/reporting-period";

import type {
  ShipmentLine,
} from "../../domain/shipments/types";

import {
  EMISSION_DATA_COLUMNS,
  reportingPeriodColumns,
  toEmissionData,
  type EmissionDataRow,
} from "./emission-data-mapper";

function actualSnapshotOf(
  line: ShipmentLine,
): ActualEmissionSnapshot | null {
  return line.emission_determination?.method === "ACTUAL"
    ? line.emission_determination.snapshot
    : null;
}

/**
 * Per-line staleness for every ACTUAL-determined line on one shipment,
 * keyed by line id -- same "line absent from the returned record means
 * not applicable" convention getLatestCalculationsByShipment already
 * established (src/application/calculations/get-latest-calculations.ts's
 * own doc comment): a DEFAULT-determined or not-yet-determined line is
 * simply absent here, not present with some third status, matching how
 * the UI already treats an absent latestCalculations entry as
 * "Not calculated" rather than an error state.
 *
 * All of a shipment's lines share the SAME shipment-level `period`
 * (Shipment.reporting_period, src/domain/shipments/types.ts) -- unlike
 * cn_scope/installation_id, which vary per line's own snapshot, so it is
 * taken once as a parameter rather than re-derived per line.
 *
 * One batched query for every distinct installation_id among the
 * shipment's ACTUAL-determined lines (mirroring
 * getLatestCalculationsByShipment's own one-query-for-the-whole-shipment
 * shape, not a query per line) -- safe to key the result purely by
 * installation_id because emission_data_one_active_per_installation_
 * period_uq (20260829230000) guarantees at most one ACTIVE row per
 * (installation_id, period) globally, so two lines referencing the same
 * installation can never collide on different current rows. Read through
 * the ordinary RLS-scoped `supabase` client (never a service-role
 * client), so a row this org can no longer see -- e.g. a SHARED
 * determination whose sharing grant was since revoked -- simply doesn't
 * come back; checkActualSnapshotStaleness's own doc comment already
 * documents that this degrades to CURRENT (no evidence of staleness)
 * rather than a false alarm, which is the correct behavior here too, not
 * a gap introduced by this function.
 *
 * A query error degrades the WHOLE result to {} (no staleness signal for
 * any line) rather than a partial result or a thrown error -- this is
 * purely an informational "Stale -- newer data available" UI hint (never
 * gates anything -- master plan §18 keeps re-determination an explicit,
 * audited importer action, never automatic), so failing quiet here is
 * strictly safer than surfacing a broken picker.
 */
export async function checkActualDeterminationStalenessByShipment(
  supabase: SupabaseClient,
  lines: ShipmentLine[],
  period: ReportingPeriod,
): Promise<Record<string, ActualSnapshotStaleness>> {
  const actualLines =
    lines
      .map(
        (line) => (
          {
            line,
            snapshot: actualSnapshotOf(line),
          }
        ),
      )
      .filter(
        (entry): entry is { line: ShipmentLine; snapshot: ActualEmissionSnapshot } =>
          entry.snapshot !== null,
      );

  if (actualLines.length === 0) {
    return {};
  }

  const installationIds =
    Array.from(
      new Set(
        actualLines.map((entry) => entry.snapshot.installation_id),
      ),
    );

  const periodColumns =
    reportingPeriodColumns(
      period,
    );

  let query =
    supabase
      .from("emission_data")
      .select(
        EMISSION_DATA_COLUMNS,
      )
      .eq("status", "ACTIVE")
      .eq("reporting_period_kind", periodColumns.reporting_period_kind)
      .eq("reporting_period_year", periodColumns.reporting_period_year)
      .in("installation_id", installationIds);

  query =
    periodColumns.reporting_period_quarter === null
      ? query.is("reporting_period_quarter", null)
      : query.eq("reporting_period_quarter", periodColumns.reporting_period_quarter);

  const { data, error } =
    await query;

  if (error) {
    return {};
  }

  const currentByInstallation =
    new Map(
      ((data ?? []) as EmissionDataRow[]).map(
        (row) => [row.installation_id, toEmissionData(row)] as const,
      ),
    );

  const result: Record<string, ActualSnapshotStaleness> =
    {};

  for (const { line, snapshot } of actualLines) {
    result[line.id] =
      checkActualSnapshotStaleness(
        snapshot,
        currentByInstallation.get(snapshot.installation_id) ?? null,
      );
  }

  return result;
}
