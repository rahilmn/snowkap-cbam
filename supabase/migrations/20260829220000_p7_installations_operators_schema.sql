-- ============================================================
-- Snowkap CBAM
-- P7-A: operators + installations schema
--
-- Purpose:
--   The foundational product schema for the P7 slice
--   (docs/plans/MASTER_PLAN.md §38's P7 contract, §8: "installations ->
--   production activity -> emission data -> ... -> sharing"). Mirrors
--   the domain types already established in P1-E:
--     src/domain/installations/types.ts (Operator, Installation)
--   This migration is scoped to ONLY operators + installations --
--   emission_data, evidence_files, and sharing_grants are separate,
--   later P7 work.
--
-- Table shape, mirrored from suppliers
-- (20260828150000_p4_shipment_intake_schema.sql):
--   operators is the simpler analog (org-scoped, no parent FK) --
--   same column/constraint/RLS-policy style as suppliers. installations
--   is one level deeper: it has a real parent (operator_id), but still
--   denormalizes org_id onto the child row (rather than requiring a
--   join through operators on every RLS check) -- the same
--   denormalization rationale shipment_lines documents for its own
--   org_id column in that same migration.
--
-- Cross-parent validation on insert:
--   installations' INSERT policy's WITH CHECK verifies the referenced
--   operator_id actually belongs to the SAME org_id via an EXISTS
--   clause, mirroring shipment_lines_insert_parent_not_terminal's
--   exists-clause shape in the same migration (that one checks the
--   parent shipment's status; this one checks the parent operator's
--   org_id -- same pattern, different predicate). Without this, a
--   caller could denormalize org_id to their own org while pointing
--   operator_id at a DIFFERENT org's operator, which would silently
--   attribute installations to the wrong operator across tenants.
--
-- suppliers.linked_operator_id FK (announced, not yet added, by
-- 20260828150000's comment: "P7 adds the FK constraints via an
-- additive ALTER TABLE once those tables exist"):
--   linked_operator_id -> operators(id) is added below via ALTER
--   TABLE, now that operators exists. linked_installation_ids stays
--   without a real FK -- Postgres has no native array-FK constraint,
--   and a trigger-based per-element check is more machinery than this
--   P7-A slice warrants (no UI writes to linked_installation_ids yet;
--   suppliers.ts's application service doesn't even accept it as
--   input). Documented as a deferred gap on the column itself rather
--   than engineered now.
-- ============================================================


-- ============================================================
-- 1. OPERATORS
-- ============================================================

create table public.operators (
    id uuid primary key default gen_random_uuid(),

    org_id uuid not null
        references public.organizations(id)
        on delete cascade,

    -- Matches InstallationRecordProvenance in
    -- src/domain/installations/types.ts: distinguishes a record the
    -- producer entered themselves from one an importer entered on
    -- behalf of an off-platform producer with no Snowkap account.
    provenance text not null
        check (
            provenance in ('OPERATOR_PROVIDED', 'IMPORTER_ENTERED')
        ),

    name text not null,

    -- ISO 3166-1 alpha-2, matching src/domain/shared/country.ts.
    country text not null
        check (
            country ~ '^[A-Z]{2}$'
        ),

    contact_email text
        check (
            contact_email is null
            or contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
        ),

    created_at timestamptz not null default now()
);

comment on table public.operators is
    'The entity that runs a production Installation -- distinct from '
    'Supplier (commercial counterparty) by design (see '
    'src/domain/installations/types.ts module doc comment). '
    'provenance distinguishes producer-entered from importer-entered '
    '(off-platform producer) records.';

create index operators_org_id_idx
    on public.operators (org_id);

alter table public.operators
    enable row level security;

create policy operators_select_own_org
    on public.operators
    for select
    to authenticated
    using (
        org_id in (select app.user_org_ids())
    );

create policy operators_insert_own_org
    on public.operators
    for insert
    to authenticated
    with check (
        org_id in (select app.user_org_ids())
    );

create policy operators_delete_own_org
    on public.operators
    for delete
    to authenticated
    using (
        org_id in (select app.user_org_ids())
    );


-- ============================================================
-- 2. INSTALLATIONS
-- ============================================================

create table public.installations (
    id uuid primary key default gen_random_uuid(),

    operator_id uuid not null
        references public.operators(id)
        on delete cascade,

    -- Denormalized from the parent operator (cross-validated against
    -- it in the INSERT policy below, never independently writable to
    -- a different value there) so installations' own RLS policies can
    -- filter on org_id directly without a join on every SELECT --
    -- matches shipment_lines' own org_id column in
    -- 20260828150000_p4_shipment_intake_schema.sql.
    org_id uuid not null
        references public.organizations(id)
        on delete cascade,

    provenance text not null
        check (
            provenance in ('OPERATOR_PROVIDED', 'IMPORTER_ENTERED')
        ),

    name text not null,

    -- ISO 3166-1 alpha-2, matching src/domain/shared/country.ts.
    country text not null
        check (
            country ~ '^[A-Z]{2}$'
        ),

    -- UN/LOCODE: 2-letter country code + 3 alphanumeric location
    -- chars (e.g. "DEHAM"). Nullable -- matches Installation's
    -- un_locode: string | null.
    un_locode text
        check (
            un_locode is null
            or un_locode ~ '^[A-Z]{2}[A-Z0-9]{3}$'
        ),

    address text,

    -- Reserved for a future CBAM registry identifier; not required
    -- today -- matches src/domain/installations/types.ts's comment on
    -- the same field.
    cbam_installation_id text,

    created_at timestamptz not null default now()
);

comment on table public.installations is
    'One production site run by an Operator. org_id is denormalized '
    'from the parent operator and cross-validated on insert -- see '
    'this migration''s header comment.';

create index installations_org_id_idx
    on public.installations (org_id);

create index installations_operator_id_idx
    on public.installations (operator_id);

alter table public.installations
    enable row level security;

create policy installations_select_own_org
    on public.installations
    for select
    to authenticated
    using (
        org_id in (select app.user_org_ids())
    );

create policy installations_insert_own_org
    on public.installations
    for insert
    to authenticated
    with check (
        org_id in (select app.user_org_ids())
        and exists (
            select 1
            from public.operators o
            where o.id = installations.operator_id
              and o.org_id = installations.org_id
        )
    );

create policy installations_delete_own_org
    on public.installations
    for delete
    to authenticated
    using (
        org_id in (select app.user_org_ids())
    );


-- ============================================================
-- 3. SUPPLIERS.LINKED_OPERATOR_ID: additive FK constraint
--
-- Announced by 20260828150000_p4_shipment_intake_schema.sql's column
-- comment ("P7 adds the FK constraints via an additive ALTER TABLE
-- once those tables exist"). linked_installation_ids (uuid[]) has no
-- analogous constraint here -- see this migration's header comment.
-- ============================================================

alter table public.suppliers
    add constraint suppliers_linked_operator_id_fk
        foreign key (linked_operator_id)
        references public.operators(id)
        on delete set null;


-- ============================================================
-- END OF MIGRATION
-- ============================================================
