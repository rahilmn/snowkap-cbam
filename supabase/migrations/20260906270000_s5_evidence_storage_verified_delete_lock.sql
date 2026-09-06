-- ============================================================
-- Snowkap CBAM
-- S5 review remediation (2026-09-06), finding AUTHZ-B2 (fresh
-- independent Opus 5 certification review). This codebase enforces
-- "evidence behind a completed verification is permanent" in three
-- places -- app.enforce_emission_data_lineage_lock ("evidence cannot be
-- removed from a record that has been ACTIVE and VERIFIED"),
-- evidence_files_delete_own_org's own `verification_status <> 'VERIFIED'`
-- USING clause (20260829560000, P13 finding S6), and removeEvidenceFile's
-- own EMISSION_DATA_VERIFIED rejection (src/application/evidence/
-- upload-evidence.ts) -- but never in the one place that holds the
-- actual bytes. evidence_storage_delete_own_org on storage.objects
-- (20260829410000) is scoped by the org-id path prefix alone, with no
-- verification predicate and no reference to the parent emission_data
-- record at all.
--
-- LIVE-REPRODUCED (S5 review, adversarial verify round): any ordinary
-- MEMBER (no ADMIN/OWNER needed) of the owning producer org could
-- `DELETE FROM storage.objects WHERE bucket_id='evidence' AND
-- name='<org_id>/<emission_data_id>/<file>'` for an ACTIVE+VERIFIED
-- record's evidence with their own session token, then re-upload
-- different bytes at the identical path -- destroying or substituting
-- the evidentiary basis for a completed verification while
-- evidence_files' own metadata row (sha256, filename) and
-- emission_data.evidence_file_ids stay completely untouched. Nothing
-- downstream checks that the object still exists or that its bytes
-- still hash to evidence_files.sha256 -- checkEmissionDataEvidenceCompleteness,
-- get-buyer-view.ts's countEvidenceFiles, and
-- app.emission_determination_matches_regulatory_record all reason only
-- from evidence_file_ids/evidence_files' own row count, so the record
-- still verifies, still activates, still determines, and a cross-org
-- buyer's readiness checklist still reports it evidence-backed, while
-- the actual evidentiary basis is gone or replaced.
--
-- Cross-org isolation on the bucket was confirmed intact throughout --
-- this is an insider/integrity boundary (an ordinary member of the
-- OWNING org), not a tenancy leak.
--
-- Fix: the storage delete policy gains the identical verification_status
-- predicate evidence_files_delete_own_org already applies to the
-- metadata row, joined via the path convention upload-evidence.ts
-- itself establishes ({org_id}/{emission_data_id}/{random-filename} --
-- storage.foldername(name)[1] is org_id, [2] is emission_data_id).
-- There is still no UPDATE policy on storage.objects (an in-place
-- overwrite stays correctly blocked at the GRANT layer), so closing
-- DELETE alone closes both the destruction and the delete-then-
-- reinsert substitution vector -- a fresh upload at an already-occupied
-- path cannot itself succeed without the delete first.
-- ============================================================

drop policy evidence_storage_delete_own_org on storage.objects;

create policy evidence_storage_delete_own_org
    on storage.objects
    for delete
    to authenticated
    using (
        bucket_id = 'evidence'
        and app.try_cast_uuid((storage.foldername(name))[1]) in (select app.user_org_ids())
        and exists (
            select 1
            from public.emission_data ed
            where ed.id = app.try_cast_uuid((storage.foldername(name))[2])
              and ed.verification_status <> 'VERIFIED'
        )
    );

comment on policy evidence_storage_delete_own_org on storage.objects is
    '2026-09-06 (S5 review remediation, finding AUTHZ-B2): now additionally '
    'requires the owning emission_data record''s verification_status <> '
    '''VERIFIED'' -- matches evidence_files_delete_own_org''s own identical '
    'clause (20260829560000) and removeEvidenceFile''s own application-layer '
    'guard (src/application/evidence/upload-evidence.ts). A VERIFIED '
    'record''s evidence bytes are now immutable at the storage RLS level too, '
    'not only its metadata row.';
