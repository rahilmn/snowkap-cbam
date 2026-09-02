import {
  describe,
  expect,
  it,
} from "vitest";

import {
  calculateLine,
} from "./calculate-line";

import {
  ENGINE_VERSION,
} from "../../domain/calculations/types";

import type {
  RegulatoryRepository,
} from "../../infrastructure/regulatory/regulatory-repository";

import type {
  OrgContext,
} from "../organizations/org-context";

const orgId =
  "org-1" as never;

const actorUserId =
  "user-1" as never;

function memberContext(
  capabilities: OrgContext["capabilities"] = ["IMPORTER_DECLARANT"],
): OrgContext {
  return {
    org_id: orgId,
    user_id: actorUserId,
    role: "MEMBER",
    capabilities,
  };
}

/**
 * Only findCbamGoodsByCode is consulted by calculateLine (for the
 * ACTUAL-path Annex II gate, calculate-line.ts's
 * resolveGoodSectorForActualLine) -- the other three port methods are
 * never called from this service, so they return empty/never-resolving
 * stand-ins the same way resolve-line-emissions.test.ts's own
 * mockRepository does for the methods it doesn't exercise either.
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

const lineId =
  "line-1" as never;

const computedDetermination =
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

const actualDetermination =
  {
    method: "ACTUAL",
    snapshot: {
      emission_data_id: "ed-1",
      emission_data_version: 1,
      installation_id: "inst-1",
      resolved_at: "2026-08-28T00:00:00.000Z",
      values: {
        direct_specific: "1.0",
        indirect_specific: "0.2",
      },
      emission_unit: "TCO2E_PER_TONNE",
      methodology: "EU_METHOD",
      verification: { status: "VERIFIED", verifier_user_id: "user-1" },
      evidence_file_ids: ["evidence-1"],
      sharing_grant_id: null,
    },
  };

function mockSupabase(
  {
    lineFetchResult = {
      data: {
        org_id: "org-1",
        shipment_id: "ship-1",
        cn_code: "25232100",
        net_mass_tonnes: "10.5",
        quantity_mwh: null,
        emission_determination: computedDetermination,
      },
      error: null,
    },
    shipmentFetchResult = {
      data: { release_date: "2026-01-01" },
      error: null,
    },
    insertResult = { error: null },
    insertPayloads = [] as unknown[],
  }: {
    lineFetchResult?: { data: unknown; error: unknown };
    shipmentFetchResult?: { data: unknown; error: unknown };
    insertResult?: { error: unknown };
    insertPayloads?: unknown[];
  },
) {
  return {
    from: (
      table: string,
    ) => {
      if (table === "audit_events") {
        return {
          insert: () =>
            Promise.resolve(
              { error: null },
            ),
        };
      }

      if (table === "calculation_results") {
        return {
          insert: (
            payload: unknown,
          ) => {
            insertPayloads.push(
              payload,
            );

            return Promise.resolve(
              insertResult,
            );
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
  "calculateLine",
  () => {
    it(
      "computes and persists a COMPUTED result",
      async () => {
        const insertPayloads: unknown[] =
          [];

        const result =
          await calculateLine(
            mockSupabase(
              { insertPayloads },
            ),
            mockRepository(),
            memberContext(),
            lineId,
          );

        expect(result.status).toBe(
          "OK",
        );

        expect(
          result.status === "OK" ? result.calculation.status : null,
        ).toBe(
          "COMPUTED",
        );

        expect(insertPayloads).toHaveLength(
          1,
        );

        expect(insertPayloads[0]).toMatchObject(
          {
            org_id: "org-1",
            line_id: "line-1",
            shipment_id: "ship-1",
            quantity: "10.5",
            quantity_unit: "TONNES",
            embedded_emissions_tco2e: "14.595",
          },
        );
      },
    );

    it(
      "returns INPUT_UNRESOLVED without persisting anything when the line has no determination",
      async () => {
        const insertPayloads: unknown[] =
          [];

        const result =
          await calculateLine(
            mockSupabase(
              {
                lineFetchResult: {
                  data: {
                    org_id: "org-1",
                    shipment_id: "ship-1",
                    net_mass_tonnes: "10.5",
                    quantity_mwh: null,
                    emission_determination: null,
                  },
                  error: null,
                },
                insertPayloads,
              },
            ),
            mockRepository(),
            memberContext(),
            lineId,
          );

        expect(result).toEqual(
          {
            status: "OK",
            calculation: {
              status: "INPUT_UNRESOLVED",
              engine_version: ENGINE_VERSION,
            },
          },
        );

        expect(insertPayloads).toHaveLength(
          0,
        );
      },
    );

    it(
      "reports LINE_NOT_FOUND when the line doesn't exist",
      async () => {
        const result =
          await calculateLine(
            mockSupabase(
              { lineFetchResult: { data: null, error: null } },
            ),
            mockRepository(),
            memberContext(),
            lineId,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "LINE_NOT_FOUND" },
        );
      },
    );

    it(
      "rejects LINE_NOT_FOUND when the line belongs to a different org than the caller's active org",
      async () => {
        const insertPayloads: unknown[] =
          [];

        const result =
          await calculateLine(
            mockSupabase(
              {
                lineFetchResult: {
                  data: {
                    org_id: "org-2",
                    shipment_id: "ship-1",
                    net_mass_tonnes: "10.5",
                    quantity_mwh: null,
                    emission_determination: computedDetermination,
                  },
                  error: null,
                },
                insertPayloads,
              },
            ),
            mockRepository(),
            memberContext(),
            lineId,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "LINE_NOT_FOUND" },
        );

        expect(insertPayloads).toHaveLength(
          0,
        );
      },
    );

    it(
      "reports PERSIST_FAILED when the insert fails for an ordinary reason",
      async () => {
        const result =
          await calculateLine(
            mockSupabase(
              { insertResult: { error: { message: "db error" } } },
            ),
            mockRepository(),
            memberContext(),
            lineId,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "PERSIST_FAILED" },
        );
      },
    );

    it(
      "reports SHIPMENT_NOT_EDITABLE when RLS rejects a LOCKED/VOID shipment's calculation (42501)",
      async () => {
        const result =
          await calculateLine(
            mockSupabase(
              { insertResult: { error: { code: "42501", message: "denied" } } },
            ),
            mockRepository(),
            memberContext(),
            lineId,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "SHIPMENT_NOT_EDITABLE" },
        );
      },
    );

    it(
      "computes and PERSISTS a direct-only figure for an ACTUAL determination on an IRON_STEEL good -- proves the sector lookup (shipments.release_date + repository.findCbamGoodsByCode) reaches the engine's Annex II treatment, not just the pure domain test (D1)",
      async () => {
        const insertPayloads: unknown[] =
          [];

        const result =
          await calculateLine(
            mockSupabase(
              {
                lineFetchResult: {
                  data: {
                    org_id: "org-1",
                    shipment_id: "ship-1",
                    cn_code: "72061000",
                    net_mass_tonnes: "10.5",
                    quantity_mwh: null,
                    emission_determination: actualDetermination,
                  },
                  error: null,
                },
                insertPayloads,
              },
            ),
            mockRepository(
              "IRON_STEEL",
            ),
            memberContext(),
            lineId,
          );

        // 2026-09-03 (owner decision D1). This case previously asserted
        // PARAMETER_DATASET_UNAVAILABLE and zero writes: an Annex II
        // good with non-zero indirect emissions produced no number at
        // all and nothing was persisted. That behaviour was decided to
        // be wrong -- Article 7(1) sentence 2 (RULE-EE-004) takes only
        // direct emissions into account for Annex II goods, so the
        // presence of indirect data is a reason to EXCLUDE it, not a
        // reason to refuse the whole calculation.
        //
        // The assertion is reversed rather than relaxed, and it now
        // proves the stronger thing: the sector genuinely reached the
        // engine AND the resulting figure was persisted.
        expect(result.status).toBe(
          "OK",
        );

        if (result.status === "OK") {
          expect(result.calculation.status).toBe(
            "COMPUTED",
          );

          if (result.calculation.status === "COMPUTED") {
            // Direct only: 10.5 x 1.0 = 10.5. Summing would have given
            // 10.5 x 1.2 = 12.6.
            expect(result.calculation.embedded_emissions_tco2e).toBe(
              "10.5",
            );

            expect(
              result.calculation.steps.map((step) => step.step),
            ).toEqual(
              ["ANNEX_II_DIRECT_ONLY", "LINE_EMBEDDED_EMISSIONS"],
            );
          }
        }

        expect(insertPayloads).toHaveLength(
          1,
        );
      },
    );

    it(
      "computes normally for an ACTUAL determination when the repository resolves a non-Annex-II sector",
      async () => {
        const insertPayloads: unknown[] =
          [];

        const result =
          await calculateLine(
            mockSupabase(
              {
                lineFetchResult: {
                  data: {
                    org_id: "org-1",
                    shipment_id: "ship-1",
                    cn_code: "25232100",
                    net_mass_tonnes: "10.5",
                    quantity_mwh: null,
                    emission_determination: actualDetermination,
                  },
                  error: null,
                },
                insertPayloads,
              },
            ),
            mockRepository(
              "CEMENT",
            ),
            memberContext(),
            lineId,
          );

        expect(
          result.status === "OK" ? result.calculation.status : null,
        ).toBe(
          "COMPUTED",
        );

        expect(insertPayloads).toHaveLength(
          1,
        );
      },
    );

    it(
      "does not query the repository at all for a DEFAULT determination -- the Annex II gate is ACTUAL-only",
      async () => {
        let repositoryCalled =
          false;

        const repository: RegulatoryRepository =
          {
            findActiveDefaultEmissionCandidates: () =>
              Promise.resolve(
                [],
              ),
            findCbamGoodsByCode: () => {
              repositoryCalled =
                true;

              return Promise.resolve(
                [],
              );
            },
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

        const result =
          await calculateLine(
            mockSupabase(
              {},
            ),
            repository,
            memberContext(),
            lineId,
          );

        expect(
          result.status === "OK" ? result.calculation.status : null,
        ).toBe(
          "COMPUTED",
        );

        expect(repositoryCalled).toBe(
          false,
        );
      },
    );

    describe(
      "capability gate",
      () => {
        it(
          "rejects an org without IMPORTER_DECLARANT with CAPABILITY_NOT_HELD, before touching the database",
          async () => {
            const supabase =
              {
                from: () => {
                  throw new Error(
                    "calculateLine must not read the database before the capability check runs",
                  );
                },
              } as never;

            const result =
              await calculateLine(
                supabase,
                mockRepository(),
                memberContext(["PRODUCER_OPERATOR"]),
                lineId,
              );

            expect(result).toEqual(
              { status: "REJECTED", reason: "CAPABILITY_NOT_HELD" },
            );
          },
        );

        it(
          "allows an org holding IMPORTER_DECLARANT",
          async () => {
            const result =
              await calculateLine(
                mockSupabase(
                  {},
                ),
                mockRepository(),
                memberContext(["IMPORTER_DECLARANT"]),
                lineId,
              );

            expect(result.status).toBe(
              "OK",
            );
          },
        );
      },
    );
  },
);
