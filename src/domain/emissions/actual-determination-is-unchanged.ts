import type {
  ActualEmissionSnapshot,
  EmissionDetermination,
} from "./types";

import type {
  SharingGrantId,
} from "../shared/ids";

/**
 * The facts a fresh ACTUAL determination would freeze, as they exist
 * right now on the source record and the grant it is being read
 * through.
 *
 * Deliberately NOT an `EmissionData` row: this predicate must be given
 * exactly the fields that end up in the snapshot, so a future field
 * added to `ActualEmissionSnapshot` produces a type error here rather
 * than being silently omitted from the comparison. `resolved_at` is
 * absent because it is the one field a redetermination is always
 * expected to change.
 */
export interface CandidateActualDetermination {
  emission_data_id: ActualEmissionSnapshot["emission_data_id"];
  emission_data_version: ActualEmissionSnapshot["emission_data_version"];
  installation_id: ActualEmissionSnapshot["installation_id"];
  direct_specific: ActualEmissionSnapshot["values"]["direct_specific"];
  indirect_specific: ActualEmissionSnapshot["values"]["indirect_specific"];
  emission_unit: ActualEmissionSnapshot["emission_unit"];
  methodology: ActualEmissionSnapshot["methodology"];
  verifier_user_id: ActualEmissionSnapshot["verification"]["verifier_user_id"];
  evidence_file_ids: readonly string[];
  sharing_grant_id: SharingGrantId | null;
}

/**
 * Would redetermining this line from this record produce a snapshot
 * materially identical to the one it already carries?
 *
 * WHY THIS IS A FULL-SNAPSHOT COMPARISON AND NOT `id + version`.
 *
 * The obvious no-op guard -- "same emission_data_id and same
 * emission_data_version, therefore nothing changed" -- is degenerate.
 * `version` is fact-immutable per row (20260829240000), so a given
 * emission_data_id ALWAYS carries the same version: the pair adds
 * nothing to the id alone, and both together miss the two ways a
 * redetermination of the very same record genuinely changes the frozen
 * facts:
 *
 * 1. THE EVIDENCE SET CAN STILL GROW. uploadEvidenceFile never checks
 *    verification status, and the fact-immutability trigger
 *    deliberately omits evidence_file_ids, so files can be attached to
 *    an ACTIVE + VERIFIED record after a determination froze its
 *    evidence list. Meanwhile the v10 validator (20260902140000)
 *    compares the frozen evidence set byte-for-byte against the live
 *    one. A snapshot can therefore drift into a state the database
 *    would now REJECT, and redetermination is the only repair. An
 *    id-only guard would refuse to perform that repair -- freezing the
 *    line in a state the validator rejects, which is worse than the
 *    no-op it was written to prevent.
 *
 * 2. THE GRANT CAN CHANGE. If grant A is revoked and the producer
 *    issues grant B for the same installation, the same record is now
 *    being read through a different grant. The snapshot's
 *    sharing_grant_id is the provenance of the read, and
 *    record_shared_data_consumption must fire under grant B so the
 *    GRANTOR's audit stream records that their data was read again.
 *    Suppressing the redetermination suppresses that audit event on
 *    the producer's side -- a compliance gap on the party with the
 *    least visibility.
 *
 * So the comparison covers every field the snapshot freezes.
 * `resolved_at` is excluded: it is the timestamp OF the freezing, and
 * a redetermination that changes only it is exactly the no-op this
 * predicate exists to catch.
 *
 * Evidence ids are compared ORDER-INSENSITIVELY, matching how the v10
 * validator compares them (`array_agg(x order by x)`,
 * 20260902140000:198-208) -- so this predicate and the trigger cannot
 * disagree about whether two evidence sets are the same.
 *
 * Returns false for a DEFAULT determination and for no determination
 * at all: in both cases a fresh ACTUAL determination changes the line.
 */
export function actualDeterminationIsUnchanged(
  current: EmissionDetermination | null,
  candidate: CandidateActualDetermination,
): boolean {
  if (current === null || current.method !== "ACTUAL") {
    return false;
  }

  const snapshot =
    current.snapshot;

  return (
    snapshot.emission_data_id === candidate.emission_data_id &&
    snapshot.emission_data_version === candidate.emission_data_version &&
    snapshot.installation_id === candidate.installation_id &&
    snapshot.values.direct_specific === candidate.direct_specific &&
    snapshot.values.indirect_specific === candidate.indirect_specific &&
    snapshot.emission_unit === candidate.emission_unit &&
    snapshot.methodology === candidate.methodology &&
    snapshot.verification.status === "VERIFIED" &&
    snapshot.verification.verifier_user_id === candidate.verifier_user_id &&
    snapshot.sharing_grant_id === candidate.sharing_grant_id &&
    evidenceSetsMatch(
      snapshot.evidence_file_ids,
      candidate.evidence_file_ids,
    )
  );
}

/**
 * Set equality over evidence ids, order-insensitive.
 *
 * A plain sorted-join comparison would be enough for the ids the
 * database actually stores (uuids, unique per row), but duplicates are
 * compared as multiset members rather than collapsed, so a frozen list
 * holding the same id twice is not reported as equal to a live list
 * holding it once. The frozen value is data read back from JSONB; it is
 * not this function's job to assume it is well-formed.
 */
function evidenceSetsMatch(
  frozen: readonly string[],
  live: readonly string[],
): boolean {
  if (frozen.length !== live.length) {
    return false;
  }

  const frozenSorted =
    [...frozen].sort();

  const liveSorted =
    [...live].sort();

  return frozenSorted.every(
    (id, index) =>
      id === liveSorted[index],
  );
}
