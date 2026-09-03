import type {
  EmissionDataId,
  InstallationId,
  OrganizationId,
  SharingGrantId,
  UserId,
} from "../shared/ids";

import type {
  InstallationRecordProvenance,
} from "../installations/types";

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
 * The outcome of translating a shipment line's ISO 3166-1 alpha-2
 * origin_country into the regulatory dataset's own country name (see
 * src/domain/shared/country.ts's CountryCode doc comment). MAPPED means
 * the ISO code has its own row in the regulatory `countries` table;
 * UNLISTED means it does not, in which case resolution proceeds
 * directly against the "Other Countries and Territories" fallback
 * geography (R7) rather than pretending the ISO code has a mapped
 * name. Recorded on the snapshot so the explanation UI can honestly
 * say *why* the fallback territory was used, distinct from the case
 * where a real, listed country simply had no country-specific record
 * (resolver reason OTHER_COUNTRIES_FALLBACK) -- see
 * src/domain/emissions/build-resolution-snapshot.ts.
 *
 * KNOWN OPEN GAP (docs/plans/MASTER_PLAN.md §41, "EU-origin scope
 * gate"): UNLISTED does not distinguish "a genuine third country
 * simply absent from the dataset" from "an EU member state, which is
 * out of CBAM scope entirely, not merely unlisted." Both currently
 * resolve through the same R7 fallback. This is a deliberate,
 * documented escalation -- not an oversight -- pending an owner
 * decision on how an in-scope/out-of-scope determination should enter
 * the system (it would need its own versioned regulatory dataset per
 * CLAUDE.md's facts-as-datasets rule, never a hardcoded country list).
 */
export type CountryMappingOutcome =
  | { status: "MAPPED"; regulatory_country_name: string }
  | { status: "UNLISTED" };

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

  country_mapping: CountryMappingOutcome;

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

  /**
   * 2026-09-03 (owner decision D2). WHERE these numbers came from,
   * frozen alongside them.
   *
   * OPERATOR_PROVIDED: the operator that runs the installation entered
   * this data themselves. IMPORTER_ENTERED: an importer transcribed
   * emissions information supplied by an external operator who does not
   * use Snowkap. Those are materially different claims about the same
   * figures, and a declarant relying on either has to be able to tell
   * which one they hold.
   *
   * Frozen rather than looked up, for the same reason every other field
   * here is: the installation's provenance is immutable today, but a
   * calculation's explanation must not depend on a live read that could
   * fail, be revoked, or be answered differently later.
   *
   * Validated in the database against the installation's own provenance
   * (migration 20260903120000) -- without that it would be a decorative
   * field a raw PostgREST write could set to anything.
   *
   * OPTIONAL because determinations frozen before D2 existed carry no
   * such key. Absent means "frozen before this field existed", never
   * "unknown provenance": every write since D2 sets it.
   */
  record_provenance?: InstallationRecordProvenance;

  /**
   * 2026-09-04 (owner decision 7). WHICH PERIOD of emissions data this
   * calculation used, frozen alongside the numbers.
   *
   * The snapshot already froze which record (emission_data_id) and
   * which version of it. It did not freeze what that record was a
   * measurement OF. A producer's installation has one ACTIVE record per
   * period, so "which record" and "which period" look interchangeable
   * while you are looking at live data -- and stop being so the moment
   * the record is superseded, discarded, or read across a grant that is
   * later revoked. A frozen calculation has to be able to answer
   * "emissions data for which period?" without a live read, because the
   * live read is exactly what may no longer be available or may now
   * answer differently.
   *
   * This freezes provenance, not a rule. It makes no claim about
   * whether a dataset period is legally required to match the
   * shipment's -- that question is open and is recorded as an owner
   * decision, and inventing an answer here would be worse than leaving
   * it open.
   *
   * Validated in the database against the emission_data row's own
   * reporting period (migration 20260904130000), for the same reason
   * record_provenance is: without that it would be a decorative field a
   * raw PostgREST write could set to anything, and every surface that
   * reads the snapshot would repeat the claim.
   *
   * OPTIONAL because determinations frozen before this existed carry no
   * such key. Absent means "frozen before this field existed", never
   * "unknown period": every write since sets it.
   */
  dataset_reporting_period?: ReportingPeriod;
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
