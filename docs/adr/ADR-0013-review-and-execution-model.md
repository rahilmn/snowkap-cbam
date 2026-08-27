# ADR-0013: Review and execution model — approve the architecture once, execute phases under their contracts

## Status

Accepted

## Context

The project's original operating model required human architecture
review before every phase individually. During planning, the owner
explicitly revised this: the complete master architecture
(`docs/plans/MASTER_PLAN.md`) is approved **once**, and implementation
then proceeds phase-by-phase without requiring a fresh human
architectural replanning session before each one — while still keeping
genuine hard stops for the changes that matter most.

## Decision

After the master plan's approval: an implementation model executes
phases sequentially under their §38 phase contracts (objective, scope,
non-scope, files, architecture, acceptance criteria, tests, risks,
rollback). Local implementation planning/refinement inside an approved
phase's scope (turning a phase contract into file-exact tasks) happens
without a separate human approval step. Human escalation is required
only when implementation discovers one of: a material regulatory
behavior change, a material security-boundary change, a destructive
database change, a material architecture change, a major scope change,
or a contradiction in the approved master plan — at which point the
model must stop, present {issue, evidence, impact, alternatives,
recommendation}, and wait, never silently redesigning around the
problem. Humans also participate wherever reality requires it
regardless of this model: supplying credentials/secrets, brand assets,
provisioning staging/production infrastructure, and final production
go-live sign-off.

The existing model-role split is unaffected: Fable 5 for architecture/
planning/escalation analysis, Sonnet 5 for implementation within an
approved contract, Opus 5 for the specific high-risk reviews the master
plan flags per phase (protected-zone diffs, tenancy/RLS/auth,
resolution semantics, the calculation engine, actual-emissions logic,
sharing, authorization, security, production deployment).

## Alternatives considered

- Keep per-phase human architecture review (the original operating
  model) — superseded by explicit owner instruction; would slow
  execution without a corresponding safety benefit once the full
  roadmap, aggregate model, and phase contracts are already fixed in
  the approved master plan.
- No escalation triggers at all, fully autonomous execution through
  production deployment — rejected: the six trigger categories above
  are exactly the classes of change where a wrong autonomous call is
  expensive or hard to reverse (regulatory correctness, security,
  destructive data operations, architecture drift, scope, and
  plan/reality mismatches).

## Consequences

A phase contract (§38 of the master plan, elaborated file-exact at
implementation time) is the operative authority for "is this in scope"
— not a fresh from-scratch judgment call each time. Any implementation
work that doesn't fit cleanly inside an approved phase's contract is,
by definition, one of the six escalation triggers and must stop rather
than proceed on the model's own authority.
