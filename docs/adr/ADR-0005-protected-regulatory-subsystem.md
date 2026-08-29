# ADR-0005: Protected regulatory subsystem policy

## Status

Accepted

## Context

`src/domain/regulatory/`, `src/infrastructure/regulatory/`, the four
applied Supabase migrations, the Python data pipeline
(`scripts/regulatory/`), and the ACTIVE `default_emission_values`
dataset represent a verified, reconciled foundation (12,540 records,
checksum-pinned, `pnpm regulatory:verify` → VALID). This is the hardest
part of the project to get right, and the highest-consequence part to
get wrong — an incorrect regulatory value or a silently-defeated
fallback rule is a compliance-relevant bug, not a cosmetic one.

## Decision

Treat the regulatory subsystem as protected: changes are allowed, but
only when (1) explicitly justified against a confirmed defect or an
approved spec change, never a stylistic preference; (2) TDD — a failing
test proving the defect exists first, then the smallest fix that turns
it green; (3) one logical change per commit, so any single change
reverts in isolation; (4) `pnpm regulatory:verify` re-run and passing
(`RESULT: VALID`) after the change. The pure resolver
(`src/domain/regulatory/resolve-default-value.ts`) in particular carries
a **zero-diff guarantee** through Phase 1 — the only two regulatory
changes Phase 1 makes (see ADR-0010) are adapter- and type-level, never
touching the resolver's logic. The canonical dataset and applied
migrations are never edited; a new dataset version is a new
`regulatory_datasets` row plus a new activation migration, never a
mutation of an existing one.

## Alternatives considered

- Freeze the subsystem entirely, no changes ever without a full
  re-audit — rejected: the Phase 0 audit found a genuine, narrow,
  well-evidenced defect (the R7 adapter early-return); refusing to fix
  a confirmed bug in the name of caution is its own risk.
- Allow broader refactoring "while we're in there" — explicitly
  rejected: any regulatory-adjacent commit is scoped to exactly its
  stated defect, never bundled with unrelated cleanup.

## Consequences

Every PR touching `src/domain/regulatory/`, `src/infrastructure/regulatory/`,
`supabase/migrations/`, or `scripts/regulatory/` should call this out
explicitly in its description and include `pnpm regulatory:verify`
output as evidence. See `CLAUDE.md` for the concrete "never" list
(never convert UNAVAILABLE/REFERENCE_REQUIRED/NOT_APPLICABLE to zero,
never invent a value, etc.) this ADR operationalizes.

### Addendum, 2026-08-29 (P13 audit finding)

This Context section's "the four applied Supabase migrations" is now
stale: a fifth regulatory-foundation migration
(`20260828100000_authenticated_read_regulatory_data.sql`, added
correctly under this ADR's own process in Phase 3) brings the protected
migration count to five. The decision, alternatives, and consequences
above are unchanged and this is not a decision reversal, so the
original text is left as the historical record; `CLAUDE.md`'s protected
regulatory foundation list now names all five files explicitly rather
than relying on a count.
