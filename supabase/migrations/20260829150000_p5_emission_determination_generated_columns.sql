-- ============================================================
-- Snowkap CBAM
-- P5: Emission Determination Generated Columns
-- ============================================================
--
-- Purpose:
--   shipment_lines.emission_determination (added in the P4
--   schema migration, always null through P4) now gets real
--   jsonb payloads from src/application/emissions/resolve-line-
--   emissions.ts. This migration adds the "hot key" generated
--   columns docs/plans/MASTER_PLAN.md §12 calls for, so common
--   filters/reports don't have to unpack jsonb on every read.
--
--   Additive only -- no existing column, constraint, or policy
--   is touched.
-- ============================================================


-- ============================================================
-- 1. DETERMINATION METHOD
-- ============================================================
--
-- "DEFAULT" | "ACTUAL" (EmissionDetermination's discriminant,
-- src/domain/emissions/types.ts) -- present for both methods.
-- ============================================================

alter table public.shipment_lines
    add column determination_method text
        generated always as (
            emission_determination ->> 'method'
        ) stored;


-- ============================================================
-- 2. RESOLUTION REASON / DATASET VERSION
-- ============================================================
--
-- DEFAULT-method specific: nested under emission_determination
-- -> 'resolution' (see RegulatoryResolutionSnapshot). Null for
-- ACTUAL-method rows (P7) and for undetermined rows -- that is
-- correct, not a data gap: these are DEFAULT-method hot keys
-- only, not a substitute for reading the full snapshot.
-- ============================================================

alter table public.shipment_lines
    add column resolution_reason text
        generated always as (
            emission_determination -> 'resolution' ->> 'reason'
        ) stored;

alter table public.shipment_lines
    add column dataset_version text
        generated always as (
            emission_determination -> 'resolution' ->> 'dataset_version'
        ) stored;


-- ============================================================
-- 3. INDEXES
-- ============================================================
--
-- Partial (determination_method is null for every undetermined
-- line -- most rows at first) and org-first, matching this
-- table's existing index style.
-- ============================================================

create index shipment_lines_org_determination_method_idx
    on public.shipment_lines (org_id, determination_method)
    where determination_method is not null;

create index shipment_lines_org_resolution_reason_idx
    on public.shipment_lines (org_id, resolution_reason)
    where resolution_reason is not null;


-- ============================================================
-- END OF MIGRATION
-- ============================================================
