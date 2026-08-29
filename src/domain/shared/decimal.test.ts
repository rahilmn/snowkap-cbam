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
      // 2026-08-29 (P11 fix, finding #9): "Infinity" is not canonical
      // decimal notation (CANONICAL_DECIMAL_PATTERN never matches it),
      // so it is now refused at the grammar gate -- NOT_NUMERIC, not
      // NOT_FINITE. The isFinite() branch this used to exercise is
      // unreachable by construction once the grammar gate runs first
      // (see decimal.ts's own comment on that branch); NOT_FINITE
      // stays part of the type for defense in depth, but no real input
      // can reach it anymore.
      "rejects Infinity as non-canonical, not merely non-finite",
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
            reason: "NOT_NUMERIC",
          },
        );
      },
    );

    it(
      "rejects NaN as non-canonical, not merely non-finite (same reasoning as the Infinity case above)",
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
            reason: "NOT_NUMERIC",
          },
        );
      },
    );

    it(
      "rejects hexadecimal notation, which decimal.js's own grammar would otherwise silently accept (P11 finding #9, live-reproduced: parseDecimalString(\"0x10\") used to return OK with a stored value that a Decimal reads as 16 but Number() also reads as 16 -- the real divergence was elsewhere; canonical form closes the whole class)",
      () => {
        expect(
          parseDecimalString("0x10"),
        ).toEqual(
          { status: "INVALID", reason: "NOT_NUMERIC" },
        );
      },
    );

    it(
      "rejects binary notation",
      () => {
        expect(
          parseDecimalString("0b101"),
        ).toEqual(
          { status: "INVALID", reason: "NOT_NUMERIC" },
        );
      },
    );

    it(
      "rejects octal notation",
      () => {
        expect(
          parseDecimalString("0o17"),
        ).toEqual(
          { status: "INVALID", reason: "NOT_NUMERIC" },
        );
      },
    );

    it(
      "rejects underscore-separated digits (decimal.js accepts \"1_0\" as 10; Number(\"1_0\") is NaN -- exactly the three-way-disagreement live reproduction that motivated this fix)",
      () => {
        expect(
          parseDecimalString("1_0"),
        ).toEqual(
          { status: "INVALID", reason: "NOT_NUMERIC" },
        );
      },
    );

    it(
      "rejects scientific/exponential notation",
      () => {
        expect(
          parseDecimalString("1e40"),
        ).toEqual(
          { status: "INVALID", reason: "NOT_NUMERIC" },
        );
      },
    );

    it(
      "rejects a numeral with embedded internal whitespace even though trim() only strips the ends",
      () => {
        expect(
          parseDecimalString("4 2"),
        ).toEqual(
          { status: "INVALID", reason: "NOT_NUMERIC" },
        );
      },
    );

    it(
      "returns the TRIMMED value, not the original untrimmed raw input -- the exact bug this fix closes (parseDecimalString(\"  42  \") used to return {status: \"OK\", value: \"  42  \"}, which then THREW out of toDecimal(), a function whose contract is 'no re-validation, trust parseDecimalString')",
      () => {
        const result =
          parseDecimalString(
            "  42  ",
          );

        expect(result.status).toBe("OK");

        if (result.status === "OK") {
          expect(result.value).toBe("42");

          // The whole point: toDecimal() must not throw on a value
          // this function itself just certified as OK.
          expect(
            () => toDecimal(result.value),
          ).not.toThrow();
        }
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
