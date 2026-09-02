import {
  describe,
  expect,
  it,
} from "vitest";

import {
  calculateLineEmissions,
} from "../../src/domain/calculations/calculate-line-emissions";

import {
  ENGINE_VERSION,
} from "../../src/domain/calculations/types";

import defaultMethodFixtures from "./fixtures/engine-1.2.0/default-method.json";
import actualMethodFixtures from "./fixtures/engine-1.2.0/actual-method.json";
import emissionUnitFixtures from "./fixtures/engine-1.2.0/emission-units.json";

/**
 * Hand-authored golden fixtures for the calculation engine.
 *
 * Read tests/golden/fixtures/engine-1.2.0/README.md before touching
 * anything here. The short version: every expected value in those files
 * was derived by hand from the rule register and the source dataset,
 * NEVER by running the engine and recording the output. A generated
 * fixture reproduces the implementation's own bugs perfectly and pins
 * them in place -- it can catch a change, never a mistake.
 *
 * So when one of these fails, the question is which of the two is
 * wrong. "Update the golden" is not a fix.
 *
 * Pure: no I/O, no clock, no database. Runs in the fast gate as well as
 * the full suite.
 */

interface CalculationFixture {
  name: string;
  note?: string;
  input: {
    net_mass_tonnes: string | null;
    quantity_mwh: string | null;
    good_sector: string | null;
    emission_determination: unknown;
  };
  expected: Record<string, unknown>;
}

interface UnitFixture {
  name: string;
  note?: string;
  emission_unit: string;
  quantity_basis: "TONNES" | "MWH";
  expected_status: string;
}

describe(
  "calculation engine goldens (engine 1.2.0)",
  () => {
    it(
      "is the engine version these fixtures were derived for",
      () => {
        // The guard that makes a version bump a deliberate act. Raising
        // ENGINE_VERSION breaks this suite on purpose, so the expected
        // values are re-derived by hand for the new version instead of
        // being carried forward on the assumption nothing moved.
        expect(ENGINE_VERSION).toBe(
          "1.2.0",
        );
      },
    );

    describe(
      "DEFAULT method (RULE-EE-001)",
      () => {
        for (const fixture of defaultMethodFixtures as CalculationFixture[]) {
          it(
            fixture.name,
            () => {
              expect(
                calculateLineEmissions(
                  fixture.input as never,
                ),
              ).toEqual(
                fixture.expected,
              );
            },
          );
        }
      },
    );

    describe(
      "ACTUAL method (RULE-EE-009)",
      () => {
        for (const fixture of actualMethodFixtures as CalculationFixture[]) {
          it(
            fixture.name,
            () => {
              expect(
                calculateLineEmissions(
                  fixture.input as never,
                ),
              ).toEqual(
                fixture.expected,
              );
            },
          );
        }
      },
    );

    describe(
      "emission-unit acceptance",
      () => {
        for (const fixture of emissionUnitFixtures as UnitFixture[]) {
          it(
            fixture.name,
            () => {
              // One shared, deliberately boring numeric shape so the
              // fixture is about the UNIT and nothing else: quantity 1
              // against a specific value of 1, which computes to "1"
              // whenever the unit is accepted at all.
              const onTonnes =
                fixture.quantity_basis === "TONNES";

              const result =
                calculateLineEmissions(
                  {
                    net_mass_tonnes: onTonnes ? ("1" as never) : null,
                    quantity_mwh: onTonnes ? null : ("1" as never),
                    good_sector: null,
                    emission_determination: {
                      method: "DEFAULT",
                      resolution: {
                        emission_unit: fixture.emission_unit,
                        values: {
                          total: { status: "AVAILABLE", value: "1" },
                        },
                      },
                    } as never,
                  },
                );

              expect(result.status).toBe(
                fixture.expected_status,
              );

              if (fixture.expected_status === "COMPUTED") {
                expect(
                  result.status === "COMPUTED"
                    ? result.embedded_emissions_tco2e
                    : null,
                ).toBe(
                  "1",
                );
              }
            },
          );
        }
      },
    );

    describe(
      "byte-equality is the contract, not numeric equality",
      () => {
        it(
          "drops trailing zeros rather than emitting a fixed number of decimal places",
          () => {
            // reproduceCalculationResult compares stored against
            // recomputed with ===, so a change to toFixed() -- even one
            // that keeps every value numerically identical -- would make
            // every calculation ever persisted fail to reproduce. That
            // is why the fixtures say "2" and not "2.000".
            const result =
              calculateLineEmissions(
                {
                  net_mass_tonnes: "10" as never,
                  quantity_mwh: null,
                  good_sector: null,
                  emission_determination: {
                    method: "ACTUAL",
                    snapshot: {
                      emission_unit: "tCO2e/t",
                      verification: { status: "VERIFIED" },
                      values: {
                        direct_specific: "0.155",
                        indirect_specific: "0.045",
                      },
                    },
                  } as never,
                },
              );

            expect(
              result.status === "COMPUTED"
                ? result.embedded_emissions_tco2e
                : null,
            ).toBe(
              "2",
            );
          },
        );

        it(
          "preserves a value that is numerically equal but written differently",
          () => {
            // "0.1550" and "0.155" are the same number and different
            // frozen facts. The engine must not normalise the inputs it
            // was given -- the step's `inputs` are the audit trail of
            // what was actually used.
            const result =
              calculateLineEmissions(
                {
                  net_mass_tonnes: "1" as never,
                  quantity_mwh: null,
                  good_sector: null,
                  emission_determination: {
                    method: "DEFAULT",
                    resolution: {
                      emission_unit: "TCO2E_PER_TONNE",
                      values: {
                        total: { status: "AVAILABLE", value: "1.3900" },
                      },
                    },
                  } as never,
                },
              );

            expect(
              result.status === "COMPUTED"
                ? result.steps[0]?.inputs.specific_embedded_emissions
                : null,
            ).toBe(
              "1.3900",
            );

            // The OUTPUT, by contrast, is whatever decimal.js produces:
            // 1 x 1.3900 = 1.39.
            expect(
              result.status === "COMPUTED"
                ? result.embedded_emissions_tco2e
                : null,
            ).toBe(
              "1.39",
            );
          },
        );
      },
    );
  },
);
