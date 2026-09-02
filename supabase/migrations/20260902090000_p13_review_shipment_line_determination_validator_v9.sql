-- ============================================================
-- Snowkap CBAM
-- Determination-forgery validator, iteration 9.
--
-- Fixes TWO defects in which the validator REJECTED determinations the
-- protected resolver legitimately produces. Both were live-reproduced
-- against real Postgres with a positive control and single-variable
-- isolation, inside rolled-back transactions. Neither is a data-integrity
-- incident: both fail CLOSED, and production held zero rows in either
-- affected state.
--
-- The full analysis -- current behaviour, intended invariant, why
-- resolver and validator disagreed, the recommended rule, and the
-- security and regulatory consequences -- is in
-- docs/regulatory/DETERMINATION_VALIDATOR_SEMANTICS_DECISION_MEMO.md.
-- This header states only what changes and why it is safe.
--
-- ------------------------------------------------------------
-- B1 -- route binding was a proxy, and the proxy was incomplete.
--
-- v6 required the matched RECORD's route to equal the LINE's declared
-- route. The resolver's own rule (resolve-default-value.ts:487-504)
-- admits a route-specific record for a route-BLANK line when it is the
-- UNIQUE usable candidate, and returns AMBIGUOUS rather than choosing
-- when two remain (R10). So the two implementations of one rule
-- disagreed, and the validator won.
--
-- Scale, measured on the ACTIVE dataset:
--     6,487  (country, code) pairs whose ONLY usable record is
--            route-specific  -- resolver RESOLVES, validator REJECTED
--         0  pairs with more than one usable record
--     4,423  pairs whose only usable record is route-independent
--
-- Every aluminium row is in the first group. Users saw a FALSE
-- "This shipment is locked or void and can no longer be edited" on a
-- DRAFT shipment, because resolve-line-emissions.ts maps the trigger's
-- 42501 onto SHIPMENT_NOT_EDITABLE.
--
-- v6's own attack fixture is in that group too: Azerbaijan / 7207 12 90
-- has route '(E)' 0.130 AVAILABLE as its ONLY usable record (the
-- route-independent row is REFERENCE_REQUIRED). The importer in that
-- reproduction was receiving the only value the resolver could ever
-- produce for that line -- not forging one. v6 misclassified a
-- legitimate resolution as an attack; v7 and v8 inherited it.
--
-- Now enforces the invariant itself, in two parts: a declared route
-- still binds (v6's protection kept verbatim), AND the claimed record
-- must be the unique usable candidate under the line's declared route
-- filter. This is STRICTER than v6: it rejects any claim the resolver
-- would have called AMBIGUOUS, which v6's string comparison would have
-- ACCEPTED had the attacker also declared the matching route.
--
-- ------------------------------------------------------------
-- B2 -- UNLISTED was compared against a key it deliberately lacks.
--
-- CountryMappingOutcome is `| { status: "UNLISTED" }` with NO
-- regulatory_country_name, by design -- an unlisted origin has no
-- dataset geography to name, and inventing one would be inventing a
-- mapping. v5..v8 let UNLISTED fall into the MAPPED comparison, whose
-- right-hand side is therefore always SQL NULL; `X is distinct from
-- NULL` is always true, so EVERY UNLISTED determination was rejected and
-- R7 clause 1's persistence path has been dead since v5.
--
-- UNLISTED now has its own arm enforcing what is actually checkable:
-- the declared origin really is absent from the dataset (NEW -- this
-- stops a LISTED country claiming "unlisted" to sidestep its own
-- value), the matched record is the Other-Countries row, and the reason
-- is OTHER_COUNTRIES_FALLBACK.
--
-- KNOWN, UNRESOLVED, AND NOT DECIDED HERE: EU member states are absent
-- from the dataset's geographies, so they map to UNLISTED and resolve
-- through this same fallback -- and CBAM does not apply to EU-origin
-- goods at all. That gap is pre-existing and already escalated
-- (MASTER_PLAN.md §41; types.ts:40-50), but this migration does make
-- such determinations persistable again, where the B2 defect was
-- incidentally preventing them. Excluding EU origins here would require
-- a hardcoded country list -- exactly the invented regulatory scope
-- CLAUDE.md forbids; in-scope/out-of-scope must enter as a versioned
-- dataset. See the memo's §B.5. OWNER DECISION REQUIRED before real
-- declarant use.
--
-- Nothing in the protected zone changes. No regulatory value, route,
-- threshold, period or scope is invented anywhere in this migration.
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
    v_usable_candidates integer;
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
    elsif (v_resolution->'country_mapping'->>'status') = 'UNLISTED' then
        -- B2 (v9). UNLISTED carries no regulatory_country_name BY DESIGN
        -- (src/domain/emissions/types.ts: `| { status: "UNLISTED" }`),
        -- because there is no dataset geography to name. v5..v8 fell into
        -- the MAPPED comparison below and compared against that absent
        -- key, so the right-hand side was always SQL NULL and
        -- `X is distinct from NULL` was always true -- every UNLISTED
        -- determination was rejected, and R7 clause 1's entire
        -- persistence path has been dead since v5.
        --
        -- The checkable invariant for UNLISTED is not a name match (there
        -- is no name); it is:
        --   (a) the declared origin really is absent from the dataset --
        --       this is NEW, and stops a LISTED country claiming
        --       "unlisted" to sidestep its own value;
        --   (b) the matched record is the Other-Countries row; and
        --   (c) the reason is OTHER_COUNTRIES_FALLBACK.
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

    -- B1 (v9). v6 bound the matched RECORD's route to the LINE's declared
    -- route by string equality. That is a PROXY for the real invariant --
    -- "the determination must be one the resolver would actually have
    -- produced for this line's declared inputs" -- and the proxy is sound
    -- but INCOMPLETE: the resolver's own rule
    -- (resolve-default-value.ts:487-504) admits a route-specific record
    -- for a route-BLANK line, provided it is the UNIQUE usable candidate,
    -- and returns AMBIGUOUS rather than choosing when two remain.
    --
    -- Measured on the ACTIVE dataset: 6,487 (country, code) pairs have a
    -- single usable record that is route-specific -- including every
    -- aluminium row -- and ZERO pairs have more than one usable record.
    -- v6's own attack fixture (Azerbaijan / 7207 12 90) is one of the
    -- 6,487: route '(E)' 0.130 is the ONLY usable record, the
    -- route-independent one being REFERENCE_REQUIRED. The importer in
    -- that reproduction was receiving the only value the resolver could
    -- ever produce, not forging one.
    --
    -- Replaced with the invariant itself. This is STRICTER, not weaker:
    -- it additionally rejects any claim the resolver would have called
    -- AMBIGUOUS, which v6's string comparison would have ACCEPTED if the
    -- attacker also declared the matching route.
    --
    -- See docs/regulatory/DETERMINATION_VALIDATOR_SEMANTICS_DECISION_MEMO.md.

    -- (1) A declared route still binds: the record must be that route or
    --     route-independent. This retains v6's protection verbatim for
    --     every line that declares a route.
    if p_production_route_indicator is not null
       and v_source_route_code is not null
       and v_source_route_code is distinct from p_production_route_indicator
    then
        return false;
    end if;

    -- (2) Uniqueness -- the resolver's actual safeguard. The claimed
    --     record must be the only usable candidate at its own specificity
    --     level for this country, under the line's declared route filter.
    --     `AVAILABLE` mirrors isUsableTotalValue() exactly, and only
    --     RESOLVED results ever persist a determination
    --     (resolve-line-emissions.ts: buildResolutionSnapshot returns null
    --     otherwise), so this can never reject a legitimate row.
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

comment on function app.emission_determination_matches_regulatory_record(jsonb, uuid, text, text, text) is
    '2026-09-02 (v9): validates the resolved record against the line''s '
    'declared inputs by RE-DERIVING uniqueness, rather than '
    'string-comparing the production route as v6..v8 did. A declared '
    'route still binds; additionally the claimed record must be the '
    'unique usable candidate at its own specificity level for the '
    'country under the line''s route filter -- which is the resolver''s '
    'own safeguard (R10) and is stricter than v6, since it rejects '
    'claims the resolver would have called AMBIGUOUS. Also gives '
    'UNLISTED its own arm: it carries no regulatory_country_name by '
    'design, and v5..v8 compared against that absent key, rejecting '
    'every UNLISTED determination and leaving R7 clause 1''s '
    'persistence path dead. UNLISTED now requires the declared origin '
    'to be genuinely absent from the dataset (new), the matched record '
    'to be the Other-Countries row, and the reason to be '
    'OTHER_COUNTRIES_FALLBACK. See '
    'docs/regulatory/DETERMINATION_VALIDATOR_SEMANTICS_DECISION_MEMO.md.';
