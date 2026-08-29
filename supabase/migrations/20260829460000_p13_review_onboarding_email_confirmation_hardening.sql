-- ============================================================
-- Snowkap CBAM
-- P13 adversarial audit finding, live-reproduced against real
-- Postgres: create_organization_with_owner has no email-confirmation
-- gate, letting an unconfirmed caller squat a real company's identity
-- as the tenancy root
--
-- Purpose:
--   create_organization_with_owner (20260828080000, redefined by
--   20260828090000 to add the audit-event insert) is the ONLY
--   sanctioned way to create an organization -- organizations has no
--   direct INSERT policy (see organizations-isolation.test.ts's own
--   "must go through the onboarding RPC" test). Its only precondition
--   has ever been `if auth.uid() is null then raise`. With
--   `enable_confirmations = false` (supabase/config.toml's committed
--   value), a caller who signs up as e.g. finance@some-real-company.com
--   receives a session immediately -- WITHOUT ever proving control of
--   that mailbox -- and this RPC then lets them become OWNER of a
--   brand-new organization under that identity: the root of the
--   entire tenancy model. From there they can invite members and
--   issue sharing grants that look like they come from a real company.
--   Live-reproduced directly: an auth.users row with
--   email_confirmed_at = null, signed in, calling this RPC --
--   succeeded, exactly as a confirmed caller's call would.
--
--   The claim is IRREVERSIBLE in the current product: organizations
--   has no DELETE policy, and organizations_slug_uq
--   (20260828070000_create_organizations_foundation.sql) is a GLOBAL
--   unique constraint, so a squatted slug can never be reclaimed by
--   the real company once taken by an impersonator.
--
--   This is the exact same class of gap 20260829380000 (P11 mandatory
--   security review) already closed for accept_organization_invitation()
--   and accept_sharing_grant_invitation() -- see that migration's own
--   header comment and app.user_confirmed_email()'s doc comment for
--   the full reasoning (in short: an email claim is only real proof of
--   mailbox control if Auth actually required confirming it first, and
--   that is a hosted-project setting this repo cannot enforce or
--   observe from here -- so authorization is made to independently,
--   verifiably require auth.users.email_confirmed_at is not null,
--   regardless of what enable_confirmations is set to anywhere).
--   app.user_confirmed_email() already exists for exactly this --
--   reused here rather than a second, hand-rolled auth.users query.
--
--   Fix shape: create_organization_with_owner already raises (never
--   returns a discriminated {status, reason} row -- it returns
--   public.organizations directly on success), so the fix matches that
--   existing shape rather than introducing a new one: a second
--   precondition check, raising a distinct, caller-recognizable
--   message ("Confirm your email address...") the same way
--   signInAction (app/(auth)/actions.ts) already recognizes Supabase
--   Auth's own "email not confirmed" error by checking for "confirm"
--   in the message text. app/onboarding/actions.ts is updated in the
--   same commit to recognize this message and surface an honest,
--   specific error instead of the generic "something went wrong"
--   catch-all, and to add IP-keyed rate limiting to the call site
--   (master plan §28), matching every other real-mutation Server
--   Action in this codebase (see app/(auth)/actions.ts's signUpLimiter,
--   app/team/actions.ts's inviteMemberLimiter).
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

    -- 2026-08-29 (P13 audit, BLOCKING, live-reproduced -- see this
    -- migration's header comment): a caller whose email address was
    -- never confirmed must not be able to claim OWNER of a brand-new
    -- organization under that identity. app.user_confirmed_email()
    -- returns the caller's email ONLY if auth.users.email_confirmed_at
    -- is set, NULL otherwise -- see that function's own comment
    -- (20260829380000). This does not depend on WHICH email the caller
    -- claims (unlike the invitation-acceptance RPCs, there is no
    -- target email to match here) -- it only needs to know that some
    -- confirmed identity exists behind this session before minting a
    -- new tenancy root for it.
    if app.user_confirmed_email() is null then
        raise exception
            'Confirm your email address before creating an organization.';
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
        v_org.id,
        'USER',
        auth.uid(),
        'organization.created',
        'ORGANIZATION',
        v_org.id::text,
        jsonb_build_object(
            'name', v_org.name,
            'slug', v_org.slug,
            'capabilities', v_org.capabilities
        )
    );

    return v_org;
end;
$$;

comment on function public.create_organization_with_owner(text, text, text[]) is
    'The only sanctioned way to create an organization: atomically '
    'inserts the org row, a matching OWNER membership row for the '
    'calling user, and an organization.created audit event, all in one '
    'transaction. SECURITY DEFINER because no bare INSERT policy can '
    'express "and also insert exactly one membership row for me" -- '
    'there is no membership yet to authorize a plain table-policy '
    'insert against. 2026-08-29 (P13 audit, BLOCKING): also requires '
    'app.user_confirmed_email() is not null -- an unconfirmed caller''s '
    'session is not enough to mint a new tenancy root under whatever '
    'email they claimed at sign-up. See this migration''s own header '
    'comment for the live-reproduced org-squatting gap this closes.';


-- ============================================================
-- END OF MIGRATION
-- ============================================================
