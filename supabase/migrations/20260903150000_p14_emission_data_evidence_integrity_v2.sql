-- ============================================================
-- Snowkap CBAM
-- P14 (2026-09-03): 20260903140000's downgrade gate has a hole, and it
-- was closing the wrong half of the problem anyway.
--
-- Found by the P14 adversarial security re-check, reproduced live
-- against local Postgres inside rolled-back transactions before this
-- migration was written. Both defects below are stated with the exact
-- statement that exercises them.
--
-- ------------------------------------------------------------
-- DEFECT 1: the gate is bypassed by moving `status` in the same breath.
--
-- 20260903140000 wrote:
--
--     if old.verification_status = 'VERIFIED'
--        and new.verification_status is distinct from old.verification_status
--        and old.status = 'ACTIVE'
--        and new.status = 'ACTIVE'
--
-- The last conjunct is the hole. Either of these walks straight past it:
--
--     update emission_data set status='DRAFT',
--            verification_status='VERIFICATION_PENDING' where ...;   -- one statement
--
--     update emission_data set status='DRAFT' where ...;             -- two statements
--     update emission_data set verification_status='VERIFICATION_PENDING' where ...;
--
-- and the whole chain that migration's header named --
-- VERIFIED -> strip evidence -> VERIFIED -- is reproducible again.
--
-- The `new.status = 'ACTIVE'` conjunct was justified on the grounds that
-- DISCARD and SUPERSEDE "change status, not verification_status". That
-- reasoning was right and the conjunct was still wrong: those paths are
-- already excluded by `new.verification_status is distinct from
-- old.verification_status`, which is false for them. The status pair
-- bought nothing the predicate did not already have, and cost the
-- invariant.
--
-- Two rules replace it. An ACTIVE + VERIFIED record cannot leave
-- VERIFIED whatever else the statement does; and an ACTIVE record
-- cannot go back to DRAFT at all, because no such transition exists in
-- the domain (emission-data-lifecycle.ts has only DRAFT -> ACTIVE and
-- DRAFT -> DISCARDED) and it is the step the evidence strip needs. The
-- second rule is what closes the two-statement variant, which the first
-- alone cannot.
--
-- ------------------------------------------------------------
-- DEFECT 2, worse and simpler: no downgrade is needed at all.
--
--     update emission_data set evidence_file_ids = '{}' where ...;
--
-- succeeds on an ACTIVE + VERIFIED record, as an ordinary member,
-- leaving it ACTIVE + VERIFIED with zero evidence. Reproduced live.
--
-- 20260829560000 made the evidence_files ROWS immutable behind a
-- VERIFIED record, and removeEvidenceFile refuses in the application.
-- Neither touches this ARRAY. app.prevent_emission_data_fact_change
-- deliberately omits evidence_file_ids so that files can still be ADDED
-- after verification -- a real requirement, relied on by
-- actual-determination-is-unchanged.ts, which treats a grown evidence
-- set as a reason redetermination must be allowed to proceed.
--
-- So the column has to stay mutable, and only in one direction. This
-- migration forbids REMOVAL while the record is ACTIVE + VERIFIED, and
-- leaves addition alone.
--
-- Why removal is the harmful direction: the v10 determination validator
-- compares an importer's frozen evidence set byte-for-byte against the
-- live array. Emptying it means a determination that was valid when it
-- was made can no longer be re-saved by the importer, and the error
-- they get says "locked or void" -- which explains nothing, and is not
-- about their shipment at all. The producer can do this to a
-- counterparty's already-filed provenance without either party seeing
-- why.
--
-- SCOPE, unchanged from 20260903140000 and still true: this needs a
-- member of the organisation that owns the record, acting on its own
-- data. It is not cross-tenant. What makes it worth closing is that the
-- party harmed is a different organisation with no way to see it.
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
    -- 2026-09-03 (P14 v2). An ACTIVE + VERIFIED record cannot leave
    -- VERIFIED, whatever else the same statement does.
    --
    -- Keyed on old.status only. Deliberately NOT on new.status: that is
    -- exactly the conjunct that let `set status='DRAFT',
    -- verification_status='VERIFICATION_PENDING'` through. DISCARD and
    -- SUPERSEDE are unaffected because they do not change
    -- verification_status, so this branch is never reached for them.
    -- ------------------------------------------------------------
    if old.status = 'ACTIVE'
        and old.verification_status = 'VERIFIED'
        and new.verification_status is distinct from old.verification_status
    then
        raise exception
            'emission_data: an ACTIVE, VERIFIED record cannot be un-verified. Importers may already have frozen its evidence set into a determination. Supersede it with a new version, or discard it.'
            using errcode = '42501';
    end if;

    -- ------------------------------------------------------------
    -- An ACTIVE record cannot go back to DRAFT.
    --
    -- There is no such transition in the domain -- emission-data-
    -- lifecycle.ts has only DRAFT -> ACTIVE and DRAFT -> DISCARDED --
    -- and nothing else in the schema constrained `status` transitions,
    -- so this was reachable and was the first half of the two-statement
    -- bypass: park the record at DRAFT, and every gate keyed on
    -- old.status = 'ACTIVE' stops applying to it.
    -- ------------------------------------------------------------
    if old.status = 'ACTIVE'
        and new.status = 'DRAFT'
    then
        raise exception
            'emission_data: an ACTIVE record cannot return to DRAFT. Discard it, or supersede it with a new version.'
            using errcode = '42501';
    end if;

    -- ------------------------------------------------------------
    -- Evidence may GROW on an ACTIVE + VERIFIED record, never SHRINK.
    --
    -- Growth is a genuine requirement (see this migration's header);
    -- removal is what breaks a counterparty's frozen determination. The
    -- test is set containment rather than length, so swapping one id for
    -- another -- same count, different evidence -- is caught too.
    -- ------------------------------------------------------------
    if old.status = 'ACTIVE'
        and old.verification_status = 'VERIFIED'
        and exists (
            select 1
            -- text[], not uuid[] -- emission_data.evidence_file_ids is
            -- declared text[] (checked against information_schema
            -- rather than assumed; a uuid[] literal here raised
            -- "COALESCE could not convert type uuid[] to text[]" and,
            -- worse, broke the legitimate DISCARD path along with the
            -- attack it was meant to stop).
            from unnest(coalesce(old.evidence_file_ids, array[]::text[])) as previous_id
            where previous_id <> all (coalesce(new.evidence_file_ids, array[]::text[]))
        )
    then
        raise exception
            'emission_data: evidence cannot be removed from an ACTIVE, VERIFIED record. An importer may have frozen this exact evidence set into a determination; removing a file makes that determination unsavable for them. Add evidence freely, or supersede the record with a new version.'
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
    -- verification_status.
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
    '2026-09-03 (P14 v2, corrects the gate added earlier the same day). '
    'Keeps emission_data''s verification lifecycle and its evidence '
    'honest: only an ADMIN or OWNER of the owning organization may '
    'verify or reject; verifier_user_id is set from auth.uid() on the '
    'transition into VERIFIED and is immutable thereafter; '
    'rejection_reason may only change alongside verification_status; an '
    'ACTIVE, VERIFIED record cannot be un-verified whatever else the '
    'statement does; an ACTIVE record cannot return to DRAFT; and '
    'evidence may be added to an ACTIVE, VERIFIED record but never '
    'removed. The first version keyed the un-verify rule on new.status '
    'as well as old.status, which a single UPDATE moving both columns '
    'walked straight past, and did not protect the evidence array at '
    'all -- so the evidence could simply be emptied in one statement '
    'with no downgrade involved.';
