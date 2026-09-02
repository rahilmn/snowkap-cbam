import type {
  SupabaseClient,
} from "@supabase/supabase-js";

import {
  calculateLineEmissions,
} from "../../domain/calculations/calculate-line-emissions";

import {
  ENGINE_VERSION,
  type CalculationQuantityUnit,
  type CalculationStatus,
  type CalculationStep,
} from "../../domain/calculations/types";

import type {
  EmissionDetermination,
} from "../../domain/emissions/types";

import type {
  DecimalString,
} from "../../domain/shared/decimal";

import type {
  CalculationResultId,
  OrganizationId,
} from "../../domain/shared/ids";

import type {
  RegulatoryRepository,
} from "../../infrastructure/regulatory/regulatory-repository";

import {
  resolveGoodSectorForActualLine,
} from "./calculate-line";

const CALCULATION_RESULT_COLUMNS =
  "org_id, line_id, shipment_id, engine_version, quantity, quantity_unit, determination, steps, embedded_emissions_tco2e";

interface CalculationResultRow {
  org_id: string;
  line_id: string;
  shipment_id: string;
  engine_version: string;
  quantity: DecimalString;
  quantity_unit: CalculationQuantityUnit;
  determination: EmissionDetermination;
  steps: CalculationStep[];
  embedded_emissions_tco2e: DecimalString;
}

/**
 * One side of a MISMATCH -- just the two fields the engine actually
 * produces (calculate-line-emissions.ts's COMPUTED branch), not a full
 * CalculationResult row. Kept identical shape on both `stored` and
 * `recomputed` so a downstream UI can diff them with one component
 * instead of two.
 */
export interface ReproductionSide {
  steps: CalculationStep[];
  embedded_emissions_tco2e: DecimalString;
}

/**
 * The outcome of re-running the pure engine against one
 * calculation_results row's own frozen inputs and comparing the result
 * to what was stored -- the "reproduction proof" docs/plans/MASTER_PLAN.md
 * Β§17/Β§21 and P8's own contract require ("same inputs + engine_version =>
 * byte-identical output, re-provable on demand").
 *
 * - REPRODUCIBLE: the recomputed steps and embedded_emissions_tco2e are
 *   an exact match for the stored ones.
 * - MISMATCH: they differ. Carries both sides so a caller (an admin
 *   check, a UI) can show the diff rather than just "it doesn't match" --
 *   this should never happen for a row produced by the current engine
 *   from unmodified inputs, so surfacing *what* differs matters for
 *   diagnosing which of those two assumptions broke.
 * - ENGINE_VERSION_CHANGED: the row's engine_version no longer matches
 *   the running ENGINE_VERSION constant. The pure engine
 *   (calculate-line-emissions.ts) has no notion of "recompute under an
 *   older version" -- it always runs as the code exists today -- so a
 *   genuinely meaningful byte-equality check is only possible for rows
 *   produced by the current version. This is an honest, named
 *   non-computable state, not a failure: same never-fabricate-a-result
 *   posture as CalculationStatus's own non-COMPUTED variants
 *   (src/domain/calculations/types.ts), applied here to the
 *   reproduction check itself rather than to a fresh calculation.
 * - NOT_FOUND: no row with this id in this org. Deliberately the same
 *   outcome for "doesn't exist" and "exists in a different org" -- the
 *   cross-org IDOR defense calculateLine's own org_id check already
 *   establishes (calculate-line.ts) applied here too, so a caller can
 *   never distinguish "wrong id" from "someone else's calculation."
 * - INPUTS_DRIFTED (added in the P8 security review, finding #1): the
 *   row's frozen quantity/determination recompute fine, but a *current*
 *   fact this function re-derives from elsewhere for the engine --
 *   today, only good_sector, re-derived from the line's *current*
 *   cn_code (resolveCnCodeForLine) -- itself sends the pure engine down
 *   a non-COMPUTED path (e.g. PARAMETER_DATASET_UNAVAILABLE). This is
 *   not a MISMATCH (the two sides were never actually compared) and not
 *   ENGINE_VERSION_CHANGED (the recorded engine_version still matches):
 *   it means a fact the row depends on has moved since it was
 *   calculated. Concretely, manage-lines.ts's updateShipmentLine allows
 *   editing a DRAFT/READY shipment's cn_code in place -- it clears the
 *   line's own emission_determination, but calculation_results is
 *   append-only, so the pre-edit row survives as the *latest* row for
 *   that line and can land in a different Annex II gate on
 *   re-derivation than the one the original calculation saw. Carries
 *   the actual non-COMPUTED status the recompute returned, so a caller
 *   can explain *what* drifted rather than just failing.
 */
export type ReproductionResult =
  | { status: "REPRODUCIBLE" }
  | {
      status: "MISMATCH";
      stored: ReproductionSide;
      recomputed: ReproductionSide;
    }
  | {
      status: "ENGINE_VERSION_CHANGED";
      storedEngineVersion: string;
      currentEngineVersion: string;
    }
  | {
      status: "INPUTS_DRIFTED";
      recomputedStatus: Exclude<CalculationStatus, "COMPUTED">;
    }
  | { status: "NOT_FOUND" };

