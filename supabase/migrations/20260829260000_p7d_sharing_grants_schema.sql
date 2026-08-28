-- ============================================================
-- Snowkap CBAM
-- P7-D: sharing_grants schema -- cross-organization producer ->
-- importer data sharing
--
-- Purpose:
--   The product schema for the P7-D slice (docs/plans/MASTER_PLAN.md
--   §38's P7 contract, §9: "Shared Data / Relationship Model" -- a
--   grant is installation-scoped, read-only, and confers access only
--   to that installation's ACTIVE + VERIFIED EmissionData, never a
--   blanket organization relationship, never write access). Mirrors
--   the domain types already established in P1-E:
--     src/domain/sharing/types.ts (SharingGrant, SharingGrantStatus)
--     src/domain/sharing/grant-lifecycle.ts
--       (transitionSharingGrant -- already implemented and tested,
--       9 tests in grant-lifecycle.test.ts)
--   This migration is scoped to ONLY sharing_grants + the two SELECT-
--   RLS extensions it requires on installations/emission_data.
--
-- Scope of THIS migration -- direct-grant case ONLY:
--   src/domain/sharing/types.ts's SharingGrant.grantee_org_id is
--   `OrganizationId | null` and invited_email is `string | null`,
--   because a FUTURE slice will let a producer invite an importer by
--   email when the importer isn't yet a known Snowkap org (the
--   "bootstrap" path: grantee_org_id starts null, invited_email
--   carries the address, and accepting the invite is what resolves
--   grantee_org_id for the first time -- exactly the shape
--   transitionSharingGrant's ACCEPT action already supports, passing
--   granteeOrgId in as an argument rather than assuming the row
--   already has one).
--
--   THIS migration does NOT build that bootstrap path -- both orgs
--   are already Snowkap customers for every grant this slice creates,
--   so grantee_org_id is always populated by the application layer at
--   INSERT time and invited_email is always NULL. The
--   sharing_grants_invited_email_deferred_ck CHECK constraint below
--   enforces that (a real value would silently imply a bootstrap
--   invite is in flight, which nothing in this slice sends the email
--   for -- same "don't build a capability half-way" posture
--   suppliers.linked_installation_ids' deferred-FK comment documents
--   in 20260829220000). A later slice removes that CHECK, adds the
--   email-sending path (application-layer, Supabase Auth admin API,
--   same reasoning as 20260828130000's own "Deliberately NOT in scope
--   here" section for invitation emails), and teaches
--   acceptSharingGrant's caller to resolve grantee_org_id for the
--   first time instead of merely re-confirming an existing value.
--
-- Table shape:
--   No denormalized org_id column (unlike installations/emission_data)
--   -- sharing_grants is inherently two-sided (grantor_org_id,
--   grantee_org_id), so there is no single "owning org" to denormalize
--   from a parent the way installations.org_id mirrors operators.org_id.
--   installation_id is still a real FK to installations (cascade on
--   delete, matching every other child-of-installation/operator FK in
--   this schema).
--
-- app.organization_exists(): why a SECURITY DEFINER helper, not a bare
-- `exists (select 1 from public.organizations o where o.id = ...)`,
-- for the INSERT policy's "grantee_org_id is a real org" check:
--   A plain EXISTS subquery against `organizations` inside
--   sharing_grants_insert_own_org's WITH CHECK would run under the
--   CALLING role's own privileges -- and is therefore subject to
--   organizations' OWN row level security
--   (organizations_select_own_org, 20260828070000: "id in (select
--   app.user_org_ids())"). The grantor is, by construction, NOT a
--   member of the grantee org (that is the entire point of a cross-org
--   grant) -- so a bare EXISTS here would ALWAYS evaluate false for
--   every legitimate cross-org grant, since RLS would hide the
--   grantee's own organizations row from the grantor's view before the
--   EXISTS ever gets to compare ids. This is exactly the same class of
--   problem app.user_org_ids() (20260828070000) and
--   app.user_is_admin_or_owner_of() (20260828110000) already exist to
--   solve for memberships -- confirmed live below (not assumed) by
--   proving a real cross-org INSERT succeeds only once this helper is
--   used, not with a bare EXISTS. A plain foreign key
--   (grantee_org_id references organizations(id)) is *also* present on
--   the column below and, per Postgres's own documented RLS behavior,
--   FK referential-integrity checks always bypass row security -- so
--   the FK alone already guarantees grantee_org_id is a real row. The
--   SECURITY DEFINER helper is added anyway so the INSERT policy stays
--   self-documenting and independently reviewable without requiring a
--   reader to already know that particular FK-vs-RLS subtlety, and so
--   the rejection happens as a clean RLS denial rather than a raw FK
--   constraint-violation error.
--
-- Two RLS UPDATE policies (revoke, accept), and WHY bare policies
-- suffice here -- unlike P7-B's emission_data verification gate:
--   emission_data needed a BEFORE UPDATE trigger for its ADMIN+ gate
--   (20260829230000's header comment) because a bare WITH CHECK cannot
--   distinguish "verification_status is RESTING at VERIFIED from a
--   past VERIFY" from "verification_status is being SET to VERIFIED
--   right NOW" -- and a plain MEMBER has other, unrelated, legitimate
--   reasons to UPDATE a row that is already resting at VERIFIED
--   (ACTIVATE, DISCARD), so a naive "new.verification_status =
--   VERIFIED => require admin" check would incorrectly block those.
--
--   sharing_grants does NOT have that shape, for both of its two
--   UPDATE policies:
--     - REVOKE (grantor ADMIN+, any non-terminal status -> REVOKED):
--       REVOKED is terminal (like shipments' LOCKED,
--       20260829090000). The USING clause already excludes rows whose
--       status is already REVOKED/EXPIRED, so within the rows this
--       policy can even attempt to touch, "new row status = REVOKED"
--       can only mean "this UPDATE IS the revoke transition" -- the
--       exact same reasoning shipments_update_own_org_not_terminal's
--       own comment gives for why LOCK is safe as a bare policy.
--     - ACCEPT (grantee org member, INVITED -> ACTIVE): the USING
--       clause restricts this policy to rows currently INVITED. Unlike
--       emission_data's MEMBER role, a grantee-org member has NO OTHER
--       sanctioned UPDATE action on a sharing_grants row at all -- accept
--       is the only thing this policy exists for, so there is no
--       "unrelated legitimate UPDATE that happens to leave the row
--       resting at ACTIVE" case to worry about conflating with a real
--       accept. Given old.status = INVITED (USING) and
--       new.status = ACTIVE (WITH CHECK), the only transition in
--       transitionSharingGrant's own state machine that goes
--       INVITED -> ACTIVE is ACCEPT, so this pair of clauses uniquely
--       identifies the accept transition without needing to see the
--       pre-update row inside the check itself.
--     - Cross-policy composition was also checked (Postgres OR-combines
--       ALL applicable policies' USING clauses together, and separately
--       OR-combines ALL applicable policies' WITH CHECK clauses
--       together, for the same command -- these are not evaluated as
--       matched USING/WITH-CHECK pairs per policy). A grantor admin
--       (passes the revoke policy's USING on an INVITED row) cannot
--       smuggle an accept-shaped UPDATE (new.status = ACTIVE) past the
--       accept policy's WITH CHECK, because that WITH CHECK
--       independently re-checks
--       `grantee_org_id in (select app.user_org_ids())` -- true only if
--       the caller is ALSO a member of the grantee org, in which case
--       they already legitimately hold accept authority via their own
--       membership there, not via anything borrowed from the grantor
--       policy. Symmetric argument holds for a grantee member attempting
--       to smuggle a revoke-shaped UPDATE past the revoke policy's WITH
--       CHECK (`app.user_is_admin_or_owner_of(grantor_org_id)`).
--       Live-verified below (required adversarial test (d)/(e)), not
--       assumed correct from this reasoning alone.
--
--   Neither bare policy's WITH CHECK pins grantor_org_id/
--   grantee_org_id/installation_id/expires_at/etc. unchanged, though --
--   Postgres RLS's WITH CHECK genuinely cannot compare against the
--   pre-update row (confirmed precedent for this exact limitation:
--   memberships_update_admin_or_owner's own comment, 20260828110000).
--   Without a separate guard, either bare policy could be exploited to
--   smuggle an unrelated column change (e.g. reassigning
--   installation_id, or extending expires_at) into the same statement
--   as a legitimate revoke/accept. This is a column-tampering concern,
--   NOT the transition-ambiguity concern P7-B's trigger solves --
--   closed the same way 20260829090000 (P4 tenancy hardening) closed
--   the analogous org_id-reassignment gap on shipments/shipment_lines/
--   suppliers: a BEFORE UPDATE trigger
--   (app.prevent_sharing_grant_fact_change) pinning every column except
--   status/updated_at immutable, applied below.
--
-- One non-terminal grant per (installation_id, grantee_org_id):
--   Same partial-unique-index shape as
--   organization_invitations_org_email_pending_uq (20260828130000) --
--   INVITED/ACTIVE are the non-terminal states (mirroring that
--   migration's own PENDING), REVOKED/EXPIRED are terminal and
--   excluded, so re-granting the same installation to the same grantee
--   org after a revocation is allowed (a fresh INVITED row), but two
--   simultaneously-live grants for the same installation+grantee pair
--   are not.
--
-- app.user_shared_installation_ids() and the installations/
-- emission_data SELECT policy extensions:
--   Modeled directly on app.user_org_ids() (20260828070000) -- same
--   SECURITY DEFINER + `set search_path` conventions, needed here for
--   the same class of reason: it is called from INSIDE other tables'
--   (installations, emission_data) RLS policy expressions, and those
--   tables' policies must not depend on the grantee being independently
--   able to read sharing_grants rows outside their own org's view.
--   installations_select_own_org and emission_data_select_own_org
--   (both already applied, 20260829220000 / 20260829230000) are
--   redefined in place via `drop policy` + `create policy` -- the
--   established precedent this codebase already uses for widening a
--   previously-applied policy's own definition (confirmed by grepping
--   `drop policy` across supabase/migrations/:
--   shipments_update_own_org_not_terminal in
--   20260829090000_p4_shipment_tenancy_hardening.sql, and
--   calculation_results_insert_own_org_as_self in
--   20260829200000_p6_calculation_results_hardening.sql both redefine
--   an already-applied policy this same way), rather than adding a
--   second, separate, additively-OR'd policy the way
--   organizations_select_via_pending_invitation
--   (20260828140000) did for a genuinely NEW policy on a column no
--   prior policy referenced at all.
--
--   The emission_data extension is the single most security-critical
--   clause in this migration: a grantee may see ONLY rows where
--   status = 'ACTIVE' AND verification_status = 'VERIFIED', for an
--   installation_id their org holds an ACTIVE grant for -- DRAFT,
--   SUPERSEDED, DISCARDED, UNVERIFIED, VERIFICATION_PENDING, and
--   REJECTED rows must NEVER be visible to a grantee under any
--   circumstance, even while the grant itself is ACTIVE, per master
--   plan §9 ("DRAFT/REJECTED/DISCARDED producer data is never visible
--   to grantees"). Live-verified below (required adversarial test
--   (b)), not assumed.
-- ============================================================


-- ============================================================
-- 1. app.organization_exists() -- see this migration's header comment
-- ============================================================

create or replace function app.organization_exists(
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
        from public.organizations
        where id = p_org_id
    );
$$;

comment on function app.organization_exists(uuid) is
    'SECURITY DEFINER existence check bypassing organizations'' own RLS '
    '(organizations_select_own_org, 20260828070000) -- see this '
    'migration''s header comment for why a bare EXISTS against '
    'organizations, written directly into sharing_grants_insert_own_org''s '
    'WITH CHECK, would incorrectly reject every legitimate cross-org '
    'grant.';

revoke all on function app.organization_exists(uuid) from public;
grant execute on function app.organization_exists(uuid) to authenticated;


-- ============================================================
-- 2. SHARING_GRANTS
-- ============================================================

create table public.sharing_grants (
    id uuid primary key default gen_random_uuid(),

    grantor_org_id uuid not null
        references public.organizations(id)
        on delete cascade,

    -- Null until an email invitation is accepted (the deferred
    -- bootstrap path -- see this migration's header comment). Always
    -- populated at INSERT time in this slice: the INSERT policy below
    -- requires it non-null and a real organization
    -- (app.organization_exists()).
    grantee_org_id uuid
        references public.organizations(id)
        on delete cascade,

    -- Always NULL in this slice -- see this migration's header comment
    -- and sharing_grants_invited_email_deferred_ck below.
    invited_email text,

    installation_id uuid not null
        references public.installations(id)
        on delete cascade,

    status text not null
        default 'INVITED'
        check (
            status in ('INVITED', 'ACTIVE', 'REVOKED', 'EXPIRED')
        ),

    created_by_user_id uuid not null
        references auth.users(id)
        on delete restrict,

    expires_at timestamptz,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint sharing_grants_invited_email_deferred_ck
        check (
            invited_email is null
        ),

    -- A grant to yourself is nonsensical (also rejected at the
    -- application layer, issueSharingGrant) -- kept as a genuine data
    -- invariant here too, not just an authorization concern, so it
    -- holds regardless of which layer writes the row.
    constraint sharing_grants_no_self_grant_ck
        check (
            grantee_org_id is distinct from grantor_org_id
        )
);

comment on table public.sharing_grants is
    'A producer org''s (grantor) read-only, installation-scoped grant of '
    'ACTIVE+VERIFIED EmissionData visibility to an importer org '
    '(grantee). INVITED -> ACTIVE -> REVOKED | EXPIRED -- see '
    'src/domain/sharing/grant-lifecycle.ts (transitionSharingGrant, '
    'already implemented and tested) for the authoritative transition '
    'rules this schema must not contradict. Direct-grant case only in '
    'this slice -- see this migration''s header comment.';

create index sharing_grants_grantor_org_id_idx
    on public.sharing_grants (grantor_org_id);

create index sharing_grants_grantee_org_id_idx
    on public.sharing_grants (grantee_org_id);

create index sharing_grants_installation_id_idx
    on public.sharing_grants (installation_id);

-- One non-terminal (INVITED or ACTIVE) grant per (installation,
-- grantee org) at a time -- see this migration's header comment.
create unique index sharing_grants_installation_grantee_active_uq
    on public.sharing_grants (installation_id, grantee_org_id)
    where status in ('INVITED', 'ACTIVE');


-- ============================================================
-- 3. TRIGGER: column-tampering guard
--
-- See this migration's header comment ("Neither bare policy's WITH
-- CHECK pins ... unchanged") for why this is needed independently of
-- the accept/revoke transition-ambiguity reasoning above -- it mirrors
-- 20260829090000's app.prevent_org_id_change (P4 tenancy hardening),
-- generalized to every non-lifecycle column on this table, the same
-- shape app.prevent_emission_data_fact_change (20260829230000) already
-- uses for emission_data.
-- ============================================================

create or replace function app.prevent_sharing_grant_fact_change()
returns trigger
language plpgsql
as $$
begin
    if new.grantor_org_id is distinct from old.grantor_org_id
        or new.grantee_org_id is distinct from old.grantee_org_id
        or new.invited_email is distinct from old.invited_email
        or new.installation_id is distinct from old.installation_id
        or new.created_by_user_id is distinct from old.created_by_user_id
        or new.expires_at is distinct from old.expires_at
        or new.created_at is distinct from old.created_at
    then
        raise exception
            'sharing_grants: only status and updated_at may change via UPDATE -- see src/application/sharing/manage-sharing-grants.ts';
    end if;

    return new;
end;
$$;

comment on function app.prevent_sharing_grant_fact_change() is
    'BEFORE UPDATE guard: rejects any UPDATE that changes a column '
    'other than status/updated_at on sharing_grants -- see this '
    'migration''s header comment. NOTE: a future slice building the '
    'email-invitation bootstrap path will need to relax the '
    'grantee_org_id clause here (that path''s ACCEPT legitimately sets '
    'grantee_org_id for the FIRST time, going null -> a real org) the '
    'same way 20260829240000 (P7-C) relaxed evidence_file_ids on '
    'app.prevent_emission_data_fact_change -- not needed in this slice, '
    'where grantee_org_id is always already populated before any UPDATE '
    'this trigger could see.';

create trigger sharing_grants_prevent_fact_change_trg
    before update on public.sharing_grants
    for each row
    execute function app.prevent_sharing_grant_fact_change();


-- ============================================================
-- 4. ROW LEVEL SECURITY -- sharing_grants
-- ============================================================

alter table public.sharing_grants
    enable row level security;

create policy sharing_grants_select_grantor_or_grantee
    on public.sharing_grants
    for select
    to authenticated
    using (
        grantor_org_id in (select app.user_org_ids())
        or grantee_org_id in (select app.user_org_ids())
    );

-- ADMIN+ of the grantor org only. Cross-parent validation mirrors
-- installations_insert_own_org's own EXISTS clause (20260829220000):
-- the referenced installation_id must actually belong to the SAME
-- grantor_org_id being denormalized onto this row. grantee_org_id must
-- be a real, different organization -- see this migration's header
-- comment for why app.organization_exists() is required here instead
-- of a bare EXISTS.
create policy sharing_grants_insert_own_org
    on public.sharing_grants
    for insert
    to authenticated
    with check (
        app.user_is_admin_or_owner_of(grantor_org_id)
        and grantee_org_id is not null
        and app.organization_exists(grantee_org_id)
        and exists (
            select 1
            from public.installations i
            where i.id = sharing_grants.installation_id
              and i.org_id = sharing_grants.grantor_org_id
        )
    );

-- REVOKE: only the grantor's ADMIN+ may transition a non-terminal
-- grant to REVOKED. See this migration's header comment for why a bare
-- policy (no trigger) safely expresses this.
create policy sharing_grants_update_grantor_revoke
    on public.sharing_grants
    for update
    to authenticated
    using (
        app.user_is_admin_or_owner_of(grantor_org_id)
        and status not in ('REVOKED', 'EXPIRED')
    )
    with check (
        app.user_is_admin_or_owner_of(grantor_org_id)
        and status = 'REVOKED'
    );

-- ACCEPT: any MEMBER (not ADMIN+-restricted -- accepting is not itself
-- a privileged escalation the way issuing/revoking a producer's own
-- data access is, per docs/plans/MASTER_PLAN.md §27 screen 31) of the
-- grantee org may transition an INVITED grant to ACTIVE. See this
-- migration's header comment for why a bare policy (no trigger) safely
-- expresses this.
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
    );

-- No DELETE policy: revocation is a status flip (REVOKE), never a
-- delete -- matches every other lifecycle table in this schema
-- (shipments' VOID, emission_data's DISCARD).


-- ============================================================
-- 5. app.user_shared_installation_ids()
-- ============================================================

create or replace function app.user_shared_installation_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
    select installation_id
    from public.sharing_grants
    where status = 'ACTIVE'
      and grantee_org_id in (select app.user_org_ids())
      and (expires_at is null or expires_at > now());
$$;

comment on function app.user_shared_installation_ids() is
    'Installation IDs for which the current authenticated user''s org '
    '(via app.user_org_ids()) holds an ACTIVE, unexpired sharing_grants '
    'row as grantee. Modeled on app.user_org_ids() (20260828070000) -- '
    'same SECURITY DEFINER + search_path conventions, announced by that '
    'function''s own comment as the next helper this schema would need. '
    'Used by installations_select_own_org and emission_data_select_own_org '
    'below to admit a grantee''s read access; NOT exposed for any write '
    'policy anywhere in this schema (grants are read-only by design, '
    'master plan §9). The expires_at check is a real, live boundary, not '
    'defensive dead code: issueSharingGrant (src/application/sharing/'
    'manage-sharing-grants.ts) accepts and persists an optional '
    'expiresAt today, but nothing in this slice runs the EXPIRE '
    'transition (transitionSharingGrant''s own EXPIRE action, '
    'src/domain/sharing/grant-lifecycle.ts) automatically -- no cron/'
    'scheduled job exists yet. Without this clause, a grant whose '
    'expires_at has passed would keep conferring read access '
    'indefinitely as long as its status column happens to still read '
    'ACTIVE, silently contradicting the "optional expiry" the domain '
    'model and the application layer both already expose. The `> now()` '
    'boundary (strict, not >=) mirrors transitionSharingGrant''s own '
    'EXPIRE guard exactly (`grant.expires_at > action.now` => '
    'NOT_YET_EXPIRED) -- access ends the instant a grant becomes '
    'eligible for EXPIRE, without waiting for that transition to '
    'actually run. A future slice adding a scheduled EXPIRE job keeps '
    'this clause as useful defense in depth (status flips to EXPIRED '
    'for auditability/display; this clause is what actually closes the '
    'read boundary in the meantime and stays correct even if that job '
    'is ever delayed or fails).';

revoke all on function app.user_shared_installation_ids() from public;
grant execute on function app.user_shared_installation_ids() to authenticated;


-- ============================================================
-- 6. INSTALLATIONS: widen SELECT for a grantee org
--
-- Redefines installations_select_own_org (20260829220000) in place --
-- see this migration's header comment for the drop-policy-then-create
-- precedent this follows.
-- ============================================================

drop policy installations_select_own_org on public.installations;

create policy installations_select_own_org
    on public.installations
    for select
    to authenticated
    using (
        org_id in (select app.user_org_ids())
        or id in (select app.user_shared_installation_ids())
    );

comment on policy installations_select_own_org on public.installations is
    'Own org''s installations, plus (P7-D, 20260829260000) any '
    'installation the caller''s org holds an ACTIVE sharing_grants row '
    'for as grantee -- read-only; no INSERT/DELETE policy is widened, '
    'a grantee never gains write access to a shared installation.';


-- ============================================================
-- 7. EMISSION_DATA: widen SELECT for a grantee org -- ACTIVE+VERIFIED
-- ONLY
--
-- Redefines emission_data_select_own_org (20260829230000) in place --
-- see this migration's header comment for both the drop-policy
-- precedent and why this exact clause is the single most security-
-- critical line in this migration.
-- ============================================================

drop policy emission_data_select_own_org on public.emission_data;

create policy emission_data_select_own_org
    on public.emission_data
    for select
    to authenticated
    using (
        entered_by_org_id in (select app.user_org_ids())
        or (
            installation_id in (select app.user_shared_installation_ids())
            and status = 'ACTIVE'
            and verification_status = 'VERIFIED'
        )
    );

comment on policy emission_data_select_own_org on public.emission_data is
    'Own org''s emission_data, plus (P7-D, 20260829260000) a grantee''s '
    'read of ONLY status=ACTIVE AND verification_status=VERIFIED rows '
    'for a shared installation. DRAFT, SUPERSEDED, DISCARDED, '
    'UNVERIFIED, VERIFICATION_PENDING, and REJECTED rows must NEVER be '
    'visible to a grantee under any circumstance, even while the grant '
    'is ACTIVE -- master plan §9 ("DRAFT/REJECTED/DISCARDED producer '
    'data is never visible to grantees"). Read-only; no INSERT/UPDATE '
    'policy is widened, a grantee never gains write access.';


-- ============================================================
-- END OF MIGRATION
-- ============================================================
