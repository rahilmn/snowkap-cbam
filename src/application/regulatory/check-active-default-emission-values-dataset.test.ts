import {
  describe,
  expect,
  it,
} from "vitest";

import {
  checkActiveDefaultEmissionValuesDataset,
} from "./check-active-default-emission-values-dataset";

interface Op {
  table: string;
  filters: [string, unknown][];
  limitValue: number | null;
}

interface Recorder {
  ops: Op[];
}

/**
 * Same generic per-table chainable select-only mock shape as
 * list-audit-events.test.ts's makeMockSupabase -- this table only
 * needs eq/eq/limit, so it's the minimal slice of that shape.
 */
function makeMockSupabase(
  result: { data: unknown; error: unknown },
  recorder: Recorder = { ops: [] },
) {
  function builder(
    table: string,
  ) {
    const op: Op = {
      table,
      filters: [],
      limitValue: null,
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
      limit: (n: number) => {
        op.limitValue = n;
        return Promise.resolve(result);
      },
    };

    return chain;
  }

  return {
    from: (table: string) => builder(table),
  } as never;
}

describe(
  "checkActiveDefaultEmissionValuesDataset",
  () => {
    it(
      "reports ok with the single dataset id when exactly one ACTIVE dataset is found",
      async () => {
        const result =
          await checkActiveDefaultEmissionValuesDataset(
            makeMockSupabase(
              { data: [{ id: "dataset-1" }], error: null },
            ),
          );

        expect(result).toEqual(
          { status: "ok", dataset_ids: ["dataset-1"] },
        );
      },
    );

    it(
      "reports missing (not ok) when zero ACTIVE datasets are found",
      async () => {
        const result =
          await checkActiveDefaultEmissionValuesDataset(
            makeMockSupabase(
              { data: [], error: null },
            ),
          );

        expect(result).toEqual(
          { status: "missing", dataset_ids: [] },
        );
      },
    );

    it(
      "reports duplicate with both dataset ids when more than one ACTIVE dataset is found",
      async () => {
        const result =
          await checkActiveDefaultEmissionValuesDataset(
            makeMockSupabase(
              {
                data: [{ id: "dataset-1" }, { id: "dataset-2" }],
                error: null,
              },
            ),
          );

        expect(result).toEqual(
          {
            status: "duplicate",
            dataset_ids: ["dataset-1", "dataset-2"],
          },
        );
      },
    );

    it(
      "reports error (not ok) when the query itself errors, without throwing",
      async () => {
        const result =
          await checkActiveDefaultEmissionValuesDataset(
            makeMockSupabase(
              { data: null, error: { message: "connection reset" } },
            ),
          );

        expect(result).toEqual(
          { status: "error", dataset_ids: [] },
        );
      },
    );

    it(
      "filters on dataset_type=DEFAULT_EMISSION_VALUES and status=ACTIVE, capped at 2 rows",
      async () => {
        const recorder: Recorder =
          { ops: [] };

        await checkActiveDefaultEmissionValuesDataset(
          makeMockSupabase(
            { data: [], error: null },
            recorder,
          ),
        );

        expect(recorder.ops[0]?.filters).toEqual(
          [
            ["dataset_type", "DEFAULT_EMISSION_VALUES"],
            ["status", "ACTIVE"],
          ],
        );

        expect(recorder.ops[0]?.limitValue).toBe(2);
      },
    );

    it(
      "propagates a rejected query rather than swallowing it, so the caller's own try/catch decides how to log and degrade",
      async () => {
        const rejecting = {
          from: () => (
            {
              select: () => (
                {
                  eq: () => (
                    {
                      eq: () => (
                        {
                          limit:
                            () =>
                              Promise.reject(
                                new Error(
                                  "network unreachable",
                                ),
                              ),
                        }
                      ),
                    }
                  ),
                }
              ),
            }
          ),
        } as never;

        await expect(
          checkActiveDefaultEmissionValuesDataset(
            rejecting,
          ),
        ).rejects.toThrow(
          "network unreachable",
        );
      },
    );
  },
);
