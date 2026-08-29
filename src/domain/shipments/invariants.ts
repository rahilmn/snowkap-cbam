import {
  parseDecimalString,
  toDecimal,
} from "../shared/decimal";

import type {
  ShipmentLine,
} from "./types";

/**
 * True when exactly one of net_mass_tonnes / quantity_mwh is set to a
 * finite positive number. A line is never allowed to declare both
 * (mass and electricity quantity are mutually exclusive) or neither.
 *
 * 2026-08-29 (P13 audit finding, ADR-0006): was `Number(quantity)`,
 * silently widening a regulated DecimalString through a native JS
 * number for a real accept/reject decision -- the ADR's own wording is
 * absolute ("number is never used for these values anywhere in the
 * codebase"). parseDecimalString is the same arbitrary-precision
 * validation every other regulated numeric in this codebase already
 * goes through.
 */
export function isLineQuantityValid(
  line: ShipmentLine,
): boolean {
  const quantities =
    [
      line.net_mass_tonnes,
      line.quantity_mwh,
    ].filter(
      (quantity): quantity is NonNullable<typeof quantity> =>
        quantity !== null,
    );

  if (quantities.length !== 1) {
    return false;
  }

  const [
    quantity,
  ] = quantities;

  const parsed =
    parseDecimalString(
      quantity,
    );

  if (parsed.status !== "OK") {
    return false;
  }

  return toDecimal(
    parsed.value,
  ).greaterThan(
    0,
  );
}

/**
 * A line is "complete" — eligible to be part of a READY shipment — once
 * its declared code, origin, a valid quantity, and an emission
 * determination are all present. This mirrors the READY-transition
 * precondition in docs/architecture/DOMAIN_MODEL.md.
 */
export function isLineComplete(
  line: ShipmentLine,
): boolean {
  return (
    line.cn_code.length > 0 &&
    line.origin_country.length > 0 &&
    isLineQuantityValid(
      line,
    ) &&
    line.emission_determination !== null
  );
}

/**
 * True when the given lines' line_numbers are exactly {1, 2, ..., n}
 * with no gaps and no repeats, regardless of array order. An empty
 * array trivially satisfies this (n = 0).
 */
export function hasDenseUniqueLineNumbers(
  lines: ShipmentLine[],
): boolean {
  const numbers =
    lines
      .map(
        (line) => line.line_number,
      )
      .sort(
        (a, b) => a - b,
      );

  return numbers.every(
    (number, index) => number === index + 1,
  );
}
