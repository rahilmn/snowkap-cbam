-- ============================================================
-- Snowkap CBAM
-- P6: Calculation Results Schema
-- ============================================================
--
-- Purpose:
--   Append-only store for CalculationResult
--   (src/domain/calculations/types.ts), produced by the pure
--   engine calculateLineEmissions
--   (src/domain/calculations/calculate-line-emissions.ts,
--   docs/regulatory/CALCULATION_RULE_REGISTER.md RULE-EE-001).
--
--   Only a COMPUTED result is ever persisted here -- mirroring
--   how P5's resolve-line-emissions.ts never writes
--   shipment_lines.emission_determination for an UNRESOLVED
--   attempt either. An INPUT_UNRESOLVED / VALUE_UNAVAILABLE /
--   ACTUAL_METHOD_NOT_YET_SUPPORTED outcome is surfaced for that
--   one request/response only (see
--   src/application/calculations/calculate-line.ts) and never
--   reaches this table.
--
--   "Recalculation appends" (docs/plans/MASTER_PLAN.md §6/§12):
--   a new calculation for the same line is a new row, never an
--   update to a prior one -- the current result for a line is
--   the most recent row by calculated_at. No UPDATE or DELETE
--   policy exists on this table; that is what makes it
--   append-only, not merely a convention.
-- ============================================================


create table public.calculation_results (
    id uuid primary key default gen_random_uuid(),

    org_id uuid not null
        references public.organizations(id)
        on delete cascade,

    line_id uuid not null
        references public.shipment_lines(id)
        on delete cascade,

    -- Denormalized from the line's parent shipment -- same rationale
    -- as shipment_lines.org_id (P4): lets shipment-level queries (e.g.
    -- "every calculation for this shipment") filter directly without
    -- a join, and lets line_id's own FK be enough for per-line queries.
    shipment_id uuid not null
        references public.shipments(id)
        on delete cascade,

    engine_version text not null,

    -- CalculationParameterDataset[] -- empty array through P6 (only
    -- the DEFAULT_EMISSION_VALUES dataset is read, and it is already
    -- captured inside the frozen `determination` column below); future
    -- markup/benchmark/certificate-price datasets will populate this.
    parameter_datasets jsonb not null default '[]'::jsonb,

    -- CalculationResult.inputs -- frozen at calculation time so a
    -- historical result never depends on the line's current state.
    quantity text not null,
    quantity_unit text not null
        check (quantity_unit in ('TONNES', 'MWH')),
    determination jsonb not null,

    -- CalculationStep[] (src/domain/calculations/types.ts).
    steps jsonb not null,

    -- CalculationResult.outputs -- embedded_emissions_tco2e is always
    -- present (only COMPUTED results are ever inserted, see above);
    -- certificates_due/liability stay null until a parameter dataset
    -- they depend on is ACTIVE (FUTURE-DEFERRED, master plan §17).
    embedded_emissions_tco2e text not null,
    certificates_due text,
    liability_amount text,
    liability_currency text
        check (liability_currency is null or liability_currency = 'EUR'),

    calculated_at timestamptz not null default now(),

    calculated_by_user_id uuid not null
        references auth.users(id),

    correlation_id uuid
);

comment on table public.calculation_results is
    'Append-only calculation outputs -- only COMPUTED results are '
    'persisted (see the module comment above); no update/delete policy '
    'exists, so recalculation inserts a new row rather than replacing '
    'one.';

create index calculation_results_org_line_idx
    on public.calculation_results (org_id, line_id, calculated_at desc);

create index calculation_results_org_shipment_idx
    on public.calculation_results (org_id, shipment_id);

alter table public.calculation_results
    enable row level security;

create policy calculation_results_select_own_org
    on public.calculation_results
    for select
    to authenticated
    using (
        org_id in (select app.user_org_ids())
    );

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
            where sl.id = calculation_results.line_id
              and sl.org_id = calculation_results.org_id
              and sl.shipment_id = calculation_results.shipment_id
        )
    );


-- ============================================================
-- END OF MIGRATION
-- ============================================================
