# Architecture

This document describes the layered architecture Snowkap CBAM is built
on: what each layer owns, the dependency-direction rules the codebase
enforces mechanically, and the conventions new code follows. It is the
stack-agnostic half of the picture; product screens, database schema,
and the phase-by-phase build order live in
[`docs/plans/MASTER_PLAN.md`](../plans/MASTER_PLAN.md) and
[`DOMAIN_MODEL.md`](./DOMAIN_MODEL.md).

## Layers

```
UI  ->  Application  ->  Domain  <-  Infrastructure adapters
```

- **Domain** (`src/domain/`) — pure business logic and types. No I/O, no
  framework, no database client. Depends on nothing outside itself.
- **Application** (`src/application/`) — use-case orchestration: fetch
  through a port, hand data to the domain, return the domain's result.
  Depends only on domain types and port *interfaces* (not concrete
  adapters).
- **Infrastructure** (`src/infrastructure/`) — concrete adapters
  (Supabase, environment/config, storage, background jobs) that
  implement the ports application code depends on. May depend on
  anything.
- **UI** (`app/`, from Phase 2 onward) — Next.js routes, React Server
  Components, server actions. Calls application services; never talks
  to infrastructure directly.

This is the same shape the regulatory subsystem already uses —
`resolveActiveDefaultValue` (application) calls a `RegulatoryRepository`
port, whose only implementation today is `SupabaseRegulatoryRepository`
(infrastructure), which in turn feeds the pure `resolveDefaultValue`
resolver (domain). Every new product module follows this same shape.

## Why folders, not packages

The target architecture keeps domain/application/infrastructure as
folders inside one package rather than splitting them into a
pnpm-workspace with separate `packages/*` — at least for now. A
workspace split would force rewriting every relative import inside the
**protected** regulatory files (`src/domain/regulatory/`,
`src/infrastructure/regulatory/`) for zero functional gain, while there
is exactly one consumer of those imports (tests) and no application yet
to justify the extra boundary. What actually protects the layering is
not a package boundary but:

1. an executable **layering test** (below) that fails the build on a
   forbidden import;
2. the regulatory-verification gate (`pnpm regulatory:verify`);
3. the golden/unit test suites;
4. this document, plus the protected-zone policy in `CLAUDE.md`.

One standing rule keeps a future workspace split mechanical if it ever
becomes worth doing: no `tsconfig.json` path aliases are used anywhere
(imports are always relative). When that day comes, the move is a
`git mv` of folders into `packages/*/src`, not a rewrite.

