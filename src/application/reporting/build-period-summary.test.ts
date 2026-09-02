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

// 2026-09-03 (P14, fixture hygiene). This was an impossible shape:
// reason "MATCHED" is not a member of ResolutionReason at all, and a
// country mapped to "Germany" cannot resolve through this dataset,
// which holds no German rows. A fixture that could never exist proves
// nothing about code that only ever sees shapes that can -- and this
// one hid something real: the calculation fixtures below carried no
// `determination` either, which is what an actual calculation_results
// row freezes and what the staleness comparison reads.
//
// Replaced with a real row from the ACTIVE 2026-definitive-corrected
// dataset: China, CN8 2523 21 00 (white Portland cement), sheet
// "China", row 7, 1.250 direct / 0.140 indirect / 1.390 total,
// EXACT_CN8_MATCH -- the row production's SNOWKAP IMP-TEST-001
// genuinely resolved through.
const defaultDetermination =
  {
    method: "DEFAULT",
    resolution: {
      dataset_id: "dataset-1",
      dataset_version: "2026-definitive-corrected",
      resolved_at: "2026-01-01T00:00:00.000Z",
      reason: "EXACT_CN8_MATCH",
      country_mapping: { status: "MAPPED", regulatory_country_name: "China" },
      record_identity: {
        source_sheet: "China",
        source_row: 7,
        source_trade_code: "2523 21 00",
        origin_country_name: "China",
        source_production_route_code: null,
      },
      values: {
        direct: { status: "AVAILABLE", value: "1.250" },
        indirect: { status: "AVAILABLE", value: "0.140" },
        total: { status: "AVAILABLE", value: "1.390" },
      },
      emission_unit: "TCO2E_PER_TONNE",
      trace: [{ step: "EXACT_CN8_MATCH", outcome: "RESOLVED" }],
    },
  };

