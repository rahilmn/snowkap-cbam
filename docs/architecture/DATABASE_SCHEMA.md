# Database Schema

This document describes the schema created by `supabase/migrations/`, as
applied. It covers only the **regulatory foundation** — the versioned
reference-data layer. No product/business schema exists yet; product
tables (organizations, shipments, emission data, ...) are introduced
starting in Phase 3, tenancy-first, per
[`docs/plans/MASTER_PLAN.md`](../plans/MASTER_PLAN.md) and
[`DOMAIN_MODEL.md`](./DOMAIN_MODEL.md) (which includes the DDL template
that first migration will follow).

This subsystem is **protected**: see the "Protected Regulatory
Foundation" rules in [`CLAUDE.md`](../../CLAUDE.md). Any schema change
here needs its own explicit justification, TDD where behavior is
involved, and a passing `pnpm regulatory:verify` afterward.

## Migrations, in order

| Migration | Purpose |
|---|---|
| `20260826133116_create_regulatory_foundation.sql` | Creates the six regulatory tables, their constraints and indexes, and enables RLS on all of them (no policies yet). |
| `20260827093000_support_regulatory_geography.sql` | Adds `countries.country_type` so the `_Other Countries and Territorie` fallback geography can be represented without inventing an ISO identity. |
| `20260827110000_activate_definitive_regulatory_dataset.sql` | Data-only: flips the `2026-definitive-corrected` dataset from `DRAFT` to `ACTIVE`, after asserting it has exactly 12,540 emission rows. |
| `20260827130000_harden_regulatory_emission_uniqueness.sql` | Adds the two partial unique indexes that enforce regulatory record identity (dataset + country + good [+ route]). |

## Tables

### `regulatory_sources`

The legal/document provenance for everything else — a CBAM regulation,
implementing act, official dataset, Commission guidance, or a documented
Snowkap assumption.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `source_type` | `text` | one of `REGULATION`, `IMPLEMENTING_REGULATION`, `OFFICIAL_DATASET`, `COMMISSION_GUIDANCE`, `SNOWKAP_ASSUMPTION` |
| `document_code` | `text` | e.g. the regulation number |
| `title` | `text` | |
| `official_url` | `text` | nullable |
| `publication_date` | `date` | nullable |
| `effective_from` / `effective_to` | `date` | `effective_to` nullable; `effective_to >= effective_from` when set |
| `version` | `text` | |
| `created_at` | `timestamptz` | default `now()` |

Unique on `(document_code, version)`.

### `regulatory_datasets`

