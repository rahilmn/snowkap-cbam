export type CodeLevel =
  | "HS4"
  | "HS6"
  | "CN8"
  | "TARIC10";

export type ValueStatus =
  | "AVAILABLE"
  | "UNAVAILABLE"
  | "REFERENCE_REQUIRED"
  | "NOT_APPLICABLE"
  | "SOURCE_TEXT";

export type ResolutionReason =
  | "EXACT_TARIC_MATCH"
  | "EXACT_CN8_MATCH"
  | "EXACT_HS6_MATCH"
  | "EXACT_HS4_MATCH"
  | "OTHER_COUNTRIES_FALLBACK"
  | "REFERENCE_REQUIRED"
  | "UNAVAILABLE"
  | "NOT_APPLICABLE"
  | "AMBIGUOUS"
  | "NO_MATCH";

export interface RegulatoryValue {
  value: string | null;
  status: ValueStatus;
  raw_source_value: string | null;
}

export interface RegulatoryRecord {
  dataset_id: string;
  dataset_version: string;

  origin_country_name: string;
  source_sheet: string;
  source_row: number;

  source_trade_code: string;
  normalized_trade_code: string;
  code_level: CodeLevel;

  sector: string;
  product_name: string;

  emission_unit: string;

  direct_emissions: RegulatoryValue;
  indirect_emissions: RegulatoryValue;
  total_emissions: RegulatoryValue;

  source_production_route_code: string | null;
  production_route: string | null;
}

export interface DefaultValueResolutionInput {
  origin_country_name: string;
  trade_code: string;
  production_route?: string | null;
}

export interface ResolutionTraceStep {
  step: string;
  outcome: string;
}

export interface DefaultValueResolutionResult {
  status:
    | "RESOLVED"
    | "UNRESOLVED";

  reason: ResolutionReason;

  record: RegulatoryRecord | null;

  trace: ResolutionTraceStep[];
}

/**
 * A CBAM good candidate, for shipment-line classification (P4, §20) --
 * distinct from RegulatoryRecord, which is keyed to a specific
 * emission-value resolution (dataset+country+route). This is just the
 * cbam_goods row itself: does a declared trade code correspond to a
 * real CBAM good, and if so, what unit does it require.
 */
export interface CbamGoodSummary {
  trade_code: string;
  trade_code_type: string;
  record_level: string;
  sector: string;
  description: string;

  // "TONNES" | "MWH" today (cbam_goods_functional_unit_check) --
  // carried as the raw string rather than a narrowed union so a
  // future functional_unit value doesn't require a type change here,
  // matching how ValueStatus/ResolutionReason above are also plain
  // enumerations the domain trusts the database's own CHECK
  // constraints to police, not re-validated in TypeScript.
  functional_unit: string;
}

/**
 * A production route candidate, for the shipment line editor's route
 * picker (§20). `source_route_indicator` is what
 * docs/adr/ADR-0010-emission-provenance-and-route-contract.md calls
 * the resolver contract: the raw indicator, not `name`, is what a
 * later regulatory resolution (P5) must be called with.
 */
export interface ProductionRouteSummary {
  name: string;
  source_route_indicator: string;
  sector: string;
}