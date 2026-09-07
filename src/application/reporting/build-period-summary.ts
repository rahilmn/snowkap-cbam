import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import type {
  DecimalString,
  DecimalValue,
} from "../../domain/shared/decimal";

import {
  checkCalculationCurrency,
} from "../../domain/emissions/check-calculation-currency";

import {
  determinationDatasetIsCurrent,
} from "../../domain/emissions/determination-dataset-currency";

import {
  toDecimal,
  toDecimalString,
} from "../../domain/shared/decimal";

import type {
  OrganizationId,
  ShipmentId,
  ShipmentLineId,
} from "../../domain/shared/ids";

import type {
  ShipmentStatus,
} from "../../domain/shipments/types";

import type {
  ReportingPeriod,
} from "../../domain/shared/reporting-period";

import {
  listPeriodShipmentLines,
  type PeriodShipmentLine,
} from "./list-period-shipment-lines";

// The determination-method breakdown's key for a line with no
// emission_determination at all yet -- an explicit third bucket
// alongside "DEFAULT"/"ACTUAL" (EmissionDetermination["method"]) rather
// than omitting such lines from this breakdown, per this task's own
// "visible, not hidden" requirement for an incomplete state (and see
// UNSPECIFIED_PRODUCTION_ROUTE_LABEL below for the same reasoning
// applied to the production-route breakdown).
export const NOT_DETERMINED_BREAKDOWN_KEY =
  "NOT_DETERMINED";

// Mirrors lines-table.tsx's and why-this-number-panel.tsx's own
// `line.production_route?.name ?? "—"` display convention exactly, so
// this breakdown's key is already the label the Reports screen renders
// -- not a second, differently-worded placeholder a caller would have
// to remember to reconcile with the rest of the product's UI.
export const UNSPECIFIED_PRODUCTION_ROUTE_LABEL =
  "—";

export type IncompleteLineReason =
  // line.emission_determination is null -- never yet determined. (An
  // in-progress "unresolved" resolution attempt, per
  // why-this-number-panel.tsx's own doc comment, is never persisted --
  // resolve-line-emissions.ts never writes a line it couldn't
  // determine -- so from this function's read-only, post-hoc view over
  // shipment_lines there is exactly one way a line can still lack a
  // determination, not two.)
  | "NO_DETERMINATION"
  // Determined (DEFAULT or ACTUAL), but no calculation_results row
  // exists for it yet.
  | "NOT_CALCULATED"
  // 2026-09-03 (P14). A calculation_results row exists, but it was
  // computed against a DIFFERENT emission_determination than the line
  // carries now -- redetermined without being recalculated.
  //
  // Counted as incomplete rather than calculated, and its figure kept
  // out of every total, because the filing gate already refuses exactly
  // this state (record_declaration_filed folds it into INCOMPLETE, and
  // buildCompletenessReport blocks READY on it). A period report that
  // published the stale figure was publishing a number the product
  // itself would not let anyone file -- with no indication that is what
  // it was.
  | "CALCULATION_STALE";

export interface IncompletePeriodLine {
  shipment_id: ShipmentId;
  shipment_reference: string;
  line_id: ShipmentLineId;
  line_number: number;
  cn_code: string;
  reason: IncompleteLineReason;
}

/**
 * 2026-09-06 (S5 review remediation, finding A4). A CALCULATED,
 * CURRENT-calculation line (so it's counted in total_embedded_emissions_tco2e
 * and every breakdown, same as any other calculated line -- this is
 * deliberately NOT excluded the way a CALCULATION_STALE line is) whose
 * DEFAULT determination is resolved against a regulatory_datasets row
 * that is no longer ACTIVE. Listed separately from incomplete_lines
 * because it is the opposite kind of fact: the figure IS in the total,
 * but a caller (a declarant deciding whether to trust this report, or
 * an export consumer) needs to know it is a figure the filing gate
 * would currently refuse (LINE_DATASET_SUPERSEDED,
 * src/domain/declarations/completeness.ts) -- see this module's own
 * doc comment for why dropping it from the total instead would just
 * substitute one wrong total for another.
 */
