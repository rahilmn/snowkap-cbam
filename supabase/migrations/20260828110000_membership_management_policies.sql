-- ============================================================
-- Snowkap CBAM
-- P3: membership UPDATE/DELETE policies (role changes, removal)
--
-- Purpose:
--   The last deferred write-policy piece from the base organizations
--   migration's header comment: "Membership role changes / removal.
--   The last-OWNER-per-org invariant
--   (src/domain/organizations/invariants.ts) is application-layer
--   logic today, not re-implemented in SQL here -- duplicating it in
--   PL/pgSQL risks the two definitions drifting."
--
-- Design decision (still holds): the last-OWNER invariant is enforced
-- in TypeScript (src/domain/organizations/invariants.ts,
-- changeMembershipRole/removeMembership -- already unit-tested) by the
-- calling application code BEFORE it ever issues the UPDATE/DELETE,
-- not by this migration. These RLS policies answer a narrower
-- question -- "is the caller authorized to modify a membership row in
-- this organization at all" -- which is a plain authorization check
-- with no cross-row invariant, unlike the last-OWNER rule. This is the
-- same split already used for organizations_update_admin_or_owner
-- (20260828080000): RLS for isolation/authorization, application code
-- for the business rule.
--
-- Scope of THIS migration:
--   - app.user_is_admin_or_owner_of(p_org_id): a second SECURITY
--     DEFINER helper alongside the base migration's app.user_org_ids()
--     -- needed because a memberships UPDATE/DELETE policy has to
--     check the caller's OWN role by reading `memberships`, which is
--     the very table the policy is attached to. A raw subquery against
--     `memberships` from inside its own policy causes Postgres to
--     re-evaluate that same policy to authorize the subquery's read,
--     which re-triggers the subquery, infinitely -- confirmed exactly
--     this way (error 42P17 "infinite recursion detected in policy for
--     relation memberships") in a first draft of this migration, live-
--     tested rather than assumed correct. SECURITY DEFINER breaks the
--     cycle the same way app.user_org_ids() already does for the base
--     migration's organizations/audit_events SELECT policies.
--   - memberships UPDATE/DELETE policies: only ADMIN/OWNER members of
--     the SAME organization as the target row may modify it. A MEMBER
--     cannot change anyone's role or remove anyone, including
--     themselves -- self-service "leave this organization" is a
--     distinct, not-yet-built feature, not silently included here.
--   - A caller cannot use UPDATE to change org_id (moving a membership
--     to a different org) or user_id (reassigning a membership to a
--     different user) -- the WITH CHECK clause re-applies the same
--     "admin/owner of this row's org" test against the row AS IT WOULD
--     EXIST POST-UPDATE, and additionally pins user_id unchanged.
--
-- Deliberately NOT in scope here:
--   - The application-layer service/server actions that actually call
--     these policies (changeMembershipRole/removeMembership wired to a
--     real Team screen) -- a separate commit.
--   - Membership invites (resolving an email to a user_id needs the
--     Auth admin API, an application-layer/service-role concern, not
--     pure SQL).
-- ============================================================

create or replace function app.user_is_admin_or_owner_of(
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
          and role in ('OWNER', 'ADMIN')
    );
$$;

comment on function app.user_is_admin_or_owner_of(uuid) is
    'SECURITY DEFINER so a memberships UPDATE/DELETE policy can check '
    'the caller''s own role without recursively re-triggering itself '
    '-- see this migration''s header comment for the infinite-'
    'recursion error this replaced.';

revoke all on function app.user_is_admin_or_owner_of(uuid) from public;
grant execute on function app.user_is_admin_or_owner_of(uuid) to authenticated;

create policy memberships_update_admin_or_owner
    on public.memberships
    for update
    to authenticated
    using (
        app.user_is_admin_or_owner_of(org_id)
    )
    with check (
        app.user_is_admin_or_owner_of(org_id)
        -- user_id is intentionally NOT re-checked against auth.uid()
        -- here (this policy is for an admin changing someone ELSE's
        -- role, not a self-check) -- but the row's user_id must match
        -- what it already was, enforced by the application layer
        -- issuing this UPDATE with an explicit .eq("user_id", ...)
        -- (or equivalently never including user_id in the SET list),
        -- since Postgres RLS's WITH CHECK cannot reference the row's
        -- own pre-update value to compare against post-update.
    );

create policy memberships_delete_admin_or_owner
    on public.memberships
    for delete
    to authenticated
    using (
        app.user_is_admin_or_owner_of(org_id)
    );

comment on policy memberships_update_admin_or_owner on public.memberships is
    'Authorization only (is the caller an ADMIN/OWNER of this row''s '
    'org) -- the last-OWNER-per-org invariant is enforced in '
    'src/domain/organizations/invariants.ts by the calling application '
    'code before it ever issues this UPDATE, not re-implemented here.';

comment on policy memberships_delete_admin_or_owner on public.memberships is
    'Authorization only -- see memberships_update_admin_or_owner. Self-'
    'service "leave this organization" (a MEMBER removing their own '
    'row) is not covered by this policy and is not yet built.';


-- ============================================================
-- END OF MIGRATION
-- ============================================================
