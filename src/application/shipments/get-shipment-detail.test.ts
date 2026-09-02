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

interface SelectRecorder {
  filters: [string, string, unknown][];
}

/**
 * Chainable so an arbitrary number of .eq() calls resolve, and recording
 * so the ORG filter can be asserted rather than assumed -- the pin added
 * on 2026-09-03 is a filter, and a mock that ignores filters would let it
 * be removed again without any test noticing.
 */
function mockSupabase(
  {
    shipmentResult,
    linesResult,
    recorder,
  }: {
    shipmentResult: { data: unknown; error: unknown };
    linesResult: { data: unknown; error: unknown };
    recorder?: SelectRecorder;
  },
) {
  function chain(
    table: string,
    result: { data: unknown; error: unknown },
  ) {
    const builder: Record<string, unknown> = {
      eq: (column: string, value: unknown) => {
        recorder?.filters.push([table, column, value]);
        return builder;
      },

      order: () =>
        Promise.resolve(
          result,
        ),

      maybeSingle: () =>
        Promise.resolve(
          result,
        ),
    };

    return builder;
  }

  return {
    from: (
      table: string,
    ) => (
      {
        select: () =>
          chain(
            table,
            table === "shipment_lines"
              ? linesResult
              : shipmentResult,
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
            "org-1" as never,
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
            "org-1" as never,
            "ship-1" as never,
          );

        expect(result).toBeNull();
      },
    );

    /**
     * 2026-09-03 (P14). shipments_select_own_org admits every org the
     * USER belongs to (app.user_org_ids()), which is not the same as the
     * org they are currently acting as. Production has a user who is an
     * OWNER of two organizations, so without an explicit pin they could
     * open the other org's shipment inside this org's shell -- and every
     * downstream computation on that page, including which shared actual
     * data is offered and which org an audit event is attributed to,
     * would then run in the wrong organizational context.
     */
    it(
      "returns null for a shipment belonging to a DIFFERENT org than the caller's active one, and never reads its lines",
      async () => {
        const recorder: SelectRecorder =
          { filters: [] };

        const result =
          await getShipmentDetail(
            mockSupabase(
              {
                shipmentResult: {
                  data: { ...shipmentRow, org_id: "org-2" },
                  error: null,
                },
                linesResult: { data: [lineRow], error: null },
                recorder,
              },
            ),
            "org-1" as never,
            "ship-1" as never,
          );

        expect(result).toBeNull();

        // Indistinguishable from not-found, and it stops before the
        // second query: a caller who supplied the wrong org learns
        // nothing about whether the id exists.
        expect(
          recorder.filters.filter(
            ([table]) => table === "shipment_lines",
          ),
        ).toEqual(
          [],
        );
      },
    );

    it(
      "scopes the line query to the active org as well, rather than relying on RLS alone",
      async () => {
        const recorder: SelectRecorder =
          { filters: [] };

        await getShipmentDetail(
          mockSupabase(
            {
              shipmentResult: { data: shipmentRow, error: null },
              linesResult: { data: [lineRow], error: null },
              recorder,
            },
          ),
          "org-1" as never,
          "ship-1" as never,
        );

        expect(recorder.filters).toContainEqual(
          ["shipment_lines", "org_id", "org-1"],
        );
      },
    );
  },
);
