import {
  describe,
  expect,
  it,
} from "vitest";

import {
  verifierReportBadgeFor,
} from "./verifier-report-badges";

describe(
  "verifierReportBadgeFor",
  () => {
    it(
      "returns DECLARED when the operator has declared a verifier report exists",
      () => {
        expect(
          verifierReportBadgeFor(
            true,
          ),
        ).toBe(
          "verifier_report.DECLARED",
        );
      },
    );

    it(
      "returns NOT_DECLARED when no verifier report has been declared",
      () => {
        expect(
          verifierReportBadgeFor(
            false,
          ),
        ).toBe(
          "verifier_report.NOT_DECLARED",
        );
      },
    );
  },
);
