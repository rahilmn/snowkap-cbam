# CBAM Regulatory Resolution Rules

## Purpose

This document defines the deterministic rules used to resolve a CBAM
default emission value from the definitive 2026 regulatory dataset.

The rules separate:

1. source-data interpretation,
2. regulatory value resolution,
3. calculation/markup.

The Excel source is treated as an informational representation.
Legally binding values are those in the applicable Commission
Implementing Regulation.

## Source authority

Primary legal source:

- Commission Implementing Regulation (EU) 2026/1740 correcting
  Implementing Regulation (EU) 2025/2621 as regards Annexes I and IV.

The Commission's definitive Excel workbook is retained as the
machine-readable source artifact and provenance record.

## Rule R1 — Code levels

The canonical code levels are:

- HS4: 4 digits
- HS6: 6 digits
- CN8: 8 digits
- TARIC10: 10 digits

Code level is a classification property.
It does not by itself determine whether the row contains a directly
usable emission value.

## Rule R2 — Value states

Each emission field has one of:

- AVAILABLE
- UNAVAILABLE
- REFERENCE_REQUIRED
- NOT_APPLICABLE
- SOURCE_TEXT

AVAILABLE means a numeric regulatory value is present.

UNAVAILABLE means the source does not provide a usable value for that
specific country/product record.

REFERENCE_REQUIRED means the source explicitly delegates the value to
more specific regulatory entries.

No unavailable value may be converted to zero.

## Rule R3 — Exact product resolution

Resolution starts with the explicitly requested origin country and
normalized product code.

A more-specific classification must not automatically inherit the value
of a broader classification unless the applicable regulatory rule
explicitly requires that fallback.

## Rule R4 — TARIC specificity

When the requested classification is TARIC10, an applicable exact
TARIC10 record takes precedence over a broader CN8 record.

The definitive 2026 dataset contains five TARIC10 products:

- 2507008080
- 2523100010
- 2523100090
- 2523900010
- 2523900090

## Rule R5 — CN8 specificity

When the requested classification is CN8, the exact CN8 record is the
primary candidate.

If a CN8 record has no production route, its benchmark is independent of
production route.

## Rule R6 — Production route

A source production route is preserved exactly as supplied.

No route is invented during ingestion or resolution.

If a source record has no production route, route-specific matching is
not required for that record.

If a production route is indicated for an HS-level group, but the
concerned CN8 entry has no route, the CN8 benchmark is treated as
independent of production route.

Composite source indicators such as `(C)/(F)` and `(E)/(H)` are preserved
as source route indicators and are not silently reduced to one route.

## Rule R7 — Country fallback

If the country or territory is not explicitly listed, use the value from:

`Other countries and territories`

If the country or territory is explicitly listed but the relevant field
has no value or contains `–`, use the corresponding value from:

`Other countries and territories`

This fallback is applied per regulatory good/value, not as a blanket
replacement of the entire country's table.

## Rule R8 — REFERENCE_REQUIRED

A `REFERENCE_REQUIRED` row is not itself a numeric default emission value.

The resolver must identify whether a more specific applicable source
record exists.

If a requested product is only identified at a reference/group level and
there is insufficient classification information to select a concrete
child record, resolution must return `UNRESOLVED`.

The resolver must never guess which child record applies.

## Rule R9 — Unavailable values

`UNAVAILABLE` is not equivalent to zero.

If the applicable country-specific row is unavailable, the resolver
attempts the regulatory country fallback under Rule R7.

If the corresponding fallback is also unavailable, resolution remains
unresolved.

## Rule R10 — Ambiguity

If more than one applicable record remains after applying specificity,
country and route rules, resolution must return `UNRESOLVED`.

The resolver must never choose an arbitrary record based on array order.

## Rule R11 — Total emissions

For certificate calculation, the applicable `total emissions` value is
the source value used before applying the legally applicable sector/year
markup.

The resolver should therefore return the source total-emissions value
without applying markup.

Markup belongs to the calculation layer.

## Rule R12 — Resolution trace

Every resolution attempt must produce an ordered trace containing:

- normalized input code,
- country match,
- exact classification candidates,
- route evaluation,
- fallback evaluation,
- selected record,
- final reason,
- unresolved/ambiguous reason where applicable.

The trace is part of the auditability contract.

## Rule R13 — No silent regulatory inference

The resolver may only apply rules defined in this document.

It must not:

- convert missing values to zero,
- invent production routes,
- infer a child product from a parent HS group,
- select among ambiguous candidates,
- replace source semantics with heuristics.

## Rule R14 — Calculation separation

The resolver returns a regulatory source value.

Sector/year markup, certificate pricing, free-allocation effects and
other CBAM calculations are separate domain operations.