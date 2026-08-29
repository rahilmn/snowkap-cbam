-- ============================================================
-- Snowkap CBAM
-- P11 mandatory security review response: an unconfirmed email claim
-- is enough to take over an invited org, and EMAIL_MISMATCH leaked the
-- target org's id
--
-- Purpose:
--   Finding #1 (BLOCKING, confirmed live by every reviewer of P11's
--   mandatory security review): organization_invitations_select_own_email,
--   organizations_select_via_pending_invitation, and
--   accept_organization_invitation() (this migration's targets --
--   sharing_grants' mirror-image policies/RPC are fixed in the next
--   migration) all authorize solely on `auth.jwt() ->> 'email'` /
--   `auth.users.email` MATCHING the invitation's target address. That
--   is only a real proof of mailbox control if Supabase Auth actually
--   required confirming the address before issuing a session -- and
--   the only Auth setting this repo carries (supabase/config.toml,
--   `enable_confirmations = false`) turns that off, with
--   signUpAction's own comment (app/(auth)/actions.ts) already
--   admitting the live project's setting was "not yet pushed there."
--   Live reproduction: create an auth.users row with an email that was
--   never confirmed (exactly what local sign-up produces with
--   confirmations off), and accept_organization_invitation() grants
--   ADMIN of the victim org on the strength of that claim alone.
--
--   The fix is NOT "flip config.toml and hope the hosted project
--   matches" -- that setting lives in Supabase project configuration
--   this repo cannot enforce or even observe from here (no Railway/
--   staging Supabase is connected to this environment), and the whole
--   point of this finding is that the dependency was silent. Instead,
--   email-claim authorization is made to independently, verifiably
--   require `auth.users.email_confirmed_at is not null` -- a real
--   column this repo DOES control the read of, in every one of the
--   five policies/two RPCs the review named. This holds regardless of
--   what `enable_confirmations` is set to on any environment: an
--   unconfirmed user's email claim is now worthless for this class of
--   authorization no matter how Auth is configured, closing the
--   silent-dependency problem at its root rather than only asserting
--   it should be set correctly elsewhere.
--
--   app.user_confirmed_email(): SECURITY DEFINER (same shape as every
--   other app.* helper in this schema, e.g. app.user_org_ids()) so RLS
--   policies -- which cannot otherwise read auth.users under the
--   `authenticated` role's own grants -- can check confirmation status
--   without a policy-level join. Returns NULL (never a bare,
--   unconfirmed email) unless email_confirmed_at is actually set, so
--   every caller of this function inherits the confirmed-only
--   guarantee automatically: `lower(coalesce(app.user_confirmed_email(), ''))`
--   can never match a real invitation email for an unconfirmed caller,
--   the same failure-closed shape `coalesce(auth.jwt() ->> 'email', '')`
--   already used, just now actually gated on confirmation.
--
--   Finding #2 (SHOULD-FIX, confirmed live): accept_organization_invitation's
--   EMAIL_MISMATCH branch returned `v_invite.org_id` -- a real value --
--   even though that branch fires BEFORE any authorization check (only
--   existence has been confirmed at that point), letting any
--   authenticated caller holding a real invitation id learn which org
--   it targets. accept_sharing_grant_invitation (20260829300000) was
--   already fixed for the identical bug in its own review; this
--   applies the same fix (`null::uuid`) here.
--
--   Finding #4/N2 (SHOULD-FIX, confirmed live): organization_invitations_select_own_email
--   and organizations_select_via_pending_invitation admit a row on
--   `status = 'PENDING'` alone, with no `expires_at` check -- an
--   invitation that lapsed months ago still discloses the target org's
--   name/id/role indefinitely to anyone who later controls that
--   mailbox (the exact "mailbox reassignment" scenario
--   issueSharingGrant's own comment names as the reason a 7-day expiry
--   exists at all). Both policies below now additionally require
--   `expires_at > now()`. accept_organization_invitation's own EXPIRED
--   branch already handles the accept-time case correctly (lazily
--   flips the row to EXPIRED); this closes the read-time disclosure
--   window that check never covered.
-- ============================================================


-- ============================================================
-- 1. app.user_confirmed_email()
-- ============================================================

create or replace function app.user_confirmed_email()
returns text
language sql
stable
security definer
set search_path = public
as $$
    select email
    from auth.users
    where id = auth.uid()
      and email_confirmed_at is not null;
$$;

comment on function app.user_confirmed_email() is
    'The current authenticated caller''s email, but ONLY if '
    'auth.users.email_confirmed_at is set -- returns NULL (never a '
    'bare, unconfirmed email) otherwise, so every caller of this '
    'function automatically inherits "an email claim only counts if '
    'mailbox control was actually verified." SECURITY DEFINER so RLS '
    'policies can read auth.users for this check without a policy-'
    'level join (the authenticated role has no direct SELECT grant on '
    'auth.users) -- same shape as every other app.* helper in this '
    'schema. See 20260829380000''s header comment (P11 finding #1, '
    'BLOCKING) for the org-takeover this closes: previously, every '
    'email-claim policy/RPC in this schema trusted '
    'auth.jwt() ->> ''email'' / a bare auth.users.email read, which is '
    'only a real proof of mailbox ownership if Supabase Auth actually '
    'required confirming the address -- a hosted-project setting this '
    'repo could not enforce or observe. This function makes the '
    'guarantee hold regardless of that setting.';

revoke all on function app.user_confirmed_email() from public;
grant execute on function app.user_confirmed_email() to authenticated;


-- ============================================================
-- 2. organization_invitations_select_own_email -- confirmed email +
--    expiry (redefined via drop+create, this codebase's established
--    precedent for widening/tightening an already-applied policy)
-- ============================================================