One versioned dataset drawn from a source — e.g. the CBAM default
emission values, version `2026-definitive-corrected`. Every dataset type
this project will ever load (current or future) is a row here.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `source_id` | `uuid` | FK → `regulatory_sources`, `on delete restrict` |
| `dataset_type` | `text` | one of `CBAM_GOODS`, `DEFAULT_EMISSION_VALUES`, `CBAM_BENCHMARKS`, `CBAM_FACTORS`, `CSCF`, `CERTIFICATE_PRICES`, `COUNTRIES`, `EXEMPTIONS` — the enum already anticipates the future parameter-dataset types the calculation engine will read (see the master plan's "facts-as-datasets" rule) |
| `version` | `text` | |
| `effective_from` / `effective_to` | `date` | `effective_to` nullable |
| `source_file_name` | `text` | nullable |
| `source_checksum` | `text` | nullable; the SHA-256 of the source workbook for the active default-values dataset |
| `status` | `text` | `DRAFT` (default) → `ACTIVE` → `SUPERSEDED` |
| `imported_at` | `timestamptz` | nullable |
| `created_at` | `timestamptz` | default `now()` |

Unique on `(source_id, dataset_type, version)`. Indexed on `source_id`
and on `(dataset_type, status)` — the second is what lets the adapter
efficiently assert "exactly one ACTIVE dataset of this type."

**Only one row per `dataset_type` should ever be `ACTIVE`** — this is
enforced by application code (`SupabaseRegulatoryRepository` throws if
it finds more than one), not by a DB constraint, because a
`SUPERSEDED`+`ACTIVE` transition needs a brief window where the old row
is still `ACTIVE` while the new one activates. See the activation
migration below for the pattern.

### `countries`

The geography reference, including the CBAM fallback territory.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `iso2` | `text` | nullable (see below); format `^[A-Z]{2}$` |
| `iso3` | `text` | nullable (see below); format `^[A-Z]{3}$` |
| `name` | `text` | unique |
| `official_name` | `text` | nullable |
| `active` | `boolean` | default `true` |
| `country_type` | `text` | `COUNTRY` (default) or `OTHER_TERRITORIES` |
| `created_at` | `timestamptz` | default `now()` |

Constraints: `iso2`/`iso3` each unique when present; a consistency check
requires both ISO fields set for `country_type = 'COUNTRY'` and both
`NULL` for `'OTHER_TERRITORIES'`; a partial unique index allows at most
one `OTHER_TERRITORIES` row; and `countries_other_territories_name_ck`
pins that row's name to the literal `_Other Countries and Territorie`
(note: truncated, no trailing "s" — copied verbatim from the source
workbook's column header; see
[`REGULATORY_RESOLUTION_RULES.md`](./REGULATORY_RESOLUTION_RULES.md)
Rule R7 for the fallback semantics this row exists to support).

### `production_routes`

CBAM production routes (e.g. `(C)` = a specific steelmaking route).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `code` | `text` | |
| `name` | `text` | |
| `sector` | `text` | one of `CEMENT`, `FERTILISERS`, `IRON_STEEL`, `ALUMINIUM`, `HYDROGEN`, `ELECTRICITY` |
| `source_route_indicator` | `text` | nullable; the raw indicator as it appears in the source workbook (e.g. `"(C)"`) — this is what the resolver's `production_route` input actually matches against, not `name` |
| `source_id` | `uuid` | FK → `regulatory_sources`, `on delete restrict`, nullable |
| `effective_from` / `effective_to` | `date` | both nullable |
| `created_at` | `timestamptz` | default `now()` |

Unique on `(code, effective_from)`. Indexed on `code` and `sector`.

### `cbam_goods`

The CBAM goods/classification hierarchy — HS headings and subheadings
down to concrete CN/TARIC trade goods.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `trade_code` | `text` | format depends on `trade_code_type` (see below) |
| `trade_code_type` | `text` | `HS_HEADING` (4 digits), `HS_SUBHEADING` (6 digits), `CN` (8 digits), `TARIC` (10 digits) |
| `record_type` | `text` | `CLASSIFICATION` or `TRADE_GOOD` |
| `record_level` | `text` | `HS_HEADING`, `HS_SUBHEADING`, or `TRADE_GOOD` |
| `parent_good_id` | `uuid` | self-FK, `on delete restrict`, nullable |
| `sector` | `text` | same six-sector enum as `production_routes.sector` |
| `description` | `text` | |
| `functional_unit` | `text` | `TONNES` or `MWH`, nullable |
| `active_from` / `active_to` | `date` | both nullable |
| `created_at` | `timestamptz` | default `now()` |

`cbam_goods_classification_consistency_ck` binds `trade_code_type` ↔
`record_type` ↔ `record_level` together (e.g. `CN`/`TARIC` codes must be
`record_type = 'TRADE_GOOD'`, `record_level = 'TRADE_GOOD'`).
`cbam_goods_trade_code_format_ck` enforces the digit-count per type.
Unique index `cbam_goods_identity_uq` on
`(trade_code, trade_code_type, coalesce(active_from, '1900-01-01'))` —
the `coalesce` lets a future re-versioned record with an explicit
`active_from` coexist with an original NULL-dated one without colliding.
Indexed on `trade_code`, `trade_code_type`, `sector`, `parent_good_id`.

### `default_emission_values`

The 12,540-row ACTIVE dataset — one row per (dataset, country, good
[, route]) combination, carrying direct/indirect/total emission values.
This is the table the regulatory resolver reads through
`SupabaseRegulatoryRepository`.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `dataset_id` | `uuid` | FK → `regulatory_datasets`, `on delete restrict` |
| `good_id` | `uuid` | FK → `cbam_goods`, `on delete restrict` |
| `country_id` | `uuid` | FK → `countries`, `on delete restrict` |
| `emission_unit` | `text` | `TCO2E_PER_TONNE` or `TCO2_PER_MWH` |
| `direct_value` | `numeric` | nullable (see consistency check) |
| `direct_status` | `text` | `AVAILABLE`, `NOT_APPLICABLE`, `UNAVAILABLE`, `REFERENCE_REQUIRED`, `SOURCE_TEXT` |
| `direct_raw_source_value` | `text` | nullable; the value exactly as it appeared in the source (e.g. `"-"`, `"see below"`) |
| `indirect_value` / `indirect_status` / `indirect_raw_source_value` | | same shape as `direct_*` |
| `total_value` / `total_status` / `total_raw_source_value` | | same shape as `direct_*` |
| `production_route_id` | `uuid` | FK → `production_routes`, `on delete restrict`, nullable — `NULL` means the row is route-independent |
| `source_sheet` | `text` | nullable; provenance |
| `source_row` | `integer` | nullable; provenance; `> 0` when present |
| `source_trade_code` | `text` | nullable; the code exactly as it appeared in the source, pre-normalization (e.g. `"2507 00 80 80"`) |
| `created_at` | `timestamptz` | default `now()` |

Three consistency `CHECK` constraints (`*_consistency_ck`, one per
direct/indirect/total) enforce the biconditional
`status = 'AVAILABLE' ⟺ value is not null` — this is the database-level
half of the "never convert an unavailable value to zero" rule; the
resolver's own logic is the other half.

**Identity** (added by the fourth migration, since Postgres `NULL`
never equals another `NULL` in a unique index — two separate partial
indexes are required to express one identity rule):

- `default_emission_values_route_identity_uq` — unique on
  `(dataset_id, country_id, good_id, production_route_id)`
  `where production_route_id is not null`
- `default_emission_values_route_independent_identity_uq` — unique on
  `(dataset_id, country_id, good_id)`
  `where production_route_id is null`

Indexed on `dataset_id`, `good_id`, `country_id`, `production_route_id`
individually, plus a composite `default_emission_values_lookup_idx` on
`(dataset_id, country_id, good_id)` — this composite is what
`SupabaseRegulatoryRepository`'s step-4 query shape matches.

## Row Level Security

RLS is **enabled on all six tables**, with **zero policies** as of this
migration set — meaning only the `service_role` key (which bypasses
RLS) can read them today. This is deliberate, not an oversight: read
policies for `authenticated` are deferred until the backend/API access
model exists (Phase 3 of the master plan adds them, alongside the
product schema's own tenancy-aware RLS). See the foundation migration's
own comment (section 8) and
[`ARCHITECTURE.md`](./ARCHITECTURE.md) for the access-mode rationale.

## Dataset activation pattern

`default_emission_values` rows are bulk-loaded by
`scripts/regulatory/load-definitive-default-values.py` while their
owning `regulatory_datasets` row is still `DRAFT`. The dataset is only
flipped to `ACTIVE` by a **migration** (`20260827110000_...sql`), inside
an explicit transaction, and only after asserting: the dataset exists,
its status is currently `DRAFT`, and it has exactly the expected row
count (`12540`, hardcoded for this specific dataset version — a future
dataset version's activation migration will assert its own expected
count). This means "the dataset is ACTIVE" is itself a fact recorded in
version control, not a manual `UPDATE` run against production.

## What is intentionally absent

No `organizations`, `users`, tenancy, calculations, or application
tables exist in this schema — the foundation migration's own header
comment says so explicitly. Product schema begins at Phase 3; see
[`DOMAIN_MODEL.md`](./DOMAIN_MODEL.md) for the target shape (including
an RLS-ready DDL template) and
[`docs/plans/MASTER_PLAN.md`](../plans/MASTER_PLAN.md) §12 for the full
rationale on why no product migration lands before then.
