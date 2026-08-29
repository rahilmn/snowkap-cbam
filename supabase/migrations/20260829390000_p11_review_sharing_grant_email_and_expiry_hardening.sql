-- ============================================================
-- Snowkap CBAM
-- P11 mandatory security review response: sharing_grants' mirror-image
-- of the previous migration's email-confirmation/expiry fixes, plus
-- the accept-path expiry gap the review found only on this table
--
-- Purpose:
--   Finding #1 (BLOCKING) named FIVE policies and TWO RPCs relying on
--   an unverified email claim; 20260829380000 fixed the two
--   organization_invitations policies and accept_organization_invitation.
--   This migration fixes sharing_grants' three (
--   sharing_grants_select_via_pending_invitation,
--   organizations_select_via_pending_sharing_grant_invitation,
--   app.installation_has_pending_sharing_grant_invitation, which backs
--   installations_select_via_pending_sharing_grant_invitation) and the
--   second RPC (accept_sharing_grant_invitation) the same way -- see
--   app.user_confirmed_email() (20260829380000) for the shared
--   reasoning, not repeated here.
--
--   Finding #4 (SHOULD-FIX, confirmed live): the same three pending-
--   invitation SELECT policies key ONLY on `status = 'INVITED'`, with
--   no expires_at predicate -- unlike app.user_shared_installation_ids()
--   (20260829260000), the only policy in this schema that already had
--   one. A bootstrap invite that lapsed without ever being accepted
--   keeps disclosing the grantor org's name and the installation's
--   name/country indefinitely to whoever later controls that mailbox
--   -- exactly the scenario issueSharingGrant's own comment names as
--   the reason the 7-day default expiry exists, which this closes the
--   disclosure half of (the 7-day expiry already stops the ACCEPT
--   half). All three now additionally require
--   `expires_at is null or expires_at > now()`.
--
--   Finding #5 (SHOULD-FIX, confirmed live by every reviewer): the
--   direct-grant accept path (a bare CAS UPDATE against
--   sharing_grants_update_grantee_accept -- acceptSharingGrant,
--   manage-sharing-grants.ts) never checked expires_at at all, unlike
--   the bootstrap RPC's own EXPIRED branch. Live reproduction: the
--   exact CAS UPDATE acceptSharingGrant issues, against a grant
--   expired 400 days, produced status=ACTIVE plus a
--   sharing_grant.accepted audit event for access that
--   app.user_shared_installation_ids()'s own expiry filter confirms
--   never actually reads anything -- a misleading audit trail and a
--   Sharing screen showing ACTIVE for dead access, not a tenancy
--   breach. src/domain/sharing/grant-lifecycle.ts (Wall 1,
--   application layer) already gained the matching check in this same
--   review; this migration is Wall 2 (RLS, database layer) --
--   sharing_grants_update_grantee_accept's own USING clause now
--   additionally requires `expires_at is null or expires_at > now()`,
--   so even a caller bypassing the application function entirely (a
--   raw supabase.from("sharing_grants").update() call) cannot accept
--   an expired grant -- the CAS simply matches zero rows, exactly the
--   same "two walls, always both" posture this codebase already
--   applies everywhere else (see e.g. 20260829240000's evidence
--   storage RLS alongside its application-layer ownership check).
-- ============================================================


-- ============================================================
-- 1. sharing_grants_select_via_pending_invitation -- confirmed email +
--    expiry
-- ============================================================

drop policy sharing_grants_select_via_pending_invitation on public.sharing_grants;

create policy sharing_grants_select_via_pending_invitation
    on public.sharing_grants
    for select
    to authenticated
    using (
        status = 'INVITED'
        and (expires_at is null or expires_at > now())
        and invited_email is not null
        and lower(invited_email) = lower(coalesce(app.user_confirmed_email(), ''))
    );

comment on policy sharing_grants_select_via_pending_invitation on public.sharing_grants is
    '2026-08-29 (P11 review): now requires app.user_confirmed_email() '
    '(finding #1, BLOCKING -- see that function''s own comment) AND '
    '(expires_at is null or expires_at > now()) (finding #4, '
    'SHOULD-FIX -- a lapsed bootstrap invite no longer discloses '
    'itself indefinitely). Still status = ''INVITED''-only, unchanged '
    'from 20260829300000.';


-- ============================================================
-- 2. organizations_select_via_pending_sharing_grant_invitation -- same
--    two fixes
-- ============================================================

drop policy organizations_select_via_pending_sharing_grant_invitation on public.organizations;

create policy organizations_select_via_pending_sharing_grant_invitation
    on public.organizations
    for select
    to authenticated
    using (
        exists (
            select 1
            from public.sharing_grants sg
            where sg.grantor_org_id = organizations.id
              and sg.status = 'INVITED'
              and (sg.expires_at is null or sg.expires_at > now())
              and sg.invited_email is not null
              and lower(sg.invited_email) = lower(coalesce(app.user_confirmed_email(), ''))
        )
    );

comment on policy organizations_select_via_pending_sharing_grant_invitation on public.organizations is
    '2026-08-29 (P11 review): same two fixes as '
    'sharing_grants_select_via_pending_invitation above.';


