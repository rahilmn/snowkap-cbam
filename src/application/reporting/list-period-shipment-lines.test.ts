import {
  describe,
  expect,
  it,
} from "vitest";

import {
  listPeriodShipmentLines,
} from "./list-period-shipment-lines";

const orgId =
  "org-1" as never;

const annualPeriod =
  { kind: "ANNUAL", year: 2026 } as never;

function shipmentRow(
  overrides: Record<string, unknown> = {},
) {
  return {
    id: "ship-1",
    org_id: "org-1",
    reference: "REF-001",
    release_date: "2026-03-15",
    reporting_period_kind: "ANNUAL",
    reporting_period_year: 2026,
    reporting_period_quarter: null,
    customs_mrn: null,
    customs_procedure: null,
    status: "READY",
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
    cn_code: "72081000",
    cn_code_level: "CN8",
    goods_description: null,
    origin_country: "DE",
    net_mass_tonnes: "10",
    quantity_mwh: null,
    production_route_name: null,
    production_route_indicator: null,
    emission_determination: null,
    ...overrides,
  };
}

const calculationRow =
  {
    id: "calc-1",
    line_id: "line-1",
    engine_version: "1.1.0",
    embedded_emissions_tco2e: "12.5",
    steps: [],
    calculated_at: "2026-02-01T00:00:00Z",
    determination: { method: "DEFAULT", resolution: { dataset_version: "2026.1" } },
  };

interface Op {
  table: string;
  op: "select";
  filters: [string, unknown][];
}

interface Recorder {
  fromCalls: string[];
  ops: Op[];
}

/**
 * Same generic per-table chainable select-only mock shape as
 * list-actual-determined-lines.test.ts's own makeMockSupabase (this
 * codebase's established pattern for a function that issues several
 * sequential single-table queries).
 */
function makeMockSupabase(
  tables: Record<string, { data: unknown; error: unknown }>,
  recorder: Recorder = { fromCalls: [], ops: [] },
) {
  function builder(
    table: string,
  ) {
    const filters: [string, unknown][] =
      [];

    const chain: Record<string, unknown> = {
      select: () => {
        recorder.ops.push({ table, op: "select", filters });
        return chain;
      },
      eq: (col: string, val: unknown) => {
        filters.push([col, val]);
        return chain;
      },
      neq: (col: string, val: unknown) => {
        filters.push([col, val]);
        return chain;
      },
      in: (col: string, vals: unknown) => {
        filters.push([col, vals]);
        return chain;
      },
      is: (col: string, val: unknown) => {
        filters.push([col, val]);
        return chain;
      },
      order: () => chain,
      range: () => chain,
      then: (
        resolve: (value: { data: unknown; error: unknown }) => unknown,
        reject: (reason: unknown) => unknown,
      ) =>
        Promise.resolve(
          tables[table] ?? { data: null, error: null },
        ).then(resolve, reject),
    };

    return chain;
  }

  return {
    from: (table: string) => {
      recorder.fromCalls.push(table);
      return builder(table);
    },
  } as never;
}

