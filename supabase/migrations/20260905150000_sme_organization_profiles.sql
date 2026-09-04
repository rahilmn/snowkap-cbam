-- ============================================================
-- Snowkap CBAM SME Experience -- S1
-- organization_profiles: personalisation input only.
--
-- Sectors an org has told Snowkap it works in, and whether it has
-- finished the onboarding "setup" step. Never an authorisation input
-- (hasCapability/hasAdminAccess are untouched -- this table is not
-- consulted by any RLS policy anywhere else) and never a calculation
-- input (no domain calculation reads this table; the layering test's
-- own rules already forbid src/domain/calculations/** importing
-- anything outside src/domain). A stale or wrong sector list can at
-- most mis-shape a suggestion; it can never hide a workflow, gate a
-- route, or change a figure.
--
-- Leaf table: no policy anywhere else references organization_profiles,
-- and organization_profiles references nothing but organizations(id).
-- Standard CRUD RLS (app.user_org_ids() / app.user_is_admin_or_owner_of),
-- no REVOKE, so -- confirmed against every other leaf table in this
-- schema (operators, installations, organization_invitations) -- no
-- app.privilege_invariants row is needed; only tables carrying a
-- deliberate REVOKE a blanket restore-time grant could silently undo
-- register there (see 20260903230000_p14_privilege_invariants.sql and
-- 20260905090000_p14_app_session_store.sql for the two existing
-- examples, both service-role-only tables -- not this shape).
-- ============================================================

create table public.organization_profiles (
    org_id uuid primary key
        references public.organizations(id)
        on delete cascade,

    -- Canonical sector enum, mirroring cbam_goods.sector (the
    -- regulatory dataset's own vocabulary) -- ELECTRICITY is a real
    -- member of that enum but the application refuses it at the zod
    -- layer for v1 (no default values are loaded for electricity);
    -- rejecting it here too, at the database, would make a future
    -- product decision to allow it a migration instead of a config
    -- change, which is not this table's job to force.
    sectors text[] not null default '{}'
        check (
            sectors <@ array[
                'CEMENT', 'FERTILISERS', 'IRON_STEEL',
                'ALUMINIUM', 'HYDROGEN', 'ELECTRICITY'
            ]::text[]
        ),

    -- Set once sectors is first made non-empty through the product
    -- (the onboarding-setup upsert); read by guidance's "finish setup"
    -- item. Nullable, not a boolean -- the timestamp is itself useful
    -- (when did this org finish setup) and "null" is already exactly
    -- "not done", so a separate boolean would be a second source of
    -- truth for the same fact.
    onboarding_completed_at timestamptz,

    updated_at timestamptz not null default now(),

    -- Pinned by the trigger below, never trusted from the client --
    -- same "structurally impossible to forge" posture audit_events'
    -- actor_user_id and emission_data's verifier_user_id already have.
    updated_by_user_id uuid
        references auth.users(id)
        on delete set null
);

comment on table public.organization_profiles is
    'Self-declared sectors and onboarding-setup completion for an '
    'organization -- personalisation only. Never consulted by any '
    'RLS policy, hasCapability/hasAdminAccess check, or calculation '
    '-- see this migration''s own header comment. Snowkap CBAM SME '
    'Experience v2.1.1, S1.';

comment on column public.organization_profiles.sectors is
    'Self-declared CBAM sectors this organization works in. Shapes '
    'onboarding suggestions and quick-start ordering only.';

comment on column public.organization_profiles.onboarding_completed_at is
    'Set once sectors is first made non-empty via the onboarding-setup '
    'upsert. Null means "not finished setup", read by the guidance '
    '"finish setup" item -- not a second boolean beside this timestamp.';


-- ------------------------------------------------------------
-- Pin updated_at/updated_by_user_id from every INSERT/UPDATE, same
-- shape as app.touch_updated_at-style triggers elsewhere in this
-- schema, but inlined here (not shared) since this is the first and
-- only table that also needs to pin an actor column alongside the
-- timestamp in the same trigger.
-- ------------------------------------------------------------

create or replace function app.stamp_organization_profile_actor()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    new.updated_at := now();
    new.updated_by_user_id := auth.uid();

    return new;
end;
$$;

comment on function app.stamp_organization_profile_actor() is
    'BEFORE INSERT OR UPDATE: pins updated_at/updated_by_user_id from '
    'the server clock and auth.uid(), never the caller''s claimed '
    'value -- 20260905150000_sme_organization_profiles.sql.';

create trigger organization_profiles_stamp_actor_trg
    before insert or update
    on public.organization_profiles
    for each row
    execute function app.stamp_organization_profile_actor();


-- ------------------------------------------------------------
-- RLS. Read: own org. Write: ADMIN+ of that org, matching
-- organizations' own update policy (organizations_update_admin_or_owner,
-- 20260829550000) and the plan's own authorization matrix (Table 5).
-- No DELETE policy: a profile is corrected by UPSERT, never removed
-- while the organization exists (cascades on organization delete).
-- ------------------------------------------------------------

alter table public.organization_profiles
    enable row level security;

create policy organization_profiles_select_own_org
    on public.organization_profiles
    for select
    to authenticated
    using (
        org_id in (select app.user_org_ids())
    );

create policy organization_profiles_insert_admin_or_owner
    on public.organization_profiles
    for insert
    to authenticated
    with check (
        app.user_is_admin_or_owner_of(org_id)
    );

create policy organization_profiles_update_admin_or_owner
    on public.organization_profiles
    for update
    to authenticated
    using (
        app.user_is_admin_or_owner_of(org_id)
    )
    with check (
        app.user_is_admin_or_owner_of(org_id)
    );

comment on policy organization_profiles_select_own_org on public.organization_profiles is
    'Own org only -- personalisation is never shared, and no grantee '
    'clause exists or is ever added here (this table is outside the '
    'sharing model entirely).';

comment on policy organization_profiles_insert_admin_or_owner on public.organization_profiles is
    'ADMIN or OWNER of the profile''s own org -- a MEMBER may view '
    'onboarding personalisation but not set it, matching '
    'organizations_update_admin_or_owner''s own posture on the base '
    'organization row.';

comment on policy organization_profiles_update_admin_or_owner on public.organization_profiles is
    'Same ADMIN+ gate as the INSERT policy, both using and with check '
    'so a caller cannot UPDATE a row into (or out of) another org''s '
    'ownership.';


-- ============================================================
-- END OF MIGRATION
-- ============================================================
