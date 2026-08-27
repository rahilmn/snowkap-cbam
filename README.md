# Snowkap CBAM

A CBAM (EU Carbon Border Adjustment Mechanism) compliance platform:
shipment intake, classification, regulatory emissions resolution,
embedded-emissions calculation, and reporting/declaration preparation —
serving both importer/declarant organizations and third-country
producer/operator organizations on one platform. See
[`docs/plans/MASTER_PLAN.md`](docs/plans/MASTER_PLAN.md) for the full
product plan and phase roadmap.

**Current state**: the regulatory foundation (below) is built and
verified. The product application (UI, API, tenancy, shipments,
calculation engine) is in active development per the phase roadmap —
see the master plan for what exists today versus what's planned.

## What's here today

- **Regulatory subsystem** (`src/domain/regulatory/`,
  `src/infrastructure/regulatory/`) — a pure resolver implementing the
  documented rules in
  [`docs/architecture/REGULATORY_RESOLUTION_RULES.md`](docs/architecture/REGULATORY_RESOLUTION_RULES.md),
  reading from a Supabase-hosted, checksum-verified CBAM default
  emission values dataset (12,540 records; see
  [`docs/architecture/DATABASE_SCHEMA.md`](docs/architecture/DATABASE_SCHEMA.md)).
  This subsystem is **protected** — see `CLAUDE.md`.
- **Product domain model** (`src/domain/{organizations,shipments,emissions,installations,calculations,audit,sharing}/`)
  — types plus pure invariant/lifecycle functions for the aggregates
  described in
  [`docs/architecture/DOMAIN_MODEL.md`](docs/architecture/DOMAIN_MODEL.md).
  No persistence yet.
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
- A Supabase project (for anything beyond `pnpm typecheck` and the
  credential-independent parts of `pnpm test`)

## Setup

```bash
pnpm install
cp .env.example .env
# fill in .env — see the comments in .env.example for what each
# variable is for and where to find it in the Supabase dashboard
```

## Commands

```bash
pnpm typecheck          # tsc --noEmit
pnpm test                # vitest run — integration/real-data suites
                          # skip cleanly (not fail, not silently pass)
                          # when Supabase credentials / the canonical
                          # dataset aren't available locally
pnpm test:watch          # vitest, watch mode
pnpm regulatory:verify   # Python regulatory verification gate — needs
                          # SUPABASE_DB_PASSWORD and a Python env with
                          # scripts/regulatory/requirements.txt installed
```

CI (`.github/workflows/ci.yml`) runs `pnpm typecheck` and `pnpm test`
on every push to `main` and every pull request, with no secrets
required. `pnpm regulatory:verify` is not yet part of CI — it needs
live database credentials and a Python environment, and remains a
locally-run / manually-dispatched gate for now.

## Documentation

- [`CLAUDE.md`](CLAUDE.md) — guidance for AI coding agents working in
  this repository (protected zones, layering rules, workflow model).
- [`docs/plans/MASTER_PLAN.md`](docs/plans/MASTER_PLAN.md) — the
  approved end-to-end product plan: architecture, domain model, UI/UX
  strategy, phase roadmap, and phase-by-phase contracts.
- [`docs/architecture/`](docs/architecture/) — `ARCHITECTURE.md`
  (layering rules and conventions), `DOMAIN_MODEL.md` (aggregates,
  tenancy, sharing), `DATABASE_SCHEMA.md` (the regulatory schema as
  applied), `REGULATORY_RESOLUTION_RULES.md` (the normative rules the
  resolver implements).
- [`docs/regulatory/SOURCE_REGISTER.md`](docs/regulatory/SOURCE_REGISTER.md)
  — the legal/data source hierarchy and provenance rules.
- [`docs/adr/`](docs/adr/) — architecture decision records.
