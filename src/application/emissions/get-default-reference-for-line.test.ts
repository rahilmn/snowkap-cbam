import {
  describe,
  expect,
  it,
} from "vitest";

import {
  getDefaultReferenceForLine,
} from "./get-default-reference-for-line";

import type {
  RegulatoryRecord,
} from "../../domain/regulatory/types";

function record(
  overrides: Partial<RegulatoryRecord> = {},
): RegulatoryRecord {
  return {
    dataset_id: "dataset-1",
    dataset_version: "2026.1",
    origin_country_name: "China",
    source_sheet: "Sheet1",
    source_row: 12,
    source_trade_code: "25232100",
    normalized_trade_code: "25232100",
    code_level: "CN8",
    sector: "CEMENT",
    product_name: "Cement clinker",
    emission_unit: "tCO2e/t",
    direct_emissions: { value: "1.850", status: "AVAILABLE", raw_source_value: "1.850" },
    indirect_emissions: { value: "0.400", status: "AVAILABLE", raw_source_value: "0.400" },
    total_emissions: { value: "2.250", status: "AVAILABLE", raw_source_value: "2.250" },
    source_production_route_code: null,
    production_route: null,
    ...overrides,
  } as RegulatoryRecord;
}

function fakeRepository(
  {
    candidates = [],
    goodSector = "CEMENT",
  }: {
    candidates?: RegulatoryRecord[];
    goodSector?: string | null;
  } = {},
) {
  return {
    findActiveDefaultEmissionCandidates: async () => candidates,
    findCbamGoodsByCode: async () =>
      goodSector === null
        ? []
        : [{ trade_code: "25232100", trade_code_type: "CN", record_level: "TRADE_GOOD", sector: goodSector, description: "x", functional_unit: "TONNES" }],
  } as never;
}

function fakeMapper(
  status: "MAPPED" | "UNLISTED" = "MAPPED",
) {
  return {
    mapCountry: async () =>
      status === "MAPPED"
        ? { status: "MAPPED", regulatory_country_name: "China" }
        : { status: "UNLISTED" },
  } as never;
}

function fakeSupabase(
  releaseDate: string | null = "2026-01-15",
  shipmentOrgId = "org-1",
) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            releaseDate === null
              ? { data: null }
              : { data: { release_date: releaseDate, org_id: shipmentOrgId } },
        }),
      }),
    }),
  } as never;
}

const ORG_ID =
  "org-1";

const LINE =
  {
    shipmentId: "ship-1",
    cnCode: "25232100",
    originCountry: "CN",
    productionRouteIndicator: null,
  };

describe(
  "getDefaultReferenceForLine",
  () => {
    it(
      "returns AVAILABLE with the resolver's own values when a candidate resolves and treatment is consistent",
      async () => {
        const result =
          await getDefaultReferenceForLine(
            fakeSupabase(),
            fakeRepository({ candidates: [record()] }),
            fakeMapper(),
            ORG_ID,
            LINE,
          );

        expect(result).toEqual(
          {
            status: "AVAILABLE",
            direct: record().direct_emissions,
            indirect: record().indirect_emissions,
            total: record().total_emissions,
          },
        );
      },
    );

    it(
      "returns UNAVAILABLE when the resolver finds no candidate",
      async () => {
        const result =
          await getDefaultReferenceForLine(
            fakeSupabase(),
            fakeRepository({ candidates: [] }),
            fakeMapper(),
            ORG_ID,
            LINE,
          );

        expect(result).toEqual(
          { status: "UNAVAILABLE" },
        );
      },
    );

    it(
      "returns UNAVAILABLE when the good's own sector cannot be determined (shipment not found)",
      async () => {
        const result =
          await getDefaultReferenceForLine(
            fakeSupabase(null),
            fakeRepository({ candidates: [record()] }),
            fakeMapper(),
            ORG_ID,
            LINE,
          );

        expect(result).toEqual(
          { status: "UNAVAILABLE" },
        );
      },
    );

    it(
      "applies the Annex-II proxy treatment rule using the good's real sector, not the org's default assumption",
      async () => {
        const annexIIRecord =
          record(
            {
              sector: "IRON_STEEL",
              direct_emissions: { value: "1.500", status: "AVAILABLE", raw_source_value: "1.500" },
              total_emissions: { value: "1.500", status: "AVAILABLE", raw_source_value: "1.500" },
              indirect_emissions: { value: null, status: "NOT_APPLICABLE", raw_source_value: null },
            },
          );

        const result =
          await getDefaultReferenceForLine(
            fakeSupabase(),
            fakeRepository({ candidates: [annexIIRecord], goodSector: "IRON_STEEL" }),
            fakeMapper(),
            ORG_ID,
            LINE,
          );

        expect(result.status).toBe("AVAILABLE");
      },
    );

    it(
      "returns UNAVAILABLE when the shipment id belongs to a DIFFERENT org -- never reads that org's release_date or sector to build a reference",
      async () => {
        const result =
          await getDefaultReferenceForLine(
            fakeSupabase("2026-01-15", "org-2"),
            fakeRepository({ candidates: [record()] }),
            fakeMapper(),
            ORG_ID,
            LINE,
          );

        expect(result).toEqual(
          { status: "UNAVAILABLE" },
        );
      },
    );

    it(
      "returns UNAVAILABLE for an unlisted origin that has no fallback candidate",
      async () => {
        const result =
          await getDefaultReferenceForLine(
            fakeSupabase(),
            fakeRepository({ candidates: [] }),
            fakeMapper("UNLISTED"),
            ORG_ID,
            LINE,
          );

        expect(result).toEqual(
          { status: "UNAVAILABLE" },
        );
      },
    );
  },
);
