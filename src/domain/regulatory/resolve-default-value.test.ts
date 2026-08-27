import {
  describe,
  expect,
  it,
} from "vitest";

import {
  resolveDefaultValue,
} from "./resolve-default-value.js";

import type {
  RegulatoryRecord,
} from "./types.js";

function record(
  overrides: Partial<RegulatoryRecord> = {},
): RegulatoryRecord {
  return {
    dataset_id:
      "cbam-default-values-2026-definitive-corrected",

    origin_country_name:
      "India",

    source_sheet:
      "India",

    source_row:
      1,

    source_trade_code:
      "7206 10 00",

    normalized_trade_code:
      "72061000",

    code_level:
      "CN8",

    sector:
      "IRON_STEEL",

    product_name:
      "Test product",

    emission_unit:
      "TCO2E_PER_TONNE",

    direct_emissions: {
      value: "2.640",
      status: "AVAILABLE",
      raw_source_value: "2,640",
    },

    indirect_emissions: {
      value: null,
      status: "UNAVAILABLE",
      raw_source_value: null,
    },

    total_emissions: {
      value: "2.640",
      status: "AVAILABLE",
      raw_source_value: "2,640",
    },

    source_production_route_code:
      "(C)",

    production_route:
      "CARBON_STEEL_BF_BOF",

    ...overrides,
  };
}

