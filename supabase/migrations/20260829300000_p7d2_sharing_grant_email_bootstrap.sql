-- ============================================================
-- Snowkap CBAM
-- P7-D2: sharing_grants bootstrap-by-email path
--
-- Purpose:
--   20260829260000 (P7-D) built ONLY the direct-grant case for
--   sharing_grants -- both orgs already Snowkap customers, grantee_org_id
--   always populated at INSERT time, invited_email forced NULL by
--   sharing_grants_invited_email_deferred_ck. That migration's own header
--   comment named the deferred bootstrap path this migration now builds:
--   a producer issues a grant to an email address when the importer org
--   isn't yet known, grantee_org_id starts NULL, and accepting the
--   invitation is what resolves grantee_org_id for the first time --
--   exactly the shape transitionSharingGrant's ACCEPT action already
--   supports (src/domain/sharing/grant-lifecycle.ts takes granteeOrgId as
--   an argument, not an assumption the row already has one; already
--   covered by grant-lifecycle.test.ts's "resolves the grantee org" case
--   with grantee_org_id starting null).
--
--   Mirrors the organization_invitations pattern end to end
--   (20260828130000 + 20260828140000), not a new mechanism:
--     - accept_sharing_grant_invitation(): a SECURITY DEFINER RPC, the
--       only way a bootstrap row's grantee_org_id resolves -- the
--       accept-grantee RLS UPDATE policy below cannot cover this case
--       (its USING clause requires grantee_org_id in the caller's own
--       orgs, which is never true while grantee_org_id is NULL), the
--       same chicken-and-egg reasoning accept_organization_invitation's
--       own header comment gives for memberships.
--     - sharing_grants_select_via_pending_invitation /
--       organizations_select_via_pending_sharing_grant_invitation /
--       installations_select_via_pending_sharing_grant_invitation: three
--       additive SELECT policies (Postgres OR-combines all applicable
--       policies for the same command, so these only WIDEN visibility for
--       the specific pending-bootstrap-invite case, same as
--       organizations_select_via_pending_invitation, 20260828140000) so
--       an invited-but-not-yet-a-member user can see (a) that a pending
--       grant addressed to their email exists, and (b) the grantor org's
--       name and the installation's name/country, enough to make an
--       informed accept decision -- without weakening any other row's
--       visibility (each USING clause requires status = 'INVITED' and an
--       exact, case-insensitive match against the row's own
--       invited_email vs. the caller's authenticated JWT email; a
--       REVOKED/EXPIRED/already-ACTIVE row, or one addressed to a
--       different email, is never admitted by these policies).
--       installations_select_via_pending_sharing_grant_invitation is
--       routed through a new SECURITY DEFINER helper,
--       app.installation_has_pending_sharing_grant_invitation(), rather
--       than a raw subquery like the other two -- see that policy's own
--       section (4) below for why: a raw subquery there causes real
--       "infinite recursion detected in policy for relation
--       sharing_grants" (42P17) on every sharing_grants INSERT, direct-
--       grant or bootstrap alike, because sharing_grants_insert_own_org's
--       own WITH CHECK already reads installations directly. Found live
--       (an actual INSERT reproduced it, not a static read) and fixed
--       before this migration was ever applied to a shared environment.
--
-- Why the RPC takes p_org_id as an explicit parameter, not an ambient
-- lookup:
--   Unlike accept_organization_invitation (where the invitation row
--   itself already carries org_id -- membership just needed a user_id),
--   a bootstrap sharing_grants row's whole point is that grantee_org_id
--   is NOT yet known. "The caller's active org" is a client-side/UI
--   concept with no server-side session storage (see
--   src/application/organizations/get-current-org-context.ts's own doc
--   comment: "an OrgContext {org_id, user_id, role, capabilities} --
--   never ambient", resolved per-request from a preferred-org cookie +
--   the caller's memberships). This RPC is therefore directly callable
--   via supabase.rpc() with an arbitrary p_org_id by any authenticated
--   client, not only through acceptSharingGrantInvitation's own
--   OrgContext-resolving call site -- so, unlike
--   accept_organization_invitation, this function independently
--   re-verifies the caller is actually a member of p_org_id
--   (NOT_A_MEMBER) before ever touching the row. Without that check, the
--   real invited user (email match already required) could otherwise
--   rebind a producer's sharing_grants row to an arbitrary org they have
--   no membership in -- gains that org nothing (every downstream read
--   still gates on real membership via app.user_org_ids()), but would
--   tamper with the grantor's own data with no consent from the org
--   named. SELF_GRANT_NOT_ALLOWED (p_org_id = the grant's own
--   grantor_org_id) is the same check issueSharingGrant already makes at
--   issue time for the direct-grant case, applied here at accept time
--   instead since the bootstrap path cannot know the invitee's eventual
--   org until they actually accept.
--
-- Constraint changes:
--   - Drops sharing_grants_invited_email_deferred_ck (which forced
--     invited_email always NULL -- the entire reason this path was
--     unusable).
--   - sharing_grants_grantee_or_invited_email_ck: a row must always carry
--     at least one of grantee_org_id/invited_email -- replaces the old
--     "always populated at INSERT" guarantee the dropped CHECK gave for
--     grantee_org_id alone, now covering both paths.
--   - sharing_grants_active_requires_grantee_ck: status = 'ACTIVE'
--     implies grantee_org_id is not null -- a real, permanent DB
--     invariant (not just an assumption the RPC's own CAS UPDATE
--     happens to uphold) that an ACTIVE row can never be reached with an
--     unresolved grantee, mirroring how 20260829270000 turned
--     "VERIFIED implies a verifier" into a first-class CHECK for
--     emission_data rather than leaving it an unenforced call-site
--     assumption.
--   - sharing_grants_invited_email_format_ck: same email-shape check as
--     organization_invitations_email_format_ck (20260828130000), applied
--     only when invited_email is not null.
--
-- sharing_grants_insert_own_org (redefined via drop+create, the
-- established precedent this codebase already uses for widening a
-- previously-applied policy -- see 20260829260000's own header comment
-- for the confirmed prior instances): the direct-grant branch is
-- untouched (grantee_org_id not null + a real org via
-- app.organization_exists()); a new OR'd branch admits
-- grantee_org_id is null AND invited_email is not null. Every other
-- clause (ADMIN+ of the grantor org, installation actually belongs to
-- the same grantor_org_id) still applies to both branches unchanged.
--
-- app.prevent_sharing_grant_fact_change() (redefined via CREATE OR
-- REPLACE FUNCTION -- functions, unlike policies, support this directly):
-- relaxes the grantee_org_id immutability clause exactly the way that
-- function's own comment already announced this migration would need to
-- ("a future slice building the email-invitation bootstrap path will
-- need to relax the grantee_org_id clause here... the same way
-- 20260829240000 relaxed evidence_file_ids"). The relaxed clause permits
-- a grantee_org_id change ONLY when the OLD value was NULL (first-time
-- resolution) -- once populated, grantee_org_id reverts to fully
-- immutable, so this does not open a path to reassign an
-- already-resolved grant to a different org.
-- ============================================================


-- ============================================================
-- 1. CONSTRAINTS
-- ============================================================

alter table public.sharing_grants
    drop constraint sharing_grants_invited_email_deferred_ck;

alter table public.sharing_grants
    add constraint sharing_grants_grantee_or_invited_email_ck
        check (
            grantee_org_id is not null or invited_email is not null
        );

alter table public.sharing_grants
    add constraint sharing_grants_active_requires_grantee_ck
        check (
            status <> 'ACTIVE' or grantee_org_id is not null
        );

alter table public.sharing_grants
    add constraint sharing_grants_invited_email_format_ck
        check (
            invited_email is null
            or invited_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
        );

comment on constraint sharing_grants_grantee_or_invited_email_ck on public.sharing_grants is
    'Every row must resolve to a grantee by one path or the other -- '
    'either a known org at INSERT time (direct grant) or an email address '
    'to be resolved later via accept_sharing_grant_invitation() '
    '(bootstrap grant). See this migration''s header comment.';

comment on constraint sharing_grants_active_requires_grantee_ck on public.sharing_grants is
    'An ACTIVE row must always carry a resolved grantee_org_id -- the '
    'bootstrap ACCEPT path (accept_sharing_grant_invitation()) sets '
    'status and grantee_org_id together in the same UPDATE, so this '
    'should never actually fire in practice; kept as a real, permanent '
    'invariant rather than an unenforced call-site assumption, same '
    'reasoning as emission_data_verified_has_verifier_ck (20260829270000).';


-- ============================================================
-- 2. sharing_grants_insert_own_org: admit the bootstrap-by-email branch
-- ============================================================

drop policy sharing_grants_insert_own_org on public.sharing_grants;

create policy sharing_grants_insert_own_org
    on public.sharing_grants
    for insert
    to authenticated
    with check (
        app.user_is_admin_or_owner_of(grantor_org_id)
        and exists (
            select 1
            from public.installations i
            where i.id = sharing_grants.installation_id
              and i.org_id = sharing_grants.grantor_org_id
        )
        and (
            (
                grantee_org_id is not null
                and invited_email is null
                and app.organization_exists(grantee_org_id)
            )
            or (
                grantee_org_id is null
                and invited_email is not null
            )
        )
    );

comment on policy sharing_grants_insert_own_org on public.sharing_grants is
    'ADMIN+ of the grantor org only, installation must belong to the same '
    'grantor org -- unchanged from 20260829260000. Now admits EITHER the '
    'direct-grant shape (grantee_org_id set to a real org, invited_email '
    'null) OR the bootstrap shape (grantee_org_id null, invited_email '
    'set) -- see this migration''s header comment.';


-- ============================================================
-- 3. app.prevent_sharing_grant_fact_change(): relax grantee_org_id
--    null -> a real org, once
-- ============================================================

-- SECURITY FIX (2026-08-29, mandatory adversarial review of this
-- migration, BLOCKING, independently confirmed by two reviewers and
-- their own independent verify passes): the first version of this
-- relaxation (`old.grantee_org_id is not null and new... is distinct`)
-- permitted an UNCONSTRAINED null -> any-value transition on
-- grantee_org_id, with no check on WHO performed it or WHAT status the
-- row was moving to. Because Postgres OR-combines every applicable
-- UPDATE policy's WITH CHECK clause independently from USING (not as
-- per-policy pairs), a grantor ADMIN could target a bootstrap row via
-- sharing_grants_update_grantor_revoke's USING (they own the grantor
-- org; the row is not yet terminal) and satisfy
-- sharing_grants_update_grantee_accept's WITH CHECK in the SAME
-- statement by simply choosing a grantee_org_id they belong to and
-- status = 'ACTIVE' -- a bare client UPDATE, no RPC, no email check,
-- forging an acceptance the named invitee never made (no
-- sharing_grant.accepted audit event either). A second variant
-- (status = 'REVOKED' instead) let the same actor stamp an ARBITRARY
-- org id -- one they have no relationship to at all -- into
-- grantee_org_id, since the revoke policy's own WITH CHECK never
-- constrains that column; sharing_grants_select_grantor_or_grantee then
-- makes the fabricated row visible to that uninvolved org.
--
-- Fixed with two independent layers (verified end to end): (1) below,
-- this trigger now also rejects the null -> non-null transition
-- outright unless new.status = 'ACTIVE' in the SAME statement --
-- closing the REVOKED-shaped variant regardless of which policy's
-- WITH CHECK a caller satisfies. (2) sharing_grants_update_grantee_accept
-- (section 3b below) is redefined to additionally require
-- invited_email is null -- since every bootstrap row has invited_email
-- set (sharing_grants_grantee_or_invited_email_ck /
-- the INSERT policy's own bootstrap branch), that policy's WITH CHECK
-- can now NEVER be satisfied by a bootstrap row via a bare UPDATE,
-- regardless of transition shape -- only the SECURITY DEFINER RPC
-- (which bypasses RLS/policies entirely) can ever resolve a bootstrap
-- row's grantee_org_id. Together, no combination of status/grantee_org_id
-- values in a client-issued UPDATE can move a bootstrap row's
-- grantee_org_id off NULL. Direct grants are unaffected by either
-- layer: their grantee_org_id is already non-null at INSERT (this
-- transition path never applies to them), and their invited_email is
-- always null (satisfying the new accept-policy clause trivially,
-- exactly as before).
create or replace function app.prevent_sharing_grant_fact_change()
returns trigger
language plpgsql
as $$
begin
    if new.grantor_org_id is distinct from old.grantor_org_id
        or (
            old.grantee_org_id is not null
            and new.grantee_org_id is distinct from old.grantee_org_id
        )
        or (
            old.grantee_org_id is null
            and new.grantee_org_id is not null
            and new.status is distinct from 'ACTIVE'
        )
        or new.invited_email is distinct from old.invited_email
        or new.installation_id is distinct from old.installation_id
        or new.created_by_user_id is distinct from old.created_by_user_id
        or new.expires_at is distinct from old.expires_at
        or new.created_at is distinct from old.created_at
    then
        raise exception
            'sharing_grants: only status, updated_at, and a one-time null -> real-org resolution of grantee_org_id (paired with status = ACTIVE in the same statement) may change via UPDATE -- see src/application/sharing/manage-sharing-grants.ts';
    end if;

    return new;
end;
$$;

comment on function app.prevent_sharing_grant_fact_change() is
    'BEFORE UPDATE guard: rejects any UPDATE that changes a column other '
    'than status/updated_at, that changes grantee_org_id once it is '
    'already non-null, or that resolves grantee_org_id from null without '
    'the SAME statement also setting status = ACTIVE (2026-08-29 security '
    'fix -- see this function''s own header comment above for the exact '
    'bypass this closes). Once a row''s grantee_org_id is set (whether at '
    'INSERT time for a direct grant, or via accept_sharing_grant_invitation() '
    'for a bootstrap grant), it is fully immutable again -- this migration '
    'only opens the single null -> real-org resolution '
    'accept_sharing_grant_invitation() needs, announced by this function''s '
    'prior comment (20260829260000) as the change a future slice would '
    'require.';


-- ============================================================
-- 3b. sharing_grants_update_grantee_accept: exclude bootstrap rows --
--     the second layer of the security fix above (redefined via
--     drop+create, the same precedent this migration already uses for
--     sharing_grants_insert_own_org)
-- ============================================================

drop policy sharing_grants_update_grantee_accept on public.sharing_grants;

create policy sharing_grants_update_grantee_accept
    on public.sharing_grants
    for update
    to authenticated
    using (
        grantee_org_id in (select app.user_org_ids())
        and status = 'INVITED'
    )
    with check (
        grantee_org_id in (select app.user_org_ids())
        and status = 'ACTIVE'
        and invited_email is null
    );

comment on policy sharing_grants_update_grantee_accept on public.sharing_grants is
    'Unchanged from 20260829260000 for the direct-grant case (their '
    'invited_email is always null, so the new clause is a no-op there). '
    '2026-08-29 security fix: additionally requires invited_email is '
    'null, so this policy''s WITH CHECK can never be satisfied by a '
    'bootstrap row (invited_email always set) via a bare client UPDATE '
    '-- only accept_sharing_grant_invitation() (SECURITY DEFINER, '
    'bypasses RLS) can ever resolve one. See app.prevent_sharing_grant_fact_change()''s '
    'own header comment (section 3 above) for the full exploit this '
    'closes and why both layers are needed together.';


-- ============================================================
-- 4. RLS: pending-bootstrap-invitation visibility (sharing_grants,
--    organizations, installations) -- three additive policies, same
--    shape as organization_invitations_select_own_email /
--    organizations_select_via_pending_invitation (20260828130000 /
--    20260828140000)
-- ============================================================

create policy sharing_grants_select_via_pending_invitation
    on public.sharing_grants
    for select
    to authenticated
    using (
        status = 'INVITED'
        and invited_email is not null
        and lower(invited_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    );

comment on policy sharing_grants_select_via_pending_invitation on public.sharing_grants is
    'Lets an invited-by-email, not-yet-resolved user see their own pending '
    'sharing_grants row (grantee_org_id is still null, so '
    'sharing_grants_select_grantor_or_grantee does not cover them) -- '
    'matched by their authenticated JWT email, same pattern as '
    'organization_invitations_select_own_email. Scoped to status = '
    '''INVITED'' only, matching that policy''s own PENDING-only scope: a '
    'REVOKED/EXPIRED/already-ACTIVE row is never admitted by this policy.';

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
              and sg.invited_email is not null
              and lower(sg.invited_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        )
    );

comment on policy organizations_select_via_pending_sharing_grant_invitation on public.organizations is
    'Lets an invited-by-email user see the name of the grantor org that '
    'invited them, before they have any membership there -- so the '
    'accept screen can render a real org name rather than a bare id, '
    'same reasoning as organizations_select_via_pending_invitation '
    '(20260828140000).';

-- installations_select_via_pending_sharing_grant_invitation (below) needs
-- to check for a pending sharing_grants row addressed to the caller's
-- email -- but it CANNOT do that via a raw subquery against
-- sharing_grants directly, unlike organizations_select_via_pending_sharing_grant_invitation
-- above. sharing_grants_insert_own_org's own WITH CHECK (2.,
-- 20260829260000) already reads installations directly (an uncached
-- `exists (select ... from installations ...)`, not a SECURITY DEFINER
-- helper) to verify installation ownership -- so a plain INSERT into
-- sharing_grants triggers installations' own SELECT RLS, and if THAT
-- policy in turn reads sharing_grants directly, Postgres has to
-- re-evaluate sharing_grants' RLS while already in the middle of
-- evaluating it for the very same INSERT statement. This is not a
-- theoretical concern: a raw subquery version of the policy below was
-- tried first and reproduced "infinite recursion detected in policy for
-- relation sharing_grants" (SQLSTATE 42P17) on every single INSERT into
-- sharing_grants -- direct-grant or bootstrap alike, breaking even the
-- already-shipped 20260829260000 direct-grant path, not just this
-- migration's own new bootstrap path. Found and fixed by actually
-- running the migration and issuing a grant against it, not by static
-- review alone.
--
-- The fix is the same one this codebase already uses everywhere a
-- policy needs to read a DIFFERENT RLS-protected table without risking
-- exactly this kind of cross-table cycle: a SECURITY DEFINER helper
-- function (app.user_org_ids(), app.organization_exists(),
-- app.user_is_admin_or_owner_of() are all the same shape) that reads
-- sharing_grants as the function owner, bypassing sharing_grants' own
-- RLS entirely rather than re-triggering it.
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
          and sg.invited_email is not null
          and lower(sg.invited_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    );
$$;

comment on function app.installation_has_pending_sharing_grant_invitation(uuid) is
    'SECURITY DEFINER so installations_select_via_pending_sharing_grant_invitation '
    'below can check for a pending sharing_grants row without re-triggering '
    'sharing_grants'' own RLS -- see this migration''s header comment on '
    'that policy for why a raw subquery here causes real infinite '
    'recursion (42P17) on every sharing_grants INSERT, not just a '
    'theoretical risk.';

create policy installations_select_via_pending_sharing_grant_invitation
    on public.installations
    for select
    to authenticated
    using (
        app.installation_has_pending_sharing_grant_invitation(installations.id)
    );

comment on policy installations_select_via_pending_sharing_grant_invitation on public.installations is
    'Lets an invited-by-email user see the name/country of the '
    'installation a pending grant would share, before acceptance -- same '
    'reasoning as organizations_select_via_pending_sharing_grant_invitation '
    'above. Read-only, and strictly narrower than '
    'app.user_shared_installation_ids() (which requires status = '
    '''ACTIVE''): a pending, not-yet-accepted invite never grants access '
    'to any emission_data, only to the installation''s own identifying '
    'columns. Routed through app.installation_has_pending_sharing_grant_invitation() '
    '(SECURITY DEFINER) rather than a raw subquery against sharing_grants '
    '-- see that function''s own comment for why a raw subquery causes '
    'real infinite recursion on every sharing_grants INSERT.';


-- ============================================================
-- 5. ACCEPT SHARING GRANT INVITATION (SECURITY DEFINER RPC)
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

    select email
    into v_user_email
    from auth.users
    where auth.users.id = auth.uid();

    select sg.*
    into v_grant
    from public.sharing_grants sg
    where sg.id = p_grant_id;

    if v_grant.id is null then
        return query select 'NOT_FOUND'::text, null::uuid;
        return;
    end if;

    -- 2026-08-29 (mandatory review, should-fix, independently confirmed):
    -- return null::uuid, not v_grant.grantee_org_id -- this branch fires
    -- before any authorization check (only existence is confirmed above),
    -- so returning the real value let ANY authenticated caller holding a
    -- grant id they have no relationship to learn which org currently
    -- holds access under it, a fact no SELECT policy would ever disclose
    -- to them. acceptSharingGrantInvitation (manage-sharing-grants.ts)
    -- already discards result_org_id on this branch, so this is a free
    -- fix -- every other pre-authorization rejection below already
    -- returns null::uuid; this was the one exception.
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

    -- 2026-08-29 (mandatory review, should-fix, independently confirmed):
    -- CAS guard added (`and sg.status = 'INVITED'`) -- without it, a
    -- concurrent revoke landing between the plain SELECT above and this
    -- UPDATE would be silently overwritten REVOKED -> EXPIRED, leaving
    -- the row and the revoke's own audit event disagreeing about why
    -- access ended. Same reasoning as the accept CAS UPDATE below, which
    -- already had this guard -- this branch was the one exception.
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

    if not exists (
        select 1
        from public.memberships m
        where m.org_id = p_org_id
          and m.user_id = auth.uid()
    ) then
        return query select 'NOT_A_MEMBER'::text, null::uuid;
        return;
    end if;

    -- CAS guard (.status = 'INVITED') -- same reasoning as
    -- acceptSharingGrant's own comment in manage-sharing-grants.ts: without
    -- it, a concurrent revoke between the fetch above and this UPDATE
    -- would silently update zero rows rather than actually accepting.
    --
    -- 2026-08-29 (mandatory review, should-fix, independently confirmed):
    -- wrapped in an exception handler. sharing_grants_installation_grantee_active_uq
    -- (20260829260000) is keyed on (installation_id, grantee_org_id) --
    -- a bootstrap row's grantee_org_id is NULL (hence never colliding)
    -- right up until THIS UPDATE resolves it for the first time, which is
    -- exactly when a collision with an already-live grant for the same
    -- (installation, org) pair materializes (e.g. two colleagues at the
    -- same importer both invited to the same installation, or a bootstrap
    -- invite issued alongside an already-accepted direct grant to the
    -- same org). Previously this raised a raw 23505 out of the function,
    -- which the application layer collapsed to NOT_FOUND -- "That
    -- invitation could not be found" -- a permanent, misleading dead end
    -- for a genuinely valid invitation. Mapped to a dedicated
    -- ALREADY_GRANTED status instead, matching this codebase's own
    -- established pattern for exactly this class of collision (see
    -- inviteMember's 23505 -> ALREADY_PENDING handling,
    -- src/application/organizations/invitations.ts).
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
    'accept_organization_invitation (20260828130000). Atomically validates '
    '(found; addressed to the caller''s own authenticated email via '
    'auth.users, same lookup accept_organization_invitation uses -- not '
    'auth.jwt(), which the RLS policies above use instead; INVITED; '
    'unexpired if expires_at is set; not a self-grant; caller is actually '
    'a member of p_org_id) then flips the row to ACTIVE and resolves '
    'grantee_org_id in one CAS UPDATE. The audit event '
    '(sharing_grant.accepted -- same event type issueSharingGrant''s '
    'direct-accept path already uses, not a new one) is recorded by the '
    'caller (acceptSharingGrantInvitation, '
    'src/application/sharing/manage-sharing-grants.ts) via recordAuditEvent '
    'AFTER this RPC reports OK, not inside this function -- see '
    'recordAuditEvent''s own doc comment for why a bare client-side audit '
    'insert is safe and preferred over embedding one in every RPC. '
    'p_org_id is caller-supplied and therefore untrusted input -- see '
    'this migration''s header comment for why the membership/self-grant '
    'checks above are required defense-in-depth, not redundant '
    'belt-and-braces. Returns ALREADY_GRANTED (2026-08-29) when the '
    'accept CAS UPDATE collides with sharing_grants_installation_grantee_active_uq '
    '-- an already-live grant for the same (installation, accepting org) '
    'pair -- rather than letting the raw unique-violation propagate.';

revoke all on function public.accept_sharing_grant_invitation(uuid, uuid) from public;
grant execute on function public.accept_sharing_grant_invitation(uuid, uuid) to authenticated;


-- ============================================================
-- END OF MIGRATION
-- ============================================================
