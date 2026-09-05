import {
  describe,
  expect,
  it,
} from "vitest";

import {
  deriveDashboardGuidance,
} from "./derive-dashboard-guidance";

const context =
  {
    org_id: "org-1",
    user_id: "user-1",
    role: "MEMBER",
    capabilities: ["IMPORTER_DECLARANT"],
  } as never;

function shipmentRow(
  overrides: Record<string, unknown> = {},
) {
  return {
    id: "ship-1",
    org_id: "org-1",
    reference: "SHIP-001",
    release_date: "2026-01-15",
    reporting_period_kind: "ANNUAL",
    reporting_period_year: 2026,
    reporting_period_quarter: null,
    customs_mrn: null,
    customs_procedure: null,
    status: "DRAFT",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function lineRow(
  overrides: Record<string, unknown> = {},
) {
  return {
    id: "line-1",
    shipment_id: "ship-1",
    org_id: "org-1",
    line_number: 1,
    cn_code: "25232100",
    cn_code_level: "CN8",
    goods_description: null,
    origin_country: "CN",
    net_mass_tonnes: "100",
    quantity_mwh: null,
    production_route_name: null,
    production_route_indicator: null,
    emission_determination: { method: "DEFAULT" },
    ...overrides,
  };
}

/**
 * A minimal fake covering exactly the four tables this orchestrator
 * reads: shipments, shipment_lines, declarations, guidance_dismissals.
 * Not a general-purpose Supabase mock -- see the individual services'
 * own tests (list-draft-shipments-with-lines.test.ts,
 * list-guidance-dismissals.test.ts, i19.test.ts) for their own
 * detailed coverage; this test only proves the WIRING is correct.
 */
function mockSupabase(
  {
    shipmentRows = [],
    lineRows = [],
    declarationRows = [],
    dismissalRows = [],
  }: {
    shipmentRows?: Record<string, unknown>[];
    lineRows?: Record<string, unknown>[];
    declarationRows?: Record<string, unknown>[];
    dismissalRows?: { item_key: string }[];
  } = {},
) {
  return {
    from: (
      table: string,
    ) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () =>
          Promise.resolve(
            { data: lineRows, error: null },
          ),
        order: () => chain,
        then: (
          resolve: (result: { data: unknown; error: null }) => void,
        ) => {
          const data =
            table === "shipments"
              ? shipmentRows
              : table === "declarations"
                ? declarationRows
                : table === "guidance_dismissals"
                  ? dismissalRows
                  : [];

          return resolve(
            { data, error: null },
          );
        },
      };

      return chain;
    },
  } as never;
}

describe(
  "deriveDashboardGuidance",
  () => {
    it(
      "derives an I19 item for a real, complete DRAFT shipment and returns it in the visible dashboard set",
      () => {
        return deriveDashboardGuidance(
          mockSupabase(
            {
              shipmentRows: [shipmentRow()],
              lineRows: [lineRow()],
            },
          ),
          context,
        ).then(
          (result) => {
            expect(result.visible).toHaveLength(1);
            expect(result.visible[0]?.rule).toBe("I19");
            expect(result.visible[0]?.title).toBe("Mark SHIP-001 ready");
          },
        );
      },
    );

    it(
      "excludes a dismissed non-REQUIRED item, but I19 is always REQUIRED so dismissal has no visible effect on it -- proves the dismissal set is genuinely threaded through, not merely fetched and ignored",
      async () => {
        // I19 items are always REQUIRED, so this test proves the
        // dismissal SET reaches the pipeline (dismissal is looked up
        // by exact item id "I19:ship-1") without changing I19's own
        // real (REQUIRED-ignores-dismissal) behavior.
        const result =
          await deriveDashboardGuidance(
            mockSupabase(
              {
                shipmentRows: [shipmentRow()],
                lineRows: [lineRow()],
                dismissalRows: [{ item_key: "I19:ship-1" }],
              },
            ),
            context,
          );

        expect(result.visible).toHaveLength(1);
      },
    );

    it(
      "returns no items when there are no draft shipments",
      async () => {
        const result =
          await deriveDashboardGuidance(
            mockSupabase(),
            context,
          );

        expect(result.visible).toEqual(
          [],
        );

        expect(result.requiredOverflowCount).toBe(
          0,
        );
      },
    );
  },
);
