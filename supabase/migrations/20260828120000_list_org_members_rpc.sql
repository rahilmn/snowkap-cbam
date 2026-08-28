-- ============================================================
-- Snowkap CBAM
-- P3: list_org_members RPC (Team screen member listing)
--
-- Purpose:
--   The Team screen (docs/plans/MASTER_PLAN.md §27 screen 24) needs
--   each member's email alongside their role -- but auth.users is not
--   exposed via the Data API (supabase/config.toml's [api].schemas is
--   ["public", "graphql_public"] only), so a plain
--   .from("memberships").select("...") can never return it. A
--   SECURITY DEFINER RPC is the standard Supabase pattern for exposing
--   a narrow, safe slice of auth.users.
--
-- Scope of THIS migration:
--   - public.list_org_members(p_org_id): returns membership id, user
--     id, email, role, created_at for every member of p_org_id.
--     SECURITY DEFINER, but NOT a blanket bypass -- it explicitly
--     re-checks that the calling user is themselves a member of
--     p_org_id before returning anything (a security-definer function
--     bypasses RLS entirely, so it must enforce its own authorization
--     rather than trust the caller/RLS to have already done so).
-- ============================================================

create or replace function public.list_org_members(
    p_org_id uuid
)
returns table (
    membership_id uuid,
    user_id uuid,
    email text,
    role text,
    created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
    -- Table-qualified column references throughout: RETURNS TABLE
    -- implicitly declares user_id/role/etc. as PL/pgSQL OUT
    -- parameters in scope for the whole function body, which collide
    -- with the identically-named memberships columns -- confirmed live
    -- ("column reference 'user_id' is ambiguous", error 42702) in a
    -- first draft that referenced them unqualified.
    if not exists (
        select 1
        from public.memberships mem
        where mem.org_id = p_org_id
          and mem.user_id = auth.uid()
    ) then
        raise exception
            'Not a member of this organization.';
    end if;

    return query
        select
            m.id,
            m.user_id,
            u.email::text,
            m.role,
            m.created_at
        from public.memberships m
        join auth.users u on u.id = m.user_id
        where m.org_id = p_org_id
        order by m.created_at asc;
end;
$$;

comment on function public.list_org_members(uuid) is
    'Returns each member''s email alongside their role -- auth.users '
    'is not exposed via the Data API, so this SECURITY DEFINER RPC is '
    'the only way to get it. Explicitly re-checks the caller is '
    'themselves a member of p_org_id before returning anything, since '
    'SECURITY DEFINER bypasses RLS entirely and must not rely on the '
    'caller having already been authorized elsewhere.';

revoke all on function public.list_org_members(uuid) from public;
grant execute on function public.list_org_members(uuid) to authenticated;


-- ============================================================
-- END OF MIGRATION
-- ============================================================
