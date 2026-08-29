import {
  describe,
  expect,
  it,
} from "vitest";

import {
  reproduceCalculationResult,
} from "./reproduce-calculation-result";

import {
  ENGINE_VERSION,
} from "../../domain/calculations/types";

import type {
  RegulatoryRepository,
} from "../../infrastructure/regulatory/regulatory-repository";

const orgId =
  "org-1" as never;

const calculationResultId =
  "calc-1" as never;

/**
 * Same shape as calculate-line.test.ts's own mockRepository -- only
 * findCbamGoodsByCode is ever consulted (via the shared
 * resolveGoodSectorForActualLine, for the ACTUAL-path Annex II gate),
 * so the other four port methods return empty/never-resolving
 * stand-ins.
 */
function mockRepository(
  sector: string | null = null,
): RegulatoryRepository {
  return {
    findActiveDefaultEmissionCandidates: () =>
      Promise.resolve(
        [],
      ),

    findCbamGoodsByCode: () =>
      Promise.resolve(
        sector === null
          ? []
          : [
              {
                trade_code: "72061000",
                trade_code_type: "CN8",
                record_level: "TRADE_GOOD",
                sector,
                description: "test good",
                functional_unit: "TONNES",
              },
            ],
      ),

    searchCbamGoodsByPrefix: () =>
      Promise.resolve(
        [],
      ),

    searchCbamGoodsByText: () =>
      Promise.resolve(
        [],
      ),

    findProductionRoutes: () =>
      Promise.resolve(
        [],
      ),
  };
}

const defaultDetermination =
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

// The recomputed step for defaultDetermination + quantity "10.5" --
// deliberately key-reordered relative to how calculate-line-emissions.ts
// constructs it (`value` before `inputs`, and `inputs`' own keys
// swapped), to prove the reproduction check's deep-equality is genuinely
// structural rather than a JSON.stringify(...) === JSON.stringify(...)
// comparison -- jsonb does not preserve object key insertion order (see
// reproduce-calculation-result.ts's own deepEqual doc comment), so a
// real stored row could come back in either key order.
const defaultStoredSteps =
  [
    {
      step: "LINE_EMBEDDED_EMISSIONS",
      rule_ref: "RULE-EE-001",
      value: "14.595",
      formula: "line_embedded_emissions = quantity * resolution.values.total.value",
      inputs: { specific_embedded_emissions: "1.390", quantity: "10.5" },
    },
  ];

const actualDeterminationZeroIndirect =
  {
    method: "ACTUAL",
    snapshot: {
      emission_data_id: "ed-1",
      emission_data_version: 1,
      installation_id: "inst-1",
      resolved_at: "2026-08-28T00:00:00.000Z",
      values: {
        direct_specific: "1.0",
        indirect_specific: "0",
      },
      emission_unit: "TCO2E_PER_TONNE",
      methodology: "EU_METHOD",
      verification: { status: "VERIFIED", verifier_user_id: "user-1" },
      evidence_file_ids: ["evidence-1"],
      sharing_grant_id: null,
    },
  };

const actualStoredSteps =
  [
    {
      step: "LINE_EMBEDDED_EMISSIONS",
      rule_ref: "RULE-EE-009",
      formula: "line_embedded_emissions = quantity * (direct_specific + indirect_specific)",
      inputs: { quantity: "10.5", direct_specific: "1.0", indirect_specific: "0" },
      value: "10.5",
    },
  ];

