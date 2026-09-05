import {
  describe,
  expect,
  it,
} from "vitest";

import {
  getShipmentEmissionsTotal,
} from "./get-shipment-emissions-total";

import type {
  LatestLineCalculation,
} from "./get-latest-calculations";

import type {
  DecimalString,
} from "../../domain/shared/decimal";

function determination(
  reason = "EXACT_CN8_MATCH",
) {
  return {
    method: "DEFAULT",
    resolution: {
      dataset_id: "dataset-1",
      dataset_version: "2026-definitive-corrected",
      resolved_at: "2026-08-28T00:00:00.000Z",
      reason,
      country_mapping: { status: "MAPPED", regulatory_country_name: "China" },
      record_identity: {
        source_sheet: "Cement",
        source_row: 42,
        source_trade_code: "25232100",
        origin_country_name: "China",
        source_production_route_code: null,
      },
      values: {
        direct: { value: "1.250", status: "AVAILABLE", raw_source_value: "1.250" },
        indirect: { value: "0.140", status: "AVAILABLE", raw_source_value: "0.140" },
        total: { value: "1.390", status: "AVAILABLE", raw_source_value: "1.390" },
      },
      emission_unit: "TCO2E_PER_TONNE",
      trace: [],
    },
  } as never;
}

function calculation(
  {
    embedded_emissions_tco2e,
    calculatedAgainst = determination(),
  }: {
    embedded_emissions_tco2e: string;
    calculatedAgainst?: unknown;
  },
): LatestLineCalculation {
  return {
    id: "calc-1" as never,
    engine_version: "1.4.0" as never,
    embedded_emissions_tco2e: embedded_emissions_tco2e as DecimalString,
    steps: [],
    calculated_at: "2026-08-28T00:00:00.000Z" as never,
    determination: calculatedAgainst as never,
  };
}

describe(
  "getShipmentEmissionsTotal",
  () => {
    it(
      "returns NONE when no line has been calculated",
      () => {
        const result =
          getShipmentEmissionsTotal(
            [{ id: "line-1", emission_determination: determination() }],
            {},
          );

        expect(result).toEqual(
          { status: "NONE" },
        );
      },
    );

    it(
      "returns COMPLETE, summing every line, when every calculation is still CURRENT against the line's own determination",
      () => {
        const result =
          getShipmentEmissionsTotal(
            [
              { id: "line-1", emission_determination: determination() },
              { id: "line-2", emission_determination: determination() },
            ],
            {
              "line-1": calculation({ embedded_emissions_tco2e: "10.5" }),
              "line-2": calculation({ embedded_emissions_tco2e: "5.5" }),
            },
          );

        expect(result).toEqual(
          {
            status: "COMPLETE",
            total_tco2e: "16",
            totalLineCount: 2,
          },
        );
      },
    );

    it(
      "excludes a STALE calculation entirely -- not its old figure, not a zero -- when the line was re-determined after being calculated (2026-09-06, fresh S3 review B1)",
      () => {
        const result =
          getShipmentEmissionsTotal(
            [
              { id: "line-1", emission_determination: determination("EXACT_CN8_MATCH") },
              { id: "line-2", emission_determination: determination("REGULATORY_REDETERMINED") },
            ],
            {
              "line-1": calculation({ embedded_emissions_tco2e: "10.5", calculatedAgainst: determination("EXACT_CN8_MATCH") }),
              // Calculated against the OLD reason; the line's own
              // current determination (above) has since changed --
              // calculation_results was never touched, so this row is
              // now stale.
              "line-2": calculation({ embedded_emissions_tco2e: "999", calculatedAgainst: determination("EXACT_CN8_MATCH") }),
            },
          );

        // line-2's 999 must NOT appear anywhere in the total -- proves
        // this is not merely "PARTIAL excludes it from the count" but
        // that the stale figure genuinely never entered the sum.
        expect(result).toEqual(
          {
            status: "PARTIAL",
            total_tco2e: "10.5",
            calculatedLineCount: 1,
            totalLineCount: 2,
          },
        );
      },
    );

    it(
      "excludes a calculation whose line's determination was since CLEARED (set to null) -- also STALE, never CURRENT",
      () => {
        const result =
          getShipmentEmissionsTotal(
            [
              { id: "line-1", emission_determination: null },
            ],
            {
              "line-1": calculation({ embedded_emissions_tco2e: "42" }),
            },
          );

        expect(result).toEqual(
          { status: "NONE" },
        );
      },
    );
  },
);
