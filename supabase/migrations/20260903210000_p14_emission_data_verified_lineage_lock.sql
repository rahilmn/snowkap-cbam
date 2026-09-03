-- ============================================================
-- Snowkap CBAM
-- P14 (2026-09-03), RELEASE BLOCKER B2: the evidence behind a
-- relied-upon verified record can still be destroyed, by routing
-- around the gates through a terminal state.
--
-- REPRODUCED LIVE against local Postgres as an ordinary MEMBER of the
-- owning organisation, inside BEGIN ... ROLLBACK, on a record that had
-- genuinely walked the whole lifecycle (member creates DRAFT, attaches
-- a real evidence_files row, submits; ADMIN verifies; ADMIN activates):
--
--   B2.3  ACTIVE -> DISCARDED      -> ADMITTED
--         DISCARDED -> DRAFT       -> ADMITTED
--         un-verify                -> ADMITTED
--         evidence_file_ids='{}'   -> ADMITTED
--         final state: DRAFT / VERIFICATION_PENDING / evidence 0
--
--   B2.4  the same walk through SUPERSEDED instead of DISCARDED
--         -> ADMITTED, evidence 0
--
--   B2.6  ACTIVE -> DISCARDED, then un-verify without a DRAFT hop
--         -> ADMITTED
--
-- The three rules 20260903150000 added all held against their own
-- named attacks and are kept:
--
--   B2.0  direct evidence strip on ACTIVE+VERIFIED   -> refused
--   B2.1  one statement, ACTIVE+VERIFIED -> DRAFT+PENDING -> refused
--   B2.2  two statements, ACTIVE -> DRAFT            -> refused
--
-- ------------------------------------------------------------
-- WHY THE PREVIOUS FIX WAS ALWAYS GOING TO LEAK
--
-- 20260903150000 replaced one transition-keyed rule with three more.
-- Every one of them is keyed on `old.status = 'ACTIVE'`. That makes
-- the protection a property of WHERE THE ROW IS RIGHT NOW, when what
-- actually needs protecting is a property of WHAT THE ROW HAS
-- ALREADY BEEN. Move the row somewhere else first and every such rule
-- stops applying to it -- which is precisely what B2.3 does, and what
-- the next detour past a list of forbidden transitions would do again.
--
-- A note on ACTIVE -> DISCARDED, because the first draft of THIS
-- migration got it wrong and the tests caught it. The application's own
-- DISCARD action requires `record.status === 'DRAFT'`
-- (src/domain/emissions/emission-data-lifecycle.ts, RECORD_NOT_DRAFT
-- otherwise), so it is tempting to read ACTIVE -> DISCARDED as
-- unreachable and forbid it. It is not: 20260903140000 deliberately
-- kept discard open at the schema level as "the legitimate way out" of
-- a verified, active record, and two standing tests assert it still
-- works. Forbidding it broke both. It stays allowed, and B2 is closed
-- by the marker instead -- which is the better place for it anyway,
-- since the marker holds in states the transition list has not thought
-- of.
--
-- ------------------------------------------------------------
-- THE INVARIANT THIS MIGRATION MAKES TRUE
--
--   Once a record has been ACTIVE and VERIFIED -- once, ever -- its
--   verification and its evidentiary basis are permanent facts about
--   it. No sequence of status changes, of any length, through any
--   state, can make them mutable again.
--
-- Expressed as a durable marker rather than a transition list:
-- `verified_active_at` is stamped the first time a row is ACTIVE and
-- VERIFIED and is immutable thereafter, so the rules key on the row's
-- HISTORY. A detour cannot clear a fact that has already been
-- recorded.
--
-- Three rules follow from the marker, and hold in every state:
--
--   1. verification_status can never change once marked. (It is
--      necessarily 'VERIFIED' at that point, and there is no legitimate
--      way back: the ways to retire such a record change `status`.)
--   2. evidence_file_ids may GROW but never shrink or be substituted.
--      Growth is a real requirement -- uploadEvidenceFile adds files
--      after verification, and actual-determination-is-unchanged.ts
--      treats a grown evidence set as a reason redetermination must
--      proceed. Set containment, not length, so swapping one id for
--      another is caught.
--   3. `status` may never return to DRAFT.
--
-- ------------------------------------------------------------
-- AND THE STATE MACHINE ITSELF, WHICH NEVER EXISTED
--
-- The deeper reason B2.3 had a first step to take is that
-- emission_data.status had no transition constraint. The CHECK
-- constraint pins the four legal VALUES; nothing pinned the legal
-- MOVES. app.enforce_emission_data_activation_gate constrains
-- transitions INTO 'ACTIVE' and nothing else, so ACTIVE -> DISCARDED,
-- DISCARDED -> DRAFT, SUPERSEDED -> DRAFT, DISCARDED -> ACTIVE and
-- every other combination were all simply available.
--
-- The domain's state machine, transcribed from
-- emission-data-lifecycle.ts, is exactly:
--
--   (insert) -> DRAFT
--   DRAFT    -> ACTIVE        ACTIVATE  (requires VERIFIED + evidence)
--   DRAFT    -> DISCARDED     DISCARD
--   ACTIVE   -> DISCARDED     DISCARD, kept open at the schema level by
--                             20260903140000 as "the legitimate way out"
--                             of a verified, active record, and asserted
--                             by two standing tests -- even though
--                             emission-data-lifecycle.ts's own DISCARD
--                             action requires DRAFT
--   ACTIVE   -> SUPERSEDED    the second row of the two-row supersede
--                             in activateEmissionData
--
-- Five transitions. Everything else is refused. This is defence in
-- depth; the marker above is the wall, and is what makes the invariant
-- hold even if a future migration widens this machine again.
--
-- ------------------------------------------------------------
-- SCOPE
--
-- These are integrity invariants about the data, not authorization
-- rules about the caller, so unlike 20260903200000's INSERT gate they
-- apply to every role -- exactly as the existing verification,
-- activation and fact-change triggers already do. A trusted server
-- path has no more business un-verifying a record an importer has
-- frozen than a member does.
--
-- Backfill: existing rows that are ACTIVE+VERIFIED, or SUPERSEDED and
-- VERIFIED (a SUPERSEDED row was necessarily ACTIVE, which necessarily
-- required VERIFIED), are marked from `updated_at`. That is the best
-- available evidence of when the row reached that state and is
-- recorded as approximate rather than presented as exact -- the column
-- exists to say THAT the row crossed the line, not precisely when.
-- ============================================================

