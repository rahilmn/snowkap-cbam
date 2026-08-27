# ADR-0001: Record architecture decisions with ADRs

## Status

Accepted

## Context

Snowkap CBAM makes a number of architectural choices during Phase 1
that later phases will build on and that a future contributor (human or
AI) needs to understand *why*, not just *what*. The project's own
operating rules require documenting "problem, decision, alternatives,
consequences" for major decisions, not just implementation mechanics.

## Decision

Record significant architecture decisions as lightweight (MADR-style)
one-pagers under `docs/adr/`, numbered sequentially
(`ADR-NNNN-kebab-case-title.md`), each with: Status, Context, Decision,
Alternatives considered, Consequences. New ADRs are added as later
phases make their own consequential choices; existing ADRs are not
rewritten after acceptance — a changed decision gets a new ADR that
supersedes the old one, with the old one's Status updated to
"Superseded by ADR-NNNN".

## Alternatives considered

- No ADRs, decisions only in commit messages / the master plan — 
  rejected: commit messages are found by chance, not by topic; the
  master plan is a point-in-time proposal, not a living decision log.
- A single running `DECISIONS.md` — rejected: harder to link to from a
  specific PR, harder to mark individually superseded.

## Consequences

Every ADR referenced elsewhere in the docs (`ARCHITECTURE.md`,
`DOMAIN_MODEL.md`, `CLAUDE.md`) must actually exist under `docs/adr/`
with this filename convention, or the cross-reference is broken.