Relative imports are extension-less (`from "./types"`, not
`from "./types.js"`) — a Phase 2 correction from the original NodeNext
convention, after Turbopack (Next.js's bundler) proved unable to
resolve `.js`-suffixed specifiers to their `.ts`/`.tsx` source files.
See [`ADR-0014`](../adr/ADR-0014-drop-js-extensions-for-turbopack.md)
for the evidence; `tsconfig.json` uses `module: "preserve"` /
`moduleResolution: "bundler"` accordingly.

## The layering test

`tests/architecture/layering.test.ts` (with its rule engine in
`tests/architecture/layering-rules.ts`) enforces the dependency
direction mechanically:

- `src/domain/**` may import other domain code only. No
  `src/application`, no `src/infrastructure`. No runtime package
  imports except `decimal.js`, and even that is allowlisted to exactly
  `src/domain/shared/decimal.ts` and `src/domain/calculations/**` — the
  only place regulated numerics are ever widened out of their
  `DecimalString` form for arithmetic. `zod`, `@supabase/*`, `next`, and
  `react` are always forbidden in domain code.
- `src/application/**` may not import `@supabase/*` directly, and may
  not import `src/infrastructure/**` — with exactly one grandfathered
  exception: the `RegulatoryRepository` port type at
  `src/infrastructure/regulatory/regulatory-repository.ts`. In the
  target architecture, ports belong in `src/application/<context>/ports.ts`
  (new product ports follow this from the start); this one exception
  exists because the port was already built inside `infrastructure/`
  before this document existed, and moving it now would touch
  protected-adjacent files for no behavioral gain. Every *new*
  application-owned port lives under `src/application/`.
- A domain unit test (`*.test.ts` under `src/domain`) is still domain
  code for these purposes — it is covered by the same restriction as
  any other domain file, so a domain test cannot reach into
  infrastructure to fake its way to green.

The test suite proves the engine actually works with synthetic
fixtures (a deliberately-forbidden import in an in-memory fixture is
asserted to fail the check) before it walks the real
`src/domain`/`src/application` trees and asserts zero violations exist
there today. Run it with `pnpm test` like any other suite.

## Application service conventions

Every use case is a plain async function, not a class, taking its
dependencies as explicit parameters — this is the same shape
`resolveActiveDefaultValue(repository, input)` already uses. Two
conventions apply to every product use case from Phase 3 onward:

- **Explicit `OrgContext`.** Every application service that touches
  product (tenant-scoped) data takes an `OrgContext { org_id, user_id,
  role, capabilities }` parameter — never ambient/global state, never
  inferred from a request-scoped singleton. This is what makes
  tenancy testable with plain function calls and is the first of the
  two enforcement "walls" described in `DOMAIN_MODEL.md`'s tenancy
  section (the second wall is Postgres RLS).
- **Ports as parameters, not imports.** A service takes its repository
  port(s) as parameters (or via a small typed bag of ports), exactly
  like `resolveActiveDefaultValue` takes `repository`. This keeps
  application code swappable and unit-testable against fakes without
  touching Supabase.

## Result/error convention

Expected outcomes — including "rejected", "invalid", "not found",
"ambiguous" — are **discriminated unions with an explicit `status` and
an enumerated `reason`**, matching the style the regulatory resolver
already established (`DefaultValueResolutionResult`). See, for example,
`transitionShipment`'s `{ status: "REJECTED", reason: "LINE_INCOMPLETE" }`
in `src/domain/shipments/lifecycle.ts`. `throw` is reserved for
infrastructure failures and true data-integrity violations (a
malformed row from the database, a network failure) — never for an
expected business outcome. At the UI/API boundary (from Phase 2
onward), these unions are mapped to `problem+json` responses; internals
never leak into an error message a user sees.

## Numeric and identifier conventions

- **No `number` for anything regulated.** Quantities, emissions, and
  money are always `DecimalString` (`src/domain/shared/decimal.ts`) at
  rest and in transit, and are only ever widened into a `Decimal` for
  arithmetic inside the calculation-engine module. This mirrors the
  regulatory domain's own convention of carrying emission values as
  plain strings end-to-end so no float ever touches a regulatory
  number.
- **Branded IDs.** Every aggregate ID is a distinct nominal type via
  the `Brand<T, B>` helper in `src/domain/shared/ids.ts` — plain
  strings at runtime, non-interchangeable at compile time (an
  `OrganizationId` cannot be passed where a `ShipmentId` is expected,
  even though both are `string`).
- **No `Date` objects in domain data.** Dates are branded `IsoDate`
  (`YYYY-MM-DD`) and timestamps are branded `IsoTimestamp`
  (`src/domain/shared/reporting-period.ts`) — customs/regulatory dates
  are timezone-free calendar dates, not instants.
- **snake_case for persisted fields.** Domain types use snake_case
  field names (`org_id`, `created_at`, `direct_emissions`), matching
  the regulatory domain's own convention and mapping 1:1 onto Postgres
  column names, so there is no translation layer between a domain type
  and its row shape.

## Validation boundary

`zod` is used only at process boundaries — parsing environment
variables (`src/infrastructure/config/env.ts`), and from Phase 2
onward, server-action/route-handler inputs and import-file rows. It
never appears inside `src/domain` (the layering test enforces this).
Domain-internal validity is expressed as plain TypeScript types plus
pure invariant functions (see `src/domain/shipments/invariants.ts`,
`src/domain/organizations/invariants.ts`) that return the same
discriminated-result shape as everything else, not exceptions.

## Web stack placement

The web application (Next.js App Router, arriving in Phase 2) lives at
the repository root as `app/`, alongside the existing `src/` — not
inside a separate `apps/web` workspace package. This is a deliberate
extension of the "folders, not packages" decision above: one
`tsconfig.json`, one deploy unit, zero import churn in the protected
regulatory files. Infrastructure modules that must never execute in a
browser bundle are guarded with the `server-only` import (added when
the Next.js app lands), and the layering test's infrastructure
restriction already prevents `app/` code from reaching infrastructure
directly — it goes through application services.

**If a different web stack were chosen instead** (the master plan
also evaluated a Fastify API + separate SPA), nothing above this
paragraph would change: `src/domain`, `src/application`, and
`src/infrastructure` are deliberately framework-agnostic (no `next` or
`react` imports anywhere outside `app/`, enforced by the layering
test). Only the consumer changes — a Fastify app under `apps/api`
calling the same application services, paired with a separately
deployed SPA under `apps/spa` — and only the "Web stack placement"
section of this document and the corresponding ADR would need
updating.

## Python data pipeline

`scripts/regulatory/*.py` is dev-side/CI tooling, not a Railway runtime
dependency. See `scripts/regulatory/requirements.txt` for its pinned
dependencies (pandas, openpyxl, psycopg) and `CLAUDE.md` for the
command sequence. It is entirely outside the layered TypeScript
architecture described above — its only interface to the rest of the
system is the Postgres database it writes to and the checksum/version
metadata it records in `regulatory_datasets`/`regulatory_sources`.

## Related documents

- [`DOMAIN_MODEL.md`](./DOMAIN_MODEL.md) — the product domain model
  (aggregates, lifecycles, invariants), tenancy design, and the Phase 3
  DDL template.
- [`DATABASE_SCHEMA.md`](./DATABASE_SCHEMA.md) — the regulatory schema
  as it exists today.
- [`REGULATORY_RESOLUTION_RULES.md`](./REGULATORY_RESOLUTION_RULES.md) —
  the normative regulatory resolution rules (R1–R14) the resolver
  implements.
- `docs/adr/` — architecture decision records for the choices this
  document summarizes.
- [`docs/plans/MASTER_PLAN.md`](../plans/MASTER_PLAN.md) — the approved
  end-to-end product plan, phase contracts, and roadmap.
