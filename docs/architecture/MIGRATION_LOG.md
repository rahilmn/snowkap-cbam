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
columns show every version below).

**Updated 2026-08-31**: this now also applies to the hosted project
backing the live Railway deployment. The header previously said staging
and production had "never been connected to this environment" — that is
no longer true. On 2026-08-30 the hosted project was found to have only
4 of the then-57 migrations applied (regulatory foundation only, ZERO
product tables — see `P13_RELEASE_READINESS_REPORT.md` §16.11), and the
53 pending migrations were applied to it after verifying that none of
them mutate regulatory data. The protected dataset was confirmed intact
afterwards (12,540 rows, one ACTIVE version, `pnpm regulatory:verify`
RESULT: VALID). There is still no separate *staging* project. The five **protected** regulatory
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

## P13 — Blocker-remediation round (found stale in this log 2026-08-30; added during the final non-blocked-work audit)

| Version | File | Purpose |
|---|---|---|
| `20260829500000` | `p13_review_shipment_line_determination_forgery_fix.sql` | `shipment_lines.emission_determination` forgery fix, iteration 1 (superseded by v2/v3/v5/v6 below — see `P13_RELEASE_READINESS_REPORT.md` §16.6 for the full six-iteration account) |
| `20260829510000` | `p13_review_evidence_bucket_size_mime_limits.sql` | Live-reproduced: the `evidence` Storage bucket set neither `file_size_limit` nor `allowed_mime_types`, bypassing the application-layer upload-safety controls via a direct Storage API call |
| `20260829520000` | `p13_review_audit_events_occurred_at_immutable.sql` | Live-reproduced: `audit_events.occurred_at` was client-supplied and unconstrained, allowing backdated/future-dated forged rows |
| `20260829530000` | `p13_review_shipment_line_determination_forgery_fix_v2.sql` | Forgery fix, iteration 2 |
| `20260829540000` | `p13_review_shipment_line_actual_determination_cross_org_oracle_fix.sql` | Live-reproduced while re-verifying `20260829530000`: a cross-org boolean-oracle information-disclosure side channel via the SECURITY DEFINER validation function |
| `20260829550000` | `p13_review_organizations_update_owner_only.sql` | Live-reproduced (finding S5): `organizations` UPDATE RLS allowed ADMIN, not just OWNER, matching the application layer up to Wall 2 |
| `20260829560000` | `p13_review_evidence_files_verified_delete_lock.sql` | Live-reproduced (finding S6): any member could delete evidence files backing an already-VERIFIED emission_data record |
| `20260829570000` | `p13_review_memberships_last_owner_race_fix.sql` | Live-reproduced (finding S10): a check-then-act race across two different OWNER rows could leave an org with zero active owners |
| `20260829580000` | `p13_review_shipment_line_determination_forgery_fix_v3.sql` | Forgery fix, iteration 3 |
| `20260829590000` | `p13_review_app_schema_service_role_execute_grants.sql` | Live-reproduced while writing a regression test: `service_role` lacked schema `USAGE` on `app` plus `EXECUTE` on seven helper functions |
| `20260829600000` | `p13_review_shipment_line_determination_forgery_fix_v5.sql` | Forgery fix, iteration 5 (iteration 4 was a test-only change, not a migration) |
| `20260829610000` | `p13_review_shipment_line_determination_forgery_fix_v6.sql` | Forgery fix, iteration 6 — held under three independent Opus reviews *for the surface those reviews examined*; a real gap in a combination those reviews never exercised was found later — see `20260829620000` below |
| `20260829620000` | `p13_review_shipment_line_determination_forgery_fix_v7.sql` | Forgery fix, iteration 7 — self-discovered via live browser end-to-end verification of the unrelated R7 clause 2 / R9 regulatory resolver fix (`docs/regulatory/R7_R9_COUNTRY_FALLBACK_DECISION_MEMO.md` §12): that fix made a combination reachable (a listed/MAPPED country's own record UNAVAILABLE, falling back to Other Countries and Territories) that v6's validator had never anticipated and rejected as a forgery, surfacing to users as a misleading "shipment is locked or void" error. Not caught by domain-level tests, typecheck, or `pnpm regulatory:verify` — only by exercising the real UI end-to-end against real Postgres. See `P13_RELEASE_READINESS_REPORT.md` §16.6 for the full account. |

| `20260831100000` | `p13_sharing_counterparty_org_names.sql` | Live-production UI finding: a grantee of an ACTIVE sharing grant could not resolve the GRANTOR organization's name, so `/emissions` and the actual-data picker showed "Unknown organization" as the source of figures about to be declared. Not an application bug -- RLS returns no row because a grantee has no membership in the grantor org, and `organization_visible_via_pending_invitation` covers only the PENDING window. Adds `public.sharing_counterparty_org_names()` (SECURITY DEFINER) returning ONLY `(id, name)` and only for a currently-ACTIVE, unexpired grant in either direction -- deliberately NOT by widening `organizations` SELECT RLS, which would disclose the counterparty's full row (`eori_number`, `cbam_declarant_status`, slug). |

## Not yet reflected in this log at the code level (tracked, not migrations)

Two authorization findings from the P13 audit remain open by design,
not by migration — see `AUTHORIZATION_MATRIX.md`'s own "Known
remaining gap" note: capability enforcement (`IMPORTER_DECLARANT` /
`PRODUCER_OPERATOR`) has no RLS wall today, only the application-layer
one closed by `fix(p13): wire capability enforcement into every gated
service`. Closing it is a schema-wide change (a capability predicate
added to every gated table's write policy) intentionally scoped to its
own future migration, not squeezed into this log's most recent entry.
