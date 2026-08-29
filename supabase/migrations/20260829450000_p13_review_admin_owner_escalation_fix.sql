-- ============================================================
-- Snowkap CBAM
-- P13 audit finding, live-reproduced against real Postgres: an ADMIN
-- could seize OWNER of the organization
--
-- Purpose:
--   memberships_update_admin_or_owner (20260828110000, unchanged since)
--   gates an UPDATE on public.memberships with USING/WITH CHECK both
--   equal to `app.user_is_admin_or_owner_of(org_id)` -- neither clause
--   inspects the ROLE column at all. Combined with
--   changeMembershipRole's own domain invariant (src/domain/organizations/invariants.ts)
--   only ever refusing a change that would leave an org with ZERO
--   active owners -- never one that GRANTS ownership -- an ADMIN could:
--   (1) promote a confederate MEMBER (or themselves) to OWNER via the
--   sanctioned /team UI, which the domain invariant does not block
--   (granting ownership never reduces the owner count), then (2) demote
--   the org's real OWNER to MEMBER, now legal because a second OWNER
--   exists. The founding OWNER is then permanently locked out of
--   org-settings' danger zone (gated on role = 'OWNER'). Live-reproduced
--   directly against this policy: `set local role authenticated` +
--   an ADMIN's JWT claims, `update memberships set role='OWNER' where
--   id=<own row>` succeeded, followed by demoting the real OWNER --
--   also succeeded, since two OWNER rows now existed.
--
--   The application layer is fixed in the same review (manage-membership.ts's
--   changeMemberRole now threads the caller's real OrgContext.role
--   through to the domain invariant, which rejects granting OWNER
--   unless the caller already holds it -- ONLY_OWNER_CAN_GRANT_OWNERSHIP).
--   This migration is Wall 2 (RLS), matching this codebase's own
--   "two walls, always both" posture (master plan §10) -- Wall 1 alone
--   would leave a bare client UPDATE (any raw supabase.from() call,
--   bypassing manage-membership.ts entirely) able to grant OWNER exactly
--   as before.
-- ============================================================


-- ============================================================
-- 1. app.user_is_owner_of() -- same shape as
--    app.user_is_admin_or_owner_of() (20260829360000), OWNER only
-- ============================================================

create or replace function app.user_is_owner_of(
    p_org_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.memberships
        where org_id = p_org_id
          and user_id = auth.uid()
          and role = 'OWNER'
          and deactivated_at is null
    );
$$;

comment on function app.user_is_owner_of(uuid) is
    '2026-08-29 (P13 review): true only for an ACTIVE OWNER of '
    'p_org_id -- unlike app.user_is_admin_or_owner_of(), an ADMIN does '
    'not satisfy this. Used by memberships_update_admin_or_owner''s '
    'WITH CHECK to require the caller already be an OWNER before a '
    'write can grant OWNER to anyone (including themselves).';

revoke all on function app.user_is_owner_of(uuid) from public;
grant execute on function app.user_is_owner_of(uuid) to authenticated;


-- ============================================================
-- 2. memberships_update_admin_or_owner -- WITH CHECK now also
--    requires the caller be an OWNER whenever the resulting row's
--    role is OWNER (redefined via drop+create, this codebase's
--    established precedent for tightening an already-applied policy)
-- ============================================================

drop policy memberships_update_admin_or_owner on public.memberships;

create policy memberships_update_admin_or_owner
    on public.memberships
    for update
    to authenticated
    using (
        app.user_is_admin_or_owner_of(org_id)
    )
    with check (
        app.user_is_admin_or_owner_of(org_id)
        and (
            role <> 'OWNER'
            or app.user_is_owner_of(org_id)
        )
    );

comment on policy memberships_update_admin_or_owner on public.memberships is
    '2026-08-29 (P13 review): USING unchanged from 20260828110000 -- '
    'an ADMIN or OWNER may still attempt any update. WITH CHECK adds '
    '"role <> ''OWNER'' or app.user_is_owner_of(org_id)": the resulting '
    'row may only carry role = ''OWNER'' if the CALLER already holds '
    'OWNER themselves. Closes a live-reproduced privilege escalation: '
    'an ADMIN could otherwise grant OWNER to a confederate (or '
    'themselves) via a bare client UPDATE, then demote the org''s real '
    'OWNER once a second one existed. This is Wall 2 -- the application '
    'layer (manage-membership.ts''s changeMemberRole, via the domain '
    'invariant''s new ONLY_OWNER_CAN_GRANT_OWNERSHIP rejection) carries '
    'the identical rule as Wall 1.';


-- ============================================================
-- END OF MIGRATION
-- ============================================================
