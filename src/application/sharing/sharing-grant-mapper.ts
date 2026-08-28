import type {
  SharingGrant,
  SharingGrantStatus,
} from "../../domain/sharing/types";

/**
 * Row shape, mirroring EmissionDataRow in
 * src/application/emissions/emission-data-mapper.ts -- plain strings
 * for every branded/timestamp field, reconstructed into the domain
 * type by toSharingGrant below.
 */
export interface SharingGrantRow {
  id: string;
  grantor_org_id: string;
  grantee_org_id: string | null;
  invited_email: string | null;
  installation_id: string;
  status: string;
  created_by_user_id: string;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export const SHARING_GRANT_COLUMNS =
  "id, grantor_org_id, grantee_org_id, invited_email, installation_id, status, created_by_user_id, expires_at, created_at, updated_at";

export function toSharingGrant(
  row: SharingGrantRow,
): SharingGrant {
  return {
    id: row.id as SharingGrant["id"],
    grantor_org_id: row.grantor_org_id as SharingGrant["grantor_org_id"],
    grantee_org_id: row.grantee_org_id as SharingGrant["grantee_org_id"],
    invited_email: row.invited_email,
    installation_id: row.installation_id as SharingGrant["installation_id"],
    status: row.status as SharingGrantStatus,
    created_by_user_id: row.created_by_user_id as SharingGrant["created_by_user_id"],
    expires_at: row.expires_at as SharingGrant["expires_at"],
    created_at: row.created_at as SharingGrant["created_at"],
    updated_at: row.updated_at as SharingGrant["updated_at"],
  };
}
