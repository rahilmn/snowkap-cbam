import type {
  EmissionDetermination,
} from "./types";

/**
 * A compact summary of an EmissionDetermination, shaped for an audit
 * event payload -- never the full RegulatoryResolutionSnapshot (whose
 * own R12 trace can be long) or the full ActualEmissionSnapshot. Enough
 * to answer "what was this line determined from before, and via which
 * method" without duplicating the entire frozen snapshot into every
 * audit row that changes it.
 *
 * Used by resolve-line-emissions.ts's performResolution and
 * determine-from-actual-data.ts's performDetermination to record a
 * `previous_determination` field on their audit payloads when an
 * existing determination is being replaced -- found missing in P7's
 * mandatory "actual-emissions logic" review: neither path previously
 * recorded the PRIOR state, only the new one, so an auditor asking "what
 * did this line's determination change from, and why" could not answer
 * that from the audit trail at all (docs/plans/MASTER_PLAN.md §21's
 * whole reason for existing).
 */
export function summarizeDeterminationForAudit(
  determination: EmissionDetermination | null,
): Record<string, unknown> | null {
  if (!determination) {
    return null;
  }

  if (determination.method === "DEFAULT") {
    // 2026-09-06 (S5 review remediation round 2, finding S5R2-A-B1).
    // `resolution` is typed as required on the DEFAULT branch, but a
    // determination frozen before this field existed carries no such
    // key (the same legacy shape finding A1 guards against in
    // determination-dataset-currency.ts). This function is called with
    // the PRIOR determination AFTER the shipment_lines UPDATE that
    // replaces it has already been issued (resolve-line-emissions.ts's
    // performResolution, manage-lines.ts's updateLine) -- an unguarded
    // throw here previously left the write committed with no
    // corresponding audit event, which is worse than a plain crash.
    // Optional-chained, matching that sibling fix's own posture.
    return {
      method: "DEFAULT",
      reason: determination.resolution?.reason ?? null,
      dataset_version: determination.resolution?.dataset_version ?? null,
    };
  }

  return {
    method: "ACTUAL",
    emission_data_id: determination.snapshot.emission_data_id,
    emission_data_version: determination.snapshot.emission_data_version,
    sharing_grant_id: determination.snapshot.sharing_grant_id,
  };
}
