-- ============================================================
-- Snowkap CBAM
-- P14.1 (2026-09-03), RELEASE BLOCKER: a member can persist a
-- calculation result whose emissions figure the engine never produced.
--
-- REPRODUCED LIVE, as an ordinary `authenticated` member of the line's
-- own organisation, inside a real BEGIN ... ROLLBACK transaction with
-- before/after state verified:
--
--     insert into public.calculation_results (
--         org_id, line_id, shipment_id, engine_version,
--         parameter_datasets, quantity, quantity_unit, determination,
--         steps, embedded_emissions_tco2e, calculated_by_user_id)
--     values (..., '<the line's byte-identical current determination>',
--             '[]', '0.000001', auth.uid());
--     -- INSERT 0 1
--
--     select * from public.record_declaration_filed(...);
--     -- OK  -- and "embedded_emissions_tco2e": "0.000001" is frozen
--     --        into the immutable filed_snapshot, against a true 139.
--
-- WHY EVERY EXISTING WALL PASSED IT, one at a time:
--
--   * `calculation_results_insert_own_org_as_self` (20260829200000)
--     pins org_id, `calculated_by_user_id = auth.uid()`, and the
--     line -> shipment linkage, and refuses a LOCKED/VOID shipment. All
--     correct, and all about SCOPE. It says nothing about the numbers.
--   * `calculation_results_numeric_format_ck` pins the FORM of a
--     decimal string, never its magnitude.
--   * The determination comparison in `record_declaration_filed`
--     (20260829470000) passes, because the forged row carries the
--     line's real determination.
--   * The quantity clause added this morning (20260903110000) passes,
--     because the forged row carries the line's real quantity. It
--     closes quantity forgery and was never able to close this.
--   * `reproduceCalculationResult` passes, and this is the important
--     one: it recomputes from the row's OWN frozen inputs, so an
--     internally consistent row reproduces perfectly. It can prove a
--     stored number follows from the inputs stored beside it. It cannot
--     prove those inputs, or that number, came from the engine. It is
--     also on-demand and per-row, and a forger can blind it entirely by
--     writing any `engine_version` other than the current one, which
--     turns the check into ENGINE_VERSION_CHANGED instead of MISMATCH.
--
-- The re-check also found the hole is wider than the reported case:
-- `steps`, `engine_version`, `parameter_datasets`, `certificates_due`,
-- `liability_amount`, `calculated_at` and `correlation_id` are ALL
-- client-supplied on that INSERT. The audit trail a forged row leaves
-- is itself forged.
--
-- ------------------------------------------------------------
-- THE INVARIANT THIS MIGRATION MAKES TRUE
--
--   A user cannot create or cause a persisted calculation result
--   containing an emissions value that was not produced from the
--   authoritative frozen inputs by the trusted calculation path.
--
-- ------------------------------------------------------------
-- WHY THE DATABASE CANNOT SIMPLY RECOMPUTE AND COMPARE
--
-- The obvious fix -- have the database recalculate and reject a
-- mismatch -- is not available and must not be faked. The engine is
-- TypeScript (`src/domain/calculations/calculate-line-emissions.ts`,
-- ENGINE_VERSION 1.3.0): RULE-EE-001/EE-009, the Annex II direct-only
-- rule from owner decision D1, unit-basis matching, and decimal.js at
-- 40 digits ROUND_HALF_UP. Reimplementing any of that in plpgsql would
-- create a second, silently diverging copy of regulatory semantics --
-- exactly what this project's facts-as-datasets rule and its protected
-- regulatory zone exist to prevent. A second implementation that
-- disagrees with the first is worse than no check at all, because the
-- disagreement would surface as a refusal to file a correct
-- declaration.
--
-- So the number cannot be VERIFIED by the database. It can only be made
-- UNFORGEABLE, by ensuring the only channel that can write one is a
-- channel a user cannot reach.
--
-- ------------------------------------------------------------
-- THE MODEL, AND WHY IT IS THE ONE THIS SCHEMA ALREADY USES
--
-- `organizations` and `memberships` already work exactly this way, and
-- have since P2: neither carries an INSERT policy for any API role, and
-- both are written only through SECURITY DEFINER RPCs
-- (`create_organization_with_owner`, `accept_organization_invitation`).
-- This migration puts `calculation_results` in that same category. It
-- is not a new architecture; it is the existing trusted-write pattern
-- applied to the one table that most needs it.
--
-- The one genuine difference, stated plainly rather than glossed: those
-- two RPCs are granted to `authenticated`, because everything they need
-- to decide is decidable in SQL. This one is granted to `service_role`
-- ONLY. A SECURITY DEFINER function granted to `authenticated` would
-- not close anything here -- the member would simply pass the forged
-- number to the function instead of to the table, and the function
-- cannot tell (see the section above). The trust boundary has to sit
-- where the engine runs, which is the server.
--
-- WHAT THAT COSTS, and how it is paid back. Writing as `service_role`
-- means RLS no longer stands behind this insert, so every check RLS was
-- performing must be performed explicitly. That is precisely why this
-- is an RPC and not a bare service-role INSERT from the application:
-- the function below re-imposes, in SQL, everything the dropped policy
-- enforced -- org ownership, line/shipment linkage, editable shipment
-- status -- and then adds the three bindings the policy never had:
--
--   1. `p_determination` must be byte-identical to the line's CURRENT
--      `emission_determination`. A result may not be recorded against
--      inputs the line does not actually carry.
--   2. `p_quantity` / `p_quantity_unit` must equal the line's own
--      authoritative quantity, chosen by the same rule the application
--      uses (net_mass_tonnes -> TONNES, else quantity_mwh -> MWH).
--   3. The acting user must be a real, non-deactivated member of the
--      owning organisation. `auth.uid()` is NULL under the service
--      role, so attribution is a parameter -- and a parameter is
--      exactly the kind of claim that has to be re-authorized rather
--      than believed.
--
-- and sets `calculated_at` itself from `clock_timestamp()` rather than
-- accepting it, so the one field that says when this happened cannot be
-- dictated by the caller.
--
-- SCOPE, honestly. `service_role` retains its direct table grant. This
-- migration does not claim to constrain the service role, which is the
-- trusted boundary by definition and whose key is server-only
-- (`src/infrastructure/supabase/admin-client.ts`, `import "server-only"`).
-- What it does claim, and what the tests prove, is that no `anon` or
-- `authenticated` caller can write a calculation result by any route:
-- not the table, and not this function.
--
-- Append-only is also strengthened while we are here. It was previously
-- enforced only by the ABSENCE of UPDATE and DELETE policies, while
-- `authenticated` still held table-level UPDATE and DELETE grants -- one
-- future permissive policy away from being mutable. Those grants are
-- revoked outright.
--
-- NOT CHANGED, deliberately: SELECT. Members must keep reading their
-- own organisation's calculations; that is the whole product surface.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Close the direct write surface.
-- ------------------------------------------------------------

