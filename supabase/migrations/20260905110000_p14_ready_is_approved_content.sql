-- ============================================================
-- Snowkap CBAM
-- P14 remediation (2026-09-04): READY means approved content, and
-- filing verifies that the population it files is the one approved.
--
-- ------------------------------------------------------------
-- THE FINDING, reproduced end to end before this was written
--
-- 20260904090000 stopped a READY shipment's lines being edited. It
-- guarded on `s.status = 'READY'` -- and left the status itself
-- writable by any member. So the guard was conditioned on the one value
-- the attacker controls.
--
-- Live, through the real REST API, as a plain MEMBER with their own
-- JWT, against a declaration an ADMIN had marked READY over 2 lines
-- (2000 t + 1000 t at 1.370 tCO2e/t = 4110 tCO2e):
--
--   MEMBER deletes a line while READY  -> 0 rows      (the 2026-09-04
--                                                      guard holds)
--   MEMBER sets shipment status DRAFT  -> succeeded   <- no admin gate
--   MEMBER deletes the line now        -> 1 row
--   MEMBER sets shipment status READY  -> succeeded
--   ADMIN  record_declaration_filed    -> OK, FILED_RECORDED
--
--   filed_snapshot: line_count = 1, embedded_emissions_tco2e = 2740
--
-- 4110 approved, 2740 filed. A 33% under-report, reached without a
-- single refusal, and signed off by an administrator who approved a
-- different figure. Reachable through the product's own UI as well:
-- transitionShipmentStatus gates only LOCK on admin, never REOPEN.
--
-- ------------------------------------------------------------
-- TWO INDEPENDENT FIXES, BECAUSE ONE IS A CONDITION AND THE OTHER IS A
-- FACT
--
-- 1. Only an ADMIN or OWNER may touch a READY shipment at all. Reopening
--    an approved population is an administrative act, and the product's
--    own lifecycle already calls it one (REOPEN is its own action).
--
-- 2. Filing re-derives the approved LINE population from state frozen
--    when the declaration was approved, and refuses if what is there now
--    differs. This holds even if a future change reopens the first door
--    again -- which is the whole point of writing it twice. Every other
--    draft-time fact this function re-verifies at filing exists for the
--    same reason: the window between "mark ready" and "record filed" is
--    writable.
--
-- The frozen set is computed BY THE DATABASE from the member shipments,
-- never supplied by a caller. A client-provided completeness report is
-- not authority for what was approved.
-- ============================================================

-- ------------------------------------------------------------
-- 1. A READY shipment is administrative territory.
-- ------------------------------------------------------------
drop policy if exists shipments_update_own_org_not_terminal
    on public.shipments;

create policy shipments_update_own_org_not_terminal
    on public.shipments
    for update
    using (
        org_id in (select app.user_org_ids())
        and status <> all (array['LOCKED', 'VOID'])
        -- The new clause. `status` here is the row as it stands, so
        -- this reads: to change a shipment that is currently READY you
        -- must be an administrator. Reopening, editing and voiding an
        -- approved population are all the same kind of act.
        and (
            status <> 'READY'
            or app.user_is_admin_or_owner_of(org_id)
        )
    )
    with check (
        org_id in (select app.user_org_ids())
        and (
            status <> 'LOCKED'
            or app.user_is_admin_or_owner_of(org_id)
        )
    );

comment on policy shipments_update_own_org_not_terminal on public.shipments is
    'A member may work on a DRAFT shipment. Once it is READY it is an approved filing population, and only an ADMIN or OWNER may change or reopen it. P14, 20260905110000.';

-- ------------------------------------------------------------
-- 2. The approved line population, frozen by the database.
-- ------------------------------------------------------------
alter table public.declarations
    add column if not exists approved_line_ids uuid[];

comment on column public.declarations.approved_line_ids is
    'The shipment_lines that existed when this declaration was approved (status left DRAFT), computed by the database from member_shipment_ids -- never supplied by a caller. record_declaration_filed refuses to file a population that no longer matches. P14, 20260905110000.';

