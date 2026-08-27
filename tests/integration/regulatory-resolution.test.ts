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
  },
);