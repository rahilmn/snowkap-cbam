import {
  describe,
  expect,
  it,
} from "vitest";

import {
  SupabaseRegulatoryRepository,
} from "../../src/infrastructure/regulatory/supabase-regulatory-repository.js";

import {
  resolveActiveDefaultValue,
} from "../../src/application/regulatory/resolve-active-default-value.js";

const hasSupabaseEnvironment =
  Boolean(
    process.env.SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

describe(
  "resolveActiveDefaultValue",
  () => {
    it(
      "resolves an active real regulatory record",
      async () => {
        if (!hasSupabaseEnvironment) {
          console.warn(
            "Skipping Supabase integration test: " +
              "SUPABASE_URL or " +
              "SUPABASE_SERVICE_ROLE_KEY is not configured.",
          );

          return;
        }

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
        if (!hasSupabaseEnvironment) {
          console.warn(
            "Skipping Supabase integration test: " +
              "SUPABASE_URL or " +
              "SUPABASE_SERVICE_ROLE_KEY is not configured.",
          );

          return;
        }

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

        expect(
          result.record?.total_emissions.value,
        ).toBe(
          "0.28",
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
        if (!hasSupabaseEnvironment) {
          console.warn(
            "Skipping Supabase integration test: " +
              "SUPABASE_URL or " +
              "SUPABASE_SERVICE_ROLE_KEY is not configured.",
          );

          return;
        }

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
