import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import type {
  Shipment,
  ShipmentLine,
} from "../../domain/shipments/types";

import type {
  CalculationResultId,
  OrganizationId,
} from "../../domain/shared/ids";

import type {
  DecimalString,
} from "../../domain/shared/decimal";

import type {
  IsoTimestamp,
  ReportingPeriod,
} from "../../domain/shared/reporting-period";

import type {
  CalculationStep,
  EngineVersion,
} from "../../domain/calculations/types";

import type {
  EmissionDetermination,
} from "../../domain/emissions/types";

import {
  SHIPMENT_COLUMNS,
  SHIPMENT_LINE_COLUMNS,
  toShipment,
  toShipmentLine,
  type ShipmentLineRow,
  type ShipmentRow,
} from "../shipments/shipment-mapper";

/**
 * Same shape as get-latest-calculations.ts's own LatestLineCalculation
 * -- deliberately not imported from there, because that module's own
 * getLatestCalculationsByShipment is scoped to exactly one shipment_id
 * (`.eq`), while this file needs the identical row shape queried across
 * every shipment in a whole reporting period (`.in`). Re-declaring the
 * row/type pair here (rather than adding a second exported function to
 * get-latest-calculations.ts) keeps that file's own single-shipment
 * contract, used by the shipment detail screen's per-render fetch,
 * untouched.
 */