// A different, equally real determination -- China CN8 2523 29 00,
// sheet "China", row 8 -- for the staleness cases: a line redetermined
// to this after being calculated against the one above.
const supersedingDetermination =
  {
    method: "DEFAULT",
    resolution: {
      ...defaultDetermination.resolution,
      resolved_at: "2026-03-01T00:00:00.000Z",
      record_identity: {
        source_sheet: "China",
        source_row: 8,
        source_trade_code: "2523 29 00",
        origin_country_name: "China",
        source_production_route_code: null,
      },
      values: {
        direct: { status: "AVAILABLE", value: "1.300" },
        indirect: { status: "AVAILABLE", value: "0.140" },
        total: { status: "AVAILABLE", value: "1.440" },
      },
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
    // Matches defaultDetermination's own real record. A line declaring
    // one classification while carrying a determination resolved for
    // another is a shape the v10 validator rejects outright, so a
    // fixture must not pair them.
    cn_code: "25232100",
    cn_code_level: "CN8",
    goods_description: null,
    origin_country: "CN",
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
                    { id: "calc-1", line_id: "line-1", engine_version: "1.1.0", embedded_emissions_tco2e: "0.1", steps: [], calculated_at: "2026-02-01T00:00:00Z", determination: defaultDetermination },
                    { id: "calc-2", line_id: "line-2", engine_version: "1.1.0", embedded_emissions_tco2e: "0.2", steps: [], calculated_at: "2026-02-01T00:00:00Z", determination: defaultDetermination },
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
              cn_code: "25232100",
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
                    lineRow({ id: "line-1", cn_code: "25232100", origin_country: "CN", emission_determination: defaultDetermination }),
                    lineRow({ id: "line-2", line_number: 2, cn_code: "76011000", origin_country: "DE", emission_determination: null }),
                  ],
                  error: null,
                },
                latest_calculation_results: {
                  data: [
                    { id: "calc-1", line_id: "line-1", engine_version: "1.1.0", embedded_emissions_tco2e: "5", steps: [], calculated_at: "2026-02-01T00:00:00Z", determination: defaultDetermination },
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
            { key: "25232100", line_count: 1, calculated_line_count: 1, embedded_emissions_tco2e: "5" },
            { key: "76011000", line_count: 1, calculated_line_count: 0, embedded_emissions_tco2e: null },
          ],
        );

        expect(result.breakdown_by_origin_country).toEqual(
          [
            { key: "CN", line_count: 1, calculated_line_count: 1, embedded_emissions_tco2e: "5" },
            { key: "DE", line_count: 1, calculated_line_count: 0, embedded_emissions_tco2e: null },
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

    it(
      "keeps a STALE calculation's figure out of the total, and lists the line as incomplete (P14)",
      async () => {
        /**
         * The defect this closes.
         *
         * checkCalculationCurrency existed and was used on the shipment
         * detail screen, but nothing under src/application/reporting/**
         * ever called it. So a line redetermined after being calculated
         * -- exactly what the "Stale -- newer data available" badge
         * prompts an importer into -- contributed its SUPERSEDED figure
         * to the period KPI, to every breakdown, and to both exports.
         *
         * That is not merely an out-of-date number. It is a number the
         * product refuses to let anyone file: record_declaration_filed
         * treats this state as INCOMPLETE and buildCompletenessReport
         * blocks READY on it. A report and a declaration silently
         * disagreeing about the same period is worse than either being
         * wrong alone.
         */
        const result =
          await buildPeriodSummary(
            makeMockSupabase(
              {
                shipments: { data: [shipmentRow()], error: null },
                shipment_lines: {
                  data: [
                    // Calculated, then redetermined. The line now
                    // carries a determination the calculation never saw.
                    lineRow(
                      {
                        id: "line-1",
                        emission_determination: supersedingDetermination,
                      },
                    ),
                    lineRow(
                      {
                        id: "line-2",
                        line_number: 2,
                        emission_determination: defaultDetermination,
                      },
                    ),
                  ],
                  error: null,
                },
                latest_calculation_results: {
                  data: [
                    {
                      id: "calc-1",
                      line_id: "line-1",
                      engine_version: "1.1.0",
                      embedded_emissions_tco2e: "13.9",
                      steps: [],
                      calculated_at: "2026-02-01T00:00:00Z",
                      determination: defaultDetermination,
                    },
                    {
                      id: "calc-2",
                      line_id: "line-2",
                      engine_version: "1.1.0",
                      embedded_emissions_tco2e: "0.2",
                      steps: [],
                      calculated_at: "2026-02-01T00:00:00Z",
                      determination: defaultDetermination,
                    },
                  ],
                  error: null,
                },
              },
            ),
            orgId,
            annualPeriod,
          );

        // 13.9 is NOT in the total. Only line-2's 0.2 is.
        expect(result.total_embedded_emissions_tco2e).toBe(
          "0.2",
        );

        expect(result.calculated_line_count).toBe(
          1,
        );

        expect(result.line_count).toBe(
          2,
        );

        // And it is named, not silently dropped -- an importer has to
        // be able to see WHICH line is holding the period back.
        expect(result.incomplete_lines).toEqual(
          [
            expect.objectContaining(
              {
                line_id: "line-1",
                reason: "CALCULATION_STALE",
              },
            ),
          ],
        );
      },
    );

    it(
      "excludes a STALE calculation from every breakdown too, not only the headline total (P14)",
      async () => {
        // A figure kept out of the total but left in a breakdown would
        // produce buckets that do not sum to the total -- a report that
        // contradicts itself on its own screen.
        const result =
          await buildPeriodSummary(
            makeMockSupabase(
              {
                shipments: { data: [shipmentRow()], error: null },
                shipment_lines: {
                  data: [
                    lineRow(
                      {
                        id: "line-1",
                        cn_code: "25232100",
                        origin_country: "CN",
                        emission_determination: supersedingDetermination,
                      },
                    ),
                  ],
                  error: null,
                },
                latest_calculation_results: {
                  data: [
                    {
                      id: "calc-1",
                      line_id: "line-1",
                      engine_version: "1.1.0",
                      embedded_emissions_tco2e: "13.9",
                      steps: [],
                      calculated_at: "2026-02-01T00:00:00Z",
                      determination: defaultDetermination,
                    },
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
            {
              key: "25232100",
              line_count: 1,
              calculated_line_count: 0,
              embedded_emissions_tco2e: null,
            },
          ],
        );

        expect(result.total_embedded_emissions_tco2e).toBeNull();
      },
    );

    it(
      "still counts a line whose calculation IS current (P14)",
      async () => {
        // The other half. A staleness check that never passes is
        // indistinguishable from one that excludes everything.
        const result =
          await buildPeriodSummary(
            makeMockSupabase(
              {
                shipments: { data: [shipmentRow()], error: null },
                shipment_lines: {
                  data: [
                    lineRow(
                      {
                        id: "line-1",
                        emission_determination: defaultDetermination,
                      },
                    ),
                  ],
                  error: null,
                },
                latest_calculation_results: {
                  data: [
                    {
                      id: "calc-1",
                      line_id: "line-1",
                      engine_version: "1.1.0",
                      embedded_emissions_tco2e: "13.9",
                      steps: [],
                      calculated_at: "2026-02-01T00:00:00Z",
                      determination: defaultDetermination,
                    },
                  ],
                  error: null,
                },
              },
            ),
            orgId,
            annualPeriod,
          );

        expect(result.total_embedded_emissions_tco2e).toBe(
          "13.9",
        );

        expect(result.calculated_line_count).toBe(
          1,
        );

        expect(result.incomplete_lines).toEqual(
          [],
        );
      },
    );
  },
);
