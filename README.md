# Snowkap CBAM

A CBAM (EU Carbon Border Adjustment Mechanism) compliance platform:
shipment intake, classification, regulatory emissions resolution,
embedded-emissions calculation, and reporting/declaration preparation —
serving both importer/declarant organizations and third-country
producer/operator organizations on one platform. See
[`docs/plans/MASTER_PLAN.md`](docs/plans/MASTER_PLAN.md) for the full
product plan and phase roadmap.

**Current state, honestly, as of 2026-08-29 (through Phase 11, mid-Phase
13)**: this is a substantially built, locally-verified, multi-tenant
product today — not early scaffolding. The regulatory foundation, a
full RLS-protected tenancy/auth layer, and real product screens for
both importer and producer/operator organizations (shipment intake and
classification, regulatory resolution, calculation, "Why this number?"
explainability, period reporting/export, declaration preparation
through LOCK, installation/operator management, actual-emissions entry
and verification, cross-org sharing) all exist, are backed by 56
applied Supabase migrations, and are covered by 1032 passing automated
tests plus three full-journey Playwright E2E suites
(`tests/e2e/{importer,producer,cross-org-sharing}-journey.spec.ts`) run
against real local Supabase. See
[`docs/plans/MASTER_PLAN.md`](docs/plans/MASTER_PLAN.md) for the full
phase-by-phase contract and acceptance criteria, and
[`docs/plans/P13_RELEASE_READINESS_REPORT.md`](docs/plans/P13_RELEASE_READINESS_REPORT.md)
for a precise implemented/tested/verified/deferred/blocked breakdown per
capability — this paragraph is a summary, not a substitute for that
report, whose current headline finding is that the Railway production
deployment is down and release is blocked pending that and one
regulatory-interpretation decision.

What is genuinely **not** done: CSV/XLSX shipment import (Phase 4's
manual-entry-only today; bulk import was never built), a resolution
explorer/batch-resolve UI (Phase 5's per-line "Why this number?" is
real; the cross-shipment explorer view is not), real importer/producer
dashboards (the post-sign-in landing page is still a Phase-2
placeholder — every wired screen is reachable from the sidebar, just
not summarized on one dashboard), the bootstrap-by-email
sharing invite does not actually send an email yet (see
`docs/adr/ADR-0012-cross-organization-sharing-model.md`), password
reset, a user-profile screen, a 403 error page, an importer-side
installations/operators screen, and a dedicated calculations screen
(the capability exists inline in the shipment detail view; there is no
separate route for it) — all five absent, not stubbed. Staging and
production deployment are not live anywhere — no Railway or
staging/production Supabase project has ever been connected to this
environment (an owner-provided precondition); see
`docs/runbooks/DEPLOYMENT.md` for exactly what is and isn't verified
locally versus what still needs a real Railway/Supabase project to
confirm.

## What's here today

- **Regulatory subsystem** (`src/domain/regulatory/`,
  `src/infrastructure/regulatory/`) — a pure resolver implementing the
  documented rules in
  [`docs/architecture/REGULATORY_RESOLUTION_RULES.md`](docs/architecture/REGULATORY_RESOLUTION_RULES.md),
  reading from a Supabase-hosted, checksum-verified CBAM default
  emission values dataset (12,540 records, 283 CBAM goods, 122
  countries; see
  [`docs/architecture/DATABASE_SCHEMA.md`](docs/architecture/DATABASE_SCHEMA.md)).
  This subsystem is **protected** — see `CLAUDE.md`.
- **Product domain + application layers**
  (`src/domain/{organizations,shipments,emissions,installations,calculations,audit,sharing,declarations,evidence}/`,
  `src/application/**`) — real, persisted aggregates (see
  [`docs/architecture/DOMAIN_MODEL.md`](docs/architecture/DOMAIN_MODEL.md))
  backing every screen listed below, not a types-only sketch.
- **Multi-tenant RLS + auth** (`supabase/migrations/`) — organizations,
  memberships (with deactivation), invitations, and row-level security
  on every product table, independently re-verified this phase against
  a real local Supabase instance (see
  [`docs/architecture/AUTHORIZATION_MATRIX.md`](docs/architecture/AUTHORIZATION_MATRIX.md)
  for the full role/capability gate inventory, including its
  self-disclosed gaps).
- **Application shell + product screens** (`app/`, `components/`) —
  Next.js 16 App Router, the Snowkap design system (`app/globals.css`;
  light + true dark, WCAG AA verified), the branded shell (topbar,
  capability-aware sidebar, breadcrumbs, real auth/org-switching), and
  real screens for both experiences: importer shipments/emissions/
  suppliers/reports/declarations/audit, producer
  installations/emission-data/sharing/activity. A `/design` component
  gallery also exists at that route — not gated to development, just
  unlinked from navigation.
