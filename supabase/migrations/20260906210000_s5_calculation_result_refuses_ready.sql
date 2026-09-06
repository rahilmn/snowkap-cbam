-- ============================================================
-- Snowkap CBAM
-- S5 (2026-09-06), cross-phase hardening: public.record_calculation_
-- result's own SHIPMENT_NOT_EDITABLE gate was never widened to match
-- 20260904090000_p14_ready_shipments_are_not_editable.sql, which made
-- shipment_lines writes DRAFT-only for every role four days earlier.
--
-- REPRODUCED LIVE (S5 adversarial audit, real BEGIN...ROLLBACK, real
-- record_calculation_result RPC call, not the underlying table):
-- create a DRAFT shipment+line, give it a real determination, call
-- record_calculation_result once (OK, one calculation_results row),
-- transition the shipment to READY (the line's own inputs cannot
-- change from here -- shipment_lines is DRAFT-only, 20260904090000),
-- then call record_calculation_result AGAIN with the exact same,
-- still-current determination and quantity. Result: OK, a SECOND
-- calculation_results row inserted. get-latest-calculations.ts and
-- the filing gate (record_declaration_filed) both pick the latest
-- calculation_results row per line by calculated_at, not a frozen
-- READY-time snapshot -- so a Recalculate click on a READY shipment
-- silently succeeds and its result becomes what filing uses, with no
-- reopen and no re-approval. Compounded by a second, closely related
-- application-layer bug (fixed separately, same commit): the shipment
-- detail page still rendered the Recalculate control as active for a
-- READY shipment, so this was reachable through the ordinary UI, not
-- only by direct RPC call.
--
-- This is precisely the "READY content changed after approval, filing
-- re-aggregates without comparing to what was approved" vulnerability
-- class 20260904090000's own commit message states it exists to
-- close -- surviving through a sibling write channel (calculation
-- results, a SECURITY DEFINER RPC, not shipment_lines itself) that
-- migration never touched, because it predates this RPC's own
-- creation by roughly a day and neither migration cross-referenced
-- the other's status list.
--
-- FIX, NARROWED FROM THE FIRST DRAFT OF THIS MIGRATION. A blanket
-- "DRAFT only" gate (matching shipment_lines' own posture exactly)
-- would also refuse the SANCTIONED, already-tested recovery path for
-- CALCULATION_ENGINE_OUTDATED: tests/integration/declaration-filing-
-- engine-version.test.ts's own "recalculating clears the refusal"
-- case deliberately recalculates a READY shipment's line -- WITHOUT
-- reopening it -- specifically so a stale-engine result can be
-- superseded by a fresh one without forcing a full reopen/re-approve
-- cycle over a shipment whose own content never changed. That is a
-- real, intentional design already relied on: record_declaration_
-- filed's own gate always re-verifies the LATEST calculation_results
-- row live, under a row lock, at filing time -- filing was never
-- vulnerable to a stale number, which is precisely what makes "let a
-- newer engine version supersede an older one, even on READY" safe by
-- construction.
--
-- What is NOT safe, and what this migration actually closes: resub-
-- mitting the SAME engine_version a READY shipment's line already has
-- a result for. Nothing about the frozen determination or quantity
-- can differ (record_calculation_result's own bindings 1 and 2, un-
-- changed by this migration, already pin both to the line's current,
-- immutable-while-READY values) -- but resubmitting the identical
-- version has no legitimate reason to happen and, if a future engine
-- version were ever non-deterministic for the same inputs (or if
-- some other input the engine reads live -- e.g. a regulatory dataset
-- correction -- changed underneath, unrelated to this line's own
-- frozen facts), it would let a READY shipment's approved figure be
-- superseded with no reopen and no re-approval, silently. So: a
-- calculation may be recorded against a READY shipment's line ONLY
-- when its engine_version differs from every engine_version this line
-- already has a calculation_results row for -- exactly the
-- CALCULATION_ENGINE_OUTDATED recovery shape, and nothing wider. LOCKED
-- and VOID remain refused unconditionally, unchanged from the original
-- migration -- a filed or retired shipment's calculations are never
-- recordable through this RPC regardless of engine version.
-- ============================================================

create or replace function public.record_calculation_result(
    p_org_id uuid,
    p_line_id uuid,
    p_calculated_by_user_id uuid,
    p_engine_version text,
    p_parameter_datasets jsonb,
    p_quantity text,
    p_quantity_unit text,
    p_determination jsonb,
    p_steps jsonb,
    p_embedded_emissions_tco2e text,
    p_correlation_id uuid
)
returns table(
    result_status text,
    result_calculation_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_line public.shipment_lines%rowtype;
    v_shipment_status text;
    v_expected_quantity text;
    v_expected_unit text;
    v_calculation_id uuid;
begin
    if p_engine_version !~ '^[0-9]+\.[0-9]+\.[0-9]+$' then
        raise exception
            'record_calculation_result: p_engine_version must be a semantic version, got %',
            p_engine_version;
    end if;

    if p_quantity_unit not in ('TONNES', 'MWH') then
        raise exception
            'record_calculation_result: invalid p_quantity_unit %', p_quantity_unit;
    end if;

    if jsonb_typeof(p_steps) <> 'array' then
        raise exception
            'record_calculation_result: p_steps must be a JSON array';
    end if;

    select sl.*
    into v_line
    from public.shipment_lines sl
    where sl.id = p_line_id;

    if v_line.id is null then
        return query select 'LINE_NOT_FOUND'::text, null::uuid;
        return;
    end if;

    if v_line.org_id <> p_org_id then
        return query select 'LINE_NOT_FOUND'::text, null::uuid;
        return;
    end if;

    select s.status
    into v_shipment_status
    from public.shipments s
    where s.id = v_line.shipment_id;

    if v_shipment_status is null or v_shipment_status in ('LOCKED', 'VOID') then
        return query select 'SHIPMENT_NOT_EDITABLE'::text, null::uuid;
        return;
    end if;

    -- S5 (2026-09-06): READY is no longer unconditionally editable
    -- (closes the gap this migration's header describes), but stays
    -- open for exactly the CALCULATION_ENGINE_OUTDATED recovery shape
    -- this codebase already relies on and tests: a calculation may be
    -- recorded against a READY shipment's line only when its own
    -- engine_version differs from every engine_version already
    -- recorded for this line. A same-version resubmission against a
    -- READY shipment -- which cannot legitimately need to happen, and
    -- is exactly what the live-reproduced S5 finding demonstrated --
    -- is refused.
    if v_shipment_status = 'READY' and exists (
        select 1
        from public.calculation_results cr
        where cr.line_id = p_line_id
          and cr.engine_version = p_engine_version
    ) then
        return query select 'SHIPMENT_NOT_EDITABLE'::text, null::uuid;
        return;
    end if;

    if not exists (
        select 1
        from public.memberships m
        where m.org_id = p_org_id
          and m.user_id = p_calculated_by_user_id
          and m.deactivated_at is null
    ) then
        return query select 'ACTOR_NOT_A_MEMBER'::text, null::uuid;
        return;
    end if;

    if not exists (
        select 1
        from public.organizations o
        where o.id = p_org_id
          and 'IMPORTER_DECLARANT' = any (o.capabilities)
    ) then
        return query select 'CAPABILITY_NOT_HELD'::text, null::uuid;
        return;
    end if;

    if v_line.emission_determination is null
        or p_determination is distinct from v_line.emission_determination
    then
        return query select 'DETERMINATION_MISMATCH'::text, null::uuid;
        return;
    end if;

    if v_line.net_mass_tonnes is not null then
        v_expected_quantity := v_line.net_mass_tonnes;
        v_expected_unit := 'TONNES';
    else
        v_expected_quantity := v_line.quantity_mwh;
        v_expected_unit := 'MWH';
    end if;

    if v_expected_quantity is null then
        return query select 'LINE_HAS_NO_QUANTITY'::text, null::uuid;
        return;
    end if;

    if p_quantity is distinct from v_expected_quantity
        or p_quantity_unit is distinct from v_expected_unit
    then
        return query select 'QUANTITY_MISMATCH'::text, null::uuid;
        return;
    end if;

    insert into public.calculation_results (
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
        calculated_at,
        calculated_by_user_id,
        correlation_id
    )
    values (
        p_org_id,
        p_line_id,
        v_line.shipment_id,
        p_engine_version,
        p_parameter_datasets,
        p_quantity,
        p_quantity_unit,
        p_determination,
        p_steps,
        p_embedded_emissions_tco2e,
        clock_timestamp(),
        p_calculated_by_user_id,
        p_correlation_id
    )
    returning id into v_calculation_id;

    return query select 'OK'::text, v_calculation_id;
end;
$$;

comment on function public.record_calculation_result(
    uuid, uuid, uuid, text, jsonb, text, text, jsonb, jsonb, text, uuid
) is
    '2026-09-03 (P14.1), narrowed 2026-09-06 (S5). The only channel '
    'that may persist a calculation result. Granted to service_role '
    'alone. LOCKED/VOID shipments always refuse SHIPMENT_NOT_EDITABLE, '
    'as before. A READY shipment now also refuses UNLESS the submitted '
    'engine_version differs from every engine_version already recorded '
    'for that line -- the exact CALCULATION_ENGINE_OUTDATED recovery '
    'shape this codebase''s own test suite relies on stays open; a '
    'same-version resubmission against an approved, READY shipment, '
    'which has no legitimate reason to happen, does not.';
