-- ============================================================
-- Local-only seed script (supabase/seed.sql is never applied to any
-- hosted Supabase project -- the CLI runs this exclusively as the
-- final step of `supabase db reset`/`start` against a local instance).
--
-- Purpose: replicate the base-table privilege grants the HOSTED
-- Supabase platform sets up automatically at project provisioning time
-- (before any user migration ever runs), which a local `db reset`
-- does not replicate on its own. Without this, every anon/authenticated
-- /service_role query against a table created by a migration fails
-- with "permission denied for table X" locally -- a pure local-CLI
-- environment gap, not a defect in any migration (confirmed: the
-- already-applied, already-hosted-verified regulatory tables show the
-- exact same missing grants locally). RLS policies are the real access
-- control in every environment; these grants only restore the base
-- table-level ACL both environments are supposed to share.
-- ============================================================

grant usage on schema public to anon, authenticated, service_role;

grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all functions in schema public to anon, authenticated, service_role;

alter default privileges in schema public
    grant all on tables to anon, authenticated, service_role;

alter default privileges in schema public
    grant all on sequences to anon, authenticated, service_role;

alter default privileges in schema public
    grant all on functions to anon, authenticated, service_role;
