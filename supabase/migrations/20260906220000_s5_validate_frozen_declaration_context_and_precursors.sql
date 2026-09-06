-- ============================================================
-- Snowkap CBAM
-- S5 (2026-09-06), cross-phase hardening: app.emission_determination_
-- matches_regulatory_record validates every field an ACTUAL snapshot
-- carries -- installation_id, methodology, verification.status/
-- verifier_user_id, evidence_file_ids (set-equality), record_provenance
-- (20260903120000), dataset_reporting_period (20260904130000),
-- emission_data_version, emission_unit, values.direct_specific/
-- indirect_specific -- EXCEPT declaration_context and precursors, the
-- two fields S4 (20260906180000) added and determine-from-actual-
-- data.ts (lines ~620-698) has frozen into every new ACTUAL
-- determination ever since, unchecked.
--
-- LIVE-REPRODUCED (S5 adversarial audit, real BEGIN...ROLLBACK, as the
-- real importer session under full RLS, not a service-role bypass): a
-- producer org's real emission_data_declaration_context row had
-- verifier_report_declared=false. The importer holding an ACTIVE
-- sharing grant for that record -- an ordinary write RLS already
-- legitimately permits on their OWN shipment_lines row -- issued a
-- direct UPDATE whose snapshot satisfied every OTHER check this
-- function already makes, but carried declaration_context.verifier_
-- report_declared=true and a fabricated verifier_report_description
-- ("FORGED: TUV Rheinland accredited verifier report 2026"). ACCEPTED
-- and persisted. A negative control in the same session (an invalid
-- dataset_reporting_period) confirmed the validator is genuinely live
-- and wired to this exact session, not silently bypassed for some
-- unrelated reason -- isolating the gap to precisely these two fields.
--
-- Nothing today renders the forged claim to a real user (the Buyer
-- view's own ProvenanceCard reads emission_data_declaration_context
-- LIVE via getDeclarationContextById, a separate, unaffected path) --
-- but the frozen snapshot is, by this type's own documented design
-- (src/domain/emissions/types.ts), a PERMANENT historical fact never
-- re-validated against the live source again, and it is already
-- frozen into every importer's own regulatory determination/audit
-- trail (determine-from-actual-data.ts). This is exactly the same
-- forgery class this function's own record_provenance/dataset_
-- reporting_period checks (and, one layer up, the whole P13 ten-round
-- shipment_line-determination-forgery-fix series) treated as
-- release-blocking on discovery, every time, regardless of whether a
-- renderer for the specific field existed yet -- an unrevalidatable
-- forged fact sitting in the data model is the defect, not merely
-- whatever currently happens to read it.
--
-- FIX. Two new checks inserted beside the existing dataset_reporting_
-- period block, in the ACTUAL branch only -- the DEFAULT branch (every
-- check against default_emission_values/regulatory_datasets, the
-- protected regulatory data itself) is untouched, verbatim, byte for
-- byte. Same shape as every sibling check in this function: presence
-- is REQUIRED for new writes (a snapshot missing either key is
-- refused, matching record_provenance/dataset_reporting_period's own
-- "presence required" posture), and the snapshot's own frozen value
-- must equal what the SAME live source (emission_data_declaration_
-- context / emission_data_precursors, keyed by the same emission_
-- data_id already resolved above) currently holds at write time --
-- exactly the "checked here rather than trusted from the writer"
-- reasoning dataset_reporting_period's own header comment states for
-- itself. Determinations frozen before either field existed are
-- unaffected, because this trigger never revalidates a row it is not
-- rewriting.
--
-- jsonb object/array equality is order-insensitive on object keys
-- (this function's own established idiom -- see p_determination's own
-- top-level comparison elsewhere in this codebase) but IS
-- order-sensitive for arrays, so the real precursor rows are
-- aggregated in the exact same `created_at asc` order
-- listPrecursors/listPrecursorsById themselves query in
-- (manage-precursors.ts), matching what determine-from-actual-data.ts
-- actually freezes.
--
-- pnpm regulatory:verify: NOT applicable -- this migration touches
-- only the ACTUAL branch of this validator; the DEFAULT branch (the
-- only part of this function that reads the protected regulatory
-- dataset) is unmodified, verbatim.
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
    v_installation_provenance text;
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
    v_usable_candidates integer;
    v_real_declaration_context jsonb;
    v_real_precursors jsonb;
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

        select i.provenance
        into v_installation_provenance
        from public.installations i
        where i.id = v_ed.installation_id;

        if v_installation_provenance is null then
            return false;
        end if;

        if (v_snapshot->>'record_provenance') is distinct from v_installation_provenance then
            return false;
        end if;

        if (v_snapshot->'dataset_reporting_period'->>'kind')
            is distinct from v_ed.reporting_period_kind
        then
            return false;
        end if;

        if app.try_cast_int(v_snapshot->'dataset_reporting_period'->>'year')
            is distinct from v_ed.reporting_period_year
        then
            return false;
        end if;

        if app.try_cast_int(v_snapshot->'dataset_reporting_period'->>'quarter')
            is distinct from v_ed.reporting_period_quarter
        then
            return false;
        end if;

        -- ------------------------------------------------------------
        -- 2026-09-06 (S5). declaration_context and precursors are
        -- frozen the same way record_provenance/dataset_reporting_
        -- period are (determine-from-actual-data.ts), so they are
        -- checked here rather than trusted from the writer, for
        -- exactly the same reason: an unchecked frozen field is a
        -- decorative one, and a member posting raw PostgREST could
        -- freeze a fabricated verifier-report declaration or precursor
        -- list, attributed to the producer, onto their own line.
        --
        -- Presence is REQUIRED for new writes -- a snapshot missing
        -- either key is refused, matching record_provenance/dataset_
        -- reporting_period's own posture. Determinations frozen before
        -- S4 added these fields are unaffected, because this trigger
        -- never revalidates a row it is not rewriting.
        -- ------------------------------------------------------------
        if jsonb_typeof(v_snapshot->'declaration_context') is null then
            return false;
        end if;

        select jsonb_build_object(
            'production_process_description', dc.production_process_description,
            'uses_purchased_precursors', dc.uses_purchased_precursors,
            'verifier_report_declared', dc.verifier_report_declared,
            'verifier_report_description', dc.verifier_report_description
        )
        into v_real_declaration_context
        from public.emission_data_declaration_context dc
        where dc.emission_data_id = v_emission_data_id;

        if v_real_declaration_context is null then
            -- No real context row exists -- the snapshot's own claim
            -- must be a genuine JSON null, not a fabricated object.
            if jsonb_typeof(v_snapshot->'declaration_context') is distinct from 'null' then
                return false;
            end if;
        elsif (v_snapshot->'declaration_context') is distinct from v_real_declaration_context then
            return false;
        end if;

        if jsonb_typeof(v_snapshot->'precursors') is distinct from 'array' then
            return false;
        end if;

        select coalesce(
            jsonb_agg(
                jsonb_build_object(
                    'material_description', p.material_description,
                    'cn_code', p.cn_code,
                    'source_description', p.source_description,
                    'direct_specific', p.direct_specific,
                    'indirect_specific', p.indirect_specific,
                    'emission_unit', p.emission_unit,
                    'provenance', p.provenance,
                    'verifier_report_description', p.verifier_report_description
                )
                order by p.created_at asc
            ),
            '[]'::jsonb
        )
        into v_real_precursors
        from public.emission_data_precursors p
        where p.emission_data_id = v_emission_data_id;

        if (v_snapshot->'precursors') is distinct from v_real_precursors then
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

    -- ------------------------------------------------------------
    -- DEFAULT branch below is UNCHANGED, verbatim, from
    -- 20260904130000 -- the only part of this function that reads
    -- the protected regulatory dataset (default_emission_values,
    -- regulatory_datasets). Nothing in this migration touches it.
    -- ------------------------------------------------------------

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
              and (
                  p_production_route_indicator is null
                  or pr.source_route_indicator is null
                  or pr.source_route_indicator = p_production_route_indicator
              )
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
    elsif (v_resolution->'country_mapping'->>'status') = 'UNLISTED' then
        if exists (
            select 1 from public.countries c where c.iso2 = p_origin_country
        ) then
            return false;
        end if;

        if v_origin_country_name is distinct from '_Other Countries and Territorie' then
            return false;
        end if;

        if v_reason is distinct from 'OTHER_COUNTRIES_FALLBACK' then
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

    if p_production_route_indicator is not null
       and v_source_route_code is not null
       and v_source_route_code is distinct from p_production_route_indicator
    then
        return false;
    end if;

    select count(*) into v_usable_candidates
    from public.default_emission_values dev2
    join public.countries c2 on c2.id = dev2.country_id
    left join public.production_routes pr2 on pr2.id = dev2.production_route_id
    where dev2.dataset_id = v_dataset_id
      and c2.name = v_origin_country_name
      and dev2.source_trade_code = v_source_trade_code
      and dev2.total_status = 'AVAILABLE'
      and dev2.total_value is not null
      and (
          p_production_route_indicator is null
          or pr2.source_route_indicator is null
          or pr2.source_route_indicator = p_production_route_indicator
      );

    if v_usable_candidates is distinct from 1 then
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

comment on function app.emission_determination_matches_regulatory_record(
    jsonb, uuid, text, text, text
) is
    '2026-09-04 (owner decision 7), widened 2026-09-06 (S5). Validates '
    'a shipment_lines.emission_determination write against the live '
    'source it claims to be frozen from. ACTUAL branch now also '
    'validates declaration_context and precursors against the live '
    'emission_data_declaration_context/emission_data_precursors rows '
    '(same "presence required, must equal the live source" posture as '
    'record_provenance/dataset_reporting_period) -- closes a forgery '
    'gap where an importer could freeze a fabricated verifier-report '
    'claim or precursor list onto their own determination, live-'
    'reproduced by the S5 adversarial audit. DEFAULT branch (the only '
    'part reading the protected regulatory dataset) is unchanged.';
