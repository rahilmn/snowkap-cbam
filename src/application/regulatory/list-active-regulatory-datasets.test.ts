import {
  describe,
  expect,
  it,
} from "vitest";

import {
  listActiveRegulatoryDatasets,
} from "./list-active-regulatory-datasets";

const defaultEmissionValuesRow =
  {
    id: "dataset-1",
    dataset_type: "DEFAULT_EMISSION_VALUES",
    version: "2026-definitive-corrected",
    status: "ACTIVE",
    effective_from: "2026-01-01",
    effective_to: null,
    source_file_name: "default_emission_values.csv",
    source_checksum: "abc123",
    imported_at: "2026-08-27T11:00:00Z",
    created_at: "2026-08-27T10:00:00Z",
  };

const cbamGoodsRow =
  {
    id: "dataset-2",
    dataset_type: "CBAM_GOODS",
    version: "2026-01",
    status: "ACTIVE",
    effective_from: "2026-01-01",
    effective_to: "2026-12-31",
    source_file_name: null,
    source_checksum: null,
    imported_at: null,
    created_at: "2026-08-26T09:00:00Z",
  };

interface Op {
  table: string;
  filters: [string, unknown][];
  orders: [string, boolean][];
}

interface Recorder {
  fromCalls: string[];
  ops: Op[];
}

/**
 * Same generic per-table chainable select-only mock shape as
 * list-audit-events.test.ts's makeMockSupabase.
 */
function makeMockSupabase(
  result: { data: unknown; error: unknown },
  recorder: Recorder = { fromCalls: [], ops: [] },
) {
  function builder(
    table: string,
  ) {
    const op: Op = {
      table,
      filters: [],
      orders: [],
    };

    const chain: Record<string, unknown> = {
      select: () => {
        recorder.ops.push(op);
        return chain;
      },
      eq: (col: string, val: unknown) => {
        op.filters.push([col, val]);
        return chain;
      },
      order: (col: string, opts: { ascending: boolean }) => {
        op.orders.push([col, opts.ascending]);
        return Promise.resolve(result);
      },
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
  "listActiveRegulatoryDatasets",
  () => {
    it(
      "returns status ok with every ACTIVE dataset mapped, real columns only (no fabricated verified_at)",
      async () => {
        const result =
          await listActiveRegulatoryDatasets(
            makeMockSupabase(
              {
                data: [defaultEmissionValuesRow, cbamGoodsRow],
                error: null,
              },
            ),
          );

        expect(result).toEqual(
          {
            status: "ok",
            datasets: [
              {
                id: "dataset-1",
                dataset_type: "DEFAULT_EMISSION_VALUES",
                version: "2026-definitive-corrected",
                status: "ACTIVE",
                effective_from: "2026-01-01",
                effective_to: null,
                source_file_name: "default_emission_values.csv",
                source_checksum: "abc123",
                imported_at: "2026-08-27T11:00:00Z",
                created_at: "2026-08-27T10:00:00Z",
              },
              {
                id: "dataset-2",
                dataset_type: "CBAM_GOODS",
                version: "2026-01",
                status: "ACTIVE",
                effective_from: "2026-01-01",
                effective_to: "2026-12-31",
                source_file_name: null,
                source_checksum: null,
                imported_at: null,
                created_at: "2026-08-26T09:00:00Z",
              },
            ],
          },
        );
      },
    );

    it(
      "returns status ok with an empty datasets array when there are genuinely zero ACTIVE datasets, not an error",
      async () => {
        const result =
          await listActiveRegulatoryDatasets(
            makeMockSupabase(
              { data: [], error: null },
            ),
          );

        expect(result).toEqual(
          { status: "ok", datasets: [] },
        );
      },
    );

    it(
      "returns status error (never a fabricated empty ok) when the query errors",
      async () => {
        const result =
          await listActiveRegulatoryDatasets(
            makeMockSupabase(
              { data: null, error: { message: "connection reset" } },
            ),
          );

        expect(result).toEqual(
          { status: "error" },
        );
      },
    );

    it(
      "filters on status=ACTIVE only (every dataset_type, not just DEFAULT_EMISSION_VALUES) and orders by dataset_type",
      async () => {
        const recorder: Recorder =
          { fromCalls: [], ops: [] };

        await listActiveRegulatoryDatasets(
          makeMockSupabase(
            { data: [], error: null },
            recorder,
          ),
        );

        expect(recorder.fromCalls).toEqual(
          ["regulatory_datasets"],
        );

        expect(recorder.ops[0]?.filters).toEqual(
          [["status", "ACTIVE"]],
        );

        expect(recorder.ops[0]?.orders).toEqual(
          [["dataset_type", true]],
        );
      },
    );
  },
);
