# Database Schema

> **Living document.** Per `docs/plans/MASTER_PLAN.md`'s own framing (§ status
> banner: "`docs/architecture/` ... living documents (`ARCHITECTURE.md`,
> `DOMAIN_MODEL.md`, `DATABASE_SCHEMA.md`) that get updated as each phase
> lands"), this file tracks the schema **as it actually exists**, not a
> point-in-time snapshot of one phase. The body below was regrounded
> against the applied schema on 2026-08-29 through migration
> `20260829440000_p11_review_shipment_lines_numeric_format_ck.sql`
> (39 migrations); **the "P13 additions" section near the end of this
> document covers the five migrations applied since**
> (`20260829450000`–`20260829490000`, 44 migrations total as of this
> update — see [`MIGRATION_LOG.md`](./MIGRATION_LOG.md) for the full
> ordered list). Read both: the body for the schema's shape, the P13
> section for what changed on top of it. Update this document as new
> migrations land — do not let it drift back into describing an earlier
> phase as if it were current.

This document covers the **entire** applied `public` schema: the protected
regulatory foundation (6 tables) and the full product schema (15 tables + 1
view) built on top of it across phases P3–P11. Row Level Security is enabled
on every table in both groups, and — contrary to an earlier version of this
document — the product schema is **not** a future phase: it exists today,
with 56 RLS policies, ~16 `app`-schema helper functions, 6 `public`-schema
SECURITY DEFINER RPCs, and 13 triggers already applied and exercised by the
integration test suite.

The regulatory tables remain **protected** per
[`docs/adr/ADR-0005-protected-regulatory-subsystem.md`](../adr/ADR-0005-protected-regulatory-subsystem.md)
and the rules in [`CLAUDE.md`](../../CLAUDE.md). The product tables are
ordinary application schema, evolved the same way as everything else in this
codebase: TDD, one conceptual change per migration, forward-only (an applied
migration is never edited in place — a correction is a new migration that
`drop`s and re-`create`s the affected policy/function/constraint).

## Migrations, in order

39 migrations, applied in filename order. Grouped by phase below for
readability; every filename is the authoritative, individually-traceable
unit — `supabase_migrations.schema_migrations` records each one separately.
A `_review` / `_reviewN` migration is a mandatory-review response fix
against an **already-applied** migration from the same or an earlier phase,
not a revision of that file (per `CLAUDE.md`'s forward-only rule).

### Regulatory foundation (protected — see above)

| Migration | Purpose |
|---|---|
| `20260826133116_create_regulatory_foundation.sql` | Creates the six regulatory tables, their constraints and indexes, and enables RLS on all of them (no policies yet). |
| `20260827093000_support_regulatory_geography.sql` | Adds `countries.country_type` so the `_Other Countries and Territorie` fallback geography can be represented without inventing an ISO identity. |
| `20260827110000_activate_definitive_regulatory_dataset.sql` | Data-only: flips the `2026-definitive-corrected` dataset from `DRAFT` to `ACTIVE`, after asserting it has exactly 12,540 emission rows. |
| `20260827130000_harden_regulatory_emission_uniqueness.sql` | Adds the two partial unique indexes that enforce regulatory record identity (dataset + country + good [+ route]). |

### P3 — organizations, tenancy, invitations

| Migration | Purpose |
|---|---|
| `20260828070000_create_organizations_foundation.sql` | `organizations`, `memberships`, `audit_events` tables; `app.user_org_ids()`; SELECT-only RLS (write policies deliberately deferred — see table). |
| `20260828080000_organization_onboarding_rpc.sql` | `create_organization_with_owner()` RPC (atomic org + OWNER membership insert); `organizations` UPDATE policy for ADMIN/OWNER. |
| `20260828090000_audit_organization_creation.sql` | Redefines `create_organization_with_owner()` to also insert an `organization.created` audit event in the same transaction. |
| `20260828100000_authenticated_read_regulatory_data.sql` | First authenticated-role SELECT policies on the six regulatory tables (protected-zone access change, not a data change — see file header). |
| `20260828110000_membership_management_policies.sql` | `app.user_is_admin_or_owner_of()`; `memberships` UPDATE/DELETE policies (ADMIN/OWNER-only). |
| `20260828120000_list_org_members_rpc.sql` | `list_org_members()` RPC — exposes each member's email (from `auth.users`) alongside their role. |
| `20260828130000_organization_invitations.sql` | `organization_invitations` table; its RLS; `accept_organization_invitation()` RPC. |
| `20260828140000_organization_visible_via_pending_invitation.sql` | Additive `organizations` SELECT policy so an invited-but-not-yet-member user can see the org name. |

### P4 — shipment intake

| Migration | Purpose |
|---|---|
| `20260828150000_p4_shipment_intake_schema.sql` | `suppliers`, `shipments`, `shipment_lines`, `import_batches` tables and their RLS; first authenticated-role INSERT policy on `audit_events`. |
| `20260829090000_p4_shipment_tenancy_hardening.sql` | `app.prevent_org_id_change()` / `app.prevent_shipment_line_reparent()` triggers (closes an org-reassignment gap found by adversarial review); adds `cn_code`/`cn_code_level` consistency check; ADMIN/OWNER-only LOCK. |

### P5 — emission determination (regulatory resolution on lines)

| Migration | Purpose |
|---|---|
| `20260829150000_p5_emission_determination_generated_columns.sql` | Adds `determination_method` / `resolution_reason` / `dataset_version` generated columns (unpacked from `shipment_lines.emission_determination` jsonb) plus their partial indexes. |

### P6 — calculation results

| Migration | Purpose |
|---|---|
| `20260829180000_p6_calculation_results_schema.sql` | `calculation_results` table (append-only) and its RLS. |
| `20260829200000_p6_calculation_results_hardening.sql` | LOCKED/VOID shipments now reject new calculations; `calculated_at` uses `clock_timestamp()` not `now()`; adds the `latest_calculation_results` view. |

### P7 — installations, operators, actual emissions, evidence, sharing

| Migration | Purpose |
|---|---|
| `20260829220000_p7_installations_operators_schema.sql` | `operators`, `installations` tables and their RLS; adds the announced `suppliers.linked_operator_id` FK. |
| `20260829230000_p7b_emission_data_schema.sql` | `emission_data` table, its two lifecycle triggers (fact-change guard, ADMIN+ verification gate), and its RLS. |
| `20260829240000_p7c_evidence_files_schema.sql` | Relaxes `evidence_file_ids` out of `emission_data`'s fact-change guard; adds `EVIDENCE_FILE` to the audit aggregate-type catalog; `evidence_files` table + RLS; `evidence` storage bucket + `storage.objects` RLS. |
| `20260829260000_p7d_sharing_grants_schema.sql` | `sharing_grants` table (direct-grant case only), its fact-change trigger, its RLS; `app.user_shared_installation_ids()`; widens `installations`/`emission_data` SELECT for a grantee org. |
| `20260829270000_p7_review_fk_hardening.sql` | Mandatory-review fix: `emission_data.installation_id` / `sharing_grants.installation_id` FKs `CASCADE → RESTRICT`; `emission_data.verifier_user_id` FK `SET NULL → RESTRICT` plus a new "VERIFIED implies a verifier" CHECK. |
| `20260829280000_p7_review_updated_at_trigger.sql` | `app.touch_updated_at()` generic trigger, attached to `emission_data` and `sharing_grants` (their `updated_at` had never actually moved). |
| `20260829290000_p7_review_version_lineage_hardening.sql` | `emission_data_version_uq` / `emission_data_predecessor_id_uq` — DB-level backstop against a version/lineage-fork bug fixed at the application layer in the same review. |
| `20260829300000_p7d2_sharing_grant_email_bootstrap.sql` | Sharing-grant bootstrap-by-email path: new constraints, `accept_sharing_grant_invitation()` RPC, three pending-invitation SELECT policies, `app.installation_has_pending_sharing_grant_invitation()`. |
| `20260829310000_p7d3_shared_data_consumption_audit.sql` | `record_shared_data_consumption()` RPC — records a cross-org "your data was consumed" audit event into the **grantor's** own audit stream. |
| `20260829320000_p7d4_shared_data_status_grantee_visibility.sql` | `organizations_select_via_own_issued_sharing_grant` — lets a grantor resolve the grantee org's name for an **ACTIVE** grant only (a same-migration security fix; the first draft was unscoped and leaked arbitrary orgs' rows). |

### P9 — declarations