alter table public.emission_data
    add column if not exists verified_active_at timestamptz;

comment on column public.emission_data.verified_active_at is
    'Stamped the first time this record is simultaneously ACTIVE and '
    'VERIFIED; immutable thereafter, and never cleared. Records that '
    'the record HAS CROSSED the line beyond which its verification and '
    'its evidentiary basis are permanent facts -- an importer may '
    'already have frozen this exact evidence set into a determination. '
    'Deliberately a durable marker rather than a set of rules about '
    'the current status, because every status-keyed rule stops '
    'applying the moment the row is moved somewhere else (P14 blocker '
    'B2). Backfilled from updated_at for rows that had already crossed '
    'it when this column was added, so historical values are '
    'approximate.';

update public.emission_data
   set verified_active_at = updated_at
 where verified_active_at is null
   and verification_status = 'VERIFIED'
   and status in ('ACTIVE', 'SUPERSEDED');

create or replace function app.enforce_emission_data_lineage_lock()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
    -- ------------------------------------------------------------
    -- Stamp the marker. Fires on INSERT too: a trusted path may seed a
    -- record directly in a terminal state, and such a row must be born
    -- already locked rather than becoming lockable only if it is
    -- updated later.
    -- ------------------------------------------------------------
    if tg_op = 'INSERT' then
        if new.verified_active_at is null
            and new.status in ('ACTIVE', 'SUPERSEDED')
            and new.verification_status = 'VERIFIED'
        then
            new.verified_active_at := clock_timestamp();
        end if;

        return new;
    end if;

    -- ------------------------------------------------------------
    -- The status state machine. Transcribed from
    -- src/domain/emissions/emission-data-lifecycle.ts; see this
    -- migration's header for the full list and why none of it was
    -- enforced before.
    --
    -- Stated as an allowlist. A transition nobody has thought about
    -- is refused, rather than permitted because no rule named it --
    -- which is how ACTIVE -> DISCARDED came to be reachable.
    -- ------------------------------------------------------------
    if new.status is distinct from old.status
        and not (
            (old.status = 'DRAFT'  and new.status = 'ACTIVE')
            or (old.status = 'DRAFT'  and new.status = 'DISCARDED')
            or (old.status = 'ACTIVE' and new.status = 'SUPERSEDED')
            -- ACTIVE -> DISCARDED is deliberately allowed, and the
            -- first version of this migration was wrong to forbid it.
            --
            -- src/domain/emissions/emission-data-lifecycle.ts's DISCARD
            -- action requires status = 'DRAFT', which is why the first
            -- draft of this state machine left it out. But that is the
            -- APPLICATION's path, not the schema's rule:
            -- 20260903140000 deliberately kept discard open as "the
            -- legitimate way out" of a verified, active record, and two
            -- standing tests assert exactly that --
            -- "P14/F11: discarding an ACTIVE, VERIFIED record still
            -- works" (emission-data-write-hardening) and the cross-org
            -- re-savability case in
            -- shipment-line-determination-hardening. Both failed
            -- against the stricter machine, which is how this was
            -- caught.
            --
            -- Allowing it does not reopen B2. The four-step chain needs
            -- DISCARDED -> DRAFT next, which is still not a transition,
            -- and un-verifying or shrinking evidence is refused by the
            -- verified_active_at marker below in EVERY state, terminal
            -- ones included. The marker is the wall; this list is
            -- defence in depth behind it.
            or (old.status = 'ACTIVE' and new.status = 'DISCARDED')
        )
    then
        raise exception
            'emission_data: % -> % is not a lifecycle transition. The only transitions are DRAFT -> ACTIVE (activate), DRAFT -> DISCARDED and ACTIVE -> DISCARDED (discard), and ACTIVE -> SUPERSEDED (superseded by a new version).',
            old.status, new.status
            using errcode = '42501';
    end if;

    -- ------------------------------------------------------------
    -- Everything below applies only once the row has crossed the line,
    -- and applies in EVERY state thereafter -- including terminal
    -- ones. That is the whole point: B2.3 and B2.4 both work by first
    -- parking the row in a state where the old rules stopped applying.
    -- ------------------------------------------------------------
    if old.verified_active_at is null then
        -- Not yet authoritative. Stamp it if this statement is what
        -- makes it so, and otherwise leave the ordinary draft
        -- workflow completely alone.
        if new.status = 'ACTIVE'
            and new.verification_status = 'VERIFIED'
        then
            new.verified_active_at := clock_timestamp();
        end if;

        return new;
    end if;

    if new.verified_active_at is distinct from old.verified_active_at then
        raise exception
            'emission_data: verified_active_at is immutable. It records that this record has been ACTIVE and VERIFIED, which is a fact about its history and cannot be undone.'
            using errcode = '42501';
    end if;

    if new.verification_status is distinct from old.verification_status then
        raise exception
            'emission_data: this record has been ACTIVE and VERIFIED, so its verification is permanent. Importers may already have frozen it into a determination. Supersede it with a new version instead.'
            using errcode = '42501';
    end if;

    -- Set containment, not length: a same-size substitution is the
    -- more dangerous case, because the record still looks complete.
    -- text[], matching the column's declared type -- a uuid[] literal
    -- here raises "COALESCE could not convert type uuid[] to text[]".
    if exists (
        select 1
        from unnest(coalesce(old.evidence_file_ids, array[]::text[])) as previous_id
        where previous_id <> all (coalesce(new.evidence_file_ids, array[]::text[]))
    )
    then
        raise exception
            'emission_data: evidence cannot be removed from a record that has been ACTIVE and VERIFIED. An importer may have frozen this exact evidence set into a determination; removing or substituting a file makes that determination unsavable for them. Evidence may still be added.'
            using errcode = '42501';
    end if;

    return new;
