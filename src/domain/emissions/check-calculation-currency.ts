import type {
  EmissionDetermination,
} from "./types";

export type CalculationCurrency =
  | "CURRENT"
  | "STALE";

/**
 * Structural equality for two jsonb-sourced EmissionDetermination values
 * -- deliberately NOT a JSON.stringify(...) === JSON.stringify(...)
 * comparison. Postgres jsonb storage does not preserve object key
 * insertion order (confirmed on the `emission_determination`/
 * `determination` columns this function's two arguments are read from --
 * shipment_lines.emission_determination and calculation_results.
 * determination, both jsonb), so the exact same logical determination can
 * come back with its keys in a different order depending on which of the
 * two columns it was read from. A naive string comparison would then
 * report STALE for a genuinely current calculation -- exactly the false
 * alarm this check exists to never produce. File-local rather than
 * exported: reproduce-calculation-result.ts's own `deepEqual` already
 * exists for the identical reason on the identical column, kept as its
 * own file-local copy per this codebase's established convention for a
 * small helper used by exactly one file (see e.g.
 * list-period-shipment-lines.ts's own periodFilterColumns doc comment).
 */
function determinationsEqual(
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
      (item, index) => determinationsEqual(item, b[index]),
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
      (key) => key in bRecord && determinationsEqual(aRecord[key], bRecord[key]),
    )
  );
}

/**
 * Does a shipment line's latest calculation_results row still reflect
 * the line's CURRENT emission_determination, or has the line been
 * re-determined (or had its determination cleared by a quantity/cn_code
 * edit) since that calculation was produced?
 *
 * 2026-08-29, P13 adversarial audit, live-reproduced: shipment_lines
 * stays fully writable while its parent shipment is READY (only LOCKED/
 * VOID block writes), so a line can be re-determined
 * (resolve-line-emissions.ts's redetermineLineEmissions /
 * determine-from-actual-data.ts's redetermineLineFromActualData -- the
 * exact workflow emissions-cell.tsx's own "Stale -- newer data
 * available" badge prompts an importer into) or edited (manage-lines.ts's
 * updateLine, which deliberately nulls emission_determination on a
 * quantity/cn_code change) WITHOUT the line's calculation_results being
 * touched at all -- that table is append-only, and neither redetermine
 * path nor updateLine ever writes to it. public.record_declaration_filed()
 * now refuses to file over this drift (folded into its existing
 * INCOMPLETE path); this function is the same fact, computed the same
 * way, for two earlier surfacing points: compute-declaration-draft-facts.ts
 * (completeness-check time, before filing is even attempted) and the
 * shipment detail screen's own calculation-cell.tsx/why-this-number-panel.tsx
 * (as soon as the drift exists, before a declaration is even drafted).
 *
 * `calculatedAgainst` is the calculation_results row's own frozen
 * `determination` -- never null (that column is `not null`, and only a
 * COMPUTED result is ever persisted, so a calculation always was
 * calculated against SOME determination). `currentDetermination` is the
 * line's *current* shipment_lines.emission_determination, which CAN be
 * null (a cleared, not-yet-redetermined line) -- structurally never
 * equal to a non-null `calculatedAgainst`, so that case correctly
 * reports STALE too, the same way jsonb `is distinct from` does in the
 * SQL version of this same check.
 *
 * Never queries anything itself (src/domain/** depends on nothing
 * outside itself, per CLAUDE.md's layering rules) -- both values are
 * supplied by the caller, matching this module's own sibling
 * check-actual-snapshot-staleness.ts's shape (a different staleness
 * concern -- a newer ACTIVE emission_data version -- checked the same
 * "caller fetches, this function only compares" way).
 */
export function checkCalculationCurrency(
  calculatedAgainst: EmissionDetermination,
  currentDetermination: EmissionDetermination | null,
): CalculationCurrency {
  return determinationsEqual(calculatedAgainst, currentDetermination)
    ? "CURRENT"
    : "STALE";
}
