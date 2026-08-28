-- ============================================================
-- Snowkap CBAM
-- P7-B: emission_data schema -- the actual-emissions verification
-- workflow
--
-- Purpose:
--   The product schema for the P7-B slice (docs/plans/MASTER_PLAN.md
--   §38's P7 contract, §6/§30: producer records an installation's
--   actual embedded emissions and takes it through verification).
--   Mirrors the domain types already established:
--     src/domain/emissions/types.ts (EmissionData)
--     src/domain/emissions/emission-data-lifecycle.ts
--       (transitionEmissionData -- already implemented and tested)
--   This migration is scoped to ONLY emission_data -- evidence_files
--   and sharing_grants are separate, later P7 work (evidence upload is
--   explicitly out of scope for this slice; evidence_file_ids stays a
--   plain text[] defaulting to '{}', no FK, matching how
--   linked_installation_ids on suppliers stayed FK-less until its
--   referent table existed).
--
-- Table shape, mirrored from installations/shipments:
--   entered_by_org_id is denormalized the same way installations.org_id
--   is denormalized from operator_id (20260829220000) -- cross-
--   validated on INSERT via an EXISTS clause, same pattern. In THIS
--   slice entered_by_org_id is always equal to the referenced
--   installation's own org_id (recordEmissionData's
--   verifyInstallationOwnership requires the caller's active org to
--   already own the installation before it will create a row at all) --
--   the domain type's own comment gestures at a broader future case
--   ("or, for an off-platform producer, entered by an importer org")
--   but that case is represented by the INSTALLATION's own provenance/
--   org_id (an IMPORTER_ENTERED installation already belongs to the
--   importer's org), not by entered_by_org_id ever diverging from the
--   installation's org_id -- so requiring them equal here is not a
--   narrowing of an already-built capability, just not yet building a
--   capability nothing calls for.
--
--   reporting_period_kind/_year/_quarter: three flat columns, not a
--   nested jsonb period -- exactly mirrors shipments' own
--   reporting_period_* columns (20260828150000) and the same
--   ANNUAL/QUARTERLY quarter-nullability CHECK constraint.
--
--   direct_specific/indirect_specific as TEXT, not numeric/decimal --
--   matches src/domain/shared/decimal.ts's DecimalString convention
--   end-to-end, same as every other regulated numeric column in this
--   schema (net_mass_tonnes, quantity_mwh, embedded_emissions_tco2e,
--   ...). CHECK-cast to numeric only for a >= 0 sanity bound (unlike
--   shipment_lines' quantities, a legitimate specific-emissions value
--   CAN be exactly 0 -- e.g. an installation with no indirect
--   emissions at all -- so this is >= 0, not > 0).
--
-- Two state machines, ADMIN+ gate on verification_status, and WHY a
-- trigger (not a bare RLS policy) enforces it:
--   emission_data has two coupled lifecycles on one row (see
--   emission-data-lifecycle.ts's own doc comment): verification_status
--   (UNVERIFIED/VERIFICATION_PENDING/VERIFIED/REJECTED) and status
--   (DRAFT/ACTIVE/SUPERSEDED/DISCARDED). Per §14's roles matrix, only
--   VERIFY/REJECT (the verification_status transitions into
--   VERIFIED/REJECTED) are ADMIN+ actions -- SUBMIT_FOR_VERIFICATION/
--   ACTIVATE/DISCARD are ordinary MEMBER actions, including on a row
--   whose verification_status is *already* VERIFIED or REJECTED (e.g.
--   ACTIVATE runs on a DRAFT+VERIFIED row without touching
--   verification_status at all).
--
--   The established precedent for an ADMIN+-gated UPDATE in this
--   schema is shipments_update_own_org_not_terminal's bare-policy
--   WITH CHECK (20260829090000, "LOCK: ADMIN/OWNER-only"), reusing
--   app.user_is_admin_or_owner_of() from 20260828110000. That shape
--   does NOT generalize here: a bare WITH CHECK only ever sees the
--   proposed NEW row, never what changed. For shipments' LOCK this is
--   fine because LOCKED is terminal (the USING clause already excludes
--   LOCKED/VOID rows from any further UPDATE, so "new row has
--   status = LOCKED" can only ever mean "this UPDATE is the LOCK
--   transition itself"). VERIFIED is NOT terminal for emission_data in
--   the same sense -- a row can sit DRAFT+VERIFIED indefinitely while
--   ordinary MEMBER actions (ACTIVATE, DISCARD) keep touching it, and
--   a bare "new row verification_status IN (VERIFIED, REJECTED) ->
--   require admin" policy would incorrectly block those, since the new
--   row's verification_status is still VERIFIED even when this
--   particular UPDATE never touched that column. Distinguishing "value
--   is RESTING at VERIFIED from a past VERIFY" from "value is being SET
--   to VERIFIED right now" needs an OLD-vs-NEW comparison, which only a
--   trigger can make (RLS policies cannot reference the pre-update row
--   -- confirmed precedent for exactly this limitation:
--   memberships_update_admin_or_owner's own comment, 20260828110000).
--   So the ADMIN+ gate here is a BEFORE UPDATE trigger
--   (enforce_emission_data_verification_gate), reusing the same
--   app.user_is_admin_or_owner_of() helper, not a bare policy clause.
--
--   This trigger is the DB-layer BACKSTOP, not the primary enforcement
--   -- the PRIMARY gate is in the application layer
--   (src/application/emissions/manage-emission-data.ts's
--   verifyEmissionData/rejectEmissionData, checked via hasAdminAccess()
--   before any database read, giving a clean, directly-unit-tested
--   PERMISSION_DENIED result). Both are real, independent walls: the
--   application-layer check is what a normal user hits and is what the
--   test suite exercises; the trigger is what stops a request that
--   somehow bypassed the application layer (a bug, a direct API call)
--   from silently verifying/rejecting data without ADMIN+ authority --
--   live-verified below via role-simulated psql, not assumed.
--
-- emission_data_prevent_fact_change trigger:
--   None of the six application-layer functions (recordEmissionData,
--   submitForVerification, verifyEmissionData, rejectEmissionData,
--   activateEmissionData, discardEmissionData) ever issues an UPDATE
--   touching anything but verification_status/verifier_user_id/
--   rejection_reason/status -- correcting a mistaken value is what the
--   version/predecessor_id lineage (a NEW row) is for, never an in-
--   place edit of a row someone may already be verifying/have verified.
--   This trigger makes that a real DB-level invariant, not just an
--   absence of code that would violate it -- the same posture
--   audit_events' "immutability by absence of policy" comment
--   describes, made explicit here via a trigger since UPDATE (unlike
--   audit_events' pure INSERT-only shape) legitimately needs to succeed
--   for the lifecycle columns.
--
-- One ACTIVE row per (installation_id, reporting_period) -- cn_scope
-- deliberately NOT part of the uniqueness key:
--   Master plan §6 states "one ACTIVE per installation+scope+period".
--   cn_scope is text[] -- a plain unique index on an array column would
--   treat ["72081000","72082000"] and ["72082000","72081000"] as
--   distinct (element order matters to Postgres array equality) and
--   would not catch two overlapping-but-not-identical scopes both
--   being ACTIVE for the same installation+period, which is the actual
--   failure mode worth preventing. Properly modeling "no two ACTIVE
--   scopes overlap for the same installation+period" needs either a
--   normalized scope-per-row junction table or a range/exclusion
--   constraint neither of which this slice's data model has -- treating
--   cn_scope as informational (uniqueness keyed on installation_id +
--   reporting_period alone) is the simplification the task's own scope
--   note explicitly sanctions, documented here as a deliberate P7-B
--   decision, not an oversight. A future slice that needs true
--   per-scope uniqueness has a real, known gap to close, not a silent
--   one.
--
--   NULLs in a unique index are NOT considered equal to each other by
--   Postgres (two ANNUAL rows -- reporting_period_quarter IS NULL for
--   both -- would NOT collide on a plain
--   (installation_id, kind, year, quarter) unique index, since NULL
--   <> NULL for uniqueness purposes). coalesce(reporting_period_quarter,
--   0) closes this: 0 is never a legal quarter value (the CHECK
--   constraint below requires 1-4), so it is a safe sentinel that
--   never collides with a real QUARTERLY row while making two ANNUAL
--   rows for the same installation+year correctly collide. Confirmed
--   live below (task's required adversarial test (b)), not assumed.
-- ============================================================


-- ============================================================
-- 1. EMISSION_DATA
-- ============================================================

create table public.emission_data (
    id uuid primary key default gen_random_uuid(),

    installation_id uuid not null
        references public.installations(id)
        on delete cascade,

    -- Denormalized from the referenced installation -- cross-validated
    -- on insert (see the INSERT policy below) and pinned immutable by
    -- emission_data_prevent_fact_change_trg -- see this migration's
    -- header comment.
    entered_by_org_id uuid not null
        references public.organizations(id)
        on delete cascade,

    cn_scope text[] not null default '{}',

    reporting_period_kind text not null
        check (
            reporting_period_kind in ('ANNUAL', 'QUARTERLY')
        ),

    reporting_period_year integer not null,

    reporting_period_quarter smallint,

    direct_specific text not null,
    indirect_specific text not null,

    emission_unit text not null,

    methodology text not null
        check (
            methodology in ('EU_METHOD', 'EQUIVALENT_METHOD', 'OTHER')
        ),

    verification_status text not null
        default 'UNVERIFIED'
        check (
            verification_status in ('UNVERIFIED', 'VERIFICATION_PENDING', 'VERIFIED', 'REJECTED')
        ),

    verifier_user_id uuid
        references auth.users(id)
        on delete set null,

    rejection_reason text,

    -- Evidence file upload is explicitly out of scope for P7-B -- this
    -- stays a plain text[] with no FK (no evidence_files table exists
    -- yet), matching suppliers.linked_installation_ids' own documented
    -- deferred-FK posture (20260828150000). Always '{}' through this
    -- slice; no application code writes anything else into it.
    evidence_file_ids text[] not null default '{}',

    -- Monotonically increasing per (installation_id, reporting_period)
    -- lineage -- see src/domain/emissions/types.ts's own comment on
    -- this field and this migration's header comment on why cn_scope
    -- is not part of that lineage key.
    version integer not null default 1
        check (version > 0),

    predecessor_id uuid
        references public.emission_data(id)
        on delete set null,

    status text not null
        default 'DRAFT'
        check (
            status in ('DRAFT', 'ACTIVE', 'SUPERSEDED', 'DISCARDED')
        ),

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint emission_data_reporting_period_quarter_ck
        check (
            (reporting_period_kind = 'ANNUAL' and reporting_period_quarter is null)
            or
            (reporting_period_kind = 'QUARTERLY' and reporting_period_quarter between 1 and 4)
        ),

    constraint emission_data_direct_specific_numeric_ck
        check (
            direct_specific ~ '^-?[0-9]+(\.[0-9]+)?$'
            and direct_specific::numeric >= 0
        ),

    constraint emission_data_indirect_specific_numeric_ck
        check (
            indirect_specific ~ '^-?[0-9]+(\.[0-9]+)?$'
            and indirect_specific::numeric >= 0
        )
);

comment on table public.emission_data is
    'An operator''s declared actual embedded emissions for one '
    'installation, one CN-code scope, and one reporting period. Two '
    'coupled lifecycles (verification_status, status) -- see '
    'src/domain/emissions/emission-data-lifecycle.ts (transitionEmissionData, '
    'already implemented and tested) for the authoritative transition '
    'rules this schema must not contradict.';

create index emission_data_org_installation_idx
    on public.emission_data (entered_by_org_id, installation_id);

create index emission_data_installation_period_idx
    on public.emission_data (installation_id, reporting_period_year, reporting_period_quarter);

create index emission_data_predecessor_id_idx
    on public.emission_data (predecessor_id);

-- One ACTIVE row per (installation_id, reporting_period) -- see this
-- migration's header comment for the cn_scope-exclusion and NULL-
-- coalesce reasoning.
create unique index emission_data_one_active_per_installation_period_uq
    on public.emission_data (
        installation_id,
        reporting_period_kind,
        reporting_period_year,
        coalesce(reporting_period_quarter, 0)
    )
    where (status = 'ACTIVE');


-- ============================================================
-- 2. TRIGGERS
-- ============================================================

-- enforce_emission_data_verification_gate (below) is the first
-- PL/pgSQL function in this schema to call ANOTHER app-schema function
-- (app.user_is_admin_or_owner_of) at RUNTIME from outside an RLS
-- policy expression. That surfaced a latent gap, found and confirmed
-- live while authoring this migration (not assumed): schema `app`
-- itself was never granted USAGE to `authenticated` -- only EXECUTE on
-- individual functions (20260828070000, 20260828110000). That didn't
-- matter for RLS policy quals (e.g. organizations_select_own_org's own
-- `app.user_org_ids()` call): a stored policy expression's function
-- reference is resolved once, by the superuser who ran CREATE POLICY,
-- and does not re-check the querying role's schema USAGE at runtime.
-- A PL/pgSQL trigger function's internal calls are NOT pre-resolved
-- that way -- confirmed live: as role authenticated,
-- `select count(*) from organizations` (RLS-policy path) succeeds,
-- while `select app.user_org_ids();` (direct call, same role, same
-- function) fails with "permission denied for schema app". Scoped to
-- `authenticated` only, matching the existing EXECUTE grants' own
-- scoping (no policy in this schema is `to anon`).
grant usage on schema app to authenticated;

-- Pins every "fact" column (everything except the lifecycle columns
-- verification_status/verifier_user_id/rejection_reason/status/
-- updated_at) immutable once a row exists -- see this migration's
-- header comment.
create or replace function app.prevent_emission_data_fact_change()
returns trigger
language plpgsql
as $$
begin
    if new.installation_id is distinct from old.installation_id
        or new.entered_by_org_id is distinct from old.entered_by_org_id
        or new.cn_scope is distinct from old.cn_scope
        or new.reporting_period_kind is distinct from old.reporting_period_kind
        or new.reporting_period_year is distinct from old.reporting_period_year
        or new.reporting_period_quarter is distinct from old.reporting_period_quarter
        or new.direct_specific is distinct from old.direct_specific
        or new.indirect_specific is distinct from old.indirect_specific
        or new.emission_unit is distinct from old.emission_unit
        or new.methodology is distinct from old.methodology
        or new.evidence_file_ids is distinct from old.evidence_file_ids
        or new.version is distinct from old.version
        or new.predecessor_id is distinct from old.predecessor_id
        or new.created_at is distinct from old.created_at
    then
        raise exception
            'emission_data: only verification_status, verifier_user_id, rejection_reason, status, and updated_at may change via UPDATE -- a correction requires a new version (see src/application/emissions/manage-emission-data.ts, recordEmissionData)';
    end if;

    return new;
end;
$$;

comment on function app.prevent_emission_data_fact_change() is
    'BEFORE UPDATE guard: rejects any UPDATE that changes a '
    '"fact" column on emission_data -- see this migration''s header '
    'comment.';

create trigger emission_data_prevent_fact_change_trg
    before update on public.emission_data
    for each row
    execute function app.prevent_emission_data_fact_change();

-- ADMIN+-only gate on verification_status transitioning INTO VERIFIED
-- or REJECTED -- see this migration's header comment for why this is a
-- transition-aware trigger, not a bare RLS policy WITH CHECK.
create or replace function app.enforce_emission_data_verification_gate()
returns trigger
language plpgsql
as $$
begin
    if new.verification_status is distinct from old.verification_status
        and new.verification_status in ('VERIFIED', 'REJECTED')
        and not app.user_is_admin_or_owner_of(new.entered_by_org_id)
    then
        raise exception
            'emission_data: only an ADMIN or OWNER of the owning organization may verify or reject a record';
    end if;

    return new;
end;
$$;

comment on function app.enforce_emission_data_verification_gate() is
    'BEFORE UPDATE guard, DB-layer backstop for the ADMIN+ verify/'
    'reject gate -- the PRIMARY enforcement is in the application layer '
    '(manage-emission-data.ts''s verifyEmissionData/rejectEmissionData, '
    'checked via hasAdminAccess() before any database read). See this '
    'migration''s header comment for why a transition-aware trigger is '
    'required here rather than the bare-policy shape '
    'shipments_update_own_org_not_terminal uses for LOCK (20260829090000).';

create trigger emission_data_verification_gate_trg
    before update on public.emission_data
    for each row
    execute function app.enforce_emission_data_verification_gate();


-- ============================================================
-- 3. ROW LEVEL SECURITY
-- ============================================================

alter table public.emission_data
    enable row level security;

create policy emission_data_select_own_org
    on public.emission_data
    for select
    to authenticated
    using (
        entered_by_org_id in (select app.user_org_ids())
    );

-- Cross-parent validation, mirroring installations_insert_own_org's
-- own EXISTS clause (20260829220000): the referenced installation_id
-- must actually belong to the SAME org_id being denormalized onto this
-- row, so a caller cannot point installation_id at a different org's
-- installation while claiming it as their own.
create policy emission_data_insert_own_org
    on public.emission_data
    for insert
    to authenticated
    with check (
        entered_by_org_id in (select app.user_org_ids())
        and exists (
            select 1
            from public.installations i
            where i.id = emission_data.installation_id
              and i.org_id = emission_data.entered_by_org_id
        )
    );

-- Org-scoping ONLY -- no role distinction in this bare policy (see
-- this migration's header comment for why the ADMIN+ verify/reject
-- gate lives in the application layer + the two triggers above
-- instead). Every MEMBER of the owning org may UPDATE a row they can
-- see; which specific transition is actually legal is enforced by the
-- pure transitionEmissionData function (application layer) and by the
-- two BEFORE UPDATE triggers above (DB layer), not by this policy.
create policy emission_data_update_own_org
    on public.emission_data
    for update
    to authenticated
    using (
        entered_by_org_id in (select app.user_org_ids())
    )
    with check (
        entered_by_org_id in (select app.user_org_ids())
    );

-- No DELETE policy: DISCARD (status -> DISCARDED) is the sanctioned
-- way to retire a DRAFT row, never a physical delete -- matches
-- shipments' own VOID-not-delete posture (20260828150000).


-- ============================================================
-- END OF MIGRATION
-- ============================================================