- **Health check** (`app/api/health/route.ts`) — process liveness +
  Supabase connectivity + exactly-one-ACTIVE-dataset check. Backs the
  Railway healthcheck once deployed.
- **Deployment artifacts** (`Dockerfile`, `railway.json`,
  `.dockerignore`) — a multi-stage build around Next's standalone
  output. Re-verified locally this phase (real `docker build` + `docker
  run` + healthcheck + non-root-user check, after fixing a real
  Dockerfile defect the build-arg wiring had — see
  `docs/runbooks/DEPLOYMENT.md` §3 and §9). Not yet deployed anywhere
  (no Railway account access in this environment).
- **Data pipeline** (`scripts/regulatory/*.py`) — parses, validates,
  reconciles, and loads the CBAM regulatory dataset from its source
  Excel workbook into Supabase, and verifies the loaded data matches
  the canonical source. Dev-side tooling only, not a runtime
  dependency.

## Prerequisites

- Node.js 22 (see the `engines` field in `package.json`)
- [pnpm](https://pnpm.io/) 11 (pinned via `packageManager` — Corepack
  will pick it up automatically)
- Python 3.13 with the packages in
  `scripts/regulatory/requirements.txt` — only needed to run the
  regulatory data pipeline or `pnpm regulatory:verify`
- A Supabase project (for anything beyond `pnpm typecheck`, the
  credential-independent parts of `pnpm test`, and `pnpm dev`/`pnpm build`)
- Docker, only if you're building/testing the production image locally

## Setup

```bash
pnpm install
cp .env.example .env
# fill in .env — see the comments in .env.example for what each
# variable is for and where to find it in the Supabase dashboard
```

## Commands

```bash
pnpm dev                 # next dev — local app at http://localhost:3000
pnpm build                # next build, then copies .next/static + public/
                          # into .next/standalone (required for "start")
pnpm start                # node .next/standalone/server.js — run a
                          # production build locally (run `pnpm build` first)
pnpm typecheck          # tsc --noEmit
pnpm test                # vitest run — integration/real-data suites
                          # skip cleanly (not fail, not silently pass)
                          # when Supabase credentials / the canonical
                          # dataset aren't available locally
pnpm test:watch          # vitest, watch mode
pnpm test:e2e             # playwright test — builds + serves the app
                          # itself; the health-check test self-skips
                          # without Supabase credentials
pnpm regulatory:verify   # Python regulatory verification gate — needs
                          # SUPABASE_DB_PASSWORD and a Python env with
                          # scripts/regulatory/requirements.txt installed
```

To build and run the production Docker image locally:

```bash
docker build --build-arg GIT_SHA=$(git rev-parse --short HEAD) -t snowkap-cbam:local .
docker run --rm -p 3000:3000 --env-file .env snowkap-cbam:local
```

CI (`.github/workflows/ci.yml`) runs `pnpm typecheck`, `pnpm test`,
`next build`, and the Playwright smoke suite against that build on
every push to `main` and every pull request, with no secrets required
(the health-check smoke test self-skips). `pnpm regulatory:verify` is
not yet part of CI — it needs live database credentials and a Python
environment, and remains a locally-run / manually-dispatched gate for
now.

## Documentation

- [`CLAUDE.md`](CLAUDE.md) — guidance for AI coding agents working in
  this repository (protected zones, layering rules, workflow model).
- [`docs/plans/MASTER_PLAN.md`](docs/plans/MASTER_PLAN.md) — the
  approved end-to-end product plan: architecture, domain model, UI/UX
  strategy, phase roadmap, and phase-by-phase contracts.
- [`docs/architecture/`](docs/architecture/) — `ARCHITECTURE.md`
  (layering rules and conventions), `DOMAIN_MODEL.md` (aggregates,
  tenancy, sharing), `DATABASE_SCHEMA.md` (the full product + regulatory
  schema as applied, 58 migrations), `AUTHORIZATION_MATRIX.md` (every
  gated service, its role/capability gate, and its proof), `MIGRATION_LOG.md`
  (every migration in order, one line each), `ENVIRONMENT.md` (every
  environment variable the codebase actually reads), and
  `REGULATORY_RESOLUTION_RULES.md` (the normative rules the resolver
  implements).
- [`docs/regulatory/SOURCE_REGISTER.md`](docs/regulatory/SOURCE_REGISTER.md)
  — the legal/data source hierarchy and provenance rules — and
  [`docs/regulatory/CALCULATION_RULE_REGISTER.md`](docs/regulatory/CALCULATION_RULE_REGISTER.md)
  — every implemented calculation rule, its citation, and its
  classification (regulatory fact / application design / future-deferred).
- [`docs/adr/`](docs/adr/) — architecture decision records.
- [`docs/runbooks/`](docs/runbooks/) — deployment, rollback, incident
  response, backup/restore, secret rotation, operational diagnostics,
  and support-access procedures (each states plainly what is locally
  verified vs. still blocked on Railway/staging access).