/**
 * The inverse of calculate-line.ts's own quantityInput: that function
 * goes from a shipment_lines row (net_mass_tonnes/quantity_mwh, exactly
 * one non-null per isLineQuantityValid) to the engine's quantity input;
 * this goes from a calculation_results row's own frozen quantity/
 * quantity_unit columns back to the same net_mass_tonnes/quantity_mwh
 * shape calculateLineEmissions expects. Not shared as one function with
 * that one -- the two run in opposite directions over differently
 * shaped structs, so a single shared helper would still need an
 * if/else per direction.
 */
function quantityFieldsFromRow(
  row: CalculationResultRow,
): { net_mass_tonnes: DecimalString | null; quantity_mwh: DecimalString | null } {
  return row.quantity_unit === "TONNES"
    ? { net_mass_tonnes: row.quantity, quantity_mwh: null }
    : { net_mass_tonnes: null, quantity_mwh: row.quantity };
}

/**
 * The line's own cn_code, for resolveGoodSectorForActualLine's second
 * argument. A separate query from that function's own shipments lookup
 * (mirroring this codebase's sequential-queries-over-joins convention,
 * see resolveGoodSectorForActualLine's own doc comment) -- unlike
 * calculateLine, which already has the line row in hand from its own
 * fetch, reproduceCalculationResult only starts with a
 * calculation_results row, which does not carry cn_code itself.
 *
 * Expected to always resolve: line_id references shipment_lines(id) on
 * delete cascade (20260829180000_p6_calculation_results_schema.sql), so
 * a calculation_results row cannot outlive the line it was calculated
 * for. Returns null on the (should-be-unreachable) case it doesn't --
 * resolveGoodSectorForActualLine already treats a null cnCode-lookup
 * failure the same way it treats a null release_date lookup failure
 * (no match => don't gate), so this degrades the same direction its own
 * "unexpected-data-drift, not a normal outcome" case does.
 */
async function resolveCnCodeForLine(
  supabase: SupabaseClient,
  lineId: string,
): Promise<string | null> {
  const { data } =
    await supabase
      .from("shipment_lines")
      .select(
        "cn_code",
      )
      .eq("id", lineId)
      .maybeSingle();

  return (data as { cn_code: string } | null)?.cn_code ?? null;
}

/**
 * Structural equality for the engine's own JSON-shaped output
 * (CalculationStep[], and by extension its `inputs` record) --
 * deliberately NOT a JSON.stringify(...) === JSON.stringify(...)
 * comparison, because Postgres's jsonb storage does not preserve
 * object key insertion order (confirmed on the `determination`/`steps`
 * columns, both jsonb -- 20260829180000_p6_calculation_results_schema.sql),
 * so a stored step's `inputs` object can come back with its keys in a
 * different order than the freshly recomputed one even when every
 * key/value pair is identical. A naive string comparison would then
 * report MISMATCH for a genuinely reproducible row -- exactly the kind
 * of false alarm this check exists to never produce.
 */
function deepEqual(
  a: unknown,
  b: unknown,
): boolean {
  if (a === b) {
    return true;
  }

  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }

    return a.every(
      (item, index) => deepEqual(item, b[index]),
    );
  }

  const aRecord =
    a as Record<string, unknown>;

  const bRecord =
    b as Record<string, unknown>;

  const aKeys =
    Object.keys(aRecord);

  const bKeys =
    Object.keys(bRecord);

  return (
    aKeys.length === bKeys.length &&
    aKeys.every(
      (key) => key in bRecord && deepEqual(aRecord[key], bRecord[key]),
    )
  );
}

/**
 * Re-runs the pure engine against one calculation_results row's own
 * frozen inputs and reports whether it reproduces byte-for-byte --
 * P8's own contract ("reproduction proof (CI test + on-demand admin
 * check recomputing stored results from their snapshots with the
 * recorded engine_version, asserting byte-equality)"), the on-demand
 * half of that pair.
 *
 * The CI half is tests/integration/calculation-reproduction.test.ts.
 * Until 2026-09-03 this comment claimed that test existed when it did
 * not: the only coverage was a fully mocked unit test, and
 * tests/golden/foundation.test.ts was a seven-line stub asserting
 * true === true. It now exists and runs against real local Postgres and
 * the real regulatory dataset -- a line classified, determined,
 * calculated and persisted for real, then reproduced -- alongside
 * hand-authored engine goldens in tests/golden/.
 *
 * Verifies the fetched row's own org_id against the caller's orgId
 * before proceeding, collapsing "no such row" and "row belongs to a
 * different org" into the same NOT_FOUND outcome -- the identical
 * not-found-not-forbidden IDOR defense calculateLine's own org_id check
 * already applies to shipment_lines (calculate-line.ts), applied here
 * to calculation_results.
 *
 * good_sector is re-derived exactly as calculateLine derives it at
 * calculation time (same resolveGoodSectorForActualLine, only consulted
 * for an ACTUAL determination) rather than stored on the row itself.
 * shipment_id.release_date is a stable, immutable historical fact (no
 * update path exists for it -- only create-shipment.ts ever writes it),
 * but line_id.cn_code is NOT: manage-lines.ts's updateShipmentLine
 * allows editing a DRAFT/READY shipment's cn_code in place (P4/P5's
 * append-only convention applies to calculation_results, not to the
 * line itself). Re-deriving from the line's *current* cn_code therefore
 * usually reproduces the exact sector the original calculation saw, but
 * not always -- see ReproductionResult's own INPUTS_DRIFTED variant
 * above for the case where it doesn't (found in the P8 security review,
 * finding #1, against an earlier version of this comment that claimed
 * cn_code was immutable post-classification the same way release_date
 * is).
 */
