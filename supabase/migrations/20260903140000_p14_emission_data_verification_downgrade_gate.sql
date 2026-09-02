-- ============================================================
-- Snowkap CBAM
-- P14 (2026-09-03), F11: an ACTIVE, VERIFIED emission_data record can be
-- un-verified, and its evidence then stripped.
--
-- THE GAP. 20260829560000 makes the evidence behind a VERIFIED record
-- immutable -- removeEvidenceFile refuses, and RLS refuses -- and
-- determine-from-actual-data.ts relies on exactly that when it freezes
-- an evidence set into an ActualEmissionSnapshot.
--
-- But the verification gate only ever fired on transitions INTO
-- 'VERIFIED' or 'REJECTED'. Nothing stopped an ADMIN of the owning
-- organisation moving an ACTIVE record from VERIFIED back to
-- VERIFICATION_PENDING. Once there, the evidence is removable again:
--
--   VERIFIED  ->  VERIFICATION_PENDING  ->  remove a file  ->  VERIFIED
--
-- and the record ends up verified with less evidence behind it than an
-- importer's frozen snapshot claims. verifier_user_id is untouched
-- throughout -- the trigger only rewrites it on a transition INTO
-- VERIFIED, and this path re-enters legitimately -- so nothing in the
-- row shows the round trip happened.
--
-- The consequence lands on the OTHER party. The importer's frozen
-- determination cites documents that no longer exist; the v10
-- determination validator compares the frozen evidence set byte-for-byte
-- against the live one, so that line can no longer be re-saved, and the
-- error it produces ("locked or void") explains nothing.
--
-- SCOPE, stated rather than inflated: this needs an ADMIN or OWNER of
-- the organisation that owns the record, acting against their own data,
-- and it is bounded to that organisation. It is not cross-tenant. What
-- makes it worth closing is that the party who is harmed is a different
-- organisation that has no way to see it.
--
-- THE FIX. A record that is ACTIVE and VERIFIED cannot leave VERIFIED.
--
-- Deliberately narrow. Only a downgrade out of VERIFIED, and only while
-- `status` stays ACTIVE -- the state in which someone else may already
-- be relying on the record. The legitimate ways to retire a verified,
-- active record are DISCARD and being SUPERSEDED by a new version, and
-- both of those change `status`, not `verification_status`; they still
-- work. Every transition on a DRAFT record still works too, so nothing
-- about the ordinary submit / verify / reject / resubmit loop changes.
--
-- The body below is the 20260829480000 body verbatim apart from the
-- marked addition.
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
    -- 2026-09-03 (P14, F11). The downgrade that strips evidence.
    --
    -- 20260829560000 makes the evidence behind a VERIFIED record
    -- immutable, and that is what determine-from-actual-data.ts relies
    -- on when it freezes an evidence set into a snapshot. But nothing
    -- stopped an ADMIN of the owning organisation moving an ACTIVE
    -- record's verification_status from VERIFIED back to
    -- VERIFICATION_PENDING -- this trigger only ever fired on
    -- transitions INTO 'VERIFIED' or 'REJECTED', never out of them.
    --
    -- Once downgraded, the evidence is removable. Remove a file, then
    -- VERIFY again, and the record is VERIFIED once more with less
    -- evidence behind it than the importer's frozen snapshot claims --
    -- and the verifier attribution is untouched, so nothing in the row
    -- shows it happened. The importer's determination now cites
    -- documents that no longer exist, and the v10 validator would
    -- refuse to re-save that line for a reason nobody could explain
    -- from the data.
    --
    -- Narrow on purpose: only a downgrade OUT of VERIFIED, and only
    -- while the record is ACTIVE -- the state in which someone else may
    -- already be relying on it. The legitimate ways out of a verified,
    -- active record are DISCARD and being SUPERSEDED by a new version,
    -- and both change `status`, not `verification_status`. Those still
    -- work, and so does every transition on a DRAFT record.
    if old.verification_status = 'VERIFIED'
        and new.verification_status is distinct from old.verification_status
        and old.status = 'ACTIVE'
        and new.status = 'ACTIVE'
    then
        raise exception
            'emission_data: an ACTIVE, VERIFIED record cannot be un-verified. Importers may already have frozen its evidence set into a determination. Supersede it with a new version, or discard it.'
            using errcode = '42501';
    end if;

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
    '2026-09-03 (P14, adds the downgrade gate to the 2026-08-29 body). '
    'Keeps emission_data''s verification lifecycle honest: only an ADMIN '
    'or OWNER of the owning organization may verify or reject; '
    'verifier_user_id is set from auth.uid() on the transition into '
    'VERIFIED and is immutable thereafter; rejection_reason may only '
    'change alongside verification_status; and -- new -- an ACTIVE, '
    'VERIFIED record cannot be un-verified at all, because doing so '
    'reopened its evidence for removal while importers may already have '
    'frozen that evidence set into a determination.';
