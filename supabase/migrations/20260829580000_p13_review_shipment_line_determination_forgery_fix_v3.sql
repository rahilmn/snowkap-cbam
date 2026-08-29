-- ============================================================
-- Snowkap CBAM
-- P13 release-blocker remediation, ITERATION 4: a second independent
-- Opus review of 20260829530000/20260829540000 (this migration's own
-- predecessors, themselves already two corrections of the original
-- 20260829500000 fix) found the cross-tenant oracle 20260829540000
-- claimed to close was still live-reproducible, plus several more real
-- gaps. Every finding below was independently re-reproduced by this
-- migration's own author before being accepted (see this repo's git
-- history for the live psql transaction that reconfirmed finding #1
-- before this file was written).
--
-- Rather than patch the WITH-CHECK-based design a fourth time, this
-- migration changes the ARCHITECTURE, per the review's own suggested
-- shape: validation moves out of shipment_lines' INSERT/UPDATE WITH
-- CHECK and into a BEFORE INSERT OR UPDATE trigger that only runs when
-- emission_determination is actually changing (`new.emission_determination
-- is distinct from old.emission_determination`, always true on INSERT).
-- This is not merely a refactor -- it structurally eliminates an entire
-- class of bug this series kept discovering piecemeal: a WITH CHECK is
-- re-evaluated on EVERY UPDATE to a row, including edits that never
-- touch emission_determination, so any authorization fact the check
-- depended on (a sharing grant's live status, a dataset's ACTIVE flag)
-- could change AFTER a determination was validly saved and silently
-- brick every future unrelated edit to that line. Validating only on
-- an actual change means the authorization and content checks below
-- can finally be as strict as they should be -- current ACTIVE status,
-- a currently-ACTIVE unexpired grant -- without that tension.
--
-- Findings closed (review's own numbering):
--
--   #1 (HIGH, live-reproduced independently before this migration was
--     written): the "any status sharing_grants row" gate was strictly
--     WIDER than actual read visibility (emission_data_select_own_org
--     requires status='ACTIVE'+verification_status='VERIFIED' on the
--     row AND an ACTIVE unexpired grant) -- an org holding a merely
--     INVITED (never accepted) grant, or one whose grant had since been
--     REVOKED/EXPIRED, could still probe a DRAFT/SUPERSEDED/DISCARDED
--     row's private values via accept/reject outcomes. Fixed: the
--     ACTUAL branch's cross-org check now requires status='ACTIVE' AND
--     an ACTIVE, unexpired sharing_grants row -- exactly
--     app.user_shared_installation_ids()'s own criteria -- which the
--     architecture change above makes safe (no more retroactive-
--     breakage cost for demanding CURRENT authorization).
--
--   #2 (HIGH/MEDIUM): the ACTUAL branch validated five of
--     ActualEmissionSnapshot's eleven fields; methodology,
--     installation_id, emission_data_version, evidence_file_ids,
--     resolved_at, sharing_grant_id, and the snapshot's own claimed
--     verification.status were all unvalidated -- real values could be
--     paired with an invented narrative that
--     why-this-number-panel.tsx and summarize-determination-for-audit.ts
--     both render/persist verbatim. Fixed: every field is now
--     validated against the real emission_data row (or, for
--     sharing_grant_id, against the grant this same check used for
--     authorization).
--
--   #3 (MEDIUM): the DB check enforced none of the four gates
--     determine-from-actual-data.ts's application layer already does
--     (status='ACTIVE', non-empty evidence, cn_scope coverage). Fixed:
--     all three added, the last via a SQL mirror of
--     cnScopeCoversCnCode's own prefix-matching rule.
--
--   #4 (MEDIUM): a producer flipping their OWN emission_data back to
--     UNVERIFIED could brick an importer's already-saved line for ANY
--     unrelated edit, the same failure shape as the grant-revocation
--     case 20260829540000 already fixed. Closed structurally by the
--     validate-only-on-change architecture change -- there is no
--     "unrelated edit" path left that re-runs this check at all.
--
--   #5 (MEDIUM): DELETEing a shipment_line destroyed its determination
--     with zero audit trail (the audit trigger was AFTER INSERT OR
--     UPDATE only). Fixed: extended to AFTER DELETE, using OLD, with
--     change_kind 'deleted'.
--
--   #6 (MEDIUM, latent): the DEFAULT branch accepted a
--     DEFAULT_EMISSION_VALUES dataset of ANY status, not only ACTIVE --
--     not live-exploitable today (one dataset exists) but a real gap
--     once a dataset is ever superseded. Fixed: added `and rd.status =
--     'ACTIVE'`.
--
--   #7 (LOW/MEDIUM): try_cast_numeric's own exception trap did not
--     cover the SEPARATE `::integer` cast layered on top of it for
--     source_row, so an out-of-int-range source_row raised an uncaught
--     22003 instead of failing closed with a clean rejection. Fixed:
--     app.try_cast_int(text), and a digits-only regex pre-check (also
--     closes B12 below).
--
--   #8 (LOW, DEFAULT-branch narrative depth): country_mapping.status
--     'MAPPED' with no regulatory_country_name (B8); trace entries with
--     no shape requirement at all, e.g. [1,2,3] (B10); an in-enum but
--     self-contradictory reason such as UNAVAILABLE on a record this
--     function just found a real match for (B11); a fractional
--     source_row like "8.4" silently rounded by a numeric->integer cast
--     rather than rejected (B12). Fixed: regulatory_country_name
--     required non-empty when MAPPED; every trace entry must be a JSON
--     object; reason narrowed to the five outcomes that are actually
--     consistent with "a matching record was found" (UNAVAILABLE/
--     REFERENCE_REQUIRED/NOT_APPLICABLE/AMBIGUOUS/NO_MATCH are
--     contradictions at this point in the function, not valid readings
--     of a real resolved record); source_row must match ^[0-9]+$ before
--     any numeric cast is attempted.
--
--   #9 (LOW, defense in depth, not currently reachable):
--     p_org_id was a caller-supplied argument with no check that it was
--     actually one of the caller's own orgs -- not exploitable today
--     (supabase/config.toml exposes only public/graphql_public, so the
--     app schema function cannot be called directly over the Data API),
--     but cheap to close outright rather than rely on that
--     configuration detail never changing. Fixed: an explicit
--     app.user_org_ids() membership check at the top of the function.
--
-- Deliberately NOT done, and why: full validation of B15 (resolved_at)
-- beyond "is this a parseable timestamp" -- resolved_at feeds no
-- calculation and no authorization decision, only a display field, so
-- byte-exact validation would add complexity for a field whose worst
-- case (a garbage-but-parseable timestamp) is a cosmetic UI glitch, not
-- a compliance or security issue. A parseability check (app.
-- try_cast_timestamptz) is added as the proportionate response.
-- ============================================================


