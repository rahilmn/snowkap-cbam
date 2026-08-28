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

const orgId =
  "org-1" as never;

const actorUserId =
  "user-1" as never;

const lineId =
  "line-1" as never;

const lineRow =
  {
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
    updateResult,
  }: {
    lineFetchResult?: { data: unknown; error: unknown };
    updateResult?: { data: unknown; error: unknown };
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

        update: () => (
          {
            eq: () => (
              {
                select: () => (
                  {
                    maybeSingle: () =>
                      Promise.resolve(
                        updateResult,
                      ),
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
            orgId,
            actorUserId,
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
            orgId,
            actorUserId,
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
            orgId,
            actorUserId,
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
            orgId,
            actorUserId,
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
            orgId,
            actorUserId,
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
            orgId,
            actorUserId,
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
            orgId,
            actorUserId,
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
            orgId,
            actorUserId,
            lineId,
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "SHIPMENT_NOT_EDITABLE" },
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
            orgId,
            actorUserId,
            lineId,
          );

        expect(result.status).toBe(
          "DETERMINED",
        );
      },
    );
  },
);
