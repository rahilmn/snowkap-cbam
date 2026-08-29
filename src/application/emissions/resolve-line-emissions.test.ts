import {
  describe,
  expect,
  it,
} from "vitest";

import {
  determineLineEmissions,
  redetermineLineEmissions,
} from "./resolve-line-emissions";

import type {
  RegulatoryCountryMapper,
  RegulatoryRepository,
} from "../../infrastructure/regulatory/regulatory-repository";

import type {
  CountryMappingOutcome,
} from "../../domain/emissions/types";

import type {
  RegulatoryRecord,
  RegulatoryValue,
} from "../../domain/regulatory/types";

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

const lineId =
  "line-1" as never;

const lineRow =
  {
    org_id: "org-1",
    cn_code: "25232100",
    origin_country: "CN",
    production_route_indicator: null,
    emission_determination: null,
  };

function availableValue(
  value: string,
): RegulatoryValue {
  return {
    value,
    status: "AVAILABLE",
    raw_source_value: value,
  };
}

function record(
  overrides: Partial<RegulatoryRecord> = {},
): RegulatoryRecord {
  return {
    dataset_id: "dataset-1",
    dataset_version: "2026-definitive-corrected",
    origin_country_name: "China",
    source_sheet: "Cement",
    source_row: 42,
    source_trade_code: "25232100",
    normalized_trade_code: "25232100",
    code_level: "CN8",
    sector: "CEMENT",
    product_name: "Cement clinker",
    emission_unit: "tCO2e/t",
    direct_emissions: availableValue("0.8"),
    indirect_emissions: availableValue("0.1"),
    total_emissions: availableValue("0.9"),
    source_production_route_code: null,
    production_route: null,
    ...overrides,
  };
}

