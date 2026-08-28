-- ============================================================
-- Snowkap CBAM
-- P4: shipment intake schema -- suppliers, shipments, shipment_lines,
-- import_batches
--
-- Purpose:
--   The product schema for docs/plans/MASTER_PLAN.md's P4 contract
--   (§38): "shipments and lines enter the system (manual + CSV)".
--   Mirrors the domain types already established in P1-E:
--     src/domain/shipments/types.ts (Shipment, ShipmentLine)
--     src/domain/installations/types.ts (Supplier)
--   and the lifecycle already implemented + tested in
--     src/domain/shipments/lifecycle.ts (transitionShipment)
--     src/domain/shipments/invariants.ts (isLineComplete,
--       isLineQuantityValid, hasDenseUniqueLineNumbers)
--
-- Regulated numerics as TEXT, not numeric/decimal columns:
--   net_mass_tonnes/quantity_mwh are stored as text (CHECK-cast to
--   numeric only for validation), matching src/domain/shared/decimal.ts's
--   DecimalString convention end-to-end and the same precision-loss
--   concern that motivated casting emission-value columns to text in
--   the regulatory schema (0bfd80e, "cast emission-value columns to
--   text to prevent scale loss").
--
-- Line completeness is NOT a DB constraint: "exactly one of
-- net_mass_tonnes/quantity_mwh" IS enforced (a line is created via a
-- complete form submission, matching ShipmentLine's non-nullable
-- domain fields), but "must have an emission_determination" is
-- deliberately NOT enforced here -- P4 does not populate that column
-- at all (resolution is P5 scope; the domain layer's own
-- isLineComplete already requires it for the READY transition, which
-- is an application-layer check via the pure transitionShipment
-- function, not a DB-level one).
--
-- LOCKED/VOID immutability (§19: "LOCKED/VOID immutable including
-- lines -- enforced app-side and by RLS update policies checking
-- parent status") is enforced by RLS here, not just application code:
-- shipments' own UPDATE policy excludes rows already LOCKED/VOID, and
-- shipment_lines' INSERT/UPDATE/DELETE policies check the PARENT
-- shipment's status via a direct EXISTS -- this is NOT the
-- self-referential-subquery-on-the-same-table recursion pattern this
-- session hit twice already (20260828110000's header comment): a
-- shipment_lines policy querying shipments is a one-directional
-- dependency (shipments' own policies never reference shipment_lines),
-- so no SECURITY DEFINER helper is needed for it, unlike
-- app.user_is_admin_or_owner_of() which exists specifically because
-- memberships needed to query itself.
--
-- audit_events gains its first authenticated-role INSERT policy here.
-- The base migration (20260828070000) deliberately left audit_events
-- INSERT-free for the authenticated role, reasoning that a bare insert
-- policy "would let a caller forge an arbitrary actor_user_id" --
-- true only without a WITH CHECK constraining it. This policy closes
-- that gap precisely: actor_user_id must equal auth.uid(), so a
-- caller can only ever record themselves as the actor, and org_id must
-- be one of their own orgs. This unblocks "audit events for all
-- mutations" (P4's explicit scope) via plain application-layer
-- inserts, without needing a bespoke SECURITY DEFINER RPC per mutation
-- the way organization creation needed one for its true multi-table
-- atomicity requirement. Also used retroactively to fill the
-- documented-but-never-filled gap where membership role
-- changes/removals (built later than 20260828090000's header comment
-- anticipated) never got audit events.
-- ============================================================


-- ============================================================
-- 1. SUPPLIERS
-- ============================================================

create table public.suppliers (
    id uuid primary key default gen_random_uuid(),

    org_id uuid not null
        references public.organizations(id)
        on delete cascade,

    name text not null,

    -- ISO 3166-1 alpha-2, matching src/domain/shared/country.ts.
    country text,

    contact_name text,
    contact_email text,

    -- No FK yet: public.operators/public.installations don't exist
    -- until P7. Application-code-validated only until then; P7 adds
    -- the FK constraints via an additive ALTER TABLE once those
    -- tables exist. Matches the domain type's non-nullable
    -- linked_installation_ids: OperatorId[] (empty array, not null,
    -- when nothing is linked).
    linked_operator_id uuid,
    linked_installation_ids uuid[] not null default '{}',

    created_at timestamptz not null default now(),

    constraint suppliers_country_format_ck
        check (
            country is null
            or country ~ '^[A-Z]{2}$'
        ),

    constraint suppliers_contact_email_format_ck
        check (
            contact_email is null
            or contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
        )
);

comment on table public.suppliers is
    'A commercial counterparty on the importer side -- distinct from '
    'Operator/Installation by design (docs/plans/MASTER_PLAN.md §6).';

create index suppliers_org_id_idx
    on public.suppliers (org_id);

alter table public.suppliers
    enable row level security;

create policy suppliers_select_own_org
    on public.suppliers
    for select
    to authenticated
    using (
        org_id in (select app.user_org_ids())
    );

create policy suppliers_insert_own_org
    on public.suppliers
    for insert
    to authenticated
    with check (
        org_id in (select app.user_org_ids())
    );

create policy suppliers_update_own_org
    on public.suppliers
    for update
    to authenticated
    using (
        org_id in (select app.user_org_ids())
    )
    with check (
        org_id in (select app.user_org_ids())
    );

create policy suppliers_delete_own_org
    on public.suppliers
    for delete
    to authenticated
    using (
        org_id in (select app.user_org_ids())
    );


-- ============================================================
-- 2. SHIPMENTS
-- ============================================================

create table public.shipments (
    id uuid primary key default gen_random_uuid(),

    org_id uuid not null
        references public.organizations(id)
        on delete cascade,

    reference text not null,

    release_date date not null,

    -- Derived from release_date via
    -- src/domain/shared/reporting-period.ts's
    -- reportingPeriodForReleaseDate() at creation time and stored
    -- (not recomputed on every read) -- release_date is immutable
    -- once meaningful data hangs off a shipment, and storing the
    -- derived period as real columns (rather than recomputing) is
    -- what makes the (org_id, reporting_period) index useful.
    reporting_period_kind text not null
        check (
            reporting_period_kind in ('ANNUAL', 'QUARTERLY')
        ),

    reporting_period_year integer not null,

    reporting_period_quarter smallint,

    customs_mrn text,

    customs_procedure text
        check (
            customs_procedure is null
            or customs_procedure in ('RELEASE_FOR_FREE_CIRCULATION', 'INWARD_PROCESSING')
        ),

    status text not null
        default 'DRAFT'
        check (
            status in ('DRAFT', 'READY', 'LOCKED', 'VOID')
        ),

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint shipments_org_reference_uq
        unique (org_id, reference),

    constraint shipments_reporting_period_quarter_ck
        check (
            (reporting_period_kind = 'ANNUAL' and reporting_period_quarter is null)
            or
            (reporting_period_kind = 'QUARTERLY' and reporting_period_quarter between 1 and 4)
        )
);

comment on table public.shipments is
    'One release-for-free-circulation event of CBAM goods. Lifecycle '
    'DRAFT -> READY -> LOCKED, VOID reachable from DRAFT/READY -- see '
    'src/domain/shipments/lifecycle.ts (transitionShipment, already '
    'implemented and tested) for the authoritative transition rules '
    'this schema must not contradict.';

create index shipments_org_status_idx
    on public.shipments (org_id, status);

create index shipments_org_reporting_period_idx
    on public.shipments (org_id, reporting_period_year, reporting_period_quarter);

alter table public.shipments
    enable row level security;

create policy shipments_select_own_org
    on public.shipments
    for select
    to authenticated
    using (
        org_id in (select app.user_org_ids())
    );

create policy shipments_insert_own_org
    on public.shipments
    for insert
    to authenticated
    with check (
        org_id in (select app.user_org_ids())
    );

-- LOCKED/VOID are terminal: the USING clause excludes rows already in
-- either state, so no further UPDATE (including status flips such as
-- an attempted "unlock") ever succeeds against them, matching
-- transitionShipment's own terminal-state handling. Transitioning
-- READY -> LOCKED is itself an UPDATE of a row that is NOT YET
-- LOCKED/VOID at the time of the check, so it is correctly permitted.
create policy shipments_update_own_org_not_terminal
    on public.shipments
    for update
    to authenticated
    using (
        org_id in (select app.user_org_ids())
        and status not in ('LOCKED', 'VOID')
    )
    with check (
        org_id in (select app.user_org_ids())
    );

-- No DELETE policy: VOID is the sanctioned way to retire a shipment
-- (never a physical delete), matching audit_events' own
-- delete-by-absence immutability posture elsewhere in this schema.


-- ============================================================
-- 3. SHIPMENT_LINES
-- ============================================================

create table public.shipment_lines (
    id uuid primary key default gen_random_uuid(),

    shipment_id uuid not null
        references public.shipments(id)
        on delete cascade,

    -- Denormalized from the parent shipment (never independently
    -- writable to a different value -- enforced by the INSERT/UPDATE
    -- policies' WITH CHECK below) so shipment_lines' own RLS policies
    -- can filter on org_id directly without an EXISTS/JOIN on every
    -- SELECT, matching docs/plans/MASTER_PLAN.md §12's guidance.
    org_id uuid not null
        references public.organizations(id)
        on delete cascade,

    line_number integer not null
        check (line_number > 0),

    cn_code text not null
        check (cn_code ~ '^\d{8}(\d{2})?$'),

    cn_code_level text not null
        check (cn_code_level in ('CN8', 'TARIC10')),

    goods_description text,

    origin_country text not null
        check (origin_country ~ '^[A-Z]{2}$'),

    -- Exactly one is set: a line is created via a complete form
    -- submission (the line editor screen collects everything before
    -- calling the create action), matching ShipmentLine's non-nullable
    -- domain fields -- see src/domain/shipments/invariants.ts's
    -- isLineQuantityValid, which this constraint mirrors exactly.
    net_mass_tonnes text,
    quantity_mwh text,

    production_route_name text,
    production_route_indicator text,

    -- P5 populates this (regulatory resolution); always null through
    -- P4. jsonb, not a typed column set, because
    -- EmissionDetermination (src/domain/emissions/types.ts) is a
    -- discriminated union with a nested frozen snapshot -- exactly
    -- the shape docs/plans/MASTER_PLAN.md §12 calls for storing as
    -- jsonb with generated columns for hot keys, which P5's migration
    -- will add (determination_method, resolution_reason,
    -- dataset_version) once there is real data to key on.
    emission_determination jsonb,

    constraint shipment_lines_line_number_uq
        unique (shipment_id, line_number),

    constraint shipment_lines_exactly_one_quantity_ck
        check (
            (net_mass_tonnes is not null) <> (quantity_mwh is not null)
        ),

    constraint shipment_lines_net_mass_positive_ck
        check (
            net_mass_tonnes is null
            or net_mass_tonnes::numeric > 0
        ),

    constraint shipment_lines_quantity_mwh_positive_ck
        check (
            quantity_mwh is null
            or quantity_mwh::numeric > 0
        ),

    constraint shipment_lines_production_route_pair_ck
        check (
            (production_route_name is null) = (production_route_indicator is null)
        )
);

comment on table public.shipment_lines is
    'One declared trade-code line within a Shipment. Immutable once '
    'the parent shipment is LOCKED/VOID -- enforced by this table''s '
    'own INSERT/UPDATE/DELETE policies checking the parent''s status, '
    'not by a trigger.';

create index shipment_lines_org_cn_code_idx
    on public.shipment_lines (org_id, cn_code);

create index shipment_lines_org_origin_country_idx
    on public.shipment_lines (org_id, origin_country);

create index shipment_lines_shipment_id_idx
    on public.shipment_lines (shipment_id);

alter table public.shipment_lines
    enable row level security;

create policy shipment_lines_select_own_org
    on public.shipment_lines
    for select
    to authenticated
    using (
        org_id in (select app.user_org_ids())
    );

create policy shipment_lines_insert_parent_not_terminal
    on public.shipment_lines
    for insert
    to authenticated
    with check (
        org_id in (select app.user_org_ids())
        and exists (
            select 1
            from public.shipments s
            where s.id = shipment_lines.shipment_id
              and s.org_id = shipment_lines.org_id
              and s.status not in ('LOCKED', 'VOID')
        )
    );

create policy shipment_lines_update_parent_not_terminal
    on public.shipment_lines
    for update
    to authenticated
    using (
        org_id in (select app.user_org_ids())
        and exists (
            select 1
            from public.shipments s
            where s.id = shipment_lines.shipment_id
              and s.org_id = shipment_lines.org_id
              and s.status not in ('LOCKED', 'VOID')
        )
    )
    with check (
        org_id in (select app.user_org_ids())
        and exists (
            select 1
            from public.shipments s
            where s.id = shipment_lines.shipment_id
              and s.org_id = shipment_lines.org_id
              and s.status not in ('LOCKED', 'VOID')
        )
    );

create policy shipment_lines_delete_parent_not_terminal
    on public.shipment_lines
    for delete
    to authenticated
    using (
        org_id in (select app.user_org_ids())
        and exists (
            select 1
            from public.shipments s
            where s.id = shipment_lines.shipment_id
              and s.org_id = shipment_lines.org_id
              and s.status not in ('LOCKED', 'VOID')
        )
    );


-- ============================================================
-- 4. IMPORT_BATCHES (minimal -- CSV import logic lands separately)
-- ============================================================

create table public.import_batches (
    id uuid primary key default gen_random_uuid(),

    org_id uuid not null
        references public.organizations(id)
        on delete cascade,

    created_by uuid not null
        references auth.users(id)
        on delete restrict,

    status text not null
        default 'PENDING'
        check (
            status in ('PENDING', 'VALIDATED', 'COMMITTED', 'FAILED')
        ),

    row_count integer,
    error_count integer,

    created_at timestamptz not null default now(),
    completed_at timestamptz
);

comment on table public.import_batches is
    'One CSV import attempt, for idempotency (a client-supplied '
    'import_batch_id) and audit -- columns are intentionally minimal '
    'until the actual import parse/validate/commit pipeline is built; '
    'this just reserves the identity and status lifecycle.';

create index import_batches_org_id_idx
    on public.import_batches (org_id);

alter table public.import_batches
    enable row level security;

create policy import_batches_select_own_org
    on public.import_batches
    for select
    to authenticated
    using (
        org_id in (select app.user_org_ids())
    );

create policy import_batches_insert_own_org
    on public.import_batches
    for insert
    to authenticated
    with check (
        org_id in (select app.user_org_ids())
        and created_by = auth.uid()
    );


-- ============================================================
-- 5. AUDIT_EVENTS: first authenticated-role INSERT policy
-- ============================================================

create policy audit_events_insert_own_org_as_self
    on public.audit_events
    for insert
    to authenticated
    with check (
        actor_type = 'USER'
        and actor_user_id = auth.uid()
        and org_id in (select app.user_org_ids())
    );

comment on policy audit_events_insert_own_org_as_self on public.audit_events is
    'The first authenticated-role INSERT policy on this table -- see '
    'this migration''s header comment for why a bare insert is now '
    'safe: actor_user_id must equal auth.uid(), so a caller can only '
    'ever record themselves as the actor (never forge a different '
    'user), and org_id must be one of their own orgs. SYSTEM-actor '
    'events (actor_type = ''SYSTEM'') still require service-role, '
    'since this policy''s WITH CHECK only ever admits USER-actor rows.';


-- ============================================================
-- END OF MIGRATION
-- ============================================================
