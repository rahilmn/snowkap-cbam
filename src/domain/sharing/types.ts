import type {
  InstallationId,
  OrganizationId,
  SharingGrantId,
  UserId,
} from "../shared/ids";

import type {
  IsoTimestamp,
} from "../shared/reporting-period";

/**
 * INVITED -> ACTIVE -> REVOKED | EXPIRED. See docs/architecture,
 * "Shared Data / Relationship Model" (§9 of the master plan) for the
 * full design: a grant is installation-scoped, read-only, and confers
 * access only to that installation's ACTIVE + VERIFIED EmissionData
 * (plus its profile) — never a blanket organization relationship, and
 * never write access. Revocation/expiry end future reads only; any
 * ActualEmissionSnapshot already taken through this grant remains
 * valid, because it is a frozen copy (see
 * src/domain/emissions/types.ts).
 */
export type SharingGrantStatus =
  | "INVITED"
  | "ACTIVE"
  | "REVOKED"
  | "EXPIRED";

export interface SharingGrant {
  id: SharingGrantId;

  grantor_org_id: OrganizationId;

  // Null until an email invitation is accepted and resolves to a
  // grantee organization (the bootstrap path when the importer org
  // isn't yet known to the producer).
  grantee_org_id: OrganizationId | null;
  invited_email: string | null;

  installation_id: InstallationId;
  status: SharingGrantStatus;

  created_by_user_id: UserId;
  expires_at: IsoTimestamp | null;

  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}