| Migration | Purpose |
|---|---|
| `20260829330000_p9_declarations_schema.sql` | `declarations` table, `app.prevent_declaration_fact_change()`, its RLS (exactly one UPDATE policy, by design), and `record_declaration_filed()` RPC. |
| `20260829340000_p9_declarations_insert_policy_recursion_fix.sql` | Fixes a live `42P17` infinite-recursion bug in `declarations_insert_own_org` (a raw `EXISTS` against `declarations` from inside its own policy) via `app.declaration_predecessor_matches()`. |
| `20260829350000_p9_declaration_filed_membership_and_completeness_fix.sql` | Fixes a live bug where a member shipment emptied of its only line after `READY` silently vanished from the filed snapshot instead of blocking filing; documents `completeness_report` as advisory, not attested. |

### P10 — membership deactivation

| Migration | Purpose |
|---|---|
| `20260829360000_p10_membership_deactivation.sql` | Adds `memberships.deactivated_at`; redefines `app.user_org_ids()` / `app.user_is_admin_or_owner_of()` to exclude deactivated rows; routes four SECURITY DEFINER functions through those helpers instead of raw membership subqueries. |
| `20260829370000_p10_review_response_membership_user_id_immutable.sql` | Mandatory-review fix: `app.prevent_membership_user_id_change()` trigger — a bare `UPDATE` could previously reassign a membership row to a different `auth.users` id. |

### P11 — mandatory security review hardening

