import {
  Decimal as DecimalJs,
} from "decimal.js";

import type {
  Brand,
} from "./ids.js";

/**
 * This is the only file in src/domain that imports decimal.js (see
 * tests/architecture/layering.test.ts, which enforces that). Everywhere
 * else, regulated numerics travel as DecimalString — a plain string,
 * exact and JSON-serializable — and are only ever widened into a Decimal
 * for arithmetic inside src/domain/calculations.
 *
 * `.clone()` gives this module its own configuration without mutating
 * the shared decimal.js global state that other code (e.g. a future
 * dependency) might rely on with different settings.
 */
const Decimal =
  DecimalJs.clone(
    {
      precision: 40,
      rounding: DecimalJs.ROUND_HALF_UP,
    },
  );

export type DecimalValue =
  InstanceType<typeof Decimal>;

export type DecimalString =
  Brand<string, "DecimalString">;

export type ParseDecimalStringResult =
  | { status: "OK"; value: DecimalString }
  | {
      status: "INVALID";
      reason:
        | "EMPTY"
        | "NOT_NUMERIC"
        | "NOT_FINITE";
    };

/**
 * Validates that `raw` is a finite decimal number and returns it as a
 * DecimalString, unmodified — this function never rounds, truncates, or
 * reformats the input; it only classifies it as valid or invalid.
 */
export function parseDecimalString(
  raw: string,
): ParseDecimalStringResult {
  const trimmed =
    raw.trim();

  if (trimmed.length === 0) {
    return {
      status: "INVALID",
      reason: "EMPTY",
    };
  }

  let value: DecimalValue;

  try {
    value =
      new Decimal(
        trimmed,
      );
  } catch {
    return {
      status: "INVALID",
      reason: "NOT_NUMERIC",
    };
  }

  if (!value.isFinite()) {
    return {
      status: "INVALID",
      reason: "NOT_FINITE",
    };
  }

  return {
    status: "OK",
    value: raw as DecimalString,
  };
}

/**
 * Widens a validated DecimalString into a Decimal for arithmetic. Callers
 * are expected to have already validated the string via
 * parseDecimalString (or to be passing a value that originated from one)
 * — this function does not re-validate.
 */
export function toDecimal(
  value: DecimalString,
): DecimalValue {
  return new Decimal(
    value,
  );
}

/**
 * Serializes a Decimal back to a DecimalString for persistence/transport.
 * Uses toFixed with no argument, which preserves the value's own
 * precision rather than rounding to a fixed number of places.
 */
export function toDecimalString(
  value: DecimalValue,
): DecimalString {
  return value.toFixed() as DecimalString;
}

export interface MoneyEUR {
  amount: DecimalString;
  currency: "EUR";
}
