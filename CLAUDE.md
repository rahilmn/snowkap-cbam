# CLAUDE.md

Guidance for AI coding agents (and anyone else) working in this
repository. See [`README.md`](README.md) for setup/commands and
[`docs/plans/MASTER_PLAN.md`](docs/plans/MASTER_PLAN.md) for the full
product plan this codebase is being built toward.

## What this project is

A CBAM compliance platform, built around a verified regulatory
foundation. The regulatory subsystem is production-grade and protected;
almost everything else (product domain, UI, API, auth, tenancy) is
under active construction per the phase roadmap in the master plan. Do
not assume features described in the master plan already exist — check
the actual code.

## Protected regulatory foundation

These are **protected**, per
[`docs/adr/ADR-0005-protected-regulatory-subsystem.md`](docs/adr/ADR-0005-protected-regulatory-subsystem.md):

- `src/domain/regulatory/` (the resolver and its types)
- `src/infrastructure/regulatory/` (the Supabase adapter and DB row
  types)
- `src/infrastructure/supabase/client.ts`
- `supabase/migrations/*.sql` (all four, applied)
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
- `src/infrastructure/**` is unrestricted.
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
