-- ============================================================
-- Snowkap CBAM
-- S5 (2026-09-06), cross-phase hardening: uploadEvidenceFile and
-- removeEvidenceFile (src/application/evidence/upload-evidence.ts) both
-- mutate emission_data.evidence_file_ids with a client-side
-- read-then-filter-then-write: read the array, compute a new array in
-- application code, UPDATE the whole column to that new value. Two such
-- calls against the SAME record, interleaved, can each read the SAME
-- baseline array before either writes -- the second writer's own write
-- then overwrites the first's, silently dropping whichever change
-- committed first, with no error anywhere in the chain.
--
-- LIVE-REPRODUCED (S5 adversarial audit, real interleaved statement
-- sequence, not a mock): remove-A reads [A] (its own stale baseline);
-- upload-B reads the same [A]; upload-B inserts evidence_files row B,
-- writes evidence_file_ids=[A,B] -- succeeds; remove-A deletes
-- evidence_files row A, then writes evidence_file_ids = its OWN stale
-- [A] filtered to remove A = [] -- this succeeds too, because the
-- existing evidence_file_ids anti-join (20260829480000) only checks
-- "does every SURVIVING element still exist," which an empty array
-- trivially satisfies. Final state: evidence_file_ids={} while
-- evidence_files row B (genuinely uploaded, genuinely audited as
-- 'evidence.uploaded') remains live and orphaned -- uncited, silently.
-- No exception is ever raised in this sequence, so removeEvidenceFile's
-- own existing single-retry-on-error logic (added for a narrower,
-- same-direction race between two concurrent REMOVALS) never engages,
-- because there is no error to trigger it.
--
-- The corrupted count is read by two real product surfaces: checkEmis
-- sionDataEvidenceCompleteness (the single gate used by verifyEmission
-- Data/activateEmissionData/determine-from-actual-data.ts's own
-- consumption check) and get-buyer-view.ts's own countEvidenceFiles,
-- shown to a cross-org buyer on the "Buyer view & readiness" page --
-- so this can silently understate evidence to a counterparty with no
-- signal to either party.
--
-- FIX. Two small, narrowly-scoped SECURITY INVOKER RPCs that perform
-- the array mutation as a single atomic SQL statement
-- (array_append/array_remove), rather than a client read-then-write.
-- SECURITY INVOKER means RLS applies exactly as it already does to a
-- bare client UPDATE -- emission_data_update_own_org's own WITH CHECK
-- (including the evidence_file_ids anti-join, unchanged) still governs
-- every write through these functions, for the SAME calling user, with
-- no widened authorization surface. Two concurrent calls against the
-- same row now serialize at the row level (Postgres's own MVCC/locking
-- for a single-row UPDATE), so the second call's array_append/
-- array_remove is guaranteed to operate on the FIRST call's already-
-- committed result, not a stale snapshot -- eliminating the race by
-- construction rather than detecting and retrying it.
-- ============================================================

create or replace function public.append_evidence_file_id(
    p_emission_data_id uuid,
    p_evidence_file_id text
)
returns void
language sql
security invoker
set search_path = public
as $$
    update public.emission_data
    set evidence_file_ids = array_append(evidence_file_ids, p_evidence_file_id)
    where id = p_emission_data_id;
$$;

comment on function public.append_evidence_file_id(uuid, text) is
    '2026-09-06 (S5). Atomically appends one id onto emission_data.'
    'evidence_file_ids -- a single UPDATE ... SET x = array_append(x, ...) '
    'statement, never a client-side read-then-write, so two concurrent '
    'calls against the same row serialize at the row level instead of '
    'racing to overwrite each other. SECURITY INVOKER: RLS (emission_'
    'data_update_own_org, including its evidence_file_ids anti-join) '
    'applies exactly as it does to a bare client UPDATE.';

revoke all on function public.append_evidence_file_id(uuid, text)
    from public, anon;

grant execute on function public.append_evidence_file_id(uuid, text)
    to authenticated;

create or replace function public.remove_evidence_file_id(
    p_emission_data_id uuid,
    p_evidence_file_id text
)
returns void
language sql
security invoker
set search_path = public
as $$
    update public.emission_data
    set evidence_file_ids = array_remove(evidence_file_ids, p_evidence_file_id)
    where id = p_emission_data_id;
$$;

comment on function public.remove_evidence_file_id(uuid, text) is
    '2026-09-06 (S5). Atomically removes one id from emission_data.'
    'evidence_file_ids -- see append_evidence_file_id''s own comment '
    'for the full reasoning this mirrors.';

revoke all on function public.remove_evidence_file_id(uuid, text)
    from public, anon;

grant execute on function public.remove_evidence_file_id(uuid, text)
    to authenticated;
