-- ============================================================
-- Snowkap CBAM
-- S5 review round 10, finding S5R10-AUTHZ-B1 (live-reproduced): the
-- P11 expiry gate (20260829390000, finding #5) closed the ACCEPT path
-- for an expired grant only when sharing_grants_update_grantee_accept
-- is evaluated ALONE. It is never evaluated alone in general: Postgres
-- OR-combines every applicable PERMISSIVE policy's USING clauses (to
-- decide which rows an UPDATE can touch) and, SEPARATELY, OR-combines
-- every applicable policy's WITH CHECK clauses (to decide whether the
-- resulting row is acceptable) -- not as matched per-policy pairs.
--
-- This table carries a second UPDATE policy,
-- sharing_grants_update_grantor_revoke, whose own USING has never had
-- an expiry check (by design -- a grantor should be able to revoke a
-- grant regardless of whether it has since lapsed) and whose own WITH
-- CHECK only ever admits status = 'REVOKED'.
--
-- An actor who is simultaneously an ADMIN/OWNER of a grant's
-- grantor_org_id AND a member (any role) of that same grant's
-- grantee_org_id -- a realistic shape on this SME-focused product, e.g.
-- a compliance consultant or an SME principal who holds membership in
-- both their own org and a partner org -- could therefore:
--
--   1. Enter the row through grantor_revoke's USING (no expiry gate,
--      only requires status not in REVOKED/EXPIRED -- an expired-but-
--      still-INVITED row satisfies this).
--   2. Set status = 'ACTIVE', invited_email = null (the accept shape).
--   3. Have the resulting row validated by grantee_accept's WITH CHECK
--      (grantee-org membership, status = 'ACTIVE', invited_email null
--      -- no expiry check there either).
--
-- LIVE-REPRODUCED (real local Postgres, rolled-back transaction): a
-- direct grant (grantee_org_id set at insert, invited_email null),
-- expired 1 day, status still INVITED. A grantee-org-only actor's
-- accept UPDATE, entered alone against grantee_accept, correctly
-- affects 0 rows. The IDENTICAL UPDATE issued by a dual-org actor
-- (admin of grantor_org_id AND member of grantee_org_id) SUCCEEDS,
-- producing status = 'ACTIVE' on the already-expired grant -- through
-- the exact USING/WITH CHECK composition described above.
--
-- Every SECURITY DEFINER function that grants real cross-org data
-- visibility off sharing_grants (app.user_shared_installation_ids,
-- record_shared_data_consumption, sharing_counterparty_org_names,
-- accept_sharing_grant_invitation, installation_has_pending_sharing_
-- grant_invitation) independently re-checks expires_at, so this
-- specific bypass does not, by itself, currently unlock cross-org
-- emission-data visibility -- but it forces the row into a state
-- (ACTIVE with expires_at in the past) this schema's own design
-- documents as reachable only via grantee_accept, and that false
-- invariant is exactly the kind of assumption a future consumer could
-- inherit incorrectly. The RLS layer (Wall 2, ADR-0004) must not
-- depend on which OTHER policies happen to apply to the same table.
--
-- THE FIX: grantee_accept's own WITH CHECK gains the identical expiry
-- predicate its own USING already has. `expires_at` is never itself
-- changed by an accept (app.prevent_sharing_grant_fact_change refuses
-- any UPDATE that touches it), so the NEW row's expires_at is the same
-- frozen value WITH CHECK already sees via USING -- this is not a new
-- kind of check, it is closing the one clause that was missing it.
-- After this migration, NO combination of applicable policies can ever
-- produce a WITH CHECK pass for a transition to ACTIVE on an expired
-- grant: grantor_revoke's own WITH CHECK never admits ACTIVE at all,
-- and grantee_accept's now refuses it too. grantor_revoke's USING is
-- deliberately left untouched -- a grantor revoking an already-expired
-- grant is its own legitimate, unrelated use case, and the exploit
-- above depended on the WITH CHECK gap, not on that USING clause being
-- loose.
-- ============================================================

drop policy sharing_grants_update_grantee_accept on public.sharing_grants;

create policy sharing_grants_update_grantee_accept
    on public.sharing_grants
    for update
    to authenticated
    using (
        grantee_org_id in (select app.user_org_ids())
        and status = 'INVITED'
        and (expires_at is null or expires_at > now())
    )
    with check (
        grantee_org_id in (select app.user_org_ids())
        and status = 'ACTIVE'
        and invited_email is null
        and (expires_at is null or expires_at > now())
    );

comment on policy sharing_grants_update_grantee_accept on public.sharing_grants is
    '2026-09-07 (S5 review round 10, finding S5R10-AUTHZ-B1, live-reproduced): '
    'adds (expires_at is null or expires_at > now()) to WITH CHECK, matching '
    'the predicate USING already had since 20260829390000 (P11 finding #5). '
    'Without it, a dual-org actor (ADMIN/OWNER of grantor_org_id AND a member '
    'of grantee_org_id) could enter an expired INVITED row through the '
    'SIBLING sharing_grants_update_grantor_revoke policy''s own expiry-blind '
    'USING clause, and have the resulting ACTIVE row validated by THIS '
    'policy''s own (previously expiry-blind) WITH CHECK -- Postgres OR-'
    'combines every applicable policy''s USING clauses, and separately '
    'OR-combines every applicable policy''s WITH CHECK clauses, not as '
    'matched per-policy pairs, so a policy''s own invariant must hold in its '
    'OWN WITH CHECK to be enforced regardless of which other policy''s USING '
    'admitted the row. See this migration''s own header for the full live '
    'reproduction.';

-- ============================================================
-- END OF MIGRATION
-- ============================================================
