-- ============================================================
-- Snowkap CBAM
-- P14 (2026-09-03): `anon` and `authenticated` hold TRUNCATE on every
-- table in `public`, and TRUNCATE is not subject to row-level security.
--
-- FOUND BY the P14 adversarial security re-check and reproduced live,
-- as an ordinary authenticated session, inside a rolled-back
-- transaction:
--
--     set local role authenticated;
--     truncate table public.sharing_grants cascade;   -- TRUNCATE TABLE
--     select count(*) from public.sharing_grants;     -- 0
--
-- Twenty-two tables, both roles, confirmed against
-- information_schema.role_table_grants.
--
-- WHERE IT COMES FROM. Not from this project: it is the standard
-- Supabase bootstrap, which does `grant all on all tables in schema
-- public to anon, authenticated`. `all` includes TRUNCATE. Every
-- migration in this repository that has since added a table has
-- inherited it through the default privileges.
--
-- WHY IT MATTERS EVEN THOUGH IT IS NOT DIRECTLY REACHABLE. PostgREST
-- exposes SELECT/INSERT/UPDATE/DELETE and RPC; there is no HTTP verb
-- that issues a TRUNCATE, so this is not a one-request data-loss bug
-- and is not being reported as one. What it is: the single privilege in
-- this schema that RLS does not constrain at all. Every other
-- protection in this database -- 56 policies, the org-scoping
-- functions, the fact-immutability triggers, the append-only posture of
-- audit_events and calculation_results -- operates on rows. TRUNCATE
-- operates on the table and answers to none of them, so any future path
-- that can run arbitrary SQL as one of these roles (a SECURITY INVOKER
-- function, an injection in a raw query, a mis-scoped RPC) escalates
-- straight to total, unrecoverable-from-RLS data loss on an
-- append-only compliance record.
--
-- The fix costs nothing: nothing in this application truncates
-- anything. Revoked from the two API-facing roles, and removed from the
-- default privileges so tables added by future migrations do not
-- silently regain it.
--
-- Deliberately NOT revoking anything else. DELETE stays, because RLS
-- genuinely governs it and several product flows depend on it
-- (removing a supplier, a line, an evidence file). This is the one
-- privilege that was granted and never governed.
-- ============================================================

revoke truncate on all tables in schema public from anon, authenticated;

-- Future tables. Without this, the next migration that creates a table
-- re-grants TRUNCATE through the default privileges and this fix
-- quietly decays.
alter default privileges in schema public
    revoke truncate on tables from anon, authenticated;

-- Also pinned explicitly to `postgres`, the role migrations run as, so
-- the default does not depend on which role happens to be current when
-- a future migration creates a table.
--
-- NOT extended to `supabase_admin`: `alter default privileges for role
-- supabase_admin` raises "permission denied to change default
-- privileges" for the migration role, on the hosted project as well as
-- locally. A table created by supabase_admin could therefore still
-- carry the grant; the explicit revoke above is what covers the tables
-- that exist today, and any future table created outside a migration
-- would need this run again. Stated rather than silently omitted.
alter default privileges for role postgres in schema public
    revoke truncate on tables from anon, authenticated;
