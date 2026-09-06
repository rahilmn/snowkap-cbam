-- ============================================================
-- Snowkap CBAM
-- S5 review remediation round 2 (2026-09-06), finding S5R2-AUTHZ-B1
-- (fresh independent Opus 5 certification review, round 2). The
-- previous fix (20260906270000, finding AUTHZ-B2) decided whether an
-- evidence storage object may be deleted by resolving
-- app.try_cast_uuid((storage.foldername(name))[2]) to an emission_data
-- row and requiring that row's verification_status <> 'VERIFIED'. That
-- is a join on a NAMING CONVENTION, not a foreign key. The convention
-- is only half-enforced -- evidence_files_storage_path_org_prefix_ck
-- (20260829410000) constrains storage_path to `org_id || '/%'` only
-- (path segment [1]); nothing anywhere requires segment [2] to equal
-- the row's own emission_data_id.
--
-- The sibling metadata policy does this correctly: evidence_files_
-- delete_own_org joins `ed.id = evidence_files.emission_data_id`, the
-- real FK. That asymmetry was the defect.
--
-- LIVE-REPRODUCED (S5 review round 2, adversarial verify): an ordinary
-- MEMBER of the owning producer org inserted an evidence_files row
-- naming emission_data_id = A (an ACTIVE+VERIFIED record) but whose
-- storage_path names a DIFFERENT, still-DRAFT record B in path position
-- 2 (org prefix satisfied, so the CHECK constraint admitted it), then
-- inserted the matching storage.objects row at that same path. The
-- prior policy's path-segment join resolved position 2 to B
-- (DRAFT, not VERIFIED), so the DELETE was admitted -- destroying the
-- bytes behind a VERIFIED, ACTIVE, actually-cited (evidence_file_ids)
-- evidence file, while evidence_files' own metadata row and
-- emission_data.evidence_file_ids stayed completely untouched.
--
-- Fix: rewrite the policy to join through evidence_files by
-- storage_path (an exact string match against the object's own name,
-- the same value uploadEvidenceFile writes to both places in the same
-- request) to the REAL emission_data_id foreign key, mirroring
-- evidence_files_delete_own_org's own already-correct join exactly.
--
-- Orphan objects (a storage upload whose evidence_files insert never
-- happened -- upload-evidence.ts's own documented compensating-cleanup
-- path, reachable if that cleanup itself fails, e.g. a network
-- partition between the two calls) have no evidence_files row to join
-- against at all. The policy admits delete for those too (`not exists
-- (... verification_status = 'VERIFIED')` is vacuously true when no row
-- references the path), preserving the pre-existing ability to clean
-- up a genuinely orphaned object -- an object nothing points to poses
-- no verification-integrity risk. What is now refused is exactly and
-- only: an object a real evidence_files row cites, where that row's own
-- emission_data is VERIFIED.
-- ============================================================

drop policy evidence_storage_delete_own_org on storage.objects;

create policy evidence_storage_delete_own_org
    on storage.objects
    for delete
    to authenticated
    using (
        bucket_id = 'evidence'
        and app.try_cast_uuid((storage.foldername(name))[1]) in (select app.user_org_ids())
        and not exists (
            select 1
            from public.evidence_files ef
            join public.emission_data ed on ed.id = ef.emission_data_id
            where ef.storage_path = storage.objects.name
              and ed.verification_status = 'VERIFIED'
        )
    );

comment on policy evidence_storage_delete_own_org on storage.objects is
    '2026-09-06 (S5 review remediation round 2, finding S5R2-AUTHZ-B1): '
    'joins through evidence_files.storage_path to the real emission_data_id '
    'foreign key (mirroring evidence_files_delete_own_org''s own join) '
    'instead of parsing the storage path''s own naming convention, which '
    'was bypassable -- nothing previously required path segment [2] to '
    'actually equal the citing evidence_files row''s emission_data_id. '
    'An object with no citing evidence_files row (a genuine upload-time '
    'orphan) remains deletable, matching pre-AUTHZ-B2 behavior for that '
    'specific, verification-irrelevant case.';
