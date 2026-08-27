import {
  describe,
  expect,
  it,
} from "vitest";

import {
  SupabaseRegulatoryRepository,
} from "../../src/infrastructure/regulatory/supabase-regulatory-repository.js";

const hasSupabaseEnvironment =
  Boolean(
    process.env.SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

describe(
  "SupabaseRegulatoryRepository",
  () => {
    it(
      "loads active regulatory candidates",
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

        const records =
          await repository.findActiveDefaultEmissionCandidates(
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
          records.length,
        ).toBeGreaterThan(0);

        expect(
          records.every(
            (record) =>
              record.dataset_id.length > 0,
          ),
        ).toBe(true);

        expect(
          records.every(
            (record) =>
              record.normalized_trade_code ===
              "7219",
          ),
        ).toBe(true);

        expect(
          records.some(
            (record) =>
              record.code_level ===
                "HS4" &&
              record.total_emissions.status ===
                "REFERENCE_REQUIRED",
          ),
        ).toBe(true);
      },
    );
  },
);
