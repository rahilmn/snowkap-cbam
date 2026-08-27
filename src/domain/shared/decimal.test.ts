import {
  describe,
  expect,
  it,
} from "vitest";

import {
  parseDecimalString,
  toDecimal,
  toDecimalString,
} from "./decimal";

describe(
  "parseDecimalString",
  () => {
    it(
      "accepts a plain integer string",
      () => {
        const result =
          parseDecimalString(
            "42",
          );

        expect(
          result.status,
        ).toBe(
          "OK",
        );

        if (result.status === "OK") {
          expect(
            result.value,
          ).toBe(
            "42",
          );
        }
      },
    );

    it(
      "accepts a decimal string with many fractional digits",
      () => {
        const result =
          parseDecimalString(
            "0.123456789012345",
          );

        expect(
          result.status,
        ).toBe(
          "OK",
        );

        if (result.status === "OK") {
          expect(
            result.value,
          ).toBe(
            "0.123456789012345",
          );
        }
      },
    );

    it(
      "accepts a negative decimal string",
      () => {
        const result =
          parseDecimalString(
            "-3.5",
          );

        expect(
          result.status,
        ).toBe(
          "OK",
        );
      },
    );

    it(
      "rejects an empty string",
      () => {
        const result =
          parseDecimalString(
            "",
          );

        expect(
          result,
        ).toEqual(
          {
            status: "INVALID",
            reason: "EMPTY",
          },
        );
      },
    );

    it(
      "rejects a string that is only whitespace",
      () => {
        const result =
          parseDecimalString(
            "   ",
          );

        expect(
          result,
        ).toEqual(
          {
            status: "INVALID",
            reason: "EMPTY",
          },
        );
      },
    );

    it(
      "rejects non-numeric text",
      () => {
        const result =
          parseDecimalString(
            "not a number",
          );

        expect(
          result,
        ).toEqual(
          {
            status: "INVALID",
            reason: "NOT_NUMERIC",
          },
        );
      },
    );

    it(
      "rejects Infinity",
      () => {
        const result =
          parseDecimalString(
            "Infinity",
          );

        expect(
          result,
        ).toEqual(
          {
            status: "INVALID",
            reason: "NOT_FINITE",
          },
        );
      },
    );

    it(
      "rejects NaN",
      () => {
        const result =
          parseDecimalString(
            "NaN",
          );

        expect(
          result,
        ).toEqual(
          {
            status: "INVALID",
            reason: "NOT_FINITE",
          },
        );
      },
    );
  },
);

describe(
  "toDecimal / toDecimalString round trip",
  () => {
    it(
      "round-trips a decimal value without losing precision",
      () => {
        const parsed =
          parseDecimalString(
            "0.100000000000000000001",
          );

        expect(
          parsed.status,
        ).toBe(
          "OK",
        );

        if (parsed.status !== "OK") {
          throw new Error(
            "expected OK",
          );
        }

        const decimal =
          toDecimal(
            parsed.value,
          );

        expect(
          toDecimalString(
            decimal,
          ),
        ).toBe(
          "0.100000000000000000001",
        );
      },
    );

    it(
      "arithmetic through the module-local Decimal does not use JS float precision",
      () => {
        const a =
          toDecimal(
            parseDecimalStringOrThrow(
              "0.1",
            ),
          );

        const b =
          toDecimal(
            parseDecimalStringOrThrow(
              "0.2",
            ),
          );

        // 0.1 + 0.2 === 0.30000000000000004 in native JS floating point.
        expect(
          toDecimalString(
            a.plus(
              b,
            ),
          ),
        ).toBe(
          "0.3",
        );
      },
    );
  },
);

function parseDecimalStringOrThrow(
  value: string,
) {
  const result =
    parseDecimalString(
      value,
    );

  if (result.status !== "OK") {
    throw new Error(
      `expected a valid decimal string, got: ${value}`,
    );
  }

  return result.value;
}
