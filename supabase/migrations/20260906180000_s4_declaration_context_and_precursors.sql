-- ============================================================
-- Snowkap CBAM SME Experience -- S4
-- emission_data_declaration_context and emission_data_precursors: the
-- two tables v2.1.1 authorizes for the producer's "dossier" experience.
--
-- Both are child tables of emission_data, structurally identical in
-- shape to evidence_files (20260829240000): org_id denormalized from
-- the parent's own entered_by_org_id, cross-validated on INSERT via
-- the same EXISTS-against-parent pattern, RLS scoped by org membership
-- only (no lifecycle/status gating in RLS -- see emission_data_update_
-- own_org's own comment, 20260829230000: "which specific transition is
-- actually legal is enforced by the application layer... not by this
-- policy"; emission_data_declaration_context/emission_data_precursors
-- follow that exact precedent -- editable only while the parent
-- emission_data.status = 'DRAFT' is an application-layer check, in
-- src/application/emissions/manage-declaration-context.ts and
-- manage-precursors.ts, not a DB trigger).
--
-- ------------------------------------------------------------
-- WHY TWO TABLES, NOT ONE
--
-- emission_data_declaration_context is 1:1 with emission_data (a
-- unique constraint on emission_data_id enforces this) -- narrative/
-- structured context about the DECLARED PRODUCT ITSELF: a
-- plain-language description of the production process, whether the
-- operator uses CBAM-covered material purchased from another producer
-- (the precursor gate question, v2.1.1 §12), and whether the operator
-- declares a verifier report exists for THIS emission_data row's own
-- direct/indirect_specific figures (v2.1.1 §13) -- a DECLARATION, never
-- a claim that Snowkap performed or validated any verification
-- (verifier_report_description is free text the operator supplies;
-- nothing here checks it against anything).
--
-- emission_data_precursors is 1:many -- one row per CBAM-covered
-- precursor material the operator identifies, each with its OWN
-- provenance: does the operator have this precursor's own actual
-- embedded-emissions figures, and if so, do they declare a verifier
-- report backs THAT figure specifically (ACTUAL_WITH_DECLARED_REPORT,
-- v2.1.1 §12 -- kept distinct from ACTUAL_NO_DECLARED_REPORT and
-- UNKNOWN so an absent figure is never confused with a declared-and-
-- reported one). No SEE value is ever invented here: direct_specific/
-- indirect_specific are nullable, and a row with neither populated
-- (provenance UNKNOWN) is a legitimate, complete answer -- "we don't
-- have this precursor's own figures" -- not an incomplete row.
-- ============================================================


-- ------------------------------------------------------------
-- Part 1: audit_events aggregate_type -- two new child aggregates,
-- matching evidence_files' own reasoning (20260829240000): each is a
-- genuine new aggregate with its own lifecycle (created/updated),
-- not a sub-detail folded into EMISSION_DATA's own audit trail.
-- ------------------------------------------------------------
alter table public.audit_events
    drop constraint audit_events_aggregate_type_check;

alter table public.audit_events
    add constraint audit_events_aggregate_type_check
    check (
        aggregate_type in (
            'ORGANIZATION',
            'MEMBERSHIP',
            'SHIPMENT',
            'SHIPMENT_LINE',
            'EMISSION_DATA',
            'INSTALLATION',
            'OPERATOR',
            'SUPPLIER',
            'SHARING_GRANT',
            'CALCULATION_RESULT',
            'DECLARATION',
            'EVIDENCE_FILE',
            'DECLARATION_CONTEXT',
            'PRECURSOR'
        )
    );


-- ============================================================
-- Part 2: EMISSION_DATA_DECLARATION_CONTEXT
-- ============================================================

