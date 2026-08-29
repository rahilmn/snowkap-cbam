# CLAUDE.md

Guidance for AI coding agents (and anyone else) working in this
repository. See [`README.md`](README.md) for setup/commands and
[`docs/plans/MASTER_PLAN.md`](docs/plans/MASTER_PLAN.md) for the full
product plan this codebase is being built toward.

## What this project is

A CBAM compliance platform, built around a verified regulatory
foundation. The regulatory subsystem is production-grade and protected;
a branded Next.js application shell and design system exist (`app/`,
`components/`); auth, RLS-enforced tenancy, and real product screens
for both importer/declarant and producer/operator organizations
(shipments, emissions, calculations, sharing, declarations, and more)
are built and locally verified through Phase 11, per the phase roadmap
in the master plan. Do not assume features described in the master
plan already exist, or that everything the plan describes has been
built exactly as specced — check the actual code, and see README.md's
"Current state" section and
[`docs/plans/P13_RELEASE_READINESS_REPORT.md`](docs/plans/P13_RELEASE_READINESS_REPORT.md)
for a precise account of what's implemented, tested, verified,
deferred, or still blocked on Railway access (currently down — see
that report's §29).

## Protected regulatory foundation

These are **protected**, per
[`docs/adr/ADR-0005-protected-regulatory-subsystem.md`](docs/adr/ADR-0005-protected-regulatory-subsystem.md):

- `src/domain/regulatory/` (the resolver and its types)
- `src/infrastructure/regulatory/` (the Supabase adapter and DB row
  types)
- `src/infrastructure/supabase/client.ts`
- The five regulatory-foundation migrations, applied (**not** every file
  matching `supabase/migrations/*.sql` — that glob now also matches ~39
  unrelated product-schema migrations from P3 onward, which are not
  protected):
  `20260826133116_create_regulatory_foundation.sql`,
  `20260827093000_support_regulatory_geography.sql`,
  `20260827110000_activate_definitive_regulatory_dataset.sql`,
  `20260827130000_harden_regulatory_emission_uniqueness.sql`,
  `20260828100000_authenticated_read_regulatory_data.sql`
- `scripts/regulatory/*.py` (the data pipeline)
- The ACTIVE `default_emission_values` dataset in Supabase itself

**Never**, without an explicit, evidenced, TDD-backed change and a
passing `pnpm regulatory:verify` afterward:

- Convert `UNAVAILABLE`, `REFERENCE_REQUIRED`, or `NOT_APPLICABLE` to
  zero, or otherwise treat "no value" as "value is zero."
- Silently pick among ambiguous candidates — ambiguity must surface as
  `AMBIGUOUS`/`UNRESOLVED`, never an arbitrary choice.
- Invent a regulatory value, production route, or classification that
  isn't in the source data.
- Hardcode a regulatory number (a markup, a threshold, a price, a
  benchmark) into application code — every regulatory fact enters
  through a versioned `regulatory_datasets` row, the same way the
  default emission values dataset did. See
  [`docs/architecture/ARCHITECTURE.md`](docs/architecture/ARCHITECTURE.md)
  and the master plan's "facts-as-datasets" rule.
- Edit the canonical dataset or an applied migration in place. A
  correction is a new dataset version plus a new activation migration.
- Bundle a protected-zone change with unrelated cleanup in the same
  commit.

If you find a genuine defect in the protected zone: write a failing
test that demonstrates it, make the smallest change that fixes it, keep
the commit scoped to exactly that fix, and run `pnpm regulatory:verify`
afterward to confirm `RESULT: VALID`. See
`docs/adr/ADR-0010-emission-provenance-and-route-contract.md` for a
worked example (the R7 adapter fix).

## Architecture

Layered: `UI -> Application -> Domain <- Infrastructure`, enforced by
`tests/architecture/layering.test.ts` (run as part of `pnpm test`), not
by package boundaries. See
[`docs/architecture/ARCHITECTURE.md`](docs/architecture/ARCHITECTURE.md)
for the full rules — in short:

- `src/domain/**` depends on nothing outside itself. No `zod`, no
  `@supabase/*`, no `next`/`react`. `decimal.js` only in
  `src/domain/shared/decimal.ts` and `src/domain/calculations/**`.
- `src/application/**` depends on domain types and port interfaces
  only — never `@supabase/*` directly, and (with one grandfathered
  exception) never `src/infrastructure/**`.
- `src/infrastructure/**` is unrestricted, but every entry point that
  touches Supabase or reads secret-bearing env vars carries
  `import "server-only";` as its first import (defense in depth against
  ever reaching a client bundle — see `src/infrastructure/supabase/client.ts`).
- `app/**` (outside `app/api/**`) and `components/**` must not import
  `src/infrastructure/**` directly — reach it through an application
  service once one exists. `app/api/**` route handlers are the
  sanctioned exception (health checks, uploads/downloads, webhooks), as
  are a small, explicit allowlist of infrastructure entry points
  `tests/architecture/layering-rules.ts` (`UI_ALLOWED_INFRASTRUCTURE_IMPORTS`)
  permits directly from Server Actions/Components:
  `src/infrastructure/supabase/{server-client,browser-client,admin-client}`,
  `src/infrastructure/regulatory/get-regulatory-repository`, and
  `src/infrastructure/rate-limit/rate-limiter`. Importing one of these
  five from `app/**`/`components/**` is sanctioned, existing practice
  (e.g. every `app/(auth)/actions.ts`-style Server Action) — not a
  layering violation to flag or work around.
- Regulated numerics are always `DecimalString`
  (`src/domain/shared/decimal.ts`), never `number`.
- Expected outcomes are discriminated `{status, reason}` unions
  (matching the existing resolver's style), not thrown exceptions —
  `throw` is for infrastructure failures and integrity violations only.
- Domain field names are `snake_case`, matching Postgres column names
  1:1 — this is deliberate (see `docs/adr/ADR-0008-...`), not an
  oversight to "fix."

If you're about to introduce an import that the layering test would
reject, that's a signal to restructure the change, not to weaken the
test.

## Test-driven development

Every new behavioral function (an invariant, a lifecycle transition, a
parser) should have its test written and confirmed failing *before* the
implementation exists — this is how every module in
`src/domain/shared/`, `src/domain/organizations/`,
`src/domain/shipments/`, and `src/domain/emissions/` was built. Never
delete a test to make a suite green; never weaken an assertion because
an implementation turned out to be harder than expected.

## Adversarial / mutation-oriented testing against local Postgres

Live-reproducing a security finding against real local Postgres (not a
mock) is this codebase's own established, encouraged practice — most of
the P7–P13 review rounds' findings were confirmed exactly this way, inside
`begin; set local role authenticated; set local request.jwt.claims = ...;
... rollback;` transactions. That pattern is correct and should keep being
used. One incident, found and fixed 2026-08-29 (P13 final adversarial
audit), narrows it:

**Never assume a client-side "rollback" header actually rolls back a
transaction.** One audit sub-agent's live reproduction used the
supabase-js/PostgREST client with a `Prefer: tx=rollback` request header,
believing it to be equivalent to a real `BEGIN ... ROLLBACK`. It is not —
PostgREST's own transaction-end preference is commit-only in this
project's configuration, so the header was silently ignored and the
forged write **committed** to the local database. The agent's own
reproduction script correctly captured the row's original state
beforehand and supplied a restore script, which is what made recovery
possible — but the forged value sat live in the database until the
orchestrating session happened to read that finding's own report closely
enough to notice.

**Going forward, for any mutation-oriented adversarial test (a live
forgery/bypass reproduction, not a read-only probe):**

- Prefer a **real `psql` transaction** (`begin; ...; rollback;`) or a
  direct `pg` /  Postgres client transaction over any HTTP-client-level
  "rollback" header or option — a real `ROLLBACK` statement is the only
  thing this database engine actually guarantees will undo a write.
- If a client library's own transaction/rollback feature must be used
  instead (e.g. because the reproduction needs to go through the real
  REST API, not a direct SQL connection, to prove an HTTP-reachable
  exploit), **verify the database state before and after** the mutating
  call, in the same session, before trusting that "rollback" occurred —
  a `SELECT` confirming the row is back to its original value is not
  optional ceremony, it is the only real evidence the mutation didn't
  stick.
- If a mutation is ever found to have actually committed, say so
  immediately and explicitly (not as a footnote), and supply an exact,
  runnable restore script capturing the row's verified prior state —
  exactly as the incident above did, which is what made the fast recovery
  possible.
- Where practical, prefer a disposable/isolated database or a project
  seeded specifically for the adversarial run over the same local
  instance other work in the session depends on — not always
  practical for a single local Supabase project, but worth choosing when
  there is a real alternative (e.g. a throwaway `supabase db branch`-style
  environment, if one is available).

## Commands / gates

See [`README.md`](README.md#commands). `pnpm typecheck` and `pnpm test`
must both pass before any commit. `pnpm regulatory:verify` must pass
(`RESULT: VALID`) after any change touching the regulatory subsystem —
it needs `SUPABASE_DB_PASSWORD` and a Python environment
(`pip install -r scripts/regulatory/requirements.txt`), so it can't run
in every environment; when it can't run, say so explicitly rather than
skipping it silently.

## Execution / review model

Per
[`docs/adr/ADR-0013-review-and-execution-model.md`](docs/adr/ADR-0013-review-and-execution-model.md):
the master plan's architecture is approved once; phases execute under
their own contract (§38 of the master plan) without a fresh
architecture-approval round each time. Stop and escalate to a human
only for: a material regulatory behavior change, a material
security-boundary change, a destructive database change, a material
architecture change, a major scope change, or a discovered
contradiction in the approved master plan. For anything else inside an
approved phase's scope, proceed.

Model roles (do not collapse): planning/architecture/escalation
analysis is Fable 5's job; implementation inside an approved contract
is Sonnet 5's; Opus 5 gets the specific high-risk reviews the master
plan flags per phase.

## Git

Feature branch per phase (or per meaningful unit of work); one
conceptual change per commit — this matters especially for the
protected regulatory zone, where a single-purpose commit is what makes
"revert this one thing" actually mean one thing. No force-push, no
amending commits other people (or other sessions) might have already
seen. Never commit `.env` or any real credential — `.env.example`
documents what's needed without containing real values.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
