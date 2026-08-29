import {
  describe,
  expect,
  it,
} from "vitest";

import {
  buildPeriodSummary,
} from "./build-period-summary";

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
      range: () => chain,
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
  "buildPeriodSummary",
  () => {
    it(
      "sums embedded_emissions_tco2e across calculated lines with full Decimal precision, not JS floating point",
      async () => {
        const result =
          await buildPeriodSummary(
            makeMockSupabase(
              {
                shipments: { data: [shipmentRow()], error: null },
                shipment_lines: {
                  data: [
                    lineRow({ id: "line-1", emission_determination: defaultDetermination }),
                    lineRow({ id: "line-2", line_number: 2, emission_determination: defaultDetermination }),
                  ],
                  error: null,
                },
                latest_calculation_results: {
                  data: [
                    { id: "calc-1", line_id: "line-1", engine_version: "1.1.0", embedded_emissions_tco2e: "0.1", steps: [], calculated_at: "2026-02-01T00:00:00Z" },
                    { id: "calc-2", line_id: "line-2", engine_version: "1.1.0", embedded_emissions_tco2e: "0.2", steps: [], calculated_at: "2026-02-01T00:00:00Z" },
                  ],
                  error: null,
                },
              },
            ),
            orgId,
            annualPeriod,
          );

        // 0.1 + 0.2 === 0.30000000000000004 in JS floating point --
        // this assertion fails under naive `+` addition, which is
        // exactly what it's here to catch.
        expect(result.total_embedded_emissions_tco2e).toBe(
          "0.3",
        );

        expect(result.calculated_line_count).toBe(
          2,
        );

        expect(result.line_count).toBe(
          2,
        );

        expect(result.shipment_count).toBe(
          1,
        );
      },
    );

    it(
      "reports total_embedded_emissions_tco2e as null, never a fabricated '0', when no line has been calculated yet",
      async () => {
        const result =
          await buildPeriodSummary(
            makeMockSupabase(
              {
                shipments: { data: [shipmentRow()], error: null },
                shipment_lines: { data: [lineRow()], error: null },
                latest_calculation_results: { data: [], error: null },
              },
            ),
            orgId,
            annualPeriod,
          );

        expect(result.total_embedded_emissions_tco2e).toBeNull();
        expect(result.calculated_line_count).toBe(0);
      },
    );

    it(
      "lists an undetermined line under incomplete_lines with reason NO_DETERMINATION",
      async () => {
        const result =
          await buildPeriodSummary(
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

        expect(result.incomplete_lines).toEqual(
          [
            {
              shipment_id: "ship-1",
              shipment_reference: "REF-001",
              line_id: "line-1",
              line_number: 1,
              cn_code: "72081000",
              reason: "NO_DETERMINATION",
            },
          ],
        );
      },
    );

    it(
      "lists a determined-but-uncalculated line under incomplete_lines with reason NOT_CALCULATED",
      async () => {
        const result =
          await buildPeriodSummary(
            makeMockSupabase(
              {
                shipments: { data: [shipmentRow()], error: null },
                shipment_lines: { data: [lineRow({ emission_determination: defaultDetermination })], error: null },
                latest_calculation_results: { data: [], error: null },
              },
            ),
            orgId,
            annualPeriod,
          );

        expect(result.incomplete_lines[0]?.reason).toBe(
          "NOT_CALCULATED",
        );
      },
    );

    it(
      "breaks down by CN code, origin country, production route, and determination method, with a null bucket total when nothing in the bucket is calculated",
      async () => {
        const result =
          await buildPeriodSummary(
            makeMockSupabase(
              {
                shipments: { data: [shipmentRow()], error: null },
                shipment_lines: {
                  data: [
                    lineRow({ id: "line-1", cn_code: "72081000", origin_country: "DE", emission_determination: defaultDetermination }),
                    lineRow({ id: "line-2", line_number: 2, cn_code: "76011000", origin_country: "CN", emission_determination: null }),
                  ],
                  error: null,
                },
                latest_calculation_results: {
                  data: [
                    { id: "calc-1", line_id: "line-1", engine_version: "1.1.0", embedded_emissions_tco2e: "5", steps: [], calculated_at: "2026-02-01T00:00:00Z" },
                  ],
                  error: null,
                },
              },
            ),
            orgId,
            annualPeriod,
          );

        expect(result.breakdown_by_cn_code).toEqual(
          [
            { key: "72081000", line_count: 1, calculated_line_count: 1, embedded_emissions_tco2e: "5" },
            { key: "76011000", line_count: 1, calculated_line_count: 0, embedded_emissions_tco2e: null },
          ],
        );

        expect(result.breakdown_by_origin_country).toEqual(
          [
            { key: "CN", line_count: 1, calculated_line_count: 0, embedded_emissions_tco2e: null },
            { key: "DE", line_count: 1, calculated_line_count: 1, embedded_emissions_tco2e: "5" },
          ],
        );

        expect(result.breakdown_by_production_route).toEqual(
          [
            { key: "—", line_count: 2, calculated_line_count: 1, embedded_emissions_tco2e: "5" },
          ],
        );

        expect(result.breakdown_by_determination_method).toEqual(
          [
            { key: "DEFAULT", line_count: 1, calculated_line_count: 1, embedded_emissions_tco2e: "5" },
            { key: "NOT_DETERMINED", line_count: 1, calculated_line_count: 0, embedded_emissions_tco2e: null },
          ],
        );
      },
    );

    it(
      "reports shipment_count > 0 with line_count 0 when a shipment in the period has no lines yet",
      async () => {
        const result =
          await buildPeriodSummary(
            makeMockSupabase(
              {
                shipments: { data: [shipmentRow()], error: null },
                shipment_lines: { data: [], error: null },
                latest_calculation_results: { data: [], error: null },
              },
            ),
            orgId,
            annualPeriod,
          );

        expect(result.shipment_count).toBe(1);
        expect(result.line_count).toBe(0);
        expect(result.incomplete_lines).toEqual([]);
      },
    );

    it(
      "reports an all-zero summary, not an error, when the org has no shipments in the period",
      async () => {
        const result =
          await buildPeriodSummary(
            makeMockSupabase(
              {
                shipments: { data: [], error: null },
              },
            ),
            orgId,
            annualPeriod,
          );

        expect(result.shipment_count).toBe(0);
        expect(result.line_count).toBe(0);
        expect(result.total_embedded_emissions_tco2e).toBeNull();
        expect(result.incomplete_lines).toEqual([]);
      },
    );
  },
);
