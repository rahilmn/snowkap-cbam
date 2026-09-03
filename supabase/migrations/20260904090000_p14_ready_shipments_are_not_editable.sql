-- ============================================================
-- Snowkap CBAM
-- P14 FILE-1 (2026-09-04), RELEASE BLOCKER: a declaration files a
-- different line population than the one an administrator approved.
--
-- REPRODUCED LIVE before this migration, in a rolled-back transaction,
-- using only the writes the product itself offers:
--
--   period 2501 contains ONE shipment with TWO calculated lines,
--     2640 + 1320 = 3960 tCO2e
--   an ADMIN drafts a declaration over it and marks it READY
--     -> completeness_report frozen, both lines approved
--   a plain MEMBER deletes line 2                 -> DELETE 1
--   the ADMIN records the filing                  -> OK
--   filed total                                   -> 2640
--
-- A 33% under-report, in an immutable filed artifact, produced by the
-- lowest-privileged role through the ordinary UI (`lines-table.tsx`
-- renders a "Remove line" button per line, with a confirmation dialog),
-- and signed off by an administrator who approved 3960.
--
-- ------------------------------------------------------------
-- WHY EVERY EXISTING CONTROL PASSED
--
-- Every one of them was true of the state at filing time, and the
-- problem is not the state at filing time:
--
--   * member_shipment_ids is unchanged, so 20260903220000's
--     period-completeness rule passes -- the SET of shipments is right.
--   * the surviving line has a current calculation whose frozen
--     determination and quantity match, so the INCOMPLETE clause passes.
--   * the shipment is READY, so SHIPMENTS_NOT_LOCKABLE passes.
--   * record_declaration_filed never reads completeness_report at all.
--
-- READY froze the member SET and not the member CONTENT, and filing
-- re-aggregates content without comparing it against what was approved.
--
-- ------------------------------------------------------------
-- WHY THIS IS FIXED HERE AND NOT IN THE FILING FUNCTION
--
-- Adding a "did the population change since READY?" comparison to
-- record_declaration_filed would close this reproduction and leave the
-- real problem in place: ordinary mutation of an approved shipment
-- would still be freely available, and the user would discover the
-- conflict only at filing, as a refusal they cannot act on without
-- understanding a rule the product never showed them.
--
-- Owner decision 1 states the lifecycle instead: READY means the line
-- population and content are what the declarant approved for filing.
-- A shipment in that state is not editable. The invariant
--
--     READY population == FILED population
--
-- then holds by construction rather than by a check, and it holds for
-- every consumer of that shipment, not only for the filing path.
--
-- The domain already has the escape hatch this needs:
-- src/domain/shipments/lifecycle.ts defines REOPEN (READY -> DRAFT),
-- an audited transition the UI already exposes. Editing an approved
-- shipment is therefore not forbidden -- it is made explicit. Reopen,
-- edit, re-approve.
--
-- ------------------------------------------------------------
-- THE CHANGE
--
-- All three write policies on shipment_lines currently admit any parent
-- status except LOCKED and VOID:
--
--     s.status <> all (array['LOCKED', 'VOID'])
--
-- which is to say DRAFT *and READY*. They become DRAFT-only.
--
-- This covers the determination writers too
-- (resolve-line-emissions.ts and determine-from-actual-data.ts both
-- UPDATE shipment_lines.emission_determination), which is intended:
-- re-determining an approved line changes the emissions basis the
-- administrator approved just as surely as deleting it does. Every line
-- of an approved shipment is necessarily already determined and
-- calculated, because buildCompletenessReport refuses READY otherwise --
-- so nothing legitimate needs to write a line while it is READY.
--
-- LOCKED and VOID remain excluded, as before. This narrows the
-- permitted set; it does not widen it anywhere.
-- ============================================================

drop policy if exists shipment_lines_insert_parent_not_terminal
    on public.shipment_lines;

create policy shipment_lines_insert_parent_draft_only
    on public.shipment_lines
    for insert
    to authenticated
    with check (
        org_id in (select app.user_org_ids())
        and exists (
            select 1
            from public.shipments s
            where s.id = shipment_lines.shipment_id
              and s.org_id = shipment_lines.org_id
              and s.status = 'DRAFT'
        )
    );

drop policy if exists shipment_lines_update_parent_not_terminal
    on public.shipment_lines;

create policy shipment_lines_update_parent_draft_only
    on public.shipment_lines
    for update
    to authenticated
    using (
        org_id in (select app.user_org_ids())
        and exists (
            select 1
            from public.shipments s
            where s.id = shipment_lines.shipment_id
              and s.org_id = shipment_lines.org_id
              and s.status = 'DRAFT'
        )
    )
    with check (
        org_id in (select app.user_org_ids())
        and exists (
            select 1
            from public.shipments s
            where s.id = shipment_lines.shipment_id
              and s.org_id = shipment_lines.org_id
              and s.status = 'DRAFT'
        )
    );

drop policy if exists shipment_lines_delete_parent_not_terminal
    on public.shipment_lines;

create policy shipment_lines_delete_parent_draft_only
    on public.shipment_lines
    for delete
    to authenticated
    using (
        org_id in (select app.user_org_ids())
        and exists (
            select 1
            from public.shipments s
            where s.id = shipment_lines.shipment_id
              and s.org_id = shipment_lines.org_id
              and s.status = 'DRAFT'
        )
    );

-- ------------------------------------------------------------
-- And a trigger, because RLS alone is not the whole boundary.
--
-- RLS constrains `authenticated`. It does not constrain service_role,
-- and this project has a trusted server path that legitimately holds
-- that role. The population an administrator approved is a
-- data-integrity fact rather than an authorization rule -- a trusted
-- path has no more business silently changing it than a member does --
-- so the rule is restated where every role sees it.
--
-- Deliberately narrow: it fires only for lines whose parent is READY.
-- LOCKED and VOID are left to the existing policies and to the
-- immutability rules that already cover them, so this trigger adds one
-- state and changes nothing else.
-- ------------------------------------------------------------
create or replace function app.enforce_shipment_lines_parent_editable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_shipment_id uuid :=
        coalesce(new.shipment_id, old.shipment_id);
    v_status text;
begin
    select s.status
    into v_status
    from public.shipments s
    where s.id = v_shipment_id;

    if v_status = 'READY' then
        raise exception
            'shipment_lines: this shipment has been marked READY, which records the line population an administrator approved for filing. Reopen it (READY -> DRAFT) before editing, then mark it ready again.'
            using errcode = '42501';
    end if;

    return coalesce(new, old);
end;
$$;

comment on function app.enforce_shipment_lines_parent_editable() is
    '2026-09-04 (P14 FILE-1, owner decision 1). A READY shipment records '
    'the line population and content an administrator approved for '
    'filing, so its lines are not editable -- reopening (READY -> DRAFT) '
    'is the audited way to change them. Live-reproduced before this '
    'existed: a plain MEMBER deleted one of two approved lines and the '
    'subsequent filing recorded 2640 tCO2e against a period containing '
    '3960, with every other filing-time check passing because all of '
    'them describe the state at filing rather than the state that was '
    'approved. Stated as a trigger as well as in RLS because it is a '
    'data-integrity fact rather than an authorization rule: it binds '
    'service_role too.';

drop trigger if exists shipment_lines_parent_editable_trg
    on public.shipment_lines;

create trigger shipment_lines_parent_editable_trg
    before insert or update or delete on public.shipment_lines
    for each row
    execute function app.enforce_shipment_lines_parent_editable();
