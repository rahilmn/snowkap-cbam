-- ============================================================
-- Snowkap CBAM SME Experience -- S4 remediation
-- Two findings from a fresh independent adversarial review of the S4
-- implementation (2026-09-06), both live-reproduced against local
-- Postgres inside real BEGIN ... ROLLBACK transactions before this
-- migration was written.
--
-- ------------------------------------------------------------
-- B1: every S4 audit event is silently refused by RLS
--
-- manage-declaration-context.ts and manage-precursors.ts each call
-- recordAuditEvent with event_type declaration_context.upserted,
-- precursor.added, or precursor.removed. 20260906180000 widened
-- audit_events_aggregate_type_check (the AGGREGATE type) but never
-- touched audit_events_insert_own_org_as_self's own event_type
-- allowlist (20260903130000) -- a completely separate catalog, on the
-- INSERT policy rather than a column CHECK. Every one of these three
-- INSERTs was refused by RLS, silently: recordAuditEvent
-- (src/application/audit/record-audit-event.ts) is best-effort and
-- returns {ok, reason} specifically so a caller CAN notice, but none
-- of the three S4 call sites inspects that result. The dossier has had
-- no audit trail at all since Slice 1 -- no record of who declared,
-- changed, or retracted a verifier-report claim or a precursor.
--
-- Same drop-and-recreate-whole shape as 20260903130000 (the catalog is
-- an allowlist, so it has to be re-created whole to add to it) --
-- every existing value carried across verbatim, the three additions
-- marked.
--
-- ------------------------------------------------------------
-- B2: a producer can rewrite or delete a published dossier claim
--
-- emission_data_declaration_context_update_own_org/_delete_own_org and
-- emission_data_precursors_update_own_org/_delete_own_org
-- (20260906180000) are scoped by org membership only -- no lifecycle
-- predicate. The post-VERIFICATION lock v2.1.1 section 11 requires
-- exists only in the application layer
-- (manage-declaration-context.ts's/manage-precursors.ts's own
-- verifyEmissionDataEditable). Live-reproduced: an ordinary member of
-- the owning org, on a record that had genuinely walked DRAFT ->
-- submitted -> VERIFIED -> ACTIVE, could UPDATE the declared
-- verifier-report text and DELETE a declared precursor outright, in
-- the same transaction where the parent emission_data row's own
-- evidence_file_ids strip was correctly refused by
-- app.enforce_emission_data_lineage_lock (20260903210000). The parent
-- table has "once ACTIVE and VERIFIED, permanent" as a database-level
-- fact; the two new child tables never got the equivalent.
--
-- get-buyer-view.ts's own doc comment already states the Buyer view
-- reads LIVE data, not a frozen snapshot -- meaning a tampered claim
-- is exactly what a buyer would see, and per B1, with no audit trail
-- of the tampering either.
--
-- FIX. A trigger mirroring enforce_emission_data_lineage_lock's own
-- marker-based reasoning (its header comment's own argument for why a
-- status-keyed rule always eventually leaks applies here too, one
-- level down): once the referenced emission_data row has EVER been
-- ACTIVE and VERIFIED (verified_active_at is not null -- the exact
-- same durable marker, not re-derived), UPDATE/DELETE on that row's
-- own declaration_context/precursor rows is refused, in every state,
-- for the rest of that emission_data row's life (superseding it
-- creates a NEW emission_data row with its own fresh
-- declaration_context/precursors, never edits the old one's).
--
-- Also closes a second, related gap the same review found: the
-- existing UPDATE policies' WITH CHECK validates org ownership but
-- never pinned emission_data_id itself, so
-- `update ... set emission_data_id = <another own-org record>` was
-- also admitted. The same trigger makes emission_data_id immutable on
-- UPDATE for both tables, matching this schema's established
-- identity-column-immutability convention (P4's own org_id/
-- shipment_id triggers).
-- ============================================================


-- ------------------------------------------------------------
-- Part 1: audit_events event_type catalog
-- ------------------------------------------------------------

drop policy if exists audit_events_insert_own_org_as_self on public.audit_events;

