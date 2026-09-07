import {
  describe,
  expect,
  it,
} from "vitest";

import {
  computeDeclarationDraftFacts,
} from "./compute-declaration-draft-facts";

const orgId =
  "org-1" as never;

const annualPeriod =
  { kind: "ANNUAL", year: 2026 } as never;

// listPeriodShipmentLines' own full shipment row shape (SHIPMENT_COLUMNS)
// is a superset of the id/reference/status this function's own
// supplementary query selects -- since the mock below returns the same
// canned array for every `.from("shipments")` call regardless of which
// columns were actually selected, ONE full row satisfies both this
// function's own status query and listPeriodShipmentLines' internal
// one; supplying a second, narrower row for the "same" shipment would
// double it up rather than layer over it.
function fullShipmentRow(
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

const ACTIVE_DATASET_ID =
  "dataset-active-1";

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
    // resolution.dataset_id matches ACTIVE_DATASET_ID below by default
    // -- keeps every pre-existing test's "complete: true" expectation
    // intact now that dataset_is_current (S5) is also checked. A test
    // that wants a SUPERSEDED dataset overrides this to a different id.
    emission_determination: { method: "DEFAULT", resolution: { dataset_id: ACTIVE_DATASET_ID } },
    ...overrides,
  };
}

const calculationRow =
  {
    id: "calc-1",
    line_id: "line-1",
    engine_version: "1.1.0",
    embedded_emissions_tco2e: "12.5",
    steps: [],
    calculated_at: "2026-02-01T00:00:00Z",
    // Matches lineRow()'s own default emission_determination -- keeps
    // this shared fixture pair "current" by default, the same way it
    // was implicitly current before calculation_is_current existed. A
    // test that wants a STALE pairing overrides `determination` on the
    // calculation row (or `emission_determination` on the line row) to
    // deliberately diverge.
    determination: { method: "DEFAULT", resolution: { dataset_id: ACTIVE_DATASET_ID } },
  };

interface ShipmentsOp {
  filters: [string, unknown][];
}

interface Recorder {
  shipmentsOps: ShipmentsOp[];
}

/**
 * Same generic per-table select-only mock as list-period-shipment-lines.test.ts's
 * own makeMockSupabase (this function calls that one internally, plus
 * issues its own supplementary "shipments" status query -- both hit the
 * SAME table, so one canned response per table name is deliberately all
 * this mock needs, unlike manage-sharing-grants.test.ts's cursor-based
 * mock, which exists only for functions that read/write the SAME table
 * more than once with DIFFERENT expected responses).
 *
 * Records every filter applied to a "shipments" query (both this
 * function's own supplementary status query AND listPeriodShipmentLines'
 * internal one land here, since both hit the same table name) -- same
 * `[col, val][]`-per-select recording shape as
 * list-period-shipment-lines.test.ts's own Recorder, used below to
 * assert VOID is excluded from BOTH of them, not just recomputed to look
 * that way by accident of canned data.
 */
function makeMockSupabase(
  tables: Record<string, { data: unknown; error: unknown }>,
  recorder: Recorder = { shipmentsOps: [] },
  // 2026-09-07 (S5 review round 8, finding S5R8-A-B2). Defaults to
  // "1.1.0" -- matching calculationRow's own default engine_version
  // above -- so every pre-existing test's "complete: true" expectation
  // stays intact without each one having to know about this new RPC
  // call, the identical reasoning `tables`' own regulatory_datasets
  // default already uses for ACTIVE_DATASET_ID. A test that wants an
  // OUTDATED engine version passes its own override.
  currentEngineVersionResult: { data: unknown; error: unknown } = { data: "1.1.0", error: null },
) {
  function builder(
    table: string,
  ) {
    const filters: [string, unknown][] =
      [];

    const chain: Record<string, unknown> = {
      select: () => {
        if (table === "shipments") {
          recorder.shipmentsOps.push({ filters });
        }

        return chain;
      },
      eq: (col: string, val: unknown) => {
        filters.push([col, val]);
        return chain;
      },
      neq: (col: string, val: unknown) => {
        filters.push([col, val]);
        return chain;
      },
      in: () => chain,
      is: (col: string, val: unknown) => {
        filters.push([col, val]);
        return chain;
      },
      order: () => chain,
      range: () => chain,
      then: (
        resolve: (value: { data: unknown; error: unknown }) => unknown,
        reject: (reason: unknown) => unknown,
      ) =>
        Promise.resolve(
          tables[table] ??
            // 2026-09-06 (S5 cross-phase hardening). Defaults
            // regulatory_datasets to "the one dataset every DEFAULT
            // fixture's own resolution.dataset_id names, currently
            // ACTIVE" -- keeps every pre-existing test's own "complete:
            // true" expectation intact without each having to know
            // about this new query. A test that wants a SUPERSEDED
            // dataset passes its own `regulatory_datasets` entry.
            (table === "regulatory_datasets"
              ? { data: [{ id: ACTIVE_DATASET_ID }], error: null }
              : { data: null, error: null }),
        ).then(resolve, reject),
    };

    return chain;
  }

  return {
    from: (table: string) => builder(table),
    rpc: (name: string) =>
      name === "current_engine_version"
        ? Promise.resolve(currentEngineVersionResult)
        : Promise.resolve({ data: null, error: null }),
  } as never;
}