| Migration | Purpose |
|---|---|
| `20260829380000_p11_review_email_confirmation_and_invitation_hardening.sql` | **BLOCKING** finding: email-claim authorization (`auth.jwt() ->> 'email'`) was valid even for an unconfirmed address. Adds `app.user_confirmed_email()`; tightens two `organization_invitations`/`organizations` policies and `accept_organization_invitation()` to require it, plus an `expires_at` check and an org-id-leak fix on `EMAIL_MISMATCH`. |
| `20260829390000_p11_review_sharing_grant_email_and_expiry_hardening.sql` | Mirrors the previous migration's fixes onto `sharing_grants`' three pending-invitation policies and `accept_sharing_grant_invitation()`; adds an expiry check to `sharing_grants_update_grantee_accept` (a bare CAS UPDATE could accept an already-expired grant). |
| `20260829400000_p11_review_declaration_filed_membership_oracle_fix.sql` | `record_declaration_filed()` was a cross-org existence oracle (NOT_FOUND vs. NOT_ADMIN disclosed whether a declaration id existed in another org). Fixed by checking membership first and returning NOT_FOUND for a non-member. |
| `20260829410000_p11_review_evidence_storage_path_and_uuid_cast_hardening.sql` | Adds `evidence_files_storage_path_org_prefix_ck` (a forged `storage_path` could point at a different org's prefix); replaces a bare `::uuid` cast in the storage RLS with `app.try_cast_uuid()` (a malformed object name could take every user's evidence reads offline app-wide). |
| `20260829420000_p11_review_membership_org_id_immutable.sql` | Attaches the existing `app.prevent_org_id_change()` trigger to `memberships` (a dual-org admin could relocate a colleague's membership into a different org via a bare UPDATE). |
| `20260829430000_p11_review_audit_events_event_type_catalog.sql` | `audit_events_insert_own_org_as_self` now also requires `event_type` to be in an explicit catalog — a plain MEMBER could previously forge an arbitrary `event_type`/`payload` (reproduced live with a forged `declaration.filed` row). |
| `20260829440000_p11_review_shipment_lines_numeric_format_ck.sql` | Adds canonical-decimal-grammar CHECK constraints to `shipment_lines.net_mass_tonnes`/`quantity_mwh`, mirroring `emission_data`'s existing ones (`::numeric` alone accepted non-canonical forms like `'1e40'`, `'1_0'`, `'  42  '`). |

## Schema-wide conventions

These recur across nearly every product table; called out once here instead
of re-explained per table.

- **Regulated numerics are always `text`**, matching
  `src/domain/shared/decimal.ts`'s `DecimalString` convention end to end —
  never a native `numeric`/`decimal` column for a value that flows through
  the domain layer (`net_mass_tonnes`, `quantity_mwh`,
  `embedded_emissions_tco2e`, `direct_specific`/`indirect_specific`, ...).
  A `CHECK` constraint casts to `numeric` only for validation (a canonical
  decimal-grammar regex, plus a sign/positivity bound where applicable).
- **`org_id` denormalization**: a child table one or more joins away from
  `organizations` (e.g. `shipment_lines.org_id`, `installations.org_id`,
  `emission_data.entered_by_org_id`) carries its own copy of the owning
  org id rather than requiring a join on every RLS check. The INSERT
  policy cross-validates it against the real parent via an `EXISTS`
  clause, and — where a bare `UPDATE` could otherwise smuggle a changed
  value past `WITH CHECK` (which cannot see the pre-update row) — a
  `BEFORE UPDATE` trigger (`app.prevent_org_id_change()`, reused across
  `shipments`, `shipment_lines`, `suppliers`, and `memberships`) pins it
  immutable.
- **Two-wall RLS + trigger pattern**: `WITH CHECK` can only ever inspect
  the *proposed new row* — it cannot compare against what a column held
  before the `UPDATE`. Wherever that distinction matters (tenancy columns,
  "fact" columns on a row with a lifecycle, filing/verification gates),
  a `BEFORE UPDATE` trigger is the second, independent wall. See
  `app.prevent_org_id_change()`, `app.prevent_membership_user_id_change()`,
  `app.prevent_emission_data_fact_change()`,
  `app.prevent_sharing_grant_fact_change()`,
  `app.prevent_declaration_fact_change()`,
  `app.enforce_emission_data_verification_gate()`.
- **`app`-schema SECURITY DEFINER helpers** exist wherever a policy needs
  to read a table whose own RLS would otherwise recurse (reading
  `memberships` from inside a `memberships` policy, or reading one
  RLS-protected table from inside another's policy in a way Postgres
  detects as a cycle). This codebase hit genuine `42P17` "infinite
  recursion detected in policy" errors **three separate times** live
  (`memberships` self-query, `sharing_grants`/`installations`
  cross-table, `declarations` self-query) before converging on this
  pattern as the standing fix — see the P9/P7-D2 migrations' header
  comments for the specifics. All such helpers are `stable`,
  `security definer`, and `set search_path = public`.
  `revoke all ... from public; grant execute ... to authenticated;`
  follows immediately after each one.
- **No `UPDATE`/`DELETE` policy = immutability by absence**, not a
  convention alone — `audit_events` (append-only), `calculation_results`
  (append-only, recalculation inserts a new row), `evidence_files` (no
  UPDATE — a mistake is delete + re-upload), and terminal lifecycle states
  (`shipments.status IN ('LOCKED','VOID')`, `sharing_grants.status IN
  ('REVOKED','EXPIRED')`) are retired via a status flip, never a physical
  delete.
- **`jsonb` for a domain shape without a table of its own yet**:
  `shipment_lines.emission_determination`, `declarations.completeness_report`
  / `.filed_snapshot`, `calculation_results.determination` / `.steps` /
  `.parameter_datasets`. Hot keys read out of a `jsonb` payload for
  filtering get a `generated ... stored` column (see `shipment_lines`'
  `determination_method`/`resolution_reason`/`dataset_version`).
- **Deactivation, not deletion, is the offboarding path** for a
  `memberships` row (§14 of the master plan): `deactivated_at` excludes a
  membership from `app.user_org_ids()`/`app.user_is_admin_or_owner_of()`
  (and therefore from every table whose RLS is written in terms of
  those two helpers) while leaving the row itself intact, so
  `audit_events.actor_user_id` still resolves to a person. A hard
  `DELETE` (`memberships_delete_admin_or_owner`) remains available for
  correcting a genuine mistake (an accidental invite).

## RLS helper functions (schema `app`)

All `stable`/`security definer`/`set search_path = public` unless noted;
none are exposed via `supabase.rpc()` (schema `app` is not in
`supabase/config.toml`'s `[api].schemas`) — they exist only to be called
from inside RLS policy expressions or other `app`/`public` functions.

| Function | Signature | Purpose |
|---|---|---|
| `user_org_ids()` | `() → setof uuid` | Org ids the calling `auth.uid()` belongs to via a **non-deactivated** membership. The base helper nearly every org-scoped policy builds on. |
| `user_is_admin_or_owner_of(p_org_id)` | `(uuid) → boolean` | Is the caller a non-deactivated OWNER/ADMIN of `p_org_id`? Used by every ADMIN+-gated policy/RPC. |
| `user_shared_installation_ids()` | `() → setof uuid` | Installation ids the caller's org holds an `ACTIVE`, unexpired `sharing_grants` row for as grantee. |
| `organization_exists(p_org_id)` | `(uuid) → boolean` | Existence check bypassing `organizations`' own RLS — needed because the grantor of a cross-org `sharing_grants` INSERT is, by construction, not a member of the grantee org. |
| `installation_has_pending_sharing_grant_invitation(p_installation_id)` | `(uuid) → boolean` | Backs `installations_select_via_pending_sharing_grant_invitation`; routed through this helper (not a raw subquery) specifically to avoid a live-reproduced `42P17` on every `sharing_grants` INSERT. Requires a confirmed email match (P11). |
| `user_confirmed_email()` | `() → text` | The caller's email **only if** `auth.users.email_confirmed_at is not null`; `NULL` otherwise. Every email-claim policy/RPC (invitations, sharing-grant bootstrap) reads through this rather than `auth.jwt() ->> 'email'` as of P11's mandatory review. |
| `try_cast_uuid(p_value)` | `(text) → uuid` (`immutable`, not `security definer`) | `p_value::uuid`, returning `NULL` instead of raising on a malformed input — used by the evidence storage RLS so one non-UUID object name can't take every user's reads offline. |
| `declaration_predecessor_matches(...)` | `(uuid, uuid, text, integer, smallint) → boolean` | Does the named predecessor declaration exist in the same org and reporting period? Backs `declarations_insert_own_org`'s amendment check without re-triggering `declarations`' own RLS. |
| `prevent_org_id_change()` | `() → trigger` (not `security definer`) | Generic (keyed on `tg_table_name`) `BEFORE UPDATE` guard rejecting any change to `org_id`. Attached to `shipments`, `shipment_lines`, `suppliers`, `memberships`. |
| `prevent_shipment_line_reparent()` | `() → trigger` | Rejects any change to `shipment_lines.shipment_id`. |
| `prevent_membership_user_id_change()` | `() → trigger` | Rejects any change to `memberships.user_id`. |
| `prevent_emission_data_fact_change()` | `() → trigger` | Rejects any UPDATE touching an `emission_data` column other than `verification_status`/`verifier_user_id`/`rejection_reason`/`status`/`evidence_file_ids`/`updated_at`. |
| `enforce_emission_data_verification_gate()` | `() → trigger` | Rejects an UPDATE that moves `verification_status` **into** `VERIFIED`/`REJECTED` unless the caller is ADMIN+ of `entered_by_org_id`. DB-layer backstop; the primary gate is application-layer. |
| `prevent_sharing_grant_fact_change()` | `() → trigger` | Rejects any UPDATE touching a `sharing_grants` column other than `status`/`updated_at`, plus a one-time, status-paired `grantee_org_id` null→real-org resolution (the bootstrap-accept case). |
| `prevent_declaration_fact_change()` | `() → trigger` | Three jobs: pins identity/period/lineage columns immutable; freezes `member_shipment_ids`/`completeness_report` once a row leaves `DRAFT`; confines `filed_snapshot`/`filed_reference`/`filed_at` to the single `READY → FILED_RECORDED` statement. |
| `touch_updated_at()` | `() → trigger` (not `security definer`) | Generic: stamps `updated_at := now()` on any UPDATE. Attached to `emission_data`, `sharing_grants`, `declarations`. |

## RPCs (schema `public`, all `SECURITY DEFINER`)

All directly callable via `supabase.rpc(...)`; each independently
re-verifies caller authorization rather than trusting any caller-supplied
parameter (every one of these is reachable by any authenticated client, not
only through its "intended" call site).

| Function | Signature | Purpose |
|---|---|---|
| `create_organization_with_owner` | `(p_name, p_slug, p_capabilities) → organizations` | The only way to create an org: atomically inserts the org row, an OWNER membership for the caller, and an `organization.created` audit event. |
| `list_org_members` | `(p_org_id) → table(...)` | Exposes each member's email (joined from `auth.users`, not reachable via the Data API) alongside role and `deactivated_at`. Re-checks the caller is a member of `p_org_id` first. |
| `accept_organization_invitation` | `(p_invitation_id) → table(result_status, result_org_id)` | The only way an invitation becomes a membership. Validates email (confirmed, matching), status, expiry, and existing-membership/deactivation state; inserts the membership; records an audit event. Discriminated result, not an exception, for ordinary rejections. |
| `accept_sharing_grant_invitation` | `(p_grant_id, p_org_id) → table(result_status, result_org_id)` | The only way a bootstrap (invited-by-email) `sharing_grants` row resolves `grantee_org_id` for the first time. Mirrors `accept_organization_invitation`. |
| `record_shared_data_consumption` | `(p_sharing_grant_id, p_installation_id, p_emission_data_id, p_emission_data_version, p_shipment_line_id, p_determination_kind) → table(result_status, result_audit_event_id)` | Records a `sharing_grant.data_consumed` audit event into the **grantor's** own audit stream when an importer freezes a determination from that grantor's shared data — a bare client insert cannot cross this boundary (see `audit_events` RLS). Has a documented, tracked known gap: does not verify the shipment line's `emission_determination` actually names this grant/emission-data pair. |
| `record_declaration_filed` | `(p_declaration_id, p_filed_reference) → table(result_status, result_declaration_id)` | **Fully atomic.** Re-aggregates every member shipment's current calculation results (refusing rather than zero-summing an incomplete one), writes `filed_snapshot`/`filed_reference`/`filed_at`, flips the declaration to `FILED_RECORDED`, locks every still-`READY` member shipment, and records `shipment.locked` + `declaration.filed` audit events — all in one transaction. Never rounds any figure (see `RULE-EE-006`, an escalated, unresolved gap in the published EU text). |

## Regulatory foundation tables

Unchanged in shape since the original four migrations; this section is
otherwise unchanged from the previous version of this document; content
verified still accurate against the live schema during this rewrite.

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

**RLS**: `regulatory_sources_select_authenticated` (SELECT, `to
authenticated`, `using (true)`) — added 20260828100000. No mutating policy;
writes are service-role-only (the Python pipeline and activation
migrations).

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

**RLS**: `regulatory_datasets_select_authenticated` (SELECT, `to
authenticated`, `using (true)`) — added 20260828100000.

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

**RLS**: `countries_select_authenticated` (SELECT, `to authenticated`,
`using (true)`) — added 20260828100000.

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

**RLS**: `production_routes_select_authenticated` (SELECT, `to
authenticated`, `using (true)`) — added 20260828100000.

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

**RLS**: `cbam_goods_select_authenticated` (SELECT, `to authenticated`,
`using (true)`) — added 20260828100000.

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

**Identity** (added by the fourth regulatory migration, since Postgres
`NULL` never equals another `NULL` in a unique index — two separate partial
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

**RLS**: `default_emission_values_select_authenticated` (SELECT, `to
authenticated`, `using (true)`) — added 20260828100000. "Regulatory
reference data is not tenant-scoped — every authenticated user may read
it regardless of organization... Writes remain service-role-only" (the
policy's own comment).

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

## Product schema

### `organizations`

A Snowkap tenant. `capabilities` determines which of the two primary
experiences (importer/declarant, producer/operator) this org can use —
see master plan §6. Introduced 20260828070000.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | PK |
| `name` | `text` | No | — | |
| `slug` | `text` | No | — | unique; format `^[a-z0-9]+(-[a-z0-9]+)*$` |
| `capabilities` | `text[]` | No | `'{}'` | subset of `{IMPORTER_DECLARANT, PRODUCER_OPERATOR}`, `cardinality > 0` required |
| `eori_number` | `text` | Yes | — | |
| `cbam_declarant_status` | `text` | No | `'NOT_REGISTERED'` | one of `NOT_REGISTERED`, `APPLICATION_PENDING`, `AUTHORISED` |
| `acts_as_indirect_representative` | `boolean` | No | `false` | reserved; not used by any code yet |
| `country_of_establishment` | `text` | Yes | — | ISO 3166-1 alpha-2, format `^[A-Z]{2}$` |
| `created_at` | `timestamptz` | No | `now()` | |

**Constraints**: `organizations_slug_uq` (unique on `slug`),
`organizations_slug_format_ck`, `organizations_capabilities_ck`,
`organizations_country_format_ck`.

**RLS** (4 SELECT policies OR'd together, plus 1 UPDATE):
- `organizations_select_own_org` (SELECT) — `id in (select app.user_org_ids())`.
- `organizations_select_via_pending_invitation` (SELECT, 20260828140000,
  tightened 20260829380000) — visible if the caller has a `PENDING`,
  unexpired `organization_invitations` row addressed to their
  **confirmed** email.
- `organizations_select_via_pending_sharing_grant_invitation` (SELECT,
  20260829300000, tightened 20260829390000) — visible if the caller has a
  `PENDING`... i.e. an `INVITED`, unexpired `sharing_grants` row addressed
  to their confirmed email, naming this org as grantor.
- `organizations_select_via_own_issued_sharing_grant` (SELECT,
  20260829320000) — visible to a grantor if their org holds an **ACTIVE**
  `sharing_grants` row naming this org as grantee. Deliberately scoped to
  `ACTIVE` only after a same-migration security fix (an unscoped version
  let a self-issued, never-accepted sham grant leak a victim org's full
  row, including `eori_number`).
- `organizations_update_admin_or_owner` (UPDATE, 20260828080000,
  redefined 20260829360000) — `app.user_is_admin_or_owner_of(id)` on both
  `USING` and `WITH CHECK`.

No INSERT/DELETE policy — creation is only via `create_organization_with_owner()`.

### `memberships`

`user` ↔ `organization` link with a role. The last-OWNER-per-org invariant
is enforced in `src/domain/organizations/invariants.ts` at the application
layer, not by a DB constraint (it depends on counting sibling rows).
Introduced 20260828070000; `deactivated_at` added 20260829360000.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | PK |
| `org_id` | `uuid` | No | — | FK → `organizations(id)`, `on delete cascade`; immutable (trigger, 20260829420000) |
| `user_id` | `uuid` | No | — | FK → `auth.users(id)`, `on delete cascade`; immutable (trigger, 20260829370000) |
| `role` | `text` | No | — | one of `OWNER`, `ADMIN`, `MEMBER` |
| `created_at` | `timestamptz` | No | `now()` | |
| `deactivated_at` | `timestamptz` | Yes | — | null = active; non-null = offboarded (20260829360000) |

**Constraints**: `memberships_org_user_uq` (unique on `(org_id, user_id)`).

**Indexes**: `memberships_user_id_idx`, `memberships_org_id_idx`, and a
partial `memberships_active_user_org_idx` on `(user_id, org_id) where
deactivated_at is null` (serves `app.user_org_ids()`'s hot lookup).

**Triggers**: `memberships_prevent_org_id_change_trg` (20260829420000),
`memberships_prevent_user_id_change_trg` (20260829370000) — both
`BEFORE UPDATE`, both closing gaps a bare `WITH CHECK` structurally cannot
close (it can't see the pre-update row).

**RLS**:
- `memberships_select_own_org` (SELECT) — `org_id in (select
  app.user_org_ids())`. Deliberately **not** narrowed for deactivation:
  still returns deactivated rows so the Team screen can render that state.
- `memberships_update_admin_or_owner` (UPDATE, 20260828110000) —
  `app.user_is_admin_or_owner_of(org_id)`, same on `WITH CHECK`.
  Authorization only; the last-OWNER invariant and any role-specific
  business rule live in TypeScript.
- `memberships_delete_admin_or_owner` (DELETE, 20260828110000) — same
  predicate. No self-service "leave this org."

No INSERT policy — a membership is only ever created via
`create_organization_with_owner()` or `accept_organization_invitation()`
(both SECURITY DEFINER).

### `audit_events`

Append-only. No UPDATE/DELETE grants or policies are ever added to this
table — immutability is enforced by absence, matching master plan §21.
Introduced 20260828070000.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | PK |
| `org_id` | `uuid` | Yes | — | FK → `organizations(id)`, `on delete restrict`; null only for SYSTEM-scope events with no owning org |
| `occurred_at` | `timestamptz` | No | `now()` | |
| `actor_type` | `text` | No | — | `USER` or `SYSTEM` |
| `actor_user_id` | `uuid` | Yes | — | FK → `auth.users(id)`, `on delete restrict`; required iff `actor_type = 'USER'` |
| `event_type` | `text` | No | — | free text; see the INSERT-policy catalog below for the authenticated-role-writable subset |
| `aggregate_type` | `text` | No | — | one of `ORGANIZATION`, `MEMBERSHIP`, `SHIPMENT`, `SHIPMENT_LINE`, `EMISSION_DATA`, `INSTALLATION`, `OPERATOR`, `SUPPLIER`, `SHARING_GRANT`, `CALCULATION_RESULT`, `DECLARATION`, `EVIDENCE_FILE` (last one added 20260829240000) |
| `aggregate_id` | `text` | No | — | |
| `payload` | `jsonb` | No | `'{}'` | |
| `correlation_id` | `text` | Yes | — | |

**Constraints**: `audit_events_actor_consistency_ck` (USER ⟺ has
`actor_user_id`; SYSTEM ⟺ doesn't).

**Indexes**: `audit_events_org_aggregate_occurred_idx` on `(org_id,
aggregate_type, aggregate_id, occurred_at)`.

**RLS**:
- `audit_events_select_own_org` (SELECT, 20260828070000) — `org_id in
  (select app.user_org_ids())`.
- `audit_events_insert_own_org_as_self` (INSERT, 20260828150000,
  tightened 20260829430000) — `actor_type = 'USER' and actor_user_id =
  auth.uid() and org_id in (select app.user_org_ids())`, **plus**
  `event_type` must be one of an explicit catalog of ~34 values (the
  ones any real `recordAuditEvent()` application-layer call site can
  produce). Event types written only from inside a SECURITY DEFINER
  RPC/trigger (`organization.created`, `membership.invitation_accepted`,
  `sharing_grant.data_consumed`, `declaration.filed`) are deliberately
  **excluded** from the catalog — a bare client INSERT can never claim
  one of those, closing a live-reproduced forgery (a MEMBER inserting a
  fake `declaration.filed` row). SYSTEM-actor events still require the
  service-role connection.

No UPDATE/DELETE policy anywhere, by design.

### `organization_invitations`

Pending/resolved invitations to join an organization. Becomes a
membership only via `accept_organization_invitation()`. Introduced
20260828130000.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | PK |
| `org_id` | `uuid` | No | — | FK → `organizations(id)`, `on delete cascade` |
| `email` | `text` | No | — | format-checked |
| `role` | `text` | No | — | `ADMIN` or `MEMBER` (OWNER deliberately excluded) |
| `status` | `text` | No | `'PENDING'` | `PENDING`, `ACCEPTED`, `REVOKED`, `EXPIRED` |
| `invited_by` | `uuid` | No | — | FK → `auth.users(id)`, `on delete restrict` |
| `created_at` | `timestamptz` | No | `now()` | |
| `expires_at` | `timestamptz` | No | `now() + interval '7 days'` | |
| `accepted_at` | `timestamptz` | Yes | — | |
| `accepted_by` | `uuid` | Yes | — | FK → `auth.users(id)`, `on delete restrict` |

**Constraints**: `organization_invitations_email_format_ck`.

**Indexes**: partial unique `organization_invitations_org_email_pending_uq`
on `(org_id, lower(email)) where status = 'PENDING'` (only one PENDING
invite per org+email at a time); `organization_invitations_org_id_idx`;
partial `organization_invitations_email_pending_idx`.

**RLS**:
- `organization_invitations_select_admin_or_owner` (SELECT) —
  `app.user_is_admin_or_owner_of(org_id)`.
- `organization_invitations_select_own_email` (SELECT, tightened
  20260829380000) — `status = 'PENDING' and expires_at > now() and
  lower(email) = lower(app.user_confirmed_email())`. Lets an
  invited-but-not-yet-member user see their own invitation; requires a
  **confirmed** email as of the P11 review (previously any JWT-claimed
  email sufficed, regardless of Supabase Auth's confirmation setting).
- `organization_invitations_insert_admin_or_owner` (INSERT) —
  ADMIN/OWNER of `org_id`, `invited_by = auth.uid()`, `status = 'PENDING'`.
- `organization_invitations_update_admin_or_owner` (UPDATE) — ADMIN/OWNER
  of `org_id` on `USING`; `WITH CHECK` additionally pins `status =
  'REVOKED'` — this policy can only ever be used to revoke, never to
  forge an `ACCEPTED` row (that only happens inside the RPC).

No DELETE policy.

### `suppliers`

A commercial counterparty on the importer side — distinct from
Operator/Installation by design. Introduced 20260828150000.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | PK |
| `org_id` | `uuid` | No | — | FK → `organizations(id)`, `on delete cascade`; immutable (trigger) |
| `name` | `text` | No | — | |
| `country` | `text` | Yes | — | ISO 3166-1 alpha-2 |
| `contact_name` | `text` | Yes | — | |
| `contact_email` | `text` | Yes | — | format-checked |
| `linked_operator_id` | `uuid` | Yes | — | FK → `operators(id)`, `on delete set null` (added 20260829220000, once `operators` existed) |
| `linked_installation_ids` | `uuid[]` | No | `'{}'` | **no per-element FK** — Postgres cannot express one; documented deferred gap, not an oversight |
| `created_at` | `timestamptz` | No | `now()` | |

**Trigger**: `suppliers_prevent_org_id_change_trg` (20260829090000).

**RLS**: `suppliers_select_own_org`, `suppliers_insert_own_org`,
`suppliers_update_own_org`, `suppliers_delete_own_org` — all plain
`org_id in (select app.user_org_ids())`, no cross-parent checks (no
required FK to validate against beyond `org_id` itself).

### `shipments`

One release-for-free-circulation event of CBAM goods. Lifecycle `DRAFT →
READY → LOCKED`, `VOID` reachable from `DRAFT`/`READY` — see
`src/domain/shipments/lifecycle.ts` (`transitionShipment`) for the
authoritative rules. Introduced 20260828150000.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | PK |
| `org_id` | `uuid` | No | — | FK → `organizations(id)`, `on delete cascade`; immutable (trigger) |
| `reference` | `text` | No | — | unique with `org_id` |
| `release_date` | `date` | No | — | |
| `reporting_period_kind` | `text` | No | — | `ANNUAL` or `QUARTERLY` |
| `reporting_period_year` | `integer` | No | — | |
| `reporting_period_quarter` | `smallint` | Yes | — | required 1–4 iff QUARTERLY, else null |
| `customs_mrn` | `text` | Yes | — | |
| `customs_procedure` | `text` | Yes | — | `RELEASE_FOR_FREE_CIRCULATION` or `INWARD_PROCESSING` |
| `status` | `text` | No | `'DRAFT'` | `DRAFT`, `READY`, `LOCKED`, `VOID` |
| `created_at` / `updated_at` | `timestamptz` | No | `now()` | `updated_at` has **no** touch trigger on this table — it is not kept current by any code path |

**Constraints**: `shipments_org_reference_uq` (unique `(org_id,
reference)`), `shipments_reporting_period_quarter_ck`.

**Indexes**: `shipments_org_status_idx`, `shipments_org_reporting_period_idx`.

**Trigger**: `shipments_prevent_org_id_change_trg`.

**RLS**:
- `shipments_select_own_org` (SELECT) — own org.
- `shipments_insert_own_org` (INSERT) — own org.
- `shipments_update_own_org_not_terminal` (UPDATE, redefined
  20260829090000) — `USING`: own org **and** `status not in ('LOCKED',
  'VOID')`. `WITH CHECK`: own org **and** (`status <> 'LOCKED'` **or**
  `app.user_is_admin_or_owner_of(org_id)`) — LOCK is ADMIN/OWNER-only;
  any MEMBER may DRAFT↔READY.

No DELETE policy — `VOID` is the retirement path.

### `shipment_lines`

One declared trade-code line within a Shipment. Immutable once the
parent shipment is LOCKED/VOID — enforced by this table's own INSERT/
UPDATE/DELETE policies checking the parent's status. Introduced
20260828150000; generated columns added 20260829150000.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | PK |
| `shipment_id` | `uuid` | No | — | FK → `shipments(id)`, `on delete cascade`; immutable (trigger, `app.prevent_shipment_line_reparent()`) |
| `org_id` | `uuid` | No | — | denormalized from the parent shipment; immutable (trigger) |
| `line_number` | `integer` | No | — | `> 0`; unique with `shipment_id` |
| `cn_code` | `text` | No | — | `^\d{8}(\d{2})?$`, cross-checked against `cn_code_level` |
| `cn_code_level` | `text` | No | — | `CN8` or `TARIC10` |
| `goods_description` | `text` | Yes | — | |
| `origin_country` | `text` | No | — | ISO 3166-1 alpha-2 |
| `net_mass_tonnes` | `text` | Yes | — | exactly one of this/`quantity_mwh` set; canonical decimal grammar (20260829440000) + `> 0` |
| `quantity_mwh` | `text` | Yes | — | same shape as `net_mass_tonnes` |
| `production_route_name` | `text` | Yes | — | paired with `production_route_indicator` (both null or both set) |
| `production_route_indicator` | `text` | Yes | — | |
| `emission_determination` | `jsonb` | Yes | — | `EmissionDetermination` snapshot (P5+); always null through P4 |
| `determination_method` | `text` | — | *generated* | `emission_determination ->> 'method'` |
| `resolution_reason` | `text` | — | *generated* | `emission_determination -> 'resolution' ->> 'reason'` |
| `dataset_version` | `text` | — | *generated* | `emission_determination -> 'resolution' ->> 'dataset_version'` |

**Constraints**: `shipment_lines_line_number_uq`,
`shipment_lines_exactly_one_quantity_ck`,
`shipment_lines_net_mass_positive_ck` / `_format_ck`,
`shipment_lines_quantity_mwh_positive_ck` / `_format_ck`,
`shipment_lines_production_route_pair_ck`,
`shipment_lines_cn_code_level_consistency_ck` (20260829090000).

**Indexes**: `shipment_lines_shipment_id_idx`,
`shipment_lines_org_cn_code_idx`, `shipment_lines_org_origin_country_idx`,
partial `shipment_lines_org_determination_method_idx` /
`_org_resolution_reason_idx` (both `where ... is not null`).

**Trigger**: `shipment_lines_prevent_org_id_change_trg`,
`shipment_lines_prevent_reparent_trg`.

**RLS**:
- `shipment_lines_select_own_org` (SELECT) — own org.
- `shipment_lines_insert_parent_not_terminal` (INSERT) — own org, plus
  `EXISTS` on the parent shipment being same-org and not LOCKED/VOID.
- `shipment_lines_update_parent_not_terminal` (UPDATE) — same predicate
  on both `USING`/`WITH CHECK`.
- `shipment_lines_delete_parent_not_terminal` (DELETE) — same predicate.

### `import_batches`

One CSV import attempt, for idempotency and audit — intentionally minimal
until the actual import parse/validate/commit pipeline is built.
Introduced 20260828150000.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | PK |
| `org_id` | `uuid` | No | — | FK → `organizations(id)`, `on delete cascade` |
| `created_by` | `uuid` | No | — | FK → `auth.users(id)`, `on delete restrict` |
| `status` | `text` | No | `'PENDING'` | `PENDING`, `VALIDATED`, `COMMITTED`, `FAILED` |
| `row_count` | `integer` | Yes | — | |
| `error_count` | `integer` | Yes | — | |
| `created_at` | `timestamptz` | No | `now()` | |
| `completed_at` | `timestamptz` | Yes | — | |

**Indexes**: `import_batches_org_id_idx`.

**RLS**: `import_batches_select_own_org` (SELECT); `import_batches_insert_own_org`
(INSERT) — own org **and** `created_by = auth.uid()`. No UPDATE/DELETE
policy yet (no application code updates a batch's status today).

### `calculation_results`

Append-only store for `CalculationResult`, produced by the pure engine
`calculateLineEmissions`. Recalculation appends — a new row, never an
UPDATE. Introduced 20260829180000; hardened 20260829200000.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | PK |
| `org_id` | `uuid` | No | — | FK → `organizations(id)`, `on delete cascade` |
| `line_id` | `uuid` | No | — | FK → `shipment_lines(id)`, `on delete cascade` |
| `shipment_id` | `uuid` | No | — | FK → `shipments(id)`, `on delete cascade`; denormalized from the line's parent |
| `engine_version` | `text` | No | — | |
| `parameter_datasets` | `jsonb` | No | `'[]'` | empty through P6 |
| `quantity` | `text` | No | — | |
| `quantity_unit` | `text` | No | — | `TONNES` or `MWH` |
| `determination` | `jsonb` | No | — | frozen input snapshot |
| `steps` | `jsonb` | No | — | `CalculationStep[]` |
| `embedded_emissions_tco2e` | `text` | No | — | always present — only `COMPUTED` results are ever inserted |
| `certificates_due` | `text` | Yes | — | null until a dependent parameter dataset is ACTIVE |
| `liability_amount` | `text` | Yes | — | |
| `liability_currency` | `text` | Yes | — | `EUR` or null |
| `calculated_at` | `timestamptz` | No | `clock_timestamp()` (was `now()` before 20260829200000) | |
| `calculated_by_user_id` | `uuid` | No | — | FK → `auth.users(id)` |
| `correlation_id` | `uuid` | Yes | — | |

**Indexes**: `calculation_results_org_line_idx` on `(org_id, line_id,
calculated_at desc)`, `calculation_results_org_shipment_idx`.

**RLS**:
- `calculation_results_select_own_org` (SELECT) — own org.
- `calculation_results_insert_own_org_as_self` (INSERT, redefined
  20260829200000) — own org, `calculated_by_user_id = auth.uid()`, an
  `EXISTS` join proving `line_id`/`shipment_id` really belong together in
  this org, **and** (added 20260829200000) the parent shipment must **not**
  be LOCKED/VOID.

No UPDATE/DELETE policy anywhere — this is what makes the table
append-only, not merely a convention.

#### View: `latest_calculation_results`

`security_invoker = true` (inherits the querying user's own RLS, no
separate grant). `select distinct on (line_id) ... order by line_id,
calculated_at desc, id desc` — the most recent row per line. Added
20260829200000 to replace an application-layer "fetch every row and
reduce" pattern that silently truncated past PostgREST's row cap.

### `operators`

The entity that runs a production Installation — distinct from Supplier
by design. Introduced 20260829220000.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | PK |
| `org_id` | `uuid` | No | — | FK → `organizations(id)`, `on delete cascade` |
| `provenance` | `text` | No | — | `OPERATOR_PROVIDED` or `IMPORTER_ENTERED` |
| `name` | `text` | No | — | |
| `country` | `text` | No | — | ISO 3166-1 alpha-2 |
| `contact_email` | `text` | Yes | — | format-checked |
| `created_at` | `timestamptz` | No | `now()` | |

**Indexes**: `operators_org_id_idx`.

**RLS**: `operators_select_own_org`, `operators_insert_own_org`,
`operators_delete_own_org` — all plain own-org. **No UPDATE policy** (no
application path edits an operator's row today).

### `installations`

One production site run by an Operator. `org_id` is denormalized from
the parent operator and cross-validated on insert. Introduced 20260829220000;
RLS widened for cross-org sharing 20260829260000/20260829300000/20260829390000.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | PK |
| `operator_id` | `uuid` | No | — | FK → `operators(id)`, `on delete cascade` |
| `org_id` | `uuid` | No | — | FK → `organizations(id)`, `on delete cascade`; denormalized, cross-validated at INSERT |
| `provenance` | `text` | No | — | `OPERATOR_PROVIDED` or `IMPORTER_ENTERED` |
| `name` | `text` | No | — | |
| `country` | `text` | No | — | ISO 3166-1 alpha-2 |
| `un_locode` | `text` | Yes | — | `^[A-Z]{2}[A-Z0-9]{3}$` |
| `address` | `text` | Yes | — | |
| `cbam_installation_id` | `text` | Yes | — | reserved for a future CBAM registry id |
| `created_at` | `timestamptz` | No | `now()` | |

**Indexes**: `installations_org_id_idx`, `installations_operator_id_idx`.

**RLS**:
- `installations_select_own_org` (SELECT, redefined 20260829260000) —
  own org **or** `id in (select app.user_shared_installation_ids())`
  (an installation the caller's org holds an ACTIVE sharing grant for).
- `installations_insert_own_org` (INSERT) — own org, plus an `EXISTS`
  proving `operator_id` really belongs to the same `org_id`.
- `installations_delete_own_org` (DELETE) — own org. Note: the FK from
  `emission_data`/`sharing_grants` to this table is `ON DELETE RESTRICT`
  (tightened 20260829270000 from `CASCADE`), so this DELETE fails
  outright once any dependent row exists — it no longer silently cascades
  away emission data or grants.
- `installations_select_via_pending_sharing_grant_invitation` (SELECT,
  20260829300000, tightened 20260829390000) — visible, via the
  `app.installation_has_pending_sharing_grant_invitation()` SECURITY
  DEFINER helper, if a `PENDING`-equivalent (`INVITED`, unexpired)
  bootstrap `sharing_grants` row addressed to the caller's confirmed
  email names this installation. Strictly narrower than the shared-org
  policy above — no emission_data access, just the installation's own
  identifying columns.

No UPDATE policy.

### `emission_data`

An operator's declared actual embedded emissions for one installation,
one CN-code scope, and one reporting period. Two coupled lifecycles
(`verification_status`, `status`) — see
`src/domain/emissions/emission-data-lifecycle.ts`. Introduced 20260829230000;
`evidence_file_ids` relaxed out of the fact-change guard 20260829240000;
FK/verifier hardening 20260829270000; `updated_at` trigger 20260829280000;
lineage-collision guards 20260829290000.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | PK |
| `installation_id` | `uuid` | No | — | FK → `installations(id)`, `on delete restrict` (was `cascade` before 20260829270000) |
| `entered_by_org_id` | `uuid` | No | — | FK → `organizations(id)`, `on delete cascade`; denormalized, immutable via fact-change trigger |
| `cn_scope` | `text[]` | No | `'{}'` | informational only — **not** part of the uniqueness key (see below) |
| `reporting_period_kind` | `text` | No | — | `ANNUAL` or `QUARTERLY` |
| `reporting_period_year` | `integer` | No | — | |
| `reporting_period_quarter` | `smallint` | Yes | — | 1–4 iff QUARTERLY |
| `direct_specific` | `text` | No | — | canonical decimal grammar, `>= 0` (can legitimately be exactly 0) |
| `indirect_specific` | `text` | No | — | same shape |
| `emission_unit` | `text` | No | — | |
| `methodology` | `text` | No | — | `EU_METHOD`, `EQUIVALENT_METHOD`, `OTHER` |
| `verification_status` | `text` | No | `'UNVERIFIED'` | `UNVERIFIED`, `VERIFICATION_PENDING`, `VERIFIED`, `REJECTED` |
| `verifier_user_id` | `uuid` | Yes | — | FK → `auth.users(id)`, `on delete restrict` (was `set null` before 20260829270000); required iff `verification_status = 'VERIFIED'` |
| `rejection_reason` | `text` | Yes | — | |
| `evidence_file_ids` | `text[]` | No | `'{}'` | plain array, no FK; mutable even after other facts freeze (20260829240000) |
| `version` | `integer` | No | `1` | `> 0`; monotonically increasing per (installation, period) lineage |
| `predecessor_id` | `uuid` | Yes | — | FK → `emission_data(id)`, `on delete set null`; at most one successor per predecessor |
| `status` | `text` | No | `'DRAFT'` | `DRAFT`, `ACTIVE`, `SUPERSEDED`, `DISCARDED` |
| `created_at` / `updated_at` | `timestamptz` | No | `now()` | `updated_at` kept current by `app.touch_updated_at()` since 20260829280000 |

**Constraints**: `emission_data_reporting_period_quarter_ck`,
`emission_data_direct_specific_numeric_ck` / `_indirect_specific_numeric_ck`,
`emission_data_verified_has_verifier_ck` (20260829270000 — `VERIFIED ⟹
verifier_user_id is not null`, a real DB invariant, not just an
assumption).

**Indexes**: `emission_data_org_installation_idx`,
`emission_data_installation_period_idx`,
`emission_data_predecessor_id_idx`; partial unique
`emission_data_one_active_per_installation_period_uq` on `(installation_id,
reporting_period_kind, reporting_period_year, coalesce(reporting_period_quarter,
0)) where status = 'ACTIVE'`; `emission_data_version_uq` (full lineage key
+ version, 20260829290000); partial unique `emission_data_predecessor_id_uq`
(20260829290000).

**Triggers**: `emission_data_prevent_fact_change_trg`,
`emission_data_verification_gate_trg`, `emission_data_touch_updated_at_trg`.

**RLS**:
- `emission_data_select_own_org` (SELECT, redefined 20260829260000) —
  own org (`entered_by_org_id`) **or** (`installation_id in (select
  app.user_shared_installation_ids())` **and** `status = 'ACTIVE'` **and**
  `verification_status = 'VERIFIED'`). This is, per the migration's own
  comment, "the single most security-critical clause" in the sharing
  design — DRAFT/SUPERSEDED/DISCARDED/UNVERIFIED/PENDING/REJECTED rows
  must never be visible to a grantee, even while the grant is ACTIVE.
- `emission_data_insert_own_org` (INSERT) — own org, plus an `EXISTS`
  proving `installation_id` really belongs to `entered_by_org_id`.
- `emission_data_update_own_org` (UPDATE) — own org only, no role
  distinction. *Which* transition is legal is enforced by the pure
  `transitionEmissionData` function (application layer) and by the two
  triggers above (DB layer), not by this policy.

No DELETE policy — `DISCARD` (status → `DISCARDED`) is the retirement path.

### `evidence_files`

A supporting document attached to one `emission_data` row. Append-only
from the application's perspective — no UPDATE policy; a mistaken upload
is removed and re-uploaded. Introduced 20260829240000; storage-path
integrity hardened 20260829410000.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | PK |
| `org_id` | `uuid` | No | — | FK → `organizations(id)`, `on delete cascade`; denormalized from `emission_data_id`'s own `entered_by_org_id` |
| `emission_data_id` | `uuid` | No | — | FK → `emission_data(id)`, `on delete cascade` |
| `storage_path` | `text` | No | — | full path inside the `evidence` bucket, e.g. `{org_id}/{emission_data_id}/{generated-filename}`; must start with `{org_id}/` (CHECK, 20260829410000) |
| `original_filename` | `text` | No | — | client-supplied, cosmetic only |
| `mime_type` | `text` | No | — | |
| `size_bytes` | `bigint` | No | — | `> 0 and <= 20971520` (20 MB) |
| `sha256` | `text` | No | — | `^[0-9a-f]{64}$`; computed server-side from actual bytes, never trusted from the client |
| `uploaded_by_user_id` | `uuid` | No | — | FK → `auth.users(id)`, `on delete restrict` |
| `created_at` | `timestamptz` | No | `now()` | |

**Constraints**: `evidence_files_size_bytes_check`,
`evidence_files_sha256_check`, `evidence_files_storage_path_org_prefix_ck`
(20260829410000 — closes a live-reproduced gap where a forged row could
carry a truthful `org_id` but a `storage_path` pointed at a **different**
org's prefix, defeating the download-URL ownership check).

**Indexes**: `evidence_files_org_emission_data_idx`; unique
`evidence_files_storage_path_uq` (one row per stored object).

**RLS**:
- `evidence_files_select_own_org` (SELECT) — own org.
- `evidence_files_insert_own_org` (INSERT) — own org, plus an `EXISTS`
  proving `emission_data_id` really belongs to this `org_id`.
- `evidence_files_delete_own_org` (DELETE) — own org. Unlike
  `emission_data`'s no-DELETE posture, a real DELETE is the correct
  primitive here (no soft-delete/status lifecycle to retire through).

No UPDATE policy — files are immutable once uploaded.

#### Storage: the `evidence` bucket

`insert into storage.buckets (id, name, public) values ('evidence',
'evidence', false)` — private; every read goes through a server-generated,
short-lived signed URL after an ownership check
(`src/application/evidence/upload-evidence.ts`), never a public/anon URL.
Objects are named `{org_id}/{emission_data_id}/{generated-filename}`.

Three `storage.objects` RLS policies (added 20260829240000, tightened
20260829410000): `evidence_storage_select_own_org`,
`evidence_storage_insert_own_org`, `evidence_storage_delete_own_org` —
each requires `bucket_id = 'evidence' and
app.try_cast_uuid((storage.foldername(name))[1]) in (select
app.user_org_ids())`. `app.try_cast_uuid()` replaced a bare `::uuid` cast
after a live-reproduced finding that one malformed object name (a
non-UUID first path segment) made the cast **raise**, taking every
authenticated user's evidence reads offline app-wide rather than simply
excluding that one row. No UPDATE policy — an evidence object is
immutable once uploaded (application code also always uploads with
`upsert: false`).

> **Verification note**: this local instance's `storage` schema exists
> (as an empty namespace) but has no `buckets`/`objects` tables — the
> Supabase Storage service's own bootstrap migrations have not run
> against it, independently of `supabase_migrations.schema_migrations`
> correctly recording `20260829240000`/`20260829410000` as applied. The
> policies documented above are therefore sourced from the migration SQL
> itself (the authoritative source per `CLAUDE.md`), not cross-checked
> against a live `pg_policies` row for `storage.objects` in this
> environment. Everything in the `public` schema above (including
> `evidence_files`) was independently confirmed live.

### `sharing_grants`

A producer org's (grantor) read-only, installation-scoped grant of
ACTIVE+VERIFIED `EmissionData` visibility to an importer org (grantee).
`INVITED → ACTIVE → REVOKED | EXPIRED`. Introduced 20260829260000
(direct-grant case only); bootstrap-by-email path added 20260829300000;
expiry hardening 20260829390000.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | PK |
| `grantor_org_id` | `uuid` | No | — | FK → `organizations(id)`, `on delete cascade` |
| `grantee_org_id` | `uuid` | Yes | — | FK → `organizations(id)`, `on delete cascade`; null until a bootstrap invite resolves it; immutable once non-null |
| `invited_email` | `text` | Yes | — | format-checked; set only for a bootstrap (not-yet-a-Snowkap-org) invite |
| `installation_id` | `uuid` | No | — | FK → `installations(id)`, `on delete restrict` (was `cascade` before 20260829270000) |
| `status` | `text` | No | `'INVITED'` | `INVITED`, `ACTIVE`, `REVOKED`, `EXPIRED` |
| `created_by_user_id` | `uuid` | No | — | FK → `auth.users(id)`, `on delete restrict` |
| `expires_at` | `timestamptz` | Yes | — | optional; enforced both at accept-time (RPC/RLS) and at read-time (`app.user_shared_installation_ids()`) |
| `created_at` / `updated_at` | `timestamptz` | No | `now()` | `updated_at` kept current since 20260829280000 |

**Constraints**: `sharing_grants_no_self_grant_ck`,
`sharing_grants_grantee_or_invited_email_ck` (20260829300000 — at least
one of `grantee_org_id`/`invited_email` set), `sharing_grants_active_requires_grantee_ck`
(20260829300000 — `ACTIVE ⟹ grantee_org_id is not null`),
`sharing_grants_invited_email_format_ck`. (The original
`sharing_grants_invited_email_deferred_ck`, which forced `invited_email`
always null, was dropped by 20260829300000 when the bootstrap path shipped.)

**Indexes**: `sharing_grants_grantor_org_id_idx`,
`sharing_grants_grantee_org_id_idx`, `sharing_grants_installation_id_idx`;
partial unique `sharing_grants_installation_grantee_active_uq` on
`(installation_id, grantee_org_id) where status in ('INVITED', 'ACTIVE')`.

**Trigger**: `sharing_grants_prevent_fact_change_trg`,
`sharing_grants_touch_updated_at_trg`.

**RLS**:
- `sharing_grants_select_grantor_or_grantee` (SELECT) — `grantor_org_id
  in (select app.user_org_ids()) or grantee_org_id in (select
  app.user_org_ids())`.
- `sharing_grants_insert_own_org` (INSERT, redefined 20260829300000) —
  ADMIN+ of `grantor_org_id`, installation really belongs to that org,
  and **either** the direct-grant shape (`grantee_org_id` set to a real
  org via `app.organization_exists()`, `invited_email` null) **or** the
  bootstrap shape (`grantee_org_id` null, `invited_email` set).
- `sharing_grants_update_grantor_revoke` (UPDATE) — grantor ADMIN+;
  `USING` requires non-terminal status, `WITH CHECK` pins the new status
  to `REVOKED`.
- `sharing_grants_update_grantee_accept` (UPDATE, redefined 20260829300000
  and 20260829390000) — `USING`: grantee-org member, `status = 'INVITED'`,
  **and** (added 20260829390000) `expires_at is null or expires_at >
  now()`. `WITH CHECK`: grantee-org member, `status = 'ACTIVE'`, **and**
  `invited_email is null` (added 20260829300000's security fix — a
  bootstrap row, which always has `invited_email` set, can never satisfy
  this policy via a bare client UPDATE; only the RPC can resolve it).
- `sharing_grants_select_via_pending_invitation` (SELECT, 20260829300000,
  tightened 20260829390000) — `status = 'INVITED'`, unexpired,
  `invited_email` matching the caller's **confirmed** email.

No DELETE policy — `REVOKE` is the retirement path.

### `declarations`

One CBAM declaration for one reporting period. `DRAFT → READY →
FILED_RECORDED`, `VOID` reachable from `DRAFT`/`READY`; amendments are new
rows chained by `supersedes_declaration_id`, never edits to a filed row.
Snowkap **records** a filing the declarant performed themselves — it
never performs one (master plan §22). Introduced 20260829330000; INSERT
recursion fix 20260829340000; filing-completeness fix 20260829350000;
membership-oracle fix to the RPC 20260829400000.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | PK |
| `org_id` | `uuid` | No | — | FK → `organizations(id)`, `on delete cascade`; immutable |
| `reporting_period_kind` | `text` | No | — | `ANNUAL` or `QUARTERLY` |
| `reporting_period_year` | `integer` | No | — | immutable |
| `reporting_period_quarter` | `smallint` | Yes | — | immutable |
| `status` | `text` | No | `'DRAFT'` | `DRAFT`, `READY`, `FILED_RECORDED`, `VOID` |
| `member_shipment_ids` | `uuid[]` | No | `'{}'` | no per-element FK (same limitation as `suppliers.linked_installation_ids`); refreshed freely while DRAFT, frozen from READY onward |
| `completeness_report` | `jsonb` | Yes | — | the **application layer's own** DRAFT/READY-time evidence — advisory, **not** re-verified by `record_declaration_filed()`; frozen once the row leaves DRAFT |
| `filed_snapshot` | `jsonb` | Yes | — | written only by `record_declaration_filed()`, from a fresh aggregation at filing time; full Decimal precision, never rounded (see `RULE-EE-006`) |
| `filed_reference` | `text` | Yes | — | verbatim declarant input; never generated/normalized; not blank if set |
| `filed_at` | `timestamptz` | Yes | — | |
| `supersedes_declaration_id` | `uuid` | Yes | — | self-FK, `on delete cascade`; immutable; not self-referencing |
| `created_by_user_id` | `uuid` | No | — | FK → `auth.users(id)`, `on delete restrict`; immutable |
| `created_at` / `updated_at` | `timestamptz` | No | `now()` | `updated_at` kept current by `app.touch_updated_at()` |

**Constraints**: `declarations_reporting_period_quarter_ck`,
`declarations_filed_facts_ck` (biconditional: `FILED_RECORDED ⟺` all
three of `filed_at`/`filed_snapshot`/`filed_reference` present),
`declarations_filed_reference_not_blank_ck`, `declarations_no_self_supersede_ck`.

**Indexes**: `declarations_org_status_idx`, `declarations_org_period_idx`,
partial `declarations_supersedes_idx`; three uniqueness indexes
implementing "no two live declarations for the same (org, period) at
once" as two row-local halves plus a linear-chain guard —
`declarations_period_original_uq` (at most one non-VOID original per
period), `declarations_period_in_preparation_uq` (at most one
DRAFT/READY per period), `declarations_supersedes_uq` (a given
declaration superseded by at most one non-VOID successor).

**Trigger**: `declarations_prevent_fact_change_trg`,
`declarations_touch_updated_at_trg`.

**RLS — exactly one UPDATE policy, by design** (the migration's own
header comment: a second UPDATE policy would reopen the exact
cross-policy composition hazard a `sharing_grants` review found
BLOCKING, since Postgres OR-combines every applicable policy's `USING`
and, separately, every applicable `WITH CHECK` — not as matched pairs):
- `declarations_select_own_org` (SELECT) — own org, **MEMBER+** (not
  ADMIN-gated — read visibility is "reporting," not "preparation," per
  master plan §27).
- `declarations_insert_own_org` (INSERT, redefined 20260829340000) —
  ADMIN+ of `org_id`, `created_by_user_id = auth.uid()`, `status =
  'DRAFT'`, all three `filed_*` columns null, and (if
  `supersedes_declaration_id` is set) `app.declaration_predecessor_matches()`
  confirms the predecessor is a real declaration in the same org/period.
- `declarations_update_own_org_pre_filing` (UPDATE) — `USING`: ADMIN+,
  `status in ('DRAFT', 'READY')`. `WITH CHECK`: ADMIN+, `status in
  ('DRAFT', 'READY', 'VOID')`. `FILED_RECORDED` is absent from **both**
  clauses — a bare client UPDATE can refresh/ready/reopen/void a
  declaration but can never produce or touch a filed one. That transition
  exists only inside `record_declaration_filed()`.

No DELETE policy — `VOID` is the retirement path.

## Row Level Security — summary

RLS is **enabled on all 21 tables** in `public` (the 6 regulatory tables
plus the 15 product tables above), for a total of **56 policies** as of
`20260829440000` — verified directly against `pg_policies` on the local
instance during this rewrite (not merely inferred from the migration
files). See each table's own section above for the per-policy detail;
the shape recurs throughout:

- Regulatory tables: SELECT-only, `to authenticated`, `using (true)` —
  not tenant-scoped, writes are service-role-only.
- Product tables: every mutating policy is scoped to `app.user_org_ids()`
  (or `app.user_is_admin_or_owner_of()` for an ADMIN+-gated action),
  with cross-parent `EXISTS` checks wherever a row denormalizes a parent's
  `org_id`, and `BEFORE UPDATE` triggers wherever `WITH CHECK`'s
  inability to see the pre-update row would otherwise leave a gap.
- Three tables (`audit_events`, `calculation_results`, `evidence_files`
  partially) are immutable/append-only by the deliberate **absence** of
  an UPDATE and/or DELETE policy, not by an explicit denial.

This directly supersedes an earlier version of this document, which
stated RLS was enabled with "zero policies" — true only of the original
four regulatory-foundation migrations in isolation, and never true of the
schema as a whole once P3 landed.

## Known, documented gaps (not silent — each is named in its own migration)

- `linked_installation_ids` (`suppliers`) and `member_shipment_ids`
  (`declarations`) are `uuid[]` with no per-element FK — Postgres cannot
  express one. Referential validity is application-checked, and (for
  `declarations`) explicitly re-verified at filing time by
  `record_declaration_filed()`.
- `emission_data.cn_scope` is informational only — the one-ACTIVE-per-period
  uniqueness index is keyed on `(installation_id, reporting_period)`
  alone, not per-scope. A future slice needing true per-scope uniqueness
  has a known, not silent, gap to close (20260829230000's own header
  comment).
- `record_shared_data_consumption()` does not verify that the named
  shipment line's `emission_determination` actually references the
  claimed `emission_data_id`/version/`sharing_grant_id` — only that the
  line exists and belongs to the grantee org. Treat a
  `sharing_grant.data_consumed` audit event as an unverified claim from
  the grantee, not proof, until this is closed (20260829310000).
- `declarations.completeness_report` is writable by a bare client UPDATE
  in the same statement that moves `DRAFT → READY` (the freeze trigger
  only engages once `old.status <> 'DRAFT'`) — it is advisory evidence of
  what the application checked, not an attestation `record_declaration_filed()`
  re-verifies. The filed total itself cannot be forged this way; trust
  `filed_snapshot` if the two ever disagree (20260829350000).
- Declaration-time rounding **method** (as opposed to the precision
  ceilings the published EU text does state) is an open, escalated
  regulatory gap — `RULE-EE-006` in
  `docs/regulatory/CALCULATION_RULE_REGISTER.md`. `filed_snapshot` never
  rounds any figure and says so in its own payload.
- `import_batches` has no UPDATE policy — the CSV import parse/validate/commit
  pipeline that would move it through its own status lifecycle has not
  been built yet; only the identity/status columns are reserved.

## P13 additions (on top of everything above)

Five migrations landed after this document's last full regrounding
(`20260829440000`). Rather than rewriting the sections above, this
lists what each one actually changed — see
[`MIGRATION_LOG.md`](./MIGRATION_LOG.md) for the one-line purpose of
each, and the migration files themselves for the full SQL.

- **`20260829450000`** — `memberships_update_admin_or_owner`'s `WITH CHECK`
  is redefined: granting `role = 'OWNER'` now additionally requires
  `app.user_is_owner_of(org_id)` (a new helper function), not merely
  ADMIN-or-OWNER. Before this, any ADMIN could promote another member
  (or themselves) to OWNER.
- **`20260829460000`** — `create_organization_with_owner()` is
  redefined to require `app.user_confirmed_email()` before it will
  create an organization.
- **`20260829470000`** — `record_declaration_filed()`'s
  `member_line_counts` CTE gains an `uncalculated_count` filter that
  also catches `c.determination is distinct from ml.emission_determination`
  (a line redetermined after its last calculation ran), not only a
  genuinely missing calculation row.
- **`20260829480000`** — three changes on `emission_data`: (1)
  `emission_data_update_own_org`'s `WITH CHECK` gains an anti-join
  requiring every `evidence_file_ids` element to name a real,
  same-record, same-org `evidence_files` row; (2) a new
  `BEFORE UPDATE` trigger, `app.enforce_emission_data_activation_gate()`,
  blocks a direct client write of `status = 'ACTIVE'` outside the
  `activateEmissionData` RPC path; (3)
  `app.enforce_emission_data_verification_gate()` is redefined to
  force-overwrite `verifier_user_id := auth.uid()` on any transition
  into `VERIFIED`, and to reject any OTHER attempted change to
  `verifier_user_id`/`rejection_reason` (previously mutable after the
  fact by a plain MEMBER with no ADMIN gate and no audit trail).
- **`20260829490000`** — `emission_data_update_own_org`'s new
  `evidence_file_ids` anti-join (added by `20260829480000`, above) had
  its bare `claimed.evidence_file_id::uuid` cast replaced with
  `app.try_cast_uuid(...)` — the bare cast raised a raw Postgres
  `22P02` on a malformed array entry instead of a clean policy
  rejection, live-reproduced and closed by this migration; same defect
  class and fix as `20260829410000`'s `storage.objects` hardening,
  narrower blast radius (one row's own future `UPDATE`s, not a
  whole-table outage).

None of the five touch the protected regulatory zone (ADR-0005) or add
a new table — all five are policy/trigger/function redefinitions on
already-documented tables, via this codebase's established
drop-and-recreate-in-a-new-migration pattern (see this document's own
"forward-only" framing above).
