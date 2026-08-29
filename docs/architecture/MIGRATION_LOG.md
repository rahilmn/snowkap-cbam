# Migration log

The migration-level record master plan §44 requires ("Documentation
complete... migration log, phase evidence archive"). This did not
exist before 2026-08-29 (P13 documentation-completeness audit); every
migration below already existed and was already applied, this
document just makes that history discoverable in one place instead of
scattered across 44 individual file headers.

**How to read this**: every row is a real file under
`supabase/migrations/`, in the order Postgres applies them (the
timestamp prefix is the sort key). "Applied" here means confirmed via
`pnpm exec supabase migration list --local` against this environment's
local Supabase instance (both the `local` and `remote` tracking
columns show every version below) — **not** staging or production,
neither of which has ever been connected to this environment (see
`docs/runbooks/DEPLOYMENT.md`). The five **protected** regulatory
migrations are called out explicitly; see
[`ADR-0005`](../adr/ADR-0005-protected-regulatory-subsystem.md) and
CLAUDE.md for what "protected" means and why.

**Maintenance rule**: add a row here in the same commit that adds a
new migration file. If a row's own description drifts from the file's
current header comment, trust the file — then fix this row in a
follow-up, the same "grep-proof or it's wrong" discipline
`AUTHORIZATION_MATRIX.md` already states for itself.

## Regulatory foundation (protected — see ADR-0005)

| Version | File | Purpose |
|---|---|---|
| `20260826133116` | `create_regulatory_foundation.sql` | Regulatory foundation schema: `regulatory_sources`, `regulatory_datasets`, `countries`, `cbam_goods`, `production_routes`, `default_emission_values` |
| `20260827093000` | `support_regulatory_geography.sql` | Regulatory geography support (country/territory modeling for the fallback rule) |
| `20260827110000` | `activate_definitive_regulatory_dataset.sql` | Activates the validated, checksum-pinned `2026-definitive-corrected` dataset (12,540 records) as the sole ACTIVE `default_emission_values` version |
| `20260827130000` | `harden_regulatory_emission_uniqueness.sql` | Hardens uniqueness constraints on regulatory emission records (route-specific and route-independent partial unique indexes) |
| `20260828100000` | `authenticated_read_regulatory_data.sql` | Grants `authenticated` SELECT policies on the regulatory reference tables (P3 — product code first became able to read them) |

## P3 — Organizations, tenancy, minimal auth, audit spine

| Version | File | Purpose |
|---|---|---|
| `20260828070000` | `create_organizations_foundation.sql` | Foundation: `organizations`, `memberships`, `audit_events` |
| `20260828080000` | `organization_onboarding_rpc.sql` | `create_organization_with_owner()` RPC + organizations UPDATE policy |
| `20260828090000` | `audit_organization_creation.sql` | Records an audit event when `create_organization_with_owner` runs |
| `20260828110000` | `membership_management_policies.sql` | Membership UPDATE/DELETE policies (role changes, removal) |
| `20260828120000` | `list_org_members_rpc.sql` | `list_org_members()` RPC backing the Team screen |
| `20260828130000` | `organization_invitations.sql` | `organization_invitations` table + accept/invite RPCs |
| `20260828140000` | `organization_visible_via_pending_invitation.sql` | Lets an invited (not-yet-member) user see the org they're invited to |

## P4 — Shipment intake + classification

| Version | File | Purpose |
|---|---|---|
| `20260828150000` | `p4_shipment_intake_schema.sql` | Shipment intake schema: `suppliers`, `shipments`, `shipment_lines` |
| `20260829090000` | `p4_shipment_tenancy_hardening.sql` | Tenancy hardening for shipments/shipment_lines/suppliers, incl. the LOCK-action RLS role gate (`status <> 'LOCKED' or app.user_is_admin_or_owner_of(org_id)`) |

## P5 — Regulatory resolution integration

| Version | File | Purpose |
|---|---|---|
| `20260829150000` | `p5_emission_determination_generated_columns.sql` | Generated columns on `shipment_lines.emission_determination` for hot-key indexing |

## P6 — Calculation engine

| Version | File | Purpose |
|---|---|---|
| `20260829180000` | `p6_calculation_results_schema.sql` | `calculation_results` schema (append-only) |
| `20260829200000` | `p6_calculation_results_hardening.sql` | Calculation results hardening |

## P7 — Actual emissions, producer workspace, sharing

| Version | File | Purpose |
|---|---|---|
| `20260829220000` | `p7_installations_operators_schema.sql` | Operators + installations schema (P7-A) |
| `20260829230000` | `p7b_emission_data_schema.sql` | `emission_data` schema — the actual-emissions verification lifecycle (P7-B) |
| `20260829240000` | `p7c_evidence_files_schema.sql` | Evidence file upload: Storage bucket + `evidence_files` (P7-C) |
| `20260829260000` | `p7d_sharing_grants_schema.sql` | `sharing_grants` schema — cross-organization producer→importer sharing (P7-D) |
| `20260829270000` | `p7_review_fk_hardening.sql` | Mandatory-review fix: FK hardening on installation deletion + verifier/EORI FKs |
| `20260829280000` | `p7_review_updated_at_trigger.sql` | Mandatory-review fix: maintain `updated_at` on emission_data/installations |
| `20260829290000` | `p7_review_version_lineage_hardening.sql` | Mandatory-review fix: emission_data version/predecessor lineage hardening |
| `20260829300000` | `p7d2_sharing_grant_email_bootstrap.sql` | Sharing-grant bootstrap-by-email path (P7-D2) |
| `20260829310000` | `p7d3_shared_data_consumption_audit.sql` | Cross-org "consumption" audit event for shared data (P7-D3) |
| `20260829320000` | `p7d4_shared_data_status_grantee_visibility.sql` | Lets a grantor resolve the name of an org they've granted access to (P7-D4) |

## P9 — Reporting, exports, declaration preparation

| Version | File | Purpose |
|---|---|---|
| `20260829330000` | `p9_declarations_schema.sql` | `declarations` schema + `record_declaration_filed()` RPC |
| `20260829340000` | `p9_declarations_insert_policy_recursion_fix.sql` | Fix: `declarations_insert_own_org` caused infinite recursion (Postgres 42P17) |
| `20260829350000` | `p9_declaration_filed_membership_and_completeness_fix.sql` | Fix: a member shipment emptied of its only line after READY could still be filed |

## P10 — Org management, roles, authorization hardening

| Version | File | Purpose |
|---|---|---|
| `20260829360000` | `p10_membership_deactivation.sql` | Membership deactivation lifecycle (deactivate/reactivate, deactivated members excluded from role/authority checks) |
| `20260829370000` | `p10_review_response_membership_user_id_immutable.sql` | Review response: pins `memberships.user_id` immutable |

## P11 — Security, observability, performance, backup/restore hardening

| Version | File | Purpose |
|---|---|---|
| `20260829380000` | `p11_review_email_confirmation_and_invitation_hardening.sql` | Mandatory security review response: unconfirmed-email + deactivated-membership gaps in invitation acceptance |
| `20260829390000` | `p11_review_sharing_grant_email_and_expiry_hardening.sql` | Mandatory security review response: sharing_grants' mirror-image email/expiry gaps |
| `20260829400000` | `p11_review_declaration_filed_membership_oracle_fix.sql` | Mandatory security review response: `record_declaration_filed()` membership-oracle fix |
| `20260829410000` | `p11_review_evidence_storage_path_and_uuid_cast_hardening.sql` | Mandatory security review response: `evidence_files.storage_path` org-prefix CHECK + `app.try_cast_uuid()` (storage.objects policies) |
| `20260829420000` | `p11_review_membership_org_id_immutable.sql` | Mandatory security review response: pins `memberships.org_id` immutable |
| `20260829430000` | `p11_review_audit_events_event_type_catalog.sql` | Mandatory security review response: `audit_events_insert_own_org_as_self` gains an `event_type` catalog allowlist |
| `20260829440000` | `p11_review_shipment_lines_numeric_format_ck.sql` | Mandatory security review response: `shipment_lines`' numeric-string columns gain format CHECKs |

## P13 — Final release-readiness audit findings

| Version | File | Purpose |
|---|---|---|
| `20260829450000` | `p13_review_admin_owner_escalation_fix.sql` | Live-reproduced: an ADMIN could grant another member OWNER via `changeMemberRole`, both walls closed (`app.user_is_owner_of()` + tightened `memberships_update_admin_or_owner`) |
| `20260829460000` | `p13_review_onboarding_email_confirmation_hardening.sql` | Live-reproduced: `create_organization_with_owner` did not require a confirmed email |
| `20260829470000` | `p13_review_declaration_filed_stale_calculation_gate.sql` | Live-reproduced: `record_declaration_filed()` did not block filing on a stale (redetermined-but-not-recalculated) line calculation |
| `20260829480000` | `p13_review_emission_data_verification_and_evidence_integrity_fix.sql` | Live-reproduced, three findings: `evidence_file_ids` forgery + `status='ACTIVE'` bypass, `verifier_user_id` never pinned to `auth.uid()`, `verifier_user_id`/`rejection_reason` mutable after the fact |
| `20260829490000` | `p13_review_emission_data_evidence_uuid_cast_hardening.sql` | Live-reproduced: `emission_data_update_own_org`'s evidence_file_ids anti-join used a bare `::uuid` cast, crashing with a raw Postgres error instead of a clean policy rejection on a malformed entry |

## Not yet reflected in this log at the code level (tracked, not migrations)

Two authorization findings from the P13 audit remain open by design,
not by migration — see `AUTHORIZATION_MATRIX.md`'s own "Known
remaining gap" note: capability enforcement (`IMPORTER_DECLARANT` /
`PRODUCER_OPERATOR`) has no RLS wall today, only the application-layer
one closed by `fix(p13): wire capability enforcement into every gated
service`. Closing it is a schema-wide change (a capability predicate
added to every gated table's write policy) intentionally scoped to its
own future migration, not squeezed into this log's most recent entry.
