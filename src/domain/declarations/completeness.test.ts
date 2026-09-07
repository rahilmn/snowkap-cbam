import {
  describe,
  expect,
  it,
} from "vitest";

import {
  buildCompletenessReport,
  type CompletenessCheckShipment,
} from "./completeness";

const generatedAt =
  "2026-08-29T00:00:00Z" as never;

function readyShipment(
  overrides: Partial<CompletenessCheckShipment> = {},
): CompletenessCheckShipment {
  return {
    shipment_id: "ship-1" as never,
    shipment_reference: "REF-001",
    status: "READY",
    lines: [
      {
        line_id: "line-1" as never,
        line_number: 1,
        has_emission_determination: true,
        has_calculation_result: true,
        calculation_is_current: true,
        calculation_engine_is_current: true,
        dataset_is_current: true,
      },
    ],
    ...overrides,
  };
}

describe(
  "buildCompletenessReport",
  () => {
    it(
      "reports complete: true with zero blockers for a fully-determined, fully-calculated, all-READY period",
      () => {
        const report =
          buildCompletenessReport(
            [readyShipment()],
            generatedAt,
          );

        expect(report).toEqual(
          {
            generated_at: generatedAt,
            shipment_count: 1,
            line_count: 1,
            complete: true,
            blockers: [],
          },
        );
      },
    );

    it(
      "reports NO_SHIPMENTS_IN_PERIOD (a period-level blocker with no shipment_id) when the period has no shipments at all",
      () => {
        const report =
          buildCompletenessReport(
            [],
            generatedAt,
          );

        expect(report.complete).toBe(
          false,
        );

        expect(report.blockers).toEqual(
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
      "reports SHIPMENT_NOT_LOCKABLE for a DRAFT shipment -- named the same way public.record_declaration_filed()'s own SHIPMENTS_NOT_LOCKABLE result_status names it",
      () => {
        const report =
          buildCompletenessReport(
            [
              readyShipment(
                { status: "DRAFT" },
              ),
            ],
            generatedAt,
          );

        expect(report.complete).toBe(
          false,
        );

        expect(report.blockers).toContainEqual(
          {
            reason: "SHIPMENT_NOT_LOCKABLE",
            shipment_id: "ship-1",
            shipment_reference: "REF-001",
          },
        );
      },
    );

    it(
      "accepts a LOCKED shipment (an amendment's already-locked members) as lockable, not a blocker",
      () => {
        const report =
          buildCompletenessReport(
            [
              readyShipment(
                { status: "LOCKED" },
              ),
            ],
            generatedAt,
          );

        expect(report.complete).toBe(
          true,
        );
      },
    );

    it(
      "reports SHIPMENT_HAS_NO_LINES and does not double-count it toward line_count",
      () => {
        const report =
          buildCompletenessReport(
            [
              readyShipment(
                { lines: [] },
              ),
            ],
            generatedAt,
          );

        expect(report.line_count).toBe(
          0,
        );

        expect(report.blockers).toEqual(
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
      "reports LINE_NOT_DETERMINED (and not also LINE_NOT_CALCULATED for the same line -- there is nothing to calculate yet)",
      () => {
        const report =
          buildCompletenessReport(
            [
              readyShipment(
                {
                  lines: [
                    {
                      line_id: "line-1" as never,
                      line_number: 1,
                      has_emission_determination: false,
                      has_calculation_result: false,
                      calculation_is_current: false,
                      calculation_engine_is_current: false,
                      dataset_is_current: true,
                    },
                  ],
                },
              ),
            ],
            generatedAt,
          );

        expect(report.blockers).toEqual(
          [
            {
              reason: "LINE_NOT_DETERMINED",
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
      "reports LINE_NOT_CALCULATED for a determined-but-uncalculated line",
      () => {
        const report =
          buildCompletenessReport(
            [
              readyShipment(
                {
                  lines: [
                    {
                      line_id: "line-1" as never,
                      line_number: 1,
                      has_emission_determination: true,
                      has_calculation_result: false,
                      calculation_is_current: false,
                      calculation_engine_is_current: false,
                      dataset_is_current: true,
                    },
                  ],
                },
              ),
            ],
            generatedAt,
          );

        expect(report.blockers).toEqual(
          [
            {
              reason: "LINE_NOT_CALCULATED",
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
      "sorts blockers by shipment_reference then line_number, deterministically -- not input order",
      () => {
        const report =
          buildCompletenessReport(
            [
              readyShipment(
                {
                  shipment_id: "ship-2" as never,
                  shipment_reference: "REF-002",
                  lines: [
                    {
                      line_id: "line-3" as never,
                      line_number: 2,
                      has_emission_determination: false,
                      has_calculation_result: false,
                      calculation_is_current: false,
                      calculation_engine_is_current: false,
                      dataset_is_current: true,
                    },
                    {
                      line_id: "line-2" as never,
                      line_number: 1,
                      has_emission_determination: false,
                      has_calculation_result: false,
                      calculation_is_current: false,
                      calculation_engine_is_current: false,
                      dataset_is_current: true,
                    },
                  ],
                },
              ),
              readyShipment(
                {
                  lines: [
                    {
                      line_id: "line-1" as never,
                      line_number: 1,
                      has_emission_determination: false,
                      has_calculation_result: false,
                      calculation_is_current: false,
                      calculation_engine_is_current: false,
                      dataset_is_current: true,
                    },
                  ],
                },
              ),
            ],
            generatedAt,
          );

        expect(
          report.blockers.map(
            (blocker) => [blocker.shipment_reference, blocker.line_number],
          ),
        ).toEqual(
          [
            ["REF-001", 1],
            ["REF-002", 1],
            ["REF-002", 2],
          ],
        );
      },
    );

    it(
      "counts line_count across every line regardless of completeness, not just the calculated ones",
      () => {
        const report =
          buildCompletenessReport(
            [
              readyShipment(
                {
                  lines: [
                    {
                      line_id: "line-1" as never,
                      line_number: 1,
                      has_emission_determination: true,
                      has_calculation_result: true,
                      calculation_is_current: true,
                      calculation_engine_is_current: true,
                      dataset_is_current: true,
                    },
                    {
                      line_id: "line-2" as never,
                      line_number: 2,
                      has_emission_determination: false,
                      has_calculation_result: false,
                      calculation_is_current: false,
                      calculation_engine_is_current: false,
                      dataset_is_current: true,
                    },
                  ],
                },
              ),
            ],
            generatedAt,
          );

        expect(report.line_count).toBe(
          2,
        );

        expect(report.complete).toBe(
          false,
        );
      },
    );

    it(
      "reports LINE_CALCULATION_STALE (not LINE_NOT_CALCULATED) for a determined AND calculated line whose calculation is no longer current -- P13 adversarial audit: redetermined without a follow-up recalculation",
      () => {
        const report =
          buildCompletenessReport(
            [
              readyShipment(
                {
                  lines: [
                    {
                      line_id: "line-1" as never,
                      line_number: 1,
                      has_emission_determination: true,
                      has_calculation_result: true,
                      calculation_is_current: false,
                      calculation_engine_is_current: true,
                      dataset_is_current: true,
                    },
                  ],
                },
              ),
            ],
            generatedAt,
          );

        expect(report.complete).toBe(
          false,
        );

        expect(report.blockers).toEqual(
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
      "never reports both LINE_NOT_CALCULATED and LINE_CALCULATION_STALE for the same line -- calculation_is_current is only consulted once has_calculation_result is true",
      () => {
        const report =
          buildCompletenessReport(
            [
              readyShipment(
                {
                  lines: [
                    {
                      line_id: "line-1" as never,
                      line_number: 1,
                      has_emission_determination: true,
                      has_calculation_result: false,
                      // A deliberately inconsistent fixture (no real
                      // caller would set calculation_is_current: false
                      // alongside has_calculation_result: false) --
                      // proves the `else if` short-circuits on
                      // has_calculation_result alone rather than
                      // evaluating calculation_is_current independently.
                      calculation_is_current: false,
                      calculation_engine_is_current: false,
                      dataset_is_current: true,
                    },
                  ],
                },
              ),
            ],
            generatedAt,
          );

        expect(report.blockers).toEqual(
          [
            {
              reason: "LINE_NOT_CALCULATED",
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
      "2026-09-07 (S5 review round 8, finding S5R8-A-B2): reports LINE_CALCULATION_ENGINE_OUTDATED for a determined AND calculated AND current line whose latest calculation was produced by a superseded engine version",
      () => {
        const report =
          buildCompletenessReport(
            [
              readyShipment(
                {
                  lines: [
                    {
                      line_id: "line-1" as never,
                      line_number: 1,
                      has_emission_determination: true,
                      has_calculation_result: true,
                      calculation_is_current: true,
                      calculation_engine_is_current: false,
                      dataset_is_current: true,
                    },
                  ],
                },
              ),
            ],
            generatedAt,
          );

        expect(report.complete).toBe(
          false,
        );

        expect(report.blockers).toEqual(
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
      "2026-09-07 (S5 review round 8, finding S5R8-A-B2): never reports LINE_CALCULATION_ENGINE_OUTDATED for a line already flagged LINE_NOT_CALCULATED or LINE_CALCULATION_STALE -- exactly one blocker per line for the same underlying fact",
      () => {
        const notCalculated =
          buildCompletenessReport(
            [
              readyShipment(
                {
                  lines: [
                    {
                      line_id: "line-1" as never,
                      line_number: 1,
                      has_emission_determination: true,
                      has_calculation_result: false,
                      calculation_is_current: false,
                      // Deliberately inconsistent, same reasoning as the
                      // dataset-superseded test below -- proves
                      // LINE_NOT_CALCULATED short-circuits before
                      // calculation_engine_is_current is ever consulted.
                      calculation_engine_is_current: false,
                      dataset_is_current: false,
                    },
                  ],
                },
              ),
            ],
            generatedAt,
          );

        expect(
          notCalculated.blockers.map((blocker) => blocker.reason),
        ).toEqual(
          ["LINE_NOT_CALCULATED"],
        );

        const calculationStale =
          buildCompletenessReport(
            [
              readyShipment(
                {
                  lines: [
                    {
                      line_id: "line-1" as never,
                      line_number: 1,
                      has_emission_determination: true,
                      has_calculation_result: true,
                      calculation_is_current: false,
                      calculation_engine_is_current: false,
                      dataset_is_current: false,
                    },
                  ],
                },
              ),
            ],
            generatedAt,
          );

        expect(
          calculationStale.blockers.map((blocker) => blocker.reason),
        ).toEqual(
          ["LINE_CALCULATION_STALE"],
        );
      },
    );

    it(
      "2026-09-06 (S5 cross-phase hardening, live-reproduced): reports LINE_DATASET_SUPERSEDED for a determined AND calculated AND current line whose DEFAULT determination names a since-superseded regulatory dataset",
      () => {
        const report =
          buildCompletenessReport(
            [
              readyShipment(
                {
                  lines: [
                    {
                      line_id: "line-1" as never,
                      line_number: 1,
                      has_emission_determination: true,
                      has_calculation_result: true,
                      calculation_is_current: true,
                      calculation_engine_is_current: true,
                      dataset_is_current: false,
                    },
                  ],
                },
              ),
            ],
            generatedAt,
          );

        expect(report.complete).toBe(
          false,
        );

        expect(report.blockers).toEqual(
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
      "never reports LINE_DATASET_SUPERSEDED for a line already flagged LINE_NOT_CALCULATED, LINE_CALCULATION_STALE, or LINE_CALCULATION_ENGINE_OUTDATED -- exactly one blocker per line for the same underlying fact",
      () => {
        const notCalculated =
          buildCompletenessReport(
            [
              readyShipment(
                {
                  lines: [
                    {
                      line_id: "line-1" as never,
                      line_number: 1,
                      has_emission_determination: true,
                      has_calculation_result: false,
                      calculation_is_current: false,
                      // Deliberately inconsistent, same reasoning as the
                      // test above this one -- proves LINE_NOT_CALCULATED
                      // short-circuits before dataset_is_current is ever
                      // consulted.
                      calculation_engine_is_current: false,
                      dataset_is_current: false,
                    },
                  ],
                },
              ),
            ],
            generatedAt,
          );

        expect(
          notCalculated.blockers.map((blocker) => blocker.reason),
        ).toEqual(
          ["LINE_NOT_CALCULATED"],
        );

        const calculationStale =
          buildCompletenessReport(
            [
              readyShipment(
                {
                  lines: [
                    {
                      line_id: "line-1" as never,
                      line_number: 1,
                      has_emission_determination: true,
                      has_calculation_result: true,
                      calculation_is_current: false,
                      calculation_engine_is_current: false,
                      dataset_is_current: false,
                    },
                  ],
                },
              ),
            ],
            generatedAt,
          );

        expect(
          calculationStale.blockers.map((blocker) => blocker.reason),
        ).toEqual(
          ["LINE_CALCULATION_STALE"],
        );

        const engineOutdated =
          buildCompletenessReport(
            [
              readyShipment(
                {
                  lines: [
                    {
                      line_id: "line-1" as never,
                      line_number: 1,
                      has_emission_determination: true,
                      has_calculation_result: true,
                      calculation_is_current: true,
                      calculation_engine_is_current: false,
                      dataset_is_current: false,
                    },
                  ],
                },
              ),
            ],
            generatedAt,
          );

        expect(
          engineOutdated.blockers.map((blocker) => blocker.reason),
        ).toEqual(
          ["LINE_CALCULATION_ENGINE_OUTDATED"],
        );
      },
    );
  },
);
