import type {
  ActualEmissionSnapshot,
  EmissionData,
  RegulatoryResolutionSnapshot,
} from "./types";

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

/**
 * Live evidence-completeness check for an EmissionData record's CURRENT
 * state -- distinct from checkActualEmissionSnapshotCompleteness above,
 * which checks an already-constructed ActualEmissionSnapshot (a frozen
 * copy built only once a record is VERIFIED, with verifier_user_id/
 * resolved_at/etc. already populated as part of building it). This
 * function is what runs BEFORE any such snapshot can exist -- at
 * verifyEmissionData, activateEmissionData, and the final consumption
 * check in determine-from-actual-data.ts's fetchAuthorizedEmissionData
 * (src/application/emissions) -- so it can only look at what an
 * EmissionData row carries at every point in its lifecycle:
 * evidence_file_ids.
 *
 * Per the owner's blocking-model directive for verified/consumable
 * ACTUAL determinations: incomplete evidence must never let a record
 * become verified, activated, or consumed by an importer's
 * determination. This is the single function all three of those gates
 * call, so "complete" always means the same thing everywhere -- always
 * RE-DERIVED from the record's live evidence_file_ids, never a stored,
 * one-time flag. That matters because evidence_file_ids can shrink
 * after verification (removeEvidenceFile in
 * src/application/evidence/upload-evidence.ts does not itself gate
 * removal against verification_status -- a separate, tracked gap); a
 * one-time flag set at verification time would go stale the moment
 * evidence is later removed, silently leaving a now-incomplete record
 * still readable as VERIFIED. Re-deriving live at every gate closes
 * that consequence even though this function alone does not close the
 * write-side gap itself.
 *
 * Takes only the one field it actually needs (Pick, not the full
 * EmissionData) rather than mirroring
 * checkActualEmissionSnapshotCompleteness's "take the whole aggregate"
 * shape -- deliberate here because, unlike ActualEmissionSnapshot
 * (which exists only as a complete whole), EmissionData rows are read
 * with varying column sets by different call sites in this codebase
 * (e.g. upload-evidence.ts's fetchOwnedEmissionDataForEvidence selects
 * only entered_by_org_id, evidence_file_ids), so requiring the full
 * type here would force callers that already have just the array to
 * fabricate the rest.
 */
export function checkEmissionDataEvidenceCompleteness(
  record: Pick<EmissionData, "evidence_file_ids">,
): SnapshotCompletenessResult {
  const missingFields: string[] =
    [];

  if (record.evidence_file_ids.length === 0) {
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
