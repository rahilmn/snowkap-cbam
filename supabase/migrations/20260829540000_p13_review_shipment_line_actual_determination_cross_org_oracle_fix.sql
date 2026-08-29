-- ============================================================
-- Snowkap CBAM
-- P13 release-blocker remediation, ITERATION 3: while independently
-- re-verifying 20260829530000's SECURITY DEFINER change (itself a
-- correction discovered live while re-testing that migration's ACTUAL-
-- branch fix), a new gap surfaced: making
-- app.emission_determination_matches_regulatory_record SECURITY
-- DEFINER lets it see any emission_data row regardless of the CALLING
-- org's own RLS visibility -- correct for validating a legitimate
-- cross-org (grant-shared) determination, but it also means an org
-- with NO relationship whatsoever to an installation could attempt a
-- shipment_lines UPDATE claiming an ACTUAL determination against any
-- emission_data_id it can obtain (e.g. leaked in a URL, a support
-- ticket, an export another party mishandled) and use the WITH CHECK's
-- accept/reject outcome as a boolean oracle: guess a value, see
-- whether the write succeeds, and eventually recover that competitor's
-- real (and otherwise never-visible-to-them) direct_specific/
-- indirect_specific/verifier_user_id -- a cross-tenant information
-- disclosure via a side channel, not a direct read.
--
-- Confirmed live: the function currently receives only the
-- determination jsonb, not the calling line's org_id, so it has no way
-- to distinguish "this org may reference this installation's data" from
-- "this org has no relationship to this installation at all" -- both
-- currently reach the exact same real-row lookup and value comparison.
--
-- Fix: give the function a second parameter, p_org_id (the shipment
-- line's own org_id, already available to the WITH CHECK clause that
-- calls it), and require -- for the ACTUAL branch only -- that either
-- (a) the org calling this owns the installation the emission_data
-- belongs to, or (b) a sharing_grants row exists linking that org to
-- that installation as grantee, REGARDLESS OF THE GRANT'S CURRENT
-- STATUS. Condition (b) is deliberately "a grant of this shape was
-- ever issued", not "an ACTIVE, unexpired grant exists right now" --
-- for two reasons: first, it still closes the oracle for the vast
-- majority of real attackers (any org with literally zero grant
-- history for that installation), which is the practical threat this
-- migration exists to close; second, requiring a currently-ACTIVE
-- grant would reintroduce the exact retroactive-breakage problem
-- 20260829530000's own header comment already identified and rejected
-- -- an existing, correctly-saved ACTUAL determination becoming
-- unsavable (for ANY edit, not just the determination) the moment its
-- originating grant is later revoked or expires, which contradicts
-- this codebase's own "revocation ends future reads, never claws back
-- history" design (master plan §9, ADR-0012).
-- ============================================================

drop policy shipment_lines_insert_parent_not_terminal on public.shipment_lines;
drop policy shipment_lines_update_parent_not_terminal on public.shipment_lines;