create table public.emission_data_declaration_context (
    id uuid primary key default gen_random_uuid(),

    org_id uuid not null
        references public.organizations(id)
        on delete cascade,

    emission_data_id uuid not null
        references public.emission_data(id)
        on delete cascade,

    -- Plain-language description of the production process -- the
    -- "ask plain-language production questions" requirement (v2.1.1
    -- §7). Free text: no structured process taxonomy is authorized by
    -- this phase, and none is invented here.
    production_process_description text,

    -- The precursor gate question (v2.1.1 §12): "Do you use
    -- CBAM-covered material purchased from another producer?" Rows in
    -- emission_data_precursors are meaningful only when this is true,
    -- but that is an application-layer expectation, not a DB
    -- constraint -- a false gate with existing precursor rows is not
    -- itself an integrity violation this table needs to police.
    uses_purchased_precursors boolean not null default false,

    -- v2.1.1 §13: the operator's own DECLARATION that a verifier
    -- report exists for this emission_data row's own figures. Never a
    -- claim that Snowkap validated anything -- see
    -- src/domain/status-vocabulary/verification-phrases.ts for the
    -- exact allowed UI wording this backs.
    verifier_report_declared boolean not null default false,

    verifier_report_description text
        check (
            verifier_report_declared or verifier_report_description is null
        ),

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint emission_data_declaration_context_one_per_record_uq
        unique (emission_data_id)
);

comment on table public.emission_data_declaration_context is
    'One row per emission_data record: plain-language production '
    'process context, the precursor gate answer, and the operator''s '
    'own verifier-report declaration. 1:1 with emission_data (unique '
    'constraint on emission_data_id). Snowkap CBAM SME Experience '
    'v2.1.1, S4.';

comment on column public.emission_data_declaration_context.verifier_report_declared is
    'The OPERATOR''s own declaration that a verifier report exists -- '
    'never validated, checked, or independently confirmed by Snowkap. '
    'See verification-phrases.ts for the exact allowed UI wording.';

create index emission_data_declaration_context_org_idx
    on public.emission_data_declaration_context (org_id);


-- ============================================================
-- Part 3: EMISSION_DATA_PRECURSORS
-- ============================================================

