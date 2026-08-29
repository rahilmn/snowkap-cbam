-- ============================================================
-- Snowkap CBAM
-- P13 release-blocker remediation: discovered while adding a new
-- regression test for 20260829580000's finding #4 fix. Simulating a
-- producer flipping their own emission_data record's verification_status
-- via the service-role client (a convenient test stand-in for "some
-- other actor changed this data", not itself a real product path)
-- failed with "permission denied for schema app" -- not from anything
-- this migration series added, but from a PRE-EXISTING, two-part gap:
--
--   1. service_role was never granted USAGE on the app schema at all
--      (has_schema_privilege('service_role', 'app', 'USAGE') = false,
--      confirmed live) -- this is the actual proximate cause of the
--      exact "permission denied for schema app" wording, and function-
--      level EXECUTE grants alone cannot substitute for it.
--
--   2. Even with schema USAGE, several individual app-schema helper
--      functions (user_org_ids, user_is_admin_or_owner_of,
--      user_is_owner_of, user_shared_installation_ids,
--      organization_exists, user_confirmed_email,
--      declaration_predecessor_matches) were never explicitly granted
--      EXECUTE to service_role either -- confirmed live via
--      has_function_privilege(). These are ordinary (non-SECURITY-
--      DEFINER) plpgsql/sql functions, so calling one from within
--      another ordinary function (e.g.
--      app.enforce_emission_data_verification_gate,
--      20260829480000, calling app.user_is_admin_or_owner_of() inside
--      one branch of an AND expression) runs under the INVOKING
--      session's own privileges, not the function owner's -- and
--      PostgreSQL checks EXECUTE privilege for every function
--      referenced in a compiled expression at first-execution/plan
--      time, REGARDLESS of whether short-circuit evaluation ever
--      actually calls it at runtime.
--
-- All of this was invisible until now because these helpers were
-- originally written assuming they would only ever be reached via an
-- RLS policy evaluation, which service_role always bypasses entirely --
-- so the very first service-role-driven write that reaches one of them
-- from inside a TRIGGER (not a policy) fails outright, regardless of
-- what branch would have run.
--
-- Queried live (has_function_privilege) to find every app-schema
-- function missing this grant, rather than fixing only the one this
-- migration's own test happened to hit:
--
--   app.user_org_ids, app.user_is_admin_or_owner_of, app.user_is_owner_of,
--   app.user_shared_installation_ids, app.organization_exists,
--   app.user_confirmed_email, app.declaration_predecessor_matches
--
-- All seven are pure, read-only authorization/lookup helpers already
-- granted to `authenticated` and already callable, transitively, by
-- service_role's own full table access (service_role bypasses every
-- RLS policy that calls these, so it can already read anything these
-- functions read directly) -- granting EXECUTE closes an operational
-- reliability gap (any future service-role/backfill/support script
-- reaching one of these via a trigger would otherwise fail
-- unpredictably), not a security boundary: service_role gains no
-- capability it did not already effectively have.
-- ============================================================

-- Schema-level USAGE was itself missing for service_role -- the actual
-- proximate cause of "permission denied for schema app" (function-level
-- EXECUTE grants alone are not sufficient without this).
grant usage on schema app to service_role;

grant execute on function app.user_org_ids() to service_role;
grant execute on function app.user_is_admin_or_owner_of(uuid) to service_role;
grant execute on function app.user_is_owner_of(uuid) to service_role;
grant execute on function app.user_shared_installation_ids() to service_role;
grant execute on function app.organization_exists(uuid) to service_role;
grant execute on function app.user_confirmed_email() to service_role;
grant execute on function app.declaration_predecessor_matches(uuid, uuid, text, integer, smallint) to service_role;
