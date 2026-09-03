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

-- ============================================================
-- Deliberate revokes, re-asserted after the blanket grants above.
--
-- 2026-09-03 (P14.3). FOUND BY CI, on the first run of the release
-- candidate: seven security tests failed that pass locally, and the
-- reason is three lines up. This file replicates the hosted platform's
-- bootstrap ACL with `grant all on all tables` and `grant all on all
-- functions`, and the CLI runs it as the LAST step of
-- `supabase db reset` / `supabase start` -- after every migration. So a
-- blanket grant here silently undoes every deliberate REVOKE a
-- migration made.
--
-- What that was actually costing, in an environment built by this
-- repository's own documented procedure:
--
--   * 20260903190000 revokes INSERT/UPDATE/DELETE on
--     calculation_results from anon and authenticated, because an RLS
--     policy cannot tell a real emissions figure from a forged one. The
--     blanket table grant handed all three back, and the forgery that
--     reaches an immutable filed declaration was reachable again.
--   * The same migration grants record_calculation_result to
--     service_role ALONE, for the same reason. The blanket FUNCTION
--     grant handed EXECUTE to authenticated, so a member could simply
--     call the trusted channel directly and pass it any number.
--   * 20260903170000 revokes TRUNCATE from both API roles -- the one
--     privilege in this schema that row-level security does not
--     constrain at all. The blanket table grant handed that back too.
--
-- This is the same lesson the 2026-09-03 hosted restore drill produced,
-- arriving by a second and much more routine path: a dump records the
-- grants that exist and never their absence, and a blanket grant
-- re-opens what a revoke closed. Anywhere a broad grant runs after a
-- narrow revoke, the revoke has to be re-asserted.
--
-- KEEPING THIS IN STEP. These statements mirror the migrations named
-- above and must be updated with them. That coupling is deliberate
-- rather than clever: the alternative -- teaching this file which
-- tables are special -- is a list that rots silently, whereas this one
-- is covered by tests that already caught it once. See
-- tests/integration/calculation-reproduction.test.ts, "P14.1 -- the
-- calculation-result write boundary", case (4), which asserts no write
-- grant and an unreachable RPC, and failed in CI exactly as it should
-- have.
--
-- Guarded on existence because the CLI also runs this file during
-- `supabase start`, when only the first migrations have applied and
-- neither the table nor the function exists yet.
-- ============================================================

do $$
begin
    if to_regclass('public.calculation_results') is not null then
        execute 'revoke insert, update, delete on public.calculation_results from anon, authenticated';
    end if;

    if to_regprocedure(
        'public.record_calculation_result(uuid,uuid,uuid,text,jsonb,text,text,jsonb,jsonb,text,uuid)'
    ) is not null then
        execute 'revoke all on function public.record_calculation_result('
             || 'uuid,uuid,uuid,text,jsonb,text,text,jsonb,jsonb,text,uuid) '
             || 'from public, anon, authenticated';

        execute 'grant execute on function public.record_calculation_result('
             || 'uuid,uuid,uuid,text,jsonb,text,text,jsonb,jsonb,text,uuid) '
             || 'to service_role';
    end if;
end
$$;

-- Safe with any number of tables, including none.
revoke truncate on all tables in schema public from anon, authenticated;

alter default privileges in schema public
    revoke truncate on tables from anon, authenticated;

alter default privileges for role postgres in schema public
    revoke truncate on tables from anon, authenticated;

-- ------------------------------------------------------------
-- 2026-09-03 (P14 remediation). anon must not hold EXECUTE on the
-- SECURITY DEFINER RPCs.
--
-- Every one of them is created with `revoke all ... from public` then
-- `grant execute ... to authenticated`, so `authenticated` is the
-- intended grantee and `anon` was never meant to hold EXECUTE on any of
-- them. It did, in every freshly built environment, purely because the
-- blanket function grant at the top of this file runs afterwards.
--
-- Guarded on existence so this file stays runnable against a database
-- built from any subset of the migrations, matching the block above.
-- ------------------------------------------------------------
do $$
declare
    v_signature text;
begin
    foreach v_signature in array array[
        'public.accept_organization_invitation(uuid)',
        'public.accept_sharing_grant_invitation(uuid,uuid)',
        'public.create_organization_with_owner(text,text,text[])',
        'public.list_org_members(uuid)',
        'public.record_declaration_filed(uuid,text)',
        'public.record_shared_data_consumption(uuid,uuid,uuid,integer,uuid,text)',
        'public.sharing_counterparty_org_names()'
    ]
    loop
        if to_regprocedure(v_signature) is not null then
            execute format('revoke all on function %s from anon', v_signature);
        end if;
    end loop;
end
$$;

-- ------------------------------------------------------------
-- 2026-09-03 (P14 remediation). THE STRUCTURAL BACKSTOP.
--
-- Everything above this line is a hand-maintained list of revokes to
-- re-assert after the blanket grants. That list has been wrong twice:
-- once when it did not exist at all and the P14.1 calculation-write
-- boundary was silently reopened in every fresh environment, and once
-- when it covered one of eight deliberate revokes.
--
-- This is the part that does not depend on anyone remembering. Every
-- migration that deliberately revokes a privilege registers it in
-- app.privilege_invariants (20260903230000); this asks the database
-- whether any of them has been undone, and refuses to finish seeding if
-- so. A forgotten re-assertion now fails the build loudly instead of
-- producing a working application with a reopened boundary.
--
-- Guarded on the function existing, so this file still runs against a
-- database built from an earlier subset of the migrations.
-- ------------------------------------------------------------
do $$
declare
    v_violations text;
    v_count integer;
begin
    if to_regprocedure('app.assert_privilege_invariants()') is null then
        raise notice
            'seed.sql: app.assert_privilege_invariants() not present -- skipping the privilege-invariant check (database predates 20260903230000).';
        return;
    end if;

    select count(*), string_agg('  - ' || violation, chr(10))
    into v_count, v_violations
    from app.assert_privilege_invariants();

    if v_count > 0 then
        raise exception
            'seed.sql: % privilege invariant(s) violated after the blanket grants above. A deliberate REVOKE has been undone and not re-asserted: %',
            v_count, v_violations;
    end if;

    raise notice
        'seed.sql: privilege invariants hold -- every deliberate REVOKE survived the blanket grants.';
end
$$;
