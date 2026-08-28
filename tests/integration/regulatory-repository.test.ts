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

// P4 classification queries (§20) -- same credentialed-only guard as
// above; these read the same protected, real dataset.
describe.skipIf(!hasSupabaseEnvironment)(
  "SupabaseRegulatoryRepository classification queries",
  () => {
    it(
      "finds an exact CBAM good by its declared trade code",
      async () => {
        const repository =
          new SupabaseRegulatoryRepository();

        const goods =
          await repository.findCbamGoodsByCode(
            "25232100",
          );

        expect(goods).toHaveLength(
          1,
        );

        expect(goods[0]).toMatchObject(
          {
            trade_code: "25232100",
            trade_code_type: "CN",
            record_level: "TRADE_GOOD",
            sector: "CEMENT",
            functional_unit: "TONNES",
          },
        );
      },
    );

    it(
      "returns an empty array for a well-formed but non-existent code",
      async () => {
        const repository =
          new SupabaseRegulatoryRepository();

        const goods =
          await repository.findCbamGoodsByCode(
            "99999999",
          );

        expect(goods).toEqual(
          [],
        );
      },
    );

    it(
      "searches CBAM goods by trade-code prefix, TRADE_GOOD level only",
      async () => {
        const repository =
          new SupabaseRegulatoryRepository();

        const goods =
          await repository.searchCbamGoodsByPrefix(
            "2523",
          );

        expect(
          goods.length,
        ).toBeGreaterThan(
          0,
        );

        expect(
          goods.every(
            (good) =>
              good.trade_code.startsWith(
                "2523",
              ) &&
              good.record_level ===
                "TRADE_GOOD",
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "finds production routes, optionally narrowed by sector",
      async () => {
        const repository =
          new SupabaseRegulatoryRepository();

        const cementRoutes =
          await repository.findProductionRoutes(
            "CEMENT",
          );

        expect(
          cementRoutes.length,
        ).toBeGreaterThan(
          0,
        );

        expect(
          cementRoutes.every(
            (route) =>
              route.sector ===
              "CEMENT",
          ),
        ).toBe(
          true,
        );

        expect(
          cementRoutes.some(
            (route) =>
              route.name ===
                "GREY_CLINKER_CEMENT" &&
              route.source_route_indicator ===
                "(A)",
          ),
        ).toBe(
          true,
        );

        const allRoutes =
          await repository.findProductionRoutes();

        expect(
          allRoutes.length,
        ).toBeGreaterThanOrEqual(
          cementRoutes.length,
        );
      },
    );
  },
);
