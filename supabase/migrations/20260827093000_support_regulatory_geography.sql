-- ============================================================
-- Snowkap CBAM
-- Regulatory Geography Support
-- ============================================================
--
-- Purpose:
--   Extend the regulatory country reference table so that
--   "Other Countries and Territories" can be represented
--   explicitly without inventing an ISO country identity.
--
-- IMPORTANT:
--   Do NOT modify the already-applied regulatory-foundation
--   migration. This migration is intentionally incremental.
-- ============================================================


-- ============================================================
-- 1. REGULATORY GEOGRAPHY TYPE
-- ============================================================

alter table public.countries
    add column country_type text
        not null
        default 'COUNTRY'
        check (
            country_type in (
                'COUNTRY',
                'OTHER_TERRITORIES'
            )
        );


-- ============================================================
-- 2. ISO FIELDS
-- ============================================================
--
-- Ordinary countries must continue to carry ISO2/ISO3.
-- The special regulatory fallback geography does not have
-- an ISO country identity, so its ISO fields are nullable.
-- ============================================================

alter table public.countries
    alter column iso2 drop not null;

alter table public.countries
    alter column iso3 drop not null;


-- ============================================================
-- 3. ISO REQUIREMENT CONSTRAINT
-- ============================================================
--
-- COUNTRY:
--   iso2 and iso3 are mandatory.
--
-- OTHER_TERRITORIES:
--   iso2 and iso3 must be NULL.
-- ============================================================

alter table public.countries
    add constraint countries_country_type_iso_consistency_ck
    check (
        (
            country_type = 'COUNTRY'
            and iso2 is not null
            and iso3 is not null
        )
        or
        (
            country_type = 'OTHER_TERRITORIES'
            and iso2 is null
            and iso3 is null
        )
    );


-- ============================================================
-- 4. ISO FORMAT CONSTRAINTS
-- ============================================================
--
-- The original constraints assume non-null ISO fields.
-- PostgreSQL CHECK constraints pass for NULL, so the existing
-- format checks remain valid for ordinary countries while
-- allowing NULL for OTHER_TERRITORIES.
-- ============================================================

-- Existing constraints remain:
--   countries_iso2_format_ck
--   countries_iso3_format_ck


-- ============================================================
-- 5. ONLY ONE OTHER-TERRITORIES ROW
-- ============================================================

create unique index countries_other_territories_uq
    on public.countries (country_type)
    where country_type = 'OTHER_TERRITORIES';


-- ============================================================
-- 6. COUNTRY NAME UNIQUENESS
-- ============================================================
--
-- Prevent duplicate names while allowing the existing ISO
-- uniqueness rules to remain authoritative for ordinary
-- countries.
-- ============================================================

create unique index countries_name_uq
    on public.countries (name);


-- ============================================================
-- 7. SUPPORT LOOKUPS BY TYPE
-- ============================================================

create index countries_country_type_idx
    on public.countries (country_type);


-- ============================================================
-- 8. SAFETY CHECKS
-- ============================================================
--
-- These constraints prevent malformed combinations such as:
--
--   country_type = COUNTRY
--   iso2 = NULL
--
-- or:
--
--   country_type = OTHER_TERRITORIES
--   iso2 = 'IN'
-- ============================================================

alter table public.countries
    add constraint countries_other_territories_name_ck
    check (
        country_type = 'COUNTRY'
        or name = '_Other Countries and Territorie'
    );


-- ============================================================
-- END OF MIGRATION
-- ============================================================