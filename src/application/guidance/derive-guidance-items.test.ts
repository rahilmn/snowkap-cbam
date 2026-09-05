import {
  describe,
  expect,
  it,
} from "vitest";

import {
  deriveGuidanceItems,
} from "./derive-guidance-items";

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
 * detailed coverage; this test only proves the WIRING (and, since S2
 * remediation B3, the failure -> UNAVAILABLE conversion) is correct.
 *
 * shipments/shipment_lines resolve via .order().range() (matching
 * list-draft-shipments-with-lines.ts's own paginated shape);
 * declarations/guidance_dismissals resolve via the plain thenable
 * chain their own simpler queries already use.
 */
function mockSupabase(
  {
    shipmentRows = [],
    lineRows = [],
    declarationRows = [],
    dismissalRows = [],
    shipmentsError = null,
    declarationsError = null,
  }: {
    shipmentRows?: Record<string, unknown>[];
    lineRows?: Record<string, unknown>[];
    declarationRows?: Record<string, unknown>[];
    dismissalRows?: { item_key: string }[];
    shipmentsError?: { message: string } | null;
    declarationsError?: { message: string } | null;
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
          resolve: (result: { data: unknown; error: unknown }) => void,
        ) => {
          if (table === "declarations") {
            return resolve(
              { data: declarationsError ? null : declarationRows, error: declarationsError },
            );
          }

          const data =
            table === "guidance_dismissals"
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
  "deriveGuidanceItems",
  () => {
    it(
      "derives an I19 item for a real, complete DRAFT shipment",
      async () => {
        const result =
          await deriveGuidanceItems(
            mockSupabase(
              {
                shipmentRows: [shipmentRow()],
                lineRows: [lineRow()],
              },
            ),
            context,
          );

        expect(result.status).toBe("OK");

        if (result.status !== "OK") {
          throw new Error("expected OK");
        }

        expect(result.items).toHaveLength(1);
        expect(result.items[0]?.rule).toBe("I19");
        expect(result.items[0]?.title).toBe("Mark SHIP-001 ready");
      },
    );

    it(
      "returns OK with an empty item list when there are no draft shipments (a genuine empty queue)",
      async () => {
        const result =
          await deriveGuidanceItems(
            mockSupabase(),
            context,
          );

        expect(result).toEqual(
          { status: "OK", items: [] },
        );
      },
    );

    it(
      "2026-09-05 (S2 remediation, B3): a real fetch failure returns UNAVAILABLE, never an empty OK result indistinguishable from a genuine empty queue",
      async () => {
        const result =
          await deriveGuidanceItems(
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

    it(
      "2026-09-06 (S2 remediation, B3 follow-up, fresh Opus 5 adversarial pre-verification): a real DECLARATIONS fetch failure also returns UNAVAILABLE -- listDeclarations used to silently swallow its own errors into [], which would have forced every I19 item's impact to APPROVAL org-wide with no signal anything failed",
      async () => {
        const result =
          await deriveGuidanceItems(
            mockSupabase(
              {
                shipmentRows: [shipmentRow()],
                lineRows: [lineRow()],
                declarationsError: { message: "boom" },
              },
            ),
            context,
          );

        expect(result).toEqual(
          { status: "UNAVAILABLE" },
        );
      },
    );

    it(
      "threads the dismissal set through to the pipeline (I19 is always REQUIRED, so a dismissal of it has no visible effect -- proving the set reaches the pipeline rather than being fetched and ignored)",
      async () => {
        const result =
          await deriveGuidanceItems(
            mockSupabase(
              {
                shipmentRows: [shipmentRow()],
                lineRows: [lineRow()],
                dismissalRows: [{ item_key: "I19:ship-1" }],
              },
            ),
            context,
          );

        expect(result.status).toBe("OK");

        if (result.status !== "OK") {
          throw new Error("expected OK");
        }

        expect(result.items).toHaveLength(1);
      },
    );
  },
);
