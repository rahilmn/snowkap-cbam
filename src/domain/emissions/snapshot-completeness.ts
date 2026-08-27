import type {
  ActualEmissionSnapshot,
  RegulatoryResolutionSnapshot,
} from "./types.js";

export type SnapshotCompletenessResult =
  | { status: "COMPLETE" }
  | { status: "INCOMPLETE"; missingFields: string[] };

/**
 * A snapshot is only as good as an audit trail if every provenance field
 * on it is actually populated — a snapshot with an empty dataset_version
 * or an empty trace cannot satisfy SOURCE_REGISTER rule 6 or the
 * auditability chain in docs/architecture/ARCHITECTURE.md, even though
 * TypeScript's structural typing alone would accept it. This function
 * checks completeness at construction time; it reports every missing
 * field in one pass rather than failing on the first.
 */
export function checkRegulatoryResolutionSnapshotCompleteness(
  snapshot: RegulatoryResolutionSnapshot,
): SnapshotCompletenessResult {
  const missingFields: string[] =
    [];

  if (snapshot.dataset_id.length === 0) {
    missingFields.push(
      "dataset_id",
    );
  }

  if (snapshot.dataset_version.length === 0) {
    missingFields.push(
      "dataset_version",
    );
  }

  if (snapshot.resolved_at.length === 0) {
    missingFields.push(
      "resolved_at",
    );
  }

  if (snapshot.record_identity.source_sheet.length === 0) {
    missingFields.push(
      "record_identity.source_sheet",
    );
  }

  if (snapshot.record_identity.source_trade_code.length === 0) {
    missingFields.push(
      "record_identity.source_trade_code",
    );
  }

  if (snapshot.record_identity.origin_country_name.length === 0) {
    missingFields.push(
      "record_identity.origin_country_name",
    );
  }

  if (snapshot.emission_unit.length === 0) {
    missingFields.push(
      "emission_unit",
    );
  }

  if (snapshot.trace.length === 0) {
    missingFields.push(
      "trace",
    );
  }

  if (missingFields.length > 0) {
    return {
      status: "INCOMPLETE",
      missingFields,
    };
  }

  return {
    status: "COMPLETE",
  };
}

export function checkActualEmissionSnapshotCompleteness(
  snapshot: ActualEmissionSnapshot,
): SnapshotCompletenessResult {
  const missingFields: string[] =
    [];

  if (snapshot.emission_data_id.length === 0) {
    missingFields.push(
      "emission_data_id",
    );
  }

  if (snapshot.installation_id.length === 0) {
    missingFields.push(
      "installation_id",
    );
  }

  if (snapshot.resolved_at.length === 0) {
    missingFields.push(
      "resolved_at",
    );
  }

  if (snapshot.emission_unit.length === 0) {
    missingFields.push(
      "emission_unit",
    );
  }

  if (snapshot.verification.verifier_user_id.length === 0) {
    missingFields.push(
      "verification.verifier_user_id",
    );
  }

  if (snapshot.evidence_file_ids.length === 0) {
    missingFields.push(
      "evidence_file_ids",
    );
  }

  if (missingFields.length > 0) {
    return {
      status: "INCOMPLETE",
      missingFields,
    };
  }

  return {
    status: "COMPLETE",
  };
}
