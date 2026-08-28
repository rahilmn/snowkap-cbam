import {
  describe,
  expect,
  it,
} from "vitest";

import {
  getShipmentDetail,
} from "./get-shipment-detail";

const shipmentRow =
  {
    id: "ship-1",
    org_id: "org-1",
    reference: "REF-001",
    release_date: "2026-03-15",
    reporting_period_kind: "ANNUAL",
    reporting_period_year: 2026,
    reporting_period_quarter: null,
    customs_mrn: null,
    customs_procedure: null,
    status: "DRAFT",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };

const lineRow =
  {
    id: "line-1",
    shipment_id: "ship-1",
    org_id: "org-1",
    line_number: 1,
    cn_code: "25232100",
    cn_code_level: "CN8",
    goods_description: null,
    origin_country: "DE",
    net_mass_tonnes: "10.5",
    quantity_mwh: null,
    production_route_name: "GREY_CLINKER_CEMENT",
    production_route_indicator: "(A)",
    emission_determination: null,
  };

function mockSupabase(
  {
    shipmentResult,
    linesResult,
  }: {
    shipmentResult: { data: unknown; error: unknown };
    linesResult: { data: unknown; error: unknown };
  },
) {
  return {
    from: (
      table: string,
    ) => (
      table === "shipment_lines"
        ? {
            select: () => (
              {
                eq: () => (
                  {
                    order: () =>
                      Promise.resolve(
                        linesResult,
                      ),
                  }
                ),
              }
            ),
          }
        : {
            select: () => (
              {
                eq: () => (
                  {
                    maybeSingle: () =>
                      Promise.resolve(
                        shipmentResult,
                      ),
                  }
                ),
              }
            ),
          }
    ),
  } as never;
}

describe(
  "getShipmentDetail",
  () => {
    it(
      "maps the shipment and its lines, including the production route",
      async () => {
        const result =
          await getShipmentDetail(
            mockSupabase(
              {
                shipmentResult: { data: shipmentRow, error: null },
                linesResult: { data: [lineRow], error: null },
              },
            ),
            "ship-1" as never,
          );

        expect(result?.lines).toEqual(
          [
            {
              id: "line-1",
              shipment_id: "ship-1",
              org_id: "org-1",
              line_number: 1,
              cn_code: "25232100",
              cn_code_level: "CN8",
              goods_description: null,
              origin_country: "DE",
              net_mass_tonnes: "10.5",
              quantity_mwh: null,
              production_route: {
                name: "GREY_CLINKER_CEMENT",
                source_route_indicator: "(A)",
              },
              emission_determination: null,
            },
          ],
        );
      },
    );

    it(
      "returns null when the shipment isn't found (or isn't visible via RLS)",
      async () => {
        const result =
          await getShipmentDetail(
            mockSupabase(
              {
                shipmentResult: { data: null, error: null },
                linesResult: { data: [], error: null },
              },
            ),
            "ship-1" as never,
          );

        expect(result).toBeNull();
      },
    );
  },
);
