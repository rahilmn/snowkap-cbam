import type {
  MembershipId,
  OrganizationId,
  UserId,
} from "../shared/ids.js";

import type {
  CountryCode,
} from "../shared/country.js";

import type {
  IsoTimestamp,
} from "../shared/reporting-period.js";

/**
 * What an organization is set up to do on Snowkap. An organization may
 * hold both — the platform is one application serving both experiences,
 * not two separate apps (see docs/architecture/ARCHITECTURE.md).
 */
export type OrganizationCapability =
  | "IMPORTER_DECLARANT"
  | "PRODUCER_OPERATOR";

export type CbamDeclarantStatus =
  | "NOT_REGISTERED"
  | "APPLICATION_PENDING"
  | "AUTHORISED";

export interface Organization {
  id: OrganizationId;
  name: string;
  slug: string;

  capabilities: OrganizationCapability[];

  eori_number: string | null;
  cbam_declarant_status: CbamDeclarantStatus;

  // Reserved for a future capability: acting as the CBAM declarant of
  // record for other importer organizations. Not implemented in the
  // MVP; carried on the type now so the eventual migration is additive.
  acts_as_indirect_representative: boolean;

  country_of_establishment: CountryCode | null;

  created_at: IsoTimestamp;
}

export type MembershipRole =
  | "OWNER"
  | "ADMIN"
  | "MEMBER";

export interface Membership {
  id: MembershipId;
  org_id: OrganizationId;
  user_id: UserId;
  role: MembershipRole;
  created_at: IsoTimestamp;
}
