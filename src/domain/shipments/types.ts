import type {
  OrganizationId,
  ShipmentId,
  ShipmentLineId,
} from "../shared/ids.js";

import type {
  CountryCode,
} from "../shared/country.js";

import type {
  DecimalString,
} from "../shared/decimal.js";

import type {
  IsoDate,
  IsoTimestamp,
  ReportingPeriod,
} from "../shared/reporting-period.js";

import type {
  EmissionDetermination,
} from "../emissions/types.js";

export type ShipmentStatus =
  | "DRAFT"
  | "READY"
  | "LOCKED"
  | "VOID";

/**
 * RELEASE_FOR_FREE_CIRCULATION is the ordinary CBAM-relevant customs
 * procedure; INWARD_PROCESSING is carried on the type now because it
 * affects liability differently, even though that calculation is not
 * implemented until the calculation-engine phase (see
 * docs/regulatory/CALCULATION_RULE_REGISTER.md, to be authored before
 * that phase).
 */
export type CustomsProcedure =
  | "RELEASE_FOR_FREE_CIRCULATION"
  | "INWARD_PROCESSING";

export interface Shipment {
  id: ShipmentId;
  org_id: OrganizationId;

  reference: string;
  release_date: IsoDate;
  reporting_period: ReportingPeriod;

  customs_mrn: string | null;
  customs_procedure: CustomsProcedure | null;

  status: ShipmentStatus;
  lines: ShipmentLine[];

  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export type CnCodeLevel =
  | "CN8"
  | "TARIC10";

/**
 * Both the human-readable route name and the raw source indicator
 * (e.g. "(C)") are stored: the regulatory resolver's contract is that
 * production_route input means the raw indicator, not the name (see
 * docs/architecture/REGULATORY_RESOLUTION_RULES.md, "Resolver
 * contract" section) — the product layer always has both on hand so it
 * never has to guess which one a caller meant.
 */
export interface ShipmentLineProductionRoute {
  name: string;
  source_route_indicator: string;
}

export interface ShipmentLine {
  id: ShipmentLineId;
  shipment_id: ShipmentId;
  org_id: OrganizationId;

  line_number: number;

  cn_code: string;
  cn_code_level: CnCodeLevel;
  goods_description: string | null;

  origin_country: CountryCode;

  // Exactly one of these is set (electricity is metered in MWh;
  // everything else in tonnes) — see isLineQuantityValid in
  // invariants.ts.
  net_mass_tonnes: DecimalString | null;
  quantity_mwh: DecimalString | null;

  production_route: ShipmentLineProductionRoute | null;

  // Immutable once set by the resolution/actual-emissions workflow
  // (Phase 5/7) — replacing it is an explicit, audited re-determination,
  // not a plain field update. Enforced at the persistence layer, not
  // representable purely in this type.
  emission_determination: EmissionDetermination | null;
}