end;
$$;

comment on function app.enforce_emission_data_lineage_lock() is
    '2026-09-03 (P14, blocker B2). Two things the schema never had. '
    'First, a status state machine: emission_data.status had a CHECK '
    'pinning its four legal values and nothing pinning the legal '
    'moves, so ACTIVE -> DISCARDED -> DRAFT was simply available and '
    'is what every gate keyed on old.status = ''ACTIVE'' was walked '
    'around. Second, a durable marker: verified_active_at is stamped '
    'the first time a row is ACTIVE and VERIFIED, and from then on its '
    'verification is permanent and its evidence may grow but never '
    'shrink or be substituted -- in every state, including terminal '
    'ones. Keying on the row''s history rather than on where it '
    'happens to be right now is what makes this hold against a detour '
    'of any length, which a list of forbidden transitions cannot.';

-- Idempotent by construction. The P14 review found that migrations in
-- this project are neither atomic nor idempotent, and that re-applying
-- one of them permanently drops two RLS policies. A trigger definition
-- costs nothing to make re-runnable, and a migration that can be safely
-- re-applied is one fewer way a recovery goes wrong.
drop trigger if exists emission_data_lineage_lock_trg on public.emission_data;

create trigger emission_data_lineage_lock_trg
    before insert or update on public.emission_data
    for each row
    execute function app.enforce_emission_data_lineage_lock();
