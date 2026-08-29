-- ============================================================
-- Snowkap CBAM
-- P13 release-blocker remediation, ITERATION 6: self-discovered while
-- re-reading 20260829600000's own DEFAULT-branch fix for finding F1
-- (which tied a determination's claimed cn_code/origin_country to the
-- calling line's own declared values) -- the SAME binding was never
-- applied to production_route_indicator. The DEFAULT branch's matched-
-- record lookup already joins on `pr.source_route_indicator is not
-- distinct from v_source_route_code` (v_source_route_code being the
-- determination's OWN claimed
-- record_identity.source_production_route_code), which correctly
-- proves the claimed route+values pairing is a REAL row in the
-- dataset -- but nothing ever checked that the CALLING LINE's own
-- production_route_indicator column agrees with that claim.
--
-- Live-reproduced before this fix, independently, using a real
-- route-specific record (Azerbaijan, CN8 7207 12 90, route "(E)",
-- total_value 0.130 -- the byte-exact real values, to isolate this
-- from the already-fixed value-matching checks) attached to a line
-- declaring `production_route_indicator = null` (no route at all):
-- accepted (`UPDATE 1`). Since route-specific default values can
-- differ substantially from a route-independent one for the same
-- country/good, this let an importer claim a specific production
-- route's value without the line ever actually declaring that route
-- was used -- the same class of forgery F1 closed for cn_code/
-- origin_country, left open for production_route_indicator.
--
-- Fixed: the DEFAULT branch now also requires
-- record_identity.source_production_route_code to equal (via `is not
-- distinct from`, so a null-route claim on a null-route line still
-- matches) the calling line's own production_route_indicator,
-- via a 5th parameter, p_production_route_indicator.
-- ============================================================

drop function if exists app.emission_determination_matches_regulatory_record(jsonb, uuid, text, text);

create function app.emission_determination_matches_regulatory_record(
    p_determination jsonb,
    p_org_id uuid,
    p_cn_code text,
    p_origin_country text,
    p_production_route_indicator text
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
    v_grant_id uuid;
    v_cn_scope_covers boolean;
    v_snapshot_evidence text[];
    v_real_evidence text[];
    v_mapped_country_name text;
    v_reason text;
begin
    if p_determination is null then
        return true;
    end if;

    if jsonb_typeof(p_determination) is distinct from 'object' then
        return false;
    end if;

    if p_org_id is null or p_org_id not in (select app.user_org_ids()) then
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

        if v_ed.status <> 'ACTIVE' or v_ed.verification_status <> 'VERIFIED' then
            return false;
        end if;

        if coalesce(array_length(v_ed.evidence_file_ids, 1), 0) = 0 then
            return false;
        end if;

        if v_ed.entered_by_org_id = p_org_id then
            v_grant_id := null;
        else
            select sg.id
            into v_grant_id
            from public.sharing_grants sg
            where sg.installation_id = v_ed.installation_id
              and sg.grantee_org_id = p_org_id
              and sg.status = 'ACTIVE'
              and (sg.expires_at is null or sg.expires_at > now());

            if v_grant_id is null then
                return false;
            end if;
        end if;

        select bool_or(
            app.code_prefix_covers(scope_entry, p_cn_code)
        )
        into v_cn_scope_covers
        from unnest(v_ed.cn_scope) as scope_entry;

        if not coalesce(v_cn_scope_covers, false) then
            return false;
        end if;

        if (v_snapshot->'verification'->>'status') is distinct from 'VERIFIED' then
            return false;
        end if;

        if app.try_cast_uuid(v_snapshot->>'installation_id') is distinct from v_ed.installation_id then
            return false;
        end if;

        if (v_snapshot->>'methodology') is distinct from v_ed.methodology then
            return false;
        end if;

        if app.try_cast_int(v_snapshot->>'emission_data_version') is distinct from v_ed.version then
            return false;
        end if;

        if app.try_cast_timestamptz(v_snapshot->>'resolved_at') is null then
            return false;
        end if;

        if v_grant_id is null then
            if (v_snapshot->>'sharing_grant_id') is not null then
                return false;
            end if;
        else
            if app.try_cast_uuid(v_snapshot->>'sharing_grant_id') is distinct from v_grant_id then
                return false;
            end if;
        end if;

        if jsonb_typeof(v_snapshot->'evidence_file_ids') is distinct from 'array' then
            return false;
        end if;

        select coalesce(array_agg(x order by x), array[]::text[])
        into v_snapshot_evidence
        from jsonb_array_elements_text(v_snapshot->'evidence_file_ids') as x;

        select coalesce(array_agg(x order by x), array[]::text[])
        into v_real_evidence
        from unnest(v_ed.evidence_file_ids) as x;

        if v_snapshot_evidence is distinct from v_real_evidence then
            return false;
        end if;

        return (
            v_ed.emission_unit is not distinct from (v_snapshot->>'emission_unit')
            and v_ed.direct_specific is not distinct from (v_snapshot->'values'->>'direct_specific')
            and v_ed.indirect_specific is not distinct from (v_snapshot->'values'->>'indirect_specific')
            and v_ed.verifier_user_id is not distinct from app.try_cast_uuid(v_snapshot->'verification'->>'verifier_user_id')
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

    if (v_resolution->'country_mapping'->>'status') = 'MAPPED'
        and coalesce(length(v_resolution->'country_mapping'->>'regulatory_country_name'), 0) = 0
    then
        return false;
    end if;

    v_reason := v_resolution->>'reason';

    if v_reason is null
        or not (
            v_reason = any (
                array[
                    'EXACT_TARIC_MATCH', 'EXACT_CN8_MATCH', 'EXACT_HS6_MATCH', 'EXACT_HS4_MATCH',
                    'OTHER_COUNTRIES_FALLBACK'
                ]
            )
        )
    then
        return false;
    end if;

    if jsonb_array_length(v_resolution->'trace') = 0 then
        return false;
    end if;

    if exists (
        select 1
        from jsonb_array_elements(v_resolution->'trace') as entry
        where jsonb_typeof(entry) is distinct from 'object'
    ) then
        return false;
    end if;

    if app.try_cast_timestamptz(v_resolution->>'resolved_at') is null then
        return false;
    end if;

    v_dataset_id := app.try_cast_uuid(v_resolution->>'dataset_id');
    v_dataset_version := v_resolution->>'dataset_version';
    v_source_sheet := v_resolution->'record_identity'->>'source_sheet';

    if (v_resolution->'record_identity'->>'source_row') !~ '^[0-9]+$' then
        return false;
    end if;

    v_source_row := app.try_cast_int(v_resolution->'record_identity'->>'source_row');
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

    if v_origin_country_name is distinct from (v_resolution->'country_mapping'->>'regulatory_country_name') then
        return false;
    end if;

    if not app.code_prefix_covers(v_source_trade_code, p_cn_code) then
        return false;
    end if;

    if v_origin_country_name = '_Other Countries and Territorie' then
        if v_reason is distinct from 'OTHER_COUNTRIES_FALLBACK' then
            return false;
        end if;
    else
        if v_reason = 'OTHER_COUNTRIES_FALLBACK' then
            return false;
        end if;

        select c.name
        into v_mapped_country_name
        from public.countries c
        where c.iso2 = p_origin_country;

        if v_mapped_country_name is distinct from v_origin_country_name then
            return false;
        end if;
    end if;

    -- New in this iteration: the claimed production route must be the
    -- SAME route the calling line itself declares -- a real,
    -- genuinely-matching route-specific record must never back a line
    -- that never declared using that route (or a different one).
    if v_source_route_code is distinct from p_production_route_indicator then
        return false;
    end if;

    select exists (
        select 1
        from public.regulatory_datasets rd
        where rd.id = v_dataset_id
          and rd.dataset_type = 'DEFAULT_EMISSION_VALUES'
          and rd.version = v_dataset_version
          and rd.status = 'ACTIVE'
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
        v_record.emission_unit is not distinct from (v_resolution->>'emission_unit')
        and v_record.direct_status is not distinct from (v_resolution->'values'->'direct'->>'status')
        and v_record.direct_value is not distinct from app.try_cast_numeric(v_resolution->'values'->'direct'->>'value')
        and v_record.indirect_status is not distinct from (v_resolution->'values'->'indirect'->>'status')
        and v_record.indirect_value is not distinct from app.try_cast_numeric(v_resolution->'values'->'indirect'->>'value')
        and v_record.total_status is not distinct from (v_resolution->'values'->'total'->>'status')
        and v_record.total_value is not distinct from app.try_cast_numeric(v_resolution->'values'->'total'->>'value')
    );
end;
$$;

comment on function app.emission_determination_matches_regulatory_record(jsonb, uuid, text, text, text) is
    '2026-08-30 (P13 review iteration 6): adds p_production_route_indicator '
    'and requires it match the DEFAULT branch''s claimed '
    'record_identity.source_production_route_code -- self-discovered '
    'and independently live-reproduced while re-reviewing '
    '20260829600000''s own cn_code/origin_country binding fix (finding '
    'F1): a real, genuinely-matching route-specific record was '
    'otherwise acceptable on a line that never declared using that '
    'route at all, the same forgery shape as F1 for a different field.';

revoke all on function app.emission_determination_matches_regulatory_record(jsonb, uuid, text, text, text) from public;
grant execute on function app.emission_determination_matches_regulatory_record(jsonb, uuid, text, text, text) to authenticated;


-- ------------------------------------------------------------
-- app.validate_emission_determination_write() -- pass the 5th
-- parameter through.
-- ------------------------------------------------------------

create or replace function app.validate_emission_determination_write()
returns trigger
language plpgsql
as $$
begin
    if auth.uid() is null then
        return new;
    end if;

    if TG_OP = 'UPDATE'
        and new.emission_determination is not distinct from old.emission_determination
        and (
            new.cn_code is distinct from old.cn_code
            or new.origin_country is distinct from old.origin_country
            or new.net_mass_tonnes is distinct from old.net_mass_tonnes
            or new.quantity_mwh is distinct from old.quantity_mwh
            or new.production_route_indicator is distinct from old.production_route_indicator
        )
    then
        new.emission_determination := null;
    end if;

    if TG_OP = 'UPDATE' and new.emission_determination is not distinct from old.emission_determination then
        return new;
    end if;

    if not coalesce(
        app.emission_determination_matches_regulatory_record(
            new.emission_determination,
            new.org_id,
            new.cn_code,
            new.origin_country,
            new.production_route_indicator
        ),
        false
    ) then
        raise exception
            'shipment_lines: emission_determination failed validation for line %', new.id
            using errcode = '42501';
    end if;

    return new;
end;
$$;

comment on function app.validate_emission_determination_write() is
    '2026-08-30 (P13 review iteration 6): passes production_route_indicator '
    'through to the validator function too (see that function''s own '
    'comment) -- otherwise unchanged from 20260829600000.';
