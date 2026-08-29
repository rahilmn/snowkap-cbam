import {
  describe,
  expect,
  it,
} from "vitest";

import {
  buildPeriodExportRows,
} from "./build-period-export-rows";

const orgId =
  "org-1" as never;

const annualPeriod =
  { kind: "ANNUAL", year: 2026 } as never;

function shipmentRow(
  overrides: Record<string, unknown> = {},
) {
  return {
    id: "ship-1",
    org_id: "org-1",
    reference: "REF-001",
    release_date: "2026-03-15",
    reporting_period_kind: "ANNUAL",
    reporting_period_year: 2026,
    reporting_period_quarter: null,
    customs_mrn: null,
    customs_procedure: null,
    status: "READY",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const defaultDetermination =
  {
    method: "DEFAULT",
    resolution: {
      dataset_id: "dataset-1",
      dataset_version: "2026.1",
      resolved_at: "2026-01-01T00:00:00.000Z",
      reason: "MATCHED",
      country_mapping: { status: "MAPPED", regulatory_country_name: "Germany" },
      record_identity: {
        source_sheet: "Sheet1",
        source_row: 1,
        source_trade_code: "72081000",
        origin_country_name: "Germany",
        source_production_route_code: null,
      },
      values: {
        direct: { status: "AVAILABLE", value: "1.9" },
        indirect: { status: "AVAILABLE", value: "0.1" },
        total: { status: "AVAILABLE", value: "2.0" },
      },
      emission_unit: "TCO2E_PER_TONNE",
      trace: [],
    },
  };

const actualDetermination =
  {
    method: "ACTUAL",
    snapshot: {
      emission_data_id: "emission-data-1",
      emission_data_version: 1,
      installation_id: "installation-1",
      resolved_at: "2026-01-01T00:00:00.000Z",
      values: { direct_specific: "1.5", indirect_specific: "0.2" },
      emission_unit: "tCO2e/t",
      methodology: "EU_METHOD",
      verification: { status: "VERIFIED", verifier_user_id: "admin-1" },
      evidence_file_ids: [],
      sharing_grant_id: null,
    },
  };

function lineRow(
  overrides: Record<string, unknown> = {},
) {
  return {
    id: "line-1",
    shipment_id: "ship-1",
    org_id: "org-1",
    line_number: 1,
    cn_code: "72081000",
    cn_code_level: "CN8",
    goods_description: null,
    origin_country: "DE",
    net_mass_tonnes: "10",
    quantity_mwh: null,
    production_route_name: null,
    production_route_indicator: null,
    emission_determination: null,
    ...overrides,
  };
}

interface TableResult {
  data: unknown;
  error: unknown;
}

function makeMockSupabase(
  tables: Record<string, TableResult>,
) {
  function builder(
    table: string,
  ) {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      neq: () => chain,
      in: () => chain,
      is: () => chain,
      order: () => chain,
      then: (
        resolve: (value: TableResult) => unknown,
        reject: (reason: unknown) => unknown,
      ) =>
        Promise.resolve(
          tables[table] ?? { data: null, error: null },
        ).then(resolve, reject),
    };

    return chain;
  }

  return {
    from: (table: string) => builder(table),
  } as never;
}

describe(
  "buildPeriodExportRows",
  () => {
    it(
      "flattens a DEFAULT-determined, calculated line with its dataset_version and resolution_reason, no methodology",
      async () => {
        const result =
          await buildPeriodExportRows(
            makeMockSupabase(
              {
                shipments: { data: [shipmentRow()], error: null },
                shipment_lines: { data: [lineRow({ emission_determination: defaultDetermination })], error: null },
                latest_calculation_results: {
                  data: [
                    { id: "calc-1", line_id: "line-1", engine_version: "1.1.0", embedded_emissions_tco2e: "20", steps: [], calculated_at: "2026-02-01T00:00:00Z" },
                  ],
                  error: null,
                },
              },
            ),
            orgId,
            annualPeriod,
          );

        expect(result).toEqual(
          [
            {
              shipment_reference: "REF-001",
              line_number: 1,
              cn_code: "72081000",
              cn_code_level: "CN8",
              origin_country: "DE",
              production_route: null,
              quantity: "10",
              quantity_unit: "TONNES",
              determination_method: "DEFAULT",
              dataset_version: "2026.1",
              methodology: null,
              resolution_reason: "MATCHED",
              engine_version: "1.1.0",
              embedded_emissions_tco2e: "20",
              calculated_at: "2026-02-01T00:00:00Z",
            },
          ],
        );
      },
    );

    it(
      "flattens an ACTUAL-determined line with its methodology, no dataset_version or resolution_reason",
      async () => {
        const result =
          await buildPeriodExportRows(
            makeMockSupabase(
              {
                shipments: { data: [shipmentRow()], error: null },
                shipment_lines: { data: [lineRow({ emission_determination: actualDetermination, quantity_mwh: null })], error: null },
                latest_calculation_results: { data: [], error: null },
              },
            ),
            orgId,
            annualPeriod,
          );

        expect(result[0]).toMatchObject(
          {
            determination_method: "ACTUAL",
            dataset_version: null,
            methodology: "EU_METHOD",
            resolution_reason: null,
          },
        );
      },
    );

    it(
      "reports an electricity line's quantity in MWh when net_mass_tonnes is null",
      async () => {
        const result =
          await buildPeriodExportRows(
            makeMockSupabase(
              {
                shipments: { data: [shipmentRow()], error: null },
                shipment_lines: { data: [lineRow({ net_mass_tonnes: null, quantity_mwh: "500" })], error: null },
                latest_calculation_results: { data: [], error: null },
              },
            ),
            orgId,
            annualPeriod,
          );

        expect(result[0]).toMatchObject(
          {
            quantity: "500",
            quantity_unit: "MWH",
          },
        );
      },
    );

    it(
      "reports determination_method NOT_DETERMINED and every calculation-derived field null for an undetermined, uncalculated line -- never a fabricated placeholder",
      async () => {
        const result =
          await buildPeriodExportRows(
            makeMockSupabase(
              {
                shipments: { data: [shipmentRow()], error: null },
                shipment_lines: { data: [lineRow({ emission_determination: null })], error: null },
                latest_calculation_results: { data: [], error: null },
              },
            ),
            orgId,
            annualPeriod,
          );

        expect(result[0]).toMatchObject(
          {
            determination_method: "NOT_DETERMINED",
            dataset_version: null,
            methodology: null,
            resolution_reason: null,
            engine_version: null,
            embedded_emissions_tco2e: null,
            calculated_at: null,
          },
        );
      },
    );

    it(
      "sorts rows by shipment reference then line number",
      async () => {
        const result =
          await buildPeriodExportRows(
            makeMockSupabase(
              {
                shipments: {
                  data: [
                    shipmentRow({ id: "ship-b", reference: "REF-002" }),
                    shipmentRow({ id: "ship-a", reference: "REF-001" }),
                  ],
                  error: null,
                },
                shipment_lines: {
                  data: [
                    lineRow({ id: "line-b2", shipment_id: "ship-b", line_number: 2 }),
                    lineRow({ id: "line-a1", shipment_id: "ship-a", line_number: 1 }),
                    lineRow({ id: "line-b1", shipment_id: "ship-b", line_number: 1 }),
                  ],
                  error: null,
                },
                latest_calculation_results: { data: [], error: null },
              },
            ),
            orgId,
            annualPeriod,
          );

        expect(
          result.map((row) => `${row.shipment_reference}-${row.line_number}`),
        ).toEqual(
          ["REF-001-1", "REF-002-1", "REF-002-2"],
        );
      },
    );

    it(
      "returns an empty array when the period has no shipments",
      async () => {
        const result =
          await buildPeriodExportRows(
            makeMockSupabase(
              {
                shipments: { data: [], error: null },
              },
            ),
            orgId,
            annualPeriod,
          );

        expect(result).toEqual(
          [],
        );
      },
    );
  },
);
