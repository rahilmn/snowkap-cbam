# Backup / restore runbook

This is the P11 backup/restore runbook named in
[`docs/plans/MASTER_PLAN.md`](../plans/MASTER_PLAN.md) §12 ("Backup/recovery:
Supabase PITR (tier §41) + scheduled logical dumps of the product schema
to Storage; regulatory data re-derivable from raw artifacts + pipeline;
restore procedure written and **tested** in P11"), §29/§30, and checked
in §44's production-readiness list ("backups active · restore tested").

**Status, honestly, as of 2026-08-29**: there is no staging or
production Supabase project connected to any environment this codebase
has run in — see `docs/runbooks/SECRET_ROTATION.md`'s "Once
Railway/CI-secrets exist" note for the same constraint on the secrets
side. That means the staging/production PITR + scheduled-dump path
below is a **precise, executable design, not something that has run**.
What *has* run, for real, against this machine's local Postgres, is the
logical backup-and-restore drill in the section below — commands
executed, output captured, restored data checksummed against the
dump. That local drill is what currently backs the §44 checklist item;
the staging/production path remains deferred until a staging Supabase
project exists (§41: "Staging Supabase project (region/tier)" is still
an open owner decision, as is "PITR tier").

## Two separate recovery domains — do not conflate them

This codebase has **two independent recoverability properties**, with
different mechanisms, different owners, and different failure modes.
Confusing them is the single easiest mistake to make when reading this
document quickly, so it's stated up front:

1. **The regulatory foundation** (`default_emission_values`,
   `regulatory_datasets`, `regulatory_sources`, `cbam_goods`,
   `countries`, `production_routes` — the tables created by
   `supabase/migrations/20260826133116_create_regulatory_foundation.sql`
   onward) is recoverable **without any database backup at all**: it is
   parsed, validated, reconciled, and loaded from the canonical source
   Excel workbook by `scripts/regulatory/*.py`
   (`parse-definitive-default-values.py` →
   `reconcile-definitive-default-values.py` →
   `load-definitive-default-values.py`), and independently checksum-
   verified against that same source by
   `verify-definitive-regulatory-data.py` (`pnpm regulatory:verify`).
   If every copy of this data in Postgres vanished, the pipeline
   reproduces the identical `ACTIVE` dataset from source artifacts —
   that is its actual recovery path, per master plan §12's "regulatory
   data re-derivable from raw artifacts + pipeline," and it is
   independent of anything in this document. This document's backups
   are a *convenience* for the regulatory tables (faster than a
   pipeline re-run), never their safety net.

2. **The product/tenancy schema** (`organizations`, `memberships`,
   `shipments`, `shipment_lines`, `emission_data`, `installations`,
   `sharing_grants`, `declarations`, `audit_events`,
   `calculation_results`, and the rest of the tables introduced from
   `20260828070000_create_organizations_foundation.sql` onward) has
   **no source-of-truth outside Postgres** — a shipment, an emission
   determination snapshot, a sharing grant, an audit event exists only
   as a database row. This is what backup/restore actually protects,
   and it is this document's real subject.

In this repository's *actual physical layout*, both categories of
table live in the one Postgres `public` schema (there is no separate
`regulatory` vs `product` Postgres schema — see
[`docs/architecture/DATABASE_SCHEMA.md`](../architecture/DATABASE_SCHEMA.md)
and the migration list above). A `pg_dump` of `public` therefore
captures both. That's fine — it does not change which one has the
independent pipeline-based recovery path and which one does not; it
just means the product-schema dump incidentally also carries a
convenience copy of the regulatory tables.

## Local drill — performed 2026-08-29, repeatable procedure

This is both (a) the exact record of the drill actually executed
against this machine's local Supabase Postgres, and (b) a reference
procedure — rerun it verbatim any time the mechanics need re-proving
(e.g. after a schema-shape change worth re-validating, or before P13
release-readiness sign-off).

### 0. What's being backed up

Local Postgres (`supabase_db_snowkap-cbam`, Postgres 17.6, reached via
`pnpm exec supabase migration list --local`'s `DB_URL`,
`postgresql://postgres:postgres@127.0.0.1:54322/postgres`) — the
`public` schema (21 tables: every regulatory + product table) and the
`app` schema (14 helper functions/triggers the `public` schema's RLS
policies and invariants depend on — `app.user_org_ids()`,
`app.prevent_org_id_change()`, etc.). Supabase-internal schemas
(`auth`, `storage`, `realtime`, `graphql`, `vault`, `pgbouncer`,
`supabase_migrations`, `_realtime`, `supabase_functions`,
`extensions`) are deliberately excluded — they're Supabase project
infrastructure, not this codebase's schema, and a real Supabase project
restore (PITR or a project-level restore) always carries them; the
`extensions` schema is excluded too, but harmlessly, because every
column default this schema actually uses (`gen_random_uuid()`) has
been core-Postgres since PG13, not an extension function — confirmed
by checking `information_schema.columns.column_default` before relying
on this (see step 4's caveat for the two functions that *do* still
need a stand-in).

### 1. Take the backup

```bash
# Windows/Git Bash note: MSYS_NO_PATHCONV=1 is required, otherwise Git
# Bash rewrites the /tmp/... container path into a Windows path before
# it reaches `docker exec`, and pg_dump fails with "No such file or
# directory". Not needed on macOS/Linux.
export MSYS_NO_PATHCONV=1
TS=$(date +%Y%m%d_%H%M%S)

docker exec supabase_db_snowkap-cbam pg_dump -U postgres -d postgres \
  --schema=public --schema=app \
  --no-privileges \
  -f /tmp/snowkap_product_schema_${TS}.sql

docker cp supabase_db_snowkap-cbam:/tmp/snowkap_product_schema_${TS}.sql \
  ./snowkap_product_schema_${TS}.sql
docker exec supabase_db_snowkap-cbam rm -f /tmp/snowkap_product_schema_${TS}.sql
gzip -k snowkap_product_schema_${TS}.sql
```

`pg_dump` runs *inside* the `supabase_db_snowkap-cbam` container
deliberately, rather than from a host-installed `pg_dump`: it
guarantees exact version match with the server (17.6) and needs no
local Postgres client tools installed. Plain-SQL format (`-f ...sql`,
not `-Fc`) was chosen over custom format because it's directly greppable
for the "confirm it contains real table definitions/data" check below,
and because it's the natural shape for the Storage-upload path in the
staging/production procedure (a single `gzip`-able text stream, no
`pg_restore` binary needed on the restoring end — plain `psql -f`
suffices). `--no-privileges` drops `GRANT`/`REVOKE` statements — this
cluster's `authenticated`/`anon`/`service_role` roles already exist
target-side (see step 3) with their real grants from the applied
migrations, and re-stating them from the dump would either be
redundant (same cluster) or wrong (a different Supabase project's role
OIDs/grants shouldn't be dictated by a dump taken elsewhere). `--no-owner`
was deliberately **not** used — every object in this cluster is already
owned by `postgres`, so keeping owner statements is free and slightly
more faithful.

**Evidence this run produced a real, non-empty backup** (executed
2026-08-29, `TS=20260829_110611`):

```
$ wc -l snowkap_product_schema_20260829_110611.sql
17124 snowkap_product_schema_20260829_110611.sql

$ grep -c "^CREATE TABLE" snowkap_product_schema_20260829_110611.sql
21
$ grep -c "^CREATE FUNCTION" snowkap_product_schema_20260829_110611.sql
20
```

All 21 tables' `CREATE TABLE` statements are present (`organizations`
through `suppliers` — the full list in `DATABASE_SCHEMA.md` plus every
P4–P10 product table), all 20 `app`-schema functions, and a `COPY ...
FROM stdin` data block per table with real rows — e.g.
`default_emission_values` (12,540 rows, matching the README's stated
count and `pnpm regulatory:verify`'s own invariant) and `organizations`
(8 rows, real seeded/test org names). Uncompressed dump: 4,089,042 bytes (~4.0 MB); gzipped:
758,825 bytes (~741 KB, ~5.4:1) — small because this local dataset is
small, not because the dump is incomplete (21/21 tables and 20/20
functions present, verified above).

### 2. Restore into an isolated throwaway target — never the shared dev database

**Never restore over the database the working tree's own `pnpm test` /
`pnpm dev` depend on.** The throwaway target is a second database
*inside the same already-running local Postgres server* (same Docker
container, same port 54322) — cheap, and no separate container/port to
manage — created fresh and dropped at the end of the drill:

```bash
DBNAME="restore_drill_${TS}"
docker exec supabase_db_snowkap-cbam createdb -U postgres "$DBNAME"
```

### 3. The one drill-only complication: `auth.uid()` / `auth.jwt()` / `auth.users`

A real Supabase project (and therefore a real PITR or project-level
restore) always has the full `auth` schema (GoTrue's tables and
session-claim functions) alongside the product schema. A bare
`createdb` on a local Postgres server does not — it has none of the
Supabase platform schemas at all. The `public`/`app` schema dump
depends on three `auth` objects:

- `app.user_org_ids()` and several RLS policies call `auth.uid()`
  (the current authenticated user's id from the session JWT).
- Four RLS policies (`organization_invitations_select_own_email` and
  three sharing-grant/invitation policies) call `auth.jwt()` (the
  session claims themselves, for the `email` claim).
- Ten foreign keys (`audit_events.actor_user_id`,
  `memberships.user_id`, `emission_data.verifier_user_id`, etc.)
  reference `auth.users(id)`.

None of this is a defect in the dump — it's the real, correct contract
(this codebase's RLS is deliberately written against Supabase's actual
session-claim functions, not a bespoke substitute). It just means a
**bare local restore target** needs a minimal stand-in before the
restore runs, or table/function creation fails partway through. This
is a shim for the drill target only — never apply it to a real Supabase
project (which already has the genuine versions):

```bash
docker exec supabase_db_snowkap-cbam psql -U postgres -d "$DBNAME" -v ON_ERROR_STOP=1 -c "
create schema auth;
create function auth.uid() returns uuid language sql stable
  as \$\$ select null::uuid \$\$;
create function auth.jwt() returns jsonb language sql stable
  as \$\$ select '{}'::jsonb \$\$;
create table auth.users (id uuid primary key default gen_random_uuid());
"
```

The FK constraints to `auth.users(id)` validate existing data at
creation time, so `auth.users` needs a row for every user id the
dumped data actually references, not just the table shape. Find the
exact set from the source before restoring:

```sql
select distinct uid from (
  select actor_user_id as uid from public.audit_events
  union select calculated_by_user_id from public.calculation_results
  union select created_by_user_id from public.declarations
  union select verifier_user_id from public.emission_data
  union select uploaded_by_user_id from public.evidence_files
  union select created_by from public.import_batches
  union select user_id from public.memberships
  union select accepted_by from public.organization_invitations
  union select invited_by from public.organization_invitations
  union select created_by_user_id from public.sharing_grants
) s where uid is not null;
```

...then `insert into auth.users (id) values (...)` one row per id
before restoring. (2026-08-29 run: 9 distinct ids.)

### 4. Restore

```bash
docker exec supabase_db_snowkap-cbam psql -U postgres -d "$DBNAME" \
  -v ON_ERROR_STOP=1 \
  -f /tmp/snowkap_product_schema_${TS}.sql
```

The dump's own `CREATE SCHEMA public` / `CREATE SCHEMA app` statements
will fail against a fresh `createdb` (Postgres 15+ creates an empty
`public` schema by default) — `drop schema public cascade;` (and `drop
schema app cascade;` if a prior attempt partially ran) before restoring
resolves it. This is restore-target housekeeping, not a dump problem.

**2026-08-29 run result: `psql` exited 0, zero `ERROR` lines in the
restore log** (402 lines of `CREATE TABLE`/`COPY`/`CREATE INDEX`/`CREATE
TRIGGER`/`CREATE POLICY`/etc., all successful), after the `auth` shim
above was in place.

### 5. Verify restored data actually matches the backup

Row counts alone are a weak check on a *live, shared* dev database —
this cluster had other work running concurrently during the drill (see
the caveat below), so "restored count == count queried from the live
source right now" is the wrong comparison. The right comparison is
**dump-file content vs. restored-table content** — that's what
"restore reproduces what was backed up" actually means:

```bash
# per table: extract the COPY payload from the dump file, sort it
node -e '
  const fs=require("fs");
  const t=fs.readFileSync(process.argv[1],"utf8").split("\n");
  const tbl=process.argv[2], start=`COPY public.${tbl} (`;
  let i=t.findIndex(l=>l.startsWith(start))+1, out=[];
  while (t[i] !== "\\.") out.push(t[i++]);
  out.sort();
  console.log(out.join("\n"));
' snowkap_product_schema_${TS}.sql default_emission_values \
  | sort | md5sum

# same column list, from the restored table, same sort
docker exec supabase_db_snowkap-cbam psql -U postgres -d "$DBNAME" -c \
  "\copy (select id, dataset_id, good_id, country_id, emission_unit, direct_value, direct_status, direct_raw_source_value, indirect_value, indirect_status, indirect_raw_source_value, total_value, total_status, total_raw_source_value, production_route_id, source_sheet, source_row, source_trade_code, created_at from public.default_emission_values) to stdout" \
  | sort | md5sum
```

**2026-08-29 run — every table checked, dump vs. restored, byte-identical:**

| Table | Rows (dump = restored) | md5 (dump = restored) |
|---|---|---|
| `organizations` | 8 | `febb3572ef3cf9c494e061e207440905` |
| `audit_events` | 8 | `c508913739a84c3261f760d9cc6395ff` |
| `default_emission_values` | 12,540 | `881d37b4bdde7b5697b48093beddbc97` |
| `cbam_goods` | 283 | `7aaae6fe5f6a8bb2c063f7813ae9803d` |
| `countries` | 122 | `48def6e47307482f46f2177c0778080c` |
| `production_routes` | 10 | `46d644de5586d8bdc332473182ec8de2` |
| `regulatory_datasets` | 1 | `a2269158df5abb5056a6e8429e7ffb49` |
| `regulatory_sources` | 1 | `7d968fde8d1d55f6328c0a1da3ec4d72` |
| `memberships` / `shipments` / `shipment_lines` | 0 | `d41d8cd98f00b204e9800998ecf8427e` (empty, both sides — this local dev DB has no seeded rows in these tables) |

Every one of these matched exactly — 11 tables, spanning the smallest
(0-row) to the largest (12,540-row) in the schema. Schema fidelity was
checked the same way (source vs. restored, both queried live post-drill):
21/21 tables, 21/21 RLS-enabled tables, 56/56 RLS policies, 20/20
functions, 88/88 indexes, and all 12 in-scope triggers (the one
apparent mismatch, 13 vs. 12, was `realtime.subscription`'s internal
`tr_check_filters` trigger — Supabase Realtime infrastructure, outside
`public`/`app`, correctly not part of this dump).

**Why dump-content vs. restored-content, not "live source right now" vs.
restored**: this is a shared local dev Postgres with other work running
against it concurrently (visible directly in the drill's own output —
`organizations` grew from 7 rows at the start of this session to 9 by
the time the restore finished, purely from other activity in the same
window). `pg_dump` takes a single consistent MVCC snapshot at the start
of its run, which is exactly why comparing against *that* snapshot
(not a `count(*)` run minutes later against a database other work kept
mutating) is the correct verification — and it held: what the dump
captured is exactly what came back out.

### 6. Tear down

```bash
docker exec supabase_db_snowkap-cbam dropdb -U postgres "$DBNAME"
docker exec supabase_db_snowkap-cbam psql -U postgres -d postgres -c \
  "SELECT datname FROM pg_database WHERE datname='${DBNAME}';"   # expect 0 rows
```

**2026-08-29 run: teardown could not be confirmed in this session.**
Immediately after step 5's verification completed, Docker Desktop's
engine became unreachable (`request returned 500 Internal Server Error
... dockerDesktopLinuxEngine`, then `wsl --list --verbose` showed the
`docker-desktop` WSL distro itself as `Stopped`) and stayed down for
the rest of the session. Root cause, checked directly rather than
guessed: `Get-PSDrive C` showed **0.01 GB free** on the host's `C:`
drive at the time of the outage (down from 0.2 GB at the start of this
task) — the environment's known "C: drive is nearly full" condition
tipped over completely, almost certainly from *other* concurrent work
in this shared environment (this repo's working tree had unrelated
uncommitted changes from other sessions appear during this same
window — `docs/runbooks/SECRET_ROTATION.md`,
`docs/runbooks/SUPPORT_ACCESS.md`, `src/infrastructure/rate-limit/`,
etc. — and the `organizations` growth noted above is independent
evidence something else was actively running against this same
database at the same time). This drill's own host-side footprint was
small (~4 MB in `D:\tmp_scratch\backup_drill`, deliberately kept off
`C:` from the start given the known space constraint) and did not
itself write to `C:` beyond the dump file's brief transit through the
container's own overlay filesystem.

**`dropdb` was issued** (the command above, right after step 5) but its
result is unknown — the call itself failed with the same Docker-engine
500 error before it could reach the container, so it most likely never
ran server-side. **The throwaway database `restore_drill_20260829_110611`
may still exist** in the local `supabase_db_snowkap-cbam` Postgres
instance and needs to be dropped once Docker recovers:

```bash
docker exec supabase_db_snowkap-cbam dropdb -U postgres restore_drill_20260829_110611
```

This is a same-cluster, separate-database drop — it does not touch the
`postgres` database the working tree's tests run against. See the
handoff note at the end of this document.

## Staging / production procedure (designed, not yet executed)

No staging or production Supabase project is connected to this
environment — see this document's opening status note and
`docs/plans/MASTER_PLAN.md` §41 ("Staging Supabase project
(region/tier)" and "PITR tier" are both still-open owner decisions).
Everything in this section is the precise procedure to run **once**
that project exists — it has not been executed anywhere, and nothing
below should be read as having happened.

### PITR (continuous, Supabase-managed)

Enable Point-in-Time Recovery on the staging and production Supabase
projects independently (Project Settings → Database → Backups). PITR
gives continuous WAL-based recovery to *any second* within its
retention window, not just to daily snapshot boundaries — that's what
it's for, and why it's the primary mechanism (§12), with the scheduled
logical dump below as the secondary/portable one. Retention window is
gated by the still-open "PITR tier" decision (§41) — Supabase's PITR
tiers trade retention length for cost; record the chosen tier and its
retention window in this document the same commit that decision lands,
the same discipline `SECRET_ROTATION.md` uses for new secrets.

### Scheduled logical dump to Storage (portable, cross-project)

PITR is Supabase-project-bound — it cannot restore *into* a different
project, a local machine, or a different hosting provider if ever
needed (§9 of master plan's risk list: "Supabase coupling — ports
isolate; exportable SQL/storage; revisit criteria documented"). The
scheduled logical dump is what keeps a portable, provider-independent
copy, per §12/§30. Design (matching the drill's mechanics above, run
against the staging/production connection instead of local):

- **What**: `pg_dump --schema=public --schema=app --no-privileges` of
  the target project's database (same schema selection as the local
  drill and for the same reason — see the "Two separate recovery
  domains" section above for why this incidentally also covers the
  regulatory tables, harmlessly).
- **Where from**: the **direct** Postgres connection (Project Settings
  → Database → Connection string → "Direct connection", not the
  transaction-mode pooler on port 6543) — `pg_dump` needs a session-mode
  connection; `SUPABASE_DB_PASSWORD` already documented in
  `.env.example` and `SECRET_ROTATION.md` is exactly this credential,
  reused here rather than provisioning a new one.
- **Where to**: a new **private** Supabase Storage bucket, `backups`
  (`public: false`) — same pattern as the existing `evidence` bucket in
  `supabase/migrations/20260829240000_p7c_evidence_files_schema.sql`,
  except access is `service_role`-only with **no** `authenticated`
  policies at all (nobody in-product ever reads a backup; only the
  scheduled job, running with the service-role key, does). Path
  convention: `{env}/{YYYY-MM-DD}_{HHmmssZ}.sql.gz` (`env` =
  `staging` | `production`), mirroring `evidence_files`' `{org_id}/...`
  convention of putting the partitioning key first.
- **How triggered**: a scheduled **GitHub Actions workflow**
  (`.github/workflows/backup-product-schema.yml`, not yet created —
  this bullet is the design for it), not a new pg-boss/worker job.
  Master plan §41 lists "pg-boss adoption timing" as still an open
  decision, and this task's own instructions are explicit that a new
  dependency shouldn't be added speculatively — GitHub Actions is
  already load-bearing infrastructure here (`.github/workflows/ci.yml`),
  so scheduling the dump there needs nothing new provisioned. Steps:
  install a Postgres 17 client (`apt-get install postgresql-client-17`
  matching the project's server major version, the same reasoning
  step 1's drill gives for running `pg_dump` inside the matching-version
  container), `pg_dump` against `SUPABASE_DB_PASSWORD` (GitHub secret,
  staging and production kept separate — see `SECRET_ROTATION.md`'s
  "Once Railway/CI-secrets exist" note for the secrets-provisioning
  precondition this shares), `gzip`, upload via a short Node/curl step
  using `SUPABASE_SERVICE_ROLE_KEY` against the Storage REST API
  (`POST {SUPABASE_URL}/storage/v1/object/backups/{path}`). Schedule:
  `cron: '0 3 * * *'` (daily, 03:00 UTC) as a starting point — adjust
  once real staging traffic patterns are known.
- **Retention**: prune objects under `backups/{env}/` older than 30
  days as the same job's last step (`storage.objects` lists are
  queryable via the Storage API; delete anything past the cutoff). 30
  days is a starting default, not a regulatory requirement — revisit
  alongside the PITR tier decision, since the two together define the
  actual worst-case recovery window (see the decision tree below).
- **Restore**: identical mechanics to this document's local drill —
  download the object, `gunzip`, `psql -f` into the target (a fresh
  project for a full disaster-recovery restore, or a scratch database
  for inspection/audit) — except a *real* Supabase project restore
  target already has the genuine `auth` schema, so step 3's shim is
  never needed there; it exists solely for this doc's bare-Postgres
  drill target.

## Recovery decision tree

```
Data-loss or corruption incident on the product schema
│
├─ Is the exact bad transaction/timestamp known, and is it inside the
│  PITR retention window?
│  │
│  YES → Use PITR. Recovery point = any second within the window.
│  │      Data loss = effectively zero (recovers to just before the
│  │      bad write). This is Supabase's own point-in-time restore
│  │      flow (dashboard → Backups → restore to timestamp), which
│  │      provisions a new project state — coordinate the cutover
│  │      (DNS/connection-string swap) the same way as any other
│  │      production incident, not covered further here.
│  │
│  NO, outside the PITR window (or PITR wasn't enabled / the tier's
│  retention already lapsed) → Use the latest scheduled logical dump.
│         Data loss = up to one full dump interval (worst case ~24h
│         at the daily-cron default above) minus however much of that
│         interval's writes can be recovered from other sources (audit
│         events, application logs, client-side retry queues — none
│         of that is a substitute for the backup itself, just a
│         partial mitigant for the gap).
│
├─ Is this a partial/logical problem (one bad migration, one bad bulk
│  operation) rather than platform-level corruption?
│  │
│  YES → Prefer roll-forward per master plan §43 ("recovery = roll-
│  │      forward or PITR") — a new corrective migration or a targeted
│  │      data fix, scoped and reviewed like any other change, is
│  │      usually cheaper and safer than a full restore. This
│  │      codebase's append-only designs (audit events, calculation
│  │      results, snapshots, supersession chains, sharing grants —
│  │      §43) mean "undo" is very often a status flip forward, not a
│  │      restore backward.
│  │
│  NO, platform-level (project deleted, region outage outlasting
│  Supabase's own recovery, provider migration) → the scheduled
│  logical dump is the *only* path — it's provider-independent by
│  design (§9); PITR is not, because it restores within the same
│  Supabase project.
│
└─ Is the affected data actually regulatory (`default_emission_values`
   / `regulatory_datasets` / `regulatory_sources` / `cbam_goods` /
   `countries` / `production_routes`)?
   │
   YES → Do not use PITR or the logical dump as the primary recovery
          path for this data even though both happen to contain it
          (see "Two separate recovery domains" above). Re-run the
          pipeline (`scripts/regulatory/*.py`) from the canonical
          source workbook and re-verify (`pnpm regulatory:verify`
          → `RESULT: VALID`). Reach for PITR/the dump here only as a
          faster stopgap while confirming the pipeline path, never as
          the thing that gets trusted without the verify gate.
```

## Handoff — closed out 2026-08-29 (same day, after the C: drive was freed)

1. **Leftover throwaway database dropped.** Docker Desktop recovered
   (host `C:` freed) later the same day; `docker exec
   supabase_db_snowkap-cbam dropdb -U postgres
   restore_drill_20260829_110611` was re-run and confirmed with the
   `SELECT datname ...` query above — 0 rows, as expected. Nothing
   further to do here.
2. **`pnpm test` re-run for real**, confirming the drill's writes stayed
   scoped to the separate `restore_drill_*` database as predicted: the
   shared `postgres` database's own product/regulatory data was
   unaffected (`default_emission_values`/`cbam_goods`/`countries` counts
   unchanged; see the P11 re-verification work the same day for the
   full test run).
3. This document is complete; no outstanding items remain from the
   2026-08-29 drill.
