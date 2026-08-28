-- ============================================================
-- Snowkap CBAM
-- P7 mandatory-review fix: maintain updated_at on emission_data and
-- sharing_grants
--
-- Both tables declare `updated_at timestamptz not null default now()`
-- (20260829230000, 20260829260000), but a column DEFAULT applies on
-- INSERT only -- neither table has ever had an updated_at trigger, and
-- no application code writes the column, so it has been permanently
-- equal to created_at since P7-B (found in P7's mandatory
-- "actual-emissions logic" review). Both fact-change triggers'
-- own error messages ("only verification_status, verifier_user_id,
-- rejection_reason, status, and updated_at may change via UPDATE" /
-- "only status and updated_at may change via UPDATE") describe a column
-- that has never actually changed -- a real, if minor, documentation-
-- vs-behavior gap in its own right, and also the cheapest available
-- substrate for the still-deferred stale-emission-data-indicator
-- feature (master plan §9/§18) to eventually compare against.
--
-- app.touch_updated_at() is written generically (keyed on
-- TG_TABLE_NAME's own updated_at column via NEW/OLD, not hardcoded to
-- one table) since it is immediately reused across two tables here --
-- this is not speculative future-proofing, it is the actual shape the
-- first two call sites need.
--
-- Trigger firing order: both tables already have a BEFORE UPDATE
-- fact-change trigger (app.prevent_emission_data_fact_change,
-- app.prevent_sharing_grant_fact_change) that guards specific columns
-- via an OLD-vs-NEW comparison; neither guards updated_at itself, so
-- this new trigger's relative firing order against them does not
-- matter -- confirmed by inspecting both functions, not assumed.
-- ============================================================


create or replace function app.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

comment on function app.touch_updated_at() is
    'Generic BEFORE UPDATE helper: stamps updated_at to the current '
    'time on every UPDATE, regardless of which other columns changed. '
    'Reused across every table in this schema that declares an '
    'updated_at column with an INSERT-only DEFAULT (see this '
    'migration''s header comment for why that default alone was never '
    'enough).';

create trigger emission_data_touch_updated_at_trg
    before update on public.emission_data
    for each row
    execute function app.touch_updated_at();

create trigger sharing_grants_touch_updated_at_trg
    before update on public.sharing_grants
    for each row
    execute function app.touch_updated_at();


-- ============================================================
-- END OF MIGRATION
-- ============================================================
