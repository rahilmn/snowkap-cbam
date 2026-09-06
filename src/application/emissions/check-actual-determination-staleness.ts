import type {
  OrganizationId,
} from "../../domain/shared/ids";

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
  // 2026-09-07 (S5 review round 3, finding S5R3-A-B1's own sweep,
  // prophylactic -- no legacy-shape ACTUAL row exists today, but
  // `snapshot` is compile-time-required, not runtime-guaranteed, for
  // the same unchecked-jsonb-cast reason `resolution` isn't either.
  // `?? null` rather than a bare access: every caller filters on
  // `!== null`, which a bare `undefined` result would silently pass
  // through.
  return line.emission_determination?.method === "ACTUAL"
    ? (line.emission_determination.snapshot ?? null)
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
 * 2026-09-06 (S5 review remediation, finding S5B-4). BOTH of this
 * module's query legs (the primary emission_data lookup, and the
 * sharing_grants sub-lookup inside activeGrantedInstallationIds) now
 * THROW on a genuine fetch error, matching this codebase's own "throw is
 * for infrastructure failures" convention (CLAUDE.md). Previously each
 * degraded quiet -- reasoning this was "purely informational" and never
 * gates anything (master plan §18 keeps re-determination an explicit,
 * audited importer action, never automatic) -- but that reasoning missed
 * that a MISSING entry in this function's own result is not itself
 * rendered: list-actual-determined-lines.ts's own
 * `stalenessByLineId[line.id] ?? "CURRENT"` converts absence into an
 * AFFIRMATIVE "Current" badge, a positive claim, not a withheld warning.
 * "We could not check" must never render as "this IS current".
 */

/**
 * The installations the ACTIVE org currently holds a live sharing grant
 * for. Deliberately the same predicate listAvailableActualEmissionData
 * applies to its own grant lookup -- ACTIVE, unexpired, granted to THIS
 * org -- so the staleness hint can never point at data the picker would
 * refuse to offer.
 */
async function activeGrantedInstallationIds(
  supabase: SupabaseClient,
  orgId: OrganizationId,
  installationIds: string[],
): Promise<Set<string>> {
  if (installationIds.length === 0) {
    return new Set();
  }

  const { data, error } =
    await supabase
      .from("sharing_grants")
      .select("installation_id, expires_at")
      .eq("grantee_org_id", orgId)
      .eq("status", "ACTIVE")
      .in("installation_id", installationIds);

  if (error || !data) {
    // 2026-09-06 (S5 review remediation, finding S5B-4). Previously
    // failed closed to an empty Set -- "no grant evidence" -- which is
    // exactly wrong for a SHARED installation: it does not merely
    // withhold a staleness signal, it makes the row invisible to the
    // current-data lookup below, and list-actual-determined-lines.ts's
    // own `stalenessByLineId[line.id] ?? "CURRENT"` then renders that as
    // an AFFIRMATIVE "Current" badge -- the exact cross-org data an
    // importer is least able to verify independently. Throwing here
    // propagates through checkActualDeterminationStalenessByShipment
    // (no try/catch of its own) and listActualDeterminedLines (same) to
    // the page's own error boundary, matching this module's sibling
    // fix below.
    throw new Error(
      `emissions: staleness sharing-grants fetch failed (${error?.message ?? "no rows"}).`,
    );
  }

  const now =
    Date.now();

  return new Set(
    (data as { installation_id: string; expires_at: string | null }[])
      .filter(
        (row) =>
          row.expires_at === null ||
          new Date(row.expires_at).getTime() > now,
      )
      .map((row) => row.installation_id),
  );
}

export async function checkActualDeterminationStalenessByShipment(
  supabase: SupabaseClient,
  orgId: OrganizationId,
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
    // 2026-09-06 (S5 review remediation, finding S5B-4). Previously
    // degraded the WHOLE result to {} -- no entry for any line -- which
    // list-actual-determined-lines.ts:481's own
    // `stalenessByLineId[line.id] ?? "CURRENT"` then renders as an
    // AFFIRMATIVE "Current" badge on the one screen whose entire purpose
    // is surfacing STALE determinations (S5 commit b23e500's own header
    // comment). "We could not check whether newer data exists" must
    // never render as "this determination IS current" -- that is a
    // positive claim, not a missing warning. This function's one caller
    // (listActualDeterminedLines) has no try/catch of its own, so a
    // throw here reaches the page's error boundary exactly the way that
    // function's own four query legs already do (see its doc comment).
    throw new Error(
      `emissions: staleness emission_data fetch failed (${error.message}).`,
    );
  }

  const rows =
    (data ?? []) as EmissionDataRow[];

  // Scope to what the ACTIVE org may legitimately see: its own data, or
  // an installation it currently holds a live grant for. Anything else
  // reached this result through a DIFFERENT membership of the same user,
  // and must not produce a staleness signal on this org's screen.
  //
  // Only foreign rows need a grant lookup, so an org looking at its own
  // data issues no extra query at all -- which is both the common case
  // and the one where the answer is already known.
  const foreignInstallationIds =
    Array.from(
      new Set(
        rows
          .filter((row) => row.entered_by_org_id !== orgId)
          .map((row) => row.installation_id),
      ),
    );

  const grantedInstallationIds =
    await activeGrantedInstallationIds(
      supabase,
      orgId,
      foreignInstallationIds,
    );

  const currentByInstallation =
    new Map(
      rows
        .filter(
          (row) =>
            row.entered_by_org_id === orgId ||
            grantedInstallationIds.has(row.installation_id),
        )
        .map(
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
