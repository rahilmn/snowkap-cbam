-- ============================================================
-- Snowkap CBAM
-- P3 Foundation: organizations, memberships, audit_events
--
-- Purpose:
--   The tenancy-first product schema per
--   docs/plans/MASTER_PLAN.md §12/§13/§38 (P3 contract). Mirrors the
--   domain types already established in P1-E:
--     src/domain/organizations/types.ts (Organization, Membership)
--     src/domain/audit/types.ts (AuditEvent)
--
-- Scope of THIS migration:
--   - organizations, memberships, audit_events tables
--   - org-scoping indexes
--   - app.user_org_ids() -- the membership-driven RLS helper every
--     later product-table policy will build on
--   - SELECT-only RLS policies (org-isolation is the safety-critical,
--     independently-reasoned-about half of the dual-wall model)
--
-- Deliberately NOT in scope here:
--   - INSERT/UPDATE/DELETE policies for organizations/memberships.
--     Onboarding (creating an organization + its first OWNER
--     membership atomically) needs a SECURITY DEFINER RPC, not a bare
--     table policy, to avoid a chicken-and-egg problem (there is no
--     membership yet to authorize against). Until that RPC exists and
--     is live-tested, these tables are service-role-write-only -- the
--     same posture the regulatory tables already have (RLS enabled,
--     zero mutating policies).
--   - "authenticated" SELECT policies on the regulatory tables (also
--     called for in §38's P3 contract). That is a change to the
--     PROTECTED regulatory schema and gets its own isolated migration
--     and commit per CLAUDE.md's protected-zone discipline, not
--     bundled here.
--   - Live RLS verification. This migration has NOT been applied
--     against any database (local or remote) in this session --
--     `supabase start` failed in this environment (Docker Desktop
--     storage-layer instability, unrelated to this SQL) and applying
--     it to the protected regulatory Supabase project is explicitly
--     forbidden for tenancy/RLS experimentation. It must be applied
--     and exercised against a disposable local/staging instance,
--     ideally with the standing two-org isolation test suite (§13),
--     before being treated as verified.
-- ============================================================


-- ============================================================
-- 1. ORGANIZATIONS
-- ============================================================

create table public.organizations (
    id uuid primary key default gen_random_uuid(),

    name text not null,

    slug text not null,

    -- Mirrors OrganizationCapability in src/domain/organizations/types.ts.
    -- An org may hold both capabilities; at least one is required --
    -- an org with zero capabilities is not a coherent state (nothing in
    -- the product would ever let it do anything).
    capabilities text[] not null default '{}',

    eori_number text,

    cbam_declarant_status text not null
        default 'NOT_REGISTERED'
        check (
            cbam_declarant_status in (
                'NOT_REGISTERED',
                'APPLICATION_PENDING',
                'AUTHORISED'
            )
        ),

    -- Reserved for a future capability (indirect customs
    -- representative acting for other importer orgs) -- see the same
    -- field's doc comment in src/domain/organizations/types.ts. Not
    -- used by any code yet; carried here now so a later migration
    -- doesn't need to add a column to a table with live tenant rows.
    acts_as_indirect_representative boolean not null default false,

    -- ISO 3166-1 alpha-2, matching src/domain/shared/country.ts's
    -- parseCountryCode validation.
    country_of_establishment text,

    created_at timestamptz not null default now(),

    constraint organizations_slug_uq
        unique (slug),

    constraint organizations_slug_format_ck
        check (
            slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
        ),

    constraint organizations_capabilities_ck
        check (
            capabilities <@ array['IMPORTER_DECLARANT', 'PRODUCER_OPERATOR']::text[]
            and cardinality(capabilities) > 0
        ),

    constraint organizations_country_format_ck
        check (
            country_of_establishment is null
            or country_of_establishment ~ '^[A-Z]{2}$'
        )
);

comment on table public.organizations is
    'A Snowkap tenant. capabilities determines which of the two primary '
    'experiences (importer/declarant, producer/operator) this org can use '
    '-- see docs/plans/MASTER_PLAN.md §6.';


-- ============================================================
-- 2. MEMBERSHIPS
-- ============================================================

create table public.memberships (
    id uuid primary key default gen_random_uuid(),

    org_id uuid not null
        references public.organizations(id)
        on delete cascade,

    user_id uuid not null
        references auth.users(id)
        on delete cascade,

    role text not null
        check (
            role in ('OWNER', 'ADMIN', 'MEMBER')
        ),

    created_at timestamptz not null default now(),

    constraint memberships_org_user_uq
        unique (org_id, user_id)
);

comment on table public.memberships is
    'user <-> organization link with a role. The last-OWNER-per-org '
    'invariant (never remove/demote the sole OWNER) is enforced by '
    'src/domain/organizations/invariants.ts at the application layer, not '
    'by a DB constraint -- it depends on counting other rows, which a '
    'CHECK constraint cannot express.';

create index memberships_user_id_idx
    on public.memberships (user_id);

create index memberships_org_id_idx
    on public.memberships (org_id);


-- ============================================================
-- 3. AUDIT EVENTS (append-only)
-- ============================================================

create table public.audit_events (
    id uuid primary key default gen_random_uuid(),

    -- null only for SYSTEM-scope events with no owning organization
    -- (e.g. regulatory dataset activation) -- matches AuditEvent's
    -- org_id: OrganizationId | null in src/domain/audit/types.ts.
    org_id uuid
        references public.organizations(id)
        on delete restrict,

    occurred_at timestamptz not null default now(),

    actor_type text not null
        check (
            actor_type in ('USER', 'SYSTEM')
        ),

    actor_user_id uuid
        references auth.users(id)
        on delete restrict,

    event_type text not null,

    aggregate_type text not null
        check (
            aggregate_type in (
                'ORGANIZATION',
                'MEMBERSHIP',
                'SHIPMENT',
                'SHIPMENT_LINE',
                'EMISSION_DATA',
                'INSTALLATION',
                'OPERATOR',
                'SUPPLIER',
                'SHARING_GRANT',
                'CALCULATION_RESULT',
                'DECLARATION'
            )
        ),

    aggregate_id text not null,

    payload jsonb not null default '{}'::jsonb,

    correlation_id text,

    constraint audit_events_actor_consistency_ck
        check (
            (actor_type = 'USER' and actor_user_id is not null)
            or
            (actor_type = 'SYSTEM' and actor_user_id is null)
        )
);

comment on table public.audit_events is
    'Append-only. No update/delete grants or policies are ever added to '
    'this table -- immutability is enforced by absence, not a trigger, '
    'matching docs/plans/MASTER_PLAN.md §21.';

create index audit_events_org_aggregate_occurred_idx
    on public.audit_events (org_id, aggregate_type, aggregate_id, occurred_at);


-- ============================================================
-- 4. RLS HELPER FUNCTIONS
-- ============================================================

create schema if not exists app;

-- SECURITY DEFINER: RLS policies on memberships/organizations/etc. call
-- this to check org membership, which requires reading `memberships`
-- itself -- without SECURITY DEFINER that read would be subject to
-- memberships' own RLS policies (which are defined in terms of this
-- function), an unresolvable chicken-and-egg recursion. search_path is
-- pinned explicitly (defense against search_path-based function
-- hijacking in a SECURITY DEFINER context -- a well-known Postgres
-- footgun for exactly this function shape).
create or replace function app.user_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
    select org_id
    from public.memberships
    where user_id = auth.uid();