create or replace function app.emission_determination_matches_regulatory_record(
    p_determination jsonb,
    p_org_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_method text;
    v_resolution jsonb;
    v_snapshot jsonb;
    v_dataset_id uuid;
    v_dataset_version text;
    v_source_sheet text;
    v_source_row integer;
    v_source_trade_code text;
    v_origin_country_name text;
    v_source_route_code text;
    v_match_count integer;
    v_record record;
    v_dataset_exists boolean;
    v_emission_data_id uuid;
    v_ed record;
    v_installation_org_id uuid;
    v_authorized boolean;
begin
    if p_determination is null then
        return true;
    end if;

    if jsonb_typeof(p_determination) is distinct from 'object' then
        return false;
    end if;

    v_method := p_determination->>'method';

    if v_method = 'ACTUAL' then
        v_snapshot := p_determination->'snapshot';

        if v_snapshot is null or jsonb_typeof(v_snapshot) is distinct from 'object' then
            return false;
        end if;

        v_emission_data_id := app.try_cast_uuid(v_snapshot->>'emission_data_id');

        if v_emission_data_id is null then
            return false;
        end if;

        select ed.*
        into v_ed
        from public.emission_data ed
        where ed.id = v_emission_data_id;

        if not found then
            return false;
        end if;

        select i.org_id
        into v_installation_org_id
        from public.installations i
        where i.id = v_ed.installation_id;

        -- Cross-org authorization gate (this migration's own fix): the
        -- calling org must either own the installation, or have some
        -- sharing_grants history with it. This runs BEFORE any value
        -- comparison below so a wrong guess and "you have no
        -- relationship to this data at all" fail identically -- no
        -- boolean oracle survives for an org with zero grant history.
        if v_installation_org_id is distinct from p_org_id then
            select exists (
                select 1
                from public.sharing_grants sg
                where sg.installation_id = v_ed.installation_id
                  and sg.grantee_org_id = p_org_id
            ) into v_authorized;

            if not v_authorized then
                return false;
            end if;
        end if;

        return (
            v_ed.verification_status = 'VERIFIED'
            and v_ed.verifier_user_id is not distinct from app.try_cast_uuid(v_snapshot->'verification'->>'verifier_user_id')
            and v_ed.emission_unit = (v_snapshot->>'emission_unit')
            and v_ed.direct_specific is not distinct from (v_snapshot->'values'->>'direct_specific')
            and v_ed.indirect_specific is not distinct from (v_snapshot->'values'->>'indirect_specific')
        );
    end if;

    if v_method is distinct from 'DEFAULT' then
        return false;
    end if;

    v_resolution := p_determination->'resolution';

    if v_resolution is null
        or jsonb_typeof(v_resolution) is distinct from 'object'
        or jsonb_typeof(v_resolution->'record_identity') is distinct from 'object'
        or jsonb_typeof(v_resolution->'values') is distinct from 'object'
        or jsonb_typeof(v_resolution->'country_mapping') is distinct from 'object'
        or jsonb_typeof(v_resolution->'trace') is distinct from 'array'
    then
        return false;
    end if;

    if (v_resolution->'country_mapping'->>'status') is null
        or not ((v_resolution->'country_mapping'->>'status') = any (array['MAPPED', 'UNLISTED']))
    then
        return false;
    end if;

    if (v_resolution->>'reason') is null
        or not (
            (v_resolution->>'reason') = any (
                array[
                    'EXACT_TARIC_MATCH', 'EXACT_CN8_MATCH', 'EXACT_HS6_MATCH', 'EXACT_HS4_MATCH',
                    'OTHER_COUNTRIES_FALLBACK', 'REFERENCE_REQUIRED', 'UNAVAILABLE', 'NOT_APPLICABLE',
                    'AMBIGUOUS', 'NO_MATCH'
                ]
            )
        )
    then
        return false;
    end if;

    if jsonb_array_length(v_resolution->'trace') = 0 then
        return false;
    end if;

    v_dataset_id := app.try_cast_uuid(v_resolution->>'dataset_id');
    v_dataset_version := v_resolution->>'dataset_version';
    v_source_sheet := v_resolution->'record_identity'->>'source_sheet';
    v_source_row := (app.try_cast_numeric(v_resolution->'record_identity'->>'source_row'))::integer;
    v_source_trade_code := v_resolution->'record_identity'->>'source_trade_code';
    v_origin_country_name := v_resolution->'record_identity'->>'origin_country_name';
    v_source_route_code := v_resolution->'record_identity'->>'source_production_route_code';

    if v_dataset_id is null
        or v_dataset_version is null
        or v_source_sheet is null
        or v_source_row is null
        or v_source_trade_code is null
        or v_origin_country_name is null
    then
        return false;
    end if;

    select exists (
        select 1
        from public.regulatory_datasets rd
        where rd.id = v_dataset_id
          and rd.dataset_type = 'DEFAULT_EMISSION_VALUES'
          and rd.version = v_dataset_version
    ) into v_dataset_exists;

    if not v_dataset_exists then
        return false;
    end if;

    select count(*)
    into v_match_count
    from public.default_emission_values dev
    join public.countries c
        on c.id = dev.country_id
    left join public.production_routes pr
        on pr.id = dev.production_route_id
    where dev.dataset_id = v_dataset_id
      and dev.source_sheet = v_source_sheet
      and dev.source_row = v_source_row
      and dev.source_trade_code = v_source_trade_code
      and c.name = v_origin_country_name
      and pr.source_route_indicator is not distinct from v_source_route_code;

    if v_match_count is distinct from 1 then
        return false;
    end if;

    select dev.*
    into v_record
    from public.default_emission_values dev
    join public.countries c
        on c.id = dev.country_id
    left join public.production_routes pr
        on pr.id = dev.production_route_id
    where dev.dataset_id = v_dataset_id
      and dev.source_sheet = v_source_sheet
      and dev.source_row = v_source_row
      and dev.source_trade_code = v_source_trade_code
      and c.name = v_origin_country_name
      and pr.source_route_indicator is not distinct from v_source_route_code;

    return (
        v_record.emission_unit = (v_resolution->>'emission_unit')
        and v_record.direct_status = (v_resolution->'values'->'direct'->>'status')
        and v_record.direct_value is not distinct from app.try_cast_numeric(v_resolution->'values'->'direct'->>'value')
        and v_record.indirect_status = (v_resolution->'values'->'indirect'->>'status')
        and v_record.indirect_value is not distinct from app.try_cast_numeric(v_resolution->'values'->'indirect'->>'value')
        and v_record.total_status = (v_resolution->'values'->'total'->>'status')
        and v_record.total_value is not distinct from app.try_cast_numeric(v_resolution->'values'->'total'->>'value')
    );
end;
$$;

comment on function app.emission_determination_matches_regulatory_record(jsonb, uuid) is
    '2026-08-30 (P13 review iteration 3): adds the p_org_id parameter '
    'to close a boolean-oracle cross-tenant disclosure this migration''s '
    'own header comment explains -- an org with zero relationship to an '
    'installation could otherwise use accept/reject outcomes to guess a '
    'real emission_data row''s values one attempt at a time, since '
    '20260829530000''s SECURITY DEFINER change (correctly) stopped '
    'gating this function''s visibility on the caller''s own RLS. The '
    'DEFAULT branch is unaffected -- default_emission_values is global '
    'reference data, so no analogous authorization gap exists there.';

drop function if exists app.emission_determination_matches_regulatory_record(jsonb);

revoke all on function app.emission_determination_matches_regulatory_record(jsonb, uuid) from public;
grant execute on function app.emission_determination_matches_regulatory_record(jsonb, uuid) to authenticated;

create policy shipment_lines_insert_parent_not_terminal
    on public.shipment_lines
    for insert
    to authenticated
    with check (
        org_id in (select app.user_org_ids())
        and exists (
            select 1 from public.shipments s
            where s.id = shipment_lines.shipment_id
              and s.org_id = shipment_lines.org_id
              and s.status <> all (array['LOCKED', 'VOID'])
        )
        and app.emission_determination_matches_regulatory_record(emission_determination, org_id)
    );

create policy shipment_lines_update_parent_not_terminal
    on public.shipment_lines
    for update
    to authenticated
    using (
        org_id in (select app.user_org_ids())
        and exists (
            select 1 from public.shipments s
            where s.id = shipment_lines.shipment_id
              and s.org_id = shipment_lines.org_id
              and s.status <> all (array['LOCKED', 'VOID'])
        )
    )
    with check (
        org_id in (select app.user_org_ids())
        and exists (
            select 1 from public.shipments s
            where s.id = shipment_lines.shipment_id
              and s.org_id = shipment_lines.org_id
              and s.status <> all (array['LOCKED', 'VOID'])
        )
        and app.emission_determination_matches_regulatory_record(emission_determination, org_id)
    );

comment on policy shipment_lines_insert_parent_not_terminal on public.shipment_lines is
    '2026-08-30 (P13 review iteration 3): re-created to pass org_id into '
    'app.emission_determination_matches_regulatory_record(jsonb, uuid) '
    '-- see that function''s comment. Otherwise unchanged from '
    '20260828150000/20260829090000''s parent-not-terminal shape.';

comment on policy shipment_lines_update_parent_not_terminal on public.shipment_lines is
    '2026-08-30 (P13 review iteration 3): re-created to pass org_id into '
    'app.emission_determination_matches_regulatory_record(jsonb, uuid) '
    '-- see that function''s comment. Otherwise unchanged from '
    '20260828150000/20260829090000''s parent-not-terminal shape.';
