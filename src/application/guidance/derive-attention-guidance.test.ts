import {
  describe,
  expect,
  it,
} from "vitest";

import {
  deriveAttentionGuidance,
} from "./derive-attention-guidance";

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

function mockSupabase(
  {
    shipmentRows = [],
    lineRows = [],
    shipmentsError = null,
  }: {
    shipmentRows?: Record<string, unknown>[];
    lineRows?: Record<string, unknown>[];
    shipmentsError?: { message: string } | null;
  } = {},
) {
  return {
    from: (
      table: string,
    ) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        order: () => chain,
        range: (
          from: number,
        ) => {
          if (table === "shipments") {
            return Promise.resolve(
              {
                data: from === 0 ? shipmentRows : [],
                error: shipmentsError,
              },
            );
          }

          if (table === "shipment_lines") {
            return Promise.resolve(
              {
                data: from === 0 ? lineRows : [],
                error: null,
              },
            );
          }

          return Promise.resolve(
            { data: [], error: null },
          );
        },
        then: (
          resolve: (result: { data: unknown; error: null }) => void,
        ) =>
          resolve(
            { data: [], error: null },
          ),
      };

      return chain;
    },
  } as never;
}

describe(
  "deriveAttentionGuidance",
  () => {
    it(
      "2026-09-05 (S2 remediation, B1): returns the COMPLETE ranked set, uncapped -- more than DASHBOARD_GUIDANCE_CAP REQUIRED items all remain present",
      async () => {
        const result =
          await deriveAttentionGuidance(
            mockSupabase(
              {
                shipmentRows: Array.from(
                  { length: 5 },
                  (_, index) => shipmentRow({ id: `ship-${index}`, reference: `SHIP-${index}` }),
                ),
                lineRows: Array.from(
                  { length: 5 },
                  (_, index) => lineRow({ id: `line-${index}`, shipment_id: `ship-${index}` }),
                ),
              },
            ),
            context,
          );

        expect(result.status).toBe("OK");

        if (result.status !== "OK") {
          throw new Error("expected OK");
        }

        // All 5 REQUIRED I19 items are present -- the dashboard's own
        // 3-card cap has no bearing here.
        expect(result.items).toHaveLength(5);
      },
    );

    it(
      "2026-09-05 (S2 remediation, B3): a real fetch failure surfaces as UNAVAILABLE here too, not an empty result",
      async () => {
        const result =
          await deriveAttentionGuidance(
            mockSupabase(
              {
                shipmentsError: { message: "URI too long" },
              },
            ),
            context,
          );

        expect(result).toEqual(
          { status: "UNAVAILABLE" },
        );
      },
    );
  },
);
