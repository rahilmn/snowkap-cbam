import {
  describe,
  expect,
  it,
} from "vitest";

import {
  formatTimestamp,
} from "./utils";

describe(
  "formatTimestamp",
  () => {
    it(
      "renders a raw ISO timestamp as a human-readable, locale-formatted date and time",
      () => {
        const rendered =
          formatTimestamp(
            "2026-08-29T14:32:00Z",
          );

        expect(
          rendered,
        ).not.toBe(
          "2026-08-29T14:32:00Z",
        );

        expect(
          rendered,
        ).toContain(
          "2026",
        );

        // en-GB dateStyle:"medium" renders a "29 Aug" style day/month --
        // asserting both confirms this isn't just a bare year, without
        // pinning the exact separator/format Intl produces.
        expect(
          rendered,
        ).toMatch(
          /29/,
        );

        expect(
          rendered,
        ).toMatch(
          /Aug/,
        );
      },
    );

    it(
      "includes a time component, unlike the date-only formatDate helper",
      () => {
        const rendered =
          formatTimestamp(
            "2026-08-29T14:32:00Z",
          );

        expect(
          rendered,
        ).toMatch(
          /\d{1,2}:\d{2}/,
        );
      },
    );
  },
);
