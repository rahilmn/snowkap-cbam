import type {
  InvitationId,
  MembershipId,
  OrganizationId,
  UserId,
} from "../shared/ids";

import type {
  CountryCode,
} from "../shared/country";

import type {
  IsoTimestamp,
} from "../shared/reporting-period";

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

  // Null = active. Non-null = offboarded (master plan §14): the person
  // holds no access anywhere — app.user_org_ids() and
  // app.user_is_admin_or_owner_of() both skip the row
  // (20260829360000) — but the row survives so their historical
  // audit_events still resolve to a person rather than a bare uuid.
  // Every invariant in ./invariants.ts that counts owners counts
  // ACTIVE owners only; a deactivated OWNER can no longer satisfy an
  // org's one-owner minimum.
  deactivated_at: IsoTimestamp | null;
}

// OWNER is deliberately excluded from what an invite can grant --
// granting ownership is a separate, more deliberate action than a
// routine invite (see the migration's header comment).
export type InvitableRole =
  | "ADMIN"
  | "MEMBER";

export type InvitationStatus =
  | "PENDING"
  | "ACCEPTED"
  | "REVOKED"
  | "EXPIRED";

export interface Invitation {
  id: InvitationId;
  org_id: OrganizationId;
  email: string;
  role: InvitableRole;
  status: InvitationStatus;
  invited_by: UserId;
  created_at: IsoTimestamp;
  expires_at: IsoTimestamp;
}

/**
 * The CBAM sectors an org may self-declare it works in (SME Experience
 * v2.1.1, S1) -- mirrors the canonical `cbam_goods.sector` vocabulary
 * (the regulatory dataset's own enum) rather than inventing a
 * different one, but is deliberately its own type: this is an
 * organization's self-declared identity, not a line's classified
 * sector, and never flows into a calculation or an authorization
 * check (organization_profiles migration header comment).
 *
 * ELECTRICITY is a real member of the regulatory dataset's own sector
 * enum, but is refused by the application layer in v1 (no default
 * values are loaded for electricity yet) -- see
 * parseOnboardingSetupSubmission.
 */
export type CbamSector =
  | "CEMENT"
  | "FERTILISERS"
  | "IRON_STEEL"
  | "ALUMINIUM"
  | "HYDROGEN"
  | "ELECTRICITY";

export interface OrganizationSmeProfile {
  org_id: OrganizationId;
  sectors: CbamSector[];
  onboarding_completed_at: IsoTimestamp | null;
  updated_at: IsoTimestamp;
  updated_by_user_id: UserId | null;
}