-- ============================================================
-- 3. app.installation_has_pending_sharing_grant_invitation() -- same
--    two fixes (backs installations_select_via_pending_sharing_grant_invitation,
--    which needs no redefinition of its own -- it only calls this
--    function)
-- ============================================================

create or replace function app.installation_has_pending_sharing_grant_invitation(
    p_installation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.sharing_grants sg
        where sg.installation_id = p_installation_id
          and sg.status = 'INVITED'
          and (sg.expires_at is null or sg.expires_at > now())
          and sg.invited_email is not null
          and lower(sg.invited_email) = lower(coalesce(app.user_confirmed_email(), ''))
    );
$$;

comment on function app.installation_has_pending_sharing_grant_invitation(uuid) is
    'SECURITY DEFINER so installations_select_via_pending_sharing_grant_invitation '
    'can check for a pending sharing_grants row without re-triggering '
    'sharing_grants'' own RLS -- see the ORIGINAL 20260829300000 '
    'comment on this function for why a raw subquery here causes real '
    'infinite recursion (42P17) on every sharing_grants INSERT. '
    '2026-08-29 (P11 review): now requires app.user_confirmed_email() '
    '(finding #1) AND an unexpired grant (finding #4) -- same two '
    'fixes as sharing_grants_select_via_pending_invitation.';


-- ============================================================
-- 4. accept_sharing_grant_invitation() -- confirmed email only
--    (this RPC''s own EXPIRED branch already handles accept-time
--    expiry correctly; only the email-claim check needed hardening)
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
            'accept_sharing_grant_invitation requires an authenticated caller.';
    end if;

    -- 2026-08-29 (P11 review, finding #1, BLOCKING): additionally
    -- requires email_confirmed_at is not null -- see
    -- app.user_confirmed_email()'s comment (20260829380000) for why.
    select email
    into v_user_email
    from auth.users
    where auth.users.id = auth.uid()
      and email_confirmed_at is not null;

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

    -- 2026-08-29 (P11 re-review: this create-or-replace was authored
    -- from a pre-20260829360000 body and silently reverted that
    -- migration's own item (3) fix -- confirmed live: a DEACTIVATED
    -- member of p_org_id passed this raw `exists (select 1 from
    -- public.memberships ...)` check and could still bind their former
    -- org into a new cross-org sharing relationship. Restored to route
    -- through app.user_org_ids(), exactly as 20260829360000 already
    -- established -- see that migration's own comment on this same
    -- gate for why (the deactivated row itself still "exists").
    if not exists (
        select 1
        from app.user_org_ids() as caller_org_id
        where caller_org_id = p_org_id
    ) then
        return query select 'NOT_A_MEMBER'::text, null::uuid;
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
    'The only sanctioned way a bootstrap (invited-by-email) sharing_grants '
    'row resolves its grantee_org_id for the first time -- mirrors '
    'accept_organization_invitation. Atomically validates (found; '
    'addressed to the caller''s own authenticated AND CONFIRMED email '
    '-- 2026-08-29 P11 review, see app.user_confirmed_email() -- via '
    'auth.users, not auth.jwt(), which the RLS policies above use '
    'instead; INVITED; unexpired if expires_at is set; not a self-'
    'grant; caller is actually a member of p_org_id) then flips the '
    'row to ACTIVE and resolves grantee_org_id in one CAS UPDATE. '
    'p_org_id is caller-supplied and therefore untrusted input -- the '
    'membership/self-grant checks above are required defense-in-depth, '
    'not redundant belt-and-braces.';

revoke all on function public.accept_sharing_grant_invitation(uuid, uuid) from public;
grant execute on function public.accept_sharing_grant_invitation(uuid, uuid) to authenticated;


-- ============================================================
-- 5. sharing_grants_update_grantee_accept -- expiry predicate (finding
--    #5, RLS/Wall-2 half; the domain-layer/Wall-1 half is
--    src/domain/sharing/grant-lifecycle.ts's ACCEPT case, same
--    review)
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
    );

comment on policy sharing_grants_update_grantee_accept on public.sharing_grants is
    'Unchanged from 20260829300000 except the new USING clause: '
    '2026-08-29 (P11 review, finding #5, SHOULD-FIX, confirmed live): '
    '(expires_at is null or expires_at > now()) -- without it, a bare '
    'client UPDATE (via acceptSharingGrant, manage-sharing-grants.ts, '
    'or any raw supabase.from() call) could accept a grant whose '
    'expiry had already lapsed, producing an ACTIVE row and a '
    'sharing_grant.accepted audit event for access that '
    'app.user_shared_installation_ids()''s own expiry filter would '
    'never actually honor. This is the RLS-layer half of the fix; '
    'src/domain/sharing/grant-lifecycle.ts''s ACCEPT case gained the '
    'matching application-layer check in the same review, so this row '
    'is now unreachable via either path, not merely rejected late by '
    'one of them.';


-- ============================================================
-- END OF MIGRATION
-- ============================================================
