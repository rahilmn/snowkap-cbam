-- ============================================================
-- Snowkap CBAM
-- P14 remediation (2026-09-04): re-approving a SHIPMENT is not
-- re-approving the DECLARATION.
--
-- ------------------------------------------------------------
-- THE FINDING, reproduced end to end before this was written
--
-- 20260905110000/120000 froze the approved LINE IDENTITIES into
-- declarations.approved_line_ids and made filing compare them. That
-- closes lines added and lines removed. It says nothing about what is
-- IN a line, and the filed figure is made of content, not identity.
--
-- Live, real REST API, real JWTs, against a declaration approved over
-- 2 lines totalling 1500 tCO2e:
--
--   1. ADMIN reopens the shipment (an ordinary correction)  -> DRAFT
--   2. MEMBER edits an approved line, 1000 -> 10            -> accepted
--   3. the edit nulls emission_determination, so a naive
--      recalculation is refused                             <- real control
--   3b. the line is re-determined
--   3c. and recalculated at the new quantity                -> recorded
--   4. ADMIN re-approves the SHIPMENT                       -> READY
--   5. ADMIN files; the DECLARATION was never re-approved   -> OK
--
--   filed_snapshot: line_count 2, embedded_emissions_tco2e 510
--
-- 1500 approved, 510 filed. Every gate passed, correctly by its own
-- terms: the identities matched, the calculation matched the line, the
-- determination matched, the engine was current, the period was exact.
--
-- The missing link is stated plainly: nothing connected a shipment
-- leaving READY to the declarations approved over it. `shipments`
-- carried only prevent_org_id_change, and transitionShipmentStatus
-- never consulted declarations. Re-approving the shipment was silently
-- treated as re-approving the declaration.
--
-- ------------------------------------------------------------
-- THE RULE (owner decision 4)
--
-- Reopening a shipment invalidates the approval of every READY
-- declaration that includes it. The declaration returns to DRAFT, its
-- frozen population is cleared, and only an explicit re-approval --
-- which recomputes that population from the database, over whatever the
-- lines now say -- can make it filable again.
--
-- This is stronger than comparing content at filing, and simpler: a
-- content comparison would need to enumerate every field that can move
-- a number. "The approval is stale" needs to enumerate nothing.
--
-- LOCKED is excluded deliberately. record_declaration_filed itself
-- transitions member shipments READY -> LOCKED as the last step of
-- filing; treating that as a reopen would have the act of filing
-- invalidate the declaration being filed.
--
-- ------------------------------------------------------------
-- AND THE STEP TO THE LEFT
--
-- The rule above covers content changed AFTER approval. Content changed
-- BEFORE approval, while a member shipment was still DRAFT, would leave
-- the same gap: approve the declaration over a DRAFT member, edit its
-- lines freely, then mark the shipment READY and file. The domain
-- already refuses to mark such a declaration ready
-- (src/domain/declarations/completeness.ts's SHIPMENT_NOT_LOCKABLE
-- blocker); the database did not. It does now, so the frozen population
-- is always taken over shipments that were themselves approved.
-- ============================================================

create or replace function app.invalidate_declaration_approval_on_reopen()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if old.status = 'READY'
       and new.status is distinct from 'READY'
       and new.status <> 'LOCKED'
    then
        update public.declarations d
        set status = 'DRAFT'
        where d.org_id = old.org_id
          and d.status = 'READY'
          and old.id = any(d.member_shipment_ids);
    end if;

    return new;
end;
$$;

comment on function app.invalidate_declaration_approval_on_reopen() is
    'Reopening a shipment retires the approval of every READY declaration that included it -- re-approving the shipment is not re-approving the declaration. P14, 20260905140000.';

drop trigger if exists shipments_invalidate_declaration_approval_trg
    on public.shipments;

create trigger shipments_invalidate_declaration_approval_trg
    after update on public.shipments
    for each row
    execute function app.invalidate_declaration_approval_on_reopen();

-- ------------------------------------------------------------
-- A declaration may only be approved over shipments that are themselves
-- approved.
-- ------------------------------------------------------------
create or replace function app.enforce_declaration_members_are_approved()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_unapproved text;
begin
    if new.status <> 'READY' then
        return new;
    end if;

    if tg_op = 'UPDATE' and old.status = 'READY' then
        return new;
    end if;

    select string_agg(s.reference, ', ' order by s.reference)
    into v_unapproved
    from public.shipments s
    where s.id = any(coalesce(new.member_shipment_ids, array[]::uuid[]))
      and s.org_id = new.org_id
      and s.status not in ('READY', 'LOCKED');

    if v_unapproved is not null then
        raise exception
            'declarations: cannot approve a declaration whose member shipments are not themselves approved (%). Mark them ready first -- otherwise the population frozen here is one nobody approved.',
            v_unapproved
            using errcode = '42501';
    end if;

    return new;
end;
$$;

comment on function app.enforce_declaration_members_are_approved() is
    'The frozen approved population must be taken over shipments that were themselves approved. P14, 20260905140000.';

drop trigger if exists declarations_members_are_approved_trg
    on public.declarations;

-- Runs after the freeze trigger (alphabetical: f < m), so it validates
-- the row the freeze has already shaped.
create trigger declarations_members_are_approved_trg
    before insert or update on public.declarations
    for each row
    execute function app.enforce_declaration_members_are_approved();
