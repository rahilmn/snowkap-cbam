-- ============================================================
-- Snowkap CBAM
-- P3: organization onboarding RPC + organizations UPDATE policy
--
-- Purpose:
--   The first of the write-policy pieces deferred by
--   20260828070000_create_organizations_foundation.sql's header
--   comment ("INSERT/UPDATE/DELETE policies... deferred until [a
--   SECURITY DEFINER onboarding RPC] is built and live-tested").
--
-- Scope of THIS migration:
--   - public.create_organization_with_owner(): the only way an
--     authenticated user can create an organization. Atomic (single
--     transaction): inserts the org row, then inserts a membership row
--     making the CALLING user its OWNER. A bare INSERT policy on
--     organizations can't express "and also insert exactly one
--     membership row for me as OWNER" -- hence an RPC, not a policy.
--     Lives in `public`, not `app` (unlike app.user_org_ids() in the
--     base migration): PostgREST only exposes RPC-callable functions
--     from the schemas listed in supabase/config.toml's [api].schemas
--     (public, graphql_public) -- app.user_org_ids() is never called
--     by a client directly, only from within RLS policies (resolved by
--     Postgres itself, no PostgREST involved), so it correctly stays
--     unexposed in `app`; this function IS called by clients via
--     supabase.rpc(...), so it has to live somewhere PostgREST exposes.
--     (Found by writing the client-side test first and watching it
--     fail with PGRST202 "function not found in schema cache" against
--     the app-schema version -- fixed before this migration was ever
--     committed.)
--   - organizations UPDATE policy for ADMIN/OWNER members. Simple
--     enough (no cross-row invariant to enforce) to express directly
--     as RLS rather than needing an RPC.
--
-- Deliberately NOT in scope here:
--   - Membership role changes / removal. The last-OWNER-per-org
--     invariant (src/domain/organizations/invariants.ts) is
--     application-layer logic today, not re-implemented in SQL here --
--     duplicating it in PL/pgSQL risks the two definitions drifting.
--     A real RLS-level defense-in-depth guard for this (a CHECK
--     referencing sibling rows) is possible but intricate enough to
--     deserve its own dedicated, carefully-verified migration rather
--     than being folded in here.
--   - Membership invites (need to resolve an email to a user_id,
--     which is an application-layer/Auth-API concern, not pure SQL).
--   - Live RLS verification against the protected regulatory project
--     (never done -- see the base migration's own note). This one HAS
--     been live-verified against local Supabase (Docker), including
--     the two-org isolation suite
--     (tests/integration/organizations-isolation.test.ts) extended to
--     cover it.
-- ============================================================

create or replace function public.create_organization_with_owner(
    p_name text,
    p_slug text,
    p_capabilities text[]
)
returns public.organizations
language plpgsql
security definer
set search_path = public
as $$
declare
    v_org public.organizations;
begin
    if auth.uid() is null then
        raise exception
            'create_organization_with_owner requires an authenticated caller.';
    end if;

    insert into public.organizations (
        name,
        slug,
        capabilities
    )
    values (
        p_name,
        p_slug,
        p_capabilities
    )
    returning * into v_org;

    insert into public.memberships (
        org_id,
        user_id,
        role
    )
    values (
        v_org.id,
        auth.uid(),
        'OWNER'
    );

    return v_org;
end;
$$;

comment on function public.create_organization_with_owner(text, text, text[]) is
    'The only sanctioned way to create an organization: atomically '
    'inserts the org row and a matching OWNER membership row for the '
    'calling user in one transaction. SECURITY DEFINER because no bare '
    'INSERT policy can express "and also insert exactly one membership '
    'row for me" -- there is no membership yet to authorize a plain '
    'table-policy insert against (the same chicken-and-egg problem '
    'noted in the base migration).';

revoke all on function public.create_organization_with_owner(text, text, text[]) from public;
grant execute on function public.create_organization_with_owner(text, text, text[]) to authenticated;


create policy organizations_update_admin_or_owner
    on public.organizations
    for update
    to authenticated
    using (
        id in (
            select memberships.org_id
            from public.memberships
            where memberships.user_id = auth.uid()
              and memberships.role in ('OWNER', 'ADMIN')
        )
    )
    with check (
        id in (
            select memberships.org_id
            from public.memberships
            where memberships.user_id = auth.uid()
              and memberships.role in ('OWNER', 'ADMIN')
        )
    );

comment on policy organizations_update_admin_or_owner on public.organizations is
    'ADMIN/OWNER members may update their own organization''s row '
    '(name, declarant attributes, capabilities). No cross-row invariant '
    'to enforce here, unlike membership mutations, so a direct policy '
    'is sufficient -- no RPC needed.';


-- ============================================================
-- END OF MIGRATION
-- ============================================================