function mockSupabase(
  {
    calculationResultFetchResult,
    lineFetchResult = {
      data: { cn_code: "72061000" },
      error: null,
    },
    shipmentFetchResult = {
      data: { release_date: "2026-01-01" },
      error: null,
    },
    calculationResultEqCalls,
  }: {
    calculationResultFetchResult: { data: unknown; error: unknown };
    lineFetchResult?: { data: unknown; error: unknown };
    shipmentFetchResult?: { data: unknown; error: unknown };
    // Captures every .eq(col, val) call in the calculation_results
    // chain, in call order -- used to assert the query itself carries
    // both the id and org_id filters (P8 security review, finding #3:
    // "two walls, always both" applied at the query level, not just
    // the post-fetch row.org_id check below it).
    calculationResultEqCalls?: [string, unknown][];
  },
) {
  return {
    from: (
      table: string,
    ) => {
      if (table === "calculation_results") {
        return {
          select: () => {
            // Chainable regardless of how many .eq() calls the
            // function under test makes, so this mock doesn't need to
            // change shape every time a new query-level filter is
            // added -- see .maybeSingle() below for where the chain
            // terminates.
            const chain = {
              eq: (col: string, val: unknown) => {
                calculationResultEqCalls?.push(
                  [col, val],
                );
                return chain;
              },
              maybeSingle: () =>
                Promise.resolve(
                  calculationResultFetchResult,
                ),
            };

            return chain;
          },
        };
      }

      if (table === "shipments") {
        return {
          select: () => (
            {
              eq: () => (
                {
                  maybeSingle: () =>
                    Promise.resolve(
                      shipmentFetchResult,
                    ),
                }
              ),
            }
          ),
        };
      }

      // shipment_lines -- only ever queried for cn_code, on the ACTUAL
      // path (resolveCnCodeForLine).
      return {
        select: () => (
          {
            eq: () => (
              {
                maybeSingle: () =>
                  Promise.resolve(
                    lineFetchResult,
                  ),
              }
            ),
          }
        ),
      };
    },
  } as never;
}

