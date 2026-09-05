import {
  describe,
  expect,
  it,
} from "vitest";

import {
  describeDefaultReference,
} from "./default-reference";

import type {
  RegulatoryRecord,
  RegulatoryValue,
} from "../regulatory/types";

function value(
  overrides: Partial<RegulatoryValue> = {},
): RegulatoryValue {
  return {
    value: "1.850",
    status: "AVAILABLE",
    raw_source_value: "1.850",
    ...overrides,
  };
}

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
    direct_emissions: value(),
    indirect_emissions: value({ value: "0.400", raw_source_value: "0.400" }),
    total_emissions: value({ value: "2.250", raw_source_value: "2.250" }),
    source_production_route_code: null,
    production_route: null,
    ...overrides,
  } as RegulatoryRecord;
}

/**
 * S3 (importer experience), v2.1.1 "default reference display" (§9).
 * Display-only: no arithmetic comparator, never a second calculation
 * engine -- this function only decides WHETHER the resolver's own
 * direct/indirect/total triple is internally consistent enough with
 * the sector's own treatment rule to show at all, and returns exactly
 * those three RegulatoryValues verbatim when it is.
 */
describe(
  "describeDefaultReference",
  () => {
    it(
      "non-proxy sector: AVAILABLE when direct, indirect, and total are all AVAILABLE",
      () => {
        const result =
          describeDefaultReference(
            record(),
            "CEMENT",
          );

        expect(result).toEqual(
          {
            status: "AVAILABLE",
            direct: value(),
            indirect: value({ value: "0.400", raw_source_value: "0.400" }),
            total: value({ value: "2.250", raw_source_value: "2.250" }),
          },
        );
      },
    );

    it(
      "non-proxy sector: UNAVAILABLE when any one of direct/indirect/total is not AVAILABLE",
      () => {
        expect(
          describeDefaultReference(
            record({ direct_emissions: value({ status: "UNAVAILABLE", value: null }) }),
            "CEMENT",
          ),
        ).toEqual(
          { status: "UNAVAILABLE" },
        );

        expect(
          describeDefaultReference(
            record({ indirect_emissions: value({ status: "REFERENCE_REQUIRED", value: null }) }),
            "CEMENT",
          ),
        ).toEqual(
          { status: "UNAVAILABLE" },
        );

        expect(
          describeDefaultReference(
            record({ total_emissions: value({ status: "NOT_APPLICABLE", value: null }) }),
            "CEMENT",
          ),
        ).toEqual(
          { status: "UNAVAILABLE" },
        );
      },
    );

    it(
      "Annex-II proxy sector (IRON_STEEL/ALUMINIUM): AVAILABLE when total equals direct and indirect is UNAVAILABLE or NOT_APPLICABLE",
      () => {
        const directOnlyRecord =
          record(
            {
              direct_emissions: value({ value: "1.500", raw_source_value: "1.500" }),
              total_emissions: value({ value: "1.500", raw_source_value: "1.500" }),
              indirect_emissions: value({ status: "NOT_APPLICABLE", value: null, raw_source_value: null }),
            },
          );

        expect(
          describeDefaultReference(
            directOnlyRecord,
            "IRON_STEEL",
          ),
        ).toEqual(
          {
            status: "AVAILABLE",
            direct: directOnlyRecord.direct_emissions,
            indirect: directOnlyRecord.indirect_emissions,
            total: directOnlyRecord.total_emissions,
          },
        );

        expect(
          describeDefaultReference(
            record(
              {
                direct_emissions: value({ value: "1.500", raw_source_value: "1.500" }),
                total_emissions: value({ value: "1.500", raw_source_value: "1.500" }),
                indirect_emissions: value({ status: "UNAVAILABLE", value: null, raw_source_value: null }),
              },
            ),
            "ALUMINIUM",
          ),
        ).toMatchObject(
          { status: "AVAILABLE" },
        );
      },
    );

    it(
      "Annex-II proxy sector: UNAVAILABLE when total does not equal direct (treatment inconsistency)",
      () => {
        expect(
          describeDefaultReference(
            record(
              {
                direct_emissions: value({ value: "1.500" }),
                total_emissions: value({ value: "1.900" }),
                indirect_emissions: value({ status: "NOT_APPLICABLE", value: null }),
              },
            ),
            "IRON_STEEL",
          ),
        ).toEqual(
          { status: "UNAVAILABLE" },
        );
      },
    );

    it(
      "Annex-II proxy sector: UNAVAILABLE when indirect is itself AVAILABLE (contradicts direct-only treatment)",
      () => {
        expect(
          describeDefaultReference(
            record(
              {
                direct_emissions: value({ value: "1.500" }),
                total_emissions: value({ value: "1.500" }),
                indirect_emissions: value({ value: "0.300" }),
              },
            ),
            "ALUMINIUM",
          ),
        ).toEqual(
          { status: "UNAVAILABLE" },
        );
      },
    );

    it(
      "Annex-II proxy sector: UNAVAILABLE when direct or total is itself not AVAILABLE",
      () => {
        expect(
          describeDefaultReference(
            record(
              {
                direct_emissions: value({ status: "UNAVAILABLE", value: null }),
                total_emissions: value({ status: "UNAVAILABLE", value: null }),
                indirect_emissions: value({ status: "NOT_APPLICABLE", value: null }),
              },
            ),
            "IRON_STEEL",
          ),
        ).toEqual(
          { status: "UNAVAILABLE" },
        );
      },
    );

    it(
      "never mutates the input record",
      () => {
        const input =
          record();

        const snapshot =
          JSON.parse(
            JSON.stringify(
              input,
            ),
          );

        describeDefaultReference(
          input,
          "CEMENT",
        );

        expect(input).toEqual(
          snapshot,
        );
      },
    );
  },
);
