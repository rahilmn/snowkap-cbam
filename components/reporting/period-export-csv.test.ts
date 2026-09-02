import {
  describe,
  expect,
  it,
} from "vitest";

import {
  buildPeriodExportCsv,
} from "./period-export-csv";

import type {
  PeriodExportRow,
} from "../../src/application/reporting/build-period-export-rows";

function row(
  overrides: Partial<PeriodExportRow> = {},
): PeriodExportRow {
  return {
    shipment_reference: "REF-001",
    line_number: 1,
    // 2026-09-03 (P14, fixture hygiene): reason "MATCHED" is not a
    // member of ResolutionReason and only compiled because of an
    // `as never` cast, which is precisely how an impossible shape
    // survives a type system. Replaced with the real China / CN8
    // 2523 21 00 row this dataset genuinely holds.
    cn_code: "25232100",
    cn_code_level: "CN8",
    origin_country: "CN" as never,
    production_route: null,
    quantity: "10" as never,
    quantity_unit: "TONNES",
    determination_method: "DEFAULT",
    dataset_version: "2026-definitive-corrected",
    methodology: null,
    resolution_reason: "EXACT_CN8_MATCH",
    engine_version: "1.1.0",
    embedded_emissions_tco2e: "20" as never,
    calculated_at: "2026-02-01T00:00:00.000Z" as never,
    country_mapping_status: "MAPPED",
    emission_data_id: null,
    emission_data_version: null,
    installation_name: null,
    sharing_grant_id: null,
    calculation_currency: "CURRENT",
    ...overrides,
  };
}

describe(
  "buildPeriodExportCsv",
  () => {
    it(
      "emits just the header row for an empty list",
      () => {
        expect(
          buildPeriodExportCsv(
            [],
          ),
        ).toBe(
          "Shipment reference,Line,CN/TARIC code,Code level,Origin country,Production route," +
            "Quantity,Quantity unit,Determination method,Dataset version,Methodology," +
            "Resolution reason,Engine version,Embedded emissions (tCO2e),Calculated at," +
            // 2026-09-03 (P14): appended after the existing columns, so
            // the prefix every previously-exported file carries is
            // byte-identical.
            "Country mapping status,Emission data id,Emission data version," +
            "Installation name (current if visible),Sharing grant id,Calculation currency",
        );
      },
    );

    it(
      "emits one CSV row per export row, joined with CRLF",
      () => {
        const csv =
          buildPeriodExportCsv(
            [
              row(
                {},
              ),
            ],
          );

        const lines =
          csv.split(
            "\r\n",
          );

        expect(
          lines,
        ).toHaveLength(
          2,
        );

        expect(
          lines[1],
        ).toBe(
          "REF-001,1,25232100,CN8,CN,,10,TONNES,DEFAULT,2026-definitive-corrected,,EXACT_CN8_MATCH,1.1.0,20,2026-02-01T00:00:00.000Z,MAPPED,,,,,CURRENT",
        );
      },
    );

    it(
      "renders every null field (never yet determined/calculated) as an empty cell, never the literal word 'null'",
      () => {
        const csv =
          buildPeriodExportCsv(
            [
              row(
                {
                  determination_method: "NOT_DETERMINED",
                  dataset_version: null,
                  methodology: null,
                  resolution_reason: null,
                  engine_version: null,
                  embedded_emissions_tco2e: null,
                  calculated_at: null,
                  country_mapping_status: null,
                  emission_data_id: null,
                  emission_data_version: null,
                  installation_name: null,
                  sharing_grant_id: null,
                  calculation_currency: "NOT_CALCULATED",
                },
              ),
            ],
          );

        expect(
          csv,
        ).not.toContain(
          "null",
        );

        expect(
          csv.split("\r\n")[1],
        ).toBe(
          "REF-001,1,25232100,CN8,CN,,10,TONNES,NOT_DETERMINED,,,,,,,,,,,,NOT_CALCULATED",
        );
      },
    );

    it(
      "exports the full, unrounded DecimalString quantity and embedded_emissions_tco2e, not a JS-number coercion",
      () => {
        const csv =
          buildPeriodExportCsv(
            [
              row(
                {
                  quantity: "10.123456789" as never,
                  embedded_emissions_tco2e: "0.0000123456" as never,
                },
              ),
            ],
          );

        expect(
          csv,
        ).toContain(
          "10.123456789",
        );

        expect(
          csv,
        ).toContain(
          "0.0000123456",
        );
      },
    );

    it(
      "prefixes a field starting with =, +, -, or @ with a single quote, guarding against CSV formula injection",
      () => {
        const csv =
          buildPeriodExportCsv(
            [
              row(
                {
                  production_route: "=cmd|'/c calc'!A1",
                },
              ),
            ],
          );

        expect(
          csv,
        ).toContain(
          "'=cmd|'/c calc'!A1",
        );
      },
    );

    it(
      "quotes and doubles internal quotes for a field containing a comma",
      () => {
        const csv =
          buildPeriodExportCsv(
            [
              row(
                {
                  production_route: 'Blast furnace, "primary"',
                },
              ),
            ],
          );

        expect(
          csv,
        ).toContain(
          '"Blast furnace, ""primary"""',
        );
      },
    );
  },
);
