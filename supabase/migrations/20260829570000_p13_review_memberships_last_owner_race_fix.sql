-- ============================================================
-- Snowkap CBAM
-- P13 release-blocker remediation (finding S10): the last-active-OWNER
-- invariant (src/domain/organizations/invariants.ts's isLastActiveOwner,
-- enforced by changeMemberRole/removeMember/deactivateMember in
-- manage-membership.ts) is a pure, in-memory check against a snapshot
-- fetched at the START of each request, followed by a separate write.
-- Each of those functions already CAS-guards its OWN target row against
-- a concurrent change to THAT row (.is("deactivated_at", null), etc.),
-- but nothing serializes two DIFFERENT rows: two active OWNERs of the
-- same org, each independently demoting/deactivating/removing the
-- OTHER (or one demoting the other while a second browser tab
-- concurrently demotes the first), can each independently fetch a
-- snapshot showing "2 active owners, so removing one still leaves 1" --
-- both single-row CAS guards then succeed on their own distinct rows,
-- and the organization is left with zero active owners: nobody can
-- manage it, edit its profile, invite a replacement, or ever recover it
-- through the product (no support/superadmin surface exists per the
-- master plan's own "No cross-org superadmin surface in-product"
-- rule -- only an audited runbook, which does not yet cover this).
--
-- This is a classic check-then-act race across two rows, which no
-- amount of single-row CAS guarding can close -- it needs either
-- SERIALIZABLE isolation for every membership write (a much bigger,
-- riskier change touching every caller) or a DB-level aggregate
-- invariant that locks the relevant rows before counting. This
-- migration adds the latter: a BEFORE UPDATE OR DELETE trigger on
-- memberships that, whenever a row that WAS an active OWNER is about to
-- stop being one (role changed away from OWNER, deactivated, or
-- deleted), locks every OTHER active-OWNER row in the same org via
-- `SELECT ... FOR UPDATE` before counting them. `FOR UPDATE` is the
-- mechanism that actually closes the race: if a concurrent transaction
-- is simultaneously changing one of those other rows, this SELECT
-- blocks until that transaction commits or rolls back, so the count
-- this trigger sees is never stale -- exactly one of the two racing
-- transactions will see the other's change already committed and
-- correctly refuse to remove the last owner.
--
-- No application-layer change is needed: changeMemberRole/removeMember/
-- deactivateMember (manage-membership.ts) already treat any unexpected
-- write error as PERSIST_FAILED, which is exactly the right outcome for
-- the (should be exceedingly rare in practice, since the app-layer
-- check already prevents the single-request case) transaction that
-- loses this race.
-- ============================================================

create or replace function app.enforce_last_active_owner_per_org()
returns trigger
language plpgsql
as $$
declare
    v_remaining_active_owners integer;
begin
    -- Service-role (no end-user session) callers are exempt -- no
    -- application code path ever deletes an organization or its
    -- memberships outright (grep-confirmed: only test/ops cleanup,
    -- always via the service-role client, does this), and a whole-org
    -- cascade delete necessarily removes every OWNER at once, which
    -- this check would otherwise (correctly, for a REAL end-user
    -- action, but wrongly here) refuse. Real end-user role changes/
    -- deactivations/removals always carry a JWT and remain fully
    -- guarded below.
    if auth.uid() is null then
        return coalesce(new, old);
    end if;

    -- Not relevant unless OLD was an active OWNER in the first place.
    if old.role <> 'OWNER' or old.deactivated_at is not null then
        return coalesce(new, old);
    end if;

    -- UPDATE that leaves the row an active OWNER (e.g. only user_id-
    -- irrelevant columns changed, or a no-op) is not relevant either.
    if TG_OP = 'UPDATE' and new.role = 'OWNER' and new.deactivated_at is null then
        return new;
    end if;

    -- Lock every OTHER active-OWNER row in this org BEFORE counting --
    -- see this migration's own header comment for why FOR UPDATE (not a
    -- plain SELECT) is what actually closes the cross-row race. Two
    -- separate statements are required: Postgres rejects FOR UPDATE
    -- combined with an aggregate function in the same query ("FOR
    -- UPDATE is not allowed with aggregate functions"), so the lock
    -- (via PERFORM, which discards its result set but still acquires
    -- row locks) and the count are split -- the count that follows
    -- reads back the now-locked rows, which cannot change under it for
    -- the rest of this transaction.
    perform 1
    from public.memberships
    where org_id = old.org_id
      and role = 'OWNER'
      and deactivated_at is null
      and id <> old.id
    for update;

    select count(*)
    into v_remaining_active_owners
    from public.memberships
    where org_id = old.org_id
      and role = 'OWNER'
      and deactivated_at is null
      and id <> old.id;

    if v_remaining_active_owners = 0 then
        raise exception
            'memberships: organization % would be left with no active OWNER', old.org_id;
    end if;

    return coalesce(new, old);
end;
$$;

comment on function app.enforce_last_active_owner_per_org() is
    '2026-08-30 (P13 review, finding S10): DB-level backstop for the '
    'last-active-OWNER invariant src/domain/organizations/invariants.ts '
    'already enforces in application code -- this closes the cross-row '
    'race two single-request CAS-guarded writes cannot close on their '
    'own (see this migration''s header comment). Expected to fire only '
    'when a genuine race is lost; the application-layer check already '
    'prevents the ordinary single-request case from ever reaching this '
    'far. Exempts service-role (no auth.uid()) callers entirely -- no '
    'application code path deletes an organization/its memberships '
    'outright, only test/ops cleanup does, and a whole-org cascade '
    'delete necessarily removes every OWNER at once.';

create trigger memberships_enforce_last_active_owner_trg
    before update or delete on public.memberships
    for each row
    execute function app.enforce_last_active_owner_per_org();
