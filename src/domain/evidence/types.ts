import type {
  EmissionDataId,
  EvidenceFileId,
  OrganizationId,
  UserId,
} from "../shared/ids";

import type {
  IsoTimestamp,
} from "../shared/reporting-period";

/**
 * A supporting document (test report, certificate, invoice, ...)
 * attached to one EmissionData row -- see
 * supabase/migrations/20260829240000_p7c_evidence_files_schema.sql's
 * header comment for the table this mirrors. Immutable once uploaded:
 * a mistake is removed and re-uploaded, never edited in place, so
 * there is no "update" shape for this type.
 *
 * `size_bytes`/`sha256` are always computed server-side from the
 * actual uploaded bytes (see validate-evidence-upload.ts and
 * src/application/evidence/upload-evidence.ts) -- never trusted from
 * client input.
 */
export interface EvidenceFile {
  id: EvidenceFileId;
  org_id: OrganizationId;
  emission_data_id: EmissionDataId;

  storage_path: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;

  uploaded_by_user_id: UserId;
  created_at: IsoTimestamp;
}
