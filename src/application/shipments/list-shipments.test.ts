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
  return {
    from: () => (
      {
        select: () => (
          {
            eq: () => (
              {
                order: () =>
                  Promise.resolve(
                    result,
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
      "returns an empty array on error",
      async () => {
        const result =
          await listShipments(
            mockSupabase(
              { data: null, error: { message: "boom" } },
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
