import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  OrganizationId,
  ShipmentId,
  ShipmentLineId,
} from "../../domain/shared/ids";

import type {
  IsoDate,
  IsoTimestamp,
} from "../../domain/shared/reporting-period";

import type {
  CountryCode,
} from "../../domain/shared/country";

import type {
  DecimalString,
} from "../../domain/shared/decimal";

import type {
  ShipmentLine,
} from "../../domain/shipments/types";

import type {
  ShipmentLineRow,
  ShipmentRow,
} from "./shipment-mapper";

import {
  toShipment,
  toShipmentLine,
} from "./shipment-mapper";

function baseShipmentRow(
  overrides: Partial<ShipmentRow> = {},
): ShipmentRow {
  return {
    id: "shipment-1",
    org_id: "org-1",
    reference: "SHIP-REF-1",
    release_date: "2026-03-15",
    reporting_period_kind: "ANNUAL",
    reporting_period_year: 2026,
    reporting_period_quarter: null,
    customs_mrn: "MRN-1",
    customs_procedure: "RELEASE_FOR_FREE_CIRCULATION",
    status: "DRAFT",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    ...overrides,
  };
}

function baseShipmentLineRow(
  overrides: Partial<ShipmentLineRow> = {},
): ShipmentLineRow {
  return {
    id: "line-1",
    shipment_id: "shipment-1",
    org_id: "org-1",
    line_number: 1,
    cn_code: "72071190",
    cn_code_level: "CN8",
    goods_description: "Semi-finished products of iron",
    origin_country: "CN",
    net_mass_tonnes: "10.5",
    quantity_mwh: null,
    production_route_name: null,
    production_route_indicator: null,
    emission_determination: null,
    ...overrides,
  };
}

describe(
  "toShipment",
  () => {
    it(
      "maps a full ANNUAL row (with the given lines) to a Shipment, round-tripping every field including type-branded IDs",
      () => {
        const row =
          baseShipmentRow();

        const line: ShipmentLine =
          {
            id: "line-1" as ShipmentLineId,
            shipment_id: "shipment-1" as ShipmentId,
            org_id: "org-1" as OrganizationId,
            line_number: 1,
            cn_code: "72071190",
            cn_code_level: "CN8",
            goods_description: null,
            origin_country: "CN" as CountryCode,
            net_mass_tonnes: "10.5" as DecimalString,
            quantity_mwh: null,
            production_route: null,
            emission_determination: null,
          };

        const result =
          toShipment(
            row,
            [line],
          );

        expect(
          result,
        ).toEqual(
          {
            id: "shipment-1" as ShipmentId,
            org_id: "org-1" as OrganizationId,
            reference: "SHIP-REF-1",
            release_date: "2026-03-15" as IsoDate,
            reporting_period: {
              kind: "ANNUAL",
              year: 2026,
            },
            customs_mrn: "MRN-1",
            customs_procedure: "RELEASE_FOR_FREE_CIRCULATION",
            status: "DRAFT",
            lines: [line],
            created_at: "2026-01-01T00:00:00Z" as IsoTimestamp,
            updated_at: "2026-01-02T00:00:00Z" as IsoTimestamp,
          },
        );
      },
    );

    it(
      "builds a QUARTERLY reporting_period from the row's kind/year/quarter columns",
      () => {
        const row =
          baseShipmentRow(
            {
              reporting_period_kind: "QUARTERLY",
              reporting_period_year: 2025,
              reporting_period_quarter: 2,
            },
          );

        const result =
          toShipment(
            row,
          );

        expect(
          result.reporting_period,
        ).toEqual(
          {
            kind: "QUARTERLY",
            year: 2025,
            quarter: 2,
          },
        );
      },
    );

    it(
      "builds an ANNUAL reporting_period from the row's kind/year columns, ignoring any quarter value",
      () => {
        const row =
          baseShipmentRow(
            {
              reporting_period_kind: "ANNUAL",
              reporting_period_year: 2026,
              reporting_period_quarter: null,
            },
          );

        const result =
          toShipment(
            row,
          );

        expect(
          result.reporting_period,
        ).toEqual(
          {
            kind: "ANNUAL",
            year: 2026,
          },
        );
      },
    );

    it(
      "defaults lines to an empty array when none are given",
      () => {
        const row =
          baseShipmentRow();

        const result =
          toShipment(
            row,
          );

        expect(
          result.lines,
        ).toEqual(
          [],
        );
      },
    );
  },
);

describe(
  "toShipmentLine",
  () => {
    it(
      "maps a full row with a production route to a ShipmentLine, round-tripping every field including type-branded IDs",
      () => {
        const row =
          baseShipmentLineRow(
            {
              goods_description: "Semi-finished products of iron",
              quantity_mwh: null,
              net_mass_tonnes: "10.5",
              production_route_name: "Blast furnace route",
              production_route_indicator: "(C)",
            },
          );

        const result =
          toShipmentLine(
            row,
          );

        expect(
          result,
        ).toEqual(
          {
            id: "line-1" as ShipmentLineId,
            shipment_id: "shipment-1" as ShipmentId,
            org_id: "org-1" as OrganizationId,
            line_number: 1,
            cn_code: "72071190",
            cn_code_level: "CN8",
            goods_description: "Semi-finished products of iron",
            origin_country: "CN" as CountryCode,
            net_mass_tonnes: "10.5" as DecimalString,
            quantity_mwh: null,
            production_route: {
              name: "Blast furnace route",
              source_route_indicator: "(C)",
            },
            emission_determination: null,
          },
        );
      },
    );

    it(
      "maps a row with a quantity_mwh value (and no net_mass_tonnes) through unchanged",
      () => {
        const row =
          baseShipmentLineRow(
            {
              net_mass_tonnes: null,
              quantity_mwh: "42.7",
            },
          );

        const result =
          toShipmentLine(
            row,
          );

        expect(
          result.net_mass_tonnes,
        ).toBeNull();

        expect(
          result.quantity_mwh,
        ).toBe(
          "42.7",
        );
      },
    );

    it(
      "sets production_route to null when the row has neither a route name nor an indicator",
      () => {
        const row =
          baseShipmentLineRow(
            {
              production_route_name: null,
              production_route_indicator: null,
            },
          );

        const result =
          toShipmentLine(
            row,
          );

        expect(
          result.production_route,
        ).toBeNull();
      },
    );

    it(
      "sets production_route to null when the row has a route name but no indicator",
      () => {
        const row =
          baseShipmentLineRow(
            {
              production_route_name: "Blast furnace route",
              production_route_indicator: null,
            },
          );

        const result =
          toShipmentLine(
            row,
          );

        expect(
          result.production_route,
        ).toBeNull();
      },
    );

    it(
      "sets production_route to null when the row has an indicator but no route name",
      () => {
        const row =
          baseShipmentLineRow(
            {
              production_route_name: null,
              production_route_indicator: "(C)",
            },
          );

        const result =
          toShipmentLine(
            row,
          );

        expect(
          result.production_route,
        ).toBeNull();
      },
    );
  },
);
