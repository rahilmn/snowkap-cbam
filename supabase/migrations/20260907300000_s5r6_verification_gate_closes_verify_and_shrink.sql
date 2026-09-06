-- 2026-09-07 (S5 review remediation round 6, finding S5R6-SHARE-B1).
--
-- app.enforce_emission_data_verification_gate() enforces two evidence-
-- integrity rules that, independently, are each correct: (a) S5R5-
-- AUTHZ-Y1 refuses a transition INTO verification_status = 'VERIFIED'
-- when the RESULTING evidence_file_ids is empty; (b) S5R3-AUTHZ-B1
-- refuses evidence_file_ids shrinking whenever old.verification_status
-- = 'VERIFIED'. Neither is keyed on the id set as it stood the instant
-- BEFORE the value being verified was fixed: rule (a) only checks the
-- NEW array is non-empty (any number of ids may have been dropped to
-- get there), and rule (b) only fires when OLD.verification_status is
-- ALREADY 'VERIFIED' -- it is blind to a shrink happening IN THE SAME
-- STATEMENT that performs the transition INTO VERIFIED, since at that
-- instant OLD.verification_status is still the pre-verify value (e.g.
-- VERIFICATION_PENDING), not 'VERIFIED'.
--
-- Live-reproduced (real psql BEGIN...ROLLBACK, impersonating a real
-- MEMBER then a real ADMIN of the same org, never a client-side
-- rollback header): a record legitimately submitted with two evidence
-- files can be verified while one is silently dropped in the very
-- UPDATE that verifies it -- `UPDATE emission_data SET
-- verification_status = 'VERIFIED', verifier_user_id = ...,
-- evidence_file_ids = array[one-of-the-two-ids] WHERE id = ...`
-- succeeded with no exception, leaving a now-permanently-VERIFIED
-- record (S5R3-AUTHZ-B1's own "cannot be un-verified, in any status"
-- rule) whose evidence set was never actually checked complete against
-- its own final contents -- checkEmissionDataEvidenceCompleteness
-- (verifyEmissionData's own app-layer check) only ever inspects the
-- PRE-update row, so it cannot see or object to a shrink that happens
-- inside the verifying UPDATE itself.
--
-- Unreachable through the product's own UI/API: verifyEmissionData's
-- updateColumns closure (src/application/emissions/manage-emission-
-- data.ts) only ever writes verification_status and verifier_user_id,
-- never evidence_file_ids, in the same UPDATE. Reachable only by a raw
-- authenticated PATCH from an ADMIN/OWNER of the record's own org
-- bypassing manage-emission-data.ts -- exactly the threat model this
-- same trigger function's own S5R3-AUTHZ-B1/S5R5-AUTHZ-Y1 fixes already
-- treat as first-class and blocking.
--
-- Fix: widen the anti-shrink rule's own condition from
-- `old.verification_status = 'VERIFIED'` to
-- `old.verification_status = 'VERIFIED' or new.verification_status = 'VERIFIED'`
-- -- closing it by construction rather than by timing. A record that IS
-- or WAS VERIFIED at either end of this UPDATE must never lose an
-- evidence id it held immediately before the statement ran, whether or
-- not verification_status itself is the column changing. The
-- legitimate VERIFY flow is unaffected: verifyEmissionData never
-- touches evidence_file_ids, so new.evidence_file_ids is byte-identical
-- to old.evidence_file_ids in that statement and the widened exists()
-- check still finds nothing to object to.
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
    -- 2026-09-07 (S5 review remediation round 5, finding
    -- S5R5-AUTHZ-Y1). A record may only transition INTO VERIFIED
    -- carrying real evidence -- the identical rule app.enforce_
    -- emission_data_activation_gate already enforces for the DRAFT ->
    -- ACTIVE transition. See this migration's own header for why
    -- verification had no DB-level twin of its own app-layer check
    -- until now.
    -- ------------------------------------------------------------
    if new.verification_status is distinct from old.verification_status
        and new.verification_status = 'VERIFIED'
        and coalesce(array_length(new.evidence_file_ids, 1), 0) = 0
    then
        raise exception
            'emission_data: a record may only be verified while evidence_file_ids is non-empty -- see verifyEmissionData (src/application/emissions/manage-emission-data.ts)'
            using errcode = '42501';
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
    --
    -- 2026-09-07 (S5 review remediation round 6, finding S5R6-SHARE-B1,
    -- widens this rule again). `or new.verification_status = 'VERIFIED'`
    -- added -- see this migration's own header for the exact composition
    -- gap this closes: without it, a single UPDATE transitioning INTO
    -- VERIFIED in the same statement that shrinks evidence_file_ids was
    -- invisible to this rule, because OLD.verification_status is still
    -- the pre-verify value at that instant, not yet 'VERIFIED'.
    -- ------------------------------------------------------------
    if (old.verification_status = 'VERIFIED' or new.verification_status = 'VERIFIED')
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
