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
                    },
                    {
                      line_id: "line-2" as never,
                      line_number: 1,
                      has_emission_determination: false,
                      has_calculation_result: false,
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
                    },
                    {
                      line_id: "line-2" as never,
                      line_number: 2,
                      has_emission_determination: false,
                      has_calculation_result: false,
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
  },
);
