-- ============================================================
-- Snowkap CBAM
-- P7-D3: cross-org "consumption" audit event for shared data
--
-- Purpose:
--   docs/plans/MASTER_PLAN.md §9 ("Chosen design" -- Audit): "grant
--   lifecycle events (invited/accepted/revoked/expired), AND
--   consumption events (determination-from-shared-data) recorded on
--   BOTH orgs' audit streams". P7-D (20260829260000) and P7-D2
--   (20260829300000) built the grant-lifecycle half of that sentence
--   (issued/accepted/revoked all already call recordAuditEvent into
--   BOTH sides where relevant -- see manage-sharing-grants.ts). Neither
--   migration touched the second half: when an importer freezes an
--   ActualEmissionSnapshot from a cross-org emission_data row
--   (determineLineFromActualData / redetermineLineFromActualData,
--   src/application/emissions/determine-from-actual-data.ts),
--   recordAuditEvent (src/application/audit/record-audit-event.ts) only
--   ever writes into the IMPORTER's own org_id -- its whole safety
--   argument (a bare client insert is safe because
--   audit_events_insert_own_org_as_self's WITH CHECK requires
--   `org_id in (select app.user_org_ids())`) is exactly what makes it
--   structurally unable to write into the PRODUCER (grantor) org's
--   audit_events at all: the importer's own RLS session is never a
--   member of the grantor org. The grantor's own audit_events table
--   therefore has no row at all recording that their shared data was
--   actually read/used -- a real, previously-deferred gap (tracked as
--   "S8" from an earlier mandatory review), not a new capability.
--
-- Design -- SECURITY DEFINER RPC, same shape as
-- accept_sharing_grant_invitation() (20260829300000), which is this
-- migration's explicit reference pattern:
--   record_shared_data_consumption() is directly callable via
--   supabase.rpc() by ANY authenticated client, not only through
--   determineLineFromActualData/redetermineLineFromActualData's own
--   call site -- so, exactly like accept_sharing_grant_invitation(),
--   it independently RE-VERIFIES every fact it needs from the
--   database rather than trusting any caller-supplied value:
--     (a) the calling user actually belongs to the GRANTEE org of the
--         specific grant named by p_sharing_grant_id (a plain EXISTS
--         against memberships keyed on auth.uid(), the same shape
--         accept_sharing_grant_invitation() already uses for its own
--         NOT_A_MEMBER check -- not app.user_org_ids(), for the same
--         "mirror the reference pattern" reason);
--     (b) the grant is genuinely status = 'ACTIVE' AND unexpired (a
--         REVOKED/EXPIRED/still-INVITED grant, OR one that is ACTIVE
--         but past its own expires_at -- this table has no scheduled
--         EXPIRE job, so that is a normal long-lived state, not a
--         transient one, see app.user_shared_installation_ids()'s own
--         comment -- no longer confers, or never conferred, any real
--         read access, so it must not be able to generate a "your data
--         was consumed" event either; 2026-08-29 review fix, the
--         expires_at half was originally missing) AND really does name
--         the installation the caller claims (p_installation_id,
--         checked against the grant row's OWN installation_id -- never
--         inferred from caller intent alone);
--     (c) the emission_data row the caller claims to have consumed
--         genuinely exists under that same installation at that exact
--         version, AND is genuinely ACTIVE + VERIFIED (p_emission_data_id
--         + p_emission_data_version cross-checked against a real
--         emission_data row -- a caller cannot fabricate a nonexistent
--         or mismatched version number into the grantor's own audit
--         trail; 2026-08-29 review fix, the ACTIVE+VERIFIED half was
--         originally missing, letting a grantee report "consumption" of
--         a DRAFT/UNVERIFIED/REJECTED/DISCARDED/SUPERSEDED row they
--         could never actually read under RLS);
--     (d) the shipment_line the caller claims recorded the
--         determination genuinely belongs to the SAME grantee org
--         (p_shipment_line_id checked against shipment_lines.org_id --
--         a caller cannot point this event at a line they have no
--         relationship to).
--   Only once every one of (a)-(d) passes does the function insert one
--   audit_events row with org_id = the GRANTOR's org, read off the
--   sharing_grants row ITSELF (v_grant.grantor_org_id) -- never
--   client-supplied, and therefore never forgeable -- with a payload
--   built entirely from values this function has independently
--   verified above, not from an arbitrary caller-supplied payload blob.
--   event_type ('sharing_grant.data_consumed') and aggregate_type
--   ('SHARING_GRANT') are hardcoded in the function body, not
--   parameters, for the same reason.
--
--   Why a bare client-side insert (recordAuditEvent's own usual path)
--   cannot do this instead: audit_events_insert_own_org_as_self
--   (20260828150000) requires `org_id in (select app.user_org_ids())`
--   -- true only for the CALLER's own orgs. The importer's session is,
--   by construction, never a member of the grantor org (that is the
--   entire point of a cross-org grant), so no WITH CHECK relaxation of
--   that policy could ever admit this insert without ALSO admitting an
--   arbitrary authenticated user writing into ANY org's audit stream
--   merely by naming it -- audit_events has no per-row ownership
--   concept a bare policy could scope this to. A SECURITY DEFINER
--   function is the only way to cross that boundary safely, because
--   the function -- not the RLS policy -- is what proves the narrow
--   fact that justifies the cross-org write (a real, ACTIVE grant this
--   specific caller is a genuine party to).
--
-- Wiring: src/application/emissions/determine-from-actual-data.ts calls
--   this RPC from performDetermination(), AFTER the existing
--   recordAuditEvent() call, ONLY when the frozen snapshot's
--   sharing_grant_id is non-null (an own-org determination has nothing
--   to report here). See that file's own comment on
--   DetermineFromActualDataResult's `crossOrgConsumptionRecorded` field
--   for how a non-OK RPC outcome is surfaced without misrepresenting
--   the (already-persisted, by this point) determination itself as
--   having failed.
-- ============================================================


create or replace function public.record_shared_data_consumption(
    p_sharing_grant_id uuid,
    p_installation_id uuid,
    p_emission_data_id uuid,
    p_emission_data_version integer,
    p_shipment_line_id uuid,
    p_determination_kind text
)
returns table(
    result_status text,
    result_audit_event_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_grant public.sharing_grants%rowtype;
    v_audit_event_id uuid;
begin
    if auth.uid() is null then
        raise exception
            'record_shared_data_consumption requires an authenticated caller.';
    end if;

    -- Input-shape validation for a value only ever produced by this
    -- codebase's own call site (never end-user free text) -- a genuine
    -- caller error, not a normal rejection outcome, so this raises
    -- rather than returning a result_status, matching how
    -- accept_sharing_grant_invitation() treats its own "caller is not
    -- even authenticated" precondition.
    if p_determination_kind not in ('DETERMINED', 'REDETERMINED') then
        raise exception
            'record_shared_data_consumption: invalid p_determination_kind %', p_determination_kind;
    end if;

    select sg.*
    into v_grant
    from public.sharing_grants sg
    where sg.id = p_sharing_grant_id;

    if v_grant.id is null then
        return query select 'GRANT_NOT_FOUND'::text, null::uuid;
        return;
    end if;

    -- (a) The core security gate: a stranger org with no relationship
    -- to this grant at all -- and a member of the GRANTOR's own org,
    -- who has no more standing to report a "consumption" than any
    -- other outsider -- must be rejected here, before anything else
    -- about the grant is confirmed to this caller. Checked directly
    -- against memberships (not app.user_org_ids()), the same shape
    -- accept_sharing_grant_invitation()'s own NOT_A_MEMBER check uses.
    if v_grant.grantee_org_id is null or not exists (
        select 1
        from public.memberships m
        where m.org_id = v_grant.grantee_org_id
          and m.user_id = auth.uid()
    ) then
        return query select 'NOT_A_MEMBER'::text, null::uuid;
        return;
    end if;

    -- (b) A REVOKED/EXPIRED/still-INVITED grant never conferred (or no
    -- longer confers) real read access -- see this migration's header
    -- comment.
    --
    -- 2026-08-29 (mandatory review, should-fix, independently
    -- confirmed live): also check expires_at, not just status. This
    -- table has no scheduled EXPIRE job (app.user_shared_installation_ids()'s
    -- own comment, 20260829260000, is explicit about that), so
    -- status='ACTIVE' with a long-past expires_at is a normal,
    -- long-lived state here, not a transient one -- exactly the state
    -- app.user_shared_installation_ids() itself already excludes via
    -- its own `(expires_at is null or expires_at > now())` clause. This
    -- check now matches that clause exactly, so a grantee whose read
    -- access has already lapsed can no longer keep writing "your data
    -- was consumed" into the grantor's audit stream after the fact --
    -- reproduced live before this fix: a lapsed grantee's own SELECT
    -- against the shared installation/emission_data already correctly
    -- returned [], while this RPC still returned OK.
    if v_grant.status <> 'ACTIVE'
        or (v_grant.expires_at is not null and v_grant.expires_at <= now())
    then
        return query select 'GRANT_NOT_ACTIVE'::text, null::uuid;
        return;
    end if;

    -- (b, continued) The grant must genuinely name the installation
    -- the caller claims -- a member of the grantee org holding one
    -- ACTIVE grant must not be able to report a consumption event
    -- against an installation covered by a DIFFERENT grant (e.g. one
    -- already REVOKED, or one that never existed).
    if v_grant.installation_id <> p_installation_id then
        return query select 'INSTALLATION_MISMATCH'::text, null::uuid;
        return;
    end if;

    -- (c) The emission_data row genuinely exists, under this same
    -- installation, at exactly the claimed version, AND is genuinely
    -- readable by this grantee -- a caller cannot fabricate a
    -- nonexistent id or a mismatched version number into the grantor's
    -- own audit trail.
    --
    -- 2026-08-29 (mandatory review, should-fix, independently confirmed
    -- live): the original check omitted `status = 'ACTIVE' and
    -- verification_status = 'VERIFIED'` -- exactly the pair
    -- emission_data_select_own_org (20260829260000) itself calls "the
    -- single most security-critical clause in this migration". Without
    -- it, a grantee could report a genuine-looking consumption event
    -- for a DRAFT/UNVERIFIED/REJECTED/DISCARDED/SUPERSEDED row they can
    -- never actually SELECT under RLS -- reproduced live: the grantee's
    -- own SELECT against a DRAFT row returned [], while this RPC still
    -- returned OK, writing a false "this was consumed" claim into the
    -- grantor's audit trail for data the grantee could not read. Now
    -- matches the exact ACTIVE+VERIFIED gate every other cross-org read
    -- of this table already enforces.
    if not exists (
        select 1
        from public.emission_data ed
        where ed.id = p_emission_data_id
          and ed.installation_id = v_grant.installation_id
          and ed.version = p_emission_data_version
          and ed.status = 'ACTIVE'
          and ed.verification_status = 'VERIFIED'
    ) then
        return query select 'EMISSION_DATA_MISMATCH'::text, null::uuid;
        return;
    end if;

    -- (d) The shipment_line genuinely belongs to the same grantee org
    -- the membership check above already confirmed the caller is a
    -- member of -- a caller cannot point this event at a line under
    -- another org entirely.
    --
    -- KNOWN GAP, WORTH-TRACKING, NOT FIXED HERE (mandatory review,
    -- 2026-08-29, live-reproduced): this check does not read
    -- sl.emission_determination at all, so it never confirms the line
    -- was actually determined from p_emission_data_id/p_emission_data_version
    -- via p_sharing_grant_id -- only that the line exists and belongs to
    -- the grantee org. There is also no uniqueness constraint, CAS, or
    -- rate limit on this RPC. Confirmed live: three identical calls
    -- against a shipment_line with NO emission_determination at all each
    -- returned a distinct OK + a new audit_events row, leaving fabricated
    -- "data_consumed" entries in the grantor's own append-only audit log
    -- (which has no UPDATE/DELETE policy by design) that the grantor
    -- cannot read is fabricated (PROBE7 in the review: the grantee's own
    -- SELECT against the grantor's audit_events already correctly
    -- returns []). Bounded -- only a genuine member of an ACTIVE,
    -- unexpired grant can do this, not a stranger -- which is why this
    -- is tracked rather than blocking; not fixed in this pass because a
    -- real fix (matching sl.emission_determination's own JSONB payload
    -- against the claimed emission_data_id/version/sharing_grant_id, or
    -- adding a genuine idempotency key) is more surface than a review-
    -- response pass should improvise. Whoever builds screen 32 further,
    -- or a future review, should treat a sharing_grant.data_consumed
    -- event as an unverified claim from the grantee, not proof, until
    -- this is closed.
    if not exists (
        select 1
        from public.shipment_lines sl
        where sl.id = p_shipment_line_id
          and sl.org_id = v_grant.grantee_org_id
    ) then
        return query select 'SHIPMENT_LINE_NOT_FOUND'::text, null::uuid;
        return;
    end if;

    insert into public.audit_events (
        org_id,
        actor_type,
        actor_user_id,
        event_type,
        aggregate_type,
        aggregate_id,
        payload
    ) values (
        v_grant.grantor_org_id,
        'USER',
        auth.uid(),
        'sharing_grant.data_consumed',
        'SHARING_GRANT',
        v_grant.id::text,
        jsonb_build_object(
            'installation_id', v_grant.installation_id,
            'emission_data_id', p_emission_data_id,
            'emission_data_version', p_emission_data_version,
            'consuming_org_id', v_grant.grantee_org_id,
            'shipment_line_id', p_shipment_line_id,
            'determination_kind', p_determination_kind
        )
    )
    returning id into v_audit_event_id;

    return query select 'OK'::text, v_audit_event_id;
end;
$$;

comment on function public.record_shared_data_consumption(uuid, uuid, uuid, integer, uuid, text) is
    'Records a sharing_grant.data_consumed audit_events row in the '
    'GRANTOR org''s own audit stream when an importer freezes an '
    'ActualEmissionSnapshot from that grantor''s shared emission_data -- '
    'see this migration''s header comment for why a bare client-side '
    'recordAuditEvent() insert (src/application/audit/record-audit-event.ts) '
    'structurally cannot write into an org other than the caller''s own, '
    'and why this function independently re-verifies (a) caller '
    'membership in the grant''s grantee_org_id, (b) the grant is '
    'ACTIVE and names the claimed installation, (c) the emission_data '
    'row+version genuinely exists under that installation, and (d) the '
    'shipment_line genuinely belongs to the grantee org, rather than '
    'trusting any of its caller-supplied parameters -- this function is '
    'directly callable via supabase.rpc() by any authenticated client, '
    'not only through determineLineFromActualData/'
    'redetermineLineFromActualData''s own call site. org_id, '
    'event_type, and aggregate_type are never caller-supplied -- org_id '
    'is read off the sharing_grants row itself (v_grant.grantor_org_id), '
    'and event_type/aggregate_type are hardcoded in this function body, '
    'so no combination of parameters can forge a write into an '
    'unrelated org''s stream or an arbitrary event/aggregate type. '
    'Called from src/application/emissions/determine-from-actual-data.ts '
    'AFTER the existing importer-side recordAuditEvent() call, only when '
    'the frozen snapshot''s sharing_grant_id is non-null.';

revoke all on function public.record_shared_data_consumption(uuid, uuid, uuid, integer, uuid, text) from public;
grant execute on function public.record_shared_data_consumption(uuid, uuid, uuid, integer, uuid, text) to authenticated;


-- ============================================================
-- END OF MIGRATION
-- ============================================================
