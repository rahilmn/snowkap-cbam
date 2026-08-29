-- ============================================================
-- Snowkap CBAM
-- P13 audit follow-up: emission_data_update_own_org's evidence_file_ids
-- anti-join used a bare ::uuid cast, the same class of bug
-- 20260829410000 (app.try_cast_uuid) already fixed once for
-- storage.objects' RLS policies
--
-- Purpose:
--   20260829480000's new WITH CHECK anti-join on emission_data_update_own_org
--   compares each unnested evidence_file_ids element against
--   evidence_files.id via `claimed.evidence_file_id::uuid`. Live-
--   reproduced (tests/integration/emission-data-write-hardening.test.ts,
--   "a malformed (non-uuid) evidence_file_ids entry..."): a row whose
--   evidence_file_ids contains a non-uuid string (only possible at
--   INSERT time -- evidence_file_ids is one of
--   app.prevent_emission_data_fact_change's protected "fact" columns,
--   so it can never be set via UPDATE, not even by service_role) makes
--   ANY subsequent UPDATE to that row -- even one touching only
--   updated_at, nothing evidence-related at all -- fail with a raw
--   Postgres 22P02 (invalid_text_representation) instead of a clean
--   42501 policy rejection, PROVIDED at least one real evidence_files
--   row exists for that same emission_data_id (confirmed empirically:
--   with zero matching evidence_files rows, the planner resolves the
--   correlated NOT EXISTS as true via the emission_data_id filter
--   alone and never reaches the uuid comparison at all -- so this is
--   narrower than 20260829410000's storage.objects case, which took
--   every reader's query offline from a single bad row anywhere in the
--   whole table; here the blast radius is confined to that one
--   emission_data row's own future UPDATEs). Once such a row exists --
--   nothing at INSERT time validates evidence_file_ids' contents
--   either, per 20260829480000's own Finding 1 -- it becomes stuck:
--   every legitimate UPDATE (verify, reject, discard, even a plain
--   resubmit) raises the same raw type error instead of the intended
--   policy rejection, recoverable only via a service-role fix.
--
--   Same fix as 20260829410000: replace the bare cast with
--   app.try_cast_uuid() (already defined, unchanged here), which
--   returns NULL on a malformed value instead of raising --
--   `ef.id = NULL` is simply false, exactly "this element doesn't name
--   a real evidence_files row," the correct outcome the anti-join was
--   always meant to produce for a forged/malformed entry.
-- ============================================================


drop policy emission_data_update_own_org on public.emission_data;

create policy emission_data_update_own_org
    on public.emission_data
    for update
    to authenticated
    using (
        entered_by_org_id in (select app.user_org_ids())
    )
    with check (
        entered_by_org_id in (select app.user_org_ids())
        and not exists (
            select 1
            from unnest(evidence_file_ids) as claimed(evidence_file_id)
            where not exists (
                select 1
                from public.evidence_files ef
                where ef.id = app.try_cast_uuid(claimed.evidence_file_id)
                  and ef.emission_data_id = emission_data.id
                  and ef.org_id = emission_data.entered_by_org_id
            )
        )
    );

comment on policy emission_data_update_own_org on public.emission_data is
    '2026-08-29 (P13 audit follow-up): identical to the 20260829480000 '
    'definition except the evidence_file_ids anti-join now casts via '
    'app.try_cast_uuid() instead of a bare ::uuid -- see this '
    'migration''s header comment for the live-reproduced 22P02 crash '
    'that closes.';
