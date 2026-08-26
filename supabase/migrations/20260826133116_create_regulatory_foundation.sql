-- ============================================================
-- Snowkap CBAM
-- Regulatory Foundation Schema
--
-- Purpose:
--   Establish the versioned regulatory/reference-data layer.
--
-- This migration intentionally does NOT create:
--   - users
--   - organizations
--   - calculations
--   - calculation results
--   - leads
--   - application/business tables
--
-- Regulatory data is versioned through:
--   regulatory_sources
--   regulatory_datasets
-- ============================================================


-- ============================================================
-- 1. REGULATORY SOURCES
-- ============================================================

create table public.regulatory_sources (
    id uuid primary key default gen_random_uuid(),

    source_type text not null
        check (
            source_type in (
                'REGULATION',
                'IMPLEMENTING_REGULATION',
                'OFFICIAL_DATASET',
                'COMMISSION_GUIDANCE',
                'SNOWKAP_ASSUMPTION'
            )
        ),

    document_code text not null,

    title text not null,

    official_url text,

    publication_date date,

    effective_from date not null,

    effective_to date,

    version text not null,

    created_at timestamptz not null default now(),

    constraint regulatory_sources_document_version_uq
        unique (document_code, version),

    constraint regulatory_sources_effective_range_ck
        check (
            effective_to is null
            or effective_to >= effective_from
        )
);


-- ============================================================
-- 2. REGULATORY DATASETS
-- ============================================================

create table public.regulatory_datasets (
    id uuid primary key default gen_random_uuid(),

    source_id uuid not null
        references public.regulatory_sources(id)
        on delete restrict,

    dataset_type text not null
        check (
            dataset_type in (
                'CBAM_GOODS',
                'DEFAULT_EMISSION_VALUES',
                'CBAM_BENCHMARKS',
                'CBAM_FACTORS',
                'CSCF',
                'CERTIFICATE_PRICES',
                'COUNTRIES',
                'EXEMPTIONS'
            )
        ),

    version text not null,

    effective_from date not null,

    effective_to date,

    source_file_name text,

    source_checksum text,

    status text not null default 'DRAFT'
        check (
            status in (
                'DRAFT',
                'ACTIVE',
                'SUPERSEDED'
            )
        ),

    imported_at timestamptz,

    created_at timestamptz not null default now(),

    constraint regulatory_datasets_source_type_version_uq
        unique (
            source_id,
            dataset_type,
            version
        ),

    constraint regulatory_datasets_effective_range_ck
        check (
            effective_to is null
            or effective_to >= effective_from
        )
);


-- ============================================================
-- 3. COUNTRY REFERENCE
-- ============================================================

create table public.countries (
    id uuid primary key default gen_random_uuid(),

    iso2 text not null,

    iso3 text not null,

    name text not null,

    official_name text,

    active boolean not null default true,

    created_at timestamptz not null default now(),

    constraint countries_iso2_uq
        unique (iso2),

    constraint countries_iso3_uq
        unique (iso3),

    constraint countries_iso2_format_ck
        check (
            iso2 ~ '^[A-Z]{2}$'
        ),

    constraint countries_iso3_format_ck
        check (
            iso3 ~ '^[A-Z]{3}$'
        )
);


-- ============================================================
-- 4. PRODUCTION ROUTES
-- ============================================================

create table public.production_routes (
    id uuid primary key default gen_random_uuid(),

    code text not null,

    name text not null,

    sector text not null
        check (
            sector in (
                'CEMENT',
                'FERTILISERS',
                'IRON_STEEL',
                'ALUMINIUM',
                'HYDROGEN',
                'ELECTRICITY'
            )
        ),

    source_route_indicator text,

    source_id uuid
        references public.regulatory_sources(id)
        on delete restrict,

    effective_from date,

    effective_to date,

    created_at timestamptz not null default now(),

    constraint production_routes_code_effective_uq
        unique (code, effective_from),

    constraint production_routes_effective_range_ck
        check (
            effective_to is null
            or effective_from is null
            or effective_to >= effective_from
        )
);


-- ============================================================
-- 5. CBAM GOODS / CLASSIFICATION
-- ============================================================