drop policy organization_invitations_select_own_email on public.organization_invitations;

create policy organization_invitations_select_own_email
    on public.organization_invitations
    for select
    to authenticated
    using (
        status = 'PENDING'
        and expires_at > now()
        and lower(email) = lower(coalesce(app.user_confirmed_email(), ''))
    );

comment on policy organization_invitations_select_own_email on public.organization_invitations is
    '2026-08-29 (P11 review): now requires app.user_confirmed_email() '
    '(not a bare JWT email claim -- see that function''s own comment '
    'for why) AND expires_at > now() (P11 finding #4/N2 -- a lapsed '
    'invitation no longer discloses itself, matching '
    'accept_organization_invitation''s own accept-time EXPIRED check, '
    'which this closes the read-time counterpart of). Still PENDING-'
    'only, unchanged from 20260828130000.';


-- ============================================================
-- 3. organizations_select_via_pending_invitation -- same two fixes
-- ============================================================

drop policy organizations_select_via_pending_invitation on public.organizations;

create policy organizations_select_via_pending_invitation
    on public.organizations
    for select
    to authenticated
    using (
        exists (
            select 1
            from public.organization_invitations oi
            where oi.org_id = organizations.id
              and oi.status = 'PENDING'
              and oi.expires_at > now()
              and lower(oi.email) = lower(coalesce(app.user_confirmed_email(), ''))
        )
    );

comment on policy organizations_select_via_pending_invitation on public.organizations is
    '2026-08-29 (P11 review): same two fixes as '
    'organization_invitations_select_own_email above -- confirmed '
    'email only, and expires_at > now() so a lapsed invitation no '
    'longer discloses the target org''s name/id to whoever later '
    'controls that mailbox.';


-- ============================================================
-- 4. accept_organization_invitation() -- confirmed email + no org_id
--    leak on EMAIL_MISMATCH
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
    v_existing_membership public.memberships%rowtype;
    v_user_email text;
begin
    if auth.uid() is null then
        raise exception
            'accept_organization_invitation requires an authenticated caller.';
    end if;

    -- 2026-08-29 (P11 review, finding #1, BLOCKING): additionally
    -- requires email_confirmed_at is not null -- an unconfirmed
    -- caller's email now never matches (v_user_email stays NULL,
    -- coalesced to '' below, which cannot equal a real invitation
    -- email per organization_invitations_email_format_ck). See
    -- app.user_confirmed_email()'s own comment for why this cannot be
    -- left to hosted-project Auth configuration alone.
    select email
    into v_user_email
    from auth.users
    where auth.users.id = auth.uid()
      and email_confirmed_at is not null;

    select oi.*
    into v_invite
    from public.organization_invitations oi
    where oi.id = p_invitation_id;

    if v_invite.id is null then
        return query select 'NOT_FOUND'::text, null::uuid;
        return;
    end if;

    if lower(v_invite.email) <> lower(coalesce(v_user_email, '')) then
        -- 2026-08-29 (P11 review, finding #2, SHOULD-FIX): null::uuid,
        -- not v_invite.org_id -- this branch fires BEFORE any
        -- authorization check (only existence is confirmed above), so
        -- returning the real org id let any authenticated caller
        -- holding an invitation id they have no relationship to learn
        -- which org it targets. accept_sharing_grant_invitation
        -- (20260829300000) already carries the identical fix for the
        -- identical reason -- see that function's own comment.
        -- acceptInvitation (src/application/organizations/invitations.ts)
        -- already discards result_org_id on this branch, so this is a
        -- free fix; every other pre-authorization rejection below
        -- already returned null::uuid, this was the one exception.
        return query select 'EMAIL_MISMATCH'::text, null::uuid;
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

    -- 2026-08-29 (P11 re-review: this create-or-replace was authored
    -- from a pre-20260829360000 body and silently reverted that
    -- migration's own deactivated-member fix -- confirmed live: a
    -- DEACTIVATED member re-invited to their own org fell into the
    -- ALREADY_MEMBER branch below, silently flipping the invitation to
    -- ACCEPTED (consuming it) instead of surfacing MEMBERSHIP_DEACTIVATED
    -- and leaving it PENDING. Restored to the whole-row fetch +
    -- deactivated_at branch 20260829360000 already established.
    select m.*
    into v_existing_membership
    from public.memberships m
    where m.org_id = v_invite.org_id
      and m.user_id = auth.uid();

    if v_existing_membership.id is not null then
        if v_existing_membership.deactivated_at is not null then
            return query select 'MEMBERSHIP_DEACTIVATED'::text, v_invite.org_id;
            return;
        end if;

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
    'caller''s own authenticated AND CONFIRMED email -- 2026-08-29 P11 '
    'review, see app.user_confirmed_email() -- PENDING, unexpired), '
    'inserts the membership, flips the invitation to ACCEPTED, and '
    'records a membership.invitation_accepted audit event -- all in '
    'one transaction. Returns a discriminated (result_status, '
    'result_org_id) row rather than raising, so ordinary rejections '
    '(already a member, expired, wrong email) are caller-branchable '
    'instead of requiring Postgres error-message parsing. '
    'result_org_id is null::uuid on every branch that fires before '
    'authorization succeeds (NOT_FOUND, EMAIL_MISMATCH -- fixed '
    '2026-08-29, see this function''s own inline comment), so a caller '
    'can never use this RPC to learn which org a given invitation id '
    'targets without actually being entitled to accept it.';

revoke all on function public.accept_organization_invitation(uuid) from public;
grant execute on function public.accept_organization_invitation(uuid) to authenticated;


-- ============================================================
-- END OF MIGRATION
-- ============================================================
