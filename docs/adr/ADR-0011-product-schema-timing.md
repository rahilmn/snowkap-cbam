# ADR-0011: Product schema timing — no product migrations before Phase 3

## Status

Accepted

## Context

Phase 1 builds the product domain model (types + pure invariant/
lifecycle functions) but touches no database beyond the existing,
protected regulatory schema. The question this ADR settles: should
Phase 1 *also* create the first product tables (e.g. `organizations`,
`shipments`) now that the domain types exist for them, or wait?

## Decision

**No product migration lands before Phase 3.** Phase 1 documents the
target shape instead — the DDL template in
[`DOMAIN_MODEL.md`](../architecture/DOMAIN_MODEL.md#phase-3-ddl-template)
— so Phase 3 has an exact, reviewed spec to implement against rather
than deriving it from scratch. The one hard commitment made now:
**Phase 3's first migration is `organizations` + `memberships`**, with
RLS enabled and policies defined at creation (ADR-0004), before any
other product table — every other product table's `org_id` foreign key
needs them to exist first.

## Alternatives considered

- Create a minimal `organizations`/`shipments` schema in Phase 1
  alongside the types — rejected: a schema created before the workflow
  that exercises it (the shipment intake UI, arriving Phase 4) is
  validated by nothing; it would very likely need a churn migration
  once real usage reveals a gap, and Phase 1's own acceptance criteria
  (no database writes, no migrations) is deliberately kept simple so
  its rollback story is "delete files," not "unwind a migration."
- Wait until the calculation engine (Phase 6) to introduce any product
  schema, reasoning that shipments alone don't need persistence until
  calculations do — rejected: shipment intake (Phase 4) is the first
  screen a user actually interacts with and clearly needs to persist
  before that phase can be considered done.

## Consequences

Phase 1's acceptance criteria can state plainly that no DB migration
exists in its diff. Phase 3 is explicitly gated on this ADR's
commitment (its first migration is fixed) rather than left to
Phase-3-time discretion.
