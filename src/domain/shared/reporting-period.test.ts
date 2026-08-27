import {
  describe,
  expect,
  it,
} from "vitest";

import {
  formatReportingPeriod,
  parseIsoDate,
  reportingPeriodForReleaseDate,
} from "./reporting-period.js";

describe(
  "reportingPeriodForReleaseDate",
  () => {
    it(
      "returns ANNUAL for a release date in the definitive regime (2026 onward)",
      () => {
        const period =
          reportingPeriodForReleaseDate(
            parseIsoDateOrThrow(
              "2026-03-15",
            ),
          );

        expect(
          period,
        ).toEqual(
          {
            kind: "ANNUAL",
            year: 2026,
          },
        );
      },
    );

    it(
      "returns ANNUAL for a release date well after 2026",
      () => {
        const period =
          reportingPeriodForReleaseDate(
            parseIsoDateOrThrow(
              "2031-01-01",
            ),
          );

        expect(
          period,
        ).toEqual(
          {
            kind: "ANNUAL",
            year: 2031,
          },
        );
      },
    );

    it(
      "returns QUARTERLY for a release date in the transitional regime (before 2026)",
      () => {
        const period =
          reportingPeriodForReleaseDate(
            parseIsoDateOrThrow(
              "2025-11-20",
            ),
          );

        expect(
          period,
        ).toEqual(
          {
            kind: "QUARTERLY",
            year: 2025,
            quarter: 4,
          },
        );
      },
    );

    it(
      "assigns Q1 for a January transitional release date",
      () => {
        const period =
          reportingPeriodForReleaseDate(
            parseIsoDateOrThrow(
              "2024-01-05",
            ),
          );

        expect(
          period,
        ).toEqual(
          {
            kind: "QUARTERLY",
            year: 2024,
            quarter: 1,
          },
        );
      },
    );
  },
);

describe(
  "formatReportingPeriod",
  () => {
    it(
      "formats an annual period as the bare year",
      () => {
        expect(
          formatReportingPeriod(
            {
              kind: "ANNUAL",
              year: 2026,
            },
          ),
        ).toBe(
          "2026",
        );
      },
    );

    it(
      "formats a quarterly period as YYYY-Qn",
      () => {
        expect(
          formatReportingPeriod(
            {
              kind: "QUARTERLY",
              year: 2025,
              quarter: 4,
            },
          ),
        ).toBe(
          "2025-Q4",
        );
      },
    );

    it(
      "sorts quarterly before annual for the same-ish era via lexical order",
      () => {
        const formatted =
          [
            formatReportingPeriod(
              {
                kind: "QUARTERLY",
                year: 2025,
                quarter: 4,
              },
            ),
            formatReportingPeriod(
              {
                kind: "ANNUAL",
                year: 2026,
              },
            ),
          ].sort();

        expect(
          formatted,
        ).toEqual(
          [
            "2025-Q4",
            "2026",
          ],
        );
      },
    );
  },
);

describe(
  "parseIsoDate",
  () => {
    it(
      "accepts a well-formed date",
      () => {
        const result =
          parseIsoDate(
            "2026-01-01",
          );

        expect(
          result.status,
        ).toBe(
          "OK",
        );
      },
    );

    it(
      "rejects a malformed date string",
      () => {
        const result =
          parseIsoDate(
            "01/01/2026",
          );

        expect(
          result.status,
        ).toBe(
          "INVALID",
        );
      },
    );

    it(
      "rejects a calendar-impossible date",
      () => {
        const result =
          parseIsoDate(
            "2026-02-30",
          );

        expect(
          result.status,
        ).toBe(
          "INVALID",
        );
      },
    );
  },
);

function parseIsoDateOrThrow(
  value: string,
) {
  const result =
    parseIsoDate(
      value,
    );

  if (result.status !== "OK") {
    throw new Error(
      `expected a valid ISO date, got: ${value}`,
    );
  }

  return result.value;
}
