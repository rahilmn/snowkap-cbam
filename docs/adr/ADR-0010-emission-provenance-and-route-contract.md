# ADR-0010: Emission provenance snapshots, and the resolver's production_route contract

## Status

Accepted

## Context

Two related findings from the Phase 0 audit needed a documented
resolution.

**Provenance gap**: `RegulatoryRecord` (the type the resolver returns
records in) carried `dataset_id` but not `dataset_version` — the
Supabase adapter fetched the dataset's `version` column but discarded
it before mapping. A product record built on a resolved value therefore
could not record which dataset *version* produced it without a second
query, which
[`SOURCE_REGISTER.md`](../regulatory/SOURCE_REGISTER.md) rule 6
explicitly requires ("a calculation must record the regulatory dataset
version used").

**Route-contract footgun**: the resolver matches its
`production_route` input against `record.source_production_route_code`
— the *raw* source indicator (e.g. `"(C)"`) — not against the
human-readable `record.production_route` name the same record also
carries. Nothing in the type signature signals this; a caller reading
the field name naturally assumes the opposite.

## Decision

**Provenance**: add `dataset_version: string` to `RegulatoryRecord`
(Phase 1, additive, TDD-first), mapped from the dataset row's already-
fetched `version` column. This is a small, protected-zone change — see
ADR-0005 — landed as its own commit with a red-then-green integration
test and a `pnpm regulatory:verify` re-run. The product's
`RegulatoryResolutionSnapshot` (`src/domain/emissions/types.ts`) then
carries this `dataset_version` forward permanently, frozen at
determination time, so a stored result never depends on a later,
possibly-different ACTIVE dataset to explain itself.

**Route contract**: rather than changing the resolver's matching
behavior (a public-contract change to protected code, with no consumer
yet to justify it), the product layer absorbs the translation. A
`ShipmentLine.production_route` field stores **both** the name and the
raw indicator (`{ name: string; source_route_indicator: string }`), and
the product always passes `source_route_indicator` when calling the
resolver (Phase 5, `resolveActiveDefaultValue`'s `production_route`
input). The resolver's contract itself is documented explicitly in
[`REGULATORY_RESOLUTION_RULES.md`](../architecture/REGULATORY_RESOLUTION_RULES.md)'s
"Resolver contract" section (an additive doc change, no code change) so
future readers of that document — not just this ADR — see the same
statement.

## Alternatives considered

- Change the resolver to match against `production_route` (the name)
  instead of the raw indicator — rejected: this is a behavior change to
  protected, verified code for a contract confusion that has a
  strictly cheaper fix (storing both values and always passing the
  right one) available at the product layer, which has no existing
  consumers to break.
- Leave `dataset_version` out of the record and require a second query
  whenever a consumer needs it — rejected: this is exactly the
  friction that would make it easy for a future implementer to *skip*
  recording the dataset version under time pressure, defeating rule 6
  in practice even though it's "possible" in principle.

## Consequences

Any future consumer of `RegulatoryRecord`/`RegulatoryResolutionSnapshot`
can rely on `dataset_version` being present and correct without an
extra query. Any future code calling the resolver directly (not just
through the product's `ShipmentLine.production_route` field) must
remember to pass the raw indicator, not a display name — this ADR is
the canonical place that states it.
