import {
  describe,
  expect,
  it,
} from "vitest";

import {
  SupabaseRegulatoryRepository,
} from "../../src/infrastructure/regulatory/supabase-regulatory-repository";

import {
  resolveActiveDefaultValue,
} from "../../src/application/regulatory/resolve-active-default-value";

import {
  getSupabaseClient,
} from "../../src/infrastructure/supabase/client";

const hasSupabaseEnvironment =
  Boolean(
    process.env.SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

// Skipped (not silently run-and-passed) when Supabase credentials are not
// configured, e.g. a fresh clone or a CI job without secrets. See
// tests/integration/module-load.test.ts for the corresponding guarantee
// that importing the repository module itself never throws.
describe.skipIf(!hasSupabaseEnvironment)(
  "resolveActiveDefaultValue",
  () => {
    it(
      "resolves an active real regulatory record",
      async () => {
        const repository =
          new SupabaseRegulatoryRepository();

        const result =
          await resolveActiveDefaultValue(
            repository,
            {
              origin_country_name:
                "Viet Nam",
              trade_code:
                "7219",
              production_route:
                null,
            },
          );

        expect(
          result.status,
        ).toBe("UNRESOLVED");

        expect(
          result.reason,
        ).toBe(
          "REFERENCE_REQUIRED",
        );

        expect(
          result.record,
        ).toBeNull();

        expect(
          result.trace.length,
        ).toBeGreaterThan(0);
      },
    );

    it(
      "uses the real Other Countries and Territories fallback for Bahrain",
      async () => {
        const repository =
          new SupabaseRegulatoryRepository();

        const result =
          await resolveActiveDefaultValue(
            repository,
            {
              origin_country_name:
                "Bahrain",

              trade_code:
                "2507008080",

              production_route:
                null,
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
          result.record,
        ).not.toBeNull();

        expect(
          result.record?.origin_country_name,
        ).toBe(
          "_Other Countries and Territorie",
        );

        expect(
          result.record?.normalized_trade_code,
        ).toBe(
          "2507008080",
        );

        expect(
          result.record?.code_level,
        ).toBe(
          "TARIC10",
        );

        expect(
          result.record?.total_emissions.status,
        ).toBe(
          "AVAILABLE",
        );

        // The canonical source value for this record is "0.280" (3
        // decimal places -- see data/processed/default-emission-values-definitive.json).
        // Regression guard: the adapter must preserve that scale, not
        // silently truncate it to "0.28" via an unconstrained numeric
        // column round-tripping through PostgREST's JSON serialization
        // as a JS number. See the adapter's .select() -- direct_value/
        // indirect_value/total_value are cast to ::text specifically to
        // prevent this.
        expect(
          result.record?.total_emissions.value,
        ).toBe(
          "0.280",
        );

        expect(
          result.trace.some(
            (step) =>
              step.step ===
              "COUNTRY_FALLBACK",
          ),
        ).toBe(true);
      },
    );

    it(
      "uses the real Other Countries and Territories fallback for an unlisted country (Kiribati)",
      async () => {
        // Kiribati has no row in the countries table at all (verified via
        // a read-only query against the live dataset) -- this is the R7
        // clause-1 case: "If the country or territory is not explicitly
        // listed, use the value from: Other countries and territories."
        // See docs/architecture/REGULATORY_RESOLUTION_RULES.md Rule R7
        // and docs/adr/ADR-0005-protected-regulatory-subsystem.md.
        //
        // This test's premise -- that "Kiribati" is genuinely unlisted --
        // is asserted directly rather than assumed, so a future reseed of
        // the `countries` table (e.g. broadening it to a full ISO country
        // list for product-layer dropdowns) makes this test fail loudly
        // instead of silently degrading into a duplicate of the
        // already-listed-country fallback case below.
        const supabase =
          getSupabaseClient();

        const {
          data: kiribatiRows,
          error: kiribatiLookupError,
        } = await supabase
          .from("countries")
          .select("id")
          .eq(
            "name",
            "Kiribati",
          );

        if (kiribatiLookupError) {
          throw kiribatiLookupError;
        }

        expect(
          kiribatiRows,
        ).toHaveLength(
          0,
        );

        const repository =
          new SupabaseRegulatoryRepository();

        const result =
          await resolveActiveDefaultValue(
            repository,
            {
              origin_country_name:
                "Kiribati",

              trade_code:
                "2507008080",

              production_route:
                null,
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
          result.record,
        ).not.toBeNull();

        expect(
          result.record?.origin_country_name,
        ).toBe(
          "_Other Countries and Territorie",
        );

        expect(
          result.record?.normalized_trade_code,
        ).toBe(
          "2507008080",
        );

        expect(
          result.record?.total_emissions.status,
        ).toBe(
          "AVAILABLE",
        );

        // The canonical source value for this record is "0.280" (3
        // decimal places -- see data/processed/default-emission-values-definitive.json).
        // Regression guard: the adapter must preserve that scale, not
        // silently truncate it to "0.28" via an unconstrained numeric
        // column round-tripping through PostgREST's JSON serialization
        // as a JS number. See the adapter's .select() -- direct_value/
        // indirect_value/total_value are cast to ::text specifically to
        // prevent this.
        expect(
          result.record?.total_emissions.value,
        ).toBe(
          "0.280",
        );

        expect(
          result.trace.some(
            (step) =>
              step.step ===
              "COUNTRY_FALLBACK",
          ),
        ).toBe(true);
      },
    );

    it(
      "preserves REFERENCE_REQUIRED for a real fallback record",
      async () => {
        const repository =
          new SupabaseRegulatoryRepository();

        const result =
          await resolveActiveDefaultValue(
            repository,
            {
              origin_country_name:
                "Bahrain",

              trade_code:
                "3102",

              production_route:
                null,
            },
          );

        expect(
          result.status,
        ).toBe("UNRESOLVED");

        expect(
          result.reason,
        ).toBe(
          "REFERENCE_REQUIRED",
        );

        expect(
          result.record,
        ).toBeNull();

        expect(
          result.trace.some(
            (step) =>
              step.step ===
              "COUNTRY_FALLBACK",
          ),
        ).toBe(true);
      },
    );
  },
);
