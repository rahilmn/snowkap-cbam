-- ============================================================
-- Snowkap CBAM
-- P14 (2026-09-03): accepting a data-sharing invitation binds a
-- producer's verified emissions data to whichever organization the
-- accepting user happens to be acting as, with no check that the
-- organization is even an importer.
--
-- THE GAP. public.accept_sharing_grant_invitation(p_grant_id, p_org_id)
-- checks: a session exists, the caller's confirmed email matches
-- invited_email, the grant is INVITED and unexpired, p_org_id is not the
-- grantor, and the caller is an active member of p_org_id. It never
-- checks that p_org_id holds IMPORTER_DECLARANT.
--
-- p_org_id comes from the application as context.org_id -- the ACTIVE
-- organization, which is derived from an httpOnly cookie. So a user who
-- belongs to more than one non-grantor organization binds the grant to
-- whichever one the cookie names at the moment they click Accept. A
-- consultant acting for two importers, or anyone holding both an
-- importer and a producer org, can bind a producer's data to the wrong
-- one without any step in the flow surfacing the choice.
--
-- WHY THAT MATTERS MORE THAN A MISCLICK. The binding is IMMUTABLE:
-- app.prevent_sharing_grant_fact_change permits grantee_org_id to change
-- exactly once, from NULL, so the producer cannot move it -- they must
-- revoke and re-invite. And once bound, emission_data_select_own_org
-- admits EVERY member of that organization to the producer's ACTIVE,
-- VERIFIED emission data. The producer's only signal is a name appearing
-- on their shared-data status screen.
--
-- The capability check is the right wall because capabilities are
-- append-only (organization-profile.ts), so an org that holds
-- IMPORTER_DECLARANT today cannot lose it and strand an existing grant.
--
-- This is one half of the fix. The other half is in the application:
-- acceptSharingGrantInvitation rejects the same case before the RPC is
-- reached, and /accept-invitation asks the user WHICH organization to
-- accept into when they belong to more than one, rather than silently
-- reading the cookie. Server-side enforcement is here, because a UI
-- choice is not an authorization boundary.
-- ============================================================

create or replace function public.accept_sharing_grant_invitation(
    p_grant_id uuid,
    p_org_id uuid
)
returns table(
    result_status text,
    result_org_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_grant public.sharing_grants%rowtype;
    v_user_email text;
begin
    if auth.uid() is null then
        raise exception
            'accept_sharing_grant_invitation requires an authenticated caller'
            using errcode = '42501';
    end if;

    select u.email
    into v_user_email
    from auth.users u
    where u.id = auth.uid()
      and u.email_confirmed_at is not null;

    select sg.*
    into v_grant
    from public.sharing_grants sg
    where sg.id = p_grant_id;

    if v_grant.id is null then
        return query select 'NOT_FOUND'::text, null::uuid;
        return;
    end if;

    if v_grant.invited_email is null
        or lower(v_grant.invited_email) <> lower(coalesce(v_user_email, ''))
    then
        return query select 'EMAIL_MISMATCH'::text, null::uuid;
        return;
    end if;

    if v_grant.status = 'ACTIVE' then
        return query select 'ALREADY_ACTIVE'::text, v_grant.grantee_org_id;
        return;
    end if;

    if v_grant.status <> 'INVITED' then
        return query select 'NOT_PENDING'::text, v_grant.grantee_org_id;
        return;
    end if;

    if v_grant.expires_at is not null and v_grant.expires_at < now() then
        update public.sharing_grants sg
        set status = 'EXPIRED'
        where sg.id = v_grant.id
          and sg.status = 'INVITED';

        return query select 'EXPIRED'::text, null::uuid;
        return;
    end if;

    if p_org_id = v_grant.grantor_org_id then
        return query select 'SELF_GRANT_NOT_ALLOWED'::text, null::uuid;
        return;
    end if;

    -- Routed through app.user_org_ids() rather than a raw memberships
    -- exists() so a DEACTIVATED member cannot bind their former org --
    -- see 20260829390000 item (3), which found that live.
    if not exists (
        select 1
        from app.user_org_ids() as caller_org_id
        where caller_org_id = p_org_id
    ) then
        return query select 'NOT_A_MEMBER'::text, null::uuid;
        return;
    end if;

    -- 2026-09-03 (P14): the new check. Membership alone was never enough
    -- -- it establishes that the caller may act for this organization,
    -- not that this organization is one a producer's data may be bound
    -- to. See this migration's header.
    if not exists (
        select 1
        from public.organizations o
        where o.id = p_org_id
          and 'IMPORTER_DECLARANT' = any(o.capabilities)
    ) then
        return query select 'CAPABILITY_NOT_HELD'::text, null::uuid;
        return;
    end if;

    begin
        update public.sharing_grants sg
        set status = 'ACTIVE',
            grantee_org_id = p_org_id
        where sg.id = v_grant.id
          and sg.status = 'INVITED';
    exception
        when unique_violation then
            return query select 'ALREADY_GRANTED'::text, p_org_id;
            return;
    end;

    if not found then
        return query select 'NOT_PENDING'::text, v_grant.grantee_org_id;
        return;
    end if;

    return query select 'OK'::text, p_org_id;
end;
$$;

comment on function public.accept_sharing_grant_invitation(uuid, uuid) is
    '2026-09-03 (P14, adds the capability check to the 2026-08-29 body). '
    'Binds an email-invited sharing grant to the organization the caller '
    'names, after verifying: an authenticated session, a confirmed email '
    'matching invited_email, an INVITED and unexpired grant, that the '
    'target is not the grantor, that the caller is an ACTIVE member of '
    'the target, and -- new -- that the target actually holds '
    'IMPORTER_DECLARANT. Membership alone established that the caller '
    'may act for an organization, not that a producer''s verified '
    'emissions data may be bound to it; the binding is immutable once '
    'made, and admits every member of that organization to the data.';
