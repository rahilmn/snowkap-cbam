-- 2026-09-07 (S5 review round 7, findings S5R7-AUTHZ-1/S5R7-AUTHZ-B1 --
-- two independent reviewers converged on the identical root cause).
--
-- removeEvidenceFile (src/application/evidence/upload-evidence.ts)
-- performs the evidence_file_ids array shrink (remove_evidence_file_id,
-- 20260906240000) and the evidence_files metadata DELETE as two
-- separate statements. evidence_files_delete_own_org's own USING
-- clause was keyed ONLY on the parent emission_data row's CURRENT
-- verification_status -- never on whether THIS evidence_files row's id
-- is still cited in that row's own evidence_file_ids array at all.
--
-- Live-reproduced race: (1) a MEMBER removes evidence file X from a
-- not-yet-VERIFIED record -- the array update commits, permanently and
-- correctly dropping X from evidence_file_ids (the only column
-- checkEmissionDataEvidenceCompleteness, determine-from-actual-data.ts,
-- and get-buyer-view.ts's countEvidenceFiles actually read); (2)
-- before that SAME call's metadata DELETE runs, an ADMIN legitimately
-- VERIFIES the record (verifyEmissionData only ever writes
-- verification_status/verifier_user_id, so it reads the array X was
-- already dropped from and passes cleanly); (3) the metadata DELETE
-- for X now hits this policy's old verification_status-only gate and
-- is unconditionally refused, even though X poses zero risk to the
-- record's evidence set -- it's already gone from the array. X's
-- evidence_files row (and its storage object) are now permanently
-- orphaned: forever visible in listEvidenceFiles/evidence-section.tsx,
-- forever downloadable via getEvidenceDownloadUrl, and can never be
-- deleted again by anyone, because S5R3-AUTHZ-B1's own rule guarantees
-- a VERIFIED record can never leave VERIFIED "in any status" -- this
-- gate can never open for this row through the old condition again.
-- removeEvidenceFile's own S5R6-AUTHZ-1 disambiguation then reports
-- EMISSION_DATA_VERIFIED for this outcome -- true about the record's
-- status, false about the actual, already-fully-successful removal.
--
-- Fix: widen the gate to ALSO permit deletion when this row's own id
-- is no longer present in its parent's CURRENT evidence_file_ids --
-- i.e. delete is refused only when the row is BOTH (a) citing a
-- VERIFIED record's evidence AND (b) still actually cited by that
-- record's own array. This is safe by construction, not a new way to
-- strip evidence from a VERIFIED record: the anti-shrink trigger
-- (S5R3-AUTHZ-B1, widened by S5R6-SHARE-B1) already guarantees the
-- ONLY way an id can leave evidence_file_ids while its parent is or
-- becomes VERIFIED is if the removal committed strictly BEFORE the
-- record was (or became, in the same statement as) VERIFIED -- an
-- already-legitimate, already-permitted state this policy previously
-- had no way to recognize. Once metadata deletion succeeds this way,
-- the storage cleanup that follows (removeEvidenceFile's own
-- best-effort step, S5R5-AUTHZ-Y2) already succeeds unconditionally
-- once no evidence_files row cites the object -- no further widening
-- needed there.
drop policy if exists evidence_files_delete_own_org on public.evidence_files;

create policy evidence_files_delete_own_org
on public.evidence_files
for delete
using (
  org_id in (select app.user_org_ids())
  and (
    exists (
      select 1
      from public.emission_data ed
      where ed.id = evidence_files.emission_data_id
        and ed.verification_status <> 'VERIFIED'
    )
    or exists (
      select 1
      from public.emission_data ed
      where ed.id = evidence_files.emission_data_id
        and not (evidence_files.id::text = any (coalesce(ed.evidence_file_ids, array[]::text[])))
    )
  )
);
