import {
  describe,
  expect,
  it,
} from "vitest";

import {
  parsePeriodParams,
} from "./parse-period-params";

describe(
  "parsePeriodParams",
  () => {
    it(
      "parses a bare year into an ANNUAL period",
      () => {
        expect(
          parsePeriodParams(
            { year: "2026" },
          ),
        ).toEqual(
          { kind: "ANNUAL", year: 2026 },
        );
      },
    );

    it(
      "parses year+quarter into a QUARTERLY period",
      () => {
        expect(
          parsePeriodParams(
            { year: "2025", quarter: "3" },
          ),
        ).toEqual(
          { kind: "QUARTERLY", year: 2025, quarter: 3 },
        );
      },
    );

    it(
      "returns null when year is missing entirely",
      () => {
        expect(
          parsePeriodParams(
            {},
          ),
        ).toBeNull();
      },
    );

    it(
      "returns null for a non-4-digit year",
      () => {
        expect(
          parsePeriodParams(
            { year: "26" },
          ),
        ).toBeNull();
      },
    );

    it(
      "returns null for a non-numeric year",
      () => {
        expect(
          parsePeriodParams(
            { year: "abcd" },
          ),
        ).toBeNull();
      },
    );

    it(
      "returns null (never silently falling back to ANNUAL) for an out-of-range quarter",
      () => {
        expect(
          parsePeriodParams(
            { year: "2026", quarter: "5" },
          ),
        ).toBeNull();
      },
    );

    it(
      "returns null for a non-integer quarter",
      () => {
        expect(
          parsePeriodParams(
            { year: "2026", quarter: "1.5" },
          ),
        ).toBeNull();
      },
    );

    it(
      "collapses a repeated query key (string[]) to its first value, matching Next's own searchParams shape",
      () => {
        expect(
          parsePeriodParams(
            { year: ["2026", "2027"] },
          ),
        ).toEqual(
          { kind: "ANNUAL", year: 2026 },
        );
      },
    );

    it(
      "treats a blank quarter param the same as an absent one",
      () => {
        expect(
          parsePeriodParams(
            { year: "2026", quarter: "" },
          ),
        ).toEqual(
          { kind: "ANNUAL", year: 2026 },
        );
      },
    );
  },
);
