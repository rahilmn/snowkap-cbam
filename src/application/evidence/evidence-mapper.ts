import type {
  EvidenceFile,
} from "../../domain/evidence/types";

/**
 * Mirrors emission-data-mapper.ts's own EmissionDataRow/EMISSION_DATA_COLUMNS
 * shape -- a plain row type for what the client actually returns, plus a
 * single columns string so every query against evidence_files selects
 * exactly the same shape.
 */
export interface EvidenceFileRow {
  id: string;
  org_id: string;
  emission_data_id: string;
  storage_path: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  uploaded_by_user_id: string;
  created_at: string;
}

export const EVIDENCE_FILES_COLUMNS =
  "id, org_id, emission_data_id, storage_path, original_filename, mime_type, size_bytes, sha256, uploaded_by_user_id, created_at";

export function toEvidenceFile(
  row: EvidenceFileRow,
): EvidenceFile {
  return {
    id: row.id as EvidenceFile["id"],
    org_id: row.org_id as EvidenceFile["org_id"],
    emission_data_id: row.emission_data_id as EvidenceFile["emission_data_id"],
    storage_path: row.storage_path,
    original_filename: row.original_filename,
    mime_type: row.mime_type,
    size_bytes: row.size_bytes,
    sha256: row.sha256,
    uploaded_by_user_id: row.uploaded_by_user_id as EvidenceFile["uploaded_by_user_id"],
    created_at: row.created_at as EvidenceFile["created_at"],
  };
}
