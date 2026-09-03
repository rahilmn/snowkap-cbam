-- ============================================================
-- Snowkap CBAM
-- P14 (2026-09-04), owner decision 2, follow-on: a read-only accessor
-- for the current engine version.
--
-- 20260904100000 put the version in app.engine_version, which is the
-- right place for it: the `app` schema is not exposed to PostgREST, so
-- the value that decides whether a declaration may be filed cannot be
-- read or written by a client, only by the SECURITY DEFINER functions
-- that need it.
--
-- That is also why the test pinning app.engine_version to
-- src/domain/calculations/types.ts's ENGINE_VERSION could not read it:
-- supabase-js gets PGRST106 for a schema PostgREST does not serve. A
-- pin nobody can evaluate is not a pin.
--
-- So: a function, not an exposed table. Reading the current engine
-- version discloses nothing -- it is already stamped on every
-- calculation_results row a user can read and in every filed snapshot
-- they can open -- while the table itself stays unwritable from the
-- API, which is the property that matters.
--
-- Also useful beyond the test: a UI that wants to tell someone
-- "recalculate before filing" needs to know what the current version
-- is, and this is how it asks.
-- ============================================================

create or replace function public.current_engine_version()
returns text
language sql
stable
security definer
set search_path = public
as $$
    select ev.version from app.engine_version ev;
$$;

comment on function public.current_engine_version() is
    '2026-09-04 (P14 owner decision 2). The calculation engine version '
    'the filing gate compares against. Read-only: app.engine_version is '
    'written by the migration that bumps ENGINE_VERSION, and the `app` '
    'schema is not exposed to PostgREST, so no client can change what '
    'the gate compares against. Reading it discloses nothing that is '
    'not already on every calculation_results row and in every filed '
    'snapshot.';

revoke all on function public.current_engine_version() from public;
revoke all on function public.current_engine_version() from anon;
grant execute on function public.current_engine_version()
    to authenticated, service_role;
