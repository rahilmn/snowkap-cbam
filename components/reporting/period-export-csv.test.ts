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
    cn_code: "72081000",
    cn_code_level: "CN8",
    origin_country: "DE" as never,
    production_route: null,
    quantity: "10" as never,
    quantity_unit: "TONNES",
    determination_method: "DEFAULT",
    dataset_version: "2026.1",
    methodology: null,
    resolution_reason: "MATCHED" as never,
    engine_version: "1.1.0",
    embedded_emissions_tco2e: "20" as never,
    calculated_at: "2026-02-01T00:00:00.000Z" as never,
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
            "Resolution reason,Engine version,Embedded emissions (tCO2e),Calculated at",
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
          "REF-001,1,72081000,CN8,DE,,10,TONNES,DEFAULT,2026.1,,MATCHED,1.1.0,20,2026-02-01T00:00:00.000Z",
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
          "REF-001,1,72081000,CN8,DE,,10,TONNES,NOT_DETERMINED,,,,,,",
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