$$;

comment on function app.user_org_ids() is
    'Organization IDs the current authenticated user (auth.uid()) belongs '
    'to, via any role. The base helper every org-scoped RLS SELECT policy '
    'in this migration builds on; future sharing-grant policies (§9) will '
    'need a second, analogous app.user_shared_installation_ids() helper.';

revoke all on function app.user_org_ids() from public;
grant execute on function app.user_org_ids() to authenticated;


-- ============================================================
-- 5. ROW LEVEL SECURITY
--
-- SELECT-only for now -- see the migration header comment for why
-- INSERT/UPDATE/DELETE policies are deliberately deferred rather than
-- authored blind. Until those land, these tables are
-- service-role-write-only (the same posture the regulatory tables
-- already have).
-- ============================================================

alter table public.organizations
    enable row level security;

alter table public.memberships
    enable row level security;

alter table public.audit_events
    enable row level security;

create policy organizations_select_own_org
    on public.organizations
    for select
    to authenticated
    using (
        id in (select app.user_org_ids())
    );

create policy memberships_select_own_org
    on public.memberships
    for select
    to authenticated
    using (
        org_id in (select app.user_org_ids())
    );

create policy audit_events_select_own_org
    on public.audit_events
    for select
    to authenticated
    using (
        org_id in (select app.user_org_ids())
    );


-- ============================================================
-- END OF MIGRATION
-- ============================================================
