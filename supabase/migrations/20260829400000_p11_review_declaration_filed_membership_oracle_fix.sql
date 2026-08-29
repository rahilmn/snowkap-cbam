-- ============================================================
-- Snowkap CBAM
-- P11 mandatory security review response: record_declaration_filed()
-- was a cross-org existence oracle for any authenticated user, even
-- one in no organization at all
--
-- Purpose:
--   Finding #3 (SHOULD-FIX, confirmed live by every reviewer, one of
--   whom found it is WORSE than first reported): the function checked
--   `v_decl.id is null` (NOT_FOUND) BEFORE
--   `app.user_is_admin_or_owner_of(v_decl.org_id)` (NOT_ADMIN), with
--   no membership check at all in between. An unrelated org's OWNER
--   supplying a REAL declaration id from a different org got
--   NOT_ADMIN; supplying a RANDOM id got NOT_FOUND -- a clean real/
--   fake existence oracle for declaration ids across every
--   organization on the platform, mapped to two visibly different UI
--   strings by app/(importer)/declarations/actions.ts ("Recording a
--   filing requires ADMIN or OWNER access." vs "That declaration '
--   'could not be found."). The mandatory review found the oracle is
--   even wider than the sweep first reported: a user in NO
--   organization whatsoever (not merely an unrelated one) also gets
--   NOT_ADMIN for a real id, since app.user_is_admin_or_owner_of()
--   simply returns false rather than distinguishing "not a member at
--   all" from "member but not admin."
--
--   This violates the exact convention this codebase already states
--   for itself: manage-sharing-grants.ts's own comment says "a caller
--   must never learn 'a grant with this id exists but belongs to a
--   different org' from the rejection reason" -- record_declaration_filed
--   was the one RPC in this schema not upholding that.
--
--   The fix distinguishes the two cases the review's own fix-scope
--   note asked for: "not a member of that org at all" now returns
--   NOT_FOUND (indistinguishable from a genuinely nonexistent
--   declaration id, closing the oracle), and "member but not admin"
--   still returns NOT_ADMIN (a real, useful distinction for someone
--   who legitimately belongs to the org but lacks the role). Uses
--   app.user_org_ids() (20260829360000) for the membership check --
--   the same helper every other membership-existence check in this
--   schema already uses, deliberately excluding deactivated
--   memberships (a deactivated member is, correctly, treated as "not
--   a member at all" here too).
--
--   Everything else in this function is byte-for-byte unchanged from
--   20260829350000 -- this is a single, narrowly-scoped authorization-
--   ordering fix, not a re-derivation of the filing logic itself.
--
--   Companion test change (not in this migration -- a TypeScript
--   test file): tests/integration/declarations-isolation.test.ts:890
--   currently asserts NOT_ADMIN for the unrelated-org-OWNER case and
--   is tightened to assert NOT_FOUND instead, a strictly STRONGER
--   assertion (closing the oracle), not a weakened one -- per this
--   review's own fix-scope note.
-- ============================================================


create or replace function public.record_declaration_filed(
    p_declaration_id uuid,
    p_filed_reference text
)
returns table(
    result_status text,
    result_declaration_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_decl public.declarations%rowtype;
    v_member_ids uuid[];
    v_lockable_count bigint;
    v_line_count bigint;
    v_uncalculated_count bigint;
    v_empty_member_count bigint;
    v_snapshot jsonb;
begin
    if auth.uid() is null then
        raise exception
            'record_declaration_filed requires an authenticated caller.';
    end if;

    -- FOR UPDATE, not a plain SELECT: two clicks on "record filed"
    -- arriving together would otherwise both read status = 'READY',
    -- both aggregate, and both attempt the write. The row lock
    -- serializes them, so the second call resumes after the first
    -- commits, re-reads FILED_RECORDED, and returns ALREADY_FILED
    -- instead of racing. (The CAS guard on the UPDATE below is kept
    -- anyway -- same belt-and-braces as accept_sharing_grant_invitation's
    -- own `and sg.status = 'INVITED'`.)
    select d.*
    into v_decl
    from public.declarations d
    where d.id = p_declaration_id
    for update;

    if v_decl.id is null then
        return query select 'NOT_FOUND'::text, null::uuid;
        return;
    end if;

    -- 2026-08-29 (P11 mandatory security review, finding #3,
    -- SHOULD-FIX, confirmed live -- worse than first reported):
    -- membership is checked FIRST and separately from admin/owner
    -- status, so a caller with NO relationship to this declaration's
    -- org at all -- not a member, whether of an unrelated org or of
    -- none -- gets the SAME NOT_FOUND a nonexistent declaration id
    -- would produce, never distinguishable from it. Only a genuine
    -- member of the org (who legitimately needs to know WHY they were
    -- refused) reaches the admin/owner check below and can get the
    -- more specific NOT_ADMIN. app.user_org_ids() (20260829360000) is
    -- the same helper every other "is this caller actually a member"
    -- check in this schema uses -- deactivated memberships are
    -- correctly excluded (a deactivated member is "not a member at
    -- all" for this purpose too).
    if v_decl.org_id not in (select app.user_org_ids()) then
        return query select 'NOT_FOUND'::text, null::uuid;
        return;
    end if;

    -- Re-derived from auth.uid() via the declaration's OWN org_id --
    -- this function takes no org parameter at all, so there is no
    -- client-supplied org id to distrust in the first place (contrast
    -- accept_sharing_grant_invitation, 20260829300000, which cannot
    -- avoid one and therefore re-checks membership explicitly).
    if not app.user_is_admin_or_owner_of(v_decl.org_id) then
        return query select 'NOT_ADMIN'::text, null::uuid;
        return;
    end if;

    if v_decl.status = 'FILED_RECORDED' then
        return query select 'ALREADY_FILED'::text, null::uuid;
        return;
    end if;

    if v_decl.status <> 'READY' then
        return query select 'NOT_READY'::text, null::uuid;
        return;
    end if;

    -- A filing reference is the entire substance of "recording a
    -- filing" -- Snowkap did not perform the filing and has no other
    -- evidence it happened (§22). Refused rather than defaulted or
    -- generated: there is no such thing as a Snowkap-issued filing
    -- reference. Not trimmed either -- p_filed_reference is written
    -- verbatim below; this check only classifies it.
    if p_filed_reference is null or btrim(p_filed_reference) = '' then
        return query select 'EMPTY_FILED_REFERENCE'::text, null::uuid;
        return;
    end if;

    select array_agg(distinct m)
    into v_member_ids
    from unnest(v_decl.member_shipment_ids) as m;

    if v_member_ids is null or cardinality(v_member_ids) = 0 then
        return query select 'NO_MEMBER_SHIPMENTS'::text, null::uuid;
        return;
    end if;

    -- The SQL expression of transitionShipment's LOCK rule
    -- (src/domain/shipments/lifecycle.ts: LOCK requires status =
    -- 'READY'), plus the tenancy re-check member_shipment_ids' bare
    -- uuid[] cannot give structurally.
    --
    -- 'LOCKED' is accepted alongside 'READY' on purpose, and is NOT a
    -- weakening of that rule: an amendment (supersedes_declaration_id)
    -- covers shipments the superseded version already locked, and
    -- transitionShipment would reject LOCK on a LOCKED shipment
    -- (SHIPMENT_NOT_READY). So the UPDATE below transitions ONLY the
    -- READY ones -- exactly the rows the pure function would accept --
    -- while an already-LOCKED member simply needs no transition to
    -- reach the end state this declaration requires. DRAFT and VOID
    -- members are refused outright.
    select count(*)
    into v_lockable_count
    from public.shipments s
    where s.id = any(v_member_ids)
      and s.org_id = v_decl.org_id
      and s.status in ('READY', 'LOCKED');

    if v_lockable_count <> cardinality(v_member_ids) then
        return query select 'SHIPMENTS_NOT_LOCKABLE'::text, null::uuid;
        return;
    end if;

    -- The freshness check that makes this a real aggregation pass and
    -- not a rubber stamp on DRAFT-time numbers: shipment_lines stay
    -- editable while their parent is READY
    -- (shipment_lines_update_parent_not_terminal excludes only
    -- LOCKED/VOID, and shipment_lines_delete_parent_not_terminal
    -- likewise), so a line can be added, re-determined, or DELETED
    -- entirely AFTER the completeness gate passed and BEFORE anyone
    -- clicks "record filed".
    --
    -- A line with no calculation result is refused, never summed as
    -- zero and never quietly omitted from the total -- the same
    -- "no value is not a value of zero" rule CLAUDE.md states for the
    -- regulatory resolver and RULE-EE-005 states for the engine. A
    -- silently-understated filed total is the single worst failure this
    -- function could produce.
    --
    -- Counted PER MEMBER SHIPMENT (from unnest(v_member_ids), not from
    -- member_lines directly) and left-joined out to that per-shipment
    -- aggregate -- a member with ZERO rows in the aggregate is a member
    -- with zero lines right now, and must be visible as such rather
    -- than contributing nothing to a global count. Without the
    -- per-shipment shape, a member emptied of its only line after READY
    -- (a plain MEMBER can delete a READY parent's last line) vanished
    -- from every counter here, filing proceeded, and that shipment
    -- vanished from filed_snapshot's own per_shipment breakdown further
    -- below too -- reproduced live (20260829350000's own header comment
    -- has the full scenario). v_empty_member_count catches exactly that
    -- state and refuses it the same way buildCompletenessReport's
    -- SHIPMENT_HAS_NO_LINES blocker already refuses READY for it
    -- (src/domain/declarations/completeness.ts) -- this is the filing-
    -- time re-verification of that same fact, not a new rule.
    with member_lines as (
        select sl.id as line_id, sl.shipment_id
        from public.shipment_lines sl
        where sl.shipment_id = any(v_member_ids)
    ),
    current_result as (
        -- "The current result for a line is the most recent row by
        -- calculated_at" is already this schema's stated definition
        -- (20260829180000's header comment), not a new rule invented
        -- here. id desc only breaks an exact-timestamp tie
        -- deterministically; nothing writes two results for one line in
        -- a single transaction (calculate-line.ts inserts one row per
        -- request), so that tiebreak is a defensive ordering, not a
        -- selection rule anyone should depend on.
        select distinct on (cr.line_id)
               cr.line_id
        from public.calculation_results cr
        where cr.line_id in (select line_id from member_lines)
        order by cr.line_id, cr.calculated_at desc, cr.id desc
    ),
    member_line_counts as (
        select ml.shipment_id,
               count(*) as line_count,
               count(*) filter (where c.line_id is null) as uncalculated_count
        from member_lines ml
        left join current_result c
          on c.line_id = ml.line_id
        group by ml.shipment_id
    )
    select coalesce(sum(mlc.line_count), 0),
           coalesce(sum(mlc.uncalculated_count), 0),
           count(*) filter (
               where mlc.shipment_id is null or mlc.line_count = 0
           )
    into v_line_count, v_uncalculated_count, v_empty_member_count
    from unnest(v_member_ids) as sid
    left join member_line_counts mlc
      on mlc.shipment_id = sid;

    if v_line_count = 0 or v_uncalculated_count > 0 or v_empty_member_count > 0 then
        return query select 'INCOMPLETE'::text, null::uuid;
        return;
    end if;

    -- ------------------------------------------------------------
    -- The fresh filed_snapshot.
    --
    -- Every numeric figure is produced by summing ::numeric (Postgres
    -- arbitrary precision -- exact for addition of exact decimals) and
    -- rendered back with ::text, which neither rounds nor reformats.
    -- No HALF_UP, no truncation, no "declaration-ready rounded total"
    -- anywhere: per docs/regulatory/CALCULATION_RULE_REGISTER.md
    -- RULE-EE-006 the declaration-time rounding METHOD is a genuine,
    -- escalated gap in the published EU text awaiting owner sign-off,
    -- and the payload's own `rounding` object says so in-band so a
    -- reader of an archived snapshot cannot mistake a full-precision
    -- figure for a rounded declaration figure.
    --
    -- `per_shipment` below still inner-joins current_result, unchanged
    -- from 20260829330000 -- and that is now safe rather than merely
    -- convenient: the INCOMPLETE check above guarantees every member id
    -- in v_member_ids has at least one line and every one of its lines
    -- has a current_result row, so this join can no longer silently
    -- drop a member. `totals.shipment_count = cardinality(v_member_ids)`
    -- is therefore a real invariant from this migration forward, not an
    -- accident of no member ever having been emptied.
    -- ------------------------------------------------------------
    with member_lines as (
        select sl.id as line_id, sl.shipment_id
        from public.shipment_lines sl
        where sl.shipment_id = any(v_member_ids)
    ),
    current_result as (
        select distinct on (cr.line_id)
               cr.line_id,
               cr.id as calculation_result_id,
               cr.shipment_id,
               cr.embedded_emissions_tco2e,
               cr.engine_version,
               cr.determination
        from public.calculation_results cr
        where cr.line_id in (select line_id from member_lines)
        order by cr.line_id, cr.calculated_at desc, cr.id desc
    ),
    per_shipment as (
        select s.id as shipment_id,
               s.reference,
               s.status as status_at_filing,
               count(c.line_id) as line_count,
               sum(c.embedded_emissions_tco2e::numeric) as embedded_emissions_tco2e
        from public.shipments s
        join current_result c
          on c.shipment_id = s.id
        where s.id = any(v_member_ids)
        group by s.id, s.reference, s.status
    )
    select jsonb_build_object(
        'snapshot_version', 1,
        'generated_at', to_jsonb(now()),
        'declaration_id', v_decl.id,
        'org_id', v_decl.org_id,
        'reporting_period', jsonb_build_object(
            'kind', v_decl.reporting_period_kind,
            'year', v_decl.reporting_period_year,
            'quarter', v_decl.reporting_period_quarter
        ),
        'member_shipment_ids', to_jsonb(v_member_ids),
        'totals', jsonb_build_object(
            'shipment_count', (select count(*) from per_shipment),
            'line_count', (select count(*) from current_result),
            'embedded_emissions_tco2e',
                (select sum(c.embedded_emissions_tco2e::numeric)::text
                 from current_result c)
        ),
        'shipments', (
            select coalesce(
                jsonb_agg(
                    jsonb_build_object(
                        'shipment_id', ps.shipment_id,
                        'reference', ps.reference,
                        'status_at_filing', ps.status_at_filing,
                        'line_count', ps.line_count,
                        'embedded_emissions_tco2e', ps.embedded_emissions_tco2e::text
                    )
                    order by ps.reference
                ),
                '[]'::jsonb
            )
            from per_shipment ps
        ),
        -- The re-provability anchor: which exact calculation_results
        -- rows this total was built from, and which engine/dataset
        -- versions produced them. P8's reproduction proof recomputes
        -- stored results from their own frozen snapshots; naming the
        -- rows here is what lets a filed declaration be re-proved the
        -- same way years later, rather than being an unattributed
        -- number.
        'provenance', jsonb_build_object(
            'engine_versions', (
                select coalesce(jsonb_agg(distinct c.engine_version), '[]'::jsonb)
                from current_result c
            ),
            'determination_methods', (
                select coalesce(jsonb_object_agg(m.method, m.n), '{}'::jsonb)
                from (
                    select coalesce(c.determination ->> 'method', 'UNKNOWN') as method,
                           count(*) as n
                    from current_result c
                    group by 1
                ) m
            ),
            'regulatory_dataset_versions', (
                select coalesce(
                    jsonb_agg(distinct c.determination -> 'resolution' ->> 'dataset_version'),
                    '[]'::jsonb
                )
                from current_result c
                where c.determination -> 'resolution' ->> 'dataset_version' is not null
            ),
            'calculation_result_ids', (
                select coalesce(jsonb_agg(c.calculation_result_id), '[]'::jsonb)
                from current_result c
            )
        ),
        'rounding', jsonb_build_object(
            'applied', false,
            'figures_are_full_precision', true,
            'declaration_rounding_method', 'UNRESOLVED_ESCALATED',
            'rule_ref', 'RULE-EE-006',
            'note',
                'Implementing Regulation (EU) 2025/2547 Annex II point A.1(6)-(8) '
                || 'states declaration-time precision CEILINGS (a reporting-period '
                || 'total in whole tonnes CO2e; specific embedded emissions to at '
                || 'most 5 digits after the comma) but states no rounding METHOD, '
                || 'and neither does Regulation (EU) 2023/956 or Implementing '
                || 'Regulation (EU) 2018/2066 Article 72, all three read in full. '
                || 'Per docs/regulatory/CALCULATION_RULE_REGISTER.md RULE-EE-006 '
                || 'that method is an escalated regulatory gap awaiting owner '
                || 'sign-off, so no rounding is applied to any figure in this '
                || 'snapshot. These are full-precision figures, not '
                || 'declaration-format rounded ones.'
        ),
        'scope', jsonb_build_object(
            'is_official_form', false,
            'filed_reference_is_declarant_supplied_verbatim', true,
            'note',
                'Snowkap''s own preparation summary, for the declarant''s own use. '
                || 'Snowkap prepares, explains, archives and records; the authorised '
                || 'declarant files through the official channel themselves '
                || '(docs/plans/MASTER_PLAN.md §22 -- official filing is out of '
                || 'scope). This payload does not reproduce, and does not claim to '
                || 'reproduce, the official CBAM registry submission form''s '
                || 'field-by-field layout.'
        )
    )
    into v_snapshot;

    -- The declaration flips FIRST, under the CAS guard, so that a lost
    -- race ends this call before anything else has been written -- the
    -- shipment LOCKs and audit rows below can then never outlive a
    -- filing that did not happen.
    update public.declarations d
    set status = 'FILED_RECORDED',
        filed_snapshot = v_snapshot,
        filed_reference = p_filed_reference,
        filed_at = now()
    where d.id = v_decl.id
      and d.status = 'READY';

    if not found then
        return query select 'NOT_READY'::text, null::uuid;
        return;
    end if;

    -- LOCK every member shipment still READY, and record the same
    -- shipment.locked audit event transitionShipmentStatus()
    -- (src/application/shipments/transition-shipment.ts) records for a
    -- hand-driven lock -- same event_type, same payload keys, plus the
    -- declaration that caused it. Locking shipments with no audit trail
    -- would be a real hole in the §21 chain, and this is the one place
    -- shipments are locked without going through that function.
    --
    -- The audit insert is written here rather than left to the caller
    -- (recordAuditEvent's usual convention,
    -- src/application/audit/record-audit-event.ts) because it must
    -- share this function's transaction: an audit row that survives a
    -- rolled-back filing, or a filing that commits without one, are
    -- both worse than the small precedent break. record_shared_data_consumption()
    -- (20260829310000) already inserts audit_events directly from a
    -- SECURITY DEFINER RPC for its own reason.
    with locked as (
        update public.shipments s
        set status = 'LOCKED'
        where s.id = any(v_member_ids)
          and s.org_id = v_decl.org_id
          and s.status = 'READY'
        returning s.id, s.reference
    ),
    locked_audit as (
        insert into public.audit_events (
            org_id,
            actor_type,
            actor_user_id,
            event_type,
            aggregate_type,
            aggregate_id,
            payload
        )
        select
            v_decl.org_id,
            'USER',
            auth.uid(),
            'shipment.locked',
            'SHIPMENT',
            l.id::text,
            jsonb_build_object(
                'reference', l.reference,
                'from_status', 'READY',
                'to_status', 'LOCKED',
                'locked_by_declaration_id', v_decl.id
            )
        from locked l
        returning 1
    )
    insert into public.audit_events (
        org_id,
        actor_type,
        actor_user_id,
        event_type,
        aggregate_type,
        aggregate_id,
        payload
    )
    values (
        v_decl.org_id,
        'USER',
        auth.uid(),
        'declaration.filed',
        'DECLARATION',
        v_decl.id::text,
        jsonb_build_object(
            'reporting_period_kind', v_decl.reporting_period_kind,
            'reporting_period_year', v_decl.reporting_period_year,
            'reporting_period_quarter', v_decl.reporting_period_quarter,
            'supersedes_declaration_id', v_decl.supersedes_declaration_id,
            'member_shipment_ids', to_jsonb(v_member_ids),
            'filed_reference', p_filed_reference,
            'line_count', v_line_count,
            'embedded_emissions_tco2e', v_snapshot -> 'totals' ->> 'embedded_emissions_tco2e',
            'rounding_applied', false,
            'rounding_rule_ref', 'RULE-EE-006'
        )
    );

    return query select 'OK'::text, v_decl.id;
end;
$$;

comment on function public.record_declaration_filed(uuid, text) is
    'Records -- never performs -- a CBAM filing the declarant made '
    'themselves through the official channel (docs/plans/MASTER_PLAN.md '
    '§22). FULLY ATOMIC: the declaration''s status/filed_snapshot/'
    'filed_reference/filed_at, the READY -> LOCKED transition of every '
    'member shipment, and every audit_events row for all of it commit or '
    'roll back together in this function''s single transaction. '
    'filed_snapshot is built from a FRESH aggregation of the '
    'member shipments'' current calculation_results at filing time, never '
    'from DRAFT-time cached numbers, and refuses (INCOMPLETE) rather '
    'than summing a line with no result as zero OR silently omitting a '
    'member shipment emptied of its lines after READY (20260829350000). '
    'Authorization is re-derived from auth.uid() against the '
    'declaration''s own org_id (this function takes no org parameter, '
    'so there is no caller-supplied tenancy claim to trust), and -- '
    '2026-08-29, P11 mandatory review, finding #3 -- checked in TWO '
    'steps, not one: membership in the declaration''s org first '
    '(NOT_FOUND if absent, indistinguishable from a nonexistent '
    'declaration id -- closes a cross-org existence oracle a caller '
    'with no relationship to the org could previously exploit), THEN '
    'admin/owner role (NOT_ADMIN if a real member lacks it). '
    'completeness_report on the declaration row is the application '
    'layer''s own DRAFT/READY-time evidence, NOT re-verified by this '
    'function -- what this function DOES independently re-verify at '
    'filing time (membership; admin/owner role; member lockability; '
    'every member line''s own completeness) is captured entirely in '
    'filed_snapshot itself, which is what a reader should trust over '
    'completeness_report if the two ever disagree.';

comment on column public.declarations.completeness_report is
    'The APPLICATION layer''s own findings (buildCompletenessReport, '
    'src/domain/declarations/completeness.ts) at the moment this row was '
    'last marked READY or refreshed while DRAFT -- frozen from READY '
    'onward by app.prevent_declaration_fact_change(). This is advisory '
    'evidence of what the app checked, NOT an attestation '
    'public.record_declaration_filed() re-verifies or trusts: a bare '
    'client UPDATE can write an arbitrary jsonb value here in the same '
    'statement that moves DRAFT -> READY (old.status is still DRAFT when '
    'the freeze trigger evaluates), so a forged report is structurally '
    'possible for anyone ADMIN+ of the row''s own org. What CANNOT be '
    'forged this way is the filed total itself: record_declaration_filed() '
    'never reads this column -- it independently re-derives membership, '
    'admin/owner role, member shipment lockability, and per-shipment '
    'line completeness from memberships/shipments/shipment_lines/'
    'calculation_results at filing time and writes ITS OWN findings '
    'into filed_snapshot, which is the record to trust if the two ever '
    'disagree.';


-- ============================================================
-- END OF MIGRATION
-- ============================================================
