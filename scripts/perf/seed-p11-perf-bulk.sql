-- ============================================================
-- Snowkap CBAM
-- P11: performance-verification seed -- step 2 (bulk data)
--
-- Purpose:
--   Seeds shipments/shipment_lines/calculation_results at a
--   meaningfully large volume for one synthetic org, on LOCAL
--   Postgres only, to measure listShipments and buildPeriodSummary
--   against docs/plans/MASTER_PLAN.md §33's real budgets. This is
--   data, not schema -- no migration needed (CLAUDE.md's protected-
--   zone rules and this task's own instructions are explicit that
--   seeding never touches supabase/migrations/*.sql).
--
--   Set-based INSERT...SELECT (not a client-side per-row loop): at
--   the target 50k-shipment / 50k-line volume, one row-by-row
--   supabase-js insert would dominate the runtime with network
--   round-trips having nothing to do with the query performance this
--   task is actually verifying. Runs directly against local Postgres
--   via psql, matching this session's approved-tooling instruction
--   ("pnpm exec supabase db push --local" is for migrations; this is
--   plain data).
--
--   Requires :org_id and :user_id (psql -v), from
--   seed-p11-perf-setup.ts's own JSON output -- that script owns
--   identity creation (a correctly bcrypt-hashed password via
--   GoTrue's admin API), this one owns bulk product data referencing
--   that identity's org_id/user_id as plain foreign keys.
--
--   One reporting period (ANNUAL 2026) for ALL seeded shipments --
--   deliberately the worst case for buildPeriodSummary /
--   listPeriodShipmentLines (src/application/reporting/), which
--   filters to exactly one period: spreading the same row count
--   across several periods would make that path's real, single-period
--   working set look artificially small.
--
--   ~90% of lines get a DEFAULT emission_determination, ~80% of ALL
--   lines get a calculation_results row (~89% of determined lines),
--   and roughly a fifth of THOSE get a second, later
--   calculation_results row -- simulating a real recalculation append
--   (calculation_results is append-only; see
--   20260829180000_p6_calculation_results_schema.sql's header
--   comment) so latest_calculation_results' DISTINCT ON view is
--   exercised against more rows than there are lines, not a trivial
--   1:1 table.
-- ============================================================

\set ON_ERROR_STOP on
\timing on

begin;

-- ============================================================
-- 1. SHIPMENTS
-- ============================================================

insert into public.shipments (
    id, org_id, reference, release_date,
    reporting_period_kind, reporting_period_year, reporting_period_quarter,
    status, created_at, updated_at
)
select
    gen_random_uuid(),
    :'org_id'::uuid,
    'P11-PERF-' || lpad(g::text, 6, '0'),
    date '2026-01-01' + (g % 300),
    'ANNUAL', 2026, null,
    case when g % 5 = 0 then 'READY' else 'DRAFT' end,
    now() - make_interval(days => (g % 200)::int, hours => (g % 24)::int),
    now()
from generate_series(1, :n_shipments) as g;


-- ============================================================
-- 2. SHIPMENT_LINES (one per shipment) -- captures ids + the
--    determination flag into a session-temp table so step 3 can
--    target realistic subsets without a second full table scan of
--    shipment_lines filtered by a fragile heuristic.
-- ============================================================

create temporary table _p11_lines as
with numbered as (
    select
        s.id as shipment_id,
        s.org_id,
        row_number() over (order by s.created_at, s.id) as rn
    from public.shipments s
    where s.org_id = :'org_id'::uuid
),
inserted as (
    insert into public.shipment_lines (
        id, shipment_id, org_id, line_number,
        cn_code, cn_code_level, goods_description, origin_country,
        net_mass_tonnes, emission_determination
    )
    select
        gen_random_uuid(),
        n.shipment_id,
        n.org_id,
        1,
        (array[
            '72083610', '72091610', '76011000', '25232100',
            '31021000', '72022110', '72071190', '76020000'
        ])[(n.rn % 8) + 1],
        'CN8',
        'P11 perf-seed line',
        (array[
            'CN', 'IN', 'TR', 'RU', 'UA', 'ID', 'BR', 'ZA', 'VN', 'EG'
        ])[(n.rn % 10) + 1],
        (10 + (n.rn % 490))::text || '.500',
        -- ~90% DETERMINED (DEFAULT method); ~10% NO_DETERMINATION,
        -- matching IncompleteLineReason's real two-state split in
        -- src/application/reporting/build-period-summary.ts.
        case
            when n.rn % 10 = 0 then null
            else jsonb_build_object(
                'method', 'DEFAULT',
                'resolution', jsonb_build_object(
                    'status', 'RESOLVED',
                    'seed', true
                )
            )
        end
    from numbered n
    returning id, shipment_id, org_id, emission_determination
)
select
    id,
    shipment_id,
    org_id,
    emission_determination,
    row_number() over () as rn
from inserted;

create unique index on _p11_lines (id);


-- ============================================================
-- 3. CALCULATION_RESULTS -- ~89% of DETERMINED lines (~80% of all
--    lines), plus a second append-only row for ~1/5 of those
--    (simulated recalculation).
-- ============================================================

insert into public.calculation_results (
    id, org_id, line_id, shipment_id, engine_version,
    quantity, quantity_unit, determination, steps,
    embedded_emissions_tco2e, calculated_at, calculated_by_user_id
)
select
    gen_random_uuid(),
    l.org_id,
    l.id,
    l.shipment_id,
    'perf-seed-v1',
    (10 + (l.rn % 490))::text || '.500',
    'TONNES',
    jsonb_build_object('method', 'DEFAULT', 'seed', true),
    jsonb_build_array(
        jsonb_build_object('label', 'seed-step', 'value', '1.000')
    ),
    (1 + (l.rn % 1000))::text || '.250',
    now() - make_interval(days => (l.rn % 100)::int),
    :'user_id'::uuid
from _p11_lines l
where l.emission_determination is not null
  and l.rn % 9 != 0;

insert into public.calculation_results (
    id, org_id, line_id, shipment_id, engine_version,
    quantity, quantity_unit, determination, steps,
    embedded_emissions_tco2e, calculated_at, calculated_by_user_id
)
select
    gen_random_uuid(),
    l.org_id,
    l.id,
    l.shipment_id,
    'perf-seed-v2',
    (10 + (l.rn % 490))::text || '.500',
    'TONNES',
    jsonb_build_object('method', 'DEFAULT', 'seed', true, 'recalculated', true),
    jsonb_build_array(
        jsonb_build_object('label', 'seed-step-recalc', 'value', '1.100')
    ),
    (1 + (l.rn % 1000))::text || '.500',
    now() - make_interval(days => (l.rn % 50)::int),
    :'user_id'::uuid
from _p11_lines l
where l.emission_determination is not null
  and l.rn % 9 != 0
  and l.rn % 5 = 0;

drop table _p11_lines;

commit;

-- ============================================================
-- 4. REPORTED COUNTS
-- ============================================================

select
    (select count(*) from public.shipments where org_id = :'org_id'::uuid) as shipments,
    (select count(*) from public.shipment_lines where org_id = :'org_id'::uuid) as shipment_lines,
    (select count(*) from public.calculation_results where org_id = :'org_id'::uuid) as calculation_results;

-- ============================================================
-- END OF SCRIPT
-- ============================================================
