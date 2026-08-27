# ADR-0007: Error/result convention — discriminated status+reason unions

## Status

Accepted

## Context

The existing regulatory resolver already established a clear house
style for expressing an outcome that isn't a simple success: 
`DefaultValueResolutionResult { status: "RESOLVED" | "UNRESOLVED";
reason: ResolutionReason; ... }`. The product domain needs the same
kind of vocabulary for shipment lifecycle transitions, membership
changes, snapshot completeness, and (later) application-layer use-case
outcomes — and needs to decide, once, whether that vocabulary is
thrown exceptions or returned values.

## Decision

Expected outcomes — including rejection, invalidity, "not found",
ambiguity — are always **discriminated unions with an explicit
`status` field and an enumerated `reason`**, matching the resolver's
style. Examples already in the codebase: `TransitionShipmentResult`
(`{status:"REJECTED", reason:"LINE_INCOMPLETE"}`),
`ChangeMembershipRoleResult` (`{status:"REJECTED", reason:"LAST_OWNER"}`),
`ParseDecimalStringResult`, `SnapshotCompletenessResult`. `throw` is
reserved for genuinely exceptional situations: infrastructure failures
(a database call fails), and data-integrity violations that indicate a
bug or corrupted state rather than an expected business outcome (the
existing Supabase adapter's "more than one ACTIVE dataset exists"
throw is this category). At the future UI/API boundary (Phase 2+),
these unions are mapped to `problem+json` responses.

## Alternatives considered

- A generic `Result<T, E>` monad (Rust/fp-ts style) — rejected: it adds
  a library dependency and an unfamiliar idiom for a codebase that
  already has a working, simpler, self-documenting bespoke pattern per
  domain concept (each result type's `reason` union is exactly the set
  of outcomes *that* operation can produce, which a generic `Result<T,
  E>` doesn't communicate as directly).
- Exceptions for all error handling — rejected: makes expected outcomes
  (a line being incomplete is routine, not exceptional) indistinguishable
  from genuine bugs in stack traces and log noise, and pushes callers
  toward try/catch control flow the codebase's existing style avoids.

## Consequences

A reviewer can recognize this pattern's absence as a smell: a new
domain function that `throw`s for what is clearly an expected business
outcome (e.g. "shipment already locked") should be flagged in review.
