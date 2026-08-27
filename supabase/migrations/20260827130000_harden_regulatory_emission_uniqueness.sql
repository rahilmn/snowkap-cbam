-- ============================================================
-- Snowkap CBAM
-- Harden regulatory emission-value uniqueness
-- ============================================================
--
-- Purpose:
--   Enforce the regulatory identity of default emission rows
--   at the PostgreSQL level.
--
-- Identity:
--   dataset + country + good + production route
--
-- PostgreSQL NULL semantics require two indexes:
--
--   1. Route-specific records:
--      dataset_id + country_id + good_id + production_route_id
--
--   2. Route-independent records:
--      dataset_id + country_id + good_id
--      where production_route_id is NULL
--
-- Existing duplicate validation must pass before this
-- migration is applied.
-- ============================================================


-- ============================================================
-- 1. ROUTE-SPECIFIC REGULATORY IDENTITY
-- ============================================================

create unique index default_emission_values_route_identity_uq
    on public.default_emission_values (
        dataset_id,
        country_id,
        good_id,
        production_route_id
    )
    where production_route_id is not null;


-- ============================================================
-- 2. ROUTE-INDEPENDENT REGULATORY IDENTITY
-- ============================================================

create unique index default_emission_values_route_independent_identity_uq
    on public.default_emission_values (
        dataset_id,
        country_id,
        good_id
    )
    where production_route_id is null;


-- ============================================================
-- END OF MIGRATION
-- ============================================================