export interface DatasetSupersededPeriodLine {
  shipment_id: ShipmentId;
  shipment_reference: string;
  // 2026-09-07 (S5 review round 6, finding S5R6-A-GUID2). Lets the
  // Reports page tell a LOCKED shipment's line apart from an editable
  // one -- "redetermine this line/them before filing" is categorically
  // impossible for a LOCKED shipment (shipments_update_own_org_not_terminal
  // excludes LOCKED; transition-actions.tsx renders no control at all
  // for one), and a LOCKED member shipment is the routine shape of an
  // amendment (already fixed on the declaration detail/completeness-
  // report screens, S5R3-VOCAB-B1/S5R6-A-B2) -- the period report had no
  // way to make the same distinction at all.
  shipment_status: ShipmentStatus;
  line_id: ShipmentLineId;
  line_number: number;
  cn_code: string;
}

/**
 * 2026-09-07 (S5 review round 10, finding S5R10-NUM-B1). The engine-
 * version sibling of DatasetSupersededPeriodLine -- see that interface's
 * own doc comment for the shared reasoning (stays IN the total/
 * breakdowns rather than being excluded, because the calculation itself
 * is a genuine, correctly-computed value; this is a staleness SIGNAL,
 * not a correction). Round 8 (S5R8-A-B2) propagated this fact to the
 * declaration-level completeness gate but never here.
 */
export interface EngineOutdatedPeriodLine {
  shipment_id: ShipmentId;
  shipment_reference: string;
  shipment_status: ShipmentStatus;
  line_id: ShipmentLineId;
  line_number: number;
  cn_code: string;
}

/**
 * One bucket of the period's line population, sliced by one dimension
 * (CN code / origin country / production route / determination
 * method). `calculated_line_count` is always <= `line_count`;
 * `embedded_emissions_tco2e` is the Decimal-precision sum of ONLY the
 * calculated lines in this bucket, and is `null` -- never `"0"` -- when
 * `calculated_line_count` is 0, matching this codebase's "never treat
 * no value as value is zero" posture (CLAUDE.md, protected-zone
 * section; applied here to a plain aggregation for the identical
 * reason it applies to a single regulatory value: a total with
 * uncalculated lines folded into it as zero would be a wrong number
 * that reads as a right one). A bucket whose total is genuinely
 * "some calculated, some not" still reports a non-null
 * `embedded_emissions_tco2e` -- callers must read `calculated_line_count`
 * against `line_count` to know whether that figure is partial, the
 * same way the top-level PeriodSummary fields below work together.
 */
export interface PeriodBreakdownEntry {
  key: string;
  line_count: number;
  calculated_line_count: number;
  embedded_emissions_tco2e: DecimalString | null;
}

export interface PeriodSummary {
  period: ReportingPeriod;

  // Independent of line_count -- see list-period-shipment-lines.ts's
  // own doc comment on PeriodShipmentLinesResult.shipment_count for why
  // (a shipment with no lines yet still counts as "a shipment exists in
  // this period").
  shipment_count: number;
  line_count: number;
  calculated_line_count: number;

  // Decimal-precision sum across every calculated line in the period,
  // via decimal.js (through src/domain/shared/decimal.ts, never
  // decimal.js directly -- see that file's own doc comment on why it is
  // the only src/domain file allowed to import the package, and
  // tests/architecture/layering-rules.ts's own DECIMAL_ALLOWED_FILES,
  // which does not gate src/application at all -- this module is
  // exactly the kind of "widen a DecimalString to add several of them"
  // application-layer arithmetic that calculate-line-emissions.ts (the
  // one src/domain/calculations file permitted to import decimal.js
  // itself) also does, just one layer up). `null` when
  // calculated_line_count is 0 -- see PeriodBreakdownEntry's own doc
  // comment for the reasoning, which applies identically here.
  total_embedded_emissions_tco2e: DecimalString | null;

