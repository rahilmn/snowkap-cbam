import type {
  Shipment,
  ShipmentLine,
} from "../../domain/shipments/types";

import type {
  ReportingPeriod,
} from "../../domain/shared/reporting-period";

export interface ShipmentRow {
  id: string;
  org_id: string;
  reference: string;
  release_date: string;
  reporting_period_kind: "ANNUAL" | "QUARTERLY";
  reporting_period_year: number;
  reporting_period_quarter: 1 | 2 | 3 | 4 | null;
  customs_mrn: string | null;
  customs_procedure: Shipment["customs_procedure"];
  status: Shipment["status"];
  created_at: string;
  updated_at: string;
}

export interface ShipmentLineRow {
  id: string;
  shipment_id: string;
  org_id: string;
  line_number: number;
  cn_code: string;
  cn_code_level: ShipmentLine["cn_code_level"];
  goods_description: string | null;
  origin_country: string;
  net_mass_tonnes: string | null;
  quantity_mwh: string | null;
  production_route_name: string | null;
  production_route_indicator: string | null;
  emission_determination: ShipmentLine["emission_determination"];
}

function toReportingPeriod(
  row: Pick<ShipmentRow, "reporting_period_kind" | "reporting_period_year" | "reporting_period_quarter">,
): ReportingPeriod {
  if (row.reporting_period_kind === "ANNUAL") {
    return {
      kind: "ANNUAL",
      year: row.reporting_period_year,
    };
  }

  return {
    kind: "QUARTERLY",
    year: row.reporting_period_year,
    quarter: row.reporting_period_quarter as 1 | 2 | 3 | 4,
  };
}

/**
 * Maps a bare shipments row (no lines) -- callers that need the full
 * Shipment.lines populated (get-shipment-detail.ts) compose this with
 * toShipmentLine separately, since not every read needs the lines
 * (list-shipments.ts, for instance, intentionally never fetches them).
 */
export function toShipment(
  row: ShipmentRow,
  lines: ShipmentLine[] = [],
): Shipment {
  return {
    id: row.id as Shipment["id"],
    org_id: row.org_id as Shipment["org_id"],
    reference: row.reference,
    release_date: row.release_date as Shipment["release_date"],
    reporting_period: toReportingPeriod(
      row,
    ),
    customs_mrn: row.customs_mrn,
    customs_procedure: row.customs_procedure,
    status: row.status,
    lines,
    created_at: row.created_at as Shipment["created_at"],
    updated_at: row.updated_at as Shipment["updated_at"],
  };
}

export function toShipmentLine(
  row: ShipmentLineRow,
): ShipmentLine {
  return {
    id: row.id as ShipmentLine["id"],
    shipment_id: row.shipment_id as ShipmentLine["shipment_id"],
    org_id: row.org_id as ShipmentLine["org_id"],
    line_number: row.line_number,
    cn_code: row.cn_code,
    cn_code_level: row.cn_code_level,
    goods_description: row.goods_description,
    origin_country: row.origin_country as ShipmentLine["origin_country"],
    net_mass_tonnes: row.net_mass_tonnes as ShipmentLine["net_mass_tonnes"],
    quantity_mwh: row.quantity_mwh as ShipmentLine["quantity_mwh"],
    production_route:
      row.production_route_name && row.production_route_indicator
        ? {
            name: row.production_route_name,
            source_route_indicator: row.production_route_indicator,
          }
        : null,
    emission_determination: row.emission_determination,
  };
}

export const SHIPMENT_COLUMNS =
  "id, org_id, reference, release_date, reporting_period_kind, reporting_period_year, reporting_period_quarter, customs_mrn, customs_procedure, status, created_at, updated_at";

export const SHIPMENT_LINE_COLUMNS =
  "id, shipment_id, org_id, line_number, cn_code, cn_code_level, goods_description, origin_country, net_mass_tonnes, quantity_mwh, production_route_name, production_route_indicator, emission_determination";