describe(
  "listPeriodShipmentLines",
  () => {
    it(
      "joins every shipment line in the period with its shipment reference and latest calculation",
      async () => {
        const result =
          await listPeriodShipmentLines(
            makeMockSupabase(
              {
                shipments: { data: [shipmentRow()], error: null },
                shipment_lines: { data: [lineRow()], error: null },
                latest_calculation_results: { data: [calculationRow], error: null },
              },
            ),
            orgId,
            annualPeriod,
          );

        expect(result.shipment_count).toBe(
          1,
        );

        expect(result.lines).toEqual(
          [
            {
              shipment_id: "ship-1",
              shipment_reference: "REF-001",
              line: expect.objectContaining({ id: "line-1", cn_code: "72081000" }),
              calculation: expect.objectContaining({ id: "calc-1", embedded_emissions_tco2e: "12.5" }),
            },
          ],
        );

        // The FROZEN determination the calculation was actually
        // computed against -- compute-declaration-draft-facts.ts's P13
        // staleness check (comparing this against the line's own
        // CURRENT emission_determination) needs it on this shape, not
        // just embedded_emissions_tco2e.
        expect(result.lines[0]?.calculation?.determination).toEqual(
          calculationRow.determination,
        );
      },
    );

    it(
      "reports a line with no calculation yet as calculation: null, never as a fabricated zero",
      async () => {
        const result =
          await listPeriodShipmentLines(
            makeMockSupabase(
              {
                shipments: { data: [shipmentRow()], error: null },
                shipment_lines: { data: [lineRow()], error: null },
                latest_calculation_results: { data: [], error: null },
              },
            ),
            orgId,
            annualPeriod,
          );

        expect(result.lines[0]?.calculation).toBeNull();
      },
    );

    it(
      "counts shipments with zero lines yet toward shipment_count, distinct from lines.length",
      async () => {
        const result =
          await listPeriodShipmentLines(
            makeMockSupabase(
              {
                shipments: { data: [shipmentRow()], error: null },
                shipment_lines: { data: [], error: null },
                latest_calculation_results: { data: [], error: null },
              },
            ),
            orgId,
            annualPeriod,
          );

        expect(result.shipment_count).toBe(
          1,
        );

        expect(result.lines).toEqual(
          [],
        );
      },
    );

    it(
      "returns shipment_count: 0 and no shipment_lines/latest_calculation_results query when the org has no shipments in the period",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        const result =
          await listPeriodShipmentLines(
            makeMockSupabase(
              {
                shipments: { data: [], error: null },
              },
              recorder,
            ),
            orgId,
            annualPeriod,
          );

        expect(result).toEqual(
          { shipment_count: 0, lines: [] },
        );

        expect(
          recorder.fromCalls.includes("shipment_lines"),
        ).toBe(
          false,
        );
      },
    );

    it(
      "fails the whole result closed (not a partial result) on a shipments fetch error",
      async () => {
        const result =
          await listPeriodShipmentLines(
            makeMockSupabase(
              {
                shipments: { data: null, error: { message: "denied" } },
              },
            ),
            orgId,
            annualPeriod,
          );

        expect(result).toEqual(
          { shipment_count: 0, lines: [] },
        );
      },
    );

    it(
      "fails the whole result closed on a shipment_lines fetch error, rather than returning shipment_count with an empty lines array indistinguishable from a real zero-lines state",
      async () => {
        const result =
          await listPeriodShipmentLines(
            makeMockSupabase(
              {
                shipments: { data: [shipmentRow()], error: null },
                shipment_lines: { data: null, error: { message: "denied" } },
              },
            ),
            orgId,
            annualPeriod,
          );

        expect(result).toEqual(
          { shipment_count: 0, lines: [] },
        );
      },
    );

    it(
      "fails the whole result closed on a latest_calculation_results fetch error",
      async () => {
        const result =
          await listPeriodShipmentLines(
            makeMockSupabase(
              {
                shipments: { data: [shipmentRow()], error: null },
                shipment_lines: { data: [lineRow()], error: null },
                latest_calculation_results: { data: null, error: { message: "denied" } },
              },
            ),
            orgId,
            annualPeriod,
          );

        expect(result).toEqual(
          { shipment_count: 0, lines: [] },
        );
      },
    );

    it(
      "filters shipments to a QUARTERLY period's exact kind/year/quarter columns",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        await listPeriodShipmentLines(
          makeMockSupabase(
            {
              shipments: { data: [], error: null },
            },
            recorder,
          ),
          orgId,
          { kind: "QUARTERLY", year: 2025, quarter: 4 } as never,
        );

        const shipmentsSelect =
          recorder.ops.find(
            (op) => op.table === "shipments",
          );

        expect(shipmentsSelect?.filters).toContainEqual(
          ["org_id", orgId],
        );

        expect(shipmentsSelect?.filters).toContainEqual(
          ["reporting_period_kind", "QUARTERLY"],
        );

        expect(shipmentsSelect?.filters).toContainEqual(
          ["reporting_period_year", 2025],
        );

        expect(shipmentsSelect?.filters).toContainEqual(
          ["reporting_period_quarter", 4],
        );
      },
    );

    it(
      "filters shipments to reporting_period_quarter IS NULL for an ANNUAL period",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        await listPeriodShipmentLines(
          makeMockSupabase(
            {
              shipments: { data: [], error: null },
            },
            recorder,
          ),
          orgId,
          annualPeriod,
        );

        const shipmentsSelect =
          recorder.ops.find(
            (op) => op.table === "shipments",
          );

        expect(shipmentsSelect?.filters).toContainEqual(
          ["reporting_period_quarter", null],
        );
      },
    );

    it(
      "excludes VOID shipments from the shipments query, so a cancelled shipment's emissions can never reach a period total or export row",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        await listPeriodShipmentLines(
          makeMockSupabase(
            {
              shipments: { data: [], error: null },
            },
            recorder,
          ),
          orgId,
          annualPeriod,
        );

        const shipmentsSelect =
          recorder.ops.find(
            (op) => op.table === "shipments",
          );

        expect(shipmentsSelect?.filters).toContainEqual(
          ["status", "VOID"],
        );
      },
    );

    // 2026-08-29 (P13 performance-verification finding): live-reproduced
    // against real seeded local Postgres at docs/plans/MASTER_PLAN.md
    // §33's own 50k-shipment budget scale -- a period with more than
    // one PostgREST page of shipments (supabase/config.toml's
    // max_rows = 1000) silently truncated to the first page (no
    // `.range()` was used), and even for however many shipment ids DID
    // get collected, batching them all into one `.in()` call on the
    // follow-up shipment_lines/latest_calculation_results queries
    // produced a real "URI too long" gateway error once past a few
    // hundred ids -- which this function's own "fail the whole result
    // to empty on any query error" posture then silently turned into
    // {shipment_count: 0, lines: []}, a period report showing "no
    // shipments" instead of the real total. These two tests prove the
    // fix's actual paging/batching mechanics, not just that the
    // (small, single-page) happy-path tests above still pass.

    it(
      "pages through every SHIPMENTS_PAGE_SIZE-sized page of shipments, not just the first",
      async () => {
        const PAGE_SIZE =
          1000;

        const totalShipments =
          PAGE_SIZE * 2 + 250;

        const allRows =
          Array.from(
            { length: totalShipments },
            (_, i) =>
              shipmentRow(
                {
                  id: `ship-${i}`,
                  reference: `REF-${i}`,
                },
              ),
          );

        const rangeCalls: [number, number][] =
          [];

        function builder() {
          let lastRange: [number, number] =
            [0, PAGE_SIZE - 1];

          const chain: Record<string, unknown> = {
            select: () => chain,
            eq: () => chain,
            neq: () => chain,
            in: () => chain,
            is: () => chain,
            order: () => chain,
            range: (from: number, to: number) => {
              lastRange = [from, to];
              rangeCalls.push(
                [from, to],
              );
              return chain;
            },
            then: (
              resolve: (value: { data: unknown; error: unknown }) => unknown,
            ) =>
              Promise.resolve(
                {
                  data: allRows.slice(
                    lastRange[0],
                    lastRange[1] + 1,
                  ),
                  error: null,
                },
              ).then(
                resolve,
              ),
          };

          return chain;
        }

        function emptyChain(): Record<string, unknown> {
          const chain: Record<string, unknown> = {
            select: () => chain,
            eq: () => chain,
            in: () => chain,
            order: () => chain,
            then: (
              resolve: (value: { data: unknown; error: unknown }) => unknown,
            ) =>
              Promise.resolve(
                { data: [], error: null },
              ).then(
                resolve,
              ),
          };

          return chain;
        }

        const supabase = {
          from: (table: string) =>
            table === "shipments"
              ? builder()
              : emptyChain(),
        } as never;

        const result =
          await listPeriodShipmentLines(
            supabase,
            orgId,
            annualPeriod,
          );

        expect(result.shipment_count).toBe(
          totalShipments,
        );

        // Three pages: [0,999], [1000,1999], [2000,2999] (the third
        // returns only 250 rows, which is what ends the loop).
        expect(rangeCalls).toEqual(
          [
            [0, 999],
            [1000, 1999],
            [2000, 2999],
          ],
        );
      },
    );

    it(
      "batches shipment_id .in() filters into groups of SHIPMENT_ID_BATCH_SIZE, so a large period doesn't send one oversized query",
      async () => {
        const BATCH_SIZE =
          200;

        const shipmentCount =
          BATCH_SIZE * 2 + 40;

        const shipmentRows =
          Array.from(
            { length: shipmentCount },
            (_, i) => shipmentRow({ id: `ship-${i}` }),
          );

        const inCallSizes: number[] =
          [];

        function builder(
          table: string,
        ) {
          const chain: Record<string, unknown> = {
            select: () => chain,
            eq: () => chain,
            neq: () => chain,
            is: () => chain,
            order: () => chain,
            range: () => chain,
            in: (
              _col: string,
              vals: unknown[],
            ) => {
              if (table !== "shipments") {
                inCallSizes.push(
                  vals.length,
                );
              }
              return chain;
            },
            then: (
              resolve: (value: { data: unknown; error: unknown }) => unknown,
            ) =>
              Promise.resolve(
                table === "shipments"
                  ? { data: shipmentRows, error: null }
                  : { data: [], error: null },
              ).then(
                resolve,
              ),
          };

          return chain;
        }

        const supabase = {
          from: (table: string) => builder(table),
        } as never;

        await listPeriodShipmentLines(
          supabase,
          orgId,
          annualPeriod,
        );

        // Two tables (shipment_lines, latest_calculation_results) each
        // batched into three .in() calls (200 + 200 + 40) -- six total.
        expect(inCallSizes).toEqual(
          [200, 200, 40, 200, 200, 40],
        );
      },
    );
  },
);
