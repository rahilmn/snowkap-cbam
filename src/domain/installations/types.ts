import type {
  InstallationId,
  OperatorId,
  OrganizationId,
  SupplierId,
} from "../shared/ids.js";

import type {
  CountryCode,
} from "../shared/country.js";

import type {
  IsoTimestamp,
} from "../shared/reporting-period.js";

/**
 * Distinguishes a record entered directly by the producer that owns it
 * from one an importer entered on behalf of an off-platform producer
 * that has no Snowkap account. See docs/architecture — "Regulatory role
 * model": a Supplier (commercial counterparty) is deliberately not the
 * same concept as an Operator (the entity that runs a production
 * Installation) — a commercial relationship may exist independently of
 * who operates the installation.
 */
export type InstallationRecordProvenance =
  | "OPERATOR_PROVIDED"
  | "IMPORTER_ENTERED";

export interface Operator {
  id: OperatorId;
  org_id: OrganizationId;
  provenance: InstallationRecordProvenance;

  name: string;
  country: CountryCode;
  contact_email: string | null;

  created_at: IsoTimestamp;
}

export interface Installation {
  id: InstallationId;
  operator_id: OperatorId;
  org_id: OrganizationId;
  provenance: InstallationRecordProvenance;

  name: string;
  country: CountryCode;
  un_locode: string | null;
  address: string | null;

  // Reserved for a future CBAM registry identifier; not required today.
  cbam_installation_id: string | null;

  created_at: IsoTimestamp;
}

/**
 * A commercial counterparty on the importer side. Distinct from
 * Operator/Installation by design (see the module doc comment above) —
 * a Supplier record may optionally link to the Operator/Installation
 * that actually produces the goods, but does not have to.
 */
export interface Supplier {
  id: SupplierId;
  org_id: OrganizationId;

  name: string;
  country: CountryCode | null;
  contact_name: string | null;
  contact_email: string | null;

  linked_operator_id: OperatorId | null;
  linked_installation_ids: InstallationId[];

  created_at: IsoTimestamp;
}
