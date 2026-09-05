import {
  describe,
  expect,
  it,
} from "vitest";

import {
  listDraftShipmentsWithLines,
} from "./list-draft-shipments-with-lines";

function mockSupabase(
  {
    shipmentRows = [],
    lineRows = [],
  }: {
    shipmentRows?: Record<string, unknown>[];
    lineRows?: Record<string, unknown>[];
  } = {},
) {
  const calls: { table: string; eqCalls: [string, unknown][]; inCall?: [string, unknown] }[] =
    [];

  return {
    client: {
      from: (
        table: string,
      ) => {
        const call: { table: string; eqCalls: [string, unknown][]; inCall?: [string, unknown] } =
          { table, eqCalls: [] };

        calls.push(
          call,
        );

        const chain = {
          select: () => chain,
          eq: (
            column: string,
            value: unknown,
          ) => {
            call.eqCalls.push(
              [column, value],
            );

            return chain;
          },
          in: (
            column: string,
            value: unknown,
          ) => {
            call.inCall =
              [column, value];

            return Promise.resolve(
              {
                data: table === "shipment_lines" ? lineRows : shipmentRows,
                error: null,
              },
            );
          },
          then: (
            resolve: (result: { data: unknown; error: null }) => void,
          ) =>
            resolve(
              {
                data: table === "shipments" ? shipmentRows : lineRows,
                error: null,
              },
            ),
        };

        return chain;
      },
    } as never,

    getCalls: () =>
      calls,
  };
}

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
    emission_determination: null,
    ...overrides,
  };
}

describe(
  "listDraftShipmentsWithLines",
  () => {
    it(
      "queries only DRAFT shipments for the org, and attaches each shipment's own lines",
      async () => {
        const { client, getCalls } =
          mockSupabase(
            {
              shipmentRows: [shipmentRow()],
              lineRows: [lineRow(), lineRow({ id: "line-2", line_number: 2 })],
            },
          );

        const result =
          await listDraftShipmentsWithLines(
            client,
            "org-1" as never,
          );

        expect(result).toHaveLength(1);
        expect(result[0]?.id).toBe("ship-1");
        expect(result[0]?.lines).toHaveLength(2);

        const shipmentsCall =
          getCalls().find((c) => c.table === "shipments");

        expect(
          shipmentsCall?.eqCalls,
        ).toContainEqual(
          ["status", "DRAFT"],
        );
      },
    );

    it(
      "returns an empty array without querying shipment_lines when there are no draft shipments",
      async () => {
        const { client, getCalls } =
          mockSupabase(
            {
              shipmentRows: [],
            },
          );

        const result =
          await listDraftShipmentsWithLines(
            client,
            "org-1" as never,
          );

        expect(result).toEqual(
          [],
        );

        expect(
          getCalls().some((c) => c.table === "shipment_lines"),
        ).toBe(
          false,
        );
      },
    );

    it(
      "lines are ordered by line_number and only attached to their own shipment",
      async () => {
        const { client } =
          mockSupabase(
            {
              shipmentRows: [
                shipmentRow({ id: "ship-1", reference: "SHIP-001" }),
                shipmentRow({ id: "ship-2", reference: "SHIP-002" }),
              ],
              lineRows: [
                lineRow({ id: "l2", shipment_id: "ship-1", line_number: 2 }),
                lineRow({ id: "l1", shipment_id: "ship-1", line_number: 1 }),
                lineRow({ id: "l3", shipment_id: "ship-2", line_number: 1 }),
              ],
            },
          );

        const result =
          await listDraftShipmentsWithLines(
            client,
            "org-1" as never,
          );

        const ship1 =
          result.find((s) => s.id === "ship-1");

        const ship2 =
          result.find((s) => s.id === "ship-2");

        expect(
          ship1?.lines.map((l) => l.id),
        ).toEqual(
          ["l1", "l2"],
        );

        expect(
          ship2?.lines.map((l) => l.id),
        ).toEqual(
          ["l3"],
        );
      },
    );
  },
);
