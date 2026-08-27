# ADR-0006: Numeric policy — decimal strings everywhere, decimal.js confined to the calculation kernel

## Status

Accepted

## Context

The regulatory subsystem already carries emission values as plain
strings end-to-end specifically so no floating-point number ever
touches a regulatory value (`0.1 + 0.2 !== 0.3` in native JS floats,
and CBAM emissions/liability figures are financial/regulatory-grade
data). The product domain needs the same discipline for shipment
quantities, emission determinations, and eventual liability/certificate
figures — this is explicitly a project rule ("Do not rely on JavaScript
floating-point arithmetic for financial/regulatory precision").

## Decision

Regulated numerics (quantities, emissions, money) are always carried as
`DecimalString` — a branded, validated string
(`src/domain/shared/decimal.ts`) — at rest and in transit. `number` is
never used for these values anywhere in the codebase. Arithmetic
happens only by widening a `DecimalString` into a `Decimal` (via
`toDecimal`) inside the calculation-engine module, using a
module-locally cloned `decimal.js` instance
(`Decimal.clone({ precision: 40, rounding: ROUND_HALF_UP })`) so this
project's precision/rounding configuration never leaks into or is
affected by decimal.js's shared global state. `decimal.js` imports are
allowlisted (and the layering test enforces this) to exactly
`src/domain/shared/decimal.ts` and `src/domain/calculations/**`. Money
is `MoneyEUR { amount: DecimalString; currency: "EUR" }` — CBAM
liability is EUR-denominated, so no currency-conversion concern exists
yet.

## Alternatives considered

- Native `number` with careful rounding — rejected outright; this is
  exactly the failure mode the project rules forbid.
- A different arbitrary-precision library (e.g. `big.js`,
  `bignumber.js`) — decimal.js was already a declared (if previously
  unused) dependency and is a well-established, actively maintained
  choice; no reason to introduce a second numeric library.

## Consequences

Any new domain type carrying a quantity, emission value, or money
figure must use `DecimalString`, not `number` or `string` unbranded.
Deserializing external input (CSV/XLSX rows, API payloads) into a
`DecimalString` always goes through `parseDecimalString`'s explicit
`{status, reason}` result — never a bare `Number()`/`parseFloat()` cast.
