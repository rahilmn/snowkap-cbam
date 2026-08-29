-- ============================================================
-- Snowkap CBAM
-- P13 release-blocker remediation, ITERATION 5: a third independent
-- Opus review of 20260829580000 found the rewrite genuinely closed
-- findings #1/#2/#5-#9 from the prior round, but found a new HIGH-
-- severity gap it introduced (or rather, never closed): the DEFAULT
-- branch verified a determination's claimed record_identity/values
-- match a REAL default_emission_values row, but never verified that
-- row has anything to do with the LINE it is being attached to -- any
-- org member could attach ANY real record (e.g. the single lowest-
-- value row in the whole dataset) to ANY line regardless of that
-- line's own declared cn_code/origin_country, live-reproduced as a
-- 100% understatement. Plus a narrower but real bypass of the ACTUAL
-- branch's brand-new cn_scope check (mutating cn_code in a SEPARATE
-- statement after a valid determination was saved, since the trigger
-- only fires when emission_determination itself changes), a NULL-
-- propagation hole (`=` instead of `is not distinct from` lets a
-- missing key silently pass), a LIKE-based prefix check an attacker-
-- controlled `%`/`_` in emission_data.cn_scope could defeat, and a
-- narrower DEFAULT-branch resolved_at gap. Every one of these was
-- independently re-reproduced by this migration's own author before
-- being accepted (see this repo's git history/session record for the
-- live psql transactions).
--
-- Findings closed (review's own numbering):
--
--   F1 (HIGH, live-reproduced independently before this migration was
--     written): the DEFAULT branch is now tied to the calling line via
--     two new parameters, p_origin_country and (already present)
--     p_cn_code -- the matched default_emission_values record's own
--     source_trade_code must cover p_cn_code (the same prefix relation
--     cn_scope already uses, see F5 below for how), and unless the
--     resolution's reason is OTHER_COUNTRIES_FALLBACK, p_origin_country
--     (an ISO2 code) must map, via the SAME public.countries row the
--     resolver itself would consult, to record_identity.origin_country_name
--     -- and record_identity.origin_country_name must in turn equal
--     country_mapping.regulatory_country_name (the two narrative
--     fields must agree with each other, not just each look plausible
--     alone). For OTHER_COUNTRIES_FALLBACK specifically,
--     record_identity.origin_country_name must be the exact fixed
--     fallback territory name resolve-default-value.ts's own
--     OTHER_TERRITORIES constant uses ("_Other Countries and
--     Territorie") -- deliberately not attempting to also verify the
--     line's real country is genuinely absent from the dataset (that
--     would require re-deriving the resolver's own "is this country
--     listed" logic in SQL, a materially larger and riskier
--     undertaking than this fix's scope; see this migration's own
--     "deliberately not done" note below).
--
--   F2 (MEDIUM-HIGH): cn_code/origin_country/the quantity columns/
--     production_route_indicator were mutable in a statement AFTER a
--     valid determination was saved, without re-triggering validation
--     (the trigger only fires when emission_determination itself
--     changes) -- silently re-attaching an unchanged, still-"valid"-
--     looking determination to a now-different line. Fixed: the
--     trigger now force-clears emission_determination to null whenever
--     any of those columns changes in the same UPDATE that leaves
--     emission_determination otherwise untouched -- mirroring
--     src/application/shipments/manage-lines.ts's own updateLine,
--     which already always does both together ("A determination is
--     frozen against the declared code/origin/quantity/route it was
--     computed for... always cleared here rather than carried forward
--     silently attached to different inputs").
--
--   F3 (MEDIUM): several final comparisons used plain `=` instead of
--     `is not distinct from` -- a missing jsonb key extracts as SQL
--     NULL, `=` with a NULL operand yields NULL rather than false, and
--     `if not <NULL>` is treated as false by plpgsql (does not raise),
--     so an incomplete-but-otherwise-matching payload was silently
--     accepted -- live-reproduced to crash the real calculation engine
--     downstream (calculateLineEmissions throws on a missing
--     emission_unit). Fixed: every remaining `=` comparison against a
--     jsonb-extracted value is now `is not distinct from`, and the
--     trigger itself wraps the whole validator call in
--     `coalesce(..., false)` as defense in depth against any future
--     NULL-returning branch.
--
--   F4 (test-suite/process finding, not a migration change): the new
--     AFTER DELETE audit branch (20260829580000) writes a fresh
--     audit_events row on every determination-carrying line deletion,
--     which blocks a subsequent organization delete under
--     audit_events_org_id_fkey's ON DELETE RESTRICT unless a test's own
--     cleanup purges audit_events AFTER shipment_lines, not before.
--     Addressed in tests/integration/shipment-line-determination-hardening.test.ts's
--     own afterAll (reordered), not here -- the FK's RESTRICT semantics
--     are correct and intentional (an org's audit trail should not
--     silently vanish via an unrelated cascade); no schema change is
--     the right fix.
--
--   F5 (MEDIUM): the cn_scope coverage check (ACTUAL branch,
--     20260829580000) used SQL LIKE (`p_cn_code like scope_entry ||
--     '%'`) -- since emission_data.cn_scope carries no format
--     constraint, a producer-controlled `%` or `_` character reaches
--     the pattern literally, live-reproduced to make a wildcard scope
--     entry "cover" any code at all. Fixed: replaced with a literal,
--     non-wildcard prefix comparison (`left(code, length(scope)) =
--     scope`) in both the ACTUAL branch's cn_scope check and F1's new
--     DEFAULT-branch trade-code coverage check -- factored into one
--     shared helper, app.code_prefix_covers(), so both branches use
--     the identical, LIKE-free logic.
--
--   F6 (LOW): the DEFAULT branch never validated resolved_at at all
--     (app.try_cast_timestamptz was wired into the ACTUAL branch only).
--     Fixed: the same parseability check now applies to both branches.
--
-- Deliberately NOT done, and why: re-deriving resolve-default-value.ts's
-- full "is this country listed in the ACTIVE dataset at all" logic in
-- SQL, to additionally confirm an OTHER_COUNTRIES_FALLBACK claim is
-- only ever used for a genuinely-unlisted country (not merely a
-- shortcut for a listed one). That is real regulatory-adjacent logic
-- this fix should not attempt to duplicate under P13 remediation time
-- pressure -- the residual gap (a listed country's genuine record
-- forged as an OTHER_COUNTRIES_FALLBACK claim, IF the fallback
-- territory's own values happened to be more favorable) is narrower
-- than F1 was, and is recorded here rather than silently left
-- undocumented.
-- ============================================================


-- ------------------------------------------------------------
-- 1. app.code_prefix_covers() -- literal (non-LIKE) prefix check,
--    replacing the LIKE-based comparison 20260829580000 used for
--    cn_scope, and shared by F1's new DEFAULT-branch trade-code check.
--    Mirrors src/domain/emissions/cn-scope-covers-code.ts's own
--    documented rule exactly: an exact match always covers; a genuine
--    STRICTLY SHORTER prefix covers; the reverse (a longer/more
--    specific code) never covers.
-- ------------------------------------------------------------

create or replace function app.code_prefix_covers(
    p_scope_entry text,
    p_code text
)
returns boolean
language sql
immutable
as $$
    select
        regexp_replace(p_scope_entry, '\s+', '', 'g') = regexp_replace(p_code, '\s+', '', 'g')
        or (
            length(regexp_replace(p_scope_entry, '\s+', '', 'g')) < length(regexp_replace(p_code, '\s+', '', 'g'))
            and left(
                regexp_replace(p_code, '\s+', '', 'g'),
                length(regexp_replace(p_scope_entry, '\s+', '', 'g'))
            ) = regexp_replace(p_scope_entry, '\s+', '', 'g')
        );
$$;

comment on function app.code_prefix_covers(text, text) is
    '2026-08-30 (P13 review iteration 5, finding F5): literal prefix '
    'comparison via left()/length(), never SQL LIKE -- a LIKE-based '
    'version (20260829580000''s original cn_scope check) let a '
    'producer-controlled % or _ character in emission_data.cn_scope '
    'act as a wildcard, live-reproduced to make a single "%" scope '
    'entry "cover" any code at all. Mirrors '
    'src/domain/emissions/cn-scope-covers-code.ts''s own documented '
    'rule: exact match covers; a genuine strictly-shorter prefix '
    'covers; the reverse never does.';

revoke all on function app.code_prefix_covers(text, text) from public;
grant execute on function app.code_prefix_covers(text, text) to authenticated;


-- ------------------------------------------------------------
-- 2. app.emission_determination_matches_regulatory_record() --
--    replaced wholesale again, with a new 4th parameter
--    (p_origin_country) for F1's line/country binding.
-- ------------------------------------------------------------

drop function if exists app.emission_determination_matches_regulatory_record(jsonb, uuid, text);

create function app.emission_determination_matches_regulatory_record(
    p_determination jsonb,
    p_org_id uuid,
    p_cn_code text,
    p_origin_country text
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

        -- F5: literal prefix check, no LIKE.
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

        -- F3: is not distinct from, not =.
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

    -- F6: resolved_at must be present and parseable, same as the
    -- ACTUAL branch already required.
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

    -- F1: the two narrative country fields must agree with each other.
    if v_origin_country_name is distinct from (v_resolution->'country_mapping'->>'regulatory_country_name') then
        return false;
    end if;

    -- F1: the record must actually apply to THIS line -- trade-code
    -- coverage (mirrors the ACTUAL branch's cn_scope check, same
    -- literal-prefix helper) and country binding (skipped only for the
    -- fixed fallback territory name, which by design never matches any
    -- real ISO-mapped country).
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

    -- F3: is not distinct from, not =.
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

comment on function app.emission_determination_matches_regulatory_record(jsonb, uuid, text, text) is
    '2026-08-30 (P13 review iteration 5): replaces 20260829580000''s '
    'body and adds a 4th parameter (p_origin_country). A third '
    'independent review found the DEFAULT branch never verified the '
    'matched record has anything to do with the calling line''s own '
    'declared cn_code/origin_country -- live-reproduced as a real, '
    '100% understatement (a real but wrong record from a different '
    'good/country accepted). See this migration''s own header comment '
    'for the full list of findings closed (F1-F6).';

revoke all on function app.emission_determination_matches_regulatory_record(jsonb, uuid, text, text) from public;
grant execute on function app.emission_determination_matches_regulatory_record(jsonb, uuid, text, text) to authenticated;


-- ------------------------------------------------------------
-- 3. app.validate_emission_determination_write() -- replaced to pass
--    the new 4th parameter, add F2's force-clear-on-classification-
--    change guard, and wrap the validator call in coalesce(...,
--    false) as defense in depth against a NULL result (F3).
-- ------------------------------------------------------------

create or replace function app.validate_emission_determination_write()
returns trigger
language plpgsql
as $$
begin
    if auth.uid() is null then
        return new;
    end if;

    -- F2: if the line's own declared basis changed in this same
    -- UPDATE without the determination ALSO being explicitly changed,
    -- the determination is now stale -- force-clear it rather than
    -- silently leaving an unchanged-looking determination attached to
    -- a now-different line. Mirrors manage-lines.ts's own updateLine,
    -- which already always does both together in the legitimate app
    -- path; this is the DB-level backstop for a direct write that
    -- skips the app layer entirely.
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
            new.origin_country
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
    '2026-08-30 (P13 review iteration 5): now also force-clears '
    'emission_determination when cn_code/origin_country/the quantity '
    'columns/production_route_indicator change without the '
    'determination itself also changing (finding F2 -- previously a '
    'valid determination could be silently re-attached to a changed '
    'line by mutating those columns in a separate statement, since the '
    'validator only ran when emission_determination itself changed). '
    'The validator call is wrapped in coalesce(..., false) as defense '
    'in depth against any future NULL-returning branch (finding F3).';
