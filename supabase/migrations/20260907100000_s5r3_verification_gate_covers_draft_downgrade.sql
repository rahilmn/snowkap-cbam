-- ============================================================
-- Snowkap CBAM
-- S5 review remediation round 3 (2026-09-07), finding S5R3-AUTHZ-B1
-- (fresh independent Opus 5 certification review, round 3).
--
-- THE GAP. app.enforce_emission_data_verification_gate's two ACTIVE-
-- scoped locks (20260903150000, P14 v2) -- "an ACTIVE, VERIFIED record
-- cannot be un-verified" and "evidence may grow but never shrink on an
-- ACTIVE, VERIFIED record" -- are both keyed on `old.status = 'ACTIVE'
-- and old.verification_status = 'VERIFIED'`. That scoping was
-- deliberate and correct at the time it was written: nothing in the
-- codebase yet treated a DRAFT+VERIFIED record as locked, so there was
-- nothing on a DRAFT row worth protecting from either write.
--
-- That stopped being true the same day this trigger was last touched.
-- 20260906230000 (S5 cross-phase hardening) widened app.enforce_
-- dossier_lock's own lock predicate from `verified_active_at is not
-- null` to `status <> 'DRAFT' or verification_status = 'VERIFIED'` --
-- explicitly asserting that a DRAFT+VERIFIED record IS locked, for the
-- declaration_context/precursors tables. evidence_files_delete_own_org
-- (20260829560000, even earlier) and evidence_storage_delete_own_org
-- (20260906270000/20260906280000) key their own locks off `verification
-- _status = 'VERIFIED'` alone, with no status condition at all -- they
-- were already implicitly asserting the same thing for evidence.
--
-- None of those three locks were ever closed against the ONE write
-- that defeats all of them at once: an ordinary MEMBER of the owning
-- org (no ADMIN/OWNER privilege needed -- the verification gate's
-- ADMIN/OWNER check only fires on transitions INTO 'VERIFIED' or
-- 'REJECTED', never on a transition OUT of 'VERIFIED') issuing
--
--   UPDATE emission_data SET verification_status = 'VERIFICATION_PENDING'
--   WHERE id = ... AND status = 'DRAFT'
--
-- which the old downgrade guard's `old.status = 'ACTIVE'` condition
-- lets straight through. The moment that commits, `ed.status <>
-- 'DRAFT' or ed.verification_status = 'VERIFIED'` is false again
-- (status is still DRAFT, verification_status no longer VERIFIED), so
-- app.enforce_dossier_lock stops refusing, `ed.verification_status <>
-- 'VERIFIED'` is now true so evidence_files_delete_own_org stops
-- refusing, and the storage policy's own `not exists (...
-- verification_status = 'VERIFIED')` becomes vacuously true so it
-- stops refusing too. And the SAME record's own evidence_file_ids
-- array (this trigger's own separate "grow, never shrink" rule) is
-- also freed the instant verification_status changes, since that rule
-- shares the identical `old.status = 'ACTIVE'` qualifier.
--
-- Every one of S5's own DRAFT+VERIFIED locks reopens through this
-- single column write, with no ADMIN privilege required and no
-- transition the domain state machine actually contains: src/domain/
-- emissions/emission-data-lifecycle.ts's own transitionEmissionData
-- has NO action that ever moves verification_status OUT of 'VERIFIED'
-- for ANY record, DRAFT or ACTIVE -- SUBMIT_FOR_VERIFICATION requires
-- UNVERIFIED/REJECTED, VERIFY and REJECT both require
-- VERIFICATION_PENDING, and ACTIVATE/DISCARD never touch
-- verification_status at all. A downgrade out of VERIFIED is not a
-- narrow legitimate case that needs preserving on a DRAFT row -- it is
-- not a case the application ever produces, on ANY row, in ANY status.
--
-- THE FIX. Given that, the correct invariant is simpler than the one
-- being replaced, not more complex: once verification_status =
-- 'VERIFIED', it may never change, in any status, for anyone -- and
-- its evidence array may grow but never shrink for as long as that
-- holds, in any status, for anyone. Dropping the `old.status =
-- 'ACTIVE'` qualifier from both of those two rules closes the DRAFT
-- gap and keeps the ACTIVE case exactly as strict as it already was --
-- a strict widening of what is refused, never a narrowing (nothing
-- previously refused becomes newly admitted). The THIRD rule in this
-- trigger ("an ACTIVE record cannot return to DRAFT") is left
-- untouched: it protects a different, unrelated concern (status
-- reversal, not verification/evidence integrity), and a DRAFT record
-- was never ACTIVE in the first place, so it has nothing to say about
-- this gap either way.
--
-- ACTIVATE (DRAFT -> ACTIVE) is unaffected: it never changes
-- verification_status or evidence_file_ids, so neither widened
-- condition's "is distinct from" / shrink check ever fires for that
-- UPDATE. The ordinary submit / verify / reject / resubmit loop is
-- unaffected for the identical reason -- none of those transitions
-- ever fire against a row whose CURRENT verification_status is already
-- 'VERIFIED'. Evidence may still be freely ADDED to a DRAFT+VERIFIED
-- record, matching the ACTIVE+VERIFIED case exactly.
--
-- The recovery path for a DRAFT record verified by mistake is the same
-- one already offered for the ACTIVE case: DISCARD it (still fully
-- available -- transitionEmissionData's DISCARD action only requires
-- status = 'DRAFT', which is unaffected by this migration, and neither
-- widened rule fires on a DISCARD because it changes only `status`)
-- and start a fresh record, rather than un-verifying and re-editing in
-- place.
--
-- LIVE-VERIFIED (S5 review remediation round 3, adversarial verify,
-- real psql BEGIN...ROLLBACK against local Postgres, per CLAUDE.md):
-- the exact attack this finding reproduced -- an ordinary MEMBER
-- downgrading a DRAFT+VERIFIED record's verification_status -- is now
-- refused for both a MEMBER and an OWNER (confirming this is not a
-- role gap); a DRAFT+VERIFIED record's evidence_file_ids can no longer
-- be emptied either; the ACTIVE+VERIFIED case (the 20260903150000
-- control, and the independent app.enforce_emission_data_lineage_lock
-- second wall) is still refused identically; every step of the
-- ordinary submit/verify/reject/resubmit/verify loop still succeeds
-- unchanged; and DISCARD remains available as the recovery path for a
-- DRAFT+VERIFIED record, leaving verification_status untouched
-- (VERIFIED) while status moves to DISCARDED.
-- ============================================================

create or replace function app.enforce_emission_data_verification_gate()
returns trigger
language plpgsql
as $$
begin
    if new.verification_status is distinct from old.verification_status
        and new.verification_status in ('VERIFIED', 'REJECTED')
        and not app.user_is_admin_or_owner_of(new.entered_by_org_id)
    then
        raise exception
            'emission_data: only an ADMIN or OWNER of the owning organization may verify or reject a record';
    end if;

    -- ------------------------------------------------------------
    -- 2026-09-07 (S5 review remediation round 3, finding S5R3-AUTHZ-B1,
    -- widens the 2026-09-03 v2 rule). A VERIFIED record cannot leave
    -- VERIFIED, whatever else the same statement does -- in ANY status,
    -- not only ACTIVE. See this migration's own header for why DRAFT
    -- was left exposed and why closing it needs no status qualifier at
    -- all: transitionEmissionData has no transition that ever produces
    -- this write, for any record, in any status.
    -- ------------------------------------------------------------
    if old.verification_status = 'VERIFIED'
        and new.verification_status is distinct from old.verification_status
    then
        raise exception
            'emission_data: a VERIFIED record cannot be un-verified, in any status. Importers may already have frozen its evidence set into a determination, or its declared context/precursors may already be treated as authoritative. Discard it and start a new record instead.'
            using errcode = '42501';
    end if;

    -- ------------------------------------------------------------
    -- An ACTIVE record cannot go back to DRAFT.
    --
    -- Unchanged by this migration -- a different, unrelated concern
    -- (status reversal, not verification/evidence integrity), and a
    -- DRAFT record was never ACTIVE, so this rule has nothing to say
    -- about the DRAFT+VERIFIED gap either way.
    -- ------------------------------------------------------------
    if old.status = 'ACTIVE'
        and new.status = 'DRAFT'
    then
        raise exception
            'emission_data: an ACTIVE record cannot return to DRAFT. Discard it, or supersede it with a new version.'
            using errcode = '42501';
    end if;

    -- ------------------------------------------------------------
    -- 2026-09-07 (S5 review remediation round 3, finding S5R3-AUTHZ-B1,
    -- widens the 2026-09-03 v2 rule). Evidence may GROW on a VERIFIED
    -- record, never SHRINK -- in ANY status, not only ACTIVE. Same
    -- reasoning as the un-verify rule above: the identical `old.status
    -- = 'ACTIVE'` qualifier left a DRAFT+VERIFIED record's evidence
    -- array exactly as strippable as its verification_status was.
    -- ------------------------------------------------------------
    if old.verification_status = 'VERIFIED'
        and exists (
            select 1
            -- text[], not uuid[] -- emission_data.evidence_file_ids is
            -- declared text[] (checked against information_schema
            -- rather than assumed; a uuid[] literal here raised
            -- "COALESCE could not convert type uuid[] to text[]" and,
            -- worse, broke the legitimate DISCARD path along with the
            -- attack it was meant to stop -- 20260903150000's own note).
            from unnest(coalesce(old.evidence_file_ids, array[]::text[])) as previous_id
            where previous_id <> all (coalesce(new.evidence_file_ids, array[]::text[]))
        )
    then
        raise exception
            'emission_data: evidence cannot be removed from a VERIFIED record, in any status. An importer may have frozen this exact evidence set into a determination, or it may already be treated as authoritative. Add evidence freely, or discard the record and start a new one.'
            using errcode = '42501';
    end if;

    -- Finding 2 + Finding 3 (verifier_user_id): a change to
    -- verifier_user_id is only ever legitimate in the exact same UPDATE
    -- that transitions verification_status INTO 'VERIFIED' (VERIFY,
    -- gated ADMIN+ above) -- and even then, the CALLER'S claimed value
    -- is discarded and overwritten with auth.uid().
    if new.verifier_user_id is distinct from old.verifier_user_id then
        if new.verification_status is distinct from old.verification_status
            and new.verification_status = 'VERIFIED'
        then
            new.verifier_user_id := auth.uid();
        else
            raise exception
                'emission_data: verifier_user_id may only change in the same UPDATE that transitions verification_status to VERIFIED, and is immutable thereafter';
        end if;
    end if;

    -- Finding 3 (rejection_reason): a change to rejection_reason is
    -- only ever legitimate in the same UPDATE that also changes
    -- verification_status -- REJECT sets both together (PENDING ->
    -- REJECTED, reason populated); SUBMIT_FOR_VERIFICATION clears it
    -- back to null in the same UPDATE that moves verification_status
    -- out of REJECTED. Rewriting rejection_reason while
    -- verification_status stays exactly where it was is rejected.
    if new.rejection_reason is distinct from old.rejection_reason
        and new.verification_status is not distinct from old.verification_status
    then
        raise exception
            'emission_data: rejection_reason may only change in the same UPDATE that changes verification_status';
    end if;

    return new;
end;
$$;

comment on function app.enforce_emission_data_verification_gate() is
    '2026-09-07 (S5 review remediation round 3, finding S5R3-AUTHZ-B1, '
    'widens the 2026-09-03 v2 rules). Keeps emission_data''s '
    'verification lifecycle honest: only an ADMIN or OWNER of the '
    'owning organization may verify or reject; verifier_user_id is set '
    'from auth.uid() on the transition into VERIFIED and is immutable '
    'thereafter; rejection_reason may only change alongside '
    'verification_status; a VERIFIED record can never be un-verified '
    'again in ANY status (widened from ACTIVE-only); an ACTIVE record '
    'cannot return to DRAFT; and a VERIFIED record''s evidence may grow '
    'but never shrink, in ANY status (widened from ACTIVE-only). The '
    'ACTIVE-only scoping on the last two rules left every DRAFT-side '
    'lock added since (app.enforce_dossier_lock, evidence_files_ '
    'delete_own_org, evidence_storage_delete_own_org) defeatable by an '
    'ordinary MEMBER through this exact column write.';
