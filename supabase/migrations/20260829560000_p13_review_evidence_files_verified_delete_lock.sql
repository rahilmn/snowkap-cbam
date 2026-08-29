-- ============================================================
-- Snowkap CBAM
-- P13 release-blocker remediation (finding S6): evidence_files_delete_own_org
-- allowed ANY member of the owning org to delete ANY evidence file,
-- regardless of the owning emission_data record's verification_status
-- -- including a DRAFT+VERIFIED, ACTIVE, or SUPERSEDED record (all
-- three carry verification_status = 'VERIFIED': ACTIVATE only flips
-- `status`, and superseding a record never touches its own
-- verification_status). Deleting evidence out from under a VERIFIED
-- record silently invalidates the verifier's own basis for approving
-- it, for a record that may already be consumed cross-org via an
-- active sharing grant -- a real integrity/audit-trail gap, not merely
-- a UI omission.
--
-- src/application/evidence/upload-evidence.ts's removeEvidenceFile now
-- refuses this at the application layer (Wall 1); this migration adds
-- the matching RLS restriction (Wall 2) so a direct write can never do
-- what that function's own guard already refuses -- "two walls,
-- always both" per this codebase's own tenancy model.
--
-- Deliberately keyed on verification_status = 'VERIFIED' alone, not
-- emission_data.status: a DRAFT+REJECTED record must remain editable
-- (emission-data-lifecycle.ts's own SUBMIT_FOR_VERIFICATION transition
-- accepts REJECTED as a valid prior state, for a producer fixing
-- evidence before resubmitting) -- gating on status=DRAFT vs ACTIVE
-- alone would additionally have let a DRAFT+VERIFIED record sitting
-- unactivated have its evidence stripped and then be ACTIVATEd anyway,
-- which is exactly the gap this closes.
-- ============================================================

drop policy evidence_files_delete_own_org on public.evidence_files;

create policy evidence_files_delete_own_org
    on public.evidence_files
    for delete
    to authenticated
    using (
        org_id in (select app.user_org_ids())
        and exists (
            select 1
            from public.emission_data ed
            where ed.id = evidence_files.emission_data_id
              and ed.verification_status <> 'VERIFIED'
        )
    );

comment on policy evidence_files_delete_own_org on public.evidence_files is
    '2026-08-30 (P13 review, finding S6): now additionally requires the '
    'owning emission_data record''s verification_status <> ''VERIFIED'' '
    '-- matches removeEvidenceFile''s own new application-layer guard '
    '(src/application/evidence/upload-evidence.ts). A DRAFT+VERIFIED, '
    'ACTIVE, or SUPERSEDED record''s evidence is now immutable at the '
    'RLS level, not only hidden from the one existing UI path.';
