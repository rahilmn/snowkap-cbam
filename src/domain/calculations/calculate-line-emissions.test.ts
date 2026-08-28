import {
  describe,
  expect,
  it,
} from "vitest";

import {
  calculateLineEmissions,
} from "./calculate-line-emissions";

import { ENGINE_VERSION } from "./types";

import type {
  EmissionDetermination,
  RegulatoryResolutionSnapshot,
} from "../emissions/types";

import type {
  RegulatoryValue,
} from "../regulatory/types";

function availableValue(
  value: string,
): RegulatoryValue {
  return {
    value,
    status: "AVAILABLE",
    raw_source_value: value,
  };
}

function snapshot(
  overrides: Partial<RegulatoryResolutionSnapshot["values"]> = {},
): RegulatoryResolutionSnapshot {
  return {
    dataset_id: "dataset-1",
    dataset_version: "2026-definitive-corrected",
    resolved_at: "2026-08-28T00:00:00.000Z" as RegulatoryResolutionSnapshot["resolved_at"],
    reason: "EXACT_CN8_MATCH",
    country_mapping: { status: "MAPPED", regulatory_country_name: "China" },
    record_identity: {
      source_sheet: "Cement",
      source_row: 42,
      source_trade_code: "25232100",
      origin_country_name: "China",
      source_production_route_code: null,
    },
    values: {
      direct: availableValue("1.250"),
      indirect: availableValue("0.140"),
      total: availableValue("1.390"),
      ...overrides,
    },
    emission_unit: "TCO2E_PER_TONNE",
    trace: [],
  };
}

function defaultDetermination(
  valuesOverrides: Partial<RegulatoryResolutionSnapshot["values"]> = {},
): EmissionDetermination {
  return {
    method: "DEFAULT",
    resolution: snapshot(valuesOverrides),
  };
}

describe(
  "calculateLineEmissions",
  () => {
    it(
      "computes embedded emissions for a mass good (quantity x resolved total)",
      () => {
        const result =
          calculateLineEmissions(
            {
              net_mass_tonnes: "10.5" as never,
              quantity_mwh: null,
              emission_determination: defaultDetermination(),
            },
          );

        if (result.status !== "COMPUTED") {
          throw new Error(
            `Expected COMPUTED, got ${result.status}`,
          );
        }

        // 10.5 * 1.390 = 14.595, exact
        expect(result.embedded_emissions_tco2e).toBe(
          "14.595",
        );

        expect(result.engine_version).toBe(
          ENGINE_VERSION,
        );

        expect(result.steps.length).toBeGreaterThan(
          0,
        );

        expect(
          result.steps.every((step) => step.rule_ref === "RULE-EE-001"),
        ).toBe(
          true,
        );
      },
    );

    it(
      "computes embedded emissions for an electricity good (MWh basis)",
      () => {
        const result =
          calculateLineEmissions(
            {
              net_mass_tonnes: null,
              quantity_mwh: "200" as never,
              emission_determination: defaultDetermination(
                { total: availableValue("0.45") },
              ),
            },
          );

        if (result.status !== "COMPUTED") {
          throw new Error(
            `Expected COMPUTED, got ${result.status}`,
          );
        }

        expect(result.embedded_emissions_tco2e).toBe(
          "90",
        );
      },
    );

    it(
      "preserves exact decimal precision (no floating-point drift)",
      () => {
        const result =
          calculateLineEmissions(
            {
              net_mass_tonnes: "0.1" as never,
              quantity_mwh: null,
              emission_determination: defaultDetermination(
                { total: availableValue("0.2") },
              ),
            },
          );

        if (result.status !== "COMPUTED") {
          throw new Error(
            `Expected COMPUTED, got ${result.status}`,
          );
        }

        // 0.1 * 0.2 = 0.02 exactly -- native JS floating point gives
        // 0.020000000000000004 for this multiplication.
        expect(result.embedded_emissions_tco2e).toBe(
          "0.02",
        );
      },
    );

    it(
      "returns INPUT_UNRESOLVED with no value when the line has no determination",
      () => {
        const result =
          calculateLineEmissions(
            {
              net_mass_tonnes: "10.5" as never,
              quantity_mwh: null,
              emission_determination: null,
            },
          );

        expect(result).toEqual(
          {
            status: "INPUT_UNRESOLVED",
            engine_version: ENGINE_VERSION,
          },
        );
      },
    );

    it(
      "returns VALUE_UNAVAILABLE (never zero) when the resolved total is not AVAILABLE",
      () => {
        const result =
          calculateLineEmissions(
            {
              net_mass_tonnes: "10.5" as never,
              quantity_mwh: null,
              emission_determination: defaultDetermination(
                {
                  total: {
                    value: null,
                    status: "UNAVAILABLE",
                    raw_source_value: null,
                  },
                },
              ),
            },
          );

        expect(result).toEqual(
          {
            status: "VALUE_UNAVAILABLE",
            engine_version: ENGINE_VERSION,
          },
        );
      },
    );

    it(
      "returns ACTUAL_METHOD_NOT_YET_SUPPORTED for an ACTUAL determination",
      () => {
        const result =
          calculateLineEmissions(
            {
              net_mass_tonnes: "10.5" as never,
              quantity_mwh: null,
              emission_determination: {
                method: "ACTUAL",
                snapshot: {
                  emission_data_id: "ed-1" as never,
                  emission_data_version: 1,
                  installation_id: "inst-1" as never,
                  resolved_at: "2026-08-28T00:00:00.000Z" as never,
                  values: {
                    direct_specific: "1.0" as never,
                    indirect_specific: "0.1" as never,
                  },
                  emission_unit: "TCO2E_PER_TONNE",
                  methodology: "EU_METHOD",
                  verification: { status: "VERIFIED", verifier_user_id: "user-1" as never },
                  evidence_file_ids: [],
                  sharing_grant_id: null,
                },
              },
            },
          );

        expect(result).toEqual(
          {
            status: "ACTUAL_METHOD_NOT_YET_SUPPORTED",
            engine_version: ENGINE_VERSION,
          },
        );
      },
    );
  },
);
