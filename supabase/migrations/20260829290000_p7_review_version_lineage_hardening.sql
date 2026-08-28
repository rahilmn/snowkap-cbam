-- ============================================================
-- Snowkap CBAM
-- P7 mandatory-review fix: emission_data version/predecessor lineage
-- collision guard (S2)
--
-- recordEmissionData (src/application/emissions/manage-emission-data.ts)
-- previously computed a new row's version/predecessor_id by looking up
-- only the currently-ACTIVE row for (installation, period) -- found in
-- P7's mandatory review: two DRAFT corrections recorded in a row,
-- before either is ever activated, both see "no ACTIVE row changed
-- between them" and both compute the SAME version number with the SAME
-- predecessor_id, forking the lineage into two same-numbered rows
-- instead of a chain. Fixed at the application layer (same migration
-- sequence, prior commit) by computing version/predecessor_id from the
-- LATEST row in the lineage regardless of status.
--
-- This migration is the DB-level backstop for that same invariant,
-- matching this schema's established two-wall posture (an application-
-- layer fix is never trusted alone -- see every RLS policy in this
-- schema for the same reasoning applied to tenancy instead of lineage
-- integrity):
--
--   1. emission_data_version_uq: no two rows may share a version number
--      within the same (installation, period) lineage. Mirrors
--      emission_data_one_active_per_installation_period_uq's own
--      coalesce(reporting_period_quarter, 0) trick (20260829230000) for
--      the identical reason -- NULL <> NULL for uniqueness purposes, so
--      two ANNUAL rows (quarter IS NULL for both) would not otherwise
--      collide on a plain composite unique index.
--
--   2. emission_data_predecessor_id_uq: a predecessor_id may be
--      referenced by at most one successor row -- a predecessor cannot
--      have two different "next versions" pointing back at it, which
--      is exactly the fork shape the found bug could produce. A plain
--      unique index handles this correctly even though predecessor_id
--      is nullable: Postgres unique indexes never consider NULL equal
--      to NULL, so any number of first-version rows (predecessor_id
--      null) coexist without colliding on this index -- only two rows
--      naming the SAME non-null predecessor would.
-- ============================================================

create unique index emission_data_version_uq
    on public.emission_data (
        installation_id,
        entered_by_org_id,
        reporting_period_kind,
        reporting_period_year,
        coalesce(reporting_period_quarter, 0),
        version
    );

create unique index emission_data_predecessor_id_uq
    on public.emission_data (predecessor_id)
    where predecessor_id is not null;


-- ============================================================
-- END OF MIGRATION
-- ============================================================
