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

    origin_country_name: "India",

    source_sheet: "India",
    source_row: 1,

    source_trade_code:
      "7206 10 00",

    normalized_trade_code:
      "72061000",

    code_level: "CN8",

    sector: "IRON_STEEL",

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
        ).toBe("RESOLVED");

        expect(
          result.reason,
        ).toBe(
          "EXACT_CN8_MATCH",
        );

        expect(
          result.record
            ?.normalized_trade_code,
        ).toBe("72061000");
      },
    );

    it(
      "normalizes spaces in the input trade code",
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
            },
          );

        expect(
          result.status,
        ).toBe("RESOLVED");

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
        ).toBe("RESOLVED");

        expect(
          result.reason,
        ).toBe(
          "EXACT_TARIC_MATCH",
        );
      },
    );

    it(
      "selects a route-specific exact record",
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
        ).toBe("RESOLVED");

        expect(
          result.record
            ?.source_production_route_code,
        ).toBe("(C)");
      },
    );

    it(
      "selects a route-independent exact record",
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
        ).toBe("RESOLVED");

        expect(
          result.record
            ?.source_production_route_code,
        ).toBeNull();
      },
    );

    it(
      "returns UNAVAILABLE rather than zero",
      () => {
        const unavailable =
          record({
            normalized_trade_code:
              "2507008080",

            source_production_route_code:
              null,

            production_route:
              null,

            total_emissions: {
              value: null,

              status:
                "UNAVAILABLE",

              raw_source_value:
                "-",
            },
          });

        const result =
          resolveDefaultValue(
            [
              unavailable,
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
      "returns REFERENCE_REQUIRED for a reference row",
      () => {
        const reference =
          record({
            normalized_trade_code:
              "3102",

            code_level:
              "HS4",

            total_emissions: {
              value: null,

              status:
                "REFERENCE_REQUIRED",

              raw_source_value:
                "see below",
            },
          });

        const result =
          resolveDefaultValue(
            [
              reference,
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
      "returns unresolved for an unknown country",
      () => {
        const result =
          resolveDefaultValue(
            [
              record(),
            ],
            {
              origin_country_name:
                "Germany",

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
          "NO_MATCH",
        );

        expect(
          result.record,
        ).toBeNull();
      },
    );

    it(
      "returns unresolved for an unknown code",
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
                "99999999",
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
          "NO_MATCH",
        );
      },
    );

    it(
      "does not silently choose between multiple usable exact records",
      () => {
        const first =
          record({
            source_row: 1,
          });

        const second =
          record({
            source_row: 2,
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

        expect(
          result.trace.some(
            (step) =>
              step.step ===
              "AMBIGUOUS_EXACT_MATCH",
          ),
        ).toBe(true);
      },
    );

    it(
      "records a resolution trace",
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
            },
          );

        expect(
          result.trace.length,
        ).toBeGreaterThan(0);

        expect(
          result.trace.some(
            (step) =>
              step.step ===
              "NORMALIZE_CODE",
          ),
        ).toBe(true);

        expect(
          result.trace.some(
            (step) =>
              step.step ===
              "COUNTRY_MATCH",
          ),
        ).toBe(true);

        expect(
          result.trace.some(
            (step) =>
              step.step ===
              "EXACT_CODE_MATCH",
          ),
        ).toBe(true);
      },
    );
  },
);