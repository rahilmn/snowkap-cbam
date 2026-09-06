import {
  describe,
  expect,
  it,
} from "vitest";

import {
  sumShipmentEmissions,
} from "./sum-shipment-emissions";

import type {
  DecimalString,
} from "../shared/decimal";

describe(
  "sumShipmentEmissions",
  () => {
    it(
      "returns NONE when the shipment has no lines at all",
      () => {
        expect(
          sumShipmentEmissions(
            [],
            0,
          ),
        ).toEqual(
          { status: "NONE", staleLineCount: 0 },
        );
      },
    );

    it(
      "returns NONE when lines exist but none has been calculated yet -- never a misleading 0",
      () => {
        expect(
          sumShipmentEmissions(
            [],
            3,
          ),
        ).toEqual(
          { status: "NONE", staleLineCount: 0 },
        );
      },
    );

    it(
      "2026-09-07 (S5 review round 5, finding S5R5-A-1): carries a nonzero staleLineCount even under NONE, when every line is simultaneously stale",
      () => {
        expect(
          sumShipmentEmissions(
            [],
            1,
            1,
          ),
        ).toEqual(
          { status: "NONE", staleLineCount: 1 },
        );
      },
    );

    it(
      "returns COMPLETE with the exact decimal sum when every line is calculated",
      () => {
        expect(
          sumShipmentEmissions(
            ["1.1" as DecimalString, "2.2" as DecimalString],
            2,
          ),
        ).toEqual(
          {
            status: "COMPLETE",
            total_tco2e: "3.3",
            totalLineCount: 2,
          },
        );
      },
    );

    it(
      "uses decimal.js arithmetic, not floating point -- 1.1 + 2.2 is exactly 3.3, not 3.3000000000000003",
      () => {
        const result =
          sumShipmentEmissions(
            ["0.1" as DecimalString, "0.2" as DecimalString],
            2,
          );

        expect(result.status === "COMPLETE" ? result.total_tco2e : null).toBe(
          "0.3",
        );
      },
    );

    it(
      "returns PARTIAL with a calculated/total line count when only some lines are calculated",
      () => {
        expect(
          sumShipmentEmissions(
            ["10.5" as DecimalString],
            3,
          ),
        ).toEqual(
          {
            status: "PARTIAL",
            total_tco2e: "10.5",
            calculatedLineCount: 1,
            totalLineCount: 3,
            staleLineCount: 0,
          },
        );
      },
    );

    it(
      "2026-09-07 (S5 review round 4, finding S5R4-VOCAB-2): carries a distinct staleLineCount, separate from the never-calculated count",
      () => {
        expect(
          sumShipmentEmissions(
            ["10.5" as DecimalString],
            3,
            1,
          ),
        ).toEqual(
          {
            status: "PARTIAL",
            total_tco2e: "10.5",
            calculatedLineCount: 1,
            totalLineCount: 3,
            staleLineCount: 1,
          },
        );
      },
    );

    it(
      "sums three or more lines correctly",
      () => {
        const result =
          sumShipmentEmissions(
            ["1", "2", "3"] as DecimalString[],
            3,
          );

        expect(result).toEqual(
          {
            status: "COMPLETE",
            total_tco2e: "6",
            totalLineCount: 3,
          },
        );
      },
    );
  },
);
