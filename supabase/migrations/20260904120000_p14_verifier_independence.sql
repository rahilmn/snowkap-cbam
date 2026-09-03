-- ============================================================
-- Snowkap CBAM
-- P14 (2026-09-04), owner decision 6: a user must not verify their own
-- emission record.
--
-- Verification is the entire basis on which an actual emissions figure
-- may replace a published regulatory default, and on which a grantee
-- importer treats a producer's number as operator-attested. Production
-- data already contains a record entered and verified by the same
-- OWNER, which is how this surfaced.
--
-- ------------------------------------------------------------
-- THE MISSING FACT
--
-- The rule needs to know who created the record, and emission_data did
-- not record it. It has entered_by_org_id -- the organisation -- and
-- verifier_user_id, but no creator. So this migration adds
-- created_by_user_id, and adds it the same way verifier_user_id is
-- already handled: written by the database from auth.uid(), never
-- accepted from the caller. A creator a client can name is a creator a
-- client can name as somebody else, and the whole rule turns on that
-- value being true.
--
-- Backfill is deliberately null. There is no honest way to recover the
-- creator of a record written before the column existed -- audit_events
-- carries emission_data.recorded, but a rule that decides whether a
-- verification is permitted must not depend on a table whose writes are
-- best-effort. Legacy rows therefore cannot be checked, and the gate
-- below says so explicitly rather than guessing. Every record created
-- from now on carries the fact.
--
-- ------------------------------------------------------------
-- SCOPE
--
-- The comparison is creator vs verifier, both as user ids. It is not a
-- claim about organisational independence: an ADMIN verifying a
-- colleague's record in the same organisation is exactly the workflow
-- the product is built around, and stays permitted. What is refused is
-- one person being both author and attestor of the same figure.
-- ============================================================

alter table public.emission_data
    add column if not exists created_by_user_id uuid
        references auth.users(id)
        on delete set null;

comment on column public.emission_data.created_by_user_id is
    '2026-09-04 (P14 owner decision 6). Who created this record, written '
    'by app.enforce_emission_data_insert_gate() from auth.uid() and '
    'never accepted from the caller -- the same posture as '
    'verifier_user_id, and for the same reason: the verifier-'
    'independence rule turns on this value being true. Null for records '
    'created before the column existed; the verification gate treats '
    'null as "cannot be checked" rather than as "independent", and says '
    'so.';

-- ------------------------------------------------------------
-- Write it from auth.uid() on INSERT, alongside the existing
-- lifecycle-state checks. Same function, because it is the same idea:
-- what a record is at creation is decided by the database, not claimed
-- by the caller.
-- ------------------------------------------------------------
create or replace function app.enforce_emission_data_insert_gate()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
    if current_user not in ('anon', 'authenticated') then
        -- Trusted paths are unconstrained, but still get attribution
        -- when a caller identity is available -- a service-role write
        -- performed on behalf of a signed-in user should not lose who
        -- that was.
        if new.created_by_user_id is null then
            new.created_by_user_id := auth.uid();
        end if;

        return new;
    end if;

    if new.status is distinct from 'DRAFT' then
        raise exception
            'emission_data: a new record is always created as DRAFT. Activation is a lifecycle transition (ACTIVATE), which requires the record to be VERIFIED and to carry real evidence -- it cannot be asserted at creation.'
            using errcode = '42501';
    end if;

    if new.verification_status is distinct from 'UNVERIFIED' then
        raise exception
            'emission_data: a new record is always created UNVERIFIED. Verification is a lifecycle transition (SUBMIT_FOR_VERIFICATION then VERIFY), and VERIFY requires an ADMIN or OWNER of the owning organization -- it cannot be asserted at creation.'
            using errcode = '42501';
    end if;

    if new.verifier_user_id is not null then
        raise exception
            'emission_data: verifier_user_id cannot be set at creation. It is written from auth.uid() by the verification gate, in the same statement that transitions verification_status to VERIFIED.'
            using errcode = '42501';
    end if;

    if new.rejection_reason is not null then
        raise exception
            'emission_data: rejection_reason cannot be set at creation. It is only ever written alongside a transition of verification_status to REJECTED.'
            using errcode = '42501';
    end if;

    if coalesce(array_length(new.evidence_file_ids, 1), 0) <> 0 then
        raise exception
            'emission_data: evidence cannot be attached at creation. Upload the file first (it references this record), then attach it -- that path checks every id against a real evidence_files row.'
            using errcode = '42501';
    end if;

    -- 2026-09-04 (P14 owner decision 6). Overwritten, not validated: a
    -- caller-supplied creator is a claim, and this is the value the
    -- verifier-independence rule compares against.
    new.created_by_user_id := auth.uid();

    return new;
end;
$$;

-- ------------------------------------------------------------
-- The rule itself, in the verification gate, so it binds every role
-- rather than only the API roles. Whether the author of a figure may
-- also attest it is a property of the record, not of who is asking.
-- ------------------------------------------------------------
create or replace function app.enforce_emission_data_verifier_independence()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
    if new.verification_status is distinct from old.verification_status
        and new.verification_status = 'VERIFIED'
        and old.created_by_user_id is not null
        and coalesce(new.verifier_user_id, auth.uid()) = old.created_by_user_id
    then
        raise exception
            'emission_data: the person who created a record cannot also verify it. Verification is what lets an actual emissions figure replace a published default and what a counterparty relies on -- it needs a second person. Ask another ADMIN or OWNER of this organization to verify it.'
            using errcode = '42501';
    end if;

    return new;
end;
$$;

comment on function app.enforce_emission_data_verifier_independence() is
    '2026-09-04 (P14 owner decision 6). Refuses a VERIFY performed by '
    'the user who created the record. Not an organisational rule -- an '
    'ADMIN verifying a colleague''s record is the ordinary workflow and '
    'stays permitted; what is refused is one person being both author '
    'and attestor. Records created before created_by_user_id existed '
    'carry null and cannot be checked: the gate lets those through '
    'rather than guessing, which is a stated limitation and not an '
    'oversight.';

-- Runs BEFORE the verification gate alphabetically
-- (emission_data_verifier_independence_trg vs
-- emission_data_verification_gate_trg -- "verifier" sorts after
-- "verification", so the ADMIN+ check still fires first, which is the
-- order that gives the more specific message).
drop trigger if exists emission_data_verifier_independence_trg
    on public.emission_data;

create trigger emission_data_verifier_independence_trg
    before update on public.emission_data
    for each row
    execute function app.enforce_emission_data_verifier_independence();
