export interface RegulatoryDatasetRow {
  id: string;
  dataset_type: string;
  version: string;
  status: string;
}

export interface RegulatoryCountryRow {
  id: string;
  name: string;
}

export interface RegulatoryGoodRow {
  id: string;
  trade_code: string;
  trade_code_type: string;
  record_level: string;
  sector: string;
  description: string;
}

export interface RegulatoryRouteRow {
  id: string;
  name: string;
  source_route_indicator: string | null;
}

export interface RegulatoryEmissionValueRow {
  dataset_id: string;
  good_id: string;
  country_id: string;

  direct_value: string | null;
  direct_status: string;
  direct_raw_source_value: string | null;

  indirect_value: string | null;
  indirect_status: string;
  indirect_raw_source_value: string | null;

  total_value: string | null;
  total_status: string;
  total_raw_source_value: string | null;

  production_route_id: string | null;

  source_sheet: string;
  source_row: number;
  source_trade_code: string;

  emission_unit: string;
}