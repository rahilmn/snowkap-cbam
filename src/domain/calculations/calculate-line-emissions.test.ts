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
  emissionUnit = "TCO2E_PER_TONNE",
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
    emission_unit: emissionUnit,
    trace: [],
  };
}

function defaultDetermination(
  valuesOverrides: Partial<RegulatoryResolutionSnapshot["values"]> = {},
  emissionUnit = "TCO2E_PER_TONNE",
): EmissionDetermination {
  return {
    method: "DEFAULT",
    resolution: snapshot(valuesOverrides, emissionUnit),
  };
}

function actualDetermination(
  valuesOverrides: Partial<{ direct_specific: string; indirect_specific: string }> = {},
  emissionUnit = "TCO2E_PER_TONNE",
  sharingGrantId: string | null = null,
): EmissionDetermination {
  return {
    method: "ACTUAL",
    snapshot: {
      emission_data_id: "ed-1" as never,
      emission_data_version: 1,
      installation_id: "inst-1" as never,
      resolved_at: "2026-08-28T00:00:00.000Z" as never,
      values: {
        direct_specific: "1.0" as never,
        indirect_specific: "0.1" as never,
        ...valuesOverrides,
      } as never,
      emission_unit: emissionUnit,
      methodology: "EU_METHOD",
      verification: { status: "VERIFIED", verifier_user_id: "user-1" as never },
      evidence_file_ids: ["evidence-1"],
      sharing_grant_id: sharingGrantId as never,
    },
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
                "TCO2E_PER_MWH",
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
      "returns UNIT_UNSUPPORTED when the resolved emission_unit doesn't match the line's quantity basis",
      () => {
        const massLineWithMwhUnit =
          calculateLineEmissions(
            {
              net_mass_tonnes: "10.5" as never,
              quantity_mwh: null,
              emission_determination: defaultDetermination(
                {},
                "TCO2E_PER_MWH",
              ),
            },
          );

        expect(massLineWithMwhUnit).toEqual(
          { status: "UNIT_UNSUPPORTED", engine_version: ENGINE_VERSION },
        );

        const energyLineWithTonneUnit =
          calculateLineEmissions(
            {
              net_mass_tonnes: null,
              quantity_mwh: "200" as never,
              emission_determination: defaultDetermination(
                {},
                "TCO2E_PER_TONNE",
              ),
            },
          );

        expect(energyLineWithTonneUnit).toEqual(
          { status: "UNIT_UNSUPPORTED", engine_version: ENGINE_VERSION },
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
      "computes embedded emissions for a mass good from an ACTUAL determination (RULE-EE-009: quantity x (direct_specific + indirect_specific))",
      () => {
        const result =
          calculateLineEmissions(
            {
              net_mass_tonnes: "10.5" as never,
              quantity_mwh: null,
              emission_determination: actualDetermination(
                { direct_specific: "1.0" as never, indirect_specific: "0.1" as never },
              ),
            },
          );

        if (result.status !== "COMPUTED") {
          throw new Error(
            `Expected COMPUTED, got ${result.status}`,
          );
        }

        // 10.5 * (1.0 + 0.1) = 10.5 * 1.1 = 11.55, exact
        expect(result.embedded_emissions_tco2e).toBe(
          "11.55",
        );

        expect(result.engine_version).toBe(
          ENGINE_VERSION,
        );

        expect(
          result.steps.every((step) => step.rule_ref === "RULE-EE-009"),
        ).toBe(
          true,
        );
      },
    );

    it(
      "computes embedded emissions for an electricity good from an ACTUAL determination (MWh basis)",
      () => {
        const result =
          calculateLineEmissions(
            {
              net_mass_tonnes: null,
              quantity_mwh: "200" as never,
              emission_determination: actualDetermination(
                { direct_specific: "0.3" as never, indirect_specific: "0.15" as never },
                "TCO2E_PER_MWH",
              ),
            },
          );

        if (result.status !== "COMPUTED") {
          throw new Error(
            `Expected COMPUTED, got ${result.status}`,
          );
        }

        // 200 * (0.3 + 0.15) = 200 * 0.45 = 90, exact
        expect(result.embedded_emissions_tco2e).toBe(
          "90",
        );
      },
    );

    it(
      "returns UNIT_UNSUPPORTED for an ACTUAL determination whose emission_unit doesn't match the line's quantity basis",
      () => {
        const massLineWithMwhUnit =
          calculateLineEmissions(
            {
              net_mass_tonnes: "10.5" as never,
              quantity_mwh: null,
              emission_determination: actualDetermination(
                {},
                "TCO2E_PER_MWH",
              ),
            },
          );

        expect(massLineWithMwhUnit).toEqual(
          { status: "UNIT_UNSUPPORTED", engine_version: ENGINE_VERSION },
        );

        const energyLineWithTonneUnit =
          calculateLineEmissions(
            {
              net_mass_tonnes: null,
              quantity_mwh: "200" as never,
              emission_determination: actualDetermination(
                {},
                "TCO2E_PER_TONNE",
              ),
            },
          );

        expect(energyLineWithTonneUnit).toEqual(
          { status: "UNIT_UNSUPPORTED", engine_version: ENGINE_VERSION },
        );
      },
    );

    it(
      "preserves exact decimal precision for an ACTUAL determination (no floating-point drift)",
      () => {
        const result =
          calculateLineEmissions(
            {
              net_mass_tonnes: "0.1" as never,
              quantity_mwh: null,
              emission_determination: actualDetermination(
                { direct_specific: "0.1" as never, indirect_specific: "0.2" as never },
              ),
            },
          );

        if (result.status !== "COMPUTED") {
          throw new Error(
            `Expected COMPUTED, got ${result.status}`,
          );
        }

        // direct + indirect = 0.1 + 0.2 = 0.3 exactly (native float gives
        // 0.30000000000000004); 0.1 * 0.3 = 0.03 exactly.
        expect(result.embedded_emissions_tco2e).toBe(
          "0.03",
        );
      },
    );

    it(
      "accepts a producer-style abbreviated emission_unit ('tCO2e/t', 'tCO2e/MWh') for an ACTUAL determination -- not just the regulatory dataset's own spelled-out convention ('TCO2E_PER_TONNE')",
      () => {
        // Found live in browser verification: the producer emission-data
        // entry form's own placeholder suggests exactly this format
        // (app/(producer)/emission-data/emission-data-form.tsx,
        // "e.g. tCO2e/t") -- the original unit check (ported from
        // RULE-EE-001's DEFAULT-only "TONNE" substring match) rejected a
        // real producer-entered value as UNIT_UNSUPPORTED.
        const massResult =
          calculateLineEmissions(
            {
              net_mass_tonnes: "10" as never,
              quantity_mwh: null,
              emission_determination: actualDetermination(
                { direct_specific: "3.0" as never, indirect_specific: "0.5" as never },
                "tCO2e/t",
              ),
            },
          );

        if (massResult.status !== "COMPUTED") {
          throw new Error(
            `Expected COMPUTED for 'tCO2e/t', got ${massResult.status}`,
          );
        }

        // 10 * (3.0 + 0.5) = 35, exact
        expect(massResult.embedded_emissions_tco2e).toBe(
          "35",
        );

        const energyResult =
          calculateLineEmissions(
            {
              net_mass_tonnes: null,
              quantity_mwh: "10" as never,
              emission_determination: actualDetermination(
                { direct_specific: "3.0" as never, indirect_specific: "0.5" as never },
                "tCO2e/MWh",
              ),
            },
          );

        if (energyResult.status !== "COMPUTED") {
          throw new Error(
            `Expected COMPUTED for 'tCO2e/MWh', got ${energyResult.status}`,
          );
        }

        expect(energyResult.embedded_emissions_tco2e).toBe(
          "35",
        );

        // A mass-basis abbreviated unit must still correctly reject an
        // energy line, and vice versa -- the broadened check must not
        // have become so permissive it stops distinguishing the two.
        const mismatchedResult =
          calculateLineEmissions(
            {
              net_mass_tonnes: "10" as never,
              quantity_mwh: null,
              emission_determination: actualDetermination(
                {},
                "tCO2e/MWh",
              ),
            },
          );

        expect(mismatchedResult).toEqual(
          { status: "UNIT_UNSUPPORTED", engine_version: ENGINE_VERSION },
        );
      },
    );

    it(
      "rejects energy-denominated units on a mass line that happen to contain the letter T -- the '/T' widening must not become a bare substring trap (found in the mandatory RULE-EE-009 engine review)",
      () => {
        // tCO2/TJ is the standard EU ETS MRR emission-factor denominator
        // -- not a contrived string -- and emission_unit has no CHECK
        // constraint (recordEmissionData passes it through unvalidated),
        // so a producer entering it is genuinely reachable. Each of
        // these contains "/T" as a bare substring (TJ, TWh, Th all
        // start with T) but is NOT a tonnes-denominated unit.
        const energyDenominatedUnits =
          [
            "tCO2/TJ",
            "kgCO2e/TJ",
            "tCO2e/TWh",
            "tCO2e/Th",
          ];

        for (const unit of energyDenominatedUnits) {
          const result =
            calculateLineEmissions(
              {
                net_mass_tonnes: "10" as never,
                quantity_mwh: null,
                emission_determination: actualDetermination(
                  {},
                  unit,
                ),
              },
            );

          expect(result).toEqual(
            { status: "UNIT_UNSUPPORTED", engine_version: ENGINE_VERSION },
          );
        }
      },
    );

    it(
      "returns VALUE_UNAVAILABLE (never a computed value) for an ACTUAL snapshot whose verification.status is not VERIFIED -- defense in depth: the type-level Extract<VerificationStatus, 'VERIFIED'> guarantee does not survive a JSONB round-trip at runtime (found in the mandatory RULE-EE-009 engine review), the same reasoning RULE-EE-001 already applies to a non-AVAILABLE resolved total",
      () => {
        const determination =
          actualDetermination();

        if (determination.method !== "ACTUAL") {
          throw new Error(
            "expected ACTUAL",
          );
        }

        const corruptedDetermination: EmissionDetermination =
          {
            method: "ACTUAL",
            snapshot: {
              ...determination.snapshot,
              verification: {
                status: "REJECTED" as never,
                verifier_user_id: "user-1" as never,
              },
            },
          };

        const result =
          calculateLineEmissions(
            {
              net_mass_tonnes: "10.5" as never,
              quantity_mwh: null,
              emission_determination: corruptedDetermination,
            },
          );

        expect(result).toEqual(
          { status: "VALUE_UNAVAILABLE", engine_version: ENGINE_VERSION },
        );
      },
    );

    it(
      "returns PARAMETER_DATASET_UNAVAILABLE (never a computed value) for an ACTUAL determination on an IRON_STEEL good with non-zero indirect_specific -- owner-directed gate for RULE-EE-004's not-yet-reintroduced Annex II exception",
      () => {
        const result =
          calculateLineEmissions(
            {
              net_mass_tonnes: "10" as never,
              quantity_mwh: null,
              emission_determination: actualDetermination(
                { direct_specific: "1.0", indirect_specific: "0.2" },
              ),
              good_sector: "IRON_STEEL",
            },
          );

        expect(result).toEqual(
          { status: "PARAMETER_DATASET_UNAVAILABLE", engine_version: ENGINE_VERSION },
        );
      },
    );

    it(
      "returns PARAMETER_DATASET_UNAVAILABLE for an ALUMINIUM good with non-zero indirect_specific",
      () => {
        const result =
          calculateLineEmissions(
            {
              net_mass_tonnes: "10" as never,
              quantity_mwh: null,
              emission_determination: actualDetermination(
                { direct_specific: "1.0", indirect_specific: "0.2" },
              ),
              good_sector: "ALUMINIUM",
            },
          );

        expect(result).toEqual(
          { status: "PARAMETER_DATASET_UNAVAILABLE", engine_version: ENGINE_VERSION },
        );
      },
    );

    it(
      "computes normally for an IRON_STEEL good whose indirect_specific is exactly zero -- direct + 0 already equals the Annex II-correct value, so the gate must not over-block it",
      () => {
        const result =
          calculateLineEmissions(
            {
              net_mass_tonnes: "10" as never,
              quantity_mwh: null,
              emission_determination: actualDetermination(
                { direct_specific: "1.0", indirect_specific: "0" },
              ),
              good_sector: "IRON_STEEL",
            },
          );

        expect(result.status).toBe(
          "COMPUTED",
        );
        if (result.status === "COMPUTED") {
          expect(result.embedded_emissions_tco2e).toBe(
            "10",
          );
        }
      },
    );

    it(
      "computes normally for a non-Annex-II sector (CEMENT) with non-zero indirect_specific -- the gate is sector-scoped, not universal",
      () => {
        const result =
          calculateLineEmissions(
            {
              net_mass_tonnes: "10" as never,
              quantity_mwh: null,
              emission_determination: actualDetermination(
                { direct_specific: "1.0", indirect_specific: "0.2" },
              ),
              good_sector: "CEMENT",
            },
          );

        expect(result.status).toBe(
          "COMPUTED",
        );
        if (result.status === "COMPUTED") {
          expect(result.embedded_emissions_tco2e).toBe(
            "12",
          );
        }
      },
    );

    it(
      "computes normally for an ACTUAL determination when good_sector is not provided (undefined) -- callers that cannot resolve a sector are not blocked by this gate",
      () => {
        const result =
          calculateLineEmissions(
            {
              net_mass_tonnes: "10" as never,
              quantity_mwh: null,
              emission_determination: actualDetermination(
                { direct_specific: "1.0", indirect_specific: "0.2" },
              ),
            },
          );

        expect(result.status).toBe(
          "COMPUTED",
        );
      },
    );

    it(
      "computes identically for a cross-org (shared) ACTUAL determination as for an own-org one -- the engine does not care about sharing_grant_id",
      () => {
        const result =
          calculateLineEmissions(
            {
              net_mass_tonnes: "10.5" as never,
              quantity_mwh: null,
              emission_determination: actualDetermination(
                { direct_specific: "1.0" as never, indirect_specific: "0.1" as never },
                "TCO2E_PER_TONNE",
                "grant-1" as never,
              ),
            },
          );

        if (result.status !== "COMPUTED") {
          throw new Error(
            `Expected COMPUTED, got ${result.status}`,
          );
        }

        expect(result.embedded_emissions_tco2e).toBe(
          "11.55",
        );
      },
    );
  },
);
