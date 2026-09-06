-- ============================================================
-- Snowkap CBAM
-- S5 review remediation round 5 (2026-09-07), finding S5R5-AUTHZ-Y1
-- (fresh independent Opus 5 certification review, round 5).
--
-- THE GAP. app.enforce_emission_data_verification_gate checks WHO may
-- verify/reject (ADMIN/OWNER only), that verifier_user_id/
-- rejection_reason only change alongside the right transition, that a
-- VERIFIED record can never leave VERIFIED again (in any status,
-- S5R3-AUTHZ-B1), and that a VERIFIED record's evidence can never
-- shrink (also S5R3-AUTHZ-B1). It never checked that evidence_file_ids
-- is non-empty at the MOMENT verification_status transitions INTO
-- VERIFIED in the first place.
--
-- Neither does any CHECK constraint on public.emission_data -- the
-- full constraint list covers reporting-period/methodology/status/
-- version/numeric-format shape and emission_data_verified_has_
-- verifier_ck, but nothing about evidence. "VERIFIED requires
-- non-empty evidence" exists ONLY in src/application/emissions/
-- manage-emission-data.ts's verifyEmissionData, which calls
-- checkEmissionDataEvidenceCompleteness before issuing the UPDATE --
-- an application-level check, not a database-level authorization
-- boundary, exactly the class of gap this codebase's own migrations
-- repeatedly declare release-blocking on principle (20260903120000's
-- own header: "an application-level check is not an authorization
-- boundary").
--
-- The identical rule IS already enforced at the DB layer for the
-- sibling ACTIVATE transition: app.enforce_emission_data_activation_gate
-- refuses `new.status = 'ACTIVE'` whenever
-- `coalesce(array_length(new.evidence_file_ids,1),0) = 0`. Verification
-- had no DB-level twin of its own app-layer check; activation did.
--
-- LIVE-REPRODUCED (S5 review round 5): as an ordinary ADMIN of the
-- owning org, issuing a raw
--   UPDATE emission_data SET verification_status='VERIFIED', verifier_user_id=<self>
-- against a DRAFT record with evidence_file_ids='{}' succeeded --
-- UPDATE 1, no exception anywhere in the trigger chain (the activation
-- gate is a no-op here since `status` never changes). The record was
-- then immediately and permanently stuck at DRAFT/VERIFIED/{} --
-- app.enforce_dossier_lock locked its declaration_context/precursors
-- on the spot, and the S5R3-AUTHZ-B1 "cannot leave VERIFIED, in any
-- status" rule means the only recovery is DISCARD.
--
-- SCOPE, stated rather than inflated: this is reachable only by an
-- ADMIN/OWNER of the record's OWNING org issuing a raw authenticated
-- write that bypasses manage-emission-data.ts -- exactly the threat
-- model this codebase's own P13/P14/S5 forgery-fix series treats as
-- first-class. It does NOT cross a tenant boundary, and it does NOT
-- let the forged record reach cross-org visibility or ACTUAL-
-- determination eligibility: emission_data_select_own_org's shared
-- clause and app.emission_determination_matches_regulatory_record both
-- additionally require status = 'ACTIVE', which the activation gate's
-- own independent evidence check keeps this forged record from ever
-- reaching. The real damage is to the record's OWN org: a permanently
-- VERIFIED, permanently dossier-locked record that no review ever
-- actually backed.
--
-- THE FIX. Refuse a transition INTO VERIFIED whenever evidence_file_ids
-- is empty -- the same predicate the activation gate already uses,
-- applied one transition earlier. A strict widening of what is
-- refused: the legitimate, application-driven path already guarantees
-- non-empty evidence before this UPDATE ever runs (verifyEmissionData
-- checks checkEmissionDataEvidenceCompleteness first), so this rule
-- can never fire against real product usage -- only against the exact
-- forged/bypass path this finding reproduced.
--
-- LIVE-VERIFIED (S5 review round 5, adversarial verify, real psql
-- BEGIN...ROLLBACK per CLAUDE.md): the exact attack (verify with
-- evidence_file_ids='{}') is now refused for an ADMIN; verifying with
-- real, non-empty evidence still succeeds unchanged; the ordinary
-- submit/verify/reject/resubmit loop is unaffected (none of those
-- transitions ever move verification_status INTO VERIFIED with empty
-- evidence, since that is exactly what this rule blocks and what the
-- application never attempts).
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
    '2026-09-07 (S5 review remediation round 5, finding S5R5-AUTHZ-Y1, '
    'widens round 3''s rules). Keeps emission_data''s verification '
    'lifecycle honest: only an ADMIN or OWNER of the owning organization '
    'may verify or reject; a record may only transition INTO VERIFIED '
    'carrying non-empty evidence_file_ids (new -- the DB-level twin of '
    'verifyEmissionData''s own app-layer checkEmissionDataEvidence'
    'Completeness check, mirroring the activation gate''s identical '
    'rule); verifier_user_id is set from auth.uid() on the transition '
    'into VERIFIED and is immutable thereafter; rejection_reason may '
    'only change alongside verification_status; a VERIFIED record can '
    'never be un-verified again in ANY status; an ACTIVE record cannot '
    'return to DRAFT; and a VERIFIED record''s evidence may grow but '
    'never shrink, in ANY status.';