create table public.emission_data_precursors (
    id uuid primary key default gen_random_uuid(),

    org_id uuid not null
        references public.organizations(id)
        on delete cascade,

    emission_data_id uuid not null
        references public.emission_data(id)
        on delete cascade,

    material_description text not null
        check (length(material_description) > 0),

    -- Optional: the precursor's own CN/TARIC code, if the operator
    -- knows it. Free text, not validated against the regulatory
    -- classification system (src/domain/regulatory/** is the
    -- protected zone's own concern, never duplicated here).
    cn_code text,

    -- Free text (e.g. "purchased from Acme Steel, DE") -- not a
    -- foreign key to another Snowkap organization. A precursor
    -- supplier is not assumed to be a Snowkap user at all.
    source_description text,

    -- Same canonical decimal grammar as
    -- emission_data_direct_specific_numeric_ck (20260829230000) and
    -- src/domain/shared/decimal.ts's CANONICAL_DECIMAL_PATTERN --
    -- nullable here (unlike emission_data's own columns) because the
    -- operator may genuinely not have this precursor's own figures;
    -- see this migration's header comment on why that is a complete
    -- answer, not an incomplete row.
    direct_specific text
        check (
            direct_specific is null
            or (
                direct_specific ~ '^-?[0-9]+(\.[0-9]+)?$'
                and direct_specific::numeric >= 0
            )
        ),

    indirect_specific text
        check (
            indirect_specific is null
            or (
                indirect_specific ~ '^-?[0-9]+(\.[0-9]+)?$'
                and indirect_specific::numeric >= 0
            )
        ),

    emission_unit text,

    -- v2.1.1 §12: does the operator have this precursor's own actual
    -- embedded-emissions figures, and if so, do they declare a
    -- verifier report backs them specifically. Kept distinct from
    -- emission_data_declaration_context's own verifier_report_declared
    -- -- a precursor's report is a claim about THAT material, not
    -- about the emission_data row's own finished-product figures.
    provenance text not null
        default 'UNKNOWN'
        check (
            provenance in (
                'ACTUAL_WITH_DECLARED_REPORT',
                'ACTUAL_NO_DECLARED_REPORT',
                'UNKNOWN'
            )
        ),

    verifier_report_description text
        check (
            provenance = 'ACTUAL_WITH_DECLARED_REPORT'
            or verifier_report_description is null
        ),

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

comment on table public.emission_data_precursors is
    'One row per CBAM-covered precursor material an operator '
    'identifies for one emission_data record. 1:many with '
    'emission_data. No SEE value is ever invented here -- direct_'
    'specific/indirect_specific are nullable, and provenance=UNKNOWN '
    'with both null is a complete, honest answer. Snowkap CBAM SME '
    'Experience v2.1.1, S4.';

comment on column public.emission_data_precursors.provenance is
    'ACTUAL_WITH_DECLARED_REPORT: operator provides this precursor''s '
    'own figures AND declares a verifier report exists for them -- '
    'never validated by Snowkap. ACTUAL_NO_DECLARED_REPORT: figures '
    'provided, no report claimed. UNKNOWN: the operator does not have '
    'this precursor''s own figures.';

create index emission_data_precursors_org_emission_data_idx
    on public.emission_data_precursors (org_id, emission_data_id);


-- ============================================================
-- Part 4: ROW LEVEL SECURITY
--
-- Both tables: org-scoping only, mirroring evidence_files_select_own_
-- org / evidence_files_insert_own_org (20260829240000) and emission_
-- data_update_own_org's own stated reasoning (20260829230000) for why
-- lifecycle-stage editability is an application-layer concern, not an
-- RLS one. UPDATE is permitted here (unlike evidence_files' own
-- immutable-once-uploaded posture) because both tables hold operator-
-- editable draft content, not immutable records of a stored artifact.
-- ============================================================

alter table public.emission_data_declaration_context
    enable row level security;

create policy emission_data_declaration_context_select_own_org
    on public.emission_data_declaration_context
    for select
    to authenticated
    using (
        org_id in (select app.user_org_ids())
    );

create policy emission_data_declaration_context_insert_own_org
    on public.emission_data_declaration_context
    for insert
    to authenticated
    with check (
        org_id in (select app.user_org_ids())
        and exists (
            select 1
            from public.emission_data ed
            where ed.id = emission_data_declaration_context.emission_data_id
              and ed.entered_by_org_id = emission_data_declaration_context.org_id
        )
    );

create policy emission_data_declaration_context_update_own_org
    on public.emission_data_declaration_context
    for update
    to authenticated
    using (
        org_id in (select app.user_org_ids())
    )
    with check (
        org_id in (select app.user_org_ids())
        and exists (
            select 1
            from public.emission_data ed
            where ed.id = emission_data_declaration_context.emission_data_id
              and ed.entered_by_org_id = emission_data_declaration_context.org_id
        )
    );

create policy emission_data_declaration_context_delete_own_org
    on public.emission_data_declaration_context
    for delete
    to authenticated
    using (
        org_id in (select app.user_org_ids())
    );


alter table public.emission_data_precursors
    enable row level security;

create policy emission_data_precursors_select_own_org
    on public.emission_data_precursors
    for select
    to authenticated
    using (
        org_id in (select app.user_org_ids())
    );

create policy emission_data_precursors_insert_own_org
    on public.emission_data_precursors
    for insert
    to authenticated
    with check (
        org_id in (select app.user_org_ids())
        and exists (
            select 1
            from public.emission_data ed
            where ed.id = emission_data_precursors.emission_data_id
              and ed.entered_by_org_id = emission_data_precursors.org_id
        )
    );

create policy emission_data_precursors_update_own_org
    on public.emission_data_precursors
    for update
    to authenticated
    using (
        org_id in (select app.user_org_ids())
    )
    with check (
        org_id in (select app.user_org_ids())
        and exists (
            select 1
            from public.emission_data ed
            where ed.id = emission_data_precursors.emission_data_id
              and ed.entered_by_org_id = emission_data_precursors.org_id
        )
    );

create policy emission_data_precursors_delete_own_org
    on public.emission_data_precursors
    for delete
    to authenticated
    using (
        org_id in (select app.user_org_ids())
    );


-- ============================================================
-- END OF MIGRATION
-- ============================================================
