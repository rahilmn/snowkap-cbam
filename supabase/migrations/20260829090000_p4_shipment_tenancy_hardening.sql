-- ============================================================
-- Snowkap CBAM
-- P4: tenancy hardening for shipments/shipment_lines/suppliers
--
-- Purpose:
--   Found via an independent adversarial design review commissioned
--   for the P4 schema (20260828150000_p4_shipment_intake_schema.sql),
--   then confirmed live against that applied migration before being
--   trusted (this session's own established discipline -- a design
--   review's claims get re-verified against the real, applied schema,
--   never taken on faith).
--
--   20260828150000's UPDATE policies on shipments/shipment_lines/
--   suppliers all pin org_id in their WITH CHECK to "one of the
--   caller's own orgs" -- but never to "the SAME org_id the row
--   already had". A user who is a member of two or more orgs (an
--   ordinary case: memberships is many-to-many with no cap) can
--   UPDATE ... SET org_id = '<other org I belong to>' on a row they
--   can currently see, silently relocating a shipment/line/supplier
--   into a different tenant. Postgres RLS's WITH CHECK only ever sees
--   the proposed NEW row -- it has no way to express "must equal what
--   this column was before this UPDATE" without a trigger, so this is
--   fixed with a BEFORE UPDATE trigger, not a policy rewrite.
--
--   Not classified as a "material security-boundary change" requiring
--   ADR-0013 escalation: this restores the tenant isolation the
--   existing RLS policies already intended (no capability anyone
--   currently has is being removed -- reassigning a row's org_id was
--   never an intended capability of the UPDATE policies in the first
--   place), the same category CLAUDE.md cites the R7 adapter fix as
--   the worked example of an in-scope protected-zone-adjacent defect
--   fix for.
--
--   Also pins shipment_lines.shipment_id: nothing in the product
--   needs "move a line to a different shipment via UPDATE", and
--   allowing it would let a line silently escape
--   hasDenseUniqueLineNumbers' renumbering discipline (the parent-
--   status EXISTS check on shipment_lines' policies would actively
--   validate such a reassignment as legitimate, rather than merely
--   failing to block it, if the new parent is also DRAFT/READY).
--
--   Also adds shipment_lines_cn_code_level_consistency_ck -- a second,
--   independent defect found while reviewing this schema: cn_code's
--   format CHECK and cn_code_level's enum CHECK were unlinked, so
--   nothing stopped inserting an 8-digit cn_code with
--   cn_code_level = 'TARIC10' or vice versa. Confirmed zero existing
--   shipment_lines rows would violate this before applying it (this
--   table has no production data yet).
-- ============================================================


-- ============================================================
-- 1. org_id / shipment_id IMMUTABILITY TRIGGERS
-- ============================================================

create or replace function app.prevent_org_id_change()
returns trigger
language plpgsql
as $$
begin
    if new.org_id is distinct from old.org_id then
        raise exception '%.org_id is immutable', tg_table_name;
    end if;

    return new;
end;
$$;

comment on function app.prevent_org_id_change() is
    'BEFORE UPDATE guard: rejects any UPDATE that changes org_id, on '
    'any table this trigger is attached to. Not SECURITY DEFINER -- '
    'triggers run with the privileges of the role performing the '
    'UPDATE regardless, and this function does not need to read '
    'anything RLS would otherwise block.';

create trigger shipments_prevent_org_id_change_trg
    before update on public.shipments
    for each row
    execute function app.prevent_org_id_change();

create trigger shipment_lines_prevent_org_id_change_trg
    before update on public.shipment_lines
    for each row
    execute function app.prevent_org_id_change();

create trigger suppliers_prevent_org_id_change_trg
    before update on public.suppliers
    for each row
    execute function app.prevent_org_id_change();


create or replace function app.prevent_shipment_line_reparent()
returns trigger
language plpgsql
as $$
begin
    if new.shipment_id is distinct from old.shipment_id then
        raise exception 'shipment_lines.shipment_id is immutable';
    end if;

    return new;
end;
$$;

create trigger shipment_lines_prevent_reparent_trg
    before update on public.shipment_lines
    for each row
    execute function app.prevent_shipment_line_reparent();


-- ============================================================
-- 2. cn_code / cn_code_level CONSISTENCY
-- ============================================================

alter table public.shipment_lines
    add constraint shipment_lines_cn_code_level_consistency_ck
    check (
        (cn_code_level = 'CN8' and cn_code ~ '^\d{8}$')
        or
        (cn_code_level = 'TARIC10' and cn_code ~ '^\d{10}$')
    );


-- ============================================================
-- 3. LOCK: ADMIN/OWNER-only, matching §14's roles matrix
--
-- The applied 20260828150000 migration's shipments UPDATE policy has
-- no role gate at all -- any member can currently lock any shipment
-- in their org. docs/plans/MASTER_PLAN.md §14 already specifies LOCK
-- as an ADMIN/OWNER action ("ADMIN -- ... shipment LOCK/declare");
-- this closes the gap between that already-approved design and the
-- as-built policy, tightening (never loosening) what a plain MEMBER
-- can do, and does not touch any capability actually exercised by any
-- user yet (no UI wires LOCK until this same phase's screens ship).
-- Reuses the existing app.user_is_admin_or_owner_of() helper
-- (20260828110000) -- no new helper needed. org_id is now pinned by
-- the trigger above, closing the "launder a lock past this role
-- check by reassigning org_id first" variant a plain role-gate alone
-- would still be vulnerable to.
-- ============================================================

drop policy shipments_update_own_org_not_terminal on public.shipments;

create policy shipments_update_own_org_not_terminal
    on public.shipments
    for update
    to authenticated
    using (
        org_id in (select app.user_org_ids())
        and status not in ('LOCKED', 'VOID')
    )
    with check (
        org_id in (select app.user_org_ids())
        and (
            status <> 'LOCKED'
            or app.user_is_admin_or_owner_of(org_id)
        )
    );


-- ============================================================
-- END OF MIGRATION
-- ============================================================