-- ------------------------------------------------------------
-- 1. New try-cast helpers
-- ------------------------------------------------------------

create or replace function app.try_cast_int(
    p_value text
)
returns integer
language plpgsql
immutable
as $$
begin
    return p_value::integer;
exception
    when invalid_text_representation then
        return null;
    when numeric_value_out_of_range then
        return null;
end;
$$;

comment on function app.try_cast_int(text) is
    '2026-08-30 (P13 review iteration 4, finding F7/#7): safe integer '
    'cast -- traps invalid_text_representation AND '
    'numeric_value_out_of_range, unlike a bare ::integer cast or a '
    'numeric cast chained into ::integer (the latter also silently '
    'ROUNDS a fractional string instead of rejecting it, which is why '
    'callers additionally regex-check ^[0-9]+$ before ever calling '
    'this for source_row).';

revoke all on function app.try_cast_int(text) from public;
grant execute on function app.try_cast_int(text) to authenticated;

create or replace function app.try_cast_timestamptz(
    p_value text
)
returns timestamptz
language plpgsql
immutable
as $$
begin
    return p_value::timestamptz;
exception
    when invalid_datetime_format then
        return null;
    when datetime_field_overflow then
        return null;
end;
$$;

comment on function app.try_cast_timestamptz(text) is
    '2026-08-30 (P13 review iteration 4, finding #8/B15): safe '
    'timestamptz cast used only to confirm a claimed resolved_at is a '
    'parseable timestamp -- resolved_at feeds no calculation or '
    'authorization decision, so parseability is the proportionate '
    'check, not byte-exact provenance validation.';

revoke all on function app.try_cast_timestamptz(text) from public;
grant execute on function app.try_cast_timestamptz(text) to authenticated;


