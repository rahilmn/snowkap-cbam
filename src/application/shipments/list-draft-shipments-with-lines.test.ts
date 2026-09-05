import {
  describe,
  expect,
  it,
} from "vitest";

import {
  listDraftShipmentsWithLines,
} from "./list-draft-shipments-with-lines";

interface MockTableConfig {
  // A function of the .range() window so a test can hand back
  // different pages on successive calls (pagination) or inspect what
  // was asked for (chunking) -- richer than a single static array.
  respond: (
    args: {
      eqCalls: [string, unknown][];
      inCall: [string, unknown] | undefined;
      from: number;
      to: number;
    },
  ) => { data: Record<string, unknown>[] | null; error: { message: string } | null };
}

function mockSupabase(
  tables: Record<string, MockTableConfig>,
) {
  const calls: {
    table: string;
    eqCalls: [string, unknown][];
    inCall?: [string, unknown];
    range?: [number, number];
  }[] =
    [];

  return {
    client: {
      from: (
        table: string,
      ) => {
        const call: {
          table: string;
          eqCalls: [string, unknown][];
          inCall?: [string, unknown];
          range?: [number, number];
        } =
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

            return chain;
          },
          order: () => chain,
          range: (
            from: number,
            to: number,
          ) => {
            call.range =
              [from, to];

            const config =
              tables[table];

            if (!config) {
              return Promise.resolve(
                { data: [], error: null },
              );
            }

            return Promise.resolve(
              config.respond(
                {
                  eqCalls: call.eqCalls,
                  inCall: call.inCall,
                  from,
                  to,
                },
              ),
            );
          },
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

// Fixed-single-page helper for the tests that don't care about
// pagination/chunking themselves.
function onePage(
  rows: Record<string, unknown>[],
): MockTableConfig {
  return {
    respond: ({ from }) => ({
      data: from === 0 ? rows : [],
      error: null,
    }),
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
              shipments: onePage([shipmentRow()]),
              shipment_lines: onePage([lineRow(), lineRow({ id: "line-2", line_number: 2 })]),
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
              shipments: onePage([]),
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
              shipments: onePage([
                shipmentRow({ id: "ship-1", reference: "SHIP-001" }),
                shipmentRow({ id: "ship-2", reference: "SHIP-002" }),
              ]),
              shipment_lines: onePage([
                lineRow({ id: "l2", shipment_id: "ship-1", line_number: 2 }),
                lineRow({ id: "l1", shipment_id: "ship-1", line_number: 1 }),
                lineRow({ id: "l3", shipment_id: "ship-2", line_number: 1 }),
              ]),
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

    it(
      "2026-09-05 (S2 remediation, B3): chunks the shipment_id .in() filter into batches of at most 100 ids, and merges lines from every chunk",
      async () => {
        const shipmentCount = 250;

        const shipments =
          Array.from(
            { length: shipmentCount },
            (_, index) => shipmentRow({ id: `ship-${index}`, reference: `SHIP-${index}` }),
          );

        const inCallSizes: number[] =
          [];

        const { client } =
          mockSupabase(
            {
              shipments: onePage(shipments),
              shipment_lines: {
                respond: ({ inCall, from }) => {
                  const ids =
                    (inCall?.[1] as string[] | undefined) ?? [];

                  inCallSizes.push(
                    ids.length,
                  );

                  if (from > 0) {
                    return { data: [], error: null };
                  }

                  return {
                    data: ids.map(
                      (id) => lineRow({ id: `line-${id}`, shipment_id: id }),
                    ),
                    error: null,
                  };
                },
              },
            },
          );

        const result =
          await listDraftShipmentsWithLines(
            client,
            "org-1" as never,
          );

        // Every .in() call stayed at or under the 100-id chunk size --
        // never one request carrying all 250 ids (the exact shape that
        // fails with HTTP 414 past ~220 live).
        expect(
          inCallSizes.every((size) => size <= 100),
        ).toBe(
          true,
        );

        expect(
          inCallSizes.length,
        ).toBeGreaterThan(
          1,
        );

        expect(
          inCallSizes.reduce((a, b) => a + b, 0),
        ).toBe(
          shipmentCount,
        );

        // Every shipment across every chunk kept its own line.
        expect(result).toHaveLength(
          shipmentCount,
        );

        expect(
          result.every((s) => s.lines.length === 1),
        ).toBe(
          true,
        );
      },
    );

    it(
      "2026-09-05 (S2 remediation, B3): paginates via .range() until a page shorter than the page size signals completion, rather than trusting a single page to be the whole result",
      async () => {
        const PAGE_SIZE =
          1000;

        // 1500 draft shipments: page 1 is a full 1000-row page (which
        // alone would look like "maybe there's more" -- exactly what
        // PostgREST's silent max_rows truncation exploits), page 2 is
        // the remaining 500.
        const allShipments =
          Array.from(
            { length: 1500 },
            (_, index) => shipmentRow({ id: `ship-${index}`, reference: `SHIP-${index}` }),
          );

        const { client } =
          mockSupabase(
            {
              shipments: {
                respond: ({ from }) => ({
                  data: allShipments.slice(from, from + PAGE_SIZE),
                  error: null,
                }),
              },
              shipment_lines: onePage([]),
            },
          );

        const result =
          await listDraftShipmentsWithLines(
            client,
            "org-1" as never,
          );

        expect(result).toHaveLength(
          1500,
        );
      },
    );

    it(
      "2026-09-05 (S2 remediation, B3): a real query error on the shipments fetch THROWS, rather than degrading into an empty ('nothing to do') result",
      async () => {
        const { client } =
          mockSupabase(
            {
              shipments: {
                respond: () => ({
                  data: null,
                  error: { message: "URI too long" },
                }),
              },
            },
          );

        await expect(
          listDraftShipmentsWithLines(
            client,
            "org-1" as never,
          ),
        ).rejects.toThrow();
      },
    );

    it(
      "2026-09-05 (S2 remediation, B3): a real query error on the shipment_lines fetch THROWS, rather than degrading into an empty ('nothing to do') result",
      async () => {
        const { client } =
          mockSupabase(
            {
              shipments: onePage([shipmentRow()]),
              shipment_lines: {
                respond: () => ({
                  data: null,
                  error: { message: "URI too long" },
                }),
              },
            },
          );

        await expect(
          listDraftShipmentsWithLines(
            client,
            "org-1" as never,
          ),
        ).rejects.toThrow();
      },
    );
  },
);
