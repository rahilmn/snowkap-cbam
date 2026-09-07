-- 2026-09-07 (S5 review round 7, findings S5R7-AUTHZ-1/S5R7-AUTHZ-B1 --
-- CORRECTING migration 20260907310000, which regressed a real P13
-- security test found during this same round's own regression run:
-- tests/integration/emission-data-write-hardening.test.ts's "rejects
-- deleting an evidence file whose owning emission_data record is
-- VERIFIED (P13 review, finding S6)". That test seeds an evidence_files
-- row that was NEVER linked into evidence_file_ids at all (a direct
-- INSERT, bypassing uploadEvidenceFile's own array-append step) and
-- expects its DELETE to stay refused purely because the parent is
-- VERIFIED -- 20260907310000's widened policy could not distinguish
-- "never cited" from "legitimately, atomically removed from the array
-- moments before this call," and incorrectly permitted deleting BOTH.
-- The P13 invariant (ANY evidence_files row under a VERIFIED record is
-- undeletable, regardless of the array's own current contents) is the
-- correct, conservative one to keep -- widening it to make an
-- exception based on live re-derived array state was the wrong tool
-- for the job.
--
-- The right fix closes the S5R7-AUTHZ-1/B1 race by construction
-- instead: removeEvidenceFile previously performed the evidence_
-- file_ids array shrink and the evidence_files metadata DELETE as TWO
-- separate, sequential statements/round trips (each its own implicit
-- transaction under PostgREST) -- exactly what let a concurrent,
-- legitimate VERIFY land strictly between them. Combining both into
-- ONE atomic function call makes that race structurally impossible:
-- the array UPDATE's own row lock on the emission_data row blocks a
-- concurrent VERIFY (itself an UPDATE on the SAME row) from committing
-- until this whole transaction (both statements) has already committed
-- or rolled back -- so by the time the metadata DELETE runs, moments
-- later in the SAME transaction, verification_status is PROVABLY
-- unchanged from what the array update already saw. No RLS policy
-- needs to change at all; evidence_files_delete_own_org keeps its
-- original, unwidened, P13-tested condition.
--
-- First: restore evidence_files_delete_own_org to its exact pre-
-- 20260907310000 form.
drop policy if exists evidence_files_delete_own_org on public.evidence_files;

create policy evidence_files_delete_own_org
on public.evidence_files
for delete
using (
  org_id in (select app.user_org_ids())
  and exists (
    select 1
    from public.emission_data ed
    where ed.id = evidence_files.emission_data_id
      and ed.verification_status <> 'VERIFIED'
  )
);

-- Second: the new atomic combined operation. Composes the existing,
-- independently-tested remove_evidence_file_id (unchanged, still used
-- and tested standalone by tests/integration/evidence-file-ids-
-- concurrent-mutation.test.ts) with the metadata delete, in one
-- function call -- one PostgREST RPC request is one transaction, so
-- both statements below share the same transaction and the same row
-- lock. SECURITY INVOKER (the default, matching remove_evidence_file_id
-- itself): both the array UPDATE and the metadata DELETE still run AS
-- the calling user, so every existing RLS policy governing each
-- (including the anti-shrink trigger on the UPDATE, and
-- evidence_files_delete_own_org's own unwidened condition on the
-- DELETE) is still genuinely, independently enforced -- this function
-- adds no new privilege, it only removes the round-trip gap between
-- two writes that were already each individually authorized.
create or replace function public.remove_evidence_file_and_metadata(
  p_emission_data_id uuid,
  p_evidence_file_id text
)
returns table(metadata_deleted boolean)
language plpgsql
set search_path to 'public'
as $$
declare
  v_deleted_id uuid;
begin
  perform public.remove_evidence_file_id(p_emission_data_id, p_evidence_file_id);

  delete from public.evidence_files
  where id = p_evidence_file_id::uuid
    and emission_data_id = p_emission_data_id
  returning id into v_deleted_id;

  return query select v_deleted_id is not null;
end;
$$;

grant execute on function public.remove_evidence_file_and_metadata(uuid, text) to authenticated;