drop policy if exists calculation_results_insert_own_org_as_self
    on public.calculation_results;

revoke insert, update, delete on public.calculation_results
    from anon, authenticated;

-- ------------------------------------------------------------
-- 2. The one channel that may write a calculation result.
-- ------------------------------------------------------------

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
    -- Shape validation for values only ever produced by this
    -- codebase's own call site, never by end-user input. A genuine
    -- caller error rather than a normal outcome, so it raises instead
    -- of returning a result_status -- the same posture
    -- record_shared_data_consumption takes with p_determination_kind.
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

    -- What the dropped INSERT policy enforced, restated. The caller is
    -- the service role now, so none of this is implied any more.
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

    -- Attribution is a parameter under the service role, so it is a
    -- claim, and claims get re-authorized. An inactive or foreign user
    -- must never appear as the author of a calculation.
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

    -- Calculating a shipment line's embedded emissions is an
    -- importer-only workflow (master plan §6/§14), and calculateLine
    -- already refuses without IMPORTER_DECLARANT. It is re-checked here
    -- for the same reason attribution is: under the service role, RLS
    -- is not standing behind this write, so an application-layer gate
    -- is the only thing enforcing it and the whole point of this
    -- migration is that application-layer gates are not what a
    -- compliance record should rest on. Cheap, and it means the
    -- capability holds even if a future caller forgets to ask.
    if not exists (
        select 1
        from public.organizations o
        where o.id = p_org_id
          and 'IMPORTER_DECLARANT' = any (o.capabilities)
    ) then
        return query select 'CAPABILITY_NOT_HELD'::text, null::uuid;
        return;
    end if;

    -- Binding 1: the frozen determination must be the line's own,
    -- byte-for-byte. jsonb equality is order-insensitive on object
    -- keys, which is what we want -- this is asking "is this the same
    -- determination", not "is this the same serialization".
    if v_line.emission_determination is null
        or p_determination is distinct from v_line.emission_determination
    then
        return query select 'DETERMINATION_MISMATCH'::text, null::uuid;
        return;
    end if;

    -- Binding 2: the quantity must be the line's own, chosen by the
    -- same rule the application uses (quantityInput() in
    -- src/application/calculations/calculate-line.ts).
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
        -- Set here, never accepted: the field that records WHEN a
        -- calculation happened must not be dictated by its caller.
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
    '2026-09-03 (P14.1). The only channel that may persist a '
    'calculation result. Granted to service_role alone, because the '
    'calculation engine is TypeScript and a function reachable by '
    '`authenticated` could not tell a real emissions figure from a '
    'forged one -- the member would simply pass the forged number to '
    'the function instead of to the table. Re-imposes in SQL everything '
    'the dropped INSERT policy enforced (org ownership, line/shipment '
    'linkage, editable status) and adds what it never had: the frozen '
    'determination and quantity must equal the line''s own, the acting '
    'user must be a live member of the owning org, and calculated_at is '
    'set here rather than accepted.';

-- Nobody but the trusted server-side channel. Stated as an explicit
-- revoke-then-grant rather than relying on defaults, so a future
-- `alter default privileges` cannot quietly widen it.
revoke all on function public.record_calculation_result(
    uuid, uuid, uuid, text, jsonb, text, text, jsonb, jsonb, text, uuid
) from public, anon, authenticated;

grant execute on function public.record_calculation_result(
    uuid, uuid, uuid, text, jsonb, text, text, jsonb, jsonb, text, uuid
) to service_role;
