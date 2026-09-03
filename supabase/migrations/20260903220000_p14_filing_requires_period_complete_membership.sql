-- ============================================================
-- Snowkap CBAM
-- P14 remediation (2026-09-03): a filed declaration's membership was
-- never checked against its own reporting period.
--
-- Found by this remediation's bounded triage of the adversarial
-- review's declaration findings (brief section 5, items 2, 3, 4, 5) and
-- CONFIRMED LIVE before this migration was written -- one rolled-back
-- transaction, acting as a genuine ADMIN of the organisation, using
-- only writes the schema permits. All three returned OK:
--
--   ITEM 3+4  a 2026 declaration whose only member was a 2027 shipment
--             -> record_declaration_filed returned OK
--
--   ITEM 2    a 2026 declaration listing one of the period's two READY
--             shipments and omitting the other
--             -> OK, filing 2640 tCO2e against a period containing 3960
--
--   ITEM 5    the same shipment placed in two declarations for two
--             different periods, filed one after the other
--             -> both OK; two FILED_RECORDED rows citing one shipment
--
-- Item 2 is the serious one against this project's own release
-- boundary: a materially understated filed declaration, produced
-- without bypassing a single access control, by an administrator using
-- the product as designed.
--
-- ------------------------------------------------------------
-- WHY THE EXISTING GATE DID NOT CATCH ANY OF THEM
--
-- record_declaration_filed re-verifies, at filing time, nearly every
-- fact the draft was built from: that each member is READY or LOCKED
-- and belongs to the org; that each member line has a current
-- calculation; that the calculation's frozen determination still
-- matches the line's; that its frozen quantity and unit still match;
-- that no member has been emptied of its lines. Each of those clauses
-- exists because the window between "mark ready" and "record filed" is
-- writable, and each closed a live reproduction.
--
-- Membership itself was the one draft-time fact still taken on trust.
-- app.prevent_declaration_fact_change freezes member_shipment_ids once
-- the declaration leaves DRAFT, which stops it being edited afterwards
-- -- and says nothing about whether the set was ever right, or about
-- shipments that entered the period since. The frozen-ness was
-- mistaken for correctness.
--
-- ------------------------------------------------------------
-- THE INVARIANT THIS MIGRATION MAKES TRUE
--
--   A filed declaration covers exactly the shipments its reporting
--   period contains, and no shipment is ever filed twice.
--
-- Two new result_status values, mapped in
-- src/application/declarations/record-declaration-filed.ts:
-- MEMBERS_NOT_PERIOD_COMPLETE and SHIPMENT_ALREADY_FILED.
--
-- ------------------------------------------------------------
-- WHAT THIS DOES NOT CLOSE, stated rather than implied
--
-- A line DELETED from a READY member shipment before filing still
-- shrinks the filed total. The declaration stays internally honest --
-- filing re-aggregates from the lines that exist, and filed_snapshot's
-- per-shipment breakdown shows what was counted -- but what an
-- administrator approved at READY is not necessarily what gets filed.
-- That is a separate defect about READY not being binding on lines. It
-- is recorded as HIGH in the P14 remediation report and deliberately
-- not addressed here: making a READY shipment's lines immutable is a
-- product-behaviour change, not a filing-gate fix, and this migration
-- is scoped to one conceptual change.
--
-- The body below is the current function verbatim, with two new
-- declare-block variables and the two new clauses inserted immediately
-- after the SHIPMENTS_NOT_LOCKABLE check. Nothing else changed.
-- ============================================================