export interface PeriodLineCalculation {
  id: CalculationResultId;
  engine_version: EngineVersion;
  embedded_emissions_tco2e: DecimalString;
  steps: CalculationStep[];
  calculated_at: IsoTimestamp;
  // The FROZEN determination this calculation was actually computed
  // against (calculate-line.ts writes it verbatim from the line's own
  // emission_determination at calculation time -- never re-derived).
  // Added for compute-declaration-draft-facts.ts's P13 staleness check:
  // comparing this against the line's own CURRENT emission_determination
  // is what distinguishes "calculated and current" from "calculated
  // against a since-superseded determination" -- see
  // src/domain/declarations/completeness.ts's calculation_is_current
  // doc comment.
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
 * One shipment line in a reporting period, alongside the shipment
 * reference it belongs to (ShipmentLine itself carries only
 * shipment_id, not the human-readable reference export rows and the
 * summary's incomplete-lines list both need) and its latest calculation
 * result, if any. `calculation: null` means "never successfully
 * calculated" -- calculation_results only ever holds COMPUTED results
 * (see get-latest-calculations.ts's own doc comment) -- not "calculated
 * to zero," matching this codebase's "never treat no value as value is
 * zero" posture (CLAUDE.md, protected-zone section, applied here to a
 * plain product screen for the same reason it applies to the regulatory
 * subsystem: an absent figure and a zero figure are never the same
 * fact).
 */
export interface PeriodShipmentLine {
  shipment_id: Shipment["id"];
  shipment_reference: string;
  line: ShipmentLine;
  calculation: PeriodLineCalculation | null;
}

export interface PeriodShipmentLinesResult {
  // Counted directly from the `shipments` query, independent of
  // `lines.length` -- a shipment with zero lines yet (still DRAFT,
  // nothing added) must still count toward "shipments exist in this
  // period," which build-period-summary.ts's empty-state logic (task
  // step 7: "no shipments yet" vs "shipments exist but none
  // calculated") depends on distinguishing from `lines.length === 0`.
  shipment_count: number;
  lines: PeriodShipmentLine[];
}

interface PeriodFilterColumns {
  reporting_period_kind: "ANNUAL" | "QUARTERLY";
  reporting_period_year: number;
  reporting_period_quarter: 1 | 2 | 3 | 4 | null;
}

/**
 * The inverse of shipment-mapper.ts's own (private) toReportingPeriod --
 * duplicated here rather than imported, the same way emission-data-mapper.ts's
 * reportingPeriodColumns and shipment-mapper.ts's toReportingPeriod are
 * each their own file-local copy of this ANNUAL/QUARTERLY split rather
 * than a shared helper: this codebase has no single "reporting period
 * columns" module, and every existing table-column-shape function
 * belongs to the file that owns that table's Row type.
 */
function periodFilterColumns(
  period: ReportingPeriod,
): PeriodFilterColumns {
  if (period.kind === "ANNUAL") {
    return {
      reporting_period_kind: "ANNUAL",
      reporting_period_year: period.year,
      reporting_period_quarter: null,
    };
  }

  return {
    reporting_period_kind: "QUARTERLY",
    reporting_period_year: period.year,
    reporting_period_quarter: period.quarter,
  };
}

/**
 * Every shipment line belonging to `orgId` whose shipment falls in
 * `period`, joined with its latest calculation result -- the shared
 * fetch both build-period-summary.ts and build-period-export-rows.ts
 * are built on, so the three-query shape (shipments, then their lines,
 * then their latest calculations) is defined exactly once rather than
 * independently by each of those two callers (the same "don't duplicate
 * the security/visibility-relevant fetch" discipline
 * list-actual-determined-lines.ts's own doc comment already applies to
 * listAvailableActualEmissionData -- here the risk of drift is a wrong
 * report total, not a data leak, but the reasoning for sharing one
 * implementation is the same).
 *
 * Three sequential queries, matching this codebase's established
 * "no PostgREST embedded-resource select" discipline (see
 * listAvailableActualEmissionData's own doc comment for the fuller
 * reasoning this mirrors -- it keeps this function testable against the
 * established per-table mock-Supabase-client pattern):
 *
 *   1. `shipments` filtered to org_id + the period's own flat
 *      reporting_period_kind/_year/_quarter columns (the same columns
 *      20260828150000_p4_shipment_intake_schema.sql already indexes for
 *      exactly this shape of query -- see that migration's
 *      shipments_org_period_idx), and excluding VOID (see the query's
 *      own inline comment below for why -- a cancelled shipment's
 *      emissions must never reach a period total or export row).
 *   2. `shipment_lines` for every distinct shipment id the first query
 *      returned.
 *   3. `latest_calculation_results` (the DISTINCT ON view
 *      get-latest-calculations.ts's own doc comment explains the
 *      reasoning for -- a line's *current* result is whichever row has
 *      the latest calculated_at, and fetching the whole table and
 *      reducing client-side previously truncated silently past
 *      PostgREST's row cap), filtered to the same distinct shipment ids.
 *
 * Fails the WHOLE result to `{ shipment_count: 0, lines: [] }` on ANY of
 * the three query errors -- matching listActualDeterminedLines' and
 * listAvailableActualEmissionData's own established posture of never
 * returning a partial result a caller could mistake for "shipments
 * exist, but nothing has lines/calculations yet" (a real, distinct
 * state this function's own callers must be able to tell apart from a
 * transport failure -- see build-period-summary.ts's empty-state
 * handling).
 */
// PostgREST's own configured page cap (supabase/config.toml's
// `max_rows`) -- a query with no `.range()` silently truncates to this
// many rows rather than erroring, so the shipments fetch below must
// page through it explicitly or a period with more shipments than this
// silently reports a wrong (partial) total instead of the real one.
const SHIPMENTS_PAGE_SIZE =
  1000;

// Safe batch size for a Postgrest `.in("shipment_id", [...])` filter.
// Found live against real seeded data (P13 performance-verification
// pass, 50k shipments per docs/plans/MASTER_PLAN.md §33's own budget
// scale): passing all ~1000 ids from one SHIPMENTS_PAGE_SIZE page in a
// single `.in()` call produces a real "URI too long" error from the
// gateway (the resulting query string is tens of thousands of
// characters), which this function's own "fail the whole result to
// empty on any query error" posture then silently turned into
// {shipment_count: 0, lines: []} -- a period report showing "no
// shipments" instead of the real total, exactly the kind of
// silently-wrong-not-visibly-broken failure this codebase's numeric
// discipline exists to rule out. 200 ids/batch (~40 chars each with
// the comma separator) keeps every request comfortably under typical
// gateway URL-length limits with real margin, not just past the one
// observed failure.
const SHIPMENT_ID_BATCH_SIZE =
  200;

function chunk<T>(
  items: T[],
  size: number,
): T[][] {
  const batches: T[][] =
    [];

  for (let i = 0; i < items.length; i += size) {
    batches.push(
      items.slice(
        i,
        i + size,
      ),
    );
  }

  return batches;
}

export async function listPeriodShipmentLines(
  supabase: SupabaseClient,
  orgId: OrganizationId,
  period: ReportingPeriod,
): Promise<PeriodShipmentLinesResult> {
  const empty: PeriodShipmentLinesResult =
    { shipment_count: 0, lines: [] };

  const periodColumns =
    periodFilterColumns(
      period,
    );

  const shipmentRows: ShipmentRow[] =
    [];

  for (let offset = 0; ; offset += SHIPMENTS_PAGE_SIZE) {
    let pageQuery =
      supabase
        .from("shipments")
        .select(
          SHIPMENT_COLUMNS,
        )
        .eq("org_id", orgId)
        .eq("reporting_period_kind", periodColumns.reporting_period_kind)
        .eq("reporting_period_year", periodColumns.reporting_period_year)
        // A VOID shipment is retired (the sanctioned retirement path --
        // shipments has no DELETE policy at all, 20260828150000), not
        // "still in the period at zero relevance": before this filter
        // existed, a cancelled shipment's lines and calculation results
        // still flowed into every consumer of this fetch --
        // build-period-summary.ts's KPI total and all four breakdowns,
        // and both build-period-export-rows.ts exports (CSV/XLSX) -- with
        // no column anywhere in PeriodExportRow to show a reader the
        // figure included a cancelled shipment. Found live against local
        // Postgres: one VOIDed 999 tCO2e shipment alongside one READY 10
        // tCO2e shipment overstated the period total by ~100x. Excluding
        // VOID here, at the one shared fetch build-period-summary.ts and
        // build-period-export-rows.ts both read (see this function's own
        // doc comment on why it is shared rather than duplicated), fixes
        // both consumers at once rather than requiring each to filter
        // Shipment.status itself.
        .neq("status", "VOID")
        .order("id", { ascending: true })
        .range(
          offset,
          offset + SHIPMENTS_PAGE_SIZE - 1,
        );

    pageQuery =
      periodColumns.reporting_period_quarter === null
        ? pageQuery.is("reporting_period_quarter", null)
        : pageQuery.eq("reporting_period_quarter", periodColumns.reporting_period_quarter);

    const { data: pageRows, error: pageError } =
      await pageQuery;

    if (pageError || !pageRows) {
      return empty;
    }

    shipmentRows.push(
      ...(pageRows as ShipmentRow[]),
    );

    if (pageRows.length < SHIPMENTS_PAGE_SIZE) {
      break;
    }
  }

  const shipments =
    shipmentRows.map(
      (row) => toShipment(row),
    );

  if (shipments.length === 0) {
    return empty;
  }

  const shipmentIds =
    shipments.map(
      (shipment) => shipment.id,
    );

  const shipmentIdBatches =
    chunk(
      shipmentIds,
      SHIPMENT_ID_BATCH_SIZE,
    );

  const lineRows: ShipmentLineRow[] =
    [];

  // 2026-08-31 (final adversarial review, HIGH -- silent under-report).
  //
  // These per-batch fetches had NO `.range()`, so each was silently
  // truncated by PostgREST's `max_rows` exactly as this file's own
  // SHIPMENTS_PAGE_SIZE comment above warns -- the shipments fetch was
  // paged for precisely this reason and the lines fetch was not.
  //
  // A batch covers SHIPMENT_ID_BATCH_SIZE (200) shipments, so any period
  // averaging more than ~5 lines per shipment exceeded the 1000-row cap
  // and simply lost the remainder. The dropped lines then vanished from
  // build-period-summary.ts's period total and from both exports --
  // producing a LOWER embedded-emissions figure with no error, no
  // warning, and nothing in the output to show a reader the number was
  // partial. An under-report of a regulated figure that looks exactly
  // like a correct one is the worst failure mode this codebase has, and
  // is what its numeric discipline exists to rule out.
  for (const batch of shipmentIdBatches) {
    for (let offset = 0; ; offset += SHIPMENTS_PAGE_SIZE) {
      const { data: batchRows, error: lineError } =
        await supabase
          .from("shipment_lines")
          .select(
            SHIPMENT_LINE_COLUMNS,
          )
          .eq("org_id", orgId)
          .in("shipment_id", batch)
          .order("shipment_id", { ascending: true })
          .order("line_number", { ascending: true })
          .range(
            offset,
            offset + SHIPMENTS_PAGE_SIZE - 1,
          );

      if (lineError || !batchRows) {
        return empty;
      }

      lineRows.push(
        ...(batchRows as ShipmentLineRow[]),
      );

      if (batchRows.length < SHIPMENTS_PAGE_SIZE) {
        break;
      }
    }
  }

  const calculationRows: CalculationResultRow[] =
    [];

  // Same silent-truncation fix as the lines fetch above, and it matters
  // for the same reason: a line whose calculation row was dropped by the
  // cap renders as "not yet calculated" and contributes nothing to the
  // period total. An explicit `.order()` is required for `.range()` to
  // page deterministically -- without a stable sort, two pages can
  // overlap or skip rows.
  for (const batch of shipmentIdBatches) {
    for (let offset = 0; ; offset += SHIPMENTS_PAGE_SIZE) {
      const { data: batchRows, error: calculationError } =
        await supabase
          .from("latest_calculation_results")
          .select(
            "id, line_id, engine_version, embedded_emissions_tco2e, steps, calculated_at, determination",
          )
          .in("shipment_id", batch)
          .order("line_id", { ascending: true })
          .range(
            offset,
            offset + SHIPMENTS_PAGE_SIZE - 1,
          );

      if (calculationError) {
        return empty;
      }

      const pageRows =
        (batchRows ?? []) as CalculationResultRow[];

      calculationRows.push(
        ...pageRows,
      );

      if (pageRows.length < SHIPMENTS_PAGE_SIZE) {
        break;
      }
    }
  }

  const shipmentById =
    new Map<string, Shipment>(
      shipments.map(
        (shipment) => [shipment.id, shipment],
      ),
    );

  const calculationByLineId =
    new Map<string, PeriodLineCalculation>();

  for (const row of calculationRows) {
    calculationByLineId.set(
      row.line_id,
      {
        id: row.id as CalculationResultId,
        engine_version: row.engine_version,
        embedded_emissions_tco2e: row.embedded_emissions_tco2e as DecimalString,
        steps: row.steps,
        calculated_at: row.calculated_at as IsoTimestamp,
        determination: row.determination,
      },
    );
  }

  const lines: PeriodShipmentLine[] =
    [];

  for (const row of lineRows) {
    const line =
      toShipmentLine(
        row,
      );

    const shipment =
      shipmentById.get(
        line.shipment_id,
      );

    if (!shipment) {
      // Shouldn't happen -- every line queried above was filtered to a
      // shipment_id drawn from the first query's own results -- but
      // skipping rather than throwing matches this codebase's "never
      // crash the report" contract even if that invariant is ever
      // violated (see listActualDeterminedLines's own doc comment for
      // the identical defensive skip).
      continue;
    }

    lines.push(
      {
        shipment_id: line.shipment_id,
        shipment_reference: shipment.reference,
        line,
        calculation: calculationByLineId.get(line.id) ?? null,
      },
    );
  }

  return {
    shipment_count: shipments.length,
    lines,
  };
}