  breakdown_by_cn_code: PeriodBreakdownEntry[];
  breakdown_by_origin_country: PeriodBreakdownEntry[];
  breakdown_by_production_route: PeriodBreakdownEntry[];
  breakdown_by_determination_method: PeriodBreakdownEntry[];

  // Every line still missing a determination or a calculation, listed
  // (not merely counted) -- this task's own "an explicit count+list...
  // visible, not hidden" requirement, and the same posture P8's audit
  // trail and P5/P7's resolution UI already apply to every other
  // incomplete regulatory state in this codebase.
  incomplete_lines: IncompletePeriodLine[];

  // 2026-09-06 (S5 review remediation, finding A4). Every CALCULATED,
  // CURRENT line whose regulatory dataset has since been superseded --
  // see DatasetSupersededPeriodLine's own doc comment for why these
  // stay IN total_embedded_emissions_tco2e/the breakdowns rather than
  // being excluded like incomplete_lines.
  dataset_superseded_lines: DatasetSupersededPeriodLine[];

  // 2026-09-07 (S5 review round 10, finding S5R10-NUM-B1). Every
  // CALCULATED, CURRENT line whose latest calculation was produced by
  // an engine version the app no longer runs -- see
  // EngineOutdatedPeriodLine's own doc comment.
  engine_outdated_lines: EngineOutdatedPeriodLine[];
}

interface BreakdownAccumulator {
  line_count: number;
  calculated_line_count: number;
  total: DecimalValue | null;
}

function addToBreakdown(
  buckets: Map<string, BreakdownAccumulator>,
  key: string,
  amount: DecimalValue | null,
): void {
  const bucket =
    buckets.get(key) ?? { line_count: 0, calculated_line_count: 0, total: null };

  bucket.line_count += 1;

  if (amount !== null) {
    bucket.calculated_line_count += 1;

    bucket.total =
      bucket.total ? bucket.total.plus(amount) : amount;
  }

  buckets.set(
    key,
    bucket,
  );
}

// Sorted by key (not insertion order) -- a report is read/exported
// repeatedly across a period's lifetime as more lines get calculated,
// and a stable, deterministic ordering (rather than "whichever line
// happened to be fetched first") is what makes two renders of the same
// underlying data comparable, matching listActualDeterminedLines' own
// "deterministic, not insertion order" sort discipline.
function toBreakdownEntries(
  buckets: Map<string, BreakdownAccumulator>,
): PeriodBreakdownEntry[] {
  return Array.from(buckets.entries())
    .map(
      ([key, bucket]) => (
        {
          key,
          line_count: bucket.line_count,
          calculated_line_count: bucket.calculated_line_count,
          embedded_emissions_tco2e:
            bucket.total ? toDecimalString(bucket.total) : null,
        }
      ),
    )
    .sort(
      (a, b) => a.key.localeCompare(b.key),
    );
}

/**
 * 2026-09-03 (P14). Is this line's stored calculation actually a
 * calculation OF this line, as it stands now?
 *
 * checkCalculationCurrency existed and was used on the shipment detail
 * screen, but nothing under src/application/reporting/** ever called it.
 * So a line redetermined after being calculated -- the exact workflow
 * the "Stale -- newer data available" badge prompts an importer into --
 * contributed its superseded figure to the period KPI, to every
 * breakdown, and to both export formats.
 *
 * The number that produced is not merely out of date. It is a number
 * the product refuses to let anyone file: record_declaration_filed
 * treats this state as INCOMPLETE and buildCompletenessReport blocks
 * READY on it. A report and a declaration disagreeing about the same
 * period, silently, is worse than either being wrong on its own.
 */
function calculationIsCurrent(
  entry: PeriodShipmentLine,
): boolean {
  if (entry.calculation === null) {
    return false;
  }

  return checkCalculationCurrency(
    entry.calculation.determination,
    entry.line.emission_determination,
  ) === "CURRENT";
}

