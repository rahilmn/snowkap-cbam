import {
  describe,
  expect,
  it,
} from "vitest";

import {
  parseCountryCode,
} from "./country";

describe(
  "parseCountryCode",
  () => {
    it(
      "accepts a well-formed ISO 3166-1 alpha-2 code",
      () => {
        const result =
          parseCountryCode(
            "IN",
          );

        expect(
          result,
        ).toEqual(
          {
            status: "OK",
            value: "IN",
          },
        );
      },
    );

    it(
      "rejects a lowercase code",
      () => {
        const result =
          parseCountryCode(
            "in",
          );

        expect(
          result.status,
        ).toBe(
          "INVALID",
        );
      },
    );

    it(
      "rejects a code that is not two letters",
      () => {
        expect(
          parseCountryCode(
            "IND",
          ).status,
        ).toBe(
          "INVALID",
        );

        expect(
          parseCountryCode(
            "I",
          ).status,
        ).toBe(
          "INVALID",
        );
      },
    );

    it(
      "rejects digits",
      () => {
        expect(
          parseCountryCode(
            "I1",
          ).status,
        ).toBe(
          "INVALID",
        );
      },
    );

    it(
      "rejects an empty string",
      () => {
        expect(
          parseCountryCode(
            "",
          ).status,
        ).toBe(
          "INVALID",
        );
      },
    );
  },
);
