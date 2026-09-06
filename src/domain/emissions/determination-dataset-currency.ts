import type {
  EmissionDetermination,
} from "./types";

/**
 * 2026-09-06 (S5 review remediation, findings A1/A3/A4/EF-B3). Shared,
 * pure comparison behind every "is this DEFAULT determination resolved
 * against a regulatory dataset that is still ACTIVE" check -- extracted
 * from compute-declaration-draft-facts.ts's own original
 * datasetIsCurrent() closure once a second, then a third and fourth,
 * call site needed the identical logic (get-declaration-detail.ts's
 * completeness_report_stale detector, build-period-summary.ts,
 * build-period-export-rows.ts, get-shipment-emissions-total.ts,
 * why-this-number-panel.tsx's own data source). A single shared
 * function means a future correctness fix here (like the legacy-shape
 * guard below, itself a fix for finding A1) lands everywhere at once,
 * rather than needing to be found and re-applied at each call site
 * independently.
 *
 * Meaningless for an ACTUAL determination (no regulatory dataset is
 * resolved for one) or a line with no determination at all -- `true`
 * either way, matching checkCalculationCurrency's own "meaningless case
 * defaults true, never itself the reason for a blocker" shape.
 *
 * `resolution` is typed as required on the DEFAULT branch, but that
 * promise is a compile-time fiction for a row frozen before this field
 * existed -- it round-trips through an unchecked jsonb column with no
 * runtime validation on read, and the live database holds exactly this
 * shape (finding A1). A missing/malformed dataset_id fails SAFE to
 * "not current" (needs redetermination) rather than throwing --
 * matching the SQL layer's own posture in
 * 20260906250000_s5_filing_refuses_superseded_dataset.sql, where
 * app.try_cast_uuid(...) returns NULL for the same shape and the
 * `not exists (...)` check counts that as superseded, never a crash.
 */
export function determinationDatasetIsCurrent(
  determination: EmissionDetermination | null,
  activeDatasetIds: ReadonlySet<string>,
): boolean {
  if (determination === null || determination.method !== "DEFAULT") {
    return true;
  }

  const datasetId =
    determination.resolution?.dataset_id;

  if (!datasetId) {
    return false;
  }

  return activeDatasetIds.has(
    datasetId,
  );
}
