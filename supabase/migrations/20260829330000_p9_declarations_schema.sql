-- ============================================================
-- Snowkap CBAM
-- P9: declarations schema + record_declaration_filed() RPC
--
-- Purpose:
--   The product schema for docs/plans/MASTER_PLAN.md's P9 contract
--   (§38: "`declarations` migration; completeness gate; record-filed ->
--   LOCK + filed snapshot; amendments as versions") and §6's
--   CBAMDeclaration row: "annual reporting_period, member shipments,
--   completeness report, DRAFT -> READY -> FILED_RECORDED, filed
--   snapshot, amendments as versions | FILED_RECORDED LOCKs member
--   shipments; Snowkap records filings, never performs them."
--
--   First new product table since P7-D's sharing_grants
--   (20260829260000). No src/domain/declarations/ module exists yet --
--   unlike shipments (whose lifecycle.ts predates 20260828150000) or
--   sharing_grants (whose grant-lifecycle.ts predates 20260829260000),
--   this schema is landing BEFORE its domain aggregate. That ordering
--   is deliberate for one reason only: the LOCK-on-file transition has
--   to be atomic across N shipments plus the declaration, which is a
--   database-shaped requirement, not a pure-function-shaped one (see
--   section 6's atomicity note). Everything a pure function CAN own --
--   the completeness report's own contents, which shipments belong to a
--   period, when a DRAFT may become READY -- is deliberately NOT
--   encoded here and stays for the domain module, exactly the way
--   20260828110000 kept the last-OWNER-per-org invariant in TypeScript
--   rather than duplicating it in PL/pgSQL.
--
-- REGULATORY HONESTY -- what this schema deliberately does NOT do:
--   docs/regulatory/CALCULATION_RULE_REGISTER.md RULE-EE-006 has
--   already read Regulation (EU) 2023/956, Implementing Regulation (EU)
--   2025/2547, and Implementing Regulation (EU) 2018/2066 in full and
--   established that the published text states declaration-time
--   precision CEILINGS (Annex II point A.1(6): a reporting-period total
--   "rounded to full tonnes"; point A.1(8): specific embedded emissions
--   to "a maximum of 5 digits after the comma") but nowhere states a
--   rounding METHOD -- half-up, half-even, truncation. That rule
--   escalates the method for owner sign-off and names the interim path
--   the P9 contract itself pre-approves ("declaration prep ships gated
--   behind the missing-facts state"). So: filed_snapshot below carries
--   FULL Decimal precision for every figure, no rounding applied
--   anywhere, plus an explicit `rounding` object naming RULE-EE-006 as
--   an open, escalated gap. A rounded "declaration-ready total" is
--   never produced here, and no column exists to hold one -- the same
--   posture the resolver takes toward UNAVAILABLE/REFERENCE_REQUIRED
--   and RULE-EE-009's Annex II interim gate takes toward ACTUAL
--   emissions: a value that was never established is never substituted.
--
--   Equally: filed_reference is EXACTLY what the declarant typed, stored
--   verbatim and never synthesized, reformatted, or validated into a
--   shape (no "filing confirmation number" is ever generated), and
--   filed_snapshot is labelled in its own payload as Snowkap's own
--   preparation summary -- never a claimed reproduction of the official
--   CBAM registry submission form. Master plan §22 is explicit that
--   official filing is out of scope: "the authorised declarant files
--   themselves, Snowkap prepares, explains, archives, and records."
--
-- Two period-uniqueness indexes, and why one is not enough:
--   The requirement is "no two live declarations for the same
--   (org, reporting period) at once", but "live" here means "non-VOID
--   AND not superseded by a later version" -- and "superseded by" is a
--   property of a DIFFERENT row (some other declaration's
--   supersedes_declaration_id pointing here), which a partial index
--   predicate structurally cannot see (predicates are row-local and
--   must be immutable). Rather than approximate that with one index
--   that silently permits half of what it reads as forbidding, the
--   invariant is split into the two row-local halves that together
--   imply it:
--
--     declarations_period_original_uq -- at most one non-VOID ORIGINAL
--       (supersedes_declaration_id is null) per (org, period). So the
--       SECOND non-VOID declaration anyone creates for a period is
--       structurally forced to declare which version it supersedes; two
--       unrelated originals for one period cannot both exist, which is
--       the actual corruption to prevent (two filings for 2026 with no
--       lineage between them).
--     declarations_period_in_preparation_uq -- at most one declaration
--       per (org, period) in DRAFT or READY. So two colleagues cannot
--       prepare competing versions of the same period simultaneously,
--       which the index above does not cover on its own once amendments
--       exist (an amendment is exempt from it by construction).
--
--   A third, declarations_supersedes_uq, keeps the version chain LINEAR
--   rather than branching: a given declaration may be superseded by at
--   most one non-VOID successor. Without it, D2 and D3 could both amend
--   D1 and "the current version of this period" would have no answer.
--   Same partial-unique shape as
--   organization_invitations_org_email_pending_uq (20260828130000) and
--   sharing_grants_installation_grantee_active_uq (20260829260000) --
--   VOID rows drop out of the index, so a discarded amendment attempt
--   does not permanently burn the slot.
--
--   coalesce(reporting_period_quarter, 0) rather than the bare column,
--   in both period indexes: Postgres treats NULLs as DISTINCT in a
--   unique index by default, and an ANNUAL declaration ALWAYS has a
--   null quarter (declarations_reporting_period_quarter_ck below). A
--   bare four-column index would therefore never collide for two ANNUAL
--   2026 rows -- i.e. it would silently fail to constrain the one
--   reporting-period kind §6 actually names ("annual reporting_period").
--   0 is safe as the sentinel because the CHECK constrains a real
--   quarter to 1..4. (PG15's `nulls not distinct` would also work; the
--   coalesce is used instead so the index reads the same regardless of
--   the server version this schema is ever restored onto.)
--
-- RLS: exactly ONE update policy, on purpose.
--   20260829300000's header comment records this session's hard-earned
--   lesson: Postgres OR-combines every applicable PERMISSIVE policy's
--   USING clauses into one set and, SEPARATELY, OR-combines every
--   applicable WITH CHECK clause into another -- they are not evaluated
--   as per-policy USING/WITH-CHECK pairs, so a caller can reach a row
--   through policy A's USING and land it through policy B's WITH CHECK.
--   That is precisely how a grantor admin could forge an acceptance on
--   sharing_grants, found BLOCKING in that migration's adversarial
--   review.
--
--   This table is designed so that composition hazard cannot arise in
--   the first place: there is exactly one FOR UPDATE policy
--   (declarations_update_own_org_pre_filing), so its USING and WITH
--   CHECK genuinely are a pair. SELECT/INSERT policies never
--   participate in an UPDATE's check. Anyone adding a SECOND update
--   policy to this table later must re-derive the whole composition
--   argument below -- the single-policy design IS the mitigation, not
--   an accident of there being only one thing to express today.
--
--   What that one policy admits, and what closes the rest:
--     USING     status in ('DRAFT','READY') and ADMIN+ of the row's org
--     WITH CHECK status in ('DRAFT','READY','VOID') and ADMIN+
--   so a bare client UPDATE can refresh a DRAFT, mark it READY, reopen
--   it, or VOID it -- and can NEVER produce a FILED_RECORDED row
--   (absent from WITH CHECK) nor touch one (absent from USING).
--   FILED_RECORDED is reachable only through
--   public.record_declaration_filed() (SECURITY DEFINER, bypasses RLS).
--
--   The INSERT policy carries the other half of that gate, which is easy
--   to forget: blocking FILED_RECORDED on UPDATE is worthless if a
--   client can simply INSERT a row that is already FILED_RECORDED with a
--   fabricated filed_snapshot/filed_reference. declarations_insert_own_org
--   therefore pins status = 'DRAFT' and all three filed_* columns null
--   at INSERT time.
--
--   app.prevent_declaration_fact_change() closes what WITH CHECK
--   structurally cannot express -- comparing a column against its own
--   PRE-update value (the limitation memberships_update_admin_or_owner's
--   own comment documents, 20260828110000). It uses the exact
--   status-pairing technique app.prevent_sharing_grant_fact_change()
--   uses for grantee_org_id (20260829300000): the filed_* columns may
--   change ONLY in a statement that also moves status READY ->
--   FILED_RECORDED. Since no RLS policy can ever produce
--   status = 'FILED_RECORDED', a bare client UPDATE can never satisfy
--   that pairing, whatever combination of column values it submits --
--   two independent layers, same as that migration's own security fix.
--
-- No DELETE policy: VOID is the sanctioned retirement path, matching
-- shipments (20260828150000), sharing_grants (20260829260000), and
-- audit_events' immutability-by-absence posture.
-- ============================================================


-- ============================================================
-- 1. DECLARATIONS
-- ============================================================

create table public.declarations (
    id uuid primary key default gen_random_uuid(),

    org_id uuid not null
        references public.organizations(id)
        on delete cascade,

    -- Mirrors shipments' own reporting-period shape 1:1
    -- (20260828150000), including the quarter-pairing CHECK below, so a
    -- declaration's period and its member shipments' periods are
    -- comparable without translation. §6 names ANNUAL as the
    -- declaration period; QUARTERLY is admitted here only because
    -- src/domain/shared/reporting-period.ts already models both and a
    -- period-kind mismatch between the two tables would be a silent
    -- source of "no shipments found" bugs.
    reporting_period_kind text not null
        check (
            reporting_period_kind in ('ANNUAL', 'QUARTERLY')
        ),

    reporting_period_year integer not null,

    reporting_period_quarter smallint,

    status text not null
        default 'DRAFT'
        check (
            status in ('DRAFT', 'READY', 'FILED_RECORDED', 'VOID')
        ),

    -- The frozen set of shipments this declaration covers. A uuid[] with
    -- no per-element FK -- Postgres cannot declare one, the same
    -- limitation suppliers.linked_installation_ids already carries
    -- (20260828150000). Referential validity is therefore not a
    -- structural guarantee here and must never be assumed to be one:
    -- record_declaration_filed() below re-checks, at filing time, that
    -- every id names a real shipment in THIS declaration's own org and
    -- is lockable, and refuses the whole filing otherwise.
    --
    -- Refreshed freely while DRAFT, frozen from READY onward by
    -- app.prevent_declaration_fact_change() -- "member shipments" and
    -- the completeness report they were judged by are one fact, so they
    -- freeze together, at the same moment, or the completeness gate
    -- would be attestable against a membership set that has since moved.
    member_shipment_ids uuid[] not null default '{}',

    -- The completeness gate's own findings at the moment this
    -- declaration was judged ready (blocking blockers, per-shipment
    -- reasons). jsonb rather than typed columns for the same reason
    -- shipment_lines.emission_determination is jsonb (20260828150000):
    -- the shape belongs to a domain type that does not exist yet, and
    -- freezing it prematurely into columns would be inventing it.
    completeness_report jsonb,

    -- Written ONLY by public.record_declaration_filed(), from a fresh
    -- aggregation pass at filing time -- never from DRAFT-time cached
    -- numbers. Full Decimal precision, never rounded; see this
    -- migration's REGULATORY HONESTY header block and section 6.
    filed_snapshot jsonb,

    -- EXACTLY what the declarant typed when recording their own filing
    -- with the official channel. Stored verbatim: never generated,
    -- never normalized, never parsed into a shape. Snowkap records a
    -- filing it did not perform (§22) -- inventing or reformatting this
    -- string would be manufacturing evidence of an event Snowkap did
    -- not witness. The only constraint applied is "not blank"
    -- (declarations_filed_reference_not_blank_ck), which rejects rather
    -- than transforms.
    filed_reference text,

    filed_at timestamptz,

    -- Null for an original; the immediately-preceding version for an
    -- amendment ("amendments as versions", §6). Self-referencing FK.
    -- ON DELETE CASCADE so an organization's own cascade delete
    -- (org_id above) cannot deadlock against this constraint by
    -- deleting a superseded row and its amendment in an unspecified
    -- order; there is no DELETE policy on this table at all, so the
    -- only deletes that ever reach it are service-role/cascade ones.
    supersedes_declaration_id uuid
        references public.declarations(id)
        on delete cascade,

    created_by_user_id uuid not null
        references auth.users(id)
        on delete restrict,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint declarations_reporting_period_quarter_ck
        check (
            (reporting_period_kind = 'ANNUAL' and reporting_period_quarter is null)
            or
            (reporting_period_kind = 'QUARTERLY' and reporting_period_quarter between 1 and 4)
        ),

    -- FILED_RECORDED <=> all three filing facts present. A real,
    -- permanent invariant rather than an unenforced assumption that
    -- record_declaration_filed() happens to write all four together --
    -- same reasoning as emission_data_verified_has_verifier_ck
    -- (20260829270000) and sharing_grants_active_requires_grantee_ck
    -- (20260829300000). The <=> (not merely =>) direction also means a
    -- DRAFT/READY/VOID row can never carry a stray filed_* value.
    constraint declarations_filed_facts_ck
        check (
            (status = 'FILED_RECORDED') = (filed_at is not null)
            and (status = 'FILED_RECORDED') = (filed_snapshot is not null)
            and (status = 'FILED_RECORDED') = (filed_reference is not null)
        ),

    constraint declarations_filed_reference_not_blank_ck
        check (
            filed_reference is null
            or btrim(filed_reference) <> ''
        ),

    constraint declarations_no_self_supersede_ck
        check (
            supersedes_declaration_id is distinct from id
        )
);

comment on table public.declarations is
    'One CBAM declaration for one reporting period. DRAFT -> READY -> '
    'FILED_RECORDED, VOID reachable from DRAFT/READY; amendments are new '
    'rows chained by supersedes_declaration_id, never edits to a filed '
    'row (docs/plans/MASTER_PLAN.md §6). Snowkap RECORDS a filing the '
    'declarant performed through the official channel themselves -- it '
    'never performs one, and filed_reference is verbatim declarant '
    'input, never synthesized (§22).';

comment on column public.declarations.filed_snapshot is
    'Frozen at FILED_RECORDED by public.record_declaration_filed(), from '
    'a fresh aggregation of the member shipments'' CURRENT calculation '
    'results -- never from DRAFT-time cached numbers. Every figure is '
    'full Decimal precision with no rounding applied; the payload''s own '
    '`rounding` object names docs/regulatory/CALCULATION_RULE_REGISTER.md '
    'RULE-EE-006 (declaration rounding METHOD: unresolved, escalated, '
    'owner sign-off pending) as the reason. Its `scope` object states '
    'plainly that this is Snowkap''s own preparation summary and not a '
    'reproduction of the official CBAM registry submission form.';

comment on column public.declarations.filed_reference is
    'Verbatim declarant-typed filing reference. Never generated, parsed, '
    'reformatted, or defaulted -- see this migration''s REGULATORY '
    'HONESTY header block.';

create index declarations_org_status_idx
    on public.declarations (org_id, status);

create index declarations_org_period_idx
    on public.declarations (org_id, reporting_period_year, reporting_period_quarter);

create index declarations_supersedes_idx
    on public.declarations (supersedes_declaration_id)
    where supersedes_declaration_id is not null;

-- See this migration's header comment ("Two period-uniqueness indexes")
-- for why these are two indexes and not one, and why the quarter is
-- coalesced rather than used bare.
create unique index declarations_period_original_uq
    on public.declarations (
        org_id,
        reporting_period_kind,
        reporting_period_year,
        (coalesce(reporting_period_quarter, 0))
    )
    where status <> 'VOID' and supersedes_declaration_id is null;

create unique index declarations_period_in_preparation_uq
    on public.declarations (
        org_id,
        reporting_period_kind,
        reporting_period_year,
        (coalesce(reporting_period_quarter, 0))
    )
    where status in ('DRAFT', 'READY');

create unique index declarations_supersedes_uq
    on public.declarations (supersedes_declaration_id)
    where supersedes_declaration_id is not null and status <> 'VOID';


-- ============================================================
-- 2. TRIGGERS
--
-- See this migration's header comment for why the fact-change guard
-- exists independently of the RLS policies (WITH CHECK cannot compare
-- against the pre-update row) and for the status-pairing technique it
-- borrows from app.prevent_sharing_grant_fact_change() (20260829300000).
-- ============================================================

create or replace function app.prevent_declaration_fact_change()
returns trigger
language plpgsql
as $$
declare
    -- The ONE statement shape in which the filing facts may be written.
    -- Deliberately pinned to old.status = 'READY' as well as
    -- new.status = 'FILED_RECORDED': the RPC already CAS-guards on
    -- READY, so this costs nothing there, and it means a filed row's
    -- own snapshot/reference/timestamp can never be rewritten later by
    -- any statement at all, not even another SECURITY DEFINER one that
    -- forgot to check the current status first.
    v_is_filing_transition boolean :=
        old.status = 'READY'
        and new.status = 'FILED_RECORDED';
begin
    if new.id is distinct from old.id
        or new.org_id is distinct from old.org_id
        or new.reporting_period_kind is distinct from old.reporting_period_kind
        or new.reporting_period_year is distinct from old.reporting_period_year
        or new.reporting_period_quarter is distinct from old.reporting_period_quarter
        or new.supersedes_declaration_id is distinct from old.supersedes_declaration_id
        or new.created_by_user_id is distinct from old.created_by_user_id
        or new.created_at is distinct from old.created_at
    then
        raise exception
            'declarations: org_id, reporting period, supersedes_declaration_id, created_by_user_id and created_at are immutable -- a correction is a new amendment row (supersedes_declaration_id), never an edit';
    end if;

    if old.status <> 'DRAFT'
        and (
            new.member_shipment_ids is distinct from old.member_shipment_ids
            or new.completeness_report is distinct from old.completeness_report
        )
    then
        raise exception
            'declarations: member_shipment_ids and completeness_report are frozen once a declaration leaves DRAFT -- REOPEN to DRAFT first, or amend via a new row';
    end if;

    if not v_is_filing_transition
        and (
            new.filed_snapshot is distinct from old.filed_snapshot
            or new.filed_reference is distinct from old.filed_reference
            or new.filed_at is distinct from old.filed_at
        )
    then
        raise exception
            'declarations: filed_snapshot, filed_reference and filed_at may only be written by public.record_declaration_filed(), in the same statement that moves status READY -> FILED_RECORDED';
    end if;

    return new;
end;
$$;

comment on function app.prevent_declaration_fact_change() is
    'BEFORE UPDATE guard on declarations. Three separate jobs, all of '
    'them things a WITH CHECK clause structurally cannot do (it never '
    'sees the pre-update row): pin the identity/period/lineage columns '
    'immutable; freeze member_shipment_ids + completeness_report once '
    'the row leaves DRAFT; and confine filed_snapshot/filed_reference/'
    'filed_at to the single READY -> FILED_RECORDED statement '
    'public.record_declaration_filed() issues. That last clause is the '
    'second of two independent layers -- the first being that no RLS '
    'policy on this table can ever produce a FILED_RECORDED row at all '
    '-- exactly the paired-layer design 20260829300000 arrived at for '
    'sharing_grants after its own review found a single-layer version '
    'bypassable.';

create trigger declarations_prevent_fact_change_trg
    before update on public.declarations
    for each row
    execute function app.prevent_declaration_fact_change();

-- app.touch_updated_at() (20260829280000) -- reused, not re-written;
-- that migration's own comment records that it was made generic
-- (keyed on NEW/OLD, not one table) precisely so later tables could
-- attach to it. Firing order against the guard above does not matter:
-- the guard does not inspect updated_at (same check that migration
-- made for emission_data/sharing_grants).
create trigger declarations_touch_updated_at_trg
    before update on public.declarations
    for each row
    execute function app.touch_updated_at();


-- ============================================================
-- 3. ROW LEVEL SECURITY
-- ============================================================

alter table public.declarations
    enable row level security;

-- MEMBER+, read-only for the whole org. Master plan §27 puts
-- Declaration PREPARATION (screen 22) at ADMIN+, but Reports (screen
-- 21) at MEMBER+ -- and "which declaration covers this period, and
-- where has it got to" is reporting, not preparation. Hiding the row
-- from a MEMBER would only make the shipment LOCK they can already see
-- inexplicable to them. The ADMIN+ gate lives on the write paths below
-- and inside record_declaration_filed(), where it belongs.
create policy declarations_select_own_org
    on public.declarations
    for select
    to authenticated
    using (
        org_id in (select app.user_org_ids())
    );

-- ADMIN+ only, creating a DRAFT owned by their own org, as themselves.
--
-- status/filed_* are pinned here for the reason this migration's header
-- comment gives: an UPDATE-side ban on FILED_RECORDED is worthless if
-- INSERT can mint one directly.
--
-- The supersedes_declaration_id EXISTS mirrors
-- sharing_grants_insert_own_org's own cross-parent check
-- (20260829260000: "the referenced installation_id must actually belong
-- to the SAME grantor_org_id"). Without it, a FK to declarations(id) --
-- which, per Postgres, bypasses RLS for referential integrity -- would
-- happily accept another org's declaration id as this amendment's
-- predecessor: it discloses nothing (the row stays unreadable), but it
-- would corrupt the version chain with a cross-tenant edge. Unlike
-- 20260829300000's installations/sharing_grants case, a raw EXISTS is
-- safe here rather than needing a SECURITY DEFINER helper: it re-enters
-- declarations' OWN select policy, which reads only memberships (via
-- app.user_org_ids()) and never declarations, so there is no cycle to
-- recurse on.
--
-- ^ THAT REASONING IS WRONG, and this clause does not work. Left here
-- verbatim because it is what was applied, and superseded by
-- 20260829340000_p9_declarations_insert_policy_recursion_fix.sql -- read
-- that migration's header before touching this policy. Postgres refuses
-- to re-enter RLS expansion for a relation it is already expanding,
-- whatever the other policy happens to read; the cycle does not have to
-- close through a second table. Reproduced live on the very first INSERT
-- the P9 integration suite attempted: "infinite recursion detected in
-- policy for relation declarations" (SQLSTATE 42P17), on EVERY insert
-- into this table, amendment or not.
create policy declarations_insert_own_org
    on public.declarations
    for insert
    to authenticated
    with check (
        app.user_is_admin_or_owner_of(org_id)
        and created_by_user_id = auth.uid()
        and status = 'DRAFT'
        and filed_snapshot is null
        and filed_reference is null
        and filed_at is null
        and (
            supersedes_declaration_id is null
            or exists (
                select 1
                from public.declarations prior
                where prior.id = declarations.supersedes_declaration_id
                  and prior.org_id = declarations.org_id
                  and prior.reporting_period_kind = declarations.reporting_period_kind
                  and prior.reporting_period_year = declarations.reporting_period_year
                  and prior.reporting_period_quarter
                      is not distinct from declarations.reporting_period_quarter
            )
        )
    );

-- THE ONLY update policy on this table -- see this migration's header
-- comment ("RLS: exactly ONE update policy, on purpose") before adding
-- a second one.
create policy declarations_update_own_org_pre_filing
    on public.declarations
    for update
    to authenticated
    using (
        app.user_is_admin_or_owner_of(org_id)
        and status in ('DRAFT', 'READY')
    )
    with check (
        app.user_is_admin_or_owner_of(org_id)
        and status in ('DRAFT', 'READY', 'VOID')
    );

comment on policy declarations_update_own_org_pre_filing on public.declarations is
    'Admits exactly the four bare-client transitions: refresh a DRAFT, '
    'DRAFT -> READY, READY -> DRAFT (reopen), and DRAFT|READY -> VOID. '
    'FILED_RECORDED is absent from BOTH clauses, so a client can neither '
    'produce a filed row nor touch one; filing is '
    'public.record_declaration_filed() only. Column-level protection '
    '(what a permitted UPDATE may change ABOUT the row) is '
    'app.prevent_declaration_fact_change()''s job, not this policy''s -- '
    'WITH CHECK cannot see the pre-update row.';

-- No DELETE policy -- VOID is the retirement path (see header comment).


-- ============================================================
-- 4. RECORD DECLARATION FILED (SECURITY DEFINER RPC)
--
-- ATOMICITY -- the decision, stated plainly:
--   FULLY ATOMIC. A PostgREST rpc() call runs the whole function body
--   in one transaction, so the declaration's own status +
--   filed_snapshot + filed_reference + filed_at, the READY -> LOCKED
--   transition of EVERY member shipment, and every audit_events row for
--   all of it either all commit or all roll back. There is no window in
--   which some shipments are locked and the declaration is not, or in
--   which a filed declaration points at unlocked shipments. This is the
--   whole reason the shipment LOCKs live in here rather than in an
--   application-layer loop over transitionShipmentStatus() after the
--   RPC: that loop is N separate PostgREST round trips with N separate
--   transactions, and a crash midway through would leave exactly the
--   half-locked state §6's "FILED_RECORDED LOCKs member shipments"
--   cannot tolerate.
--
--   The cost of choosing atomicity here, named rather than hidden: the
--   LOCK rule is expressed TWICE -- once in
--   src/domain/shipments/lifecycle.ts (transitionShipment's LOCK case:
--   "READY, or reject") and once in SQL below -- which is the exact
--   duplication 20260828110000 refused for the last-OWNER invariant and
--   src/application/shipments/transition-shipment.ts's own doc comment
--   refuses in general ("the invariant is deliberately not
--   re-implemented in SQL"). It is accepted here only because this
--   particular rule is one line with no cross-row reasoning ("status
--   must be READY"), not a real invariant with its own tests, and
--   because the alternative is a genuinely non-atomic filing. Anything
--   richer than that -- the completeness gate, which shipments belong to
--   a period, whether a DRAFT may become READY -- stays in TypeScript
--   and is NOT duplicated here.
--
--   Two things are deliberately NOT re-derived in SQL and stay the
--   application layer's job, so this function is not mistaken for the
--   whole gate: (a) which shipments belong to the period at all
--   (member_shipment_ids is set while DRAFT and frozen at READY -- this
--   function re-validates that set but never recomputes it); (b) the
--   completeness report's own contents. What this function DOES
--   independently re-check, because a fresh aggregation could disagree
--   with a stale DRAFT-time one, is that every member line actually has
--   a calculation result right now -- INCOMPLETE, below.
--
-- Result statuses (a normal double-click or a concurrent edit produces
-- these; they are returned, not raised, matching
-- accept_sharing_grant_invitation's own convention, 20260829300000):
--   NOT_FOUND               no such declaration
--   NOT_ADMIN               caller is not ADMIN/OWNER of its org
--   ALREADY_FILED           already FILED_RECORDED (the double-click)
--   NOT_READY               DRAFT or VOID
--   EMPTY_FILED_REFERENCE   nothing was actually typed
--   NO_MEMBER_SHIPMENTS     the frozen member set is empty
--   SHIPMENTS_NOT_LOCKABLE  a member id is not a READY-or-already-LOCKED
--                           shipment of this org
--   INCOMPLETE              a member line has no calculation result
--   OK
--
-- Only a genuinely impossible state raises: an unauthenticated caller.
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
    -- LOCKED/VOID), so a line can be added or re-determined AFTER the
    -- completeness gate passed and BEFORE anyone clicks "record filed".
    --
    -- A line with no calculation result is refused, never summed as
    -- zero and never quietly omitted from the total -- the same
    -- "no value is not a value of zero" rule CLAUDE.md states for the
    -- regulatory resolver and RULE-EE-005 states for the engine. A
    -- silently-understated filed total is the single worst failure this
    -- function could produce.
    with member_lines as (
        select sl.id as line_id
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
    )
    select count(*),
           count(*) filter (where c.line_id is null)
    into v_line_count, v_uncalculated_count
    from member_lines ml
    left join current_result c
      on c.line_id = ml.line_id;

    if v_line_count = 0 or v_uncalculated_count > 0 then
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
    'roll back together in this function''s single transaction -- see '
    'this migration''s section 4 header for why the shipment LOCKs are '
    'in SQL here rather than an application-layer loop, and what that '
    'costs. filed_snapshot is built from a FRESH aggregation of the '
    'member shipments'' current calculation_results at filing time, never '
    'from DRAFT-time cached numbers, and refuses (INCOMPLETE) rather '
    'than summing a line with no result as zero. Every figure in it is '
    'full Decimal precision, unrounded, with '
    'docs/regulatory/CALCULATION_RULE_REGISTER.md RULE-EE-006 named '
    'in-band as the reason (the declaration-time rounding METHOD is an '
    'escalated, unresolved gap in the published EU text). '
    'p_filed_reference is stored verbatim -- Snowkap never generates a '
    'filing reference. Authorization is re-derived from auth.uid() '
    'against the declaration''s own org_id; this function takes no org '
    'parameter, so there is no caller-supplied tenancy claim to trust.';

revoke all on function public.record_declaration_filed(uuid, text) from public;
grant execute on function public.record_declaration_filed(uuid, text) to authenticated;


-- ============================================================
-- END OF MIGRATION
-- ============================================================