describe(
  "computeDeclarationDraftFacts",
  () => {
    it(
      "includes every shipment in the period as a member, complete: true when every line is determined and calculated",
      async () => {
        const facts =
          await computeDeclarationDraftFacts(
            makeMockSupabase(
              {
                shipments: { data: [fullShipmentRow()], error: null },
                shipment_lines: { data: [lineRow()], error: null },
                latest_calculation_results: { data: [calculationRow], error: null },
              },
            ),
            orgId,
            annualPeriod,
          );

        expect(facts.member_shipment_ids).toEqual(
          ["ship-1"],
        );

        expect(facts.completeness_report.complete).toBe(
          true,
        );

        expect(facts.completeness_report.blockers).toEqual(
          [],
        );
      },
    );

    it(
      "flags a shipment with zero lines as SHIPMENT_HAS_NO_LINES while still counting it as a member",
      async () => {
        const facts =
          await computeDeclarationDraftFacts(
            makeMockSupabase(
              {
                shipments: { data: [fullShipmentRow()], error: null },
                shipment_lines: { data: [], error: null },
                latest_calculation_results: { data: [], error: null },
              },
            ),
            orgId,
            annualPeriod,
          );

        expect(facts.member_shipment_ids).toEqual(
          ["ship-1"],
        );

        expect(facts.completeness_report.complete).toBe(
          false,
        );

        expect(facts.completeness_report.blockers).toEqual(
          [
            {
              reason: "SHIPMENT_HAS_NO_LINES",
              shipment_id: "ship-1",
              shipment_reference: "REF-001",
            },
          ],
        );
      },
    );

    it(
      "flags a DRAFT shipment as SHIPMENT_NOT_LOCKABLE even though it has a complete, calculated line",
      async () => {
        const facts =
          await computeDeclarationDraftFacts(
            makeMockSupabase(
              {
                shipments: {
                  data: [
                    fullShipmentRow({ status: "DRAFT" }),
                  ],
                  error: null,
                },
                shipment_lines: { data: [lineRow()], error: null },
                latest_calculation_results: { data: [calculationRow], error: null },
              },
            ),
            orgId,
            annualPeriod,
          );

        expect(facts.completeness_report.blockers).toContainEqual(
          {
            reason: "SHIPMENT_NOT_LOCKABLE",
            shipment_id: "ship-1",
            shipment_reference: "REF-001",
          },
        );
      },
    );

    it(
      "excludes VOID from every shipments query it issues -- a retired shipment can never re-enter the member set or permanently deadlock the period's completeness",
      async () => {
        const recorder: Recorder =
          { shipmentsOps: [] };

        await computeDeclarationDraftFacts(
          makeMockSupabase(
            {
              shipments: { data: [], error: null },
            },
            recorder,
          ),
          orgId,
          annualPeriod,
        );

        // Both the supplementary status query this function issues
        // itself AND listPeriodShipmentLines' own internal query must
        // exclude VOID -- a status recomputed correctly in only one of
        // the two would still let a VOID shipment's lines leak into
        // linesByShipmentId even if it dropped out of member_shipment_ids
        // (or vice versa).
        expect(recorder.shipmentsOps.length).toBeGreaterThanOrEqual(
          2,
        );

        for (const op of recorder.shipmentsOps) {
          expect(op.filters).toContainEqual(
            ["status", "VOID"],
          );
        }
      },
    );

    it(
      "returns an empty member set and NO_SHIPMENTS_IN_PERIOD when the org has no shipments in the period",
      async () => {
        const facts =
          await computeDeclarationDraftFacts(
            makeMockSupabase(
              {
                shipments: { data: [], error: null },
              },
            ),
            orgId,
            annualPeriod,
          );

        expect(facts.member_shipment_ids).toEqual(
          [],
        );

        expect(facts.completeness_report.blockers).toEqual(
          [
            {
              reason: "NO_SHIPMENTS_IN_PERIOD",
              shipment_id: null,
              shipment_reference: null,
            },
          ],
        );
      },
    );

    it(
      "flags LINE_CALCULATION_STALE -- not LINE_NOT_CALCULATED, and not complete -- when a line's latest calculation was computed against a determination the line no longer carries (P13 adversarial audit: redetermined without a follow-up recalculation)",
      async () => {
        const facts =
          await computeDeclarationDraftFacts(
            makeMockSupabase(
              {
                shipments: { data: [fullShipmentRow()], error: null },
                shipment_lines: {
                  data: [
                    lineRow(
                      {
                        emission_determination: {
                          method: "DEFAULT",
                          resolution: {
                            dataset_version: "2026.2",
                            reason: "OTHER_COUNTRIES_FALLBACK",
                          },
                        },
                      },
                    ),
                  ],
                  error: null,
                },
                latest_calculation_results: {
                  data: [
                    {
                      ...calculationRow,
                      // The calculation's own frozen determination --
                      // a genuinely DIFFERENT value than the line's
                      // current one above, same as an unrecalculated
                      // redetermine leaves behind live.
                      determination: {
                        method: "DEFAULT",
                        resolution: {
                          dataset_version: "2026.1",
                          reason: "EXACT_TRADE_CODE_MATCH",
                        },
                      },
                    },
                  ],
                  error: null,
                },
              },
            ),
            orgId,
            annualPeriod,
          );

        expect(facts.completeness_report.complete).toBe(
          false,
        );

        expect(facts.completeness_report.blockers).toEqual(
          [
            {
              reason: "LINE_CALCULATION_STALE",
              shipment_id: "ship-1",
              shipment_reference: "REF-001",
              line_id: "line-1",
              line_number: 1,
            },
          ],
        );
      },
    );

    it(
      "does not flag LINE_CALCULATION_STALE when the two determinations are structurally identical but their jsonb keys came back in a different order",
      async () => {
        const facts =
          await computeDeclarationDraftFacts(
            makeMockSupabase(
              {
                shipments: { data: [fullShipmentRow()], error: null },
                shipment_lines: {
                  data: [
                    lineRow(
                      {
                        emission_determination: {
                          method: "DEFAULT",
                          resolution: { reason: "EXACT_TRADE_CODE_MATCH", dataset_version: "2026.1", dataset_id: ACTIVE_DATASET_ID },
                        },
                      },
                    ),
                  ],
                  error: null,
                },
                latest_calculation_results: {
                  data: [
                    {
                      ...calculationRow,
                      determination: {
                        resolution: { dataset_version: "2026.1", reason: "EXACT_TRADE_CODE_MATCH", dataset_id: ACTIVE_DATASET_ID },
                        method: "DEFAULT",
                      },
                    },
                  ],
                  error: null,
                },
              },
            ),
            orgId,
            annualPeriod,
          );

        expect(facts.completeness_report.complete).toBe(
          true,
        );

        expect(facts.completeness_report.blockers).toEqual(
          [],
        );
      },
    );

    it(
      "2026-09-06 (S5 review remediation, finding S5B-1): THROWS on a shipments fetch error -- never a fabricated empty-but-successful result. The old fail-closed {member_shipment_ids: [], NO_SHIPMENTS_IN_PERIOD} shape was WRITTEN by generateOrRefreshDeclarationDraft as if it were an observed fact and audited as a successful refresh -- indistinguishable from a genuinely empty period.",
      async () => {
        await expect(
          computeDeclarationDraftFacts(
            makeMockSupabase(
              {
                shipments: { data: null, error: { message: "denied" } },
              },
            ),
            orgId,
            annualPeriod,
          ),
        ).rejects.toThrow(
          "denied",
        );
      },
    );

    it(
      "2026-09-06 (S5 cross-phase hardening, live-reproduced): reports LINE_DATASET_SUPERSEDED for a DEFAULT-determined, calculated, current line whose resolution.dataset_id is no longer the ACTIVE regulatory_datasets row",
      async () => {
        const facts =
          await computeDeclarationDraftFacts(
            makeMockSupabase(
              {
                shipments: { data: [fullShipmentRow()], error: null },
                shipment_lines: {
                  data: [
                    lineRow(
                      {
                        emission_determination: {
                          method: "DEFAULT",
                          resolution: { dataset_id: "dataset-superseded-1" },
                        },
                      },
                    ),
                  ],
                  error: null,
                },
                latest_calculation_results: {
                  data: [
                    {
                      ...calculationRow,
                      determination: {
                        method: "DEFAULT",
                        resolution: { dataset_id: "dataset-superseded-1" },
                      },
                    },
                  ],
                  error: null,
                },
                // ACTIVE_DATASET_ID is deliberately NOT this line's own
                // dataset_id -- a different, currently-active dataset
                // now exists for the same dataset_type.
                regulatory_datasets: { data: [{ id: ACTIVE_DATASET_ID }], error: null },
              },
            ),
            orgId,
            annualPeriod,
          );

        expect(facts.completeness_report.complete).toBe(
          false,
        );

        expect(facts.completeness_report.blockers).toEqual(
          [
            {
              reason: "LINE_DATASET_SUPERSEDED",
              shipment_id: "ship-1",
              shipment_reference: "REF-001",
              line_id: "line-1",
              line_number: 1,
            },
          ],
        );
      },
    );

    it(
      "2026-09-06 (S5 review remediation, finding A1): a legacy-shape DEFAULT determination with no `resolution` object at all does not throw -- it fails safe to LINE_DATASET_SUPERSEDED rather than crashing the whole declaration workflow",
      async () => {
        const facts =
          await computeDeclarationDraftFacts(
            makeMockSupabase(
              {
                shipments: { data: [fullShipmentRow()], error: null },
                shipment_lines: {
                  data: [
                    lineRow(
                      {
                        emission_determination: {
                          method: "DEFAULT",
                          resolved_value_id: null,
                        } as never,
                      },
                    ),
                  ],
                  error: null,
                },
                latest_calculation_results: {
                  data: [
                    {
                      ...calculationRow,
                      determination: {
                        method: "DEFAULT",
                        resolved_value_id: null,
                      } as never,
                    },
                  ],
                  error: null,
                },
                regulatory_datasets: { data: [{ id: ACTIVE_DATASET_ID }], error: null },
              },
            ),
            orgId,
            annualPeriod,
          );

        expect(facts.completeness_report.complete).toBe(
          false,
        );

        expect(facts.completeness_report.blockers).toEqual(
          [
            {
              reason: "LINE_DATASET_SUPERSEDED",
              shipment_id: "ship-1",
              shipment_reference: "REF-001",
              line_id: "line-1",
              line_number: 1,
            },
          ],
        );
      },
    );

    it(
      "never flags LINE_DATASET_SUPERSEDED for an ACTUAL determination -- no regulatory dataset is resolved for one",
      async () => {
        const facts =
          await computeDeclarationDraftFacts(
            makeMockSupabase(
              {
                shipments: { data: [fullShipmentRow()], error: null },
                shipment_lines: {
                  data: [
                    lineRow(
                      {
                        emission_determination: {
                          method: "ACTUAL",
                          snapshot: { emission_data_id: "ed-1" },
                        },
                      },
                    ),
                  ],
                  error: null,
                },
                latest_calculation_results: {
                  data: [
                    {
                      ...calculationRow,
                      determination: {
                        method: "ACTUAL",
                        snapshot: { emission_data_id: "ed-1" },
                      },
                    },
                  ],
                  error: null,
                },
                // No ACTIVE regulatory_datasets rows at all -- would
                // flag every DEFAULT line if this were one, but it must
                // never affect an ACTUAL determination.
                regulatory_datasets: { data: [], error: null },
              },
            ),
            orgId,
            annualPeriod,
          );

        expect(facts.completeness_report.complete).toBe(
          true,
        );

        expect(facts.completeness_report.blockers).toEqual(
          [],
        );
      },
    );

    it(
      "throws on a genuine regulatory_datasets fetch error -- never silently treats every DEFAULT line as current (or as superseded) without a real answer",
      async () => {
        await expect(
          computeDeclarationDraftFacts(
            makeMockSupabase(
              {
                shipments: { data: [fullShipmentRow()], error: null },
                shipment_lines: { data: [lineRow()], error: null },
                regulatory_datasets: { data: null, error: { message: "boom" } },
              },
            ),
            orgId,
            annualPeriod,
          ),
        ).rejects.toThrow(
          "boom",
        );
      },
    );

    it(
      "2026-09-07 (S5 review round 8, finding S5R8-A-B2, live-reproduced end to end through the real record_declaration_filed() RPC): reports LINE_CALCULATION_ENGINE_OUTDATED for a determined, calculated, current line whose latest calculation was produced by a superseded engine version",
      async () => {
        const facts =
          await computeDeclarationDraftFacts(
            makeMockSupabase(
              {
                shipments: { data: [fullShipmentRow()], error: null },
                shipment_lines: { data: [lineRow()], error: null },
                latest_calculation_results: {
                  data: [
                    { ...calculationRow, engine_version: "0.0.1" },
                  ],
                  error: null,
                },
                regulatory_datasets: { data: [{ id: ACTIVE_DATASET_ID }], error: null },
              },
              undefined,
              // The live app.engine_version is "1.4.0" as of this
              // migration -- "1.1.0" (deliberately distinct from both)
              // isolates this test to the engine-version axis alone,
              // matching this finding's own live psql reproduction.
              { data: "1.4.0", error: null },
            ),
            orgId,
            annualPeriod,
          );

        expect(facts.completeness_report.complete).toBe(
          false,
        );

        expect(facts.completeness_report.blockers).toEqual(
          [
            {
              reason: "LINE_CALCULATION_ENGINE_OUTDATED",
              shipment_id: "ship-1",
              shipment_reference: "REF-001",
              line_id: "line-1",
              line_number: 1,
            },
          ],
        );
      },
    );

    it(
      "2026-09-07 (S5 review round 8, finding S5R8-A-B2): never flags LINE_CALCULATION_ENGINE_OUTDATED for a line with no calculation result at all -- LINE_NOT_CALCULATED already covers that case",
      async () => {
        const facts =
          await computeDeclarationDraftFacts(
            makeMockSupabase(
              {
                shipments: { data: [fullShipmentRow()], error: null },
                shipment_lines: { data: [lineRow()], error: null },
                regulatory_datasets: { data: [{ id: ACTIVE_DATASET_ID }], error: null },
              },
            ),
            orgId,
            annualPeriod,
          );

        expect(
          facts.completeness_report.blockers.map((blocker) => blocker.reason),
        ).toEqual(
          ["LINE_NOT_CALCULATED"],
        );
      },
    );

    it(
      "throws on a genuine current_engine_version fetch error -- never silently treats every line's calculation as current (or as outdated) without a real answer",
      async () => {
        await expect(
          computeDeclarationDraftFacts(
            makeMockSupabase(
              {
                shipments: { data: [fullShipmentRow()], error: null },
                shipment_lines: { data: [lineRow()], error: null },
                latest_calculation_results: { data: [calculationRow], error: null },
                regulatory_datasets: { data: [{ id: ACTIVE_DATASET_ID }], error: null },
              },
              undefined,
              { data: null, error: { message: "boom" } },
            ),
            orgId,
            annualPeriod,
          ),
        ).rejects.toThrow(
          "boom",
        );
      },
    );
  },
);
