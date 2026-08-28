-- ============================================================
-- Snowkap CBAM
-- P3: organization invitations
--
-- Purpose:
--   Membership creation has so far only happened via
--   create_organization_with_owner() (self-service onboarding). There
--   is no way for an ADMIN/OWNER to add a second person to an
--   organization except direct DB manipulation -- docs/plans/
--   MASTER_PLAN.md §14/§27 call for a real invite -> accept flow
--   ("ADMIN invites email -> Auth invite -> membership on
--   acceptance (audited)").
--
-- Scope of THIS migration:
--   - organization_invitations table (PENDING/ACCEPTED/REVOKED/EXPIRED)
--   - RLS: ADMIN/OWNER manage invitations for their org; an invited
--     user (not yet a member, so the admin/owner policy doesn't cover
--     them) can see their own PENDING invitations by matching their
--     authenticated email against the invitation's email
--   - accept_organization_invitation() SECURITY DEFINER RPC: the only
--     way an invitation becomes a membership. Mirrors
--     create_organization_with_owner()'s chicken-and-egg reasoning --
--     there is no membership yet to authorize a plain client-side
--     insert into memberships against, and acceptance must atomically
--     insert the membership, flip the invitation to ACCEPTED, and
--     record an audit event together.
--   - Revocation is a bare RLS UPDATE (ADMIN/OWNER only, and the
--     `with check` only allows the transition to REVOKED) rather than
--     an RPC, since it doesn't touch any other table.
--
-- Deliberately NOT in scope here:
--   - Actually sending the invitation email. That happens application-
--     side via the Supabase Auth admin API
--     (supabase.auth.admin.inviteUserByEmail), which requires the
--     service-role client and therefore cannot run inside a
--     client-callable RPC. The row this migration creates is looked
--     up by the accept-invitation screen once the invited user has a
--     session (from clicking the emailed link).
--   - Re-inviting/resending. The application layer can simply create
--     a new PENDING row once the prior one is REVOKED/EXPIRED (the
--     partial unique index only constrains PENDING rows per
--     org+email).
-- ============================================================


-- ============================================================
-- 1. ORGANIZATION_INVITATIONS
-- ============================================================

create table public.organization_invitations (
    id uuid primary key default gen_random_uuid(),

    org_id uuid not null
        references public.organizations(id)
        on delete cascade,

    email text not null,

    -- OWNER is deliberately excluded -- granting ownership is a
    -- separate, more deliberate action than a routine invite (not yet
    -- built; see docs/plans/MASTER_PLAN.md P10's role-management scope).
    role text not null
        check (
            role in ('ADMIN', 'MEMBER')
        ),

    status text not null
        default 'PENDING'
        check (
            status in ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED')
        ),

    invited_by uuid not null
        references auth.users(id)
        on delete restrict,

    created_at timestamptz not null default now(),

    expires_at timestamptz not null
        default (now() + interval '7 days'),

    accepted_at timestamptz,

    accepted_by uuid
        references auth.users(id)
        on delete restrict,

    constraint organization_invitations_email_format_ck
        check (
            email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
        )
);

comment on table public.organization_invitations is
    'Pending/resolved invitations to join an organization. Becomes a '
    'membership row only via accept_organization_invitation() -- never '
    'a direct client-side insert into memberships, which has no bare '
    'INSERT policy (see 20260828070000''s header comment).';

-- Only one PENDING invite per (org, email) at a time -- a second
-- invite attempt while one is already outstanding is a re-send, which
-- the application layer handles by revoking the old row first.
create unique index organization_invitations_org_email_pending_uq
    on public.organization_invitations (org_id, lower(email))
    where status = 'PENDING';

create index organization_invitations_org_id_idx
    on public.organization_invitations (org_id);

create index organization_invitations_email_pending_idx
    on public.organization_invitations (lower(email))
    where status = 'PENDING';


-- ============================================================
-- 2. ROW LEVEL SECURITY
-- ============================================================

alter table public.organization_invitations
    enable row level security;

create policy organization_invitations_select_admin_or_owner
    on public.organization_invitations
    for select
    to authenticated
    using (
        app.user_is_admin_or_owner_of(org_id)
    );

-- An invited user is not a member of org_id yet, so the policy above
-- does not cover them -- the accept-invitation screen needs them to
-- be able to see (and confirm the details of) their own invitation.
create policy organization_invitations_select_own_email
    on public.organization_invitations
    for select
    to authenticated
    using (
        status = 'PENDING'
        and lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    );

create policy organization_invitations_insert_admin_or_owner
    on public.organization_invitations
    for insert
    to authenticated
    with check (
        app.user_is_admin_or_owner_of(org_id)
        and invited_by = auth.uid()
        and status = 'PENDING'
    );

-- Revocation only -- acceptance goes through the SECURITY DEFINER RPC
-- below, which bypasses RLS entirely, so this policy only needs to
-- guard against an ADMIN/OWNER using a bare update to do anything
-- other than revoke (e.g. it cannot be used to forge an ACCEPTED row).
create policy organization_invitations_update_admin_or_owner
    on public.organization_invitations
    for update
    to authenticated
    using (
        app.user_is_admin_or_owner_of(org_id)
    )
    with check (
        app.user_is_admin_or_owner_of(org_id)
        and status = 'REVOKED'
    );


-- ============================================================
-- 3. ACCEPT INVITATION (SECURITY DEFINER RPC)
-- ============================================================

create or replace function public.accept_organization_invitation(
    p_invitation_id uuid
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
    v_invite public.organization_invitations%rowtype;
    v_user_email text;
begin
    if auth.uid() is null then
        raise exception
            'accept_organization_invitation requires an authenticated caller.';
    end if;

    select email
    into v_user_email
    from auth.users
    where auth.users.id = auth.uid();

    select oi.*
    into v_invite
    from public.organization_invitations oi
    where oi.id = p_invitation_id;

    if v_invite.id is null then
        return query select 'NOT_FOUND'::text, null::uuid;
        return;
    end if;

    if lower(v_invite.email) <> lower(coalesce(v_user_email, '')) then
        return query select 'EMAIL_MISMATCH'::text, v_invite.org_id;
        return;
    end if;

    if v_invite.status = 'ACCEPTED' then
        return query select 'ALREADY_ACCEPTED'::text, v_invite.org_id;
        return;
    end if;

    if v_invite.status <> 'PENDING' then
        return query select 'NOT_PENDING'::text, v_invite.org_id;
        return;
    end if;

    if v_invite.expires_at < now() then
        update public.organization_invitations oi
        set status = 'EXPIRED'
        where oi.id = v_invite.id;

        return query select 'EXPIRED'::text, v_invite.org_id;
        return;
    end if;

    if exists (
        select 1
        from public.memberships m
        where m.org_id = v_invite.org_id
          and m.user_id = auth.uid()
    ) then
        update public.organization_invitations oi
        set status = 'ACCEPTED',
            accepted_at = now(),
            accepted_by = auth.uid()
        where oi.id = v_invite.id;

        return query select 'ALREADY_MEMBER'::text, v_invite.org_id;
        return;
    end if;

    insert into public.memberships (
        org_id,
        user_id,
        role
    )
    values (
        v_invite.org_id,
        auth.uid(),
        v_invite.role
    );

    update public.organization_invitations oi
    set status = 'ACCEPTED',
        accepted_at = now(),
        accepted_by = auth.uid()
    where oi.id = v_invite.id;

    insert into public.audit_events (
        org_id,
        actor_type,
        actor_user_id,
        event_type,
        aggregate_type,
        aggregate_id,
        payload
    )
    values (
        v_invite.org_id,
        'USER',
        auth.uid(),
        'membership.invitation_accepted',
        'MEMBERSHIP',
        v_invite.id::text,
        jsonb_build_object(
            'email', v_invite.email,
            'role', v_invite.role
        )
    );

    return query select 'OK'::text, v_invite.org_id;
end;
$$;

comment on function public.accept_organization_invitation(uuid) is
    'The only sanctioned way an invitation becomes a membership. '
    'Atomically validates the invitation (found, addressed to the '
    'caller''s own authenticated email, PENDING, unexpired), inserts '
    'the membership, flips the invitation to ACCEPTED, and records a '
    'membership.invitation_accepted audit event -- all in one '
    'transaction. Returns a discriminated (result_status, result_org_id) '
    'row rather than raising, so ordinary rejections (already a member, '
    'expired, wrong email) are caller-branchable instead of requiring '
    'Postgres error-message parsing.';

revoke all on function public.accept_organization_invitation(uuid) from public;
grant execute on function public.accept_organization_invitation(uuid) to authenticated;


-- ============================================================
-- END OF MIGRATION
-- ============================================================
