-- ============================================================
-- Snowkap CBAM
-- P3: authenticated SELECT policies on the regulatory reference data
--
-- Purpose:
--   docs/plans/MASTER_PLAN.md §38 (P3 contract) calls for
--   "RLS policies incl. authenticated SELECT on regulatory tables" --
--   the six regulatory tables have had RLS enabled with zero policies
--   since 20260826133116_create_regulatory_foundation.sql (service-
--   role-only access, by design, until "the backend/API access model
--   is finalized" per that migration's own §8 comment). It now is:
--   every authenticated user, regardless of organization, needs to be
--   able to look up countries/CBAM goods/emission values/routes --
--   this is shared reference data, not tenant-scoped, so unlike
--   organizations/memberships there is no org_id to filter on; the
--   policy is simply "any authenticated user may read".
--
-- Scope of THIS migration:
--   - SELECT-only policies, one per regulatory table, granted to the
--     `authenticated` role. No INSERT/UPDATE/DELETE policies -- the
--     regulatory pipeline (scripts/regulatory/*.py) and dataset
--     activation migrations are the only things that ever write this
--     data, both via the service-role connection, which continues to
--     bypass RLS entirely and is completely unaffected by this
--     migration.
--
-- Protected-zone discipline:
--   This touches the regulatory schema's ACCESS POLICY, never its
--   DATA. No row in any regulatory table is read, written, or altered
--   by this migration -- it only grants a new class of caller
--   (authenticated, non-service-role) permission to SELECT. Verified
--   locally (see the commit message) that pnpm regulatory:verify still
--   returns RESULT: VALID against the live project unchanged, and that
--   this migration was applied ONLY to the local, disposable Supabase
--   instance, never the live protected project.
-- ============================================================

create policy regulatory_sources_select_authenticated
    on public.regulatory_sources
    for select
    to authenticated
    using (true);

create policy regulatory_datasets_select_authenticated
    on public.regulatory_datasets
    for select
    to authenticated
    using (true);

create policy countries_select_authenticated
    on public.countries
    for select
    to authenticated
    using (true);

create policy production_routes_select_authenticated
    on public.production_routes
    for select
    to authenticated
    using (true);

create policy cbam_goods_select_authenticated
    on public.cbam_goods
    for select
    to authenticated
    using (true);

create policy default_emission_values_select_authenticated
    on public.default_emission_values
    for select
    to authenticated
    using (true);

comment on policy default_emission_values_select_authenticated on public.default_emission_values is
    'Regulatory reference data is not tenant-scoped -- every '
    'authenticated user may read it regardless of organization, unlike '
    'product tables (organizations/memberships/etc.), which filter by '
    'org membership. Writes remain service-role-only (the Python '
    'pipeline and activation migrations); no mutating policy exists or '
    'is planned for these tables.';


-- ============================================================
-- END OF MIGRATION
-- ============================================================
