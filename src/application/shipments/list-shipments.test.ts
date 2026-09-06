import {
  describe,
  expect,
  it,
} from "vitest";

import {
  listShipments,
} from "./list-shipments";

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

function mockSupabase(
  result: { data: unknown; error: unknown },
) {
  // 2026-09-07 (S5 review round 4, finding S5R4-TRUNC-A1): the query
  // now pages with .range() (ordered by created_at/id for a stable
  // tie-break). Every fixture here returns well under
  // SHIPMENT_PAGE_SIZE rows, so the paging loop always terminates
  // after its first page -- this mock stays a one-shot resolver,
  // .order()/.range() are pure pass-throughs.
  const rangeChain =
    {
      range: () =>
        Promise.resolve(
          result,
        ),
    };

  return {
    from: () => (
      {
        select: () => (
          {
            eq: () => (
              {
                order: () => (
                  {
                    order: () =>
                      rangeChain,
                  }
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
  "listShipments",
  () => {
    it(
      "maps rows to Shipment objects with empty lines",
      async () => {
        const result =
          await listShipments(
            mockSupabase(
              { data: [shipmentRow], error: null },
            ),
            "org-1" as never,
          );

        expect(result).toEqual(
          [
            {
              id: "ship-1",
              org_id: "org-1",
              reference: "REF-001",
              release_date: "2026-03-15",
              reporting_period: { kind: "ANNUAL", year: 2026 },
              customs_mrn: null,
              customs_procedure: null,
              status: "DRAFT",
              lines: [],
              created_at: "2026-01-01T00:00:00Z",
              updated_at: "2026-01-01T00:00:00Z",
            },
          ],
        );
      },
    );

    it(
      "throws on a genuine query error -- never silently returns [] the same way a real empty org does (S5 cross-phase hardening)",
      async () => {
        await expect(
          listShipments(
            mockSupabase(
              { data: null, error: { message: "boom" } },
            ),
            "org-1" as never,
          ),
        ).rejects.toThrow(
          "boom",
        );
      },
    );

    it(
      "returns an empty array for a genuinely empty org (no error, no rows)",
      async () => {
        const result =
          await listShipments(
            mockSupabase(
              { data: [], error: null },
            ),
            "org-1" as never,
          );

        expect(result).toEqual(
          [],
        );
      },
    );
  },
);
