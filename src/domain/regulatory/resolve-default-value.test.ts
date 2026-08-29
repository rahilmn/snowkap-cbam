import {
  describe,
  expect,
  it,
} from "vitest";

import {
  resolveDefaultValue,
} from "./resolve-default-value";

import type {
  RegulatoryRecord,
} from "./types";

function record(
  overrides: Partial<RegulatoryRecord> = {},
): RegulatoryRecord {
  return {
    dataset_id:
      "cbam-default-values-2026-definitive-corrected",

    dataset_version:
      "2026-definitive-corrected",

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

        it(
      "falls back to Other Countries and Territories when the requested country has no exact record",
      () => {
        const fallback = record({
          origin_country_name:
            "_Other Countries and Territorie",

          source_sheet:
            "_Other Countries and Territorie",

          source_trade_code:
            "7219",

          normalized_trade_code:
            "7219",

          code_level:
            "HS4",

          source_production_route_code:
            null,

          production_route:
            null,

          total_emissions: {
            value:
              "3.000",

            status:
              "AVAILABLE",

            raw_source_value:
              "3.000",
          },
        });

        const result =
          resolveDefaultValue(
            [
              fallback,
            ],
            {
              origin_country_name:
                "Albania",

              trade_code:
                "7219",
            },
          );

        expect(
          result.status,
        ).toBe("RESOLVED");

        expect(
          result.reason,
        ).toBe(
          "OTHER_COUNTRIES_FALLBACK",
        );

        expect(
          result.record?.origin_country_name,
        ).toBe(
          "_Other Countries and Territorie",
        );

        expect(
          result.record?.normalized_trade_code,
        ).toBe("7219");

        expect(
          result.record?.total_emissions.value,
        ).toBe("3.000");

        expect(
          result.trace.some(
            (step) =>
              step.step ===
                "COUNTRY_FALLBACK" &&
              step.outcome.includes(
                "_Other Countries and Territorie",
              ),
          ),
        ).toBe(true);
      },
    );


    it(
      "falls back to Other Countries and Territories for a country the resolver has never heard of (R7 clause 1)",
      () => {
        // This test documents that the DOMAIN resolver already implements
        // Rule R7 clause 1 correctly ("If the country or territory is not
        // explicitly listed, use the value from: Other countries and
        // territories") for an origin country with NO regulatory identity
        // at all -- not even a "known but absent" one. The resolver never
        // looks up or validates origin_country_name against any list; it
        // only reasons about the candidate records it's handed. The
        // corresponding integration test
        // (tests/integration/regulatory-resolution.test.ts, "uses the real
        // Other Countries and Territories fallback for an unlisted country
        // (Kiribati)") proves the *adapter* previously defeated this by
        // returning zero candidates before ever reaching this logic -- see
        // docs/adr/ADR-0005-protected-regulatory-subsystem.md and Rule R7
        // in docs/architecture/REGULATORY_RESOLUTION_RULES.md.
        const fallback = record({
          origin_country_name:
            "_Other Countries and Territorie",

          source_sheet:
            "_Other Countries and Territorie",

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

          total_emissions: {
            value:
              "0.28",

            status:
              "AVAILABLE",

            raw_source_value:
              "0.28",
          },
        });

        const result =
          resolveDefaultValue(
            [
              fallback,
            ],
            {
              origin_country_name:
                "Kiribati",

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
          "OTHER_COUNTRIES_FALLBACK",
        );

        expect(
          result.record?.origin_country_name,
        ).toBe(
          "_Other Countries and Territorie",
        );

        expect(
          result.record?.total_emissions.value,
        ).toBe("0.28");
      },
    );

    it(
      "prefers the requested country over Other Countries and Territories",
      () => {
        const requestedCountry = record({
          origin_country_name:
            "Albania",

          source_sheet:
            "Albania",

          source_trade_code:
            "7219",

          normalized_trade_code:
            "7219",

          code_level:
            "HS4",

          source_row:
            10,

          source_production_route_code:
            null,

          production_route:
            null,

          total_emissions: {
            value:
              "4.000",

            status:
              "AVAILABLE",

            raw_source_value:
              "4.000",
          },
        });

        const fallback = record({
          origin_country_name:
            "_Other Countries and Territorie",

          source_sheet:
            "_Other Countries and Territorie",

          source_trade_code:
            "7219",

          normalized_trade_code:
            "7219",

          code_level:
            "HS4",

          source_row:
            11,

          source_production_route_code:
            null,

          production_route:
            null,

          total_emissions: {
            value:
              "3.000",

            status:
              "AVAILABLE",

            raw_source_value:
              "3.000",
          },
        });

        const result =
          resolveDefaultValue(
            [
              fallback,
              requestedCountry,
            ],
            {
              origin_country_name:
                "Albania",

              trade_code:
                "7219",
            },
          );

        expect(
          result.status,
        ).toBe("RESOLVED");

        expect(
          result.reason,
        ).toBe(
          "EXACT_HS4_MATCH",
        );

        expect(
          result.record?.origin_country_name,
        ).toBe(
          "Albania",
        );

        expect(
          result.record?.total_emissions.value,
        ).toBe("4.000");
      },
    );


    it(
      "returns REFERENCE_REQUIRED when the fallback record requires a reference",
      () => {
        const fallback = record({
          origin_country_name:
            "_Other Countries and Territorie",

          source_sheet:
            "_Other Countries and Territorie",

          source_trade_code:
            "7219",

          normalized_trade_code:
            "7219",

          code_level:
            "HS4",

          source_production_route_code:
            null,

          production_route:
            null,

          total_emissions: {
            value:
              null,

            status:
              "REFERENCE_REQUIRED",

            raw_source_value:
              "see below",
          },
        });

        const result =
          resolveDefaultValue(
            [
              fallback,
            ],
            {
              origin_country_name:
                "Albania",

              trade_code:
                "7219",
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

        expect(
          result.record,
        ).toBeNull();
      },
    );


    it(
      "returns UNAVAILABLE when the fallback record is unavailable",
      () => {
        const fallback = record({
          origin_country_name:
            "_Other Countries and Territorie",

          source_sheet:
            "_Other Countries and Territorie",

          source_trade_code:
            "7219",

          normalized_trade_code:
            "7219",

          code_level:
            "HS4",

          source_production_route_code:
            null,

          production_route:
            null,

          total_emissions: {
            value:
              null,

            status:
              "UNAVAILABLE",

            raw_source_value:
              "-",
          },
        });

        const result =
          resolveDefaultValue(
            [
              fallback,
            ],
            {
              origin_country_name:
                "Albania",

              trade_code:
                "7219",
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
      "returns AMBIGUOUS when multiple usable fallback records remain",
      () => {
        const first = record({
          origin_country_name:
            "_Other Countries and Territorie",

          source_sheet:
            "_Other Countries and Territorie",

          source_trade_code:
            "7219",

          normalized_trade_code:
            "7219",

          code_level:
            "HS4",

          source_row:
            20,

          source_production_route_code:
            null,

          production_route:
            null,

          total_emissions: {
            value:
              "3.000",

            status:
              "AVAILABLE",

            raw_source_value:
              "3.000",
          },
        });

        const second = record({
          origin_country_name:
            "_Other Countries and Territorie",

          source_sheet:
            "_Other Countries and Territorie",

          source_trade_code:
            "7219",

          normalized_trade_code:
            "7219",

          code_level:
            "HS4",

          source_row:
            21,

          source_production_route_code:
            null,

          production_route:
            null,

          total_emissions: {
            value:
              "4.000",

            status:
              "AVAILABLE",

            raw_source_value:
              "4.000",
          },
        });

        const result =
          resolveDefaultValue(
            [
              first,
              second,
            ],
            {
              origin_country_name:
                "Albania",

              trade_code:
                "7219",
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
      "does not use a different fallback production route when one is explicitly requested",
      () => {
        const fallbackDifferentRoute =
          record({
            origin_country_name:
              "_Other Countries and Territorie",

            source_sheet:
              "_Other Countries and Territorie",

            source_trade_code:
              "7219",

            normalized_trade_code:
              "7219",

            code_level:
              "HS4",

            source_production_route_code:
              "(F)",

            production_route:
              "LOW_ALLOY_STEEL_BF_BOF",

            total_emissions: {
              value:
                "3.000",

              status:
                "AVAILABLE",

              raw_source_value:
                "3.000",
            },
          });

        const result =
          resolveDefaultValue(
            [
              fallbackDifferentRoute,
            ],
            {
              origin_country_name:
                "Albania",

              trade_code:
                "7219",

              production_route:
                "(C)",
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
      "does not substitute a different route's usable value when the requested route's own exact record exists but is unusable (P13 adversarial audit)",
      () => {
        const requestedRouteUnavailable =
          record({
            source_production_route_code:
              "(C)",

            production_route:
              "CARBON_STEEL_BF_BOF",

            total_emissions: {
              value: null,

              status:
                "UNAVAILABLE",

              raw_source_value:
                "-",
            },
          });

        const otherRouteUsable =
          record({
            source_production_route_code:
              "(F)",

            production_route:
              "LOW_ALLOY_STEEL_BF_BOF",

            total_emissions: {
              value:
                "3.000",

              status:
                "AVAILABLE",

              raw_source_value:
                "3.000",
            },
          });

        const result =
          resolveDefaultValue(
            [
              requestedRouteUnavailable,
              otherRouteUsable,
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
      "does not treat a fallback NOT_APPLICABLE value as zero",
      () => {
        const fallback = record({
          origin_country_name:
            "_Other Countries and Territorie",

          source_sheet:
            "_Other Countries and Territorie",

          source_trade_code:
            "7219",

          normalized_trade_code:
            "7219",

          code_level:
            "HS4",

          source_production_route_code:
            null,

          production_route:
            null,

          total_emissions: {
            value:
              null,

            status:
              "NOT_APPLICABLE",

            raw_source_value:
              "n/a",
          },
        });

        const result =
          resolveDefaultValue(
            [
              fallback,
            ],
            {
              origin_country_name:
                "Albania",

              trade_code:
                "7219",
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

        expect(
          result.record,
        ).toBeNull();
      },
    );

},

);
