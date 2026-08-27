# ADR-0002: Single-package layered architecture with an executable layering test

## Status

Accepted

## Context

Snowkap CBAM needs clean domain/application/infrastructure boundaries
so the protected regulatory subsystem and the growing product domain
stay decoupled from Supabase and (from Phase 2) Next.js. The
conventional way to enforce this is a pnpm-workspace split into
separate packages. But the regulatory subsystem already exists, is
verified, and is protected — any workspace split touches its import
paths (`../../domain/regulatory/types.js` becomes a package specifier)
purely for structural reasons, with no behavioral payoff, and with
exactly one consumer (tests) and no application yet to justify the
extra tooling overhead.

## Decision

Keep `src/domain`, `src/application`, `src/infrastructure` as folders
inside one package. Enforce the dependency direction (UI → Application
→ Domain ← Infrastructure) with an executable test
(`tests/architecture/layering.test.ts` /
`tests/architecture/layering-rules.ts`) rather than package boundaries.
Two standing conventions keep a future split mechanical: relative
imports always use `.js` extensions (NodeNext), and no `tsconfig.json`
path aliases are used anywhere. The `RegulatoryRepository` port stays
at its existing location under `src/infrastructure/regulatory/` (a
grandfathered exception the layering test explicitly allowlists) rather
than being moved to `src/application/` where new ports belong — moving
it now would touch a protected-adjacent file for no gain.

## Alternatives considered

- `packages/domain`, `packages/application`, `packages/infrastructure`,
  `apps/web` pnpm workspace now — rejected for the reasons above;
  revisit when `apps/web` (Phase 2) actually creates a second real
  consumer of the domain/application layers.
- No enforcement at all, rely on code review — rejected: a layering
  violation is exactly the kind of thing that's easy to introduce
  incrementally and hard to notice in review once the codebase is
  large; an executable test catches it in CI on every PR.

## Consequences

The layering test must be kept in sync with any new grandfathered
exception (there should be as few as possible) and re-run whenever a
new top-level domain/application module is added. If/when the workspace
split does happen, the layering test's directory-prefix checks need to
be rewritten for package-specifier resolution.
