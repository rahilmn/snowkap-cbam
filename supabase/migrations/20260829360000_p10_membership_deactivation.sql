-- ============================================================
-- Snowkap CBAM
-- P10: membership deactivation lifecycle
--
-- Purpose:
--   docs/plans/MASTER_PLAN.md §14 ("user lifecycle invite -> active ->
--   deactivated -- deactivation severs sessions and memberships
--   without deleting audit identity"). Until now the only offboarding
--   path was removeMember()'s hard DELETE of the memberships row
--   (src/application/organizations/manage-membership.ts). That is the
--   right tool for correcting a genuine mistake (an accidental invite),
--   but the wrong one for normal offboarding: audit_events.actor_user_id
--   references auth.users -- which this product never deletes -- so the
--   historical events survive, but the deleted membership row was the
--   only thing that could ever resolve that actor back to a name on the
--   Audit screen. components/audit/audit-event-view.ts already notes
--   exactly this gap ("a USER actor whose membership has since been
--   [removed]"). A deactivated membership keeps that identity attached
--   while conferring no access whatsoever.
--
-- The single change point:
--   Every org-scoped RLS policy in this schema is written in terms of
--   app.user_org_ids() (20260828070000) or
--   app.user_is_admin_or_owner_of() (20260828110000) -- both are
--   redefined below to skip rows with a non-null deactivated_at, so
--   every table's policy inherits deactivation automatically rather
--   than each being patched separately. app.user_shared_installation_ids()
--   (20260829260000) is built on app.user_org_ids() and therefore
--   inherits it too, without being touched here.
--
--   That inheritance argument only holds for authorization checks that
--   actually go through the two helpers. Grepping `auth.uid()` across
--   supabase/migrations/ found four that do NOT -- each one a place a
--   deactivated member would have kept real authority -- so each is
--   redefined below to route through app.user_org_ids() /
--   app.user_is_admin_or_owner_of() instead of its own raw
--   `exists (select 1 from public.memberships ...)`:
--
--     (1) organizations_update_admin_or_owner (20260828080000) --
--         a raw membership subquery, so a deactivated OWNER could still
--         rename the org and edit its EORI/declarant status/capabilities.
--     (2) public.list_org_members (20260828120000) -- its caller check,
--         so a deactivated member could still enumerate every teammate's
--         email address.
--     (3) public.accept_sharing_grant_invitation (20260829300000) --
--         its NOT_A_MEMBER gate, so a deactivated member could still
--         bind their former org into a new cross-org data-sharing
--         relationship (they would gain no read access themselves --
--         that runs through app.user_shared_installation_ids() ->
--         app.user_org_ids() -- but the org's state would change on
--         their say-so).
--     (4) public.record_shared_data_consumption (20260829310000) --
--         its NOT_A_MEMBER gate, so a deactivated member could still
--         write "your data was consumed" claims into a GRANTOR org's
--         append-only audit stream, which has no UPDATE/DELETE policy
--         by design and therefore no way to retract them.
--
--   Rewriting a whole SECURITY DEFINER function body to fix one
--   membership check is the established move here, not an improvised
--   one: 20260829350000_p9_declaration_filed_membership_and_completeness_fix.sql
--   re-created record_declaration_filed() wholesale for exactly that.
--   The three function bodies below are otherwise byte-identical to
--   their current definitions, review comments included, so a diff
--   against the originals shows only the membership check.
--
--   (5) public.accept_organization_invitation (20260828130000) is
--       redefined too, but for a lifecycle reason rather than an
--       authorization one -- see section 7.
--
-- The last-ACTIVE-OWNER invariant:
--   Still enforced in TypeScript (src/domain/organizations/invariants.ts),
--   not here, for the reason public.memberships' own table comment
--   already gives: it depends on counting other rows, which a CHECK
--   constraint cannot express. A partial unique index cannot express it
--   either (it can forbid a second active OWNER, never require a first),
--   and duplicating it in a PL/pgSQL trigger is what
--   20260828110000's header comment already rejected as "risks the two
--   definitions drifting". So there is deliberately no DB-level
--   constraint added here -- the split is the same one this schema uses
--   for role changes and removal: RLS answers "may this caller modify
--   this row at all", TypeScript answers "would the result leave the
--   org without an owner".
--
--   deactivateMembership's arrival does change the TypeScript side of
--   that invariant, though: isLastOwner() counted OWNER rows regardless
--   of state, so an org holding one active OWNER plus one DEACTIVATED
--   OWNER would have let changeMembershipRole/removeMembership strip the
--   active one ("another OWNER exists"), leaving zero owners who can
--   actually do anything. Fixed in the same change as this migration.
--
-- No new memberships UPDATE policy:
--   memberships_update_admin_or_owner (20260828110000) is a row-level,
--   whole-row policy -- `using (app.user_is_admin_or_owner_of(org_id))`
--   with the matching WITH CHECK -- and Postgres table-level column
--   privileges extend to columns added later, so it already authorizes
--   setting and clearing deactivated_at for an ADMIN/OWNER of the row's
--   own org. A second UPDATE policy naming deactivated_at would be OR'd
--   with that one and could therefore only widen access, never narrow
--   it; it is left unwritten on purpose.
--
-- SELECT is deliberately NOT narrowed:
--   memberships_select_own_org still returns deactivated rows to
--   members of that org, so the Team screen can show a "deactivated"
--   state and offer reactivation. Only the two authorization helpers
--   exclude them. list_org_members likewise still LISTS deactivated
--   members (it just no longer serves a deactivated CALLER), and now
--   returns deactivated_at so the screen can tell the two apart.
-- ============================================================


-- ============================================================
-- 1. THE COLUMN
-- ============================================================

alter table public.memberships
    add column deactivated_at timestamptz;

comment on column public.memberships.deactivated_at is
    'Null = active. Non-null = this person is offboarded: the row is '
    'excluded from app.user_org_ids() and '
    'app.user_is_admin_or_owner_of(), so they hold no access anywhere '
    'in the schema, but the row itself survives so audit_events written '
    'by them still resolve to a person. Hard DELETE (removeMember) '
    'remains available for correcting an accidental invite, where there '
    'is no audit identity worth preserving.';

-- app.user_org_ids() runs on essentially every RLS check in this
-- schema, so its lookup gets a dedicated partial index rather than
-- relying on memberships_user_id_idx plus a filter. Column order is
-- (user_id, org_id) so this one index serves both helpers: user_org_ids
-- probes on user_id alone, user_is_admin_or_owner_of on both.
-- memberships_user_id_idx / memberships_org_id_idx are deliberately
-- kept -- they still serve the Team-screen and membership-list reads,
-- which must include deactivated rows and so cannot use this index.
create index memberships_active_user_org_idx
    on public.memberships (user_id, org_id)
    where deactivated_at is null;


-- ============================================================
-- 2. THE TWO AUTHORIZATION HELPERS
--
-- The single change point described in this migration's header.
-- ============================================================

create or replace function app.user_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
    select org_id
    from public.memberships
    where user_id = auth.uid()
      and deactivated_at is null;
$$;

comment on function app.user_org_ids() is
    'Organization IDs the current authenticated user (auth.uid()) '
    'belongs to via any role, EXCLUDING memberships whose '
    'deactivated_at is set (20260829360000) -- a deactivated member '
    'holds no access anywhere, and this exclusion is what makes that '
    'true for every table whose RLS is written in terms of this '
    'function, including app.user_shared_installation_ids() '
    '(20260829260000), which is itself defined in terms of it.';

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
          and deactivated_at is null
    );
$$;

comment on function app.user_is_admin_or_owner_of(uuid) is
    'SECURITY DEFINER so a memberships UPDATE/DELETE policy can check '
    'the caller''s own role without recursively re-triggering itself '
    '-- see 20260828110000''s header comment for the infinite-'
    'recursion error this replaced. Excludes deactivated memberships '
    '(20260829360000): a deactivated OWNER must not keep the authority '
    'to edit the organization, manage memberships, issue invitations, '
    'or record a declaration as filed.';


-- ============================================================
-- 3. organizations_update_admin_or_owner -- (1) in the header
--
-- Redefined in place (drop policy + create policy), the established
-- precedent for changing an already-applied policy's own definition:
-- shipments_update_own_org_not_terminal (20260829090000),
-- calculation_results_insert_own_org_as_self (20260829200000), and
-- installations/emission_data_select_own_org (20260829260000) all do
-- this rather than adding a second, additively-OR'd policy -- which
-- here would be actively wrong, since an OR'd policy cannot take away
-- what the original one grants.
--
-- The replacement is not merely equivalent-plus-deactivation: it drops
-- the hand-rolled subquery for the helper the rest of the schema
-- already shares, so the next state added to a membership has one place
-- to be honoured instead of two.
-- ============================================================

drop policy organizations_update_admin_or_owner
    on public.organizations;

create policy organizations_update_admin_or_owner
    on public.organizations
    for update
    to authenticated
    using (
        app.user_is_admin_or_owner_of(id)
    )
    with check (
        app.user_is_admin_or_owner_of(id)
    );

comment on policy organizations_update_admin_or_owner on public.organizations is
    'ADMIN/OWNER members may update their own organization''s row '
    '(name, declarant attributes, capabilities). No cross-row invariant '
    'to enforce here, unlike membership mutations, so a direct policy '
    'is sufficient -- no RPC needed. Routed through '
    'app.user_is_admin_or_owner_of() as of 20260829360000: the original '
    'inlined its own memberships subquery, which meant a deactivated '
    'OWNER kept the ability to rename the org and edit its EORI and '
    'CBAM declarant status.';


-- ============================================================
-- 4. public.list_org_members -- (2) in the header
--
-- Two changes: the caller gate now routes through app.user_org_ids()
-- (so a deactivated member can no longer enumerate teammates' email
-- addresses), and the result gains deactivated_at (so the Team screen
-- can render "deactivated" and offer reactivation). The listing itself
-- is unchanged and still returns deactivated members -- see this
-- migration's header on why SELECT is deliberately not narrowed.
--
-- drop + create rather than create or replace: Postgres cannot change
-- a function's RETURNS TABLE shape in place (42P13, "cannot change
-- return type of existing function").
-- ============================================================

drop function public.list_org_members(uuid);

create function public.list_org_members(
    p_org_id uuid
)
returns table (
    membership_id uuid,
    user_id uuid,
    email text,
    role text,
    created_at timestamptz,
    deactivated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
    -- Table-qualified column references throughout: RETURNS TABLE
    -- implicitly declares user_id/role/deactivated_at/etc. as PL/pgSQL
    -- OUT parameters in scope for the whole function body, which
    -- collide with the identically-named memberships columns --
    -- confirmed live ("column reference 'user_id' is ambiguous", error
    -- 42702) in a first draft that referenced them unqualified. The
    -- newly-added deactivated_at is the same trap one more time, which
    -- is why the check below reads from app.user_org_ids() rather than
    -- naming the column at all.
    if not exists (
        select 1
        from app.user_org_ids() as caller_org_id
        where caller_org_id = p_org_id
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
            m.created_at,
            m.deactivated_at
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
    'caller having already been authorized elsewhere -- via '
    'app.user_org_ids() as of 20260829360000, so a deactivated member '
    'can no longer enumerate their former teammates'' email addresses. '
    'Deactivated members are still LISTED (with deactivated_at set), '
    'which is what lets the Team screen offer reactivation and what '
    'lets the Audit screen keep resolving a departed actor''s events to '
    'a person.';

revoke all on function public.list_org_members(uuid) from public;
grant execute on function public.list_org_members(uuid) to authenticated;


-- ============================================================
-- 5. public.accept_sharing_grant_invitation -- (3) in the header
--
-- Body is byte-identical to 20260829300000's, review comments
-- included, except the NOT_A_MEMBER gate.
--
-- The gate is written as NOT EXISTS over app.user_org_ids() rather than
-- `p_org_id not in (select app.user_org_ids())`: p_org_id is
-- client-supplied and may be null, and `null not in (<non-empty set>)`
-- is NULL, not true -- an `if` on it falls through, which here would
-- mean skipping the membership check entirely. The EXISTS form yields
-- no rows for a null p_org_id and so still rejects, matching the raw
-- `where m.org_id = p_org_id` subquery it replaces.
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

    -- 20260829360000: was a raw `exists (select 1 from
    -- public.memberships m where m.org_id = p_org_id and m.user_id =
    -- auth.uid())`, which counted a DEACTIVATED membership as
    -- membership -- letting an offboarded person still bind their
    -- former org into a new cross-org sharing relationship. Routed
    -- through the same helper the rest of the schema's authorization
    -- goes through instead.
    if not exists (
        select 1
        from app.user_org_ids() as caller_org_id
        where caller_org_id = p_org_id
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


-- ============================================================
-- 6. public.record_shared_data_consumption -- (4) in the header
--
-- Body is byte-identical to 20260829310000's, review comments and its
-- KNOWN GAP note included, except the NOT_A_MEMBER gate.
-- ============================================================

create or replace function public.record_shared_data_consumption(
    p_sharing_grant_id uuid,
    p_installation_id uuid,
    p_emission_data_id uuid,
    p_emission_data_version integer,
    p_shipment_line_id uuid,
    p_determination_kind text
)
returns table(
    result_status text,
    result_audit_event_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_grant public.sharing_grants%rowtype;
    v_audit_event_id uuid;
begin
    if auth.uid() is null then
        raise exception
            'record_shared_data_consumption requires an authenticated caller.';
    end if;

    -- Input-shape validation for a value only ever produced by this
    -- codebase's own call site (never end-user free text) -- a genuine
    -- caller error, not a normal rejection outcome, so this raises
    -- rather than returning a result_status, matching how
    -- accept_sharing_grant_invitation() treats its own "caller is not
    -- even authenticated" precondition.
    if p_determination_kind not in ('DETERMINED', 'REDETERMINED') then
        raise exception
            'record_shared_data_consumption: invalid p_determination_kind %', p_determination_kind;
    end if;

    select sg.*
    into v_grant
    from public.sharing_grants sg
    where sg.id = p_sharing_grant_id;

    if v_grant.id is null then
        return query select 'GRANT_NOT_FOUND'::text, null::uuid;
        return;
    end if;

    -- (a) The core security gate: a stranger org with no relationship
    -- to this grant at all -- and a member of the GRANTOR's own org,
    -- who has no more standing to report a "consumption" than any
    -- other outsider -- must be rejected here, before anything else
    -- about the grant is confirmed to this caller.
    --
    -- 20260829360000: was a raw memberships subquery (deliberately, to
    -- match accept_sharing_grant_invitation()'s own NOT_A_MEMBER check
    -- -- which now moves the same way). Both now route through
    -- app.user_org_ids(), because a DEACTIVATED membership satisfied
    -- the raw subquery: an offboarded grantee-org member could keep
    -- writing "your data was consumed" claims into the GRANTOR org's
    -- append-only audit stream, which by design has no UPDATE or DELETE
    -- policy and therefore no way to retract them.
    if v_grant.grantee_org_id is null or not exists (
        select 1
        from app.user_org_ids() as caller_org_id
        where caller_org_id = v_grant.grantee_org_id
    ) then
        return query select 'NOT_A_MEMBER'::text, null::uuid;
        return;
    end if;

    -- (b) A REVOKED/EXPIRED/still-INVITED grant never conferred (or no
    -- longer confers) real read access -- see 20260829310000's header
    -- comment.
    --
    -- 2026-08-29 (mandatory review, should-fix, independently
    -- confirmed live): also check expires_at, not just status. This
    -- table has no scheduled EXPIRE job (app.user_shared_installation_ids()'s
    -- own comment, 20260829260000, is explicit about that), so
    -- status='ACTIVE' with a long-past expires_at is a normal,
    -- long-lived state here, not a transient one -- exactly the state
    -- app.user_shared_installation_ids() itself already excludes via
    -- its own `(expires_at is null or expires_at > now())` clause. This
    -- check now matches that clause exactly, so a grantee whose read
    -- access has already lapsed can no longer keep writing "your data
    -- was consumed" into the grantor's audit stream after the fact --
    -- reproduced live before this fix: a lapsed grantee's own SELECT
    -- against the shared installation/emission_data already correctly
    -- returned [], while this RPC still returned OK.
    if v_grant.status <> 'ACTIVE'
        or (v_grant.expires_at is not null and v_grant.expires_at <= now())
    then
        return query select 'GRANT_NOT_ACTIVE'::text, null::uuid;
        return;
    end if;

    -- (b, continued) The grant must genuinely name the installation
    -- the caller claims -- a member of the grantee org holding one
    -- ACTIVE grant must not be able to report a consumption event
    -- against an installation covered by a DIFFERENT grant (e.g. one
    -- already REVOKED, or one that never existed).
    if v_grant.installation_id <> p_installation_id then
        return query select 'INSTALLATION_MISMATCH'::text, null::uuid;
        return;
    end if;

    -- (c) The emission_data row genuinely exists, under this same
    -- installation, at exactly the claimed version, AND is genuinely
    -- readable by this grantee -- a caller cannot fabricate a
    -- nonexistent id or a mismatched version number into the grantor's
    -- own audit trail.
    --
    -- 2026-08-29 (mandatory review, should-fix, independently confirmed
    -- live): the original check omitted `status = 'ACTIVE' and
    -- verification_status = 'VERIFIED'` -- exactly the pair
    -- emission_data_select_own_org (20260829260000) itself calls "the
    -- single most security-critical clause in this migration". Without
    -- it, a grantee could report a genuine-looking consumption event
    -- for a DRAFT/UNVERIFIED/REJECTED/DISCARDED/SUPERSEDED row they can
    -- never actually SELECT under RLS -- reproduced live: the grantee's
    -- own SELECT against a DRAFT row returned [], while this RPC still
    -- returned OK, writing a false "this was consumed" claim into the
    -- grantor's audit trail for data the grantee could not read. Now
    -- matches the exact ACTIVE+VERIFIED gate every other cross-org read
    -- of this table already enforces.
    if not exists (
        select 1
        from public.emission_data ed
        where ed.id = p_emission_data_id
          and ed.installation_id = v_grant.installation_id
          and ed.version = p_emission_data_version
          and ed.status = 'ACTIVE'
          and ed.verification_status = 'VERIFIED'
    ) then
        return query select 'EMISSION_DATA_MISMATCH'::text, null::uuid;
        return;
    end if;

    -- (d) The shipment_line genuinely belongs to the same grantee org
    -- the membership check above already confirmed the caller is a
    -- member of -- a caller cannot point this event at a line under
    -- another org entirely.
    --
    -- KNOWN GAP, WORTH-TRACKING, NOT FIXED HERE (mandatory review,
    -- 2026-08-29, live-reproduced): this check does not read
    -- sl.emission_determination at all, so it never confirms the line
    -- was actually determined from p_emission_data_id/p_emission_data_version
    -- via p_sharing_grant_id -- only that the line exists and belongs to
    -- the grantee org. There is also no uniqueness constraint, CAS, or
    -- rate limit on this RPC. Confirmed live: three identical calls
    -- against a shipment_line with NO emission_determination at all each
    -- returned a distinct OK + a new audit_events row, leaving fabricated
    -- "data_consumed" entries in the grantor's own append-only audit log
    -- (which has no UPDATE/DELETE policy by design) that the grantor
    -- cannot read is fabricated (PROBE7 in the review: the grantee's own
    -- SELECT against the grantor's audit_events already correctly
    -- returns []). Bounded -- only a genuine member of an ACTIVE,
    -- unexpired grant can do this, not a stranger -- which is why this
    -- is tracked rather than blocking; not fixed in this pass because a
    -- real fix (matching sl.emission_determination's own JSONB payload
    -- against the claimed emission_data_id/version/sharing_grant_id, or
    -- adding a genuine idempotency key) is more surface than a review-
    -- response pass should improvise. Whoever builds screen 32 further,
    -- or a future review, should treat a sharing_grant.data_consumed
    -- event as an unverified claim from the grantee, not proof, until
    -- this is closed.
    if not exists (
        select 1
        from public.shipment_lines sl
        where sl.id = p_shipment_line_id
          and sl.org_id = v_grant.grantee_org_id
    ) then
        return query select 'SHIPMENT_LINE_NOT_FOUND'::text, null::uuid;
        return;
    end if;

    insert into public.audit_events (
        org_id,
        actor_type,
        actor_user_id,
        event_type,
        aggregate_type,
        aggregate_id,
        payload
    ) values (
        v_grant.grantor_org_id,
        'USER',
        auth.uid(),
        'sharing_grant.data_consumed',
        'SHARING_GRANT',
        v_grant.id::text,
        jsonb_build_object(
            'installation_id', v_grant.installation_id,
            'emission_data_id', p_emission_data_id,
            'emission_data_version', p_emission_data_version,
            'consuming_org_id', v_grant.grantee_org_id,
            'shipment_line_id', p_shipment_line_id,
            'determination_kind', p_determination_kind
        )
    )
    returning id into v_audit_event_id;

    return query select 'OK'::text, v_audit_event_id;
end;
$$;


-- ============================================================
-- 7. public.accept_organization_invitation -- (5) in the header
--
-- Not an authorization fix -- this one is a lifecycle dead end that
-- deactivation creates and that must be closed in the same change that
-- creates it.
--
-- memberships_org_user_uq (20260828070000) is on (org_id, user_id) with
-- no deactivated_at in the key, so a deactivated person re-invited to
-- the org they were offboarded from still has a row, and the INSERT
-- below would raise 23505. The existing `exists (...)` guard happens to
-- prevent that -- but it does so by classifying them ALREADY_MEMBER,
-- marking the invitation ACCEPTED, and returning them to a Snowkap they
-- still cannot see anything in. The invitation is consumed and the
-- person is no better off.
--
-- Reactivating them here instead was considered and rejected: the
-- invitation carries a role (InvitableRole, ADMIN or MEMBER), the
-- deactivated row carries whatever role they held before -- possibly
-- OWNER -- and silently restoring the OLD role on the strength of a
-- MEMBER invite is a privilege escalation, while silently overwriting
-- it with the invite's role is a demotion nobody asked for. Neither is
-- something an invite-acceptance path should decide on its own.
--
-- So: report MEMBERSHIP_DEACTIVATED and leave the invitation PENDING.
-- No state changes, the invite survives for after an admin reactivates
-- them (or removes the old row outright), and reactivation stays where
-- master plan §14 puts it -- an explicit, audited admin action.
--
-- Everything else in this body is byte-identical to 20260828130000's.
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

    -- The whole row, not an `exists`, so the deactivated case below can
    -- be told apart from the genuinely-still-a-member one.
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


-- ============================================================
-- END OF MIGRATION
-- ============================================================