CREATE OR REPLACE FUNCTION public.record_declaration_filed(p_declaration_id uuid, p_filed_reference text)
 RETURNS TABLE(result_status text, result_declaration_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
    v_decl public.declarations%rowtype;
    v_member_ids uuid[];
    v_lockable_count bigint;
    v_line_count bigint;
    v_uncalculated_count bigint;
    v_empty_member_count bigint;
    v_snapshot jsonb;
    -- 2026-09-03 (P14 remediation, declaration-membership triage).
    v_period_member_ids uuid[];
    v_already_filed_reference text;
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

    -- ------------------------------------------------------------
    -- 2026-09-03 (P14 remediation). THE MEMBER SET MUST BE THE PERIOD.
    --
    -- Confirmed live before this clause existed, as a genuine ADMIN of
    -- the organisation, inside a rolled-back transaction, all three
    -- returning OK:
    --
    --   * a 2026 declaration whose only member was a 2027 shipment;
    --   * a 2026 declaration listing one of the period's two READY
    --     shipments and silently omitting the other -- filing a total
    --     of 2640 tCO2e against a period that contained 3960;
    --   * the same shipment frozen into TWO FILED_RECORDED
    --     declarations, for two different periods.
    --
    -- Every other draft-time fact this function re-verifies at filing
    -- time -- that members are lockable, that each line has a current
    -- calculation, that the calculation's frozen determination and
    -- quantity still match the line -- was added because the window
    -- between "mark ready" and "record filed" is writable. Membership
    -- itself was the one draft-time fact still taken on trust, even
    -- though it decides WHICH goods are declared at all.
    --
    -- app.prevent_declaration_fact_change freezes member_shipment_ids
    -- once the declaration leaves DRAFT. That stops it being edited
    -- afterwards, and says nothing about whether the set was ever
    -- right, or about shipments that entered the period since. The
    -- frozen-ness was mistaken for correctness.
    --
    -- The rule is not invented here. It is the SQL expression of what
    -- computeDeclarationDraftFacts already does when it builds the set
    -- (src/application/declarations/compute-declaration-draft-facts.ts:
    -- every shipment of this org, in this reporting period, that is not
    -- VOID) -- the same relationship to the application layer that the
    -- SHIPMENTS_NOT_LOCKABLE clause above has to transitionShipment's
    -- LOCK rule.
    --
    -- Set equality, not containment, because it has to catch both
    -- directions: a member that does not belong to the period, and a
    -- period shipment that is not a member.
    -- ------------------------------------------------------------
    select coalesce(array_agg(s.id order by s.id), array[]::uuid[])
    into v_period_member_ids
    from public.shipments s
    where s.org_id = v_decl.org_id
      and s.reporting_period_kind = v_decl.reporting_period_kind
      and s.reporting_period_year = v_decl.reporting_period_year
      and s.reporting_period_quarter is not distinct from v_decl.reporting_period_quarter
      and s.status <> 'VOID';

    if exists (
        select 1
        from (
            select unnest(v_member_ids) as id
            except
            select unnest(v_period_member_ids)
        ) as not_in_period
    ) or exists (
        select 1
        from (
            select unnest(v_period_member_ids) as id
            except
            select unnest(v_member_ids)
        ) as missing_from_members
    )
    then
        return query select 'MEMBERS_NOT_PERIOD_COMPLETE'::text, null::uuid;
        return;
    end if;

    -- ------------------------------------------------------------
    -- 2026-09-03 (P14 remediation). NO SHIPMENT IN TWO FILINGS.
    --
    -- An amendment legitimately re-declares the shipments its
    -- predecessor already filed, so this walks the supersede chain and
    -- excludes every declaration this one amends, transitively -- not
    -- only its immediate predecessor, because a correction to a
    -- correction is an ordinary case.
    --
    -- Anything else is the same goods declared twice, in immutable
    -- artifacts that each cite the same provenance. The duplication is
    -- otherwise discoverable only by cross-reading member ids across
    -- periods, which nothing in the product does.
    -- ------------------------------------------------------------
    with recursive amended as (
        select v_decl.supersedes_declaration_id as id
        union all
        select d.supersedes_declaration_id
        from public.declarations d
        join amended a on a.id = d.id
        where d.supersedes_declaration_id is not null
    )
    select other.filed_reference
    into v_already_filed_reference
    from public.declarations other
    where other.org_id = v_decl.org_id
      and other.id <> v_decl.id
      and other.status = 'FILED_RECORDED'
      and other.id not in (select id from amended where id is not null)
      and other.member_shipment_ids && v_member_ids
    limit 1;

    if v_already_filed_reference is not null then
        return query select 'SHIPMENT_ALREADY_FILED'::text, null::uuid;
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
    -- 2026-08-29 (P13 adversarial audit, live-reproduced -- see this
    -- migration's own header comment for the full mechanism):
    -- "re-determined" is the exact middle case this comment already
    -- named ("added, re-determined, or DELETED") but the
    -- implementation never checked -- a line CAN have a current_result
    -- row and still not be genuinely current, if that row's own frozen
    -- `determination` was computed against a DIFFERENT
    -- emission_determination than the line carries right now (Path A:
    -- redetermined without recalculating; Path B: quantity/cn_code
    -- edited, nulling emission_determination, while the pre-edit
    -- calculation_results row survives). member_lines now also carries
    -- each line's CURRENT emission_determination so member_line_counts
    -- can compare it against current_result's FROZEN determination and
    -- fold a mismatch into the SAME uncalculated_count/INCOMPLETE path
    -- a missing calculation already uses -- "calculated against a
    -- superseded determination" is treated exactly like "not
    -- calculated," never as a separate, weaker case. See the migration
    -- header for why bare jsonb `is distinct from` is the correct,
    -- already-structural comparison here, and why `is distinct from`
    -- (not `<>`) is required to also catch Path B's null current
    -- determination.
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
        select sl.id as line_id,
               sl.shipment_id,
               sl.emission_determination,
               -- 2026-09-03 (P14): the line's own quantity, so the
               -- calculation's frozen one can be compared against it.
               sl.net_mass_tonnes,
               sl.quantity_mwh
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
        -- selection rule anyone should depend on. `determination` is
        -- now selected too (P13 fix) -- see member_line_counts below
        -- for the comparison it feeds.
        select distinct on (cr.line_id)
               cr.line_id,
               cr.determination,
               cr.quantity,
               cr.quantity_unit
        from public.calculation_results cr
        where cr.line_id in (select line_id from member_lines)
        order by cr.line_id, cr.calculated_at desc, cr.id desc
    ),
    member_line_counts as (
        select ml.shipment_id,
               count(*) as line_count,
               count(*) filter (
                   where c.line_id is null
                      or c.determination is distinct from ml.emission_determination
                      -- 2026-09-03 (P14). The quantity the calculation
                      -- was performed against must be the quantity the
                      -- line declares. See this migration's header:
                      -- calculation_results is member-insertable, its
                      -- CHECK constrains the FORM of a decimal string
                      -- and never its magnitude, and a row carrying the
                      -- line's exact current determination with a
                      -- smaller quantity passes both the determination
                      -- comparison above and reproduceCalculationResult
                      -- -- which recomputes from the row's OWN inputs
                      -- and therefore cannot see that they are not the
                      -- line's.
                      --
                      -- Text comparison on purpose. Both columns hold
                      -- DecimalStrings as text, and byte-equality is
                      -- already this system's reproduction contract
                      -- (reproduce-calculation-result.ts compares with
                      -- ===). A ::numeric cast would accept '1000.0'
                      -- for '1000' -- true of the number, false of the
                      -- frozen fact -- and would throw outright on any
                      -- value the CHECK admits that numeric cannot
                      -- parse.
                      or c.quantity is distinct from coalesce(
                             ml.net_mass_tonnes,
                             ml.quantity_mwh
                         )
                      -- And against the same basis: '100' tonnes and
                      -- '100' MWh are different quantities that agree
                      -- digit for digit.
                      or c.quantity_unit is distinct from (
                             case
                                 when ml.net_mass_tonnes is not null then 'TONNES'
                                 else 'MWH'
                             end
                         )
               ) as uncalculated_count
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
    -- in v_member_ids has at least one line, every one of its lines has
    -- a current_result row, AND (P13 fix, this migration) that row's
    -- frozen determination matches the line's current one -- so this
    -- join can no longer silently drop a member, and the total it
    -- builds can no longer silently include a superseded determination.
    -- `totals.shipment_count = cardinality(v_member_ids)` is therefore a
    -- real invariant from this migration forward, not an accident of no
    -- member ever having been emptied or redetermined post-READY.
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
