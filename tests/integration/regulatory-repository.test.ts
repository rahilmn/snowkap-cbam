import {
  describe,
  expect,
  it,
} from "vitest";

import {
  SupabaseRegulatoryRepository,
} from "../../src/infrastructure/regulatory/supabase-regulatory-repository";

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
  "SupabaseRegulatoryRepository",
  () => {
    it(
      "loads active regulatory candidates",
      async () => {
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

        // A stored result must be able to record which dataset VERSION
        // produced it without a second query (SOURCE_REGISTER.md rule 6).
        expect(
          records.every(
            (record) =>
              record.dataset_version ===
              "2026-definitive-corrected",
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
