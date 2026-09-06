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
  OrganizationId,
  CalculationResultId,
  ShipmentId,
} from "../../domain/shared/ids";

import type {
  EmissionDetermination,
} from "../../domain/emissions/types";

export interface LatestLineCalculation {
  // Added for P8's "Verify reproducibility" check
  // (reproduce-calculation-result.ts): that check operates on one
  // calculation_results row by id, and this view row is the only place
  // the UI has that id in hand -- get-latest-calculations.ts previously
  // never surfaced it because nothing before P8 needed to address an
  // individual calculation_results row from the client.
  id: CalculationResultId;
  engine_version: EngineVersion;
  embedded_emissions_tco2e: DecimalString;
  steps: CalculationStep[];
  calculated_at: IsoTimestamp;
  // Added for the P13 adversarial audit's staleness signal: the FROZEN
  // determination this calculation was actually computed against
  // (calculate-line.ts writes it verbatim from the line's own
  // emission_determination at calculation time -- never re-derived).
  // The shipment detail screen compares this against the line's CURRENT
  // emission_determination (src/domain/emissions/check-calculation-currency.ts)
  // to show a real staleness badge, the same fact
  // record_declaration_filed() now refuses to file over.
  determination: EmissionDetermination;
}

interface CalculationResultRow {
  id: string;
  line_id: string;
  engine_version: EngineVersion;
  embedded_emissions_tco2e: string;
  steps: CalculationStep[];
  calculated_at: string;
  determination: EmissionDetermination;
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
// 2026-09-07 (supabase/config.toml `max_rows = 1000`; S5 review round
// 3, finding S5R3-A-B2). Reading latest_calculation_results (DISTINCT
// ON line_id) already closed the P6 truncation risk described above --
// this view's own row count is bounded by the shipment's LINE count,
// not by its full calculation history -- but a shipment with more than
// 1000 lines still silently truncates the same way, with no .range()
// on this query. Lines past the cap would render as "Not calculated"
// even though they had been, and -- more consequentially -- their
// embedded emissions would silently drop out of
// getShipmentEmissionsTotal's headline sum for the shipment (the
// caller feeds this function's return value straight into that pure
// summation, which has no way to know rows are missing).
const CALCULATION_PAGE_SIZE = 1000;

export async function getLatestCalculationsByShipment(
  supabase: SupabaseClient,
  orgId: OrganizationId,
  shipmentId: ShipmentId,
): Promise<Record<string, LatestLineCalculation>> {
  const rows: CalculationResultRow[] =
    [];

  let offset =
    0;

  for (;;) {
    const { data, error } =
      await supabase
        .from("latest_calculation_results")
        .select(
          "id, line_id, engine_version, embedded_emissions_tco2e, steps, calculated_at, determination",
        )
        // Pinned to the ACTIVE org, not left to RLS, for the reason
        // get-shipment-detail.ts sets out: the view is org-scoped by RLS
        // to every org the USER belongs to, which is not the same as the
        // org they are acting as.
        .eq("org_id", orgId)
        .eq("shipment_id", shipmentId)
        // `id` (calculation_results' own primary key) as a deterministic
        // tie-breaker so .range() pagination is stable across pages --
        // the view has no other natural sort key to page against.
        .order("line_id", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + CALCULATION_PAGE_SIZE - 1);

    // 2026-09-07 (S5 review round 4, finding S5R4-A-B2). THROWS on a
    // genuine query error rather than degrading to {} -- a page other
    // than the first failing previously discarded every row already
    // collected from earlier successfully-fetched pages, and the
    // return type gave the caller no way to distinguish "genuinely no
    // calculations exist" from "the fetch failed." The one caller,
    // app/(importer)/shipments/[id]/page.tsx, is a plain server
    // component that already throws on an equivalent regulatory_
    // datasets fetch error 20 lines below this call -- this now
    // matches that established convention instead of contradicting it.
    // An empty result here previously fed straight into
    // getShipmentEmissionsTotal, which treats every line absent from
    // the record as "never calculated," turning a genuine
    // infrastructure failure into the S3 flagship prominent-total
    // feature silently reading "not yet calculated" for a shipment
    // that is, in reality, fully calculated.
    if (error) {
      throw new Error(
        `get-latest-calculations: latest_calculation_results fetch failed (${error.message}).`,
      );
    }

    if (!data) {
      throw new Error(
        "get-latest-calculations: latest_calculation_results fetch returned no data.",
      );
    }

    rows.push(
      ...(data as CalculationResultRow[]),
    );

    if (data.length < CALCULATION_PAGE_SIZE) {
      break;
    }

    offset +=
      CALCULATION_PAGE_SIZE;
  }

  const latestByLine: Record<string, LatestLineCalculation> =
    {};

  for (const row of rows) {
    latestByLine[row.line_id] =
      {
        id: row.id as CalculationResultId,
        engine_version: row.engine_version,
        embedded_emissions_tco2e: row.embedded_emissions_tco2e as DecimalString,
        steps: row.steps,
        calculated_at: row.calculated_at as IsoTimestamp,
        determination: row.determination,
      };
  }

  return latestByLine;
}