function incompleteReasonFor(
  entry: PeriodShipmentLine,
): IncompleteLineReason {
  if (
    entry.calculation !== null &&
    entry.line.emission_determination !== null
  ) {
    return "CALCULATION_STALE";
  }

  return entry.line.emission_determination === null
    ? "NO_DETERMINATION"
    : "NOT_CALCULATED";
}

/**
 * Builds the period-reporting summary (master plan §27 screen 21) for
 * one org + reporting period: total line/shipment counts, the
 * Decimal-precision embedded-emissions total, four breakdowns, and the
 * full list of lines still missing a determination or a calculation.
 * Reads listPeriodShipmentLines once and reduces it -- see that
 * function's own doc comment for the underlying three-query fetch and
 * why it is shared with build-period-export-rows.ts rather than
 * duplicated.
 *
 * Every DecimalString addition goes through toDecimal/toDecimalString
 * (src/domain/shared/decimal.ts) and `DecimalValue.plus`, never JS `+`
 * -- summing embedded_emissions_tco2e with floating-point arithmetic
 * would silently reintroduce the exact class of precision loss
 * DecimalString exists to rule out (see decimal.ts's own doc comment).
 */
export async function buildPeriodSummary(
  supabase: SupabaseClient,
  orgId: OrganizationId,
  period: ReportingPeriod,
): Promise<PeriodSummary> {
  const { shipment_count, lines } =
    await listPeriodShipmentLines(
      supabase,
      orgId,
      period,
    );

  // 2026-09-06 (S5 review remediation, finding A4). One small query for
  // the whole period, same "fetched once per call, not per line"
  // shape compute-declaration-draft-facts.ts's own identical fetch
  // uses -- regulatory_datasets carries no org scoping.
  const { data: activeDatasetRows, error: activeDatasetError } =
    await supabase
      .from("regulatory_datasets")
      .select(
        "id",
      )
      .eq("status", "ACTIVE");

  if (activeDatasetError) {
    throw new Error(
      `reporting: active regulatory datasets fetch failed (${activeDatasetError.message}).`,
    );
  }

  const activeDatasetIds =
    new Set(
      ((activeDatasetRows ?? []) as { id: string }[]).map(
        (row) => row.id,
      ),
    );

  // 2026-09-07 (S5 review round 10, finding S5R10-NUM-B1). The engine-
  // version sibling of the activeDatasetIds fetch just above -- same
  // "one small query for the whole period" shape, same reason
  // (current_engine_version() carries no org scoping).
  const { data: currentEngineVersionData, error: currentEngineVersionError } =
    await supabase
      .rpc(
        "current_engine_version",
      );

  if (currentEngineVersionError) {
    throw new Error(
      `reporting: current engine version fetch failed (${currentEngineVersionError.message}).`,
    );
  }

  const currentEngineVersion =
    currentEngineVersionData as string;

  const datasetSupersededLines: DatasetSupersededPeriodLine[] =
    [];

  const engineOutdatedLines: EngineOutdatedPeriodLine[] =
    [];

  const cnCodeBreakdown =
    new Map<string, BreakdownAccumulator>();

  const originCountryBreakdown =
    new Map<string, BreakdownAccumulator>();

  const productionRouteBreakdown =
    new Map<string, BreakdownAccumulator>();

  const determinationMethodBreakdown =
    new Map<string, BreakdownAccumulator>();

  const incompleteLines: IncompletePeriodLine[] =
    [];

  let calculatedLineCount =
    0;

  let total: DecimalValue | null =
    null;

  for (const entry of lines) {
    // A stale calculation contributes NOTHING -- not its old figure,
    // not a zero. Treated exactly like a line that was never
    // calculated, which is how the filing gate already treats it.
    const amount =
      calculationIsCurrent(entry)
        ? toDecimal(entry.calculation!.embedded_emissions_tco2e)
        : null;

    if (amount) {
      calculatedLineCount += 1;

      total =
        total ? total.plus(amount) : amount;

      // 2026-09-06 (S5 review remediation, finding A4). A CURRENT
      // calculation can still be resolved against a now-superseded
      // dataset -- checkCalculationCurrency (calculationIsCurrent
      // above) only ever compares a determination against itself,
      // never against live regulatory state, so this is a genuinely
      // independent check, not a narrowing of the one above.
      if (
        !determinationDatasetIsCurrent(
          entry.line.emission_determination,
          activeDatasetIds,
        )
      ) {
        datasetSupersededLines.push(
          {
            shipment_id: entry.shipment_id,
            shipment_reference: entry.shipment_reference,
            shipment_status: entry.shipment_status,
            line_id: entry.line.id,
            line_number: entry.line.line_number,
            cn_code: entry.line.cn_code,
          },
        );
      }

      // 2026-09-07 (S5 review round 10, finding S5R10-NUM-B1). A CURRENT
      // calculation can still have been produced by an engine version
      // the app no longer runs -- a genuinely independent check from
      // the dataset-supersession one above, matching how the two are
      // independent axes everywhere else this fact is tracked
      // (buildCompletenessReport, computeCompletenessReportStaleness).
      if (entry.calculation!.engine_version !== currentEngineVersion) {
        engineOutdatedLines.push(
          {
            shipment_id: entry.shipment_id,
            shipment_reference: entry.shipment_reference,
            shipment_status: entry.shipment_status,
            line_id: entry.line.id,
            line_number: entry.line.line_number,
            cn_code: entry.line.cn_code,
          },
        );
      }
    } else {
      incompleteLines.push(
        {
          shipment_id: entry.shipment_id,
          shipment_reference: entry.shipment_reference,
          line_id: entry.line.id,
          line_number: entry.line.line_number,
          cn_code: entry.line.cn_code,
          reason: incompleteReasonFor(entry),
        },
      );
    }

    addToBreakdown(
      cnCodeBreakdown,
      entry.line.cn_code,
      amount,
    );

    addToBreakdown(
      originCountryBreakdown,
      entry.line.origin_country,
      amount,
    );

    addToBreakdown(
      productionRouteBreakdown,
      entry.line.production_route?.name ?? UNSPECIFIED_PRODUCTION_ROUTE_LABEL,
      amount,
    );

    addToBreakdown(
      determinationMethodBreakdown,
      entry.line.emission_determination?.method ?? NOT_DETERMINED_BREAKDOWN_KEY,
      amount,
    );
  }

  incompleteLines.sort(
    (a, b) => {
      if (a.shipment_reference !== b.shipment_reference) {
        return a.shipment_reference.localeCompare(
          b.shipment_reference,
        );
      }

      return a.line_number - b.line_number;
    },
  );

  datasetSupersededLines.sort(
    (a, b) => {
      if (a.shipment_reference !== b.shipment_reference) {
        return a.shipment_reference.localeCompare(
          b.shipment_reference,
        );
      }

      return a.line_number - b.line_number;
    },
  );

  engineOutdatedLines.sort(
    (a, b) => {
      if (a.shipment_reference !== b.shipment_reference) {
        return a.shipment_reference.localeCompare(
          b.shipment_reference,
        );
      }

      return a.line_number - b.line_number;
    },
  );

  return {
    period,
    shipment_count,
    line_count: lines.length,
    calculated_line_count: calculatedLineCount,
    total_embedded_emissions_tco2e: total ? toDecimalString(total) : null,
    breakdown_by_cn_code: toBreakdownEntries(cnCodeBreakdown),
    breakdown_by_origin_country: toBreakdownEntries(originCountryBreakdown),
    breakdown_by_production_route: toBreakdownEntries(productionRouteBreakdown),
    breakdown_by_determination_method: toBreakdownEntries(determinationMethodBreakdown),
    incomplete_lines: incompleteLines,
    dataset_superseded_lines: datasetSupersededLines,
    engine_outdated_lines: engineOutdatedLines,
  };
}
