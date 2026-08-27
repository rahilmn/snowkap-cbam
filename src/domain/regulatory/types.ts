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
  | "HS6_REFERENCE"
  | "HS4_REFERENCE"
  | "OTHER_COUNTRIES_FALLBACK"
  | "UNAVAILABLE"
  | "REFERENCE_REQUIRED"
  | "NOT_APPLICABLE"
  | "NO_MATCH";

export interface RegulatoryValue {
  value: string | null;
  status: ValueStatus;
  raw_source_value: string | null;
}

export interface RegulatoryRecord {
  dataset_id: string;

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
  origin_country: string;
  trade_code: string;

  production_route?: string | null;
}

export interface DefaultValueResolutionResult {
  status:
    | "RESOLVED"
    | "UNRESOLVED";

  reason: ResolutionReason;

  record: RegulatoryRecord | null;

  trace: ResolutionTraceStep[];
}

export interface ResolutionTraceStep {
  step: string;
  outcome: string;
}