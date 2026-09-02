import {
  describe,
  expect,
  it,
} from "vitest";

import {
  getLatestCalculationsByShipment,
} from "./get-latest-calculations";

import {
  ENGINE_VERSION,
} from "../../domain/calculations/types";

const determination =
  {
    method: "DEFAULT",
    resolution: {
      dataset_id: "dataset-1",
      dataset_version: "2026-definitive-corrected",
      resolved_at: "2026-08-28T00:00:00.000Z",
      reason: "EXACT_CN8_MATCH",
      country_mapping: { status: "MAPPED", regulatory_country_name: "China" },
      record_identity: {
        source_sheet: "Cement",
        source_row: 42,
        source_trade_code: "25232100",
        origin_country_name: "China",
        source_production_route_code: null,
      },
      values: {
        direct: { value: "1.250", status: "AVAILABLE", raw_source_value: "1.250" },
        indirect: { value: "0.140", status: "AVAILABLE", raw_source_value: "0.140" },
        total: { value: "1.390", status: "AVAILABLE", raw_source_value: "1.390" },
      },
      emission_unit: "TCO2E_PER_TONNE",
      trace: [],
    },
  };

function calculationResultRow(
  overrides: Partial<{
    id: string;
    line_id: string;
    embedded_emissions_tco2e: string;
    calculated_at: string;
  }>,
) {
  return {
    id: "calc-1",
    line_id: "line-1",
    engine_version: ENGINE_VERSION,
    embedded_emissions_tco2e: "14.595",
    steps: [
      {
        step: "LINE_EMBEDDED_EMISSIONS",
        rule_ref: "RULE-EE-001",
        formula: "line_embedded_emissions = quantity * resolution.values.total.value",
        inputs: { quantity: "10.5", specific_embedded_emissions: "1.390" },
        value: "14.595",
      },
    ],
    calculated_at: "2026-08-28T00:00:00.000Z",
    determination,
    ...overrides,
  };
}

/**
 * Chainable and recording. Chainable because the query now carries two
 * .eq() filters rather than one; recording because the org filter added
 * on 2026-09-03 IS the fix, and a mock that swallowed filters would let
 * it be deleted again without a single test failing.
 */
function mockSupabase(
  result: { data: unknown; error: unknown },
  recorder?: { filters: [string, unknown][] },
) {
  const builder: Record<string, unknown> = {
    eq: (column: string, value: unknown) => {
      recorder?.filters.push([column, value]);
      return builder;
    },

    then: (
      resolve: (value: unknown) => unknown,
      reject: (reason: unknown) => unknown,
    ) =>
      Promise.resolve(
        result,
      ).then(resolve, reject),
  };

  return {
    from: () => (
      {
        select: () => builder,
      }
    ),
  } as never;
}

describe(
  "getLatestCalculationsByShipment",
  () => {
    it(
      "returns an empty object when the query errors -- an error case renders as 'not yet calculated', never a thrown error",
      async () => {
        const result =
          await getLatestCalculationsByShipment(
            mockSupabase(
              { data: null, error: { message: "boom" } },
            ),
            "org-1" as never,
            "ship-1" as never,
          );

        expect(result).toEqual(
          {},
        );
      },
    );

    it(
      "returns an empty object when data is null even without an error",
      async () => {
        const result =
          await getLatestCalculationsByShipment(
            mockSupabase(
              { data: null, error: null },
            ),
            "org-1" as never,
            "ship-1" as never,
          );

        expect(result).toEqual(
          {},
        );
      },
    );

    it(
      "maps a single row to a Record keyed by line_id, with every field mapped through",
      async () => {
        const result =
          await getLatestCalculationsByShipment(
            mockSupabase(
              {
                data: [
                  calculationResultRow(
                    {},
                  ),
                ],
                error: null,
              },
            ),
            "org-1" as never,
            "ship-1" as never,
          );

        expect(result).toEqual(
          {
            "line-1": {
              id: "calc-1",
              engine_version: ENGINE_VERSION,
              embedded_emissions_tco2e: "14.595",
              steps: [
                {
                  step: "LINE_EMBEDDED_EMISSIONS",
                  rule_ref: "RULE-EE-001",
                  formula: "line_embedded_emissions = quantity * resolution.values.total.value",
                  inputs: { quantity: "10.5", specific_embedded_emissions: "1.390" },
                  value: "14.595",
                },
              ],
              calculated_at: "2026-08-28T00:00:00.000Z",
              determination,
            },
          },
        );
      },
    );

    it(
      "keys 2+ rows for different lines independently -- the exact truncation/dedup bug class the P6 review found and fixed by switching to the latest_calculation_results view: a row for one line must never overwrite or crowd out a row for another",
      async () => {
        const result =
          await getLatestCalculationsByShipment(
            mockSupabase(
              {
                data: [
                  calculationResultRow(
                    {
                      id: "calc-1",
                      line_id: "line-1",
                      embedded_emissions_tco2e: "14.595",
                      calculated_at: "2026-08-28T00:00:00.000Z",
                    },
                  ),
                  calculationResultRow(
                    {
                      id: "calc-2",
                      line_id: "line-2",
                      embedded_emissions_tco2e: "99.000",
                      calculated_at: "2026-08-29T00:00:00.000Z",
                    },
                  ),
                  calculationResultRow(
                    {
                      id: "calc-3",
                      line_id: "line-3",
                      embedded_emissions_tco2e: "1.000",
                      calculated_at: "2026-08-27T00:00:00.000Z",
                    },
                  ),
                ],
                error: null,
              },
            ),
            "org-1" as never,
            "ship-1" as never,
          );

        expect(Object.keys(result).sort()).toEqual(
          ["line-1", "line-2", "line-3"],
        );

        expect(result["line-1"].id).toBe(
          "calc-1",
        );
        expect(result["line-1"].embedded_emissions_tco2e).toBe(
          "14.595",
        );

        expect(result["line-2"].id).toBe(
          "calc-2",
        );
        expect(result["line-2"].embedded_emissions_tco2e).toBe(
          "99.000",
        );

        expect(result["line-3"].id).toBe(
          "calc-3",
        );
        expect(result["line-3"].embedded_emissions_tco2e).toBe(
          "1.000",
        );
      },
    );

    /**
     * 2026-09-03 (P14). latest_calculation_results is RLS-scoped to every
     * org the USER belongs to, not the org they are acting as. Production
     * has a user who owns two organizations, so the active-org filter has
     * to be explicit here for the same reason it does on the shipment
     * itself.
     */
    it(
      "filters by the caller's ACTIVE org as well as the shipment, rather than relying on RLS alone",
      async () => {
        const recorder =
          { filters: [] as [string, unknown][] };

        await getLatestCalculationsByShipment(
          mockSupabase(
            { data: [], error: null },
            recorder,
          ),
          "org-1" as never,
          "ship-1" as never,
        );

        expect(recorder.filters).toContainEqual(
          ["org_id", "org-1"],
        );

        expect(recorder.filters).toContainEqual(
          ["shipment_id", "ship-1"],
        );
      },
    );
  },
);
