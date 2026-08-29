import {
  Decimal as DecimalJs,
} from "decimal.js";

import type {
  Brand,
} from "./ids";

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
 * The ONLY string shape this module ever calls a regulated numeric --
 * an optional leading `-`, one or more digits, an optional `.` plus
 * one or more digits. Byte-for-byte the same grammar
 * emission_data_direct_specific_numeric_ck (and its `indirect_specific`
 * sibling) already enforces at the database layer
 * (supabase/migrations/20260829230000_p7b_emission_data_schema.sql) --
 * this module mirrors it rather than inventing a second, possibly
 * divergent, definition of "canonical decimal."
 *
 * 2026-08-29 (P11 mandatory security review, BLOCKING finding #9,
 * independently confirmed live by two reviewers, one of whom traced
 * the root cause below): decimal.js's own string grammar is far wider
 * than this — it also accepts hexadecimal ("0x10"), octal ("0o17"),
 * binary ("0b101"), and underscore-separated ("1_0") literals, and
 * (separately) this function used to return the untrimmed `raw` input
 * rather than `trimmed` even though `trimmed` is what was actually
 * validated, so a value like `"  42  "` came back `{status: "OK"}`
 * from THIS function yet threw a raw DecimalError out of toDecimal()
 * (which does not re-validate, by contract) the moment a caller tried
 * to use it. Live reproduction showed FOUR different systems reading
 * the same stored string FOUR different ways ("1_0" -> decimal.js
 * computes 10, Number() computes NaN, and — the regulatory-grade
 * failure — a value can be accepted by this function, stored verbatim
 * in a regulated numeric column, and disagree with what the
 * calculation engine actually computed from it). CLAUDE.md's "never
 * invent, never substitute" rule and this codebase's regulated-numeric
 * discipline (DecimalString, never `number`) both depend on exactly
 * one canonical reading existing for any stored value — this pattern
 * is what makes that true at the one place regulated numerics first
 * enter the system as free text.
 */
const CANONICAL_DECIMAL_PATTERN =
  /^-?[0-9]+(\.[0-9]+)?$/;

/**
 * Validates that `raw` is a finite decimal number in CANONICAL form
 * (see CANONICAL_DECIMAL_PATTERN above) and returns the validated,
 * whitespace-trimmed string as a DecimalString — this function never
 * rounds, reformats, or otherwise changes the value's digits; trimming
 * surrounding whitespace is not a value change, and is required for
 * the returned string to actually be the same string this function
 * validated (see this module's 2026-08-29 header comment above for
 * the bug this closes: returning the untrimmed `raw` input let a
 * validated-OK value throw out of toDecimal(), which trusts
 * parseDecimalString's contract rather than re-validating).
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

  if (!CANONICAL_DECIMAL_PATTERN.test(trimmed)) {
    return {
      status: "INVALID",
      reason: "NOT_NUMERIC",
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

  // Unreachable for any input that already passed
  // CANONICAL_DECIMAL_PATTERN above — a bounded string of plain
  // digits (optionally signed, optionally fractional) can never parse
  // to Infinity/NaN in decimal.js's arbitrary-precision, arbitrary-
  // exponent representation. Kept as defense in depth rather than
  // removed: it is what makes "OK implies genuinely finite" a real
  // invariant of this function's return type, not merely an accident
  // of the regex above, and costs nothing to keep correct.
  if (!value.isFinite()) {
    return {
      status: "INVALID",
      reason: "NOT_FINITE",
    };
  }

  return {
    status: "OK",
    value: trimmed as DecimalString,
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