describe(
  "resolveDefaultValue",
  () => {
    it(
      "resolves an exact CN8 record",
      () => {
        const result =
          resolveDefaultValue(
            [
              record(),
            ],
            {
              origin_country_name:
                "India",

              trade_code:
                "72061000",

              production_route:
                "(C)",
            },
          );

        expect(
          result.status,
        ).toBe(
          "RESOLVED",
        );

        expect(
          result.reason,
        ).toBe(
          "EXACT_CN8_MATCH",
        );

        expect(
          result.record
            ?.normalized_trade_code,
        ).toBe(
          "72061000",
        );
      },
    );

    it(
      "normalizes spaces in the input code",
      () => {
        const result =
          resolveDefaultValue(
            [
              record(),
            ],
            {
              origin_country_name:
                "India",

              trade_code:
                "7206 10 00",

              production_route:
                "(C)",
            },
          );

        expect(
          result.status,
        ).toBe(
          "RESOLVED",
        );

        expect(
          result.record
            ?.normalized_trade_code,
        ).toBe(
          "72061000",
        );
      },
    );

    it(
      "resolves an exact TARIC record",
      () => {
        const result =
          resolveDefaultValue(
            [
              record({
                source_trade_code:
                  "2507008080",

                normalized_trade_code:
                  "2507008080",

                code_level:
                  "TARIC10",

                source_production_route_code:
                  null,

                production_route:
                  null,
              }),
            ],
            {
              origin_country_name:
                "India",

              trade_code:
                "2507008080",
            },
          );

        expect(
          result.status,
        ).toBe(
          "RESOLVED",
        );

        expect(
          result.reason,
        ).toBe(
          "EXACT_TARIC_MATCH",
        );
      },
    );

    it(
      "prefers a route-specific exact record",
      () => {
        const routeIndependent =
          record({
            source_production_route_code:
              null,

            production_route:
              null,
          });

        const routeSpecific =
          record({
            source_production_route_code:
              "(C)",

            production_route:
              "CARBON_STEEL_BF_BOF",
          });

        const result =
          resolveDefaultValue(
            [
              routeIndependent,
              routeSpecific,
            ],
            {
              origin_country_name:
                "India",

              trade_code:
                "72061000",

              production_route:
                "(C)",
            },
          );

        expect(
          result.status,
        ).toBe(
          "RESOLVED",
        );

        expect(
          result.record
            ?.source_production_route_code,
        ).toBe(
          "(C)",
        );
      },
    );

    it(
      "uses a route-independent exact record",
      () => {
        const result =
          resolveDefaultValue(
            [
              record({
                source_production_route_code:
                  null,

                production_route:
                  null,
              }),
            ],
            {
              origin_country_name:
                "India",

              trade_code:
                "72061000",

              production_route:
                "(C)",
            },
          );

        expect(
          result.status,
        ).toBe(
          "RESOLVED",
        );

        expect(
          result.record
            ?.source_production_route_code,
        ).toBeNull();
      },
    );

    it(
      "uses Other Countries and Territories when the exact country value is unavailable",
      () => {
        const country =
          record({
            origin_country_name:
              "India",

            total_emissions: {
              value: null,

              status:
                "UNAVAILABLE",

              raw_source_value:
                "-",
            },

            source_production_route_code:
              null,

            production_route:
              null,
          });

        const fallback =
          record({
            origin_country_name:
              "_Other Countries and Territorie",

            source_sheet:
              "_Other Countries and Territorie",

            total_emissions: {
              value:
                "3.100",

              status:
                "AVAILABLE",

              raw_source_value:
                "3,100",
            },

            source_production_route_code:
              null,

            production_route:
              null,
          });

        const result =
          resolveDefaultValue(
            [
              country,
              fallback,
            ],
            {
              origin_country_name:
                "India",

              trade_code:
                "72061000",
            },
          );

        expect(
          result.status,
        ).toBe(
          "RESOLVED",
        );

        expect(
          result.reason,
        ).toBe(
          "OTHER_COUNTRIES_FALLBACK",
        );

        expect(
          result.record
            ?.origin_country_name,
        ).toBe(
          "_Other Countries and Territorie",
        );

        expect(
          result.record
            ?.total_emissions.value,
        ).toBe(
          "3.100",
        );
      },
    );

    it(
      "uses fallback when the country has no exact record",
      () => {
        const fallback =
          record({
            origin_country_name:
              "_Other Countries and Territorie",

            source_sheet:
              "_Other Countries and Territorie",

            source_production_route_code:
              null,

            production_route:
              null,

            total_emissions: {
              value:
                "3.100",

              status:
                "AVAILABLE",

              raw_source_value:
                "3,100",
            },
          });

        const result =
          resolveDefaultValue(
            [
              fallback,
            ],
            {
              origin_country_name:
                "Unknown country",

              trade_code:
                "72061000",
            },
          );

        expect(
          result.status,
        ).toBe(
          "RESOLVED",
        );

        expect(
          result.reason,
        ).toBe(
          "OTHER_COUNTRIES_FALLBACK",
        );
      },
    );

    it(
      "does not fallback from REFERENCE_REQUIRED",
      () => {
        const reference =
          record({
            source_trade_code:
              "3102",

            normalized_trade_code:
              "3102",

            code_level:
              "HS4",

            total_emissions: {
              value:
                null,

              status:
                "REFERENCE_REQUIRED",

              raw_source_value:
                "see below",
            },
          });

        const fallback =
          record({
            origin_country_name:
              "_Other Countries and Territorie",

            source_sheet:
              "_Other Countries and Territorie",

            source_trade_code:
              "3102",

            normalized_trade_code:
              "3102",

            code_level:
              "HS4",

            source_production_route_code:
              null,

            production_route:
              null,

            total_emissions: {
              value:
                "1.000",

              status:
                "AVAILABLE",

              raw_source_value:
                "1,000",
            },
          });

        const result =
          resolveDefaultValue(
            [
              reference,
              fallback,
            ],
            {
              origin_country_name:
                "India",

              trade_code:
                "3102",
            },
          );

        expect(
          result.status,
        ).toBe(
          "UNRESOLVED",
        );

        expect(
          result.reason,
        ).toBe(
          "REFERENCE_REQUIRED",
        );
      },
    );

    it(
      "returns UNAVAILABLE when no usable fallback exists",
      () => {
        const result =
          resolveDefaultValue(
            [
              record({
                total_emissions: {
                  value:
                    null,

                  status:
                    "UNAVAILABLE",

                  raw_source_value:
                    "-",
                },

                source_production_route_code:
                  null,

                production_route:
                  null,
              }),
            ],
            {
              origin_country_name:
                "India",

              trade_code:
                "72061000",
            },
          );

        expect(
          result.status,
        ).toBe(
          "UNRESOLVED",
        );

        expect(
          result.reason,
        ).toBe(
          "UNAVAILABLE",
        );

        expect(
          result.record,
        ).toBeNull();
      },
    );

    it(
      "does not silently use another route",
      () => {
        const result =
          resolveDefaultValue(
            [
              record({
                source_production_route_code:
                  "(C)",
              }),
            ],
            {
              origin_country_name:
                "India",

              trade_code:
                "72061000",

              production_route:
                "(F)",
            },
          );

        expect(
          result.status,
        ).toBe(
          "UNRESOLVED",
        );
      },
    );

    it(
      "returns NOT_APPLICABLE explicitly",
      () => {
        const result =
          resolveDefaultValue(
            [
              record({
                total_emissions: {
                  value:
                    null,

                  status:
                    "NOT_APPLICABLE",

                  raw_source_value:
                    "N/A",
                },

                source_production_route_code:
                  null,

                production_route:
                  null,
              }),
            ],
            {
              origin_country_name:
                "India",

              trade_code:
                "72061000",
            },
          );

        expect(
          result.status,
        ).toBe(
          "UNRESOLVED",
        );

        expect(
          result.reason,
        ).toBe(
          "NOT_APPLICABLE",
        );
      },
    );

    it(
      "returns AMBIGUOUS for multiple usable exact records",
      () => {
        const first =
          record({
            source_row:
              1,

            source_production_route_code:
              "(C)",
          });

        const second =
          record({
            source_row:
              2,

            source_production_route_code:
              "(F)",
          });

        const result =
          resolveDefaultValue(
            [
              first,
              second,
            ],
            {
              origin_country_name:
                "India",

              trade_code:
                "72061000",
            },
          );

        expect(
          result.status,
        ).toBe(
          "UNRESOLVED",
        );

        expect(
          result.reason,
        ).toBe(
          "AMBIGUOUS",
        );

        expect(
          result.record,
        ).toBeNull();
      },
    );

    it(
      "records the fallback in the resolution trace",
      () => {
        const country =
          record({
            total_emissions: {
              value:
                null,

              status:
                "UNAVAILABLE",

              raw_source_value:
                "-",
            },

            source_production_route_code:
              null,

            production_route:
              null,
          });

        const fallback =
          record({
            origin_country_name:
              "_Other Countries and Territorie",

            source_sheet:
              "_Other Countries and Territorie",

            source_production_route_code:
              null,

            production_route:
              null,

            total_emissions: {
              value:
                "3.100",

              status:
                "AVAILABLE",

              raw_source_value:
                "3,100",
            },
          });

        const result =
          resolveDefaultValue(
            [
              country,
              fallback,
            ],
            {
              origin_country_name:
                "India",

              trade_code:
                "72061000",
            },
          );

        expect(
          result.status,
        ).toBe(
          "RESOLVED",
        );

        expect(
          result.reason,
        ).toBe(
          "OTHER_COUNTRIES_FALLBACK",
        );

        expect(
          result.trace.some(
            (step) =>
              step.step ===
              "COUNTRY_FALLBACK_TRIGGER",
          ),
        ).toBe(true);

        expect(
          result.trace.some(
            (step) =>
              step.step ===
              "FALLBACK_COUNTRY_MATCH",
          ),
        ).toBe(true);

        expect(
          result.trace.some(
            (step) =>
              step.step ===
              "FALLBACK_SELECTION",
          ),
        ).toBe(true);
      },
    );
  },
);
