-- ============================================================
-- Snowkap CBAM
-- P13 audit findings, live-reproduced against real Postgres: three
-- distinct ways to corrupt an emission_data record's verification
-- attribution and evidence backing without ever going through
-- src/application/emissions/manage-emission-data.ts or
-- src/application/evidence/upload-evidence.ts.
--
-- Purpose:
--   emission_data_update_own_org (20260829230000, unchanged since) is a
--   bare org-scoping policy -- `entered_by_org_id in (select
--   app.user_org_ids())` on both USING and WITH CHECK, no role
--   predicate, no content validation. Two BEFORE UPDATE triggers add
--   the only real content rules today: app.prevent_emission_data_fact_change
--   (pins "fact" columns immutable; evidence_file_ids was deliberately
--   exempted from it in 20260829240000/P7-C so evidence could be
--   attached post-insert) and app.enforce_emission_data_verification_gate
--   (ADMIN+-only for verification_status transitioning INTO
--   VERIFIED/REJECTED). Neither trigger constrains WHAT evidence_file_ids
--   or verifier_user_id/rejection_reason may legitimately contain, only
--   WHO may touch verification_status. That gap is exactly what a bare
--   client UPDATE (any raw supabase.from("emission_data").update(...)
--   call, bypassing manage-emission-data.ts/upload-evidence.ts
--   entirely) can walk through. Three findings, each independently
--   live-reproduced below in rolled-back transactions via
--   `set local role authenticated` + `set local request.jwt.claims`
--   (the same methodology the adversarial audit itself used) before
--   this migration existed, and re-verified blocked afterward:
--
--   Finding 1 -- evidence_file_ids forgery + status='ACTIVE' bypass:
--     A plain MEMBER can set evidence_file_ids to an array of
--     non-existent uuids (`update emission_data set evidence_file_ids =
--     array['<made-up-uuid>'] where id = ...` succeeds) -- there is no
--     FK/CHECK tying this column to real evidence_files rows. That
--     defeats checkEmissionDataEvidenceCompleteness
--     (src/domain/emissions/snapshot-completeness.ts), the sole gate
--     VERIFY, ACTIVATE, and cross-org consumption
--     (determine-from-actual-data.ts) all rely on to block a record
--     with no real supporting documents from becoming
--     verified/activated/consumable. The SAME bare policy also lets a
--     plain MEMBER `update emission_data set status = 'ACTIVE' where
--     id = ...` directly on a DRAFT+UNVERIFIED+no-evidence row,
--     skipping SUBMIT_FOR_VERIFICATION, VERIFY, and the evidence gate
--     entirely -- transitionEmissionData's own ACTIVATE case
--     (src/domain/emissions/emission-data-lifecycle.ts) requires
--     status='DRAFT' AND verification_status='VERIFIED' before
--     allowing this, but that pure function is application-layer only;
--     nothing at the database layer enforced its precondition.
--
--   Finding 2 -- verifier_user_id never pinned to auth.uid():
--     app.enforce_emission_data_verification_gate checks WHO may cause
--     a transition into VERIFIED (ADMIN+ of the org), never that
--     verifier_user_id = auth.uid(). A genuine ADMIN of the org can
--     verify a record while naming a COMPLETELY UNRELATED person (not
--     even a member of the org) as verifier_user_id --
--     `update emission_data set verification_status='VERIFIED',
--     verifier_user_id='<arbitrary-other-user>' where id=...` succeeds
--     for any uuid that merely exists in auth.users (the only
--     constraint is the FK). That value is exactly what
--     ActualEmissionSnapshot.verification.verifier_user_id
--     (src/application/emissions/determine-from-actual-data.ts) freezes
--     into an importer's declaration package -- a permanent regulatory
--     attestation naming who approved the underlying data. Every other
--     "who did this" column in this schema (import_batches.created_by,
--     calculation_results.calculated_by_user_id,
--     declarations.created_by_user_id, audit_events.actor_user_id) is
--     already pinned to auth.uid() in its own INSERT policy or a
--     SECURITY DEFINER function -- emission_data.verifier_user_id was
--     simply missed.
--
--   Finding 3 -- verifier_user_id/rejection_reason mutable after the
--   fact, silently, with no ADMIN gate and no audit trail:
--     app.enforce_emission_data_verification_gate only fires logic when
--     `new.verification_status is distinct from old.verification_status`
--     -- once a row is already VERIFIED, a plain MEMBER (not even
--     ADMIN) can `update emission_data set verifier_user_id =
--     '<anyone>', rejection_reason = 'whatever' where id = ...` without
--     ever touching verification_status, and
--     app.prevent_emission_data_fact_change leaves both columns
--     unprotected (by original design -- see 20260829230000's own
--     header comment: they are lifecycle columns, meant to change
--     during VERIFY/REJECT). The application layer
--     (manage-emission-data.ts) is bypassed entirely by a raw client
--     UPDATE, so no audit_events row is ever written either. The
--     falsified attribution is then visible cross-org to any grantee
--     with an active sharing grant (emission_data_select_own_org's
--     shared-installation branch, 20260829320000).
--
-- Root cause, and why one migration closes all three:
--   All three stem from the same gap -- emission_data_update_own_org's
--   WITH CHECK, and the two BEFORE UPDATE triggers, validate WHO is
--   allowed to touch verification_status but never WHAT the resulting
--   row's evidence/attribution columns actually contain. This migration
--   adds exactly three mechanisms, matching this session's own
--   20260829450000 precedent (tighten via a new helper function /
--   CREATE OR REPLACE of an existing trigger function, leave the USING
--   clause and every legitimate application-layer path untouched):
--
--   (1) evidence_file_ids: emission_data_update_own_org's WITH CHECK
--       gains a NOT EXISTS anti-join -- every element of the proposed
--       evidence_file_ids array must already exist as a real
--       evidence_files row owned by THIS SAME record (emission_data_id)
--       and org. This is the same cross-parent-validation idiom this
--       schema already uses everywhere a denormalized/array reference
--       needs checking (emission_data_insert_own_org's own EXISTS
--       against installations, evidence_files_insert_own_org's EXISTS
--       against emission_data) -- chosen over routing evidence linkage
--       through a new SECURITY DEFINER RPC because
--       src/application/evidence/upload-evidence.ts's uploadEvidenceFile/
--       removeEvidenceFile ALREADY write evidence_file_ids as a
--       read-then-write append/filter using the caller's own
--       RLS-enforced client (never a raw array assignment) -- an
--       anti-join WITH CHECK validates exactly that existing legitimate
--       shape without requiring those two functions, or their tests, to
--       change at all. A new RPC would be strictly more machinery for
--       the identical resulting guarantee.
--
--   (2) status='ACTIVE': a new BEFORE UPDATE trigger,
--       app.enforce_emission_data_activation_gate, mirrors
--       app.enforce_emission_data_verification_gate's own
--       transition-aware shape (OLD-vs-NEW comparison a bare RLS policy
--       cannot express) -- a transition INTO status='ACTIVE' is only
--       valid when OLD.status='DRAFT' (transitionEmissionData's own
--       ACTIVATE precondition), NEW.verification_status='VERIFIED', and
--       NEW.evidence_file_ids is non-empty (checkEmissionDataEvidenceCompleteness's
--       own rule, re-expressed as a database-layer backstop). Combined
--       with (1), a non-empty evidence_file_ids at this point is
--       guaranteed to name real evidence.
--
--   (3) verifier_user_id / rejection_reason:
--       app.enforce_emission_data_verification_gate (CREATE OR REPLACE,
--       same function this codebase already established the precedent
--       of tightening in place across P7-C/P11/P13 reviews rather than
--       ever editing an applied migration) gains two new rules:
--         - verifier_user_id may change ONLY in the same UPDATE that
--           transitions verification_status INTO 'VERIFIED' -- and when
--           it does, the trigger OVERWRITES it to auth.uid()
--           unconditionally (`new.verifier_user_id := auth.uid()`)
--           rather than merely validating the caller's claimed value.
--           This makes forgery structurally impossible, the same
--           posture audit_events.actor_user_id already has (pinned via
--           `actor_user_id = auth.uid()` at the INSERT-policy/RPC layer
--           -- see 20260828150000's own comment) -- not just rejected
--           after the fact. Any attempt to change verifier_user_id
--           outside that one legitimate transition (including on a row
--           already VERIFIED, Finding 3's own reproduction) is
--           rejected outright.
--         - rejection_reason may change ONLY in the same UPDATE that
--           also changes verification_status. Every legitimate
--           transition already satisfies this (REJECT sets both
--           together; SUBMIT_FOR_VERIFICATION clears rejection_reason
--           back to null in the same UPDATE that moves
--           verification_status out of REJECTED); ACTIVATE/DISCARD
--           never touch either column. A raw UPDATE that rewrites
--           rejection_reason while verification_status stays exactly
--           where it was (Finding 3's own reproduction) is rejected.
--       verifier_user_id was deliberately NOT added to
--       app.prevent_emission_data_fact_change's "fact" column set --
--       that trigger's whole model is "this column never changes after
--       INSERT, ever" (a correction needs a new version), which is
--       wrong for a column whose entire purpose is to be set ONCE,
--       later, by VERIFY. A purpose-built rule inside the existing
--       transition-aware verification-gate trigger fits this column's
--       actual shape; bolting a same-value initial-null-only exception
--       onto the generic fact-immutability trigger would not (that
--       trigger has no OLD-value-was-null special case anywhere else,
--       and mixing "always identical" columns with "settable exactly
--       once, then frozen" columns in one undifferentiated check list
--       would obscure rather than clarify the rule).
--
-- Every one of the four attacks below was actually run against this
-- local instance, unpatched, before this migration was written (a
-- rolled-back transaction, not assumed) and confirmed to succeed; each
-- is re-run after this migration and confirmed to now fail, alongside
-- the six legitimate application flows
-- (recordEmissionData/submitForVerification/verifyEmissionData/
-- rejectEmissionData/activateEmissionData/discardEmissionData) and
-- uploadEvidenceFile/removeEvidenceFile, confirmed still to succeed.
-- ============================================================


-- ============================================================
-- 1. app.enforce_emission_data_verification_gate -- CREATE OR REPLACE,
--    adds the verifier_user_id pin/immutability and rejection_reason
--    co-change rules (Findings 2 and 3). The existing ADMIN+ transition
--    check is untouched.
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

    -- Finding 2 + Finding 3 (verifier_user_id): a change to
    -- verifier_user_id is only ever legitimate in the exact same UPDATE
    -- that transitions verification_status INTO 'VERIFIED' (VERIFY,
    -- gated ADMIN+ above) -- and even then, the CALLER'S claimed value
    -- is discarded and overwritten with auth.uid(), the same
    -- "structurally impossible to forge" posture audit_events.actor_user_id
    -- already has. Any other attempted change (including rewriting an
    -- already-VERIFIED row's verifier_user_id without touching
    -- verification_status at all -- Finding 3's own live reproduction)
    -- is rejected outright, which also makes verifier_user_id
    -- effectively immutable once legitimately set (no further
    -- transition can move verification_status INTO 'VERIFIED' a second
    -- time, since transitionEmissionData's own state machine has no
    -- path back into VERIFIED).
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
    -- verification_status stays exactly where it was (Finding 3's own
    -- live reproduction, on an already-VERIFIED row) is rejected.
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
    '2026-08-29 (P13 review): BEFORE UPDATE guard. Unchanged from '
    '20260829230000 -- ADMIN+ required for a transition INTO VERIFIED/'
    'REJECTED. Added: verifier_user_id may only change in the same '
    'UPDATE that transitions verification_status to VERIFIED, and is '
    'then force-overwritten to auth.uid() (forgery-proof, not merely '
    'validated -- Finding 2); rejection_reason may only change in the '
    'same UPDATE that changes verification_status (Finding 3). See this '
    'migration''s header comment for the live-reproduced attacks this '
    'closes.';


-- ============================================================
-- 2. app.enforce_emission_data_activation_gate -- new BEFORE UPDATE
--    trigger, closes Finding 1's status='ACTIVE' direct-write gap.
--    Same transition-aware shape as the verification gate above --
--    a bare RLS WITH CHECK cannot distinguish "status is RESTING at
--    ACTIVE" from "status is being SET to ACTIVE right now" (identical
--    reasoning to 20260829230000's own header comment on why the
--    verification gate is a trigger, not a bare policy clause).
-- ============================================================

create or replace function app.enforce_emission_data_activation_gate()
returns trigger
language plpgsql
as $$
begin
    if new.status is distinct from old.status
        and new.status = 'ACTIVE'
        and (
            old.status <> 'DRAFT'
            or new.verification_status <> 'VERIFIED'
            or coalesce(array_length(new.evidence_file_ids, 1), 0) = 0
        )
    then
        raise exception
            'emission_data: a record may only transition to ACTIVE from DRAFT while verification_status = VERIFIED and evidence_file_ids is non-empty -- see activateEmissionData (src/application/emissions/manage-emission-data.ts)';
    end if;

    return new;
end;
$$;

comment on function app.enforce_emission_data_activation_gate() is
    '2026-08-29 (P13 review): BEFORE UPDATE guard -- DB-layer backstop '
    'for transitionEmissionData''s own ACTIVATE precondition '
    '(src/domain/emissions/emission-data-lifecycle.ts: status must be '
    'DRAFT and verification_status must be VERIFIED) plus '
    'checkEmissionDataEvidenceCompleteness''s own rule '
    '(src/domain/emissions/snapshot-completeness.ts: evidence_file_ids '
    'non-empty), re-expressed here because emission_data_update_own_org''s '
    'bare RLS policy previously let a plain MEMBER set status=''ACTIVE'' '
    'directly on a DRAFT+UNVERIFIED+no-evidence row, skipping '
    'SUBMIT_FOR_VERIFICATION/VERIFY and the evidence gate entirely '
    '(Finding 1, live-reproduced). Combined with '
    'emission_data_update_own_org''s new evidence_file_ids anti-join '
    '(below), a non-empty evidence_file_ids at this point is guaranteed '
    'to name real evidence_files rows, not forged uuids.';

create trigger emission_data_activation_gate_trg
    before update on public.emission_data
    for each row
    execute function app.enforce_emission_data_activation_gate();


-- ============================================================
-- 3. emission_data_update_own_org -- WITH CHECK gains an anti-join
--    requiring every evidence_file_ids element to be a real,
--    same-record, same-org evidence_files row (Finding 1's
--    evidence_file_ids forgery gap). USING is unchanged -- every
--    member of the owning org may still attempt an UPDATE; the two
--    triggers above and this new WITH CHECK clause decide what the
--    resulting row may actually contain, same "two independent
--    layers, tightened via drop+create" shape as 20260829450000.
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
                where ef.id = claimed.evidence_file_id::uuid
                  and ef.emission_data_id = emission_data.id
                  and ef.org_id = emission_data.entered_by_org_id
            )
        )
    );

comment on policy emission_data_update_own_org on public.emission_data is
    '2026-08-29 (P13 review): USING unchanged from 20260829230000 -- '
    'org-scoping only, no role predicate (see that migration''s own '
    'header comment for why the ADMIN+ verify/reject gate lives in the '
    'application layer + triggers instead of here). WITH CHECK adds a '
    'NOT EXISTS anti-join: every element of the proposed '
    'evidence_file_ids array must already exist as a real evidence_files '
    'row owned by this same emission_data_id and org. Closes a '
    'live-reproduced forgery: a plain MEMBER could otherwise set '
    'evidence_file_ids to an array of non-existent uuids via a bare '
    'client UPDATE, defeating checkEmissionDataEvidenceCompleteness '
    '(the gate VERIFY, ACTIVATE, and cross-org consumption all rely on) '
    'without ever uploading a real file through '
    'src/application/evidence/upload-evidence.ts.';


-- ============================================================
-- END OF MIGRATION
-- ============================================================