create policy audit_events_insert_own_org_as_self
    on public.audit_events
    for insert
    to authenticated
    with check (
        actor_type = 'USER'
        and actor_user_id = auth.uid()
        and org_id in (select app.user_org_ids())
        and event_type = any(array[
            'calculation.computed',
            'declaration.amendment_created',
            -- NEW (S4 remediation): a producer captured or changed a
            -- record's declaration context.
            'declaration_context.upserted',
            'declaration.draft_generated',
            'declaration.draft_refreshed',
            'declaration.marked_ready',
            'emission_data.activated',
            'emission_data.discarded',
            'emission_data.recorded',
            'emission_data.rejected',
            'emission_data.submitted',
            'emission_data.superseded',
            'emission_data.verified',
            'emission_determination.redetermined',
            'emission_determination.set',
            'evidence.removed',
            'evidence.uploaded',
            'installation.created',
            'installation.removed',
            'membership.deactivated',
            'membership.invitation_created',
            'membership.invitation_revoked',
            'membership.reactivated',
            'membership.removed',
            'membership.role_changed',
            'operator.created',
            'operator.removed',
            -- NEW (S4 remediation): a producer declared a precursor
            -- material.
            'precursor.added',
            -- NEW (S4 remediation): a producer removed a declared
            -- precursor material.
            'precursor.removed',
            'sharing_grant.accepted',
            'sharing_grant.issued',
            'sharing_grant.revoked',
            'shipment.created',
            'shipment.locked',
            'shipment.marked_ready',
            'shipment.reopened',
            'shipment.voided',
            'shipment_line.added',
            'shipment_line.removed',
            'shipment_line.updated',
            'supplier.created',
            'supplier.removed'
        ])
    );

comment on policy audit_events_insert_own_org_as_self on public.audit_events is
    '2026-09-06 (S4 remediation, adds the three dossier events to the '
    '2026-09-03 catalog). An authenticated caller may write an audit '
    'event only for an organization they belong to, only attributed to '
    'themselves, and only with an event_type this catalog names. The '
    'catalog is an allowlist rather than a CHECK on shape: an event '
    'type nobody writes is a typo, and a typo that silently persists '
    'is a hole in a record whose whole value is that it is complete.';


-- ------------------------------------------------------------
-- Part 2: post-verification lock on the two dossier tables
-- ------------------------------------------------------------

create or replace function app.enforce_dossier_lock()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_emission_data_id uuid;
    v_locked boolean;
begin
    v_emission_data_id :=
        case tg_op
            when 'DELETE' then old.emission_data_id
            else new.emission_data_id
        end;

    -- Identity column immutable on UPDATE -- closes the second gap the
    -- same review found: the existing WITH CHECK validates org
    -- ownership on whatever emission_data_id is supplied, but never
    -- pinned it to the row's OWN original value, so a caller could
    -- repoint an existing context/precursor row at a different
    -- (still own-org) emission_data record.
    if tg_op = 'UPDATE' and new.emission_data_id is distinct from old.emission_data_id then
        raise exception
            '%: emission_data_id is immutable -- create a new row against the intended record instead of repointing an existing one',
            tg_table_name
            using errcode = '42501';
    end if;

    select ed.verified_active_at is not null
    into v_locked
    from public.emission_data ed
    where ed.id = v_emission_data_id;

    -- v_locked is null (not true) if the referenced emission_data row
    -- no longer exists -- the ON DELETE CASCADE FK will remove this
    -- row along with it in that case, which is a different, legitimate
    -- code path, not a lock to enforce here.
    if coalesce(v_locked, false) then
        raise exception
            '%: cannot be changed once the parent emission_data record has been ACTIVE and VERIFIED -- a buyer relying on the shared record may already have read this declared context. Supersede the parent record with a new version instead.',
            tg_table_name
            using errcode = '42501';
    end if;

    if tg_op = 'DELETE' then
        return old;
    end if;

    return new;
end;
$$;

comment on function app.enforce_dossier_lock() is
    '2026-09-06 (S4 remediation). Mirrors '
    'app.enforce_emission_data_lineage_lock''s own marker-based '
    'reasoning (20260903210000) one level down: once the parent '
    'emission_data row''s verified_active_at is set -- stamped the '
    'first time IT was ever ACTIVE and VERIFIED, immutable thereafter '
    '-- its declared context/precursor rows are permanent facts too, '
    'in every state, for the rest of that row''s life. Also pins '
    'emission_data_id immutable on UPDATE for both tables.';

drop trigger if exists emission_data_declaration_context_lock_trg
    on public.emission_data_declaration_context;

create trigger emission_data_declaration_context_lock_trg
    before update or delete on public.emission_data_declaration_context
    for each row
    execute function app.enforce_dossier_lock();

drop trigger if exists emission_data_precursors_lock_trg
    on public.emission_data_precursors;

create trigger emission_data_precursors_lock_trg
    before update or delete on public.emission_data_precursors
    for each row
    execute function app.enforce_dossier_lock();


-- ============================================================
-- END OF MIGRATION
-- ============================================================
