-- ============================================================
-- Snowkap CBAM
-- P13 final adversarial security review, ITERATION 8 -- the most
-- consequential defect this review found, because it under-reports
-- emissions rather than merely leaking or breaking something.
--
-- FINDING (HIGH, independently reproduced before fixing): the validator
-- never checks that the requested country's OWN default is actually
-- unusable before accepting an `OTHER_COUNTRIES_FALLBACK` claim. R7
-- clause 2 / R9 permit the Other Countries and Territories value ONLY
-- when the listed country's own field is blank/"-" (UNAVAILABLE). The
-- validator enforced the *shape* of a fallback claim but never its
-- *precondition*.
--
-- Live reproduction against local Postgres, in a real
-- `begin; ... rollback;` transaction (China's own value is AVAILABLE):
--
--   country: China (CN), code 2804 10 00
--   China's own default_emission_values total : 26.640  AVAILABLE
--   Other Countries and Territories total     : 17.740  AVAILABLE
--
--   app.emission_determination_matches_regulatory_record(
--     <determination claiming reason=OTHER_COUNTRIES_FALLBACK with the
--      17.740 Other-Countries record>, org, '28041000', 'CN', null)
--   -> t   (ACCEPTED)
--
-- Net effect: any ordinary member of an importer org could persist a
-- determination understating that line's specific embedded emissions by
-- 33% (17.740 vs 26.640), while every downstream surface -- the "Why
-- this number?" panel, the period report, the CSV/XLSX export and the
-- filed declaration snapshot -- would present it as a genuine,
-- validator-approved regulatory figure. It is not a tenant-isolation
-- break; it is a regulatory-integrity break, which for a CBAM product is
-- worse.
--
-- REACHABLE ON BOTH FALLBACK PATHS, not just v7's new one:
--   * v7's MAPPED + OTHER_COUNTRIES_FALLBACK branch (added 20260831...v7)
--   * the pre-existing branch inherited from v5/v6, where
--     record_identity.origin_country_name = '_Other Countries and
--     Territorie' and `p_origin_country` is never consulted at all.
-- So this was live before v7 too. Fixed once, for both, below.
--
-- THE FIX: whenever a determination claims `OTHER_COUNTRIES_FALLBACK`,
-- require that the requested country has NO usable (AVAILABLE) total for
-- the same code and the same production route. That is exactly R7 clause
-- 2's precondition, enforced instead of assumed.
--
-- Deliberately expressed as "no AVAILABLE own-country candidate exists"
-- rather than "the own-country record is UNAVAILABLE": a country may
-- legitimately have no row at all for a code (the R7 clause 1 unlisted
-- case), and that must keep working. Both the genuinely-unlisted case
-- and the listed-but-blank case pass; only the listed-AND-usable case is
-- now rejected.
-- ============================================================

create or replace function app.emission_determination_matches_regulatory_record(
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
    v_own_country_has_usable boolean;
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

        select ed.* into v_ed from public.emission_data ed where ed.id = v_emission_data_id;

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
            select sg.id into v_grant_id
            from public.sharing_grants sg
            where sg.installation_id = v_ed.installation_id
              and sg.grantee_org_id = p_org_id
              and sg.status = 'ACTIVE'
              and (sg.expires_at is null or sg.expires_at > now());

            if v_grant_id is null then
                return false;
            end if;
        end if;

        select bool_or(app.code_prefix_covers(scope_entry, p_cn_code))
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
        or not (v_reason = any (array[
            'EXACT_TARIC_MATCH', 'EXACT_CN8_MATCH', 'EXACT_HS6_MATCH', 'EXACT_HS4_MATCH',
            'OTHER_COUNTRIES_FALLBACK'
        ]))
    then
        return false;
    end if;

    if jsonb_array_length(v_resolution->'trace') = 0 then
        return false;
    end if;

    if exists (
        select 1 from jsonb_array_elements(v_resolution->'trace') as entry
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

    if v_dataset_id is null or v_dataset_version is null or v_source_sheet is null
        or v_source_row is null or v_source_trade_code is null or v_origin_country_name is null
    then
        return false;
    end if;

    if not app.code_prefix_covers(v_source_trade_code, p_cn_code) then
        return false;
    end if;

    -- ------------------------------------------------------------
    -- NEW IN v8 -- the R7 clause 2 PRECONDITION, previously assumed.
    --
    -- A fallback claim is only legitimate when the requested country has
    -- no usable value of its own for this code and route. Without this,
    -- an importer could claim the (often lower) Other-Countries default
    -- while their own country's default was perfectly AVAILABLE --
    -- live-reproduced as a 33% understatement for China / 2804 10 00.
    --
    -- Applies to BOTH fallback shapes (MAPPED and UNLISTED), because the
    -- pre-v7 branch never consulted p_origin_country either.
    -- ------------------------------------------------------------
    if v_reason = 'OTHER_COUNTRIES_FALLBACK' then
        select exists (
            select 1
            from public.default_emission_values dev
            join public.countries c
                on c.id = dev.country_id
            left join public.production_routes pr
                on pr.id = dev.production_route_id
            where dev.dataset_id = v_dataset_id
              and c.iso2 = p_origin_country
              and c.name <> '_Other Countries and Territorie'
              and app.code_prefix_covers(dev.source_trade_code, p_cn_code)
              and pr.source_route_indicator is not distinct from p_production_route_indicator
              and dev.total_status = 'AVAILABLE'
        ) into v_own_country_has_usable;

        if coalesce(v_own_country_has_usable, false) then
            return false;
        end if;
    end if;

    if (v_resolution->'country_mapping'->>'status') = 'MAPPED'
        and v_reason = 'OTHER_COUNTRIES_FALLBACK'
    then
        select c.name into v_mapped_country_name
        from public.countries c where c.iso2 = p_origin_country;

        if v_mapped_country_name is distinct from (v_resolution->'country_mapping'->>'regulatory_country_name') then
            return false;
        end if;

        if v_origin_country_name is distinct from '_Other Countries and Territorie' then
            return false;
        end if;
    else
        if v_origin_country_name is distinct from (v_resolution->'country_mapping'->>'regulatory_country_name') then
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

            select c.name into v_mapped_country_name
            from public.countries c where c.iso2 = p_origin_country;

            if v_mapped_country_name is distinct from v_origin_country_name then
                return false;
            end if;
        end if;
    end if;

    if v_source_route_code is distinct from p_production_route_indicator then
        return false;
    end if;

    select exists (
        select 1 from public.regulatory_datasets rd
        where rd.id = v_dataset_id
          and rd.dataset_type = 'DEFAULT_EMISSION_VALUES'
          and rd.version = v_dataset_version
          and rd.status = 'ACTIVE'
    ) into v_dataset_exists;

    if not v_dataset_exists then
        return false;
    end if;

    select count(*) into v_match_count
    from public.default_emission_values dev
    join public.countries c on c.id = dev.country_id
    left join public.production_routes pr on pr.id = dev.production_route_id
    where dev.dataset_id = v_dataset_id
      and dev.source_sheet = v_source_sheet
      and dev.source_row = v_source_row
      and dev.source_trade_code = v_source_trade_code
      and c.name = v_origin_country_name
      and pr.source_route_indicator is not distinct from v_source_route_code;

    if v_match_count is distinct from 1 then
        return false;
    end if;

    select dev.* into v_record
    from public.default_emission_values dev
    join public.countries c on c.id = dev.country_id
    left join public.production_routes pr on pr.id = dev.production_route_id
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
    '2026-08-31 (P13 final adversarial review, iteration 8): enforces R7 '
    'clause 2''s PRECONDITION -- an OTHER_COUNTRIES_FALLBACK claim is now '
    'rejected when the requested country has a usable (AVAILABLE) value of '
    'its own for the same code and route. Previously the validator checked '
    'the shape of a fallback claim but never whether a fallback was '
    'permitted at all, so an importer could claim the lower '
    'Other-Countries default while their own country''s default was '
    'AVAILABLE -- live-reproduced as a 33% understatement for China / '
    '2804 10 00 (17.740 claimed vs 26.640 real). Reachable on BOTH the '
    'MAPPED (v7) and UNLISTED (v5/v6) fallback paths; fixed once for both.';