create table public.cbam_goods (
    id uuid primary key default gen_random_uuid(),

    trade_code text not null,

    trade_code_type text not null
        check (
            trade_code_type in (
                'HS_HEADING',
                'HS_SUBHEADING',
                'CN',
                'TARIC'
            )
        ),

    record_type text not null
        check (
            record_type in (
                'CLASSIFICATION',
                'TRADE_GOOD'
            )
        ),

    record_level text not null
        check (
            record_level in (
                'HS_HEADING',
                'HS_SUBHEADING',
                'TRADE_GOOD'
            )
        ),

    parent_good_id uuid
        references public.cbam_goods(id)
        on delete restrict,

    sector text not null
        check (
            sector in (
                'CEMENT',
                'FERTILISERS',
                'IRON_STEEL',
                'ALUMINIUM',
                'HYDROGEN',
                'ELECTRICITY'
            )
        ),

    description text not null,

    functional_unit text
        check (
            functional_unit in (
                'TONNES',
                'MWH'
            )
        ),

    active_from date,

    active_to date,

    created_at timestamptz not null default now(),

    constraint cbam_goods_effective_range_ck
        check (
            active_to is null
            or active_from is null
            or active_to >= active_from
        )
);

alter table public.cbam_goods
    add constraint cbam_goods_trade_code_format_ck
    check (
        (
            trade_code_type = 'HS_HEADING'
            and trade_code ~ '^[0-9]{4}$'
        )
        or
        (
            trade_code_type = 'HS_SUBHEADING'
            and trade_code ~ '^[0-9]{6}$'
        )
        or
        (
            trade_code_type = 'CN'
            and trade_code ~ '^[0-9]{8}$'
        )
        or
        (
            trade_code_type = 'TARIC'
            and trade_code ~ '^[0-9]{10}$'
        )
    );


-- ============================================================
-- 6. DEFAULT EMISSION VALUES
-- ============================================================

create table public.default_emission_values (
    id uuid primary key default gen_random_uuid(),

    dataset_id uuid not null
        references public.regulatory_datasets(id)
        on delete restrict,

    good_id uuid not null
        references public.cbam_goods(id)
        on delete restrict,

    country_id uuid not null
        references public.countries(id)
        on delete restrict,

    direct_value numeric,

    direct_status text not null
        check (
            direct_status in (
                'AVAILABLE',
                'NOT_APPLICABLE',
                'UNAVAILABLE',
                'REFERENCE_REQUIRED',
                'SOURCE_TEXT'
            )
        ),

    direct_raw_source_value text,

    indirect_value numeric,

    indirect_status text not null
        check (
            indirect_status in (
                'AVAILABLE',
                'NOT_APPLICABLE',
                'UNAVAILABLE',
                'REFERENCE_REQUIRED',
                'SOURCE_TEXT'
            )
        ),

    indirect_raw_source_value text,

    total_value numeric,

    total_status text not null
        check (
            total_status in (
                'AVAILABLE',
                'NOT_APPLICABLE',
                'UNAVAILABLE',
                'REFERENCE_REQUIRED',
                'SOURCE_TEXT'
            )
        ),

    total_raw_source_value text,

    production_route_id uuid
        references public.production_routes(id)
        on delete restrict,

    source_sheet text,

    source_row integer,

    source_trade_code text,

    created_at timestamptz not null default now(),

    constraint default_emission_values_source_row_ck
        check (
            source_row is null
            or source_row > 0
        )
);


-- ============================================================
-- 7. INDEXES
-- ============================================================

create index regulatory_datasets_source_id_idx
    on public.regulatory_datasets (source_id);

create index regulatory_datasets_type_status_idx
    on public.regulatory_datasets (
        dataset_type,
        status
    );


create index production_routes_code_idx
    on public.production_routes (code);

create index production_routes_sector_idx
    on public.production_routes (sector);


create index cbam_goods_trade_code_idx
    on public.cbam_goods (trade_code);

create index cbam_goods_trade_code_type_idx
    on public.cbam_goods (
        trade_code_type
    );

create index cbam_goods_sector_idx
    on public.cbam_goods (sector);

create index cbam_goods_parent_good_idx
    on public.cbam_goods (
        parent_good_id
    );


create index default_emission_values_dataset_idx
    on public.default_emission_values (
        dataset_id
    );

create index default_emission_values_good_idx
    on public.default_emission_values (
        good_id
    );

create index default_emission_values_country_idx
    on public.default_emission_values (
        country_id
    );

create index default_emission_values_route_idx
    on public.default_emission_values (
        production_route_id
    );


-- ============================================================
-- 8. ROW LEVEL SECURITY
--
-- Reference data is protected by default.
-- We will add explicit read policies later when the
-- application/API access model has been finalized.
-- ============================================================

alter table public.regulatory_sources
    enable row level security;

alter table public.regulatory_datasets
    enable row level security;

alter table public.countries
    enable row level security;

alter table public.production_routes
    enable row level security;

alter table public.cbam_goods
    enable row level security;

alter table public.default_emission_values
    enable row level security;


-- ============================================================
-- END OF MIGRATION
-- ============================================================