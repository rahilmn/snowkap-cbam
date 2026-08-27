import type {
  EmissionDataId,
  InstallationId,
  OrganizationId,
  SharingGrantId,
  UserId,
} from "../shared/ids";

import type {
  IsoTimestamp,
} from "../shared/reporting-period";

import type {
  DecimalString,
} from "../shared/decimal";

import type {
  ReportingPeriod,
} from "../shared/reporting-period";

import type {
  RegulatoryValue,
  ResolutionReason,
  ResolutionTraceStep,
} from "../regulatory/types";

/**
 * A frozen copy of a regulatory default-value resolution, taken at the
 * moment a shipment line's emissions were determined. This is not a
 * reference to a regulatory record — it is a self-sufficient snapshot,
 * so a later dataset supersession can never change a historical result.
 * See docs/architecture/ARCHITECTURE.md ("Auditability") and
 * docs/regulatory/SOURCE_REGISTER.md rule 6.
 *
 * `direct`/`indirect`/`total` reuse the regulatory domain's
 * RegulatoryValue shape (type-only import) so a snapshot's statuses are
 * exactly the ones the resolver produced — never re-derived or
 * reinterpreted.
 */
export interface RegulatoryResolutionSnapshot {
  dataset_id: string;
  dataset_version: string;
  resolved_at: IsoTimestamp;
  reason: ResolutionReason;

  record_identity: {
    source_sheet: string;
    source_row: number;
    source_trade_code: string;
    origin_country_name: string;
    source_production_route_code: string | null;
  };

  values: {
    direct: RegulatoryValue;
    indirect: RegulatoryValue;
    total: RegulatoryValue;
  };

  emission_unit: string;
  trace: ResolutionTraceStep[];
}

/**
 * A frozen copy of a verified actual-emissions dataset, taken at the
 * moment a shipment line's emissions were determined from it. Like
 * RegulatoryResolutionSnapshot, this is self-sufficient: a later
 * supersession of the source EmissionData record, or revocation of the
 * sharing grant it was read through, can never alter a historical
 * result (see docs/architecture — "Shared Data / Relationship Model").
 */
export interface ActualEmissionSnapshot {
  emission_data_id: EmissionDataId;
  emission_data_version: number;
  installation_id: InstallationId;
  resolved_at: IsoTimestamp;

  values: {
    direct_specific: DecimalString;
    indirect_specific: DecimalString;
  };

  emission_unit: string;
  methodology: EmissionDataMethodology;

  verification: {
    status: Extract<VerificationStatus, "VERIFIED">;
    verifier_user_id: UserId;
  };

  evidence_file_ids: string[];

  // Present only when this snapshot was read across organizations
  // through a sharing grant (see src/domain/sharing/types.ts); absent
  // when the consuming line belongs to the same org that owns the
  // installation.
  sharing_grant_id: SharingGrantId | null;
}

export type EmissionDetermination =
  | { method: "DEFAULT"; resolution: RegulatoryResolutionSnapshot }
  | { method: "ACTUAL"; snapshot: ActualEmissionSnapshot };

export type EmissionDataMethodology =
  | "EU_METHOD"
  | "EQUIVALENT_METHOD"
  | "OTHER";

export type VerificationStatus =
  | "UNVERIFIED"
  | "VERIFICATION_PENDING"
  | "VERIFIED"
  | "REJECTED";

export type EmissionDataRecordStatus =
  | "DRAFT"
  | "ACTIVE"
  | "SUPERSEDED"
  | "DISCARDED";

/**
 * An operator's declared actual embedded emissions for one installation,
 * one CN-code scope, and one reporting period. Owned by the producer
 * organization that operates the installation (or, for an off-platform
 * producer, entered by an importer org with provenance marked — see
 * `entered_by_org_id` vs the installation's own org).
 */
export interface EmissionData {
  id: EmissionDataId;
  installation_id: InstallationId;
  entered_by_org_id: OrganizationId;

  cn_scope: string[];
  period: ReportingPeriod;

  direct_specific: DecimalString;
  indirect_specific: DecimalString;
  emission_unit: string;

  methodology: EmissionDataMethodology;

  verification_status: VerificationStatus;
  verifier_user_id: UserId | null;
  rejection_reason: string | null;

  evidence_file_ids: string[];

  // Monotonically increasing per installation+scope+period lineage;
  // supersession creates a new EmissionData row with version = predecessor + 1
  // and predecessor_id set, never mutates the predecessor.
  version: number;
  predecessor_id: EmissionDataId | null;

  status: EmissionDataRecordStatus;

  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}