create or replace function app.freeze_declaration_approved_lines()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    -- Only on the approval transition: entering a non-DRAFT status from
    -- DRAFT, or being created already approved.
    if new.status = 'DRAFT' then
        new.approved_line_ids := null;
        return new;
    end if;

    if tg_op = 'UPDATE'
       and old.status <> 'DRAFT'
       and old.approved_line_ids is not null
    then
        -- Already frozen. Left exactly as it was; the fact-change
        -- trigger refuses any edit to it.
        new.approved_line_ids := old.approved_line_ids;
        return new;
    end if;

    select coalesce(array_agg(l.id order by l.id), array[]::uuid[])
    into new.approved_line_ids
    from public.shipment_lines l
    where l.org_id = new.org_id
      and l.shipment_id = any(coalesce(new.member_shipment_ids, array[]::uuid[]));

    return new;
end;
$$;

comment on function app.freeze_declaration_approved_lines() is
    'Records what was actually approved, read from the database rather than from the caller. P14, 20260905110000.';

drop trigger if exists declarations_freeze_approved_lines_trg
    on public.declarations;

-- BEFORE the fact-change guard, so the frozen value is in place by the
-- time that trigger compares old and new.
create trigger declarations_freeze_approved_lines_trg
    before insert or update on public.declarations
    for each row
    execute function app.freeze_declaration_approved_lines();

-- ------------------------------------------------------------
-- Backfill, so the check below is meaningful for rows that already
-- exist rather than skipped for them.
--
-- For a FILED_RECORDED row this changes nothing that matters -- it is
-- already filed and its snapshot is immutable. For a READY row it
-- records the population as it stands at migration time, which is the
-- best available statement of what was approved, and is stated as such
-- rather than presented as history it cannot recover.
-- ------------------------------------------------------------
update public.declarations d
set approved_line_ids = (
        select coalesce(array_agg(l.id order by l.id), array[]::uuid[])
        from public.shipment_lines l
        where l.org_id = d.org_id
          and l.shipment_id = any(coalesce(d.member_shipment_ids, array[]::uuid[]))
    )
where d.status <> 'DRAFT'
  and d.approved_line_ids is null;

-- ------------------------------------------------------------
-- The frozen set is a filing fact: immutable once written.
-- ------------------------------------------------------------
create or replace function app.prevent_declaration_fact_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_is_filing_transition boolean :=
        old.status = 'READY'
        and new.status = 'FILED_RECORDED';
begin
    if new.id is distinct from old.id
        or new.org_id is distinct from old.org_id
        or new.reporting_period_kind is distinct from old.reporting_period_kind
        or new.reporting_period_year is distinct from old.reporting_period_year
        or new.reporting_period_quarter is distinct from old.reporting_period_quarter
        or new.supersedes_declaration_id is distinct from old.supersedes_declaration_id
        or new.created_by_user_id is distinct from old.created_by_user_id
        or new.created_at is distinct from old.created_at
    then
        raise exception
            'declarations: org_id, reporting period, supersedes_declaration_id, created_by_user_id and created_at are immutable -- a correction is a new amendment row (supersedes_declaration_id), never an edit';
    end if;

    if old.status <> 'DRAFT'
        and (
            new.member_shipment_ids is distinct from old.member_shipment_ids
            or new.completeness_report is distinct from old.completeness_report
        )
    then
        raise exception
            'declarations: member_shipment_ids and completeness_report are frozen once a declaration leaves DRAFT -- REOPEN to DRAFT first, or amend via a new row';
    end if;

    -- 2026-09-04 (P14). The approved line population is frozen for as
    -- long as the declaration stays approved. Without this, the record
    -- of what was approved could simply be rewritten to match whatever
    -- is there now -- which defeats the filing check one layer up by
    -- editing the very thing it compares against.
    --
    -- Deliberately NOT frozen across a reopen. Returning a declaration
    -- to DRAFT is how an administrator says "this is not approved any
    -- more", and the value is cleared then and recomputed by the
    -- database on the next approval. Freezing it across that transition
    -- would make reopening impossible, which is the workflow the
    -- refusal message tells people to use.
    if old.status <> 'DRAFT'
        and new.status <> 'DRAFT'
        and new.approved_line_ids is distinct from old.approved_line_ids
    then
        raise exception
            'declarations: approved_line_ids records the population this declaration was approved over and cannot be edited -- REOPEN to DRAFT and mark it ready again to approve a different one';
    end if;

    if not v_is_filing_transition
        and (
            new.filed_snapshot is distinct from old.filed_snapshot
            or new.filed_reference is distinct from old.filed_reference
            or new.filed_at is distinct from old.filed_at
        )
    then
        raise exception
            'declarations: filed_snapshot, filed_reference and filed_at may only be written by the READY -> FILED_RECORDED transition';
    end if;

    return new;
end;
$$;
