-- ============================================================
-- Snowkap CBAM
-- P11 mandatory security review response: evidence_files.storage_path
-- was unconstrained relative to org_id, and the storage RLS's bare
-- ::uuid cast could take evidence downloads offline app-wide
--
-- Purpose:
--   Finding #6 (SHOULD-FIX, confirmed live): evidence_files_insert_own_org
--   validates org_id and the parent emission_data row's ownership, but
--   never that storage_path actually starts with the row's own
--   org_id -- even though 20260829240000's own header comment states
--   the "{org_id}/{emission_data_id}/{filename}" convention as the
--   whole reason the storage RLS policies key off the first path
--   segment. getEvidenceDownloadUrl (upload-evidence.ts) compares only
--   org_id, then hands storage_path verbatim to createSignedUrl --
--   live reproduction: a forged evidence_files row (org_id = caller's
--   own org C, storage_path pointed at org B's prefix) is ACCEPTED by
--   RLS and PASSES the application's own ownership check, leaving
--   Storage's own evidence_storage_select_own_org policy as the only
--   remaining wall -- one wall, against this codebase's own stated
--   "two walls, always both" posture (see e.g. sharing_grants_update_grantee_accept's
--   own Wall-1/Wall-2 pairing, this same review). A CHECK constraint
--   pinning storage_path to org_id closes it at the row-integrity
--   level -- no forged row can ever be inserted in the first place,
--   which is stronger than relying on Storage to independently deny
--   the read.
--
--   Finding #18 (NIT, live-verified by the mandatory reviewer and
--   raised to SHOULD-FIX): the three storage.objects policies cast
--   `(storage.foldername(name))[1]::uuid` directly. Live: a single
--   object in the 'evidence' bucket whose first path segment is not a
--   valid UUID literal (a service-role write, a Studio upload, any
--   future code path) makes the cast RAISE `22P02` rather than simply
--   excluding that row from the policy's result -- and because
--   Postgres evaluates a USING clause against every candidate row for
--   the query being planned, ONE such object takes EVERY authenticated
--   user's read of storage.objects offline, with a failure mode
--   (a raw Postgres type error) that looks nothing like its actual
--   cause. app.try_cast_uuid() replaces the bare cast with a version
--   that returns NULL on a malformed segment instead of raising --
--   `NULL in (select app.user_org_ids())` is simply false, which is
--   exactly "this row doesn't match," the behavior the bare cast was
--   always meant to have for a non-UUID segment.
-- ============================================================


-- ============================================================
-- 1. evidence_files.storage_path CHECK -- must be prefixed with
--    "{org_id}/" (finding #6)
-- ============================================================

alter table public.evidence_files
    add constraint evidence_files_storage_path_org_prefix_ck
        check (
            storage_path like (org_id::text || '/%')
        );

comment on constraint evidence_files_storage_path_org_prefix_ck on public.evidence_files is
    '2026-08-29 (P11 mandatory review, finding #6): enforces the '
    '"{org_id}/{emission_data_id}/{filename}" convention '
    '20260829240000''s own header comment already states as the reason '
    'the storage.objects RLS policies key off the first path segment '
    '-- previously assumed, not enforced, so a row could be inserted '
    'with a truthful org_id but a storage_path pointed at a DIFFERENT '
    'org''s prefix (live-reproduced: RLS accepted it, and the '
    'application''s own ownership check in upload-evidence.ts, which '
    'compares only org_id, could not catch it either). This closes it '
    'at the row-integrity level, so no such row can be inserted at '
    'all -- not merely relying on Storage''s own separate RLS as the '
    'sole remaining wall.';


-- ============================================================
-- 2. app.try_cast_uuid() -- exception-safe uuid cast (finding #18)
-- ============================================================

create or replace function app.try_cast_uuid(
    p_value text
)
returns uuid
language plpgsql
immutable
as $$
begin
    return p_value::uuid;
exception
    when invalid_text_representation then
        return null;
end;
$$;

comment on function app.try_cast_uuid(text) is
    '2026-08-29 (P11 mandatory review, finding #18, live-verified: a '
    'single malformed object name in the ''evidence'' storage bucket '
    'made EVERY authenticated user''s storage.objects read fail with a '
    'raw 22P02 Postgres error, app-wide, since the bare ::uuid cast '
    'this replaces RAISES on invalid input rather than excluding the '
    'row). Returns NULL instead of raising on a malformed input, so a '
    'policy comparing the result to a set of real UUIDs (e.g. '
    '`app.try_cast_uuid(...) in (select app.user_org_ids())`) simply '
    'evaluates false for that row -- "doesn''t match," never "the '
    'whole query errors." Not SECURITY DEFINER -- pure computation, '
    'reads nothing RLS would otherwise block.';


-- ============================================================
-- 3. evidence storage.objects policies -- use app.try_cast_uuid()
--    (redefined via drop+create, this codebase''s established
--    precedent for tightening an already-applied policy)
-- ============================================================

drop policy evidence_storage_select_own_org on storage.objects;

create policy evidence_storage_select_own_org
    on storage.objects
    for select
    to authenticated
    using (
        bucket_id = 'evidence'
        and app.try_cast_uuid((storage.foldername(name))[1]) in (select app.user_org_ids())
    );

drop policy evidence_storage_insert_own_org on storage.objects;

create policy evidence_storage_insert_own_org
    on storage.objects
    for insert
    to authenticated
    with check (
        bucket_id = 'evidence'
        and app.try_cast_uuid((storage.foldername(name))[1]) in (select app.user_org_ids())
    );

drop policy evidence_storage_delete_own_org on storage.objects;

create policy evidence_storage_delete_own_org
    on storage.objects
    for delete
    to authenticated
    using (
        bucket_id = 'evidence'
        and app.try_cast_uuid((storage.foldername(name))[1]) in (select app.user_org_ids())
    );

comment on policy evidence_storage_select_own_org on storage.objects is
    '2026-08-29 (P11 review, finding #18): app.try_cast_uuid() instead '
    'of a bare ::uuid cast -- see that function''s own comment for the '
    'app-wide availability failure this closes. Otherwise unchanged '
    'from 20260829240000.';


-- ============================================================
-- END OF MIGRATION
-- ============================================================