describe(
  "reproduceCalculationResult",
  () => {
    it(
      "reports REPRODUCIBLE for a DEFAULT-method row that recomputes identically",
      async () => {
        const result =
          await reproduceCalculationResult(
            mockSupabase(
              {
                calculationResultFetchResult: {
                  data: {
                    org_id: "org-1",
                    line_id: "line-1",
                    shipment_id: "ship-1",
                    engine_version: ENGINE_VERSION,
                    quantity: "10.5",
                    quantity_unit: "TONNES",
                    determination: defaultDetermination,
                    steps: defaultStoredSteps,
                    embedded_emissions_tco2e: "14.595",
                  },
                  error: null,
                },
              },
            ),
            mockRepository(),
            orgId,
            calculationResultId,
          );

        expect(result).toEqual(
          { status: "REPRODUCIBLE" },
        );
      },
    );

    it(
      "reports REPRODUCIBLE for an ACTUAL-method row in an Annex-II sector, proving the good_sector re-derivation path (shipment_lines.cn_code -> shipments.release_date -> repository.findCbamGoodsByCode) is actually exercised",
      async () => {
        const result =
          await reproduceCalculationResult(
            mockSupabase(
              {
                calculationResultFetchResult: {
                  data: {
                    org_id: "org-1",
                    line_id: "line-1",
                    shipment_id: "ship-1",
                    engine_version: ENGINE_VERSION,
                    quantity: "10.5",
                    quantity_unit: "TONNES",
                    determination: actualDeterminationZeroIndirect,
                    steps: actualStoredSteps,
                    embedded_emissions_tco2e: "10.5",
                  },
                  error: null,
                },
              },
            ),
            mockRepository(
              "IRON_STEEL",
            ),
            orgId,
            calculationResultId,
          );

        expect(result).toEqual(
          { status: "REPRODUCIBLE" },
        );
      },
    );

    it(
      "reports MISMATCH when the stored embedded_emissions_tco2e was tampered with relative to what the pure engine actually recomputes -- proves the check recomputes rather than echoing the stored value back",
      async () => {
        const result =
          await reproduceCalculationResult(
            mockSupabase(
              {
                calculationResultFetchResult: {
                  data: {
                    org_id: "org-1",
                    line_id: "line-1",
                    shipment_id: "ship-1",
                    engine_version: ENGINE_VERSION,
                    quantity: "10.5",
                    quantity_unit: "TONNES",
                    determination: defaultDetermination,
                    steps: defaultStoredSteps,
                    embedded_emissions_tco2e: "999.999",
                  },
                  error: null,
                },
              },
            ),
            mockRepository(),
            orgId,
            calculationResultId,
          );

        expect(result).toEqual(
          {
            status: "MISMATCH",
            stored: {
              steps: defaultStoredSteps,
              embedded_emissions_tco2e: "999.999",
            },
            recomputed: {
              steps: [
                {
                  step: "LINE_EMBEDDED_EMISSIONS",
                  rule_ref: "RULE-EE-001",
                  formula: "line_embedded_emissions = quantity * resolution.values.total.value",
                  inputs: { quantity: "10.5", specific_embedded_emissions: "1.390" },
                  value: "14.595",
                },
              ],
              embedded_emissions_tco2e: "14.595",
            },
          },
        );
      },
    );

    it(
      "reports ENGINE_VERSION_CHANGED without attempting a comparison when the row's engine_version differs from the current constant",
      async () => {
        const result =
          await reproduceCalculationResult(
            mockSupabase(
              {
                calculationResultFetchResult: {
                  data: {
                    org_id: "org-1",
                    line_id: "line-1",
                    shipment_id: "ship-1",
                    engine_version: "0.9.0",
                    quantity: "10.5",
                    quantity_unit: "TONNES",
                    determination: defaultDetermination,
                    steps: defaultStoredSteps,
                    embedded_emissions_tco2e: "14.595",
                  },
                  error: null,
                },
              },
            ),
            mockRepository(),
            orgId,
            calculationResultId,
          );

        expect(result).toEqual(
          {
            status: "ENGINE_VERSION_CHANGED",
            storedEngineVersion: "0.9.0",
            currentEngineVersion: ENGINE_VERSION,
          },
        );
      },
    );

    it(
      "reports NOT_FOUND when no row exists for this id",
      async () => {
        const result =
          await reproduceCalculationResult(
            mockSupabase(
              {
                calculationResultFetchResult: { data: null, error: null },
              },
            ),
            mockRepository(),
            orgId,
            calculationResultId,
          );

        expect(result).toEqual(
          { status: "NOT_FOUND" },
        );
      },
    );

    it(
      "reports the same NOT_FOUND -- not a distinct forbidden status -- when the row exists but belongs to a different org, so a caller can never tell the two cases apart",
      async () => {
        const result =
          await reproduceCalculationResult(
            mockSupabase(
              {
                calculationResultFetchResult: {
                  data: {
                    org_id: "org-2",
                    line_id: "line-1",
                    shipment_id: "ship-1",
                    engine_version: ENGINE_VERSION,
                    quantity: "10.5",
                    quantity_unit: "TONNES",
                    determination: defaultDetermination,
                    steps: defaultStoredSteps,
                    embedded_emissions_tco2e: "14.595",
                  },
                  error: null,
                },
              },
            ),
            mockRepository(),
            orgId,
            calculationResultId,
          );

        expect(result).toEqual(
          { status: "NOT_FOUND" },
        );
      },
    );

    it(
      "applies both id and org_id as explicit query-level filters on calculation_results (Wall 1, not relying on RLS or the post-fetch row.org_id check alone)",
      async () => {
        const calculationResultEqCalls: [string, unknown][] =
          [];

        await reproduceCalculationResult(
          mockSupabase(
            {
              calculationResultFetchResult: { data: null, error: null },
              calculationResultEqCalls,
            },
          ),
          mockRepository(),
          orgId,
          calculationResultId,
        );

        expect(calculationResultEqCalls).toContainEqual(
          ["id", calculationResultId],
        );

        expect(calculationResultEqCalls).toContainEqual(
          ["org_id", orgId],
        );
      },
    );

    it(
      "reports INPUTS_DRIFTED, not a thrown error, when a stored ACTUAL row's line has since been reclassified into an Annex II sector with non-zero indirect_specific -- the manage-lines.ts in-place cn_code edit case (P8 security review, finding #1)",
      async () => {
        const result =
          await reproduceCalculationResult(
            mockSupabase(
              {
                calculationResultFetchResult: {
                  data: {
                    org_id: "org-1",
                    line_id: "line-1",
                    shipment_id: "ship-1",
                    engine_version: ENGINE_VERSION,
                    quantity: "10.5",
                    quantity_unit: "TONNES",
                    // Stored as calculated against a non-Annex-II good
                    // with non-zero indirect_specific -- COMPUTED at
                    // the time, and the stored steps/output reflect
                    // that.
                    determination: {
                      method: "ACTUAL",
                      snapshot: {
                        ...actualDeterminationZeroIndirect.snapshot,
                        values: {
                          direct_specific: "1.0",
                          indirect_specific: "0.25",
                        },
                      },
                    },
                    steps: actualStoredSteps,
                    embedded_emissions_tco2e: "13.125",
                  },
                  error: null,
                },
              },
            ),
            // The line's *current* cn_code (resolveCnCodeForLine, via
            // the default lineFetchResult) now resolves to an Annex II
            // sector -- simulating a post-calculation reclassification.
            mockRepository(
              "IRON_STEEL",
            ),
            orgId,
            calculationResultId,
          );

        expect(result).toEqual(
          {
            status: "INPUTS_DRIFTED",
            recomputedStatus: "PARAMETER_DATASET_UNAVAILABLE",
          },
        );
      },
    );
  },
);
