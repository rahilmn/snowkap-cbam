-- ============================================================
-- Snowkap CBAM
-- P6: Calculation Results Hardening
-- ============================================================
--
-- Purpose:
--   Fixes from the mandatory P6 engine review
--   (docs/plans/MASTER_PLAN.md §38's "mandatory Opus review
--   (engine)" checkpoint) against
--   20260829180000_p6_calculation_results_schema.sql, already
--   applied -- forward-only, so this is a new migration rather
--   than an edit to that one.
--
--   1. LOCKED/VOID shipments must reject new calculations, the
--      same as they reject new emission determinations
--      (shipment_lines_update_parent_not_terminal) -- the
--      original INSERT policy checked line/org/shipment linkage
--      but never parent shipment status.
--   2. calculated_at must use clock_timestamp(), not now() --
--      now() is transaction-scoped, so any future single-
--      transaction batch recalculation would give every row in
--      that transaction an identical timestamp, making
--      "most recent row per line" nondeterministic.
--   3. A latest_calculation_results view (DISTINCT ON, ordered by
--      calculated_at desc then id desc for a deterministic
--      tiebreak) replaces the "fetch every row for the shipment
--      and reduce in application code" pattern
--      (src/application/calculations/get-latest-calculations.ts),
--      which silently truncated past PostgREST's row cap
--      (config.toml's max_rows) once a shipment's calculation
--      history across all its lines exceeded it.
-- ============================================================


-- ============================================================
-- 1. LOCKED/VOID GATE ON INSERT
-- ============================================================

drop policy calculation_results_insert_own_org_as_self
    on public.calculation_results;

create policy calculation_results_insert_own_org_as_self
    on public.calculation_results
    for insert
    to authenticated
    with check (
        org_id in (select app.user_org_ids())
        and calculated_by_user_id = auth.uid()
        and exists (
            select 1
            from public.shipment_lines sl
            join public.shipments s
              on s.id = sl.shipment_id
            where sl.id = calculation_results.line_id
              and sl.org_id = calculation_results.org_id
              and sl.shipment_id = calculation_results.shipment_id
              and s.status not in ('LOCKED', 'VOID')
        )
    );


-- ============================================================
-- 2. CLOCK_TIMESTAMP() FOR A REAL WRITE-TIME TIMESTAMP
-- ============================================================

alter table public.calculation_results
    alter column calculated_at
    set default clock_timestamp();


-- ============================================================
-- 3. LATEST-PER-LINE VIEW
-- ============================================================
--
-- security_invoker: the view runs with the querying user's own
-- privileges (and therefore their own RLS), not the view owner's
-- -- it does not need (and must not have) its own broader grant.
-- ============================================================

create view public.latest_calculation_results
    with (security_invoker = true)
    as
    select distinct on (line_id)
        id,
        org_id,
        line_id,
        shipment_id,
        engine_version,
        parameter_datasets,
        quantity,
        quantity_unit,
        determination,
        steps,
        embedded_emissions_tco2e,
        certificates_due,
        liability_amount,
        liability_currency,
        calculated_at,
        calculated_by_user_id,
        correlation_id
    from public.calculation_results
    order by line_id, calculated_at desc, id desc;

comment on view public.latest_calculation_results is
    'The most recent calculation_results row per line_id -- read-only, '
    'RLS-enforced via security_invoker (inherits calculation_results'' own '
    'policies, not a separate grant). Use this instead of fetching every '
    'row for a shipment and reducing in application code, which silently '
    'truncates past PostgREST''s row cap once history grows.';


-- ============================================================
-- END OF MIGRATION
-- ============================================================
