-- ============================================================
-- Snowkap CBAM
-- S5 (2026-09-06), cross-phase hardening: app.enforce_dossier_lock
-- (20260906200000) only fires once emission_data.verified_active_at is
-- set -- which happens ONLY once a record reaches ACTIVE+VERIFIED
-- together. Between VERIFY and ACTIVATE, a record can sit DRAFT+
-- VERIFIED for a real, producer-controlled duration (verifyEmissionData
-- and activateEmissionData, src/application/emissions/manage-emission-
-- data.ts, are separate actions/transactions, never atomic) -- and for
-- that entire window, this trigger provides ZERO protection. Only the
-- application layer's own verifyEmissionDataEditable (manage-
-- declaration-context.ts / manage-precursors.ts) guards it, and that
-- guard is a plain SELECT-then-write across two separate PostgREST
-- round trips, not a database-level wall.
--
-- LIVE-REPRODUCED (S5 adversarial audit): seeded a record directly at
-- status=DRAFT, verification_status=VERIFIED (a real, reachable state --
-- verified_active_at stays NULL until status becomes ACTIVE). As an
-- ordinary MEMBER of the owning org (no admin privilege, no timing
-- precision required -- a deterministic gap, not a race), direct
-- UPDATE/DELETE against emission_data_declaration_context and
-- emission_data_precursors both succeeded with zero exceptions. A
-- control against the SAME fixture seeded ACTIVE+VERIFIED instead was
-- correctly refused, confirming the gap is precisely this one state,
-- not a broader malfunction.
--
-- This directly falsifies the invariant manage-declaration-context.ts's
-- own doc comment states in v2.1.1 section 11's own words: "authoritative
-- context for a published dossier version is the context captured by
-- its last successful verification transition." The application layer
-- already enforces the CORRECT boundary (verifyEmissionDataEditable:
-- `row.status !== 'DRAFT' || row.verification_status === 'VERIFIED'`,
-- fixed earlier this same S4 phase, commit 79b01e1) -- this migration
-- moves the identical condition down to the database layer as the
-- second wall, matching this codebase's own established two-wall
-- doctrine (app.enforce_emission_data_lineage_lock's own header:
-- "these are integrity invariants about the data... apply to every
-- role", 20260903210000) for the sibling parent-table case.
--
-- Widens app.enforce_dossier_lock's own lock predicate from
-- `verified_active_at is not null` to the app layer's exact condition.
-- Because emission_data's own state machine has no transition back
-- into DRAFT once left (app.enforce_emission_data_lineage_lock,
-- 20260903210000: DRAFT -> ACTIVE | DISCARDED are the only ways out),
-- `status <> 'DRAFT'` already subsumes the ACTIVE+VERIFIED case this
-- trigger already covered -- this is a strict widening, not a
-- replacement; nothing previously refused becomes newly admitted.
-- Every other clause (emission_data_id immutability, the "parent no
-- longer exists" cascade-delete exemption) is unchanged.
-- ============================================================

create or replace function app.enforce_dossier_lock()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_emission_data_id uuid;
    v_locked boolean;
begin
    v_emission_data_id :=
        case tg_op
            when 'DELETE' then old.emission_data_id
            else new.emission_data_id
        end;

    if tg_op = 'UPDATE' and new.emission_data_id is distinct from old.emission_data_id then
        raise exception
            '%: emission_data_id is immutable -- create a new row against the intended record instead of repointing an existing one',
            tg_table_name
            using errcode = '42501';
    end if;

    -- S5 (2026-09-06): widened from `verified_active_at is not null` to
    -- match verifyEmissionDataEditable's own app-layer condition
    -- exactly -- locks the moment the parent leaves DRAFT (ACTIVE,
    -- DISCARDED, or SUPERSEDED, none of which the state machine ever
    -- returns from) OR the moment it is VERIFIED, whichever comes
    -- first, rather than waiting for both together.
    select ed.status <> 'DRAFT' or ed.verification_status = 'VERIFIED'
    into v_locked
    from public.emission_data ed
    where ed.id = v_emission_data_id;

    -- v_locked is null (not true) if the referenced emission_data row
    -- no longer exists -- the ON DELETE CASCADE FK will remove this
    -- row along with it in that case, which is a different, legitimate
    -- code path, not a lock to enforce here.
    if coalesce(v_locked, false) then
        raise exception
            '%: cannot be changed once the parent emission_data record has left DRAFT or been VERIFIED -- an importer relying on the shared record, or the producer''s own review, may already treat this declared context as authoritative. Supersede the parent record with a new version instead.',
            tg_table_name
            using errcode = '42501';
    end if;

    if tg_op = 'DELETE' then
        return old;
    end if;

    return new;
end;
$$;

comment on function app.enforce_dossier_lock() is
    '2026-09-06 (S4 remediation, widened S5 same day). Locks '
    'emission_data_declaration_context/emission_data_precursors '
    'against UPDATE/DELETE once the parent emission_data row has '
    'either left DRAFT or been VERIFIED -- matching verifyEmission'
    'DataEditable''s own app-layer condition exactly, as the database-'
    'layer second wall for the identical boundary. Also pins '
    'emission_data_id immutable on UPDATE for both tables.';
