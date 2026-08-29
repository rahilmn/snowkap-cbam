-- ============================================================
-- Snowkap CBAM
-- P13 release-blocker remediation, ITERATION 2: an independent Opus
-- review of 20260829500000 (this migration's own predecessor) found a
-- COMPLETE, live-reproducible bypass of that fix, plus real gaps in
-- what it validated -- this migration replaces the broken function and
-- trigger wholesale (CREATE OR REPLACE / DROP+CREATE, the established
-- pattern for correcting an already-applied migration; 20260829500000
-- itself is left untouched, per this project's own "never edit an
-- applied migration in place" discipline)
--
-- Purpose (every item independently re-verified by this migration's
-- own author before being accepted, per the review-process instruction
-- not to trust review output blindly):
--
--   F1 (CRITICAL, re-reproduced independently): the v1 gate was
--     `if method is distinct from 'DEFAULT' then return true` -- i.e.
--     "skip validation for anything that ISN'T exactly the string
--     DEFAULT". calculate-line-emissions.ts:315 dispatches the
--     OPPOSITE way: `if method === "ACTUAL" then ...ACTUAL...; else
--     ...treat as DEFAULT...`. A payload with the "method" key
--     OMITTED entirely (or spelled "default" lowercase) skipped every
--     check in v1 while the engine still computed it as a real DEFAULT
--     determination. Re-reproduced live in a rolled-back transaction:
--     the exact v1-blocked forgery, with only the "method" key
--     deleted, updated the row cleanly and the real engine computed
--     COMPUTED "1" against a genuine COMPUTED "250" for the same
--     quantity -- a 250x understatement, fabricated dataset_version
--     intact. Fixed by inverting the gate: only `method = 'ACTUAL'`
--     is treated as the ACTUAL case now; everything else (including a
--     missing/malformed method) is validated as DEFAULT and REJECTED
--     if it doesn't shape up as one -- there is no longer a "skip"
--     branch reachable by an unrecognized method value.
--
--   F2 (CRITICAL, re-reproduced independently): the ACTUAL branch
--     returned true unconditionally. v1's own header comment claimed
--     "ACTUAL integrity is emission_data's own anti-join's job" --
--     that anti-join (20260829480000) protects emission_data's OWN
--     evidence_file_ids column; it has no bearing on the FROZEN
--     ActualEmissionSnapshot written into THIS column, which
--     calculateFromActualDetermination (calculate-line-emissions.ts)
--     reads directly and independently. A wholly invented snapshot --
--     verification.status:"VERIFIED", a fabricated direct_specific,
--     emission_data_id pointing at nothing -- was accepted and
--     computed by the real engine. Fixed: an ACTUAL determination is
--     now validated against a REAL public.emission_data row (must
--     exist, must be verification_status = 'VERIFIED', and the
--     claimed emission_unit/direct_specific/indirect_specific/
--     verifier_user_id must byte-match that row's own current stored
--     values) -- the same "re-derive from the real row, don't trust
--     the claim" posture the DEFAULT branch already used.
--
--   F3 (HIGH, re-reproduced independently): country_mapping, reason,
--     and trace were entirely unvalidated -- a real record's genuine
--     numeric values could be paired with an invented narrative (wrong
--     country, fabricated trace steps), which
--     why-this-number-panel.tsx, build-period-export-rows.ts, and
--     summarize-determination-for-audit.ts all render/export/audit as
--     authoritative. Fixed: country_mapping.status must be MAPPED or
--     UNLISTED, reason must be a real ResolutionReason enum member,
--     and trace must be a non-empty JSON array. Deliberately NOT
--     cross-validating country_mapping against record_identity in
--     fine detail -- risk of a subtle mismatch false-rejecting a
--     legitimate resolution outweighs the narrower residual (an
--     internally-self-consistent-looking but still-wrong narrative)
--     left by this coarser check.
--
--   F4/F5 (MEDIUM): the v1 trigger only fired on UPDATE with a
--     non-null new value, so an INSERT that already carries a
--     determination, and an UPDATE that CLEARS one to null, were both
--     silently unaudited -- provenance could be silently destroyed.
--     Fixed: the trigger now fires on INSERT and UPDATE, and audits
--     any change including a clear-to-null.
--
--   F6 (MEDIUM): the v1 trigger unconditionally wrote actor_type =
--     'USER' with auth.uid(), which is NULL for any service-role/
--     no-JWT caller (a future backfill, import, or support script) --
--     confirmed live to raise audit_events_actor_consistency_ck rather
--     than degrading gracefully. Fixed: actor_type is now SYSTEM when
--     auth.uid() is null.
--
--   F7 (LOW): app.try_cast_numeric only trapped
--     invalid_text_representation -- an out-of-range numeric literal
--     ('1e1000000') raised numeric_value_out_of_range uncaught (still
--     failed CLOSED, not a forgery vector, but not the total function
--     its own comment claimed). Fixed: traps the broader
--     `others` where practical while re-raising truly unexpected
--     errors is unnecessary here -- catches numeric_value_out_of_range
--     explicitly alongside invalid_text_representation.
--
--   F8 (LOW, confirmed benign today but a real robustness gap): a bare
--     `select ... into v_record` silently takes the FIRST matching row
--     on a multi-row match, with no ORDER BY -- confirmed live that 0
--     of 12,540 ACTIVE rows currently collide on the identity tuple
--     this function keys on, so this is latent, not live. Fixed: an
--     explicit count-then-fetch, rejecting (not silently picking) when
--     more than one row matches -- CLAUDE.md's own rule that ambiguity
--     must surface, never be resolved arbitrarily, applied here too.
--
--   F9 (LOW): a structurally-empty determination ({}) or a
--     completely wrong shape ([1,2,3], "hello") passed v1's checks
--     (method extraction on a non-object jsonb value just returns
--     null, which satisfied the old permissive gate) and then crashed
--     the real TypeScript engine with an uncaught "Cannot read
--     properties of undefined" once the line was calculated. Fixed:
--     the DEFAULT branch now explicitly requires record_identity and
--     values to be present and correctly shaped before anything else
--     is checked.
--
--   F10 (LOW): the trigger emitted the exact same event_type strings
--     (emission_determination.set/.redetermined) the application layer
--     already writes for the same change, so every legitimate
--     determination appeared twice in the Audit screen and doubled
--     every count. Fixed: the trigger now writes shipment_line.updated
--     (already in the audit_events catalog, distinct from the
--     application's own event names) with a `change_kind` payload
--     field (set/redetermined/cleared) instead.
-- ============================================================


-- ------------------------------------------------------------
-- 1. app.try_cast_numeric() -- broaden the exception trap (F7)
-- ------------------------------------------------------------

create or replace function app.try_cast_numeric(
    p_value text
)
returns numeric
language plpgsql
immutable
as $$
begin
    return p_value::numeric;
exception
    when invalid_text_representation then
        return null;
    when numeric_value_out_of_range then
        return null;
end;
$$;

comment on function app.try_cast_numeric(text) is
    '2026-08-29 (P13 review iteration 2, finding F7): broadened to also '
    'trap numeric_value_out_of_range (e.g. ''1e1000000'') alongside '
    'invalid_text_representation -- both now return NULL instead of '
    'raising.';


-- ------------------------------------------------------------
-- 2. app.emission_determination_matches_regulatory_record() --
--    replaced wholesale: inverted method gate (F1), real ACTUAL
--    validation (F2), narrative validation (F3), deterministic lookup
--    (F8), shape validation (F9)
--
--    SECURITY DEFINER (new in this iteration, discovered by live
--    reproduction while re-verifying F2's fix): default_emission_values
--    is readable by every `authenticated` user (§15 of the master plan
--    -- global reference data), so the v1/non-definer function's
--    DEFAULT-branch lookup was never actually gated by the caller's own
--    RLS visibility in practice. emission_data is NOT globally
--    readable -- its SELECT policy is scoped to the owning org plus
--    grantee orgs holding an ACTIVE app.user_shared_installation_ids()
--    grant (20260829260000). A non-definer version of this function,
--    run as `authenticated`, would only be able to see (and thus only
--    validate) an ACTUAL snapshot for emission_data the CURRENT
--    session's org can currently see -- live-reproduced: a genuine,
--    correctly-matching ACTUAL determination was rejected as if
--    forged, solely because the calling org had no visibility into
--    that installation's emission_data. Worse, since this function is
--    re-evaluated by WITH CHECK on *every* UPDATE to a line (not only
--    ones that change emission_determination), a sharing grant revoked
--    after a valid determination was saved would retroactively block
--    saving ANY unrelated edit (e.g. a quantity correction) to that
--    line, because the WITH CHECK re-validation could no longer see
--    the referenced emission_data row. Modeled on
--    app.user_shared_installation_ids()'s own SECURITY DEFINER +
--    `set search_path = public` convention: this function now verifies
--    "does a real row with these exact values exist" independent of
--    the caller's own read access, which is the correct scope for a
--    forgery check -- grant-scoped AUTHORIZATION (may this org's
--    determination reference this installation's data at all) remains
--    the application layer's job at write time (manage-lines.ts /
--    resolve-line-emissions.ts), matching "two walls, always both":
--    Wall 2 here prevents fabricated values, it does not re-decide
--    Wall 1's authorization question on every subsequent save.
-- ------------------------------------------------------------

create or replace function app.emission_determination_matches_regulatory_record(
    p_determination jsonb
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
begin
    if p_determination is null then
        return true;
    end if;

    if jsonb_typeof(p_determination) is distinct from 'object' then
        return false;
    end if;

    v_method := p_determination->>'method';

    -- F1: only an EXPLICIT method = 'ACTUAL' takes the ACTUAL branch.
    -- Everything else -- 'DEFAULT', a missing key, a different casing,
    -- a typo -- falls through to DEFAULT validation and is rejected if
    -- it doesn't shape up as a genuine one. There is no longer a
    -- silent "skip validation" branch reachable by an unrecognized
    -- method value.
    if v_method = 'ACTUAL' then
        -- F2: validate the frozen ACTUAL snapshot against a REAL,
        -- currently-VERIFIED emission_data row -- this snapshot, not
        -- emission_data's own evidence_file_ids column, is what the
        -- calculation engine actually reads.
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

        -- direct_specific/indirect_specific are DecimalString text columns
        -- (not numeric, unlike default_emission_values below) -- compared
        -- as exact text, matching the frozen-byte-copy semantics a
        -- snapshot is supposed to have, and avoiding the numeric-drift
        -- class of issue (e.g. '+0.10' == '0.10') that a numeric cast
        -- would tolerate here.
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

    -- F9: reject a structurally malformed determination outright,
    -- rather than letting a missing/wrong-shaped field silently
    -- produce NULLs that pass every downstream comparison by
    -- coincidence and only crash later, inside the calculation engine.
    if v_resolution is null
        or jsonb_typeof(v_resolution) is distinct from 'object'
        or jsonb_typeof(v_resolution->'record_identity') is distinct from 'object'
        or jsonb_typeof(v_resolution->'values') is distinct from 'object'
        or jsonb_typeof(v_resolution->'country_mapping') is distinct from 'object'
        or jsonb_typeof(v_resolution->'trace') is distinct from 'array'
    then
        return false;
    end if;

    -- F3: validate the narrative fields, not only the numeric payload.
    -- (IS DISTINCT FROM does not compose with ANY/ALL in Postgres; the
    -- null-safe form is an explicit NULL check plus a plain = ANY.)
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

    -- F8: count first, fetch only on an unambiguous single match --
    -- never silently pick the first row of several. Confirmed live
    -- that 0 of 12,540 ACTIVE rows collide on this identity today, so
    -- this is a robustness guard against a future data shape, not a
    -- change in today's behavior.
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

comment on function app.emission_determination_matches_regulatory_record(jsonb) is
    '2026-08-29 (P13 review iteration 2): replaces the 20260829500000 '
    'version, which an independent Opus review found completely '
    'bypassable (a missing/malformed "method" key skipped all '
    'validation) and which never validated an ACTUAL-method '
    'determination at all. See this migration''s own header comment '
    'for the full list of findings closed (F1-F9), including why this '
    'version is SECURITY DEFINER where its predecessor was not.';

revoke all on function app.emission_determination_matches_regulatory_record(jsonb) from public;
grant execute on function app.emission_determination_matches_regulatory_record(jsonb) to authenticated;


-- ------------------------------------------------------------
-- 3. app.audit_emission_determination_change() -- fires on INSERT too,
--    audits a clear-to-null, SYSTEM actor when auth.uid() is null
--    (F4/F5/F6), and uses a distinct event_type to stop double-
--    counting against the application's own audit write (F10)
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
begin
    v_old_determination :=
        case when TG_OP = 'INSERT' then null else old.emission_determination end;

    if v_old_determination is not distinct from new.emission_determination then
        return new;
    end if;

    v_actor_user_id := auth.uid();

    v_actor_type :=
        case when v_actor_user_id is null then 'SYSTEM' else 'USER' end;

    v_change_kind :=
        case
            when v_old_determination is null then 'set'
            when new.emission_determination is null then 'cleared'
            else 'redetermined'
        end;

    insert into public.audit_events (
        org_id,
        actor_type,
        actor_user_id,
        event_type,
        aggregate_type,
        aggregate_id,
        payload
    ) values (
        new.org_id,
        v_actor_type,
        v_actor_user_id,
        'shipment_line.updated',
        'SHIPMENT_LINE',
        new.id::text,
        jsonb_build_object(
            'change_kind', v_change_kind,
            'from_method', v_old_determination->>'method',
            'to_method', new.emission_determination->>'method',
            'from_reason', v_old_determination->'resolution'->>'reason',
            'to_reason', new.emission_determination->'resolution'->>'reason',
            'source', 'db_trigger'
        )
    );

    return new;
end;
$$;

comment on function app.audit_emission_determination_change() is
    '2026-08-29 (P13 review iteration 2): now fires on INSERT as well '
    'as UPDATE (F4 -- a line inserted with a determination already '
    'attached was previously unaudited) and audits a change TO null, '
    'not only from it (F5 -- clearing a determination could silently '
    'destroy provenance). actor_type is SYSTEM when auth.uid() is null '
    '(F6 -- a service-role/no-JWT caller, e.g. a future backfill or '
    'import script, previously crashed this trigger against '
    'audit_events_actor_consistency_ck). Uses event_type '
    'shipment_line.updated (already catalog-permitted, distinct from '
    'the application''s own emission_determination.set/.redetermined '
    'names) so a legitimate determination no longer appears twice '
    'under the same event_type in the Audit screen (F10) -- the '
    'change_kind payload field (set/redetermined/cleared) carries what '
    'the old, duplicated event names used to.';

drop trigger shipment_lines_audit_emission_determination_trg on public.shipment_lines;

create trigger shipment_lines_audit_emission_determination_trg
    after insert or update on public.shipment_lines
    for each row
    execute function app.audit_emission_determination_change();