export async function reproduceCalculationResult(
  supabase: SupabaseClient,
  repository: RegulatoryRepository,
  orgId: OrganizationId,
  calculationResultId: CalculationResultId,
): Promise<ReproductionResult> {
  const { data, error } =
    await supabase
      .from("calculation_results")
      .select(
        CALCULATION_RESULT_COLUMNS,
      )
      .eq("id", calculationResultId)
      // Wall 1 (application), same as listAuditEvents's own explicit
      // org_id filter (list-audit-events.ts) -- RLS
      // (calculation_results_select_own_org) is Wall 2, but this
      // should not be the only line standing between a forged id and a
      // stranger org's row, per master plan §126's "two walls, always
      // both". Also narrows correctly for a user who belongs to
      // multiple orgs: RLS alone would admit rows from any of the
      // caller's orgs, not just the currently-active one (P8 security
      // review, finding #3) -- the row.org_id !== orgId check just
      // below stays too, as a second, independent guard against the
      // same class of mistake, matching this row's own IDOR posture.
      .eq("org_id", orgId)
      .maybeSingle();

  // ReproductionResult has no dedicated "fetch failed" state (only the
  // named variants P8's contract calls for) -- a genuine query error is
  // folded into NOT_FOUND rather than fabricating a new state, same as
  // how a cross-org row is folded into it below.
  if (error || !data) {
    return {
      status: "NOT_FOUND",
    };
  }

  const row =
    data as unknown as CalculationResultRow;

  if (row.org_id !== orgId) {
    return {
      status: "NOT_FOUND",
    };
  }

  if (row.engine_version !== ENGINE_VERSION) {
    return {
      status: "ENGINE_VERSION_CHANGED",
      storedEngineVersion: row.engine_version,
      currentEngineVersion: ENGINE_VERSION,
    };
  }

  const goodSector =
    row.determination.method === "ACTUAL"
      ? await (
          async () => {
            const cnCode =
              await resolveCnCodeForLine(
                supabase,
                row.line_id,
              );

            return cnCode === null
              ? null
              : resolveGoodSectorForActualLine(
                  supabase,
                  repository,
                  row.shipment_id,
                  cnCode,
                );
          }
        )()
      : null;

  const recomputed =
    calculateLineEmissions(
      {
        ...quantityFieldsFromRow(
          row,
        ),
        emission_determination: row.determination,
        good_sector: goodSector,
      },
    );

  if (recomputed.status !== "COMPUTED") {
    // Reachable -- NOT the "calculation_results only ever persists a
    // COMPUTED result, so this can't happen" case this used to claim
    // (found wrong in the P8 security review, finding #1): good_sector
    // is re-derived from the line's *current* cn_code (see this
    // function's own doc comment on resolveCnCodeForLine and
    // INPUTS_DRIFTED), and manage-lines.ts's updateShipmentLine can
    // change that cn_code in place after the row was calculated,
    // moving it into a different Annex II gate on recompute. Reported
    // as a named outcome a caller renders, not thrown -- same
    // never-fabricate-a-result posture as every other named
    // ReproductionResult/CalculationStatus variant, applied to "the
    // recompute couldn't even run" rather than crashing the Server
    // Action that calls this (verifyCalculationReproducibilityAction,
    // app/(importer)/shipments/[id]/actions.ts).
    return {
      status: "INPUTS_DRIFTED",
      recomputedStatus: recomputed.status,
    };
  }

  const stored: ReproductionSide =
    {
      steps: row.steps,
      embedded_emissions_tco2e: row.embedded_emissions_tco2e,
    };

  const recomputedSide: ReproductionSide =
    {
      steps: recomputed.steps,
      embedded_emissions_tco2e: recomputed.embedded_emissions_tco2e,
    };

  if (
    deepEqual(stored.steps, recomputedSide.steps) &&
    stored.embedded_emissions_tco2e === recomputedSide.embedded_emissions_tco2e
  ) {
    return {
      status: "REPRODUCIBLE",
    };
  }

  return {
    status: "MISMATCH",
    stored,
    recomputed: recomputedSide,
  };
}
