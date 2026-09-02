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
  // 2026-09-03 (P14, WP-K): the second query -- how many value rows the
  // active dataset holds. Reported by the check, never asserted by it.
  countResult: { count: number | null; error: unknown } =
    { count: 12540, error: null },
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
      select: (
        _columns?: unknown,
        options?: { count?: string; head?: boolean },
      ) => {
        recorder.ops.push(op);

        // A head+count select resolves on its own -- there is no
        // .limit() to terminate the chain.
        return options?.head
          ? {
              eq: (col: string, val: unknown) => {
                op.filters.push([col, val]);
                return Promise.resolve(countResult);
              },
            }
          : chain;
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
              { data: [{ id: "dataset-1", version: "2026-definitive-corrected" }], error: null },
            ),
          );

        expect(result).toEqual(
          {
            status: "ok",
            dataset_ids: ["dataset-1"],
            // 2026-09-03 (P14, WP-K): reported alongside the status, so
            // a deploy pointing at an empty or half-loaded dataset can
            // be seen rather than inferred.
            dataset_version: "2026-definitive-corrected",
            active_row_count: 12540,
          },
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
          { status: "missing", dataset_ids: [], dataset_version: null, active_row_count: null },
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
            dataset_version: null,
            active_row_count: null,
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
          { status: "error", dataset_ids: [], dataset_version: null, active_row_count: null },
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

    it(
      "reports a null row count, and stays ok, when the count query fails (P14)",
      async () => {
        // "How many rows does the active dataset hold" is information
        // for an operator, not an availability condition. A health
        // endpoint that went unhealthy because a count query timed out
        // would be worse than one that says it does not know.
        const result =
          await checkActiveDefaultEmissionValuesDataset(
            makeMockSupabase(
              {
                data: [
                  { id: "dataset-1", version: "2026-definitive-corrected" },
                ],
                error: null,
              },
              { ops: [] },
              { count: null, error: { message: "statement timeout" } },
            ),
          );

        expect(result.status).toBe(
          "ok",
        );

        expect(result.active_row_count).toBeNull();

        // The version still comes back -- it was read by the query that
        // succeeded.
        expect(result.dataset_version).toBe(
          "2026-definitive-corrected",
        );
      },
    );
  },
);
