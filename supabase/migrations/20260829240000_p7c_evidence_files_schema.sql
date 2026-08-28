-- ============================================================
-- Snowkap CBAM
-- P7-C: evidence file upload -- storage bucket, evidence_files
-- metadata table, and a fix to a design conflict discovered while
-- building this slice against the already-applied P7-B schema
-- (20260829230000_p7b_emission_data_schema.sql).
--
-- ------------------------------------------------------------
-- Part 1: evidence_file_ids immutability fix
--   P7-B's app.prevent_emission_data_fact_change() pinned
--   evidence_file_ids immutable alongside the genuine "fact" columns
--   (direct_specific, methodology, ...) -- reasonable at the time
--   (P7-B's own header comment: "evidence upload is explicitly out of
--   scope for this slice... always '{}' through this slice"), but it
--   means, as the schema currently stands, evidence can NEVER be
--   attached to a record after its initial INSERT. That defeats the
--   actual producer workflow this slice implements: record data,
--   verify it, attach supporting evidence at any point -- including
--   DURING or AFTER the verification review, which is exactly when
--   evidence most needs to be attachable (a verifier rejecting a
--   record for insufficient support, and the producer then attaching
--   the missing document, is a normal and expected flow).
--
--   Evidence attachment is fundamentally different in kind from
--   editing a declared fact value: it is an append-only "supporting
--   documents" list, not a correction to what was declared. Forcing it
--   to be fixed at insert time (before any evidence could possibly
--   exist to attach, since evidence_files rows are created by this
--   same migration) would make evidence attachment impossible in
--   practice, not just restricted.
--
--   This is a forward-only fix -- the applied P7-B migration
--   (20260829230000) is never edited in place, per CLAUDE.md's
--   protected-zone discipline (though this particular trigger function
--   is product schema, not the protected regulatory zone itself, the
--   same "never edit an applied migration" rule applies to every
--   applied migration in this codebase). `create or replace function`
--   here reproduces every other check in
--   app.prevent_emission_data_fact_change() byte-for-byte, removing
--   ONLY the `new.evidence_file_ids is distinct from old.evidence_file_ids`
--   clause -- see the two functions side by side if verifying this.
-- ------------------------------------------------------------
create or replace function app.prevent_emission_data_fact_change()
returns trigger
language plpgsql
as $$
begin
    if new.installation_id is distinct from old.installation_id
        or new.entered_by_org_id is distinct from old.entered_by_org_id
        or new.cn_scope is distinct from old.cn_scope
        or new.reporting_period_kind is distinct from old.reporting_period_kind
        or new.reporting_period_year is distinct from old.reporting_period_year
        or new.reporting_period_quarter is distinct from old.reporting_period_quarter
        or new.direct_specific is distinct from old.direct_specific
        or new.indirect_specific is distinct from old.indirect_specific
        or new.emission_unit is distinct from old.emission_unit
        or new.methodology is distinct from old.methodology
        or new.version is distinct from old.version
        or new.predecessor_id is distinct from old.predecessor_id
        or new.created_at is distinct from old.created_at
    then
        raise exception
            'emission_data: only verification_status, verifier_user_id, rejection_reason, status, evidence_file_ids, and updated_at may change via UPDATE -- a correction to a declared fact requires a new version (see src/application/emissions/manage-emission-data.ts, recordEmissionData)';
    end if;

    return new;
end;
$$;

comment on function app.prevent_emission_data_fact_change() is
    'BEFORE UPDATE guard: rejects any UPDATE that changes a "fact" '
    'column on emission_data. evidence_file_ids is deliberately NOT '
    'checked here (P7-C, 20260829240000) -- attaching/removing '
    'evidence is an append-only supporting-documents operation, not a '
    'correction to a declared fact, and must remain possible at any '
    'point in a record''s lifecycle, including during/after '
    'verification review. See this migration''s header comment.';


-- ------------------------------------------------------------
-- Part 2: audit_events aggregate_type -- add EVIDENCE_FILE
--   evidence_files is a genuine new aggregate (its own table, its own
--   lifecycle: uploaded / removed), not a sub-detail of EMISSION_DATA
--   -- matching how every other owned child table in this schema
--   (INSTALLATION, OPERATOR, SUPPLIER, SHARING_GRANT, ...) gets its
--   own aggregate_type rather than folding into its parent's. The
--   constraint being replaced is the one audit_events.aggregate_type
--   was created with in 20260828070000_create_organizations_foundation.sql
--   (an unnamed inline CHECK, so Postgres's default naming --
--   "<table>_<column>_check" -- gives it this exact name; confirmed
--   live via psql, not assumed, before this migration was applied).
-- ------------------------------------------------------------
alter table public.audit_events
    drop constraint audit_events_aggregate_type_check;

alter table public.audit_events
    add constraint audit_events_aggregate_type_check
    check (
        aggregate_type in (
            'ORGANIZATION',
            'MEMBERSHIP',
            'SHIPMENT',
            'SHIPMENT_LINE',
            'EMISSION_DATA',
            'INSTALLATION',
            'OPERATOR',
            'SUPPLIER',
            'SHARING_GRANT',
            'CALCULATION_RESULT',
            'DECLARATION',
            'EVIDENCE_FILE'
        )
    );


-- ============================================================
-- Part 3: EVIDENCE_FILES (metadata table)
--
-- One row per uploaded evidence file, immutable once created (no
-- UPDATE policy below -- a mistake means delete + re-upload, matching
-- this table's own comment). org_id is denormalized from the
-- referenced emission_data_id's own entered_by_org_id -- cross-
-- validated on INSERT via an EXISTS clause, the same pattern P7-B's
-- emission_data_insert_own_org uses against installations.
--
-- sha256 and size_bytes are always computed/measured server-side from
-- the actual uploaded bytes (src/application/evidence/upload-evidence.ts)
-- -- never trusted from client input, so these columns are a true
-- record of what was stored, not a copy of a client-supplied claim.
-- ============================================================

create table public.evidence_files (
    id uuid primary key default gen_random_uuid(),

    org_id uuid not null
        references public.organizations(id)
        on delete cascade,

    emission_data_id uuid not null
        references public.emission_data(id)
        on delete cascade,

    -- Full object path inside the 'evidence' storage bucket, e.g.
    -- "{org_id}/{emission_data_id}/{generated-filename}" -- see this
    -- migration's Part 4 for why the storage RLS policies require the
    -- first path segment to equal org_id, and
    -- src/application/evidence/upload-evidence.ts for why the
    -- filename segment itself is server-generated (a random UUID),
    -- not the client-supplied original filename.
    storage_path text not null,

    original_filename text not null,

    mime_type text not null,

    -- 20MB cap, mirroring the same limit enforced (independently,
    -- defense in depth) in
    -- src/application/evidence/upload-evidence.ts's validateEvidenceUpload.
    size_bytes bigint not null
        check (size_bytes > 0 and size_bytes <= 20971520),

    -- Lowercase hex sha256 digest of the actual uploaded bytes.
    sha256 text not null
        check (sha256 ~ '^[0-9a-f]{64}$'),

    uploaded_by_user_id uuid not null
        references auth.users(id)
        on delete restrict,

    created_at timestamptz not null default now()
);

comment on table public.evidence_files is
    'A supporting document (test report, certificate, invoice, ...) '
    'attached to one emission_data row. Append-only from the '
    'application''s perspective (no UPDATE policy below) -- a mistaken '
    'upload is removed and re-uploaded, never edited in place.';

-- One row per stored object -- guards against two evidence_files rows
-- ever silently pointing at the same storage object.
create unique index evidence_files_storage_path_uq
    on public.evidence_files (storage_path);

create index evidence_files_org_emission_data_idx
    on public.evidence_files (org_id, emission_data_id);


-- ============================================================
-- Part 4: ROW LEVEL SECURITY -- evidence_files
-- ============================================================

alter table public.evidence_files
    enable row level security;

create policy evidence_files_select_own_org
    on public.evidence_files
    for select
    to authenticated
    using (
        org_id in (select app.user_org_ids())
    );

-- Cross-parent validation, mirroring emission_data_insert_own_org's own
-- EXISTS clause (20260829230000): the referenced emission_data_id must
-- actually belong to the SAME org_id being denormalized onto this row,
-- so a caller cannot point emission_data_id at a different org's
-- record while claiming the evidence file as their own.
create policy evidence_files_insert_own_org
    on public.evidence_files
    for insert
    to authenticated
    with check (
        org_id in (select app.user_org_ids())
        and exists (
            select 1
            from public.emission_data ed
            where ed.id = evidence_files.emission_data_id
              and ed.entered_by_org_id = evidence_files.org_id
        )
    );

-- No UPDATE policy: files are immutable once uploaded (see this
-- table's own comment) -- a mistake is a DELETE + re-upload, not an
-- in-place edit.

-- Removing an evidence file (e.g. the wrong document was uploaded) is
-- a legitimate, ordinary action -- unlike emission_data's own
-- no-DELETE posture (where DISCARD is the sanctioned retirement path
-- instead), evidence_files has no soft-delete/status lifecycle to
-- retire through, so a real DELETE is the correct primitive here.
create policy evidence_files_delete_own_org
    on public.evidence_files
    for delete
    to authenticated
    using (
        org_id in (select app.user_org_ids())
    );


-- ============================================================
-- Part 5: STORAGE -- 'evidence' bucket + storage.objects RLS
--
-- Private (public = false) -- every read goes through a short-lived
-- signed URL generated server-side after an ownership check
-- (src/application/evidence/upload-evidence.ts's
-- getEvidenceDownloadUrl), never a public/anon URL.
--
-- Path convention: "{org_id}/{emission_data_id}/{filename}". The
-- storage.objects RLS policies below extract the first path segment
-- via storage.foldername(name) -- Supabase's documented idiom for
-- this (storage.foldername(name) returns the object's directory
-- components as text[], excluding the final filename component; for
-- "org-id/emission-data-id/file.pdf" that is {org-id, emission-data-id},
-- so (storage.foldername(name))[1] is the org_id segment) -- and
-- require it to be one of the caller's own organizations via the same
-- app.user_org_ids() helper every other table's RLS uses. This is the
-- FIRST storage bucket/RLS in this codebase; storage.objects itself
-- already has row level security enabled by Supabase's own storage
-- extension setup (confirmed live, not assumed, before this migration
-- was authored), so only the policies are added here, not
-- `enable row level security` itself.
-- ============================================================

insert into storage.buckets (id, name, public)
values ('evidence', 'evidence', false)
on conflict (id) do nothing;

create policy evidence_storage_select_own_org
    on storage.objects
    for select
    to authenticated
    using (
        bucket_id = 'evidence'
        and (storage.foldername(name))[1]::uuid in (select app.user_org_ids())
    );

create policy evidence_storage_insert_own_org
    on storage.objects
    for insert
    to authenticated
    with check (
        bucket_id = 'evidence'
        and (storage.foldername(name))[1]::uuid in (select app.user_org_ids())
    );

create policy evidence_storage_delete_own_org
    on storage.objects
    for delete
    to authenticated
    using (
        bucket_id = 'evidence'
        and (storage.foldername(name))[1]::uuid in (select app.user_org_ids())
    );

-- No UPDATE policy on storage.objects: evidence objects are immutable
-- once uploaded, same posture as the evidence_files metadata row
-- above -- a mistake is a DELETE + re-upload of a new object, never an
-- in-place overwrite (the application layer also always uploads with
-- upsert:false, so this is enforced twice).


-- ============================================================
-- END OF MIGRATION
-- ============================================================
