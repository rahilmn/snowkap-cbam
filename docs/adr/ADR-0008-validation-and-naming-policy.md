# ADR-0008: Validation boundary and field-naming policy

## Status

Accepted

## Context

Two related conventions needed fixing before the product domain grew
much larger: where input validation (`zod`) happens, and what
casing convention persisted field names use. Both should match the
precedent the regulatory subsystem already set rather than introduce a
second style.

## Decision

**Validation**: `zod` is used only at process boundaries — parsing
environment variables (`src/infrastructure/config/env.ts`), and from
Phase 2 onward, server-action/route-handler inputs and import-file
rows. It never appears inside `src/domain` (the layering test enforces
this). Domain-internal correctness is plain TypeScript types plus pure
invariant functions returning the ADR-0007 discriminated-result shape
— not runtime schema validation duplicated a second time.

**Naming**: persisted/domain field names are `snake_case`
(`org_id`, `created_at`, `direct_emissions`), matching the regulatory
domain's existing convention and Postgres's own column-naming
convention 1:1 — a domain type's field names are exactly its future (or,
for the regulatory subsystem, existing) table's column names, with no
translation layer required between them.

## Alternatives considered

- `zod` schemas as the domain's source of truth (schema-first,
  `z.infer` for types) — rejected: couples pure domain logic to a
  runtime validation library, and diverges from the resolver's
  established plain-type-plus-invariant-function style.
- `camelCase` domain fields (idiomatic TypeScript) with a mapping layer
  to `snake_case` database columns — rejected: adds a translation layer
  and an extra place for drift for no benefit, since this project has
  no external TypeScript consumer whose idioms need to be respected;
  the mapping layer is exactly the kind of duplicated-vocabulary
  problem the dead `src/regulatory/` layer (removed in Phase 1) already
  demonstrated the cost of.

## Consequences

Any future linter/formatter adoption (deferred per the master plan's
dependency strategy) must not auto-rewrite `snake_case` domain field
names to `camelCase` — this is a deliberate choice, not an oversight,
and needs to be excluded from any naming-convention lint rule.