function mockRepository(
  candidates: RegulatoryRecord[],
): RegulatoryRepository {
  return {
    findActiveDefaultEmissionCandidates: () =>
      Promise.resolve(
        candidates,
      ),

    findCbamGoodsByCode: () =>
      Promise.resolve(
        [],
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

function mockMapper(
  outcome: CountryMappingOutcome,
): RegulatoryCountryMapper {
  return {
    mapCountry: () =>
      Promise.resolve(
        outcome,
      ),
  };
}

function mockSupabase(
  {
    lineFetchResult = { data: lineRow, error: null },
    // The recheck fetch (fetchLineForResolution called a second time
    // after a 0-row CAS update, see resolve-line-emissions.ts) reuses
    // lineFetchResult unless a test needs the second read to see
    // different state -- e.g. simulating a determination that another
    // request set in the race window between the first read and the
    // write.
    recheckFetchResult,
    updateResult,
    updateCalls = [] as { predicate: "none" | "is_null"; payload: unknown }[],
    auditPayloads = [] as unknown[],
  }: {
    lineFetchResult?: { data: unknown; error: unknown };
    recheckFetchResult?: { data: unknown; error: unknown };
    updateResult?: { data: unknown; error: unknown };
    updateCalls?: { predicate: "none" | "is_null"; payload: unknown }[];
    auditPayloads?: unknown[];
  },
) {
  let selectCallCount =
    0;

  return {
    from: (
      table: string,
    ) => {
      if (table === "audit_events") {
        return {
          insert: (
            payload: unknown,
          ) => {
            auditPayloads.push(
              payload,
            );

            return Promise.resolve(
              { error: null },
            );
          },
        };
      }

      return {
        select: () => (
          {
            eq: () => (
              {
                maybeSingle: () => {
                  selectCallCount += 1;

                  const result =
                    selectCallCount === 1
                      ? lineFetchResult
                      : (recheckFetchResult ?? lineFetchResult);

                  return Promise.resolve(
                    result,
                  );
                },
              }
            ),
          }
        ),

        update: (
          payload: unknown,
        ) => (
          {
            eq: () => (
              {
                select: () => {
                  updateCalls.push(
                    { predicate: "none", payload },
                  );

                  return {
                    maybeSingle: () =>
                      Promise.resolve(
                        updateResult,
                      ),
                  };
                },

                is: () => (
                  {
                    select: () => {
                      updateCalls.push(
                        { predicate: "is_null", payload },
                      );

                      return {
                        maybeSingle: () =>
                          Promise.resolve(
                            updateResult,
                          ),
                      };
                    },
                  }
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
  "determineLineEmissions",
  () => {
    it(
      "persists a DEFAULT determination on an exact CN8 match with a MAPPED country",
      async () => {
        const updatedRow =
          {
            id: "line-1",
            shipment_id: "ship-1",
            org_id: "org-1",
            line_number: 1,
            cn_code: "25232100",
            cn_code_level: "CN8",
            goods_description: "Portland cement",
            origin_country: "CN",
            net_mass_tonnes: "10.5",
            quantity_mwh: null,
            production_route_name: null,
            production_route_indicator: null,
            emission_determination: {
              method: "DEFAULT",
              resolution: { reason: "EXACT_CN8_MATCH" },
            },
          };

        const result =
          await determineLineEmissions(
            mockSupabase(
              { updateResult: { data: updatedRow, error: null } },
            ),
            mockRepository(
              [record()],
            ),
            mockMapper(
              { status: "MAPPED", regulatory_country_name: "China" },
            ),
            memberContext(),
            lineId,
          );

        expect(result.status).toBe(
          "DETERMINED",
        );

        expect(
          result.status === "DETERMINED" ? result.resolution.reason : null,
        ).toBe(
          "EXACT_CN8_MATCH",
        );
      },
    );

    it(
      "resolves via the fallback territory for an UNLISTED (e.g. EU) origin country",
      async () => {
        const fallbackRecord =
          record(
            {
              origin_country_name: "_Other Countries and Territorie",
            },
          );

        const updatedRow =
          {
            id: "line-1",
            shipment_id: "ship-1",
            org_id: "org-1",
            line_number: 1,
            cn_code: "25232100",
            cn_code_level: "CN8",
            goods_description: null,
            origin_country: "DE",
            net_mass_tonnes: "10.5",
            quantity_mwh: null,
            production_route_name: null,
            production_route_indicator: null,
            emission_determination: { method: "DEFAULT", resolution: {} },
          };

        const result =
          await determineLineEmissions(
            mockSupabase(
              {
                lineFetchResult: {
                  data: { ...lineRow, origin_country: "DE" },
                  error: null,
                },
                updateResult: { data: updatedRow, error: null },
              },
            ),
            mockRepository(
              [fallbackRecord],
            ),
            mockMapper(
              { status: "UNLISTED" },
            ),
            memberContext(),
            lineId,
          );

        expect(result.status).toBe(
          "DETERMINED",
        );

        expect(
          result.status === "DETERMINED" ? result.resolution.reason : null,
        ).toBe(
          "OTHER_COUNTRIES_FALLBACK",
        );
      },
    );

    it.each([
      ["REFERENCE_REQUIRED", "REFERENCE_REQUIRED"],
      ["UNAVAILABLE", "UNAVAILABLE"],
      ["NOT_APPLICABLE", "NOT_APPLICABLE"],
    ] as const)(
      "reports UNRESOLVED with reason %s and persists nothing when the exact record is %s",
      async (valueStatus, expectedReason) => {
        const result =
          await determineLineEmissions(
            mockSupabase(
              {},
            ),
            mockRepository(
              [
                record(
                  {
                    total_emissions: {
                      value: null,
                      status: valueStatus,
                      raw_source_value: null,
                    },
                  },
                ),
              ],
            ),
            mockMapper(
              { status: "MAPPED", regulatory_country_name: "China" },
            ),
            memberContext(),
            lineId,
          );

        expect(result).toEqual(
          {
            status: "UNRESOLVED",
            resolution: expect.objectContaining(
              { status: "UNRESOLVED", reason: expectedReason },
            ),
            countryMapping: { status: "MAPPED", regulatory_country_name: "China" },
          },
        );
      },
    );

    it(
      "reports UNRESOLVED with AMBIGUOUS when two usable exact records remain",
      async () => {
        const result =
          await determineLineEmissions(
            mockSupabase(
              {},
            ),
            mockRepository(
              [
                record(),
                record({ source_row: 43 }),
              ],
            ),
            mockMapper(
              { status: "MAPPED", regulatory_country_name: "China" },
            ),
            memberContext(),
            lineId,
          );

        expect(
          result.status === "UNRESOLVED" ? result.resolution.reason : null,
        ).toBe(
          "AMBIGUOUS",
        );
      },
    );

    it(
      "reports UNRESOLVED with NO_MATCH when no candidates exist at all",
      async () => {
        const result =
          await determineLineEmissions(
            mockSupabase(
              {},
            ),
            mockRepository(
              [],
            ),
            mockMapper(
              { status: "MAPPED", regulatory_country_name: "China" },
            ),
            memberContext(),
            lineId,
          );

        expect(
          result.status === "UNRESOLVED" ? result.resolution.reason : null,
        ).toBe(
          "NO_MATCH",
        );
      },
    );

    it(
      "rejects ALREADY_DETERMINED without touching the repository or writing",
      async () => {
        let repositoryQueried =
          false;

        const repository =
          mockRepository(
            [record()],
          );

        repository.findActiveDefaultEmissionCandidates =
          () => {
            repositoryQueried = true;

            return Promise.resolve(
              [record()],
            );
          };

        const result =
          await determineLineEmissions(
            mockSupabase(
              {
                lineFetchResult: {
                  data: {
                    ...lineRow,
                    emission_determination: { method: "DEFAULT", resolution: {} },
                  },
                  error: null,
                },
              },
            ),
            repository,
            mockMapper(
              { status: "MAPPED", regulatory_country_name: "China" },
            ),
            memberContext(),
            lineId,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "ALREADY_DETERMINED" },
        );

        expect(repositoryQueried).toBe(
          false,
        );
      },
    );

    it(
      "reports LINE_NOT_FOUND when the line doesn't exist",
      async () => {
        const result =
          await determineLineEmissions(
            mockSupabase(
              { lineFetchResult: { data: null, error: null } },
            ),
            mockRepository(
              [],
            ),
            mockMapper(
              { status: "UNLISTED" },
            ),
            memberContext(),
            lineId,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "LINE_NOT_FOUND" },
        );
      },
    );

    it(
      "surfaces an RLS denial (locked/void parent) as SHIPMENT_NOT_EDITABLE",
      async () => {
        const result =
          await determineLineEmissions(
            mockSupabase(
              { updateResult: { data: null, error: null } },
            ),
            mockRepository(
              [record()],
            ),
            mockMapper(
              { status: "MAPPED", regulatory_country_name: "China" },
            ),
            memberContext(),
            lineId,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "SHIPMENT_NOT_EDITABLE" },
        );
      },
    );

    it(
      "reports ALREADY_DETERMINED (not SHIPMENT_NOT_EDITABLE) when a concurrent request wins the race",
      async () => {
        // The CAS update (.is("emission_determination", null)) affects
        // 0 rows because another request set the determination between
        // this call's own read and write -- the recheck fetch must see
        // that and report the specific, correct reason rather than the
        // generic SHIPMENT_NOT_EDITABLE.
        const result =
          await determineLineEmissions(
            mockSupabase(
              {
                updateResult: { data: null, error: null },
                recheckFetchResult: {
                  data: {
                    ...lineRow,
                    emission_determination: { method: "DEFAULT", resolution: {} },
                  },
                  error: null,
                },
              },
            ),
            mockRepository(
              [record()],
            ),
            mockMapper(
              { status: "MAPPED", regulatory_country_name: "China" },
            ),
            memberContext(),
            lineId,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "ALREADY_DETERMINED" },
        );
      },
    );

    it(
      "sends the CAS predicate (.is emission_determination null) only for first-time determination",
      async () => {
        const updateCalls: { predicate: "none" | "is_null"; payload: unknown }[] =
          [];

        await determineLineEmissions(
          mockSupabase(
            {
              updateResult: { data: { ...lineRow, id: "line-1" }, error: null },
              updateCalls,
            },
          ),
          mockRepository(
            [record()],
          ),
          mockMapper(
            { status: "MAPPED", regulatory_country_name: "China" },
          ),
          memberContext(),
          lineId,
        );

        expect(updateCalls).toHaveLength(
          1,
        );

        expect(updateCalls[0]?.predicate).toBe(
          "is_null",
        );
      },
    );

    it(
      "persists the frozen snapshot (not the raw resolution) as emission_determination",
      async () => {
        const updateCalls: { predicate: "none" | "is_null"; payload: unknown }[] =
          [];

        await determineLineEmissions(
          mockSupabase(
            {
              updateResult: { data: { ...lineRow, id: "line-1" }, error: null },
              updateCalls,
            },
          ),
          mockRepository(
            [record()],
          ),
          mockMapper(
            { status: "MAPPED", regulatory_country_name: "China" },
          ),
          memberContext(),
          lineId,
        );

        const payload =
          updateCalls[0]?.payload as { emission_determination: { method: string; resolution: { country_mapping: unknown } } };

        expect(payload.emission_determination.method).toBe(
          "DEFAULT",
        );

        expect(payload.emission_determination.resolution.country_mapping).toEqual(
          { status: "MAPPED", regulatory_country_name: "China" },
        );
      },
    );

    it(
      "rejects LINE_NOT_FOUND (not ALREADY_DETERMINED/etc) when the line belongs to a different org than the caller's active org",
      async () => {
        let repositoryQueried =
          false;

        const repository =
          mockRepository(
            [record()],
          );

        repository.findActiveDefaultEmissionCandidates =
          () => {
            repositoryQueried = true;

            return Promise.resolve(
              [record()],
            );
          };

        const result =
          await determineLineEmissions(
            mockSupabase(
              {
                lineFetchResult: {
                  data: { ...lineRow, org_id: "org-2" },
                  error: null,
                },
              },
            ),
            repository,
            mockMapper(
              { status: "MAPPED", regulatory_country_name: "China" },
            ),
            memberContext(),
            lineId,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "LINE_NOT_FOUND" },
        );

        expect(repositoryQueried).toBe(
          false,
        );
      },
    );

    it(
      "resolves via an exact route-specific match when the line has a production route",
      async () => {
        const routeRecord =
          record(
            { source_production_route_code: "(A)" },
          );

        const result =
          await determineLineEmissions(
            mockSupabase(
              {
                lineFetchResult: {
                  data: { ...lineRow, production_route_indicator: "(A)" },
                  error: null,
                },
                updateResult: {
                  data: { ...lineRow, id: "line-1", production_route_indicator: "(A)" },
                  error: null,
                },
              },
            ),
            mockRepository(
              [routeRecord],
            ),
            mockMapper(
              { status: "MAPPED", regulatory_country_name: "China" },
            ),
            memberContext(),
            lineId,
          );

        expect(result.status).toBe(
          "DETERMINED",
        );

        expect(
          result.status === "DETERMINED" ? result.resolution.reason : null,
        ).toBe(
          "EXACT_CN8_MATCH",
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
                    "determineLineEmissions must not read the database before the capability check runs",
                  );
                },
              } as never;

            const result =
              await determineLineEmissions(
                supabase,
                mockRepository(
                  [record()],
                ),
                mockMapper(
                  { status: "MAPPED", regulatory_country_name: "China" },
                ),
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
              await determineLineEmissions(
                mockSupabase(
                  {
                    updateResult: {
                      data: { ...lineRow, id: "line-1" },
                      error: null,
                    },
                  },
                ),
                mockRepository(
                  [record()],
                ),
                mockMapper(
                  { status: "MAPPED", regulatory_country_name: "China" },
                ),
                memberContext(["IMPORTER_DECLARANT"]),
                lineId,
              );

            expect(result.status).toBe(
              "DETERMINED",
            );
          },
        );
      },
    );
  },
);

describe(
  "redetermineLineEmissions",
  () => {
    it(
      "overwrites an existing determination",
      async () => {
        const updatedRow =
          {
            id: "line-1",
            shipment_id: "ship-1",
            org_id: "org-1",
            line_number: 1,
            cn_code: "25232100",
            cn_code_level: "CN8",
            goods_description: null,
            origin_country: "CN",
            net_mass_tonnes: "10.5",
            quantity_mwh: null,
            production_route_name: null,
            production_route_indicator: null,
            emission_determination: { method: "DEFAULT", resolution: {} },
          };

        const result =
          await redetermineLineEmissions(
            mockSupabase(
              {
                lineFetchResult: {
                  data: {
                    ...lineRow,
                    emission_determination: { method: "DEFAULT", resolution: {} },
                  },
                  error: null,
                },
                updateResult: { data: updatedRow, error: null },
              },
            ),
            mockRepository(
              [record()],
            ),
            mockMapper(
              { status: "MAPPED", regulatory_country_name: "China" },
            ),
            memberContext(),
            lineId,
          );

        expect(result.status).toBe(
          "DETERMINED",
        );
      },
    );

    it(
      "records the prior determination on the audit payload, not just the new one",
      async () => {
        const auditPayloads: unknown[] =
          [];

        const priorDetermination =
          {
            method: "ACTUAL",
            snapshot: {
              emission_data_id: "prior-emission-data-1",
              emission_data_version: 3,
              sharing_grant_id: "prior-grant-1",
            },
          };

        await redetermineLineEmissions(
          mockSupabase(
            {
              lineFetchResult: {
                data: {
                  ...lineRow,
                  emission_determination: priorDetermination,
                },
                error: null,
              },
              updateResult: {
                data: { ...lineRow, id: "line-1", emission_determination: { method: "DEFAULT", resolution: {} } },
                error: null,
              },
              auditPayloads,
            },
          ),
          mockRepository(
            [record()],
          ),
          mockMapper(
            { status: "MAPPED", regulatory_country_name: "China" },
          ),
          memberContext(),
          lineId,
        );

        expect(auditPayloads).toHaveLength(
          1,
        );

        const payload =
          auditPayloads[0] as { payload: { previous_determination: unknown } };

        expect(payload.payload.previous_determination).toEqual(
          {
            method: "ACTUAL",
            emission_data_id: "prior-emission-data-1",
            emission_data_version: 3,
            sharing_grant_id: "prior-grant-1",
          },
        );
      },
    );

    it(
      "sends no CAS predicate -- an explicit override is allowed to overwrite",
      async () => {
        const updateCalls: { predicate: "none" | "is_null"; payload: unknown }[] =
          [];

        await redetermineLineEmissions(
          mockSupabase(
            {
              lineFetchResult: {
                data: {
                  ...lineRow,
                  emission_determination: { method: "DEFAULT", resolution: {} },
                },
                error: null,
              },
              updateResult: { data: { ...lineRow, id: "line-1" }, error: null },
              updateCalls,
            },
          ),
          mockRepository(
            [record()],
          ),
          mockMapper(
            { status: "MAPPED", regulatory_country_name: "China" },
          ),
          memberContext(),
          lineId,
        );

        expect(updateCalls).toHaveLength(
          1,
        );

        expect(updateCalls[0]?.predicate).toBe(
          "none",
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
                    "redetermineLineEmissions must not read the database before the capability check runs",
                  );
                },
              } as never;

            const result =
              await redetermineLineEmissions(
                supabase,
                mockRepository(
                  [record()],
                ),
                mockMapper(
                  { status: "MAPPED", regulatory_country_name: "China" },
                ),
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
              await redetermineLineEmissions(
                mockSupabase(
                  {
                    lineFetchResult: {
                      data: {
                        ...lineRow,
                        emission_determination: { method: "DEFAULT", resolution: {} },
                      },
                      error: null,
                    },
                    updateResult: { data: { ...lineRow, id: "line-1" }, error: null },
                  },
                ),
                mockRepository(
                  [record()],
                ),
                mockMapper(
                  { status: "MAPPED", regulatory_country_name: "China" },
                ),
                memberContext(["IMPORTER_DECLARANT"]),
                lineId,
              );

            expect(result.status).toBe(
              "DETERMINED",
            );
          },
        );
      },
    );
  },
);
