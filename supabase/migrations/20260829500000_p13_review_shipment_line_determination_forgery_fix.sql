-- ============================================================
-- Snowkap CBAM
-- P13 release-blocker remediation: shipment_lines.emission_determination
-- -- the frozen regulatory provenance snapshot every "Why this number?"
-- render, calculation, and filed declaration trusts -- was unvalidated
-- JSON any org member could forge via a direct PostgREST write, with no
-- audit event
--
-- Purpose:
--   Live-reproduced by the P13 final adversarial audit (and independently
--   confirmed here): shipment_lines_update_parent_not_terminal's WITH
--   CHECK authorizes on org membership + non-terminal parent shipment
--   status only -- nothing about emission_determination's CONTENT.
--   shipment_lines_insert_parent_not_terminal has the identical gap at
--   INSERT time. Neither PostgREST call requires the caller to have gone
--   through resolve-line-emissions.ts at all, and recordAuditEvent only
--   runs inside that application-layer function -- a direct write leaves
--   zero audit_events trail.
--
--   Two changes, matching the codebase's own established two-part
--   pattern for closing exactly this defect class on emission_data
--   (20260829480000's evidence_file_ids anti-join + activation-gate
--   trigger):
--
--   1. app.emission_determination_matches_regulatory_record(jsonb):
--      for a DEFAULT-method determination, re-derives the claimed
--      source row from default_emission_values by its own recorded
--      identity (dataset_id + dataset_version + source_sheet +
--      source_row + source_trade_code + country name + route
--      indicator) and requires the claimed emission_unit and
--      direct/indirect/total values+statuses to byte-match that real
--      row's own stored values. A fabricated number (or a real number
--      copied under a fabricated dataset_id/version) can no longer
--      pass -- added to both the INSERT and UPDATE WITH CHECK clauses.
--
--      Residual, stated plainly rather than silently assumed away (same
--      posture 20260829480000's own header comment uses): this does
--      NOT re-run the full resolver algorithm (country fallback,
--      specificity ranking, ambiguity detection) -- an actor who picks
--      a DIFFERENT real row that is wrong for this line's own
--      country/code/route (rather than a fabricated one) still passes.
--      Closing that fully would mean re-deriving regulatory resolution
--      logic at the database layer, a substantial undertaking scoped
--      for its own dedicated review, not folded into this fix. What
--      this closes is the specific, most severe form of the live
--      reproduction: an arbitrary, non-existent number
--      (dataset_version '2099-totally-made-up', total '0.001') passed
--      every existing control.
--
--      ACTUAL-method determinations are unaffected (return true
--      unconditionally) -- that snapshot's own integrity is the
--      emission_data anti-join's job, not this one's.
--
--   2. app.audit_emission_determination_change(): an AFTER UPDATE
--      trigger (INSERT deliberately excluded -- see below) that writes
--      an emission_determination.set / .redetermined audit_events row
--      whenever emission_determination changes, attributed to
--      auth.uid() -- unlike the application-layer
--      recordAuditEvent call this mirrors, a database trigger cannot be
--      skipped by any client, direct or otherwise. SECURITY DEFINER so
--      it can write regardless of what audit_events_insert_own_org_as_self
--      would otherwise require of the calling role. Deliberately does
--      NOT replace resolve-line-emissions.ts's own recordAuditEvent
--      call (out of scope for this migration, and that call carries a
--      richer payload than SQL can conveniently reconstruct) -- a
--      legitimate determination now writes two related, both-accurate
--      audit_events rows rather than one. Accepted: a harmless,
--      minor redundancy on the legitimate path is a strictly better
--      trade than the alternative, which is zero audit trail on the
--      illegitimate one.
--
--      AFTER UPDATE only, not INSERT: manage-lines.ts always inserts a
--      new line with emission_determination null (confirmed by
--      reading it) -- a determination is only ever legitimately set via
--      a later UPDATE, so INSERT-time forgery is already fully closed
--      by the WITH CHECK content check above, with nothing left for an
--      audit trigger to usefully add. Tried AFTER INSERT OR UPDATE
--      first and found a real bug this way: a service-role INSERT
--      (used throughout this migration's own test fixtures, and a
--      legitimate pattern for any future data-migration/import path)
--      has no auth.uid() in scope, so the trigger raised
--      audit_events_actor_consistency_ck rather than silently
--      mis-attributing the event -- correct failure behavior, but not
--      useful to keep given INSERT-time forgery needed no additional
--      coverage.
-- ============================================================


-- ------------------------------------------------------------
-- 1. app.try_cast_numeric() -- exception-safe numeric cast, same
--    reasoning and shape as app.try_cast_uuid() (20260829410000): a
--    malformed numeric string in the claimed jsonb must not raise and
--    take the whole WITH CHECK evaluation down with it.
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
end;
$$;

comment on function app.try_cast_numeric(text) is
    '2026-08-29 (P13 release-blocker remediation): exception-safe '
    '::numeric cast for validating claimed emission_determination '
    'values against default_emission_values -- returns NULL on a '
    'malformed string instead of raising, the same reasoning as '
    'app.try_cast_uuid() (20260829410000).';


-- ------------------------------------------------------------
-- 2. app.emission_determination_matches_regulatory_record() -- the
--    anti-forgery content check
-- ------------------------------------------------------------

create or replace function app.emission_determination_matches_regulatory_record(
    p_determination jsonb
)
returns boolean
language plpgsql
stable
as $$
declare
    v_resolution jsonb;
    v_dataset_id uuid;
    v_dataset_version text;
    v_source_sheet text;
    v_source_row integer;
    v_source_trade_code text;
    v_origin_country_name text;
    v_source_route_code text;
    v_record record;
    v_dataset_exists boolean;
begin
    if p_determination is null then
        return true;
    end if;

    if (p_determination->>'method') is distinct from 'DEFAULT' then
        return true;
    end if;

    v_resolution := p_determination->'resolution';

    if v_resolution is null then
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

    if not found then
        return false;
    end if;

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
    '2026-08-29 (P13 release-blocker remediation): for a DEFAULT-method '
    'determination, re-derives the claimed source row from '
    'default_emission_values by its own recorded identity and requires '
    'every claimed value/status to byte-match that real row. See this '
    'migration''s own header comment for the residual (a real-but-wrong '
    'record still passes; a fabricated one cannot).';


-- ------------------------------------------------------------
-- 3. shipment_lines_insert_parent_not_terminal / _update_...: WITH
--    CHECK gains the content predicate above (drop + create, the
--    established pattern for redefining an already-applied policy)
-- ------------------------------------------------------------

drop policy shipment_lines_insert_parent_not_terminal on public.shipment_lines;

create policy shipment_lines_insert_parent_not_terminal
    on public.shipment_lines
    for insert
    to authenticated
    with check (
        org_id in (select app.user_org_ids())
        and exists (
            select 1
            from shipments s
            where s.id = shipment_lines.shipment_id
              and s.org_id = shipment_lines.org_id
              and s.status <> all (array['LOCKED', 'VOID'])
        )
        and app.emission_determination_matches_regulatory_record(emission_determination)
    );

drop policy shipment_lines_update_parent_not_terminal on public.shipment_lines;

create policy shipment_lines_update_parent_not_terminal
    on public.shipment_lines
    for update
    to authenticated
    using (
        org_id in (select app.user_org_ids())
        and exists (
            select 1
            from shipments s
            where s.id = shipment_lines.shipment_id
              and s.org_id = shipment_lines.org_id
              and s.status <> all (array['LOCKED', 'VOID'])
        )
    )
    with check (
        org_id in (select app.user_org_ids())
        and exists (
            select 1
            from shipments s
            where s.id = shipment_lines.shipment_id
              and s.org_id = shipment_lines.org_id
              and s.status <> all (array['LOCKED', 'VOID'])
        )
        and app.emission_determination_matches_regulatory_record(emission_determination)
    );

comment on policy shipment_lines_update_parent_not_terminal on public.shipment_lines is
    '2026-08-29 (P13 release-blocker remediation): USING unchanged -- '
    'org-scoping + non-terminal parent only. WITH CHECK gains '
    'app.emission_determination_matches_regulatory_record() -- see that '
    'function''s own comment and this migration''s header.';


-- ------------------------------------------------------------
-- 4. app.audit_emission_determination_change() -- the unbypassable
--    audit trail
-- ------------------------------------------------------------

create or replace function app.audit_emission_determination_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.emission_determination is distinct from old.emission_determination
        and new.emission_determination is not null
    then
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
            'USER',
            auth.uid(),
            case
                when old.emission_determination is null
                    then 'emission_determination.set'
                else 'emission_determination.redetermined'
            end,
            'SHIPMENT_LINE',
            new.id::text,
            jsonb_build_object(
                'from_method', old.emission_determination->>'method',
                'to_method', new.emission_determination->>'method',
                'from_reason', old.emission_determination->'resolution'->>'reason',
                'to_reason', new.emission_determination->'resolution'->>'reason',
                'source', 'db_trigger'
            )
        );
    end if;

    return new;
end;
$$;

comment on function app.audit_emission_determination_change() is
    '2026-08-29 (P13 release-blocker remediation): writes an '
    'emission_determination.set/.redetermined audit_events row on every '
    'change to shipment_lines.emission_determination, regardless of '
    'caller -- a direct PostgREST write is now audited exactly like the '
    'application''s own resolve-line-emissions.ts path. SECURITY '
    'DEFINER so the write succeeds independent of the calling role''s '
    'own audit_events INSERT privileges; auth.uid() still resolves to '
    'the real caller (JWT claims are session-scoped, not privilege-'
    'scoped). Deliberately does not replace resolve-line-emissions.ts''s '
    'own recordAuditEvent call -- see this migration''s header comment '
    'for why a harmless duplicate on the legitimate path is the correct '
    'trade-off.';

create trigger shipment_lines_audit_emission_determination_trg
    after update on public.shipment_lines
    for each row
    execute function app.audit_emission_determination_change();
