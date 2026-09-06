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
        builder,

      // 2026-09-07 (S5 review round 3, finding S5R3-A-B2): the shipment
      // line fetch now pages with .range(). Every fixture here returns
      // well under LINE_PAGE_SIZE rows, so the paging loop always
      // terminates after its first page -- this mock stays a one-shot
      // resolver, .range() is a pure pass-through to `result`.
      range: () =>
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
      "2026-09-07 (S5 review round 3, finding S5R3-A-B2): pages past PostgREST's max_rows cap instead of silently truncating a shipment's lines at 1000",
      async () => {
        const firstPage =
          Array.from(
            { length: 1000 },
            (_, index) => (
              {
                ...lineRow,
                id: `line-page1-${index}`,
                line_number: index + 1,
              }
            ),
          );

        const secondPage =
          [
            {
              ...lineRow,
              id: "line-page2-0",
              line_number: 1001,
            },
          ];

        let linesCallCount =
          0;

        const rangesRequested: [number, number][] =
          [];

        const supabase =
          {
            from: (table: string) => {
              if (table !== "shipment_lines") {
                return {
                  select: () => (
                    {
                      eq: () => (
                        {
                          maybeSingle: () =>
                            Promise.resolve(
                              { data: shipmentRow, error: null },
                            ),
                        }
                      ),
                    }
                  ),
                };
              }

              return {
                select: () => (
                  {
                    eq: () => (
                      {
                        eq: () => (
                          {
                            order: () => (
                              {
                                range: (from: number, to: number) => {
                                  rangesRequested.push(
                                    [from, to],
                                  );

                                  linesCallCount +=
                                    1;

                                  return Promise.resolve(
                                    linesCallCount === 1
                                      ? { data: firstPage, error: null }
                                      : { data: secondPage, error: null },
                                  );
                                },
                              }
                            ),
                          }
                        ),
                      }
                    ),
                  }
                ),
              };
            },
          } as never;

        const result =
          await getShipmentDetail(
            supabase,
            "org-1" as never,
            "ship-1" as never,
          );

        expect(linesCallCount).toBe(
          2,
        );

        expect(rangesRequested).toEqual(
          [
            [0, 999],
            [1000, 1999],
          ],
        );

        expect(result?.lines).toHaveLength(
          1001,
        );

        expect(result?.lines.at(-1)?.id).toBe(
          "line-page2-0",
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
