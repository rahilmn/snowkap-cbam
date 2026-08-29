import {
  describe,
  expect,
  it,
} from "vitest";

import {
  checkCalculationCurrency,
} from "./check-calculation-currency";

import type {
  EmissionDetermination,
  RegulatoryResolutionSnapshot,
} from "./types";

const baseResolution: RegulatoryResolutionSnapshot =
  {
    dataset_id: "ds-1",
    dataset_version: "2026.1",
    resolved_at: "2026-01-01T00:00:00Z" as never,
    reason: "EXACT_TARIC_MATCH",
    country_mapping: { status: "MAPPED", regulatory_country_name: "Germany" },
    record_identity: {
      source_sheet: "Sheet1",
      source_row: 12,
      source_trade_code: "72081000",
      origin_country_name: "Germany",
      source_production_route_code: null,
    },
    values: {
      direct: { status: "AVAILABLE", value: "1.5", raw_source_value: "1.5" },
      indirect: { status: "AVAILABLE", value: "0.5", raw_source_value: "0.5" },
      total: { status: "AVAILABLE", value: "2.0", raw_source_value: "2.0" },
    },
    emission_unit: "tCO2e/t",
    trace: [],
  };

const defaultDetermination: EmissionDetermination =
  {
    method: "DEFAULT",
    resolution: baseResolution,
  };

const differentDefaultDetermination: EmissionDetermination =
  {
    method: "DEFAULT",
    resolution: {
      ...baseResolution,
      dataset_version: "2026.2",
      reason: "OTHER_COUNTRIES_FALLBACK",
    },
  };

describe(
  "checkCalculationCurrency",
  () => {
    it(
      "reports CURRENT when the calculation's frozen determination structurally equals the line's current one",
      () => {
        expect(
          checkCalculationCurrency(
            defaultDetermination,
            { method: "DEFAULT", resolution: { ...baseResolution } },
          ),
        ).toBe(
          "CURRENT",
        );
      },
    );

    it(
      "reports CURRENT when the two are the same object with keys in a different insertion order -- Postgres jsonb storage does not preserve key order, so a naive string comparison would false-alarm here",
      () => {
        const reordered: EmissionDetermination =
          {
            method: "DEFAULT",
            resolution: {
              emission_unit: baseResolution.emission_unit,
              trace: baseResolution.trace,
              dataset_id: baseResolution.dataset_id,
              dataset_version: baseResolution.dataset_version,
              resolved_at: baseResolution.resolved_at,
              reason: baseResolution.reason,
              country_mapping: baseResolution.country_mapping,
              record_identity: baseResolution.record_identity,
              values: baseResolution.values,
            },
          };

        expect(
          checkCalculationCurrency(
            defaultDetermination,
            reordered,
          ),
        ).toBe(
          "CURRENT",
        );
      },
    );

    it(
      "reports STALE when the line was redetermined to a genuinely different determination without a follow-up recalculation (P13 adversarial audit, Path A)",
      () => {
        expect(
          checkCalculationCurrency(
            defaultDetermination,
            differentDefaultDetermination,
          ),
        ).toBe(
          "STALE",
        );
      },
    );

    it(
      "reports STALE when the line's determination was cleared to null while the stale calculation survives (P13 adversarial audit, Path B: a quantity/cn_code edit)",
      () => {
        expect(
          checkCalculationCurrency(
            defaultDetermination,
            null,
          ),
        ).toBe(
          "STALE",
        );
      },
    );
  },
);