-- ------------------------------------------------------------
-- 2. app.emission_determination_matches_regulatory_record() --
--    replaced wholesale, AND given a third parameter (p_cn_code) so
--    the ACTUAL branch can enforce cn_scope coverage (finding #3)
--    without an out-of-band handoff -- this function's only caller is
--    the validation trigger created later in this same migration, so
--    widening its signature here is safe.
-- ------------------------------------------------------------

-- The old 2-arg function is still referenced by the old (pre-this-
-- migration) shipment_lines_insert_parent_not_terminal /
-- _update_parent_not_terminal WITH CHECK clauses -- drop those policies
-- first (recreated, without that clause, in section 4 below) so the
-- function drop below does not fail on a dependency.
drop policy shipment_lines_insert_parent_not_terminal on public.shipment_lines;
drop policy shipment_lines_update_parent_not_terminal on public.shipment_lines;

drop function if exists app.emission_determination_matches_regulatory_record(jsonb, uuid);

create function app.emission_determination_matches_regulatory_record(
    p_determination jsonb,
    p_org_id uuid,
    p_cn_code text
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
begin
    if p_determination is null then
        return true;
    end if;

    if jsonb_typeof(p_determination) is distinct from 'object' then
        return false;
    end if;

    -- Finding #9: defense in depth. Not reachable today (this function
    -- is only ever invoked from the shipment_lines validation trigger
    -- below, which always passes the row's own org_id, itself already
    -- gated by shipment_lines' own WITH CHECK org_id clause) -- but
    -- cheap insurance against a future change exposing this function
    -- more directly.
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

        -- Finding #3: must be the installation's current, published
        -- record -- a DRAFT (even DRAFT+VERIFIED, pre-activation) or a
        -- SUPERSEDED/DISCARDED record must never back a determination.
        if v_ed.status <> 'ACTIVE' or v_ed.verification_status <> 'VERIFIED' then
            return false;
        end if;

        -- Finding #3: non-empty evidence, re-expressed here as a DB-
        -- level backstop the same way the activation gate trigger
        -- (20260829480000) already re-expresses this same rule for the
        -- ACTIVATE transition. 20260829560000 (finding S6) already
        -- prevents evidence from shrinking to empty post-verification
        -- via removeEvidenceFile/RLS, so this should be unreachable in
        -- practice; checked anyway per that same "re-express the
        -- invariant, don't just trust it held elsewhere" precedent.
        if coalesce(array_length(v_ed.evidence_file_ids, 1), 0) = 0 then
            return false;
        end if;

        -- Finding #1: real, CURRENT authorization -- ownership, or an
        -- ACTIVE and unexpired sharing_grants row -- mirroring
        -- app.user_shared_installation_ids()'s own criteria exactly
        -- (20260829260000), so this can never accept anything RLS
        -- itself would not actually expose to this org. Safe to demand
        -- "currently ACTIVE" (not "ever existed", 20260829540000's
        -- looser interim rule) now that this check only ever runs when
        -- the determination is actually being set (see this
        -- migration's own header comment on the architecture change).
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

        -- Finding #3: cn_scope coverage -- a SQL mirror of
        -- src/domain/emissions/cn-scope-covers-code.ts's own
        -- cnScopeCoversCnCode (exact match, or a genuine shorter-digit
        -- prefix covering a more specific TARIC10 code under it; never
        -- the reverse).
        select bool_or(
            regexp_replace(scope_entry, '\s+', '', 'g') = regexp_replace(p_cn_code, '\s+', '', 'g')
            or (
                length(regexp_replace(scope_entry, '\s+', '', 'g')) < length(regexp_replace(p_cn_code, '\s+', '', 'g'))
                and regexp_replace(p_cn_code, '\s+', '', 'g') like regexp_replace(scope_entry, '\s+', '', 'g') || '%'
            )
        )
        into v_cn_scope_covers
        from unnest(v_ed.cn_scope) as scope_entry;

        if not coalesce(v_cn_scope_covers, false) then
            return false;
        end if;

        -- Finding #2: the snapshot's OWN claimed verification status
        -- must literally say VERIFIED -- the real row being VERIFIED is
        -- not enough; a snapshot claiming e.g. REJECTED while the real
        -- row happens to be VERIFIED must not be accepted as a
        -- coincidentally-harmless mismatch.
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

        -- sharing_grant_id must match the grant actually used for
        -- authorization above (null for an own-org determination) --
        -- never an independently-claimed, potentially forged or
        -- unrelated grant reference, since this field is what
        -- record_shared_data_consumption and the grantor's own audit
        -- stream key off of.
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
            v_ed.emission_unit = (v_snapshot->>'emission_unit')
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

    -- Finding #8/B8: a MAPPED country_mapping without a name is
    -- incomplete, not merely terse -- why-this-number-panel.tsx renders
    -- it verbatim.
    if (v_resolution->'country_mapping'->>'status') = 'MAPPED'
        and coalesce(length(v_resolution->'country_mapping'->>'regulatory_country_name'), 0) = 0
    then
        return false;
    end if;

    -- Finding #8/B11: narrowed to the five reasons consistent with
    -- "this function just found a real matching record" -- reaching
    -- this line already proves resolution succeeded, so
    -- UNAVAILABLE/REFERENCE_REQUIRED/NOT_APPLICABLE/AMBIGUOUS/NO_MATCH
    -- would be self-contradictory narratives paired with real values,
    -- not merely permissive edge cases.
    if (v_resolution->>'reason') is null
        or not (
            (v_resolution->>'reason') = any (
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

    -- Finding #8/B10: every trace entry must at least be a JSON object
    -- -- [1,2,3] or ["x"] previously passed the non-empty-array check
    -- alone.
    if exists (
        select 1
        from jsonb_array_elements(v_resolution->'trace') as entry
        where jsonb_typeof(entry) is distinct from 'object'
    ) then
        return false;
    end if;

    v_dataset_id := app.try_cast_uuid(v_resolution->>'dataset_id');
    v_dataset_version := v_resolution->>'dataset_version';
    v_source_sheet := v_resolution->'record_identity'->>'source_sheet';

    -- Finding #8/B12: reject a fractional or otherwise non-integer
    -- source_row outright (e.g. "8.4") rather than silently rounding it
    -- via a numeric->integer cast -- the stored identity narrative must
    -- name the row it actually claims, not a nearby one.
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

    -- Finding #6: only an ACTIVE dataset version may back a NEW
    -- determination (latent today -- one dataset exists -- but a real
    -- gap once any dataset is ever superseded). Safe to require
    -- "currently ACTIVE" now that this only runs on an actual change,
    -- for the identical reason the ACTUAL branch's authorization check
    -- above is now allowed to.
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

comment on function app.emission_determination_matches_regulatory_record(jsonb, uuid, text) is
    '2026-08-30 (P13 review iteration 4): replaces 20260829540000''s '
    'body. A second independent review found the cross-tenant oracle '
    'claimed closed there was not, plus several more gaps -- see this '
    'migration''s own header comment for the full list (findings '
    '#1-#9). Now only ever invoked from '
    'app.validate_emission_determination_write() below, which runs in '
    'a BEFORE trigger that fires only when emission_determination is '
    'actually changing -- not from shipment_lines'' own WITH CHECK '
    '(removed below), which re-evaluated on every unrelated edit and '
    'was the root cause of two separate retroactive-breakage findings '
    'across this migration series.';

revoke all on function app.emission_determination_matches_regulatory_record(jsonb, uuid, text) from public;
grant execute on function app.emission_determination_matches_regulatory_record(jsonb, uuid, text) to authenticated;


-- ------------------------------------------------------------
-- 3. app.validate_emission_determination_write() -- BEFORE INSERT OR
--    UPDATE trigger, replacing shipment_lines' WITH CHECK call to the
--    validator function. Only runs when emission_determination is
--    actually changing (always true on INSERT) -- see this migration's
--    own header comment for why this architecture change is the core
--    of this iteration's fix, not merely a refactor.
-- ------------------------------------------------------------

create or replace function app.validate_emission_determination_write()
returns trigger
language plpgsql
as $$
begin
    -- Service-role (no end-user session) callers are exempt, the same
    -- way app.enforce_last_active_owner_per_org() (20260829570000) and
    -- app.audit_emission_determination_change() below both already
    -- treat auth.uid() is null as a trusted, already-privileged
    -- context: every real product path that sets a determination
    -- (resolve-line-emissions.ts, determine-from-actual-data.ts) uses
    -- the caller's own RLS-scoped client, never a service-role one, so
    -- a non-null determination arriving with no auth.uid() is either
    -- test/ops seeding or a future backfill/import script -- both
    -- already as privileged as RLS bypass makes them, and this
    -- exemption is also what makes calling the SECURITY DEFINER
    -- validator function from here safe without granting it EXECUTE
    -- for service_role too (a service-role call would otherwise fail
    -- app.user_org_ids()'s own auth.uid()-dependent membership check
    -- inside that function, since user_org_ids() is empty with no
    -- session -- discovered live: this migration's own author's first
    -- draft broke every service-role-seeded test fixture in exactly
    -- this way before this exemption was added).
    if auth.uid() is null then
        return new;
    end if;

    if TG_OP = 'UPDATE' and new.emission_determination is not distinct from old.emission_determination then
        return new;
    end if;

    if not app.emission_determination_matches_regulatory_record(new.emission_determination, new.org_id, new.cn_code) then
        raise exception
            'shipment_lines: emission_determination failed validation for line %', new.id
            using errcode = '42501';
    end if;

    return new;
end;
$$;

comment on function app.validate_emission_determination_write() is
    '2026-08-30 (P13 review iteration 4): validates emission_determination '
    'only when it is actually changing, using errcode 42501 so the '
    'application layer and existing tests see the same '
    '"insufficient_privilege"-shaped rejection a WITH CHECK failure '
    'would have produced. See this migration''s own header comment for '
    'why validating on every UPDATE (the previous WITH CHECK-based '
    'design) was itself the root cause of two retroactive-breakage '
    'findings.';

create trigger shipment_lines_validate_emission_determination_trg
    before insert or update on public.shipment_lines
    for each row
    execute function app.validate_emission_determination_write();


-- ------------------------------------------------------------
-- 4. shipment_lines_insert_parent_not_terminal /
--    shipment_lines_update_parent_not_terminal -- recreated (dropped
--    earlier in section 2, to clear the dependency on the old 2-arg
--    function before dropping it) WITHOUT the
--    app.emission_determination_matches_regulatory_record(...) WITH
--    CHECK clause; validation now happens in the BEFORE trigger above
--    instead. The org_id / parent-not-terminal clauses are otherwise
--    unchanged.
-- ------------------------------------------------------------

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
    );

comment on policy shipment_lines_insert_parent_not_terminal on public.shipment_lines is
    '2026-08-30 (P13 review iteration 4): emission_determination '
    'validation moved to the BEFORE trigger '
    'shipment_lines_validate_emission_determination_trg -- this WITH '
    'CHECK is back to its pre-forgery-fix shape (org_id + parent-not-'
    'terminal only).';

comment on policy shipment_lines_update_parent_not_terminal on public.shipment_lines is
    '2026-08-30 (P13 review iteration 4): emission_determination '
    'validation moved to the BEFORE trigger '
    'shipment_lines_validate_emission_determination_trg -- this WITH '
    'CHECK is back to its pre-forgery-fix shape (org_id + parent-not-'
    'terminal only), which also means it no longer re-validates an '
    'existing, unchanged determination on every unrelated edit.';


-- ------------------------------------------------------------
-- 5. app.audit_emission_determination_change() -- extended to AFTER
--    DELETE (finding #5): a line carrying a determination that gets
--    deleted outright was previously unaudited, the same defect class
--    already fixed for UPDATE-to-null (F5) but left open for DELETE.
-- ------------------------------------------------------------

create or replace function app.audit_emission_determination_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor_user_id uuid;
    v_actor_type text;
    v_change_kind text;
    v_old_determination jsonb;
    v_new_determination jsonb;
    v_org_id uuid;
    v_line_id uuid;
begin
    if TG_OP = 'DELETE' then
        v_old_determination := old.emission_determination;
        v_new_determination := null;
        v_org_id := old.org_id;
        v_line_id := old.id;

        if v_old_determination is null then
            return old;
        end if;

        v_change_kind := 'deleted';
    else
        v_old_determination :=
            case when TG_OP = 'INSERT' then null else old.emission_determination end;

        v_new_determination := new.emission_determination;
        v_org_id := new.org_id;
        v_line_id := new.id;

        if v_old_determination is not distinct from v_new_determination then
            return new;
        end if;

        v_change_kind :=
            case
                when v_old_determination is null then 'set'
                when v_new_determination is null then 'cleared'
                else 'redetermined'
            end;
    end if;

    v_actor_user_id := auth.uid();

    v_actor_type :=
        case when v_actor_user_id is null then 'SYSTEM' else 'USER' end;

    insert into public.audit_events (
        org_id,
        actor_type,
        actor_user_id,
        event_type,
        aggregate_type,
        aggregate_id,
        payload
    ) values (
        v_org_id,
        v_actor_type,
        v_actor_user_id,
        'shipment_line.updated',
        'SHIPMENT_LINE',
        v_line_id::text,
        jsonb_build_object(
            'change_kind', v_change_kind,
            'from_method', v_old_determination->>'method',
            'to_method', v_new_determination->>'method',
            'from_reason', v_old_determination->'resolution'->>'reason',
            'to_reason', v_new_determination->'resolution'->>'reason',
            'source', 'db_trigger'
        )
    );

    return coalesce(new, old);
end;
$$;

comment on function app.audit_emission_determination_change() is
    '2026-08-30 (P13 review iteration 4, finding #5): now also fires on '
    'DELETE (using OLD, change_kind ''deleted'') -- a line carrying a '
    'determination that gets deleted outright was previously unaudited, '
    'the same defect class 20260829530000 already closed for '
    'UPDATE-to-null but left open here.';

drop trigger shipment_lines_audit_emission_determination_trg on public.shipment_lines;

create trigger shipment_lines_audit_emission_determination_trg
    after insert or update or delete on public.shipment_lines
    for each row
    execute function app.audit_emission_determination_change();